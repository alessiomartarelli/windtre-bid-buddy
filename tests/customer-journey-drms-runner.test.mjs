// Runner asincrono di "Esita da DRMS" (server/cjDrmsOutcomeRunner.ts):
//  - un solo run per org alla volta, richieste concorrenti coalizzate;
//  - attesa inline: risultato subito se pronto, altrimenti { pending: true }
//    e riepilogo consegnato come notifica cj_drms_outcome (una sola);
//  - errori: propagati se entro l'attesa, in notifica se oltre.
// Puro (nessun DB): il modulo TS viene caricato via loader `tsx`.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { createDrmsOutcomeRunner } = await import('../server/cjDrmsOutcomeRunner.ts');
const { CJ_DRMS_OUTCOME_NOTIFICATION_STATUS, formatDrmsApplySummary } = await import('../shared/customerJourneyDrms.ts');

const summary = (over = {}) => ({
  items: 4, matched: 3, notFound: 1, ambiguous: 0,
  byState: { pagato: 2, annullato: 1, stornato: 0, riaccreditato: 0 },
  notFoundByDriver: { telefono: 1 }, legacyUploads: [], updated: 3, mismatches: 1, uploads: 2, drmsRows: 50,
  ...over,
});

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};
const tick = () => new Promise((r) => setTimeout(r, 0));

function harness() {
  const runs = [];
  const notifications = [];
  const logs = [];
  const runner = createDrmsOutcomeRunner({
    run: (orgId) => { const d = deferred(); runs.push({ orgId, ...d }); return d.promise; },
    notify: async (n) => { notifications.push(n); },
    log: (m) => logs.push(m),
    errorLog: (m) => logs.push(m),
  });
  return { runner, runs, notifications, logs };
}

test('risultato pronto entro l\'attesa ⇒ summary inline, nessuna notifica', async () => {
  const h = harness();
  const p = h.runner.apply('org-a', { reason: 'test', inlineWaitMs: 1000 });
  await tick();
  assert.equal(h.runs.length, 1);
  h.runs[0].resolve(summary());
  const r = await p;
  assert.equal(r.pending, false);
  assert.equal(r.summary.matched, 3);
  await tick();
  assert.equal(h.notifications.length, 0);
  assert.equal(h.runner.isRunning('org-a'), false);
});

test('oltre l\'attesa ⇒ pending + UNA notifica con riepilogo; richieste concorrenti coalizzate in un solo run successivo', async () => {
  const h = harness();
  const p1 = h.runner.apply('org-b', { reason: 'upload', inlineWaitMs: 5 });
  await tick();
  assert.equal(h.runs.length, 1, 'primo run partito');
  // Due richieste mentre il primo run è in corso: un solo run successivo.
  const p2 = h.runner.apply('org-b', { reason: 'delete', inlineWaitMs: 5 });
  const p3 = h.runner.apply('org-b', { reason: 'esita', inlineWaitMs: 5 });
  // Org diversa: gira in parallelo, indipendente.
  const pOther = h.runner.apply('org-c', { reason: 'altro', inlineWaitMs: 5 });
  await tick();
  assert.equal(h.runs.length, 2, 'org-c parte subito, org-b non raddoppia');
  assert.deepEqual(h.runs.map((r) => r.orgId), ['org-b', 'org-c']);

  const [r1, r2, r3, rOther] = await Promise.all([p1, p2, p3, pOther]);
  assert.deepEqual([r1, r2, r3, rOther], [{ pending: true }, { pending: true }, { pending: true }, { pending: true }]);
  assert.equal(h.runs.length, 2, 'il run coalizzato NON parte finché il primo non finisce');

  h.runs[0].resolve(summary({ drmsRows: 50_000 }));
  await tick(); await tick();
  assert.equal(h.notifications.length, 1, 'una notifica per il primo run');
  assert.equal(h.notifications[0].organizationId, 'org-b');
  assert.equal(h.notifications[0].status, CJ_DRMS_OUTCOME_NOTIFICATION_STATUS);
  assert.match(h.notifications[0].errorMessage, /completato/);
  assert.match(h.notifications[0].errorMessage, /3\/4 contratti esitati/);
  assert.match(h.notifications[0].errorMessage, /50000 righe DRMS di 2 upload/);
  assert.equal(h.runs.length, 3, 'run coalizzato partito dopo il primo');
  assert.equal(h.runs[2].orgId, 'org-b');
  assert.equal(h.runner.isRunning('org-b'), true);

  h.runs[2].resolve(summary({ matched: 4, notFound: 0, notFoundByDriver: {} }));
  await tick(); await tick();
  assert.equal(h.notifications.length, 2, 'UNA sola notifica anche per due richieste coalizzate');
  assert.match(h.notifications[1].errorMessage, /4\/4 contratti esitati/);
  assert.equal(h.runner.isRunning('org-b'), false);

  h.runs[1].resolve(summary({ uploads: 0, drmsRows: 0, matched: 0 }));
  await tick(); await tick();
  assert.equal(h.notifications.length, 3);
  assert.equal(h.notifications[2].organizationId, 'org-c');
  assert.match(h.notifications[2].errorMessage, /Nessun DRMS caricato/);
});

test('errore entro l\'attesa ⇒ propagato; errore oltre l\'attesa ⇒ notifica "fallito"', async () => {
  const h = harness();
  const p = h.runner.apply('org-d', { reason: 'test', inlineWaitMs: 1000 });
  await tick();
  h.runs[0].reject(new Error('boom'));
  await assert.rejects(p, /boom/);
  await tick();
  assert.equal(h.notifications.length, 0);
  assert.equal(h.runner.isRunning('org-d'), false, 'lo stato viene liberato anche dopo un errore');

  const p2 = h.runner.apply('org-d', { reason: 'test2', inlineWaitMs: 5 });
  await tick();
  assert.equal(h.runs.length, 2);
  assert.deepEqual(await p2, { pending: true });
  h.runs[1].reject(new Error('timeout db'));
  await tick(); await tick();
  assert.equal(h.notifications.length, 1);
  assert.match(h.notifications[0].errorMessage, /fallito .*timeout db/);
  assert.equal(h.runner.isRunning('org-d'), false);
});

test('formatDrmsApplySummary elenca upload legacy e durata', () => {
  const txt = formatDrmsApplySummary(summary({ legacyUploads: [{ period: 'GIU-26', fileName: 'a.xlsx' }] }), { durationMs: 91_500 });
  assert.match(txt, /1 upload senza campi di esito da ricaricare: GIU-26 a\.xlsx/);
  assert.match(txt, /Durata 91\.5s/);
  assert.match(txt, /1 incongruenze con stato manuale, 3 contratti aggiornati/);
});
