import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BASE_PATH } from "@/lib/basePath";
import {
  FinplanSnapshotSchema,
  type FinplanApiResponse,
  type FinplanSnapshot,
} from "@shared/finplanSchema";

// Manteniamo allineate le costanti chiave con lo shim inline dell'iframe
// (`client/public/finplan/index.html`): la chiave React-Query è la stessa
// usata dal wrapper Amministrazione, così invalidare da uno aggiorna l'altro.
const FINPLAN_QUERY_KEY = ["/api/finplan"] as const;
const PUT_DEBOUNCE_MS = 3000;
const STALE_TIME_MS = 60_000;

const FINPLAN_URL = `${BASE_PATH}/api/finplan`;

export interface UseFinplanDataResult {
  /**
   * Snapshot in shape "loose" — è il payload RAW restituito dal server,
   * solo type-castato. Volutamente non normalizzato così è byte-compatibile
   * con quanto scritto dall'iframe legacy. Per un parsing strict usare
   * `FinplanSnapshotSchema.safeParse(...)` esplicitamente nel consumer.
   */
  snapshot: FinplanSnapshot | null;
  /** Risultato di un parse Zod permissivo, utile per validare in UI sezioni
   *  derivate. Non sostituisce `snapshot` (che è sempre raw). */
  parsed: FinplanSnapshot | null;
  parseIssuesCount: number;
  updatedAt: string | null;
  updatedBy: string | null;
  isLoading: boolean;
  isError: boolean;
  refetch: () => void;
}

/**
 * Lettura del blob FinPlan dell'organizzazione corrente.
 *
 * Cache di 60s (allineato con la cadenza di sync dell'iframe shim) e
 * niente refetch automatico al focus, per non innescare reconcile-loops
 * quando i due mondi (iframe legacy + shell React) sono entrambi attivi
 * durante la migrazione. Il payload può essere `{}` (nessun dato per
 * quell'org): in quel caso `snapshot` è `null` e l'UI mostra empty state.
 *
 * Importante: `snapshot` è restituito RAW (non normalizzato) per byte-compat.
 */
export function useFinplanData(orgId: string | undefined): UseFinplanDataResult {
  const enabled = Boolean(orgId);
  const query = useQuery<FinplanApiResponse>({
    queryKey: [...FINPLAN_QUERY_KEY, orgId],
    queryFn: async () => {
      const res = await fetch(FINPLAN_URL, { credentials: "include" });
      if (!res.ok) {
        throw new Error(`GET /api/finplan failed: ${res.status}`);
      }
      return (await res.json()) as FinplanApiResponse;
    },
    enabled,
    staleTime: STALE_TIME_MS,
    gcTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  });

  const { snapshot, parsed, parseIssuesCount } = useMemo<{
    snapshot: FinplanSnapshot | null;
    parsed: FinplanSnapshot | null;
    parseIssuesCount: number;
  }>(() => {
    const data = query.data?.data;
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      return { snapshot: null, parsed: null, parseIssuesCount: 0 };
    }
    if (Object.keys(data).length === 0) {
      return { snapshot: null, parsed: null, parseIssuesCount: 0 };
    }
    // Raw: passato così com'è (byte-compat con l'iframe legacy).
    const raw = data as FinplanSnapshot;
    // Parsed (boundary di lettura): permissivo, niente default che
    // mutino shape (vedi shared/finplanSchema.ts).
    const result = FinplanSnapshotSchema.safeParse(data);
    if (result.success) {
      return { snapshot: raw, parsed: result.data, parseIssuesCount: 0 };
    }
    // eslint-disable-next-line no-console
    console.warn(
      "[useFinplanData] snapshot non conforme allo schema:",
      result.error.issues.slice(0, 3),
    );
    return { snapshot: raw, parsed: null, parseIssuesCount: result.error.issues.length };
  }, [query.data]);

  return {
    snapshot,
    parsed,
    parseIssuesCount,
    updatedAt: query.data?.updatedAt ?? null,
    updatedBy: query.data?.updatedBy ?? null,
    isLoading: query.isLoading,
    isError: query.isError,
    refetch: () => void query.refetch(),
  };
}

export interface UseFinplanMutationResult {
  /**
   * Programma una scrittura del nuovo snapshot. Debounced 3s. Se chiamata
   * più volte entro la finestra, l'ULTIMO valore vince (latest-wins).
   * Mentre un PUT è in volo, eventuali nuove chiamate vengono accodate
   * come `_pending` e flushate al termine.
   */
  scheduleSave: (snapshot: FinplanSnapshot) => void;
  /** Forza il flush immediato dell'eventuale snapshot in coda. */
  flush: () => Promise<void>;
  /** True quando una richiesta PUT è in volo. */
  isSaving: boolean;
  /** ISO della scrittura più recente confermata dal server. */
  lastSavedAt: string | null;
  /**
   * Ultimo errore di sync (es. conflict). Resettato dopo una scrittura
   * andata a buon fine.
   */
  error: Error | null;
}

/**
 * Hook di scrittura per `/api/finplan`.
 *
 * Strategia (parallela allo shim dell'iframe in
 * `client/public/finplan/index.html`):
 *  - **debounce 3s** su `scheduleSave` per non saturare la rete su edit
 *    contigui (allineato con i test `tests/finplan-sync.test.mjs`);
 *  - **latest-wins**: lo snapshot più recente viene tracciato in
 *    `pendingRef` IMMEDIATAMENTE al call di `scheduleSave`, così sia
 *    `flush()` sia il cleanup di unmount possono sempre recuperarlo —
 *    anche se il timer di debounce non è ancora scattato. Se un nuovo
 *    snapshot arriva mentre un PUT è in volo, sostituisce quello in
 *    coda e viene flushato alla chiusura del PUT corrente;
 *  - **conflict guard server-authoritative**: prima di ogni PUT facciamo
 *    un preflight `GET /api/finplan` per leggere l'`updatedAt` corrente
 *    del server (NON la cache TanStack-Query, che può essere stale per
 *    via di `staleTime: 60s` + `refetchOnWindowFocus: false`). Se è
 *    diverso da `lastKnownRemoteAtRef` (l'updatedAt da cui l'utente è
 *    partito o l'ultimo PUT andato a buon fine), un altro client ha
 *    scritto: settiamo `error`, NON sovrascriviamo (per non clobberare
 *    modifiche altrui), aggiorniamo la cache con la versione canonica
 *    e lasciamo `pendingRef` intatto perché il consumer possa decidere
 *    se forzare il flush dopo merge. Il backend resta latest-wins
 *    (compatibilità con l'iframe legacy che condivide lo stesso
 *    `finplan_data`).
 *  - su unmount, lo snapshot in coda viene flushato best-effort.
 */
export function useFinplanMutation(orgId: string | undefined): UseFinplanMutationResult {
  const queryClient = useQueryClient();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inflightRef = useRef<Promise<void> | null>(null);
  const pendingRef = useRef<FinplanSnapshot | null>(null);
  // Updatedat dell'ultima versione "nota" (initial GET o ultimo PUT
  // confermato). Usato per il conflict guard prima di ogni PUT.
  const lastKnownRemoteAtRef = useRef<string | null>(null);

  const [isSaving, setIsSaving] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const [error, setError] = useState<Error | null>(null);

  // Inizializza `lastKnownRemoteAtRef` dall'updatedAt corrente in cache,
  // così la prima scrittura sa "da dove" è partito l'utente.
  useEffect(() => {
    if (!orgId) return;
    const cached = queryClient.getQueryData<FinplanApiResponse>([
      ...FINPLAN_QUERY_KEY,
      orgId,
    ]);
    if (cached?.updatedAt && lastKnownRemoteAtRef.current === null) {
      lastKnownRemoteAtRef.current = cached.updatedAt;
    }
  }, [orgId, queryClient]);

  const doPut = useCallback(async (snapshot: FinplanSnapshot): Promise<void> => {
    if (!orgId) return;
    setIsSaving(true);
    try {
      // CONFLICT GUARD AUTORITATIVO: preflight GET dal server per leggere
      // l'updatedAt corrente. NON ci affidiamo alla cache TanStack-Query
      // (staleTime 60s + niente refetchOnWindowFocus → può essere stale).
      const knownAt = lastKnownRemoteAtRef.current;
      if (knownAt) {
        try {
          const head = await fetch(FINPLAN_URL, { credentials: "include" });
          if (head.ok) {
            const headBody = (await head.json().catch(() => null)) as
              | FinplanApiResponse
              | null;
            const serverAt = headBody?.updatedAt ?? null;
            if (serverAt && serverAt !== knownAt) {
              setError(new Error("Conflict: another client has modified the data; please reload"));
              // Aggiorna la cache con la versione canonica del server
              // così la UI può mostrare il banner di conflitto e il
              // consumer decidere come fare merge.
              if (headBody) {
                queryClient.setQueryData<FinplanApiResponse>(
                  [...FINPLAN_QUERY_KEY, orgId],
                  headBody,
                );
              } else {
                void queryClient.invalidateQueries({ queryKey: [...FINPLAN_QUERY_KEY, orgId] });
              }
              // NON consumiamo il pending: il consumer può fare merge e
              // ri-chiamare `scheduleSave`/`flush` se decide di prevalere.
              // Per evitare che la while loop ricicli all'infinito, riponiamo
              // il pending qui:
              pendingRef.current = snapshot;
              return;
            }
          }
          // Se il preflight fallisce (rete/401), procediamo comunque col
          // PUT — meglio salvare che bloccare l'utente. Conflitti reali
          // saranno comunque visibili dal prossimo refetch.
        } catch {
          // ignore — proseguiamo
        }
      }

      const res = await fetch(FINPLAN_URL, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data: snapshot }),
      });
      if (!res.ok) {
        setError(new Error(`PUT /api/finplan failed: ${res.status}`));
        return;
      }
      const body = (await res.json().catch(() => null)) as
        | { ok?: boolean; updatedAt?: string }
        | null;
      if (body?.updatedAt) {
        const newUpdatedAt = body.updatedAt;
        setLastSavedAt(newUpdatedAt);
        lastKnownRemoteAtRef.current = newUpdatedAt;
        // Aggiorna in cache `updatedAt` + data senza un GET extra.
        queryClient.setQueryData<FinplanApiResponse>(
          [...FINPLAN_QUERY_KEY, orgId],
          (prev) =>
            prev
              ? { ...prev, data: snapshot, updatedAt: newUpdatedAt }
              : { data: snapshot, updatedAt: newUpdatedAt, updatedBy: null },
        );
      }
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e : new Error(String(e)));
    } finally {
      setIsSaving(false);
    }
  }, [orgId, queryClient]);

  const triggerFlush = useCallback(() => {
    if (!pendingRef.current) return;
    if (inflightRef.current) {
      // Il PUT in volo prenderà `_pending` quando finisce.
      return;
    }
    const conflictGuard = { triggered: false };
    const p = (async () => {
      try {
        while (pendingRef.current && !conflictGuard.triggered) {
          const next = pendingRef.current;
          pendingRef.current = null;
          const beforeKnown = lastKnownRemoteAtRef.current;
          await doPut(next);
          // Se doPut ha rimesso il pending senza avanzare lastKnown
          // → conflitto: fermiamo il loop per non riprovare in tight-loop.
          if (
            pendingRef.current === next &&
            lastKnownRemoteAtRef.current === beforeKnown
          ) {
            conflictGuard.triggered = true;
          }
        }
      } finally {
        inflightRef.current = null;
      }
    })();
    inflightRef.current = p;
  }, [doPut]);

  const scheduleSave = useCallback((snapshot: FinplanSnapshot) => {
    if (!orgId) return;
    // CRITICO: salviamo lo snapshot in `pendingRef` IMMEDIATAMENTE.
    // Se l'utente fa flush() o si naviga via prima che scattino i 3s,
    // l'ultima versione è comunque recuperabile.
    pendingRef.current = snapshot;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null;
      triggerFlush();
    }, PUT_DEBOUNCE_MS);
  }, [orgId, triggerFlush]);

  const flush = useCallback(async () => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    if (pendingRef.current) triggerFlush();
    if (inflightRef.current) await inflightRef.current;
  }, [triggerFlush]);

  // Flush finale all'unmount (best effort, non blocca la navigazione).
  useEffect(() => {
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
      if (pendingRef.current) {
        // Lasciamo partire la promise, non possiamo `await` in cleanup.
        triggerFlush();
      }
    };
  }, [triggerFlush]);

  return {
    scheduleSave,
    flush,
    isSaving,
    lastSavedAt,
    error,
  };
}
