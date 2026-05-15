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
  snapshot: FinplanSnapshot | null;
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

  const snapshot = useMemo<FinplanSnapshot | null>(() => {
    const data = query.data?.data;
    if (!data || typeof data !== "object" || Array.isArray(data)) return null;
    if (Object.keys(data).length === 0) return null;
    // Validazione runtime al boundary di lettura: usiamo `safeParse` per
    // non far crashare la UI se il blob salvato dall'iframe legacy ha
    // shape inattesa (gli schemi sono volutamente `.passthrough()` e
    // permissivi). In caso di parse fallito, ritorniamo comunque il
    // payload originale castato — meglio dati ad-hoc che pagina rotta —
    // ma tracciamo il problema in console per follow-up.
    const parsed = FinplanSnapshotSchema.safeParse(data);
    if (parsed.success) return parsed.data;
    // eslint-disable-next-line no-console
    console.warn("[useFinplanData] snapshot non conforme allo schema:", parsed.error.issues.slice(0, 3));
    return data as FinplanSnapshot;
  }, [query.data]);

  return {
    snapshot,
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
   * Ultimo errore di sync (es. 409 in caso di conflitto). Resettato
   * dopo una scrittura andata a buon fine.
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
 *    `pendingRef` immediatamente al call di `scheduleSave`, così sia
 *    `flush()` sia il cleanup di unmount possono sempre recuperarlo —
 *    anche se il timer di debounce non è ancora scattato. Se un nuovo
 *    snapshot arriva mentre un PUT è in volo, sostituisce quello in
 *    coda e viene flushato alla chiusura del PUT corrente;
 *  - **conflict guard client-side**: prima di ogni PUT confrontiamo
 *    l'`updatedAt` della cache TanStack-Query (ultima verità nota dal
 *    server) con `lastKnownRemoteAtRef` (l'updatedAt da cui l'utente è
 *    partito o l'ultimo PUT andato a buon fine). Se sono diversi un
 *    altro client ha scritto nel frattempo: settiamo `error`, NON
 *    sovrascriviamo (per non clobberare modifiche altrui), invalidiamo
 *    la GET così la UI mostra il banner di conflitto e mantiene il
 *    `pendingRef` perché il consumer possa decidere se forzare il
 *    flush dopo merge. Il backend resta latest-wins (compatibilità con
 *    l'iframe legacy che condivide lo stesso `finplan_data`).
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
      // Conflict guard: se la cache ha un updatedAt più recente del
      // nostro punto di partenza, qualcuno ha scritto nel frattempo.
      const cached = queryClient.getQueryData<FinplanApiResponse>([
        ...FINPLAN_QUERY_KEY,
        orgId,
      ]);
      const cachedAt = cached?.updatedAt ?? null;
      const knownAt = lastKnownRemoteAtRef.current;
      if (cachedAt && knownAt && cachedAt !== knownAt) {
        setError(new Error("Conflict: another client has modified the data; please reload"));
        // Forza un refetch così il consumer vede la versione canonica.
        void queryClient.invalidateQueries({ queryKey: [...FINPLAN_QUERY_KEY, orgId] });
        // NON consumiamo il pending: il consumer può fare merge e
        // ri-chiamare `scheduleSave`/`flush` se decide di prevalere.
        return;
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
    const p = (async () => {
      try {
        while (pendingRef.current) {
          const next = pendingRef.current;
          pendingRef.current = null;
          await doPut(next);
          // Se il guard ha settato error e ha rimesso pending a null,
          // usciamo per lasciare al consumer la decisione successiva.
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
