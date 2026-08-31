import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  BASE,
  uniq,
  jsonReq,
  signup,
  cleanupOrg,
  newPool,
} from './helpers/uiTest.mjs';

// Task #14 — storico e propagazione sicuri delle configurazioni gara.
//
// Copre via API HTTP (admin autenticato) + verifica diretta su DB:
//   1. PUT con id archivia la revisione PRECEDENTE in gara_config_history
//      (recuperabile via GET /api/gara-config/revisions) e un PUT identico
//      NON crea revisioni spurie (confronto stabile insensibile all'ordine
//      delle chiavi jsonb).
//   2. GET /api/gara-config/history restituisce record nominati e
//      distinguibili (id + name), senza collassare per mese/anno.
//   3. POST /api/gara-config/import-from-simulator crea un NUOVO record e
//      PRESERVA le impostazioni non sostituite dell'ultima config del mese
//      (tabelleCalcolo, extraGaraIvaSogliePerRS, venditeForecast,
//      performanceWeights), sovrascrivendo solo pdvList e chiavi importate.
//   4. Le soglie Extra Gara P.IVA (extraGaraIvaSogliePerRS) persistono nel
//      salvataggio e vengono restituite ricaricando la configurazione.

const now = new Date();
const MONTH = now.getMonth() + 1;
const YEAR = now.getFullYear();

function authed(session, opts = {}) {
  return { ...opts, headers: { Cookie: session.cookieHeader, ...(opts.headers || {}) } };
}

test('gara config: storico, revisioni, propagazione e soglie Extra P.IVA', async (t) => {
  const pool = await newPool();
  const session = await signup({ prefix: 'gara_hist' });

  t.after(async () => {
    await cleanupOrg(pool, session);
    await pool.end();
  });

  const RS = uniq('RS_HIST');
  const POS1 = uniq('W1');
  const basePdvList = [{ id: POS1, codicePos: POS1, nome: 'Negozio 1', ragioneSociale: RS }];

  const extraSoglie = { [RS]: { clusterPIva: 'GOLD', pdvCount: 3, s1: 10, s2: 20, s3: 30, s4: 40 } };
  const configV1 = {
    pdvList: basePdvList,
    tabelleCalcolo: { extraGara: { soglieMultipos: { conBP: { s1: 11, s2: 22, s3: 33, s4: 44 } } } },
    extraGaraIvaSogliePerRS: extraSoglie,
    venditeForecast: { target: 1234 },
    performanceWeights: { mobile: 2, fisso: 1 },
  };

  // --- 1. crea configurazione nominata -------------------------------------
  const created = await jsonReq(`${BASE}/api/gara-config`, authed(session, {
    method: 'PUT',
    body: JSON.stringify({ month: MONTH, year: YEAR, name: 'Gara Originale', config: configV1 }),
  }));
  assert.equal(created.status, 200, JSON.stringify(created.body));
  const configId = created.body.id;
  assert.ok(configId);

  // --- 4. soglie Extra P.IVA persistono e si ricaricano ---------------------
  const reloaded = await jsonReq(`${BASE}/api/gara-config?id=${configId}`, authed(session));
  assert.equal(reloaded.status, 200);
  assert.deepEqual(reloaded.body.config.extraGaraIvaSogliePerRS, extraSoglie,
    'extraGaraIvaSogliePerRS deve persistere nella configurazione salvata');

  // --- 1a. PUT identico (stesso contenuto) NON archivia revisioni ----------
  const noop = await jsonReq(`${BASE}/api/gara-config`, authed(session, {
    method: 'PUT',
    body: JSON.stringify({ month: MONTH, year: YEAR, name: 'Gara Originale', id: configId, expectedUpdatedAt: reloaded.body.updatedAt, config: reloaded.body.config }),
  }));
  assert.equal(noop.status, 200);
  let revs = await pool.query('SELECT * FROM gara_config_history WHERE gara_config_id = $1', [configId]);
  assert.equal(revs.rowCount, 0, 'un salvataggio identico non deve archiviare revisioni spurie');

  // --- 1b. PUT con modifica archivia la revisione precedente ---------------
  const configV2 = { ...configV1, venditeForecast: { target: 9999 } };
  const updated = await jsonReq(`${BASE}/api/gara-config`, authed(session, {
    method: 'PUT',
    body: JSON.stringify({ month: MONTH, year: YEAR, name: 'Gara Aggiornata', id: configId, expectedUpdatedAt: noop.body.updatedAt, config: configV2 }),
  }));
  assert.equal(updated.status, 200);
  revs = await pool.query('SELECT * FROM gara_config_history WHERE gara_config_id = $1', [configId]);
  assert.equal(revs.rowCount, 1, 'l\'update deve archiviare la revisione precedente');
  assert.equal(revs.rows[0].name, 'Gara Originale');
  assert.equal(revs.rows[0].config.venditeForecast.target, 1234,
    'lo snapshot archiviato deve contenere il valore PRECEDENTE');

  // Revisioni consultabili via API.
  const revList = await jsonReq(`${BASE}/api/gara-config/revisions?configId=${configId}`, authed(session));
  assert.equal(revList.status, 200);
  assert.equal(revList.body.length, 1);
  const revFull = await jsonReq(`${BASE}/api/gara-config/revisions?revisionId=${revList.body[0].id}`, authed(session));
  assert.equal(revFull.status, 200);
  assert.equal(revFull.body.config.venditeForecast.target, 1234);

  // --- 2. history = record nominati, nessun collasso per mese/anno ---------
  const second = await jsonReq(`${BASE}/api/gara-config`, authed(session, {
    method: 'PUT',
    body: JSON.stringify({ month: MONTH, year: YEAR, name: 'Gara Parallela', config: { pdvList: basePdvList } }),
  }));
  assert.equal(second.status, 200);

  const missingVersion = await jsonReq(`${BASE}/api/gara-config`, authed(session, {
    method: 'PUT',
    body: JSON.stringify({ month: MONTH, year: YEAR, name: 'Senza versione', id: second.body.id, config: { pdvList: basePdvList } }),
  }));
  assert.equal(missingVersion.status, 428, 'un update esistente deve dichiarare la versione caricata');

  const [casA, casB] = await Promise.all([
    jsonReq(`${BASE}/api/gara-config`, authed(session, {
      method: 'PUT',
      body: JSON.stringify({ month: MONTH, year: YEAR, name: 'CAS A', id: second.body.id, expectedUpdatedAt: second.body.updatedAt, config: { pdvList: basePdvList, venditeForecast: { target: 1 } } }),
    })),
    jsonReq(`${BASE}/api/gara-config`, authed(session, {
      method: 'PUT',
      body: JSON.stringify({ month: MONTH, year: YEAR, name: 'CAS B', id: second.body.id, expectedUpdatedAt: second.body.updatedAt, config: { pdvList: basePdvList, venditeForecast: { target: 2 } } }),
    })),
  ]);
  assert.deepEqual([casA.status, casB.status].sort(), [200, 409], 'solo uno di due salvataggi concorrenti può vincere');
  const casWinner = casA.status === 200 ? casA : casB;

  const history = await jsonReq(`${BASE}/api/gara-config/history`, authed(session));
  assert.equal(history.status, 200);
  const sameMonth = history.body.filter((h) => h.month === MONTH && h.year === YEAR);
  assert.equal(sameMonth.length, 2, 'entrambe le configurazioni dello stesso mese devono comparire');
  for (const h of sameMonth) {
    assert.ok(h.id, 'ogni voce di storico deve avere un id');
    assert.ok(h.name, 'ogni voce di storico deve avere un nome');
  }
  const names = sameMonth.map((h) => h.name).sort();
  assert.deepEqual(names, ['Gara Aggiornata', casWinner.body.name].sort());

  // --- 3. import/propagazione preserva le impostazioni non sostituite ------
  // La config più recente del mese è "Gara Parallela" (senza tabelle/soglie):
  // riallineala ai valori ricchi, così l'ultima config del mese li contiene.
  await jsonReq(`${BASE}/api/gara-config`, authed(session, {
    method: 'PUT',
    body: JSON.stringify({ month: MONTH, year: YEAR, name: 'Gara Parallela', id: second.body.id, expectedUpdatedAt: casWinner.body.updatedAt, config: configV2 }),
  }));

  // Semina una organization_config con una pdvList DIVERSA da propagare.
  const POS2 = uniq('W2');
  await pool.query(
    `INSERT INTO organization_config (organization_id, config, config_version)
     VALUES ($1, $2::jsonb, '1')
     ON CONFLICT (organization_id) DO UPDATE SET config = EXCLUDED.config`,
    [session.orgId, JSON.stringify({
      puntiVendita: [{ id: POS2, codicePos: POS2, nome: 'Negozio 2', ragioneSociale: RS }],
      pistaMobileConfig: { sogliePerPos: [{ posCode: POS2, soglia1: 5, soglia2: 10, soglia3: 15, soglia4: 20 }] },
    })],
  );

  const imported = await jsonReq(`${BASE}/api/gara-config/import-from-simulator`, authed(session, {
    method: 'POST',
    body: JSON.stringify({ month: MONTH, year: YEAR, source: 'organization_config' }),
  }));
  assert.equal(imported.status, 200, JSON.stringify(imported.body));
  const impCfg = imported.body.config;
  // Chiavi importate: pdvList sostituita.
  assert.equal(impCfg.pdvList.length, 1);
  assert.equal(impCfg.pdvList[0].codicePos, POS2, 'la pdvList deve venire dalla sorgente importata');
  assert.equal(impCfg.pistaMobileConfig.sogliePerPos[0].posCode, POS2);
  // Impostazioni NON sostituite: preservate dall'ultima config del mese.
  assert.deepEqual(impCfg.extraGaraIvaSogliePerRS, extraSoglie,
    'la propagazione non deve svuotare le soglie Extra P.IVA');
  assert.equal(impCfg.tabelleCalcolo.extraGara.soglieMultipos.conBP.s1, 11,
    'la propagazione non deve svuotare le tabelle di calcolo');
  assert.equal(impCfg.venditeForecast.target, 9999,
    'la propagazione non deve svuotare il forecast');
  assert.deepEqual(impCfg.performanceWeights, { mobile: 2, fisso: 1 },
    'la propagazione non deve svuotare i pesi performance');
  // L'import crea un NUOVO record: le config precedenti restano recuperabili.
  const listAfter = await jsonReq(`${BASE}/api/gara-config/list?month=${MONTH}&year=${YEAR}`, authed(session));
  assert.equal(listAfter.status, 200);
  assert.equal(listAfter.body.length, 3, 'l\'import non deve sostituire i record esistenti');
});
