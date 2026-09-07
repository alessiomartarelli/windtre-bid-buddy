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
//    admin (bisuite_sync_notifications, status cj_drms_outcome) a fine run.
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

export type DrmsOutcomeRunnerDeps<S extends DrmsApplySummaryLike> = {
  run: (orgId: string) => Promise<S>;
  notify: (n: { organizationId: string; status: string; errorMessage: string }) => Promise<unknown>;
  log?: (msg: string) => void;
  errorLog?: (msg: string, err: unknown) => void;
  now?: () => number;
};

export function createDrmsOutcomeRunner<S extends DrmsApplySummaryLike>(deps: DrmsOutcomeRunnerDeps<S>) {
  const log = deps.log ?? ((m) => console.log(m));
  const errorLog = deps.errorLog ?? ((m, e) => console.error(m, e));
  const now = deps.now ?? (() => Date.now());
  const states = new Map<string, OrgState<S>>();
  let seq = 0;

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
    const p = deps.run(orgId);
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

  return { apply, isRunning };
}
