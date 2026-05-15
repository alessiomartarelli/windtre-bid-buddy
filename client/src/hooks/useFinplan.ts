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
   * Alias di `snapshot` allineato al contratto del task (#142): `data`
   * è il payload RAW restituito dal server, solo type-castato.
   * Volutamente non normalizzato così è byte-compatibile con quanto
   * scritto dall'iframe legacy.
   */
  data: FinplanSnapshot | null;
  /** Alias di `data` mantenuto per backward-compat con i consumer interni. */
  snapshot: FinplanSnapshot | null;
  /** Risultato di un parse Zod permissivo, utile per validare in UI sezioni
   *  derivate. Non sostituisce `data`/`snapshot` (sempre raw). */
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
    data: snapshot,
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

export type FinplanUpdater = (prev: FinplanSnapshot | null) => FinplanSnapshot;

export interface UseFinplanMutationResult {
  /**
   * Programma una scrittura del nuovo snapshot. Debounced 3s. Se chiamata
   * più volte entro la finestra, l'ULTIMO valore vince (latest-wins).
   * Mentre un PUT è in volo, eventuali nuove chiamate vengono accodate
   * come `_pending` e flushate al termine.
   *
   * Accetta anche un updater function `(prev) => next`, dove `prev` è
   * l'ultima versione pendente (se esiste) altrimenti la cache TanStack-
   * Query corrente. CRITICO per evitare clobber: edit rapidi (es. toggle
   * checkbox multipli) DEVONO usare l'updater, altrimenti la seconda
   * scrittura partirebbe da uno snapshot stale e perderebbe la prima.
   */
  scheduleSave: (snapshotOrUpdater: FinplanSnapshot | FinplanUpdater) => void;
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
 * Hook di scrittura per `/api/finplan`. Specchio dello shim dell'iframe
 * (`client/public/finplan/index.html`):
 *  - debounce 3s su `scheduleSave`;
 *  - latest-wins: `pendingRef` settato IMMEDIATAMENTE così flush/unmount
 *    recuperano sempre l'ultima versione anche senza timer scattato;
 *  - conflict guard server-authoritative: preflight `GET /api/finplan`
 *    prima di ogni PUT, confronto contro `lastKnownRemoteAtRef`. Su
 *    mismatch: error + cache aggiornata + refetch + pending preservato
 *    per merge. Backend resta latest-wins (compat iframe legacy).
 *  - flush best-effort all'unmount.
 */
export function useFinplanMutation(orgId: string | undefined): UseFinplanMutationResult {
  const queryClient = useQueryClient();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inflightRef = useRef<Promise<void> | null>(null);
  const pendingRef = useRef<FinplanSnapshot | null>(null);
  // Snapshot attualmente in volo verso il server: serve agli updater di
  // `scheduleSave` per evitare clobber se l'utente edita durante un PUT
  // (la cache TanStack-Query è ancora stale finché doPut non risolve).
  const inflightSnapshotRef = useRef<FinplanSnapshot | null>(null);
  // Updatedat dell'ultima versione "nota" (initial GET o ultimo PUT
  // confermato). Usato per il conflict guard prima di ogni PUT.
  const lastKnownRemoteAtRef = useRef<string | null>(null);

  const [isSaving, setIsSaving] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const [error, setError] = useState<Error | null>(null);

  // Mantiene `lastKnownRemoteAtRef` REATTIVO rispetto alla cache:
  // ci subscriviamo al cache di TanStack-Query, così se la GET completa
  // dopo il mount (caso normale, cache vuota all'apertura della pagina)
  // o se un refetch porta una versione più recente, il baseline si
  // aggiorna senza che l'utente debba scrivere prima. Il baseline NON
  // viene mai sovrascritto a `null`: una volta nota la versione, non la
  // perdiamo se il server tornasse a 204 (caso patologico).
  useEffect(() => {
    if (!orgId) return;
    const key = [...FINPLAN_QUERY_KEY, orgId];
    const sync = () => {
      const cached = queryClient.getQueryData<FinplanApiResponse>(key);
      const cachedAt = cached?.updatedAt ?? null;
      if (!cachedAt) return;
      const known = lastKnownRemoteAtRef.current;
      // Avanza il baseline anche quando un refetch/setQueryData porta
      // una versione più recente (non solo al primo bootstrap). Evita
      // un conflict cycle "spurio" dopo refetch in background quando la
      // pagina era inattiva. Confronto lessicografico ISO-8601 = ordine
      // temporale.
      if (known === null || cachedAt > known) {
        lastKnownRemoteAtRef.current = cachedAt;
      }
    };
    sync();
    const unsub = queryClient.getQueryCache().subscribe((event) => {
      if (event.query.queryHash === JSON.stringify(key)) sync();
    });
    return () => unsub();
  }, [orgId, queryClient]);

  const doPut = useCallback(async (snapshot: FinplanSnapshot): Promise<void> => {
    if (!orgId) return;
    setIsSaving(true);
    try {
      // CONFLICT GUARD AUTORITATIVO: preflight GET dal server per leggere
      // l'updatedAt corrente. SEMPRE eseguito (anche se baseline è null:
      // potrebbe esserci dato sul server che non abbiamo mai caricato e
      // staremmo per clobberare). NON ci affidiamo alla cache TanStack-
      // Query (staleTime 60s + niente refetchOnWindowFocus → stale).
      const knownAt = lastKnownRemoteAtRef.current;
      try {
        const head = await fetch(FINPLAN_URL, { credentials: "include" });
        if (head.ok) {
          const headBody = (await head.json().catch(() => null)) as
            | FinplanApiResponse
            | null;
          const serverAt = headBody?.updatedAt ?? null;
          // Caso 1: baseline noto e diverso dal server → conflict.
          // Caso 2: baseline null ma il server ha updatedAt → stiamo per
          // clobberare dato esistente che non abbiamo mai caricato →
          // conflict.
          const isConflict =
            (knownAt && serverAt && serverAt !== knownAt) ||
            (!knownAt && serverAt);
          if (isConflict) {
            setError(new Error("Conflict: another client has modified the data; please reload"));
            // Aggiorna la cache + force refetch così la UI vede la
            // versione canonica e i consumer possono fare merge.
            if (headBody) {
              queryClient.setQueryData<FinplanApiResponse>(
                [...FINPLAN_QUERY_KEY, orgId],
                headBody,
              );
            }
            void queryClient.invalidateQueries({
              queryKey: [...FINPLAN_QUERY_KEY, orgId],
              refetchType: "active",
            });
            // Adottiamo serverAt come nuovo baseline così, dopo un
            // merge/reload del consumer, la prossima scrittura passa
            // direttamente.
            if (serverAt) lastKnownRemoteAtRef.current = serverAt;
            // Riponiamo il pending: il consumer può fare merge e
            // ri-chiamare `scheduleSave`/`flush` se decide di prevalere.
            pendingRef.current = snapshot;
            return;
          }
          // Nessun conflitto: se baseline era null (genuinely fresh —
          // né noi né il server hanno una versione), inizializziamo a
          // serverAt (può essere null). Se diventa null restiamo coerenti
          // perché sotto, dopo il PUT, lastKnown viene comunque aggiornato.
          if (!knownAt && serverAt) lastKnownRemoteAtRef.current = serverAt;
        }
        // Se il preflight fallisce (rete/401), procediamo comunque col
        // PUT — meglio salvare che bloccare l'utente. Conflitti reali
        // saranno comunque visibili dal prossimo refetch.
      } catch {
        // ignore — proseguiamo
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
          inflightSnapshotRef.current = next;
          const beforeKnown = lastKnownRemoteAtRef.current;
          try {
            await doPut(next);
          } finally {
            inflightSnapshotRef.current = null;
          }
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

  const scheduleSave = useCallback((snapshotOrUpdater: FinplanSnapshot | FinplanUpdater) => {
    if (!orgId) return;
    // Risolvi `prev` per gli updater: priorità a `pendingRef` (catena di
    // edit non ancora flushati), fallback alla cache TanStack-Query.
    let next: FinplanSnapshot;
    if (typeof snapshotOrUpdater === "function") {
      // Ordine di priorità: pending non ancora flushato → snapshot in volo
      // verso il server → cache TanStack-Query (potenzialmente stale durante
      // il PUT). Così edit concorrenti non perdono modifiche già inviate.
      const prev =
        pendingRef.current ??
        inflightSnapshotRef.current ??
        (queryClient.getQueryData<FinplanApiResponse>([...FINPLAN_QUERY_KEY, orgId])
          ?.data as FinplanSnapshot | undefined) ??
        null;
      next = (snapshotOrUpdater as FinplanUpdater)(
        prev && typeof prev === "object" && Object.keys(prev).length > 0 ? prev : null,
      );
    } else {
      next = snapshotOrUpdater;
    }
    // CRITICO: salviamo lo snapshot in `pendingRef` IMMEDIATAMENTE.
    // Se l'utente fa flush() o si naviga via prima che scattino i 3s,
    // l'ultima versione è comunque recuperabile.
    pendingRef.current = next;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null;
      triggerFlush();
    }, PUT_DEBOUNCE_MS);
  }, [orgId, triggerFlush, queryClient]);

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
