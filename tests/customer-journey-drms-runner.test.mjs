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

// ---------------------------------------------------------------------------
// Task #581: marker persistito "in corso" + ripresa al boot dopo un riavvio.
// ---------------------------------------------------------------------------
function persistentHarness(initialMarkers = []) {
  const markers = new Map(initialMarkers.map((m) => [m.organizationId, m]));
  const persistLog = [];
  const base = harness();
  const runner = createDrmsOutcomeRunner({
    run: (orgId) => { const d = deferred(); base.runs.push({ orgId, ...d }); return d.promise; },
    notify: async (n) => { base.notifications.push(n); },
    log: (m) => base.logs.push(m),
    errorLog: (m) => base.logs.push(m),
    persist: {
      start: async (organizationId, reason) => { persistLog.push(['start', organizationId]); markers.set(organizationId, { organizationId, reason, startedAt: new Date('2026-09-07T08:00:00Z') }); },
      end: async (organizationId) => { persistLog.push(['end', organizationId]); markers.delete(organizationId); },
      list: async () => [...markers.values()],
    },
  });
  return { ...base, runner, markers, persistLog };
}

test('persist: marker scritto PRIMA del run, rimosso solo quando org senza run né coda', async () => {
  const h = persistentHarness();
  const p1 = h.runner.apply('org-p', { reason: 'upload', inlineWaitMs: 5 });
  await tick();
  assert.deepEqual(h.persistLog, [['start', 'org-p']], 'marker scritto');
  assert.equal(h.runs.length, 1, 'run partito dopo il marker');
  assert.equal(h.markers.has('org-p'), true);
  assert.equal(await h.runner.isRunningOrPersisted('org-p'), true);

  const p2 = h.runner.apply('org-p', { reason: 'delete', inlineWaitMs: 5 });
  await Promise.all([p1, p2]);
  h.runs[0].resolve(summary());
  await tick(); await tick();
  assert.equal(h.runs.length, 2, 'run coalizzato partito');
  assert.equal(h.markers.has('org-p'), true, 'marker NON rimosso finché la coda non è vuota');
  h.runs[1].resolve(summary());
  await tick(); await tick();
  assert.equal(h.markers.has('org-p'), false, 'marker rimosso a coda vuota');
  assert.equal(h.runner.isRunning('org-p'), false);
  assert.equal(await h.runner.isRunningOrPersisted('org-p'), false);
});

test('persist: marker non scrivibile (dopo retry) ⇒ il run NON parte e l\'errore segue il percorso normale', async () => {
  const h = harness();
  let startCalls = 0;
  let runCalls = 0;
  const runner = createDrmsOutcomeRunner({
    run: async () => { runCalls++; return summary(); },
    notify: async (n) => { h.notifications.push(n); },
    log: (m) => h.logs.push(m),
    errorLog: (m) => h.logs.push(m),
    persist: { start: async () => { startCalls++; throw new Error('db down'); }, end: async () => {}, list: async () => [] },
  });
  await assert.rejects(
    runner.apply('org-e', { reason: 'test', inlineWaitMs: 5000 }),
    /Impossibile registrare lo stato "esito DRMS in corso".*db down/,
  );
  assert.equal(startCalls, 3, 'tre tentativi di scrittura');
  assert.equal(runCalls, 0, 'nessun run "scoperto" senza marker');
  assert.equal(runner.isRunning('org-e'), false);
  assert.equal(h.notifications.length, 0);
});

test('persist: scrittura marker transitoriamente fallita ⇒ retry, poi run', async () => {
  let startCalls = 0;
  const runner = createDrmsOutcomeRunner({
    run: async () => summary(),
    notify: async () => {},
    log: () => {}, errorLog: () => {},
    persist: { start: async () => { startCalls++; if (startCalls < 2) throw new Error('flaky'); }, end: async () => {}, list: async () => [] },
  });
  const r = await runner.apply('org-t', { reason: 'test', inlineWaitMs: 5000 });
  assert.equal(r.pending, false);
  assert.equal(startCalls, 2);
});

test('persist asincrona: il DELETE lento del run precedente non cancella il marker del run successivo', async () => {
  // Simula un DB in cui le query si completano in ordine arbitrario: la
  // cancellazione (end) del primo run resta "in volo" finché non la
  // rilasciamo a mano, mentre il secondo run parte subito dopo il primo.
  const markers = new Map();
  const ops = [];            // ordine di ESECUZIONE effettiva sul "DB"
  const pendingEnds = [];    // deferred da rilasciare
  const runs = [];
  const runner = createDrmsOutcomeRunner({
    run: (orgId) => { const d = deferred(); runs.push({ orgId, ...d }); return d.promise; },
    notify: async () => {},
    log: () => {}, errorLog: () => {},
    persist: {
      start: async (orgId, reason) => { ops.push('start'); markers.set(orgId, { organizationId: orgId, reason, startedAt: null }); },
      end: async (orgId) => { const d = deferred(); pendingEnds.push(d); await d.promise; ops.push('end'); markers.delete(orgId); },
      list: async () => [...markers.values()],
    },
  });
  const p1 = runner.apply('org-s', { reason: 'primo', inlineWaitMs: 5 });
  await tick();
  assert.equal(runs.length, 1);
  await p1;
  runs[0].resolve(summary());
  await tick(); await tick();
  assert.equal(runner.isRunning('org-s'), false, 'primo run concluso in memoria');
  assert.equal(pendingEnds.length, 1, 'DELETE del primo run in volo');

  // Secondo run parte SUBITO mentre il DELETE è ancora in volo.
  const p2 = runner.apply('org-s', { reason: 'secondo', inlineWaitMs: 5 });
  await tick(); await tick();
  assert.equal(runs.length, 1, 'il secondo run NON parte finché il DELETE precedente non è concluso (start in catena)');
  assert.equal(await runner.isRunningOrPersisted('org-s'), true, 'in memoria risulta comunque in corso');

  // Rilascio il DELETE: ora lo start del secondo run viene eseguito DOPO.
  pendingEnds[0].resolve();
  await tick(); await tick(); await tick();
  assert.deepEqual(ops, ['start', 'end', 'start'], 'ordine DB: start1, end1, start2');
  assert.equal(runs.length, 2, 'secondo run partito dopo il marker');
  assert.equal(markers.has('org-s'), true, 'il marker del secondo run è presente (non cancellato dal vecchio DELETE)');
  assert.equal(markers.get('org-s').reason, 'secondo');

  await p2;
  runs[1].resolve(summary());
  await tick(); await tick();
  assert.equal(pendingEnds.length, 2);
  pendingEnds[1].resolve();
  await tick(); await tick();
  assert.equal(markers.has('org-s'), false, 'marker rimosso solo dal DELETE del secondo run');
});

test('senza persistenza: isRunningOrPersisted coincide con isRunning e recoverInterrupted non fa nulla', async () => {
  const h = harness();
  assert.deepEqual(await h.runner.recoverInterrupted(), []);
  assert.equal(await h.runner.isRunningOrPersisted('org-x'), false);
  const p = h.runner.apply('org-x', { reason: 'test', inlineWaitMs: 5 });
  await tick();
  assert.equal(await h.runner.isRunningOrPersisted('org-x'), true);
  await p; h.runs[0].resolve(summary()); await tick();
});

test('marker orfano (riavvio) ⇒ outcomeRunning=true prima della ripresa; recoverInterrupted avvisa e rilancia con esito in notifica', async () => {
  const h = persistentHarness([
    { organizationId: 'org-r', reason: 'upload DRMS 2026-08', startedAt: new Date('2026-09-07T01:30:00Z') },
  ]);
  // Il processo è appena ripartito: niente in memoria, ma il marker c'è.
  assert.equal(h.runner.isRunning('org-r'), false);
  assert.equal(await h.runner.isRunningOrPersisted('org-r'), true, 'il client vede ancora "in corso"');

  const resumed = await h.runner.recoverInterrupted();
  assert.deepEqual(resumed, ['org-r']);
  await tick();
  assert.equal(h.notifications.length, 1, 'avviso di interruzione');
  assert.equal(h.notifications[0].status, CJ_DRMS_OUTCOME_NOTIFICATION_STATUS);
  assert.match(h.notifications[0].errorMessage, /interrotto da un riavvio/);
  assert.match(h.notifications[0].errorMessage, /upload DRMS 2026-08/);
  assert.match(h.notifications[0].errorMessage, /07\/09\/2026/, 'data di avvio in ora italiana');
  assert.equal(h.runs.length, 1, 'ricalcolo rilanciato');
  assert.equal(h.runs[0].orgId, 'org-r');
  assert.equal(h.runner.isRunning('org-r'), true);
  assert.ok(h.persistLog.some(([k, o]) => k === 'start' && o === 'org-r'), 'marker riscritto dal nuovo run');

  // Seconda chiamata (idempotenza): org già in corso ⇒ niente doppioni.
  assert.deepEqual(await h.runner.recoverInterrupted(), []);
  assert.equal(h.runs.length, 1);
  assert.equal(h.notifications.length, 1);

  h.runs[0].resolve(summary({ matched: 3 }));
  await tick(); await tick();
  assert.equal(h.notifications.length, 2, 'esito del run ripreso consegnato in notifica');
  assert.match(h.notifications[1].errorMessage, /completato \(ripresa dopo riavvio: upload DRMS 2026-08\)/);
  assert.equal(h.markers.has('org-r'), false, 'marker rimosso a fine ripresa');
  assert.equal(await h.runner.isRunningOrPersisted('org-r'), false);
});

test('ripresa: errore del run ripreso ⇒ notifica "fallito" e marker rimosso', async () => {
  const h = persistentHarness([{ organizationId: 'org-f', reason: 'Esita da DRMS', startedAt: null }]);
  await h.runner.recoverInterrupted();
  await tick();
  assert.equal(h.runs.length, 1);
  h.runs[0].reject(new Error('boom'));
  await tick(); await tick();
  assert.equal(h.notifications.length, 2);
  assert.match(h.notifications[1].errorMessage, /fallito .*boom/);
  assert.equal(h.markers.has('org-f'), false);
});

test('fault injection: end fallisce transitoriamente ⇒ retry con backoff finché il marker viene rimosso (stato non resta bloccato)', async () => {
  const markers = new Map([]);
  let endCalls = 0;
  const sleeps = [];
  const logs = [];
  const runner = createDrmsOutcomeRunner({
    run: async () => summary(),
    notify: async () => {},
    log: (m) => logs.push(m), errorLog: (m) => logs.push(m),
    sleep: async (ms) => { sleeps.push(ms); },
    persist: {
      start: async (orgId, reason) => { markers.set(orgId, { organizationId: orgId, reason, startedAt: null }); },
      end: async (orgId) => { endCalls++; if (endCalls < 3) throw new Error('db down'); markers.delete(orgId); },
      list: async () => [...markers.values()],
    },
  });
  const r = await runner.apply('org-h', { reason: 'test', inlineWaitMs: 5000 });
  assert.equal(r.pending, false);
  for (let i = 0; i < 6; i++) await tick();
  assert.equal(endCalls, 3, 'due fallimenti + un successo');
  assert.deepEqual(sleeps, [200, 400], 'backoff esponenziale');
  assert.equal(markers.has('org-h'), false, 'marker rimosso');
  assert.equal(await runner.isRunningOrPersisted('org-h'), false, 'outcomeRunning torna false');
});

test('fault injection: end fallisce sempre ⇒ dopo i tentativi il marker resta e il prossimo boot lo riconcilia rilanciando il run', async () => {
  const markers = new Map([]);
  let endCalls = 0;
  const logs = [];
  const mk = () => createDrmsOutcomeRunner({
    run: async () => summary(),
    notify: async () => {},
    log: (m) => logs.push(m), errorLog: (m) => logs.push(m),
    sleep: async () => {},
    persist: {
      start: async (orgId, reason) => { markers.set(orgId, { organizationId: orgId, reason, startedAt: null }); },
      end: async (orgId) => { endCalls++; if (endCalls <= 6) throw new Error('db down'); markers.delete(orgId); },
      list: async () => [...markers.values()],
    },
  });
  const r1 = mk();
  await r1.apply('org-k', { reason: 'test', inlineWaitMs: 5000 });
  for (let i = 0; i < 12; i++) await tick();
  assert.equal(endCalls, 6, 'sei tentativi');
  assert.ok(logs.some((l) => /NON rimosso dopo 6 tentativi/.test(l)));
  assert.equal(markers.has('org-k'), true, 'marker orfano');
  // "Riavvio": nuovo runner, il boot riconcilia il marker (rerun idempotente + cleanup).
  const r2 = mk();
  assert.deepEqual(await r2.recoverInterrupted(), ['org-k']);
  for (let i = 0; i < 6; i++) await tick();
  assert.equal(markers.has('org-k'), false, 'marker riconciliato al boot');
});

test('fault injection: list al boot fallisce transitoriamente ⇒ retry con backoff, poi ripresa', async () => {
  let listCalls = 0;
  const sleeps = [];
  const runs = [];
  const notifications = [];
  const runner = createDrmsOutcomeRunner({
    run: async (orgId) => { runs.push(orgId); return summary(); },
    notify: async (n) => { notifications.push(n); },
    log: () => {}, errorLog: () => {},
    sleep: async (ms) => { sleeps.push(ms); },
    persist: {
      start: async () => {}, end: async () => {},
      list: async () => { listCalls++; if (listCalls < 3) throw new Error('db starting'); return [{ organizationId: 'org-b', reason: 'upload', startedAt: null }]; },
    },
  });
  assert.deepEqual(await runner.recoverInterrupted(), ['org-b']);
  assert.equal(listCalls, 3);
  assert.deepEqual(sleeps, [1000, 2000]);
  await tick(); await tick();
  assert.deepEqual(runs, ['org-b']);
  assert.equal(notifications.length, 2, 'avviso interruzione + esito');
});

test('fault injection: list al boot fallisce sempre ⇒ abbandono loggato dopo 6 tentativi, nessun crash', async () => {
  const logs = [];
  const runner = createDrmsOutcomeRunner({
    run: async () => summary(), notify: async () => {},
    log: (m) => logs.push(m), errorLog: (m) => logs.push(m),
    sleep: async () => {},
    persist: { start: async () => {}, end: async () => {}, list: async () => { throw new Error('db down'); } },
  });
  assert.deepEqual(await runner.recoverInterrupted(), []);
  assert.ok(logs.some((l) => /abbandonata dopo 6 tentativi/.test(l)));
});
