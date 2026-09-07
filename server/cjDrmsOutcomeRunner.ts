// Esecuzione asincrona e serializzata per org di "Esita da DRMS"
// (storage.applyDrmsOutcomes). Motivazione: su decine di migliaia di righe
// il ricalcolo può durare minuti e non deve tenere appesa la richiesta HTTP
// (timeout nginx/pm2) né girare due volte in parallelo per la stessa org
// (upload + delete ravvicinati).
//
// Semantica:
//  - una sola esecuzione per org alla volta; le richieste arrivate durante
//    un run vengono COALIZZATE in un unico run successivo (il ricalcolo è
//    idempotente e legge sempre tutti gli upload, quindi l'ultimo vince);
//  - il chiamante attende al massimo `inlineWaitMs`: se il risultato è
//    pronto lo riceve subito (org piccole, test), altrimenti ottiene
//    `{ pending: true }` e il riepilogo viene consegnato come notifica
//    admin (bisuite_sync_notifications, status cj_drms_outcome) a fine run;
//  - (Task #581) lo stato "in corso" è anche PERSISTITO tramite `deps.persist`
//    (marker per org, cj_drms_outcome_runs): scritto prima di avviare il
//    primo run dell'org, rimosso quando l'org non ha più run né coda. Se il
//    processo viene riavviato a metà run, `recoverInterrupted()` al boot
//    trova i marker orfani, avvisa gli admin (notifica cj_drms_outcome) e
//    rilancia il ricalcolo, il cui esito arriva in notifica come per un run
//    andato oltre l'attesa inline. Il marker persistito è ciò che tiene
//    `outcomeRunning=true` per il client attraverso il riavvio.
import {
  CJ_DRMS_APPLY_INLINE_WAIT_MS,
  CJ_DRMS_OUTCOME_NOTIFICATION_STATUS,
  formatDrmsApplySummary,
  type DrmsApplySummaryLike,
} from "../shared/customerJourneyDrms";

export type DrmsApplyResult<S> = { pending: false; summary: S } | { pending: true };

type RunToken = { readonly id: number };

type OrgState<S> = {
  current: Promise<S>;
  currentToken: RunToken;
  // Run successivo già promesso (coalizza tutte le richieste in coda).
  next: Promise<S> | null;
  nextToken: RunToken | null;
  // true se almeno un chiamante del run ha ricevuto `pending` e aspetta la
  // notifica.
  notifyCurrent: boolean;
  notifyNext: boolean;
};

export type DrmsOutcomeRunPersistence = {
  /** Scrive/aggiorna il marker "in corso" per l'org (idempotente). */
  start: (orgId: string, reason: string) => Promise<unknown>;
  /** Rimuove il marker per l'org. */
  end: (orgId: string) => Promise<unknown>;
  /** Elenca i marker presenti (al boot = run interrotti da un riavvio). */
  list: () => Promise<Array<{ organizationId: string; reason: string; startedAt: Date | string | null }>>;
};

export type DrmsOutcomeRunnerDeps<S extends DrmsApplySummaryLike> = {
  run: (orgId: string) => Promise<S>;
  notify: (n: { organizationId: string; status: string; errorMessage: string }) => Promise<unknown>;
  /** Opzionale: senza persistenza il runner è solo in memoria (test puri). */
  persist?: DrmsOutcomeRunPersistence;
  log?: (msg: string) => void;
  errorLog?: (msg: string, err: unknown) => void;
  now?: () => number;
  /** Attesa fra i tentativi di persistenza (test: iniettare un no-op). */
  sleep?: (ms: number) => Promise<void>;
};

export function createDrmsOutcomeRunner<S extends DrmsApplySummaryLike>(deps: DrmsOutcomeRunnerDeps<S>) {
  const log = deps.log ?? ((m) => console.log(m));
  const errorLog = deps.errorLog ?? ((m, e) => console.error(m, e));
  const now = deps.now ?? (() => Date.now());
  const states = new Map<string, OrgState<S>>();
  let seq = 0;
  // Catena per org delle operazioni di persistenza (start/end): garantisce
  // che il DELETE di un run concluso non possa "sorpassare" l'UPSERT del run
  // successivo partito subito dopo (query DB indipendenti, ordine di commit
  // non garantito) e cancellare il marker di un run in corso.
  const persistChains = new Map<string, Promise<unknown>>();
  function chainPersist<T>(orgId: string, op: () => Promise<T>): Promise<T> {
    const prev = persistChains.get(orgId) ?? Promise.resolve();
    const next = prev.then(op, op);
    const settled = next.then(() => undefined, () => undefined);
    persistChains.set(orgId, settled);
    void settled.then(() => { if (persistChains.get(orgId) === settled) persistChains.delete(orgId); });
    return next;
  }
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  // Tentativi con backoff esponenziale (base × 2^n) per le operazioni di
  // persistenza: start (bloccante), end e list al boot (auto-riparanti).
  async function withRetry<T>(label: string, attempts: number, baseMs: number, op: () => Promise<T>): Promise<T> {
    let lastErr: unknown;
    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        return await op();
      } catch (e) {
        lastErr = e;
        errorLog(`[cj] ${label} (tentativo ${attempt}/${attempts}):`, e);
        if (attempt < attempts) await sleep(baseMs * 2 ** (attempt - 1));
      }
    }
    throw lastErr;
  }
  const PERSIST_START_ATTEMPTS = 3;
  const PERSIST_END_ATTEMPTS = 6;     // 200ms … 6.4s ≈ 12s complessivi
  const RECOVER_LIST_ATTEMPTS = 6;    // 1s … 32s ≈ 1 min complessivo
  const PERSIST_RETRY_MS = 200;
  async function persistStart(orgId: string, reason: string): Promise<void> {
    try {
      await withRetry(`marker "esito DRMS in corso" org=${orgId} non scritto`, PERSIST_START_ATTEMPTS, PERSIST_RETRY_MS, () => deps.persist!.start(orgId, reason));
    } catch (lastErr) {
      throw new Error(`Impossibile registrare lo stato "esito DRMS in corso" (${lastErr instanceof Error ? lastErr.message : String(lastErr)}): ricalcolo non avviato`);
    }
  }
  // Rimozione del marker: ritentata con backoff. Se anche l'ultimo tentativo
  // fallisce il marker resta (outcomeRunning=true) finché un nuovo run o il
  // prossimo boot lo riconciliano: il boot lo tratterebbe come interrotto e
  // ripeterebbe un ricalcolo idempotente, mai perde dati.
  function persistEnd(orgId: string): Promise<void> {
    return withRetry(`marker "esito DRMS in corso" org=${orgId} non rimosso`, PERSIST_END_ATTEMPTS, PERSIST_RETRY_MS, () => deps.persist!.end(orgId))
      .then(() => undefined)
      .catch((e) => errorLog(`[cj] marker "esito DRMS in corso" org=${orgId} NON rimosso dopo ${PERSIST_END_ATTEMPTS} tentativi: verrà riconciliato al prossimo run/boot:`, e));
  }

  async function deliver(orgId: string, reason: string, outcome: { summary: S; durationMs: number } | { error: unknown }) {
    const text = "error" in outcome
      ? `Esito da DRMS fallito (${reason}): ${outcome.error instanceof Error ? outcome.error.message : String(outcome.error)}`
      : `Esito da DRMS completato (${reason}). ${formatDrmsApplySummary(outcome.summary, { durationMs: outcome.durationMs })}`;
    try {
      await deps.notify({ organizationId: orgId, status: CJ_DRMS_OUTCOME_NOTIFICATION_STATUS, errorMessage: text });
    } catch (e) {
      errorLog(`[cj] notifica esito DRMS org=${orgId} non creata:`, e);
    }
  }

  function startRun(orgId: string, reason: string, token: RunToken): Promise<S> {
    const started = now();
    log(`[cj] esito DRMS org=${orgId} avviato (${reason})`);
    // Il marker persistito DEVE essere scritto prima del run vero e proprio:
    // se il processo muore nel frattempo il boot successivo lo ritrova. Se la
    // scrittura fallisce (dopo retry) il run NON parte e l'errore segue il
    // percorso normale (propagato al chiamante o in notifica): mai un run
    // "scoperto" che un riavvio perderebbe in silenzio.
    const persisted = deps.persist
      ? chainPersist(orgId, () => persistStart(orgId, reason))
      : Promise.resolve();
    const p = persisted.then(() => deps.run(orgId));
    // Ciclo di vita: alla fine del run promuovi l'eventuale run coalizzato.
    p.then(
      (summary) => {
        const durationMs = now() - started;
        log(`[cj] esito DRMS org=${orgId} completato in ${durationMs}ms (${reason})`);
        const st = states.get(orgId);
        if (st?.notifyCurrent) void deliver(orgId, reason, { summary, durationMs });
        finish(orgId, token);
      },
      (error) => {
        errorLog(`[cj] esito DRMS org=${orgId} fallito (${reason}):`, error);
        const st = states.get(orgId);
        if (st?.notifyCurrent) void deliver(orgId, reason, { error });
        finish(orgId, token);
      },
    );
    return p;
  }

  function finish(orgId: string, done: RunToken) {
    const st = states.get(orgId);
    if (!st || st.currentToken !== done) return;
    if (st.next && st.nextToken) {
      st.current = st.next;
      st.currentToken = st.nextToken;
      st.next = null;
      st.nextToken = null;
      st.notifyCurrent = st.notifyNext;
      st.notifyNext = false;
    } else {
      states.delete(orgId);
      if (deps.persist) {
        // In catena con gli start: un nuovo run partito subito dopo scrive il
        // suo marker solo DOPO questa cancellazione.
        void chainPersist(orgId, () => persistEnd(orgId));
      }
    }
  }

  /** Accoda (o coalizza) un run per l'org e restituisce la promise del run che servirà la richiesta. */
  function enqueue(orgId: string, reason: string): { promise: Promise<S>; markPending: () => void } {
    let mine: Promise<S>;
    const st = states.get(orgId);
    if (!st) {
      const token: RunToken = { id: ++seq };
      mine = startRun(orgId, reason, token);
      states.set(orgId, { current: mine, currentToken: token, next: null, nextToken: null, notifyCurrent: false, notifyNext: false });
    } else {
      if (!st.next) {
        log(`[cj] esito DRMS org=${orgId}: run in corso, richiesta (${reason}) coalizzata nel run successivo`);
        // Parte SOLO dopo il run corrente (esito o errore), una volta per
        // tutte le richieste coalizzate.
        const token: RunToken = { id: ++seq };
        st.nextToken = token;
        st.next = st.current.then(() => undefined, () => undefined).then(() => startRun(orgId, `${reason}, coalizzato`, token));
      }
      mine = st.next;
    }
    return {
      promise: mine,
      markPending: () => {
        const cur = states.get(orgId);
        if (!cur) return;
        if (cur.current === mine) cur.notifyCurrent = true;
        else if (cur.next === mine) cur.notifyNext = true;
      },
    };
  }

  /**
   * Avvia (o coalizza) il ricalcolo per l'org e attende al massimo
   * `inlineWaitMs`. Se il run fallisce entro l'attesa l'errore viene
   * propagato al chiamante; oltre l'attesa esito ed errori vanno in notifica.
   */
  async function apply(orgId: string, opts: { reason: string; inlineWaitMs?: number }): Promise<DrmsApplyResult<S>> {
    const waitMs = opts.inlineWaitMs ?? CJ_DRMS_APPLY_INLINE_WAIT_MS;
    const { promise, markPending } = enqueue(orgId, opts.reason);
    // Evita unhandled rejection sui chiamanti che hanno smesso di aspettare.
    promise.catch(() => undefined);
    let timer: ReturnType<typeof setTimeout> | null = null;
    const timeout = new Promise<"timeout">((resolve) => { timer = setTimeout(() => resolve("timeout"), waitMs); });
    try {
      const r = await Promise.race([promise.then((summary) => ({ summary })), timeout]);
      if (r === "timeout") {
        markPending();
        log(`[cj] esito DRMS org=${orgId}: non pronto entro ${waitMs}ms (${opts.reason}) → risposta 202, esito in notifica`);
        return { pending: true };
      }
      return { pending: false, summary: r.summary };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  function isRunning(orgId: string): boolean {
    return states.has(orgId);
  }

  /**
   * Stato "in corso" per l'org: in memoria OPPURE marker persistito (run
   * interrotto da un riavvio non ancora ripreso, o ripresa in un altro
   * processo). Senza persistenza coincide con `isRunning`.
   */
  async function isRunningOrPersisted(orgId: string): Promise<boolean> {
    if (states.has(orgId)) return true;
    if (!deps.persist) return false;
    try {
      const rows = await deps.persist.list();
      return rows.some((r) => r.organizationId === orgId);
    } catch (e) {
      errorLog(`[cj] lettura marker "esito DRMS in corso" org=${orgId} fallita:`, e);
      return false;
    }
  }

  /**
   * Da chiamare UNA volta al boot: ogni marker persistito appartiene a un run
   * che il processo precedente non ha concluso. Per ciascuna org: notifica
   * agli admin che il ricalcolo è stato interrotto dal riavvio e viene
   * ripetuto, poi rilancio con esito in notifica (nessun chiamante inline).
   * Restituisce le org riprese.
   */
  async function recoverInterrupted(): Promise<string[]> {
    if (!deps.persist) return [];
    let rows: Awaited<ReturnType<DrmsOutcomeRunPersistence["list"]>>;
    try {
      // DB magari non ancora raggiungibile al boot: backoff fino a ~1 min.
      rows = await withRetry("ripresa esiti DRMS interrotti: lettura marker fallita", RECOVER_LIST_ATTEMPTS, 1000, () => deps.persist!.list());
    } catch (e) {
      errorLog(`[cj] ripresa esiti DRMS interrotti abbandonata dopo ${RECOVER_LIST_ATTEMPTS} tentativi:`, e);
      return [];
    }
    const resumed: string[] = [];
    for (const row of rows) {
      const orgId = row.organizationId;
      if (states.has(orgId)) continue; // già ripartito in questo processo
      const startedAt = row.startedAt ? new Date(row.startedAt) : null;
      const startedTxt = startedAt && !Number.isNaN(startedAt.getTime())
        ? ` avviato il ${startedAt.toLocaleString("it-IT", { timeZone: "Europe/Rome" })}`
        : "";
      log(`[cj] esito DRMS org=${orgId} interrotto da un riavvio del server (${row.reason}${startedTxt}) → ripresa automatica`);
      try {
        await deps.notify({
          organizationId: orgId,
          status: CJ_DRMS_OUTCOME_NOTIFICATION_STATUS,
          errorMessage: `Esito da DRMS interrotto da un riavvio del server (${row.reason}${startedTxt}): il ricalcolo viene ripetuto automaticamente, l'esito arriverà in una nuova notifica.`,
        });
      } catch (e) {
        errorLog(`[cj] notifica interruzione esito DRMS org=${orgId} non creata:`, e);
      }
      const { promise, markPending } = enqueue(orgId, `ripresa dopo riavvio: ${row.reason}`);
      promise.catch(() => undefined);
      markPending();
      resumed.push(orgId);
    }
    return resumed;
  }

  return { apply, isRunning, isRunningOrPersisted, recoverInterrupted };
}
