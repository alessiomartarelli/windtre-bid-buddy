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

// Task #477 — ripristino di una revisione archiviata dalla cronologia.
//
// Copre via API HTTP (admin autenticato) + verifica DB:
//   1. POST /api/gara-config/revisions/restore riporta la configurazione
//      corrente al contenuto (e nome) della revisione scelta.
//   2. Il ripristino archivia A SUA VOLTA la versione sostituita in
//      gara_config_history (il ripristino stesso resta annullabile).
//   3. GET /api/gara-config/revisions espone changedByName (autore).
//   4. Errori: revisionId mancante => 400, revisione inesistente => 404,
//      revisione di un'altra organizzazione => 404.

const now = new Date();
const MONTH = now.getMonth() + 1;
const YEAR = now.getFullYear();

function authed(session, opts = {}) {
  return { ...opts, headers: { Cookie: session.cookieHeader, ...(opts.headers || {}) } };
}

test('gara config: ripristino revisione dalla cronologia', async (t) => {
  const pool = await newPool();
  const session = await signup({ prefix: 'gara_rest' });
  const otherSession = await signup({ prefix: 'gara_rest_other' });

  t.after(async () => {
    await cleanupOrg(pool, session);
    await cleanupOrg(pool, otherSession);
    await pool.end();
  });

  const POS1 = uniq('W1');
  const pdvList = [{ id: POS1, codicePos: POS1, nome: 'Negozio 1', ragioneSociale: uniq('RS_REST') }];
  const configV1 = { pdvList, venditeForecast: { target: 100 } };
  const configV2 = { pdvList, venditeForecast: { target: 200 } };

  // Crea configurazione (v1) e poi aggiorna (v2) => v1 archiviata.
  const created = await jsonReq(`${BASE}/api/gara-config`, authed(session, {
    method: 'PUT',
    body: JSON.stringify({ month: MONTH, year: YEAR, name: 'Versione 1', config: configV1 }),
  }));
  assert.equal(created.status, 200, JSON.stringify(created.body));
  const configId = created.body.id;

  const updated = await jsonReq(`${BASE}/api/gara-config`, authed(session, {
    method: 'PUT',
    body: JSON.stringify({ month: MONTH, year: YEAR, name: 'Versione 2', id: configId, expectedUpdatedAt: created.body.updatedAt, config: configV2 }),
  }));
  assert.equal(updated.status, 200);

  // Lista revisioni: 1 revisione (v1), con autore risolto (changedByName).
  const revList = await jsonReq(`${BASE}/api/gara-config/revisions?configId=${configId}`, authed(session));
  assert.equal(revList.status, 200);
  assert.equal(revList.body.length, 1);
  const rev = revList.body[0];
  assert.equal(rev.name, 'Versione 1');
  assert.ok('changedByName' in rev, 'la lista revisioni deve esporre changedByName');
  assert.ok(rev.changedByName, 'changedByName deve essere valorizzato per salvataggi autenticati');

  // --- errori -------------------------------------------------------------
  const noBody = await jsonReq(`${BASE}/api/gara-config/revisions/restore`, authed(session, {
    method: 'POST', body: JSON.stringify({}),
  }));
  assert.equal(noBody.status, 400);

  const notFound = await jsonReq(`${BASE}/api/gara-config/revisions/restore`, authed(session, {
    method: 'POST', body: JSON.stringify({ revisionId: '00000000-0000-0000-0000-000000000000' }),
  }));
  assert.equal(notFound.status, 404);

  // Cross-org: un admin di un'altra org non può ripristinare questa revisione.
  const crossOrg = await jsonReq(`${BASE}/api/gara-config/revisions/restore`, authed(otherSession, {
    method: 'POST', body: JSON.stringify({ revisionId: rev.id }),
  }));
  assert.equal(crossOrg.status, 404, 'revisione di altra org deve dare 404');

  // --- ripristino ----------------------------------------------------------
  const restored = await jsonReq(`${BASE}/api/gara-config/revisions/restore`, authed(session, {
    method: 'POST', body: JSON.stringify({ revisionId: rev.id }),
  }));
  assert.equal(restored.status, 200, JSON.stringify(restored.body));
  assert.equal(restored.body.id, configId, 'il ripristino aggiorna la configurazione esistente');
  assert.equal(restored.body.name, 'Versione 1');
  assert.equal(restored.body.config.venditeForecast.target, 100,
    'il contenuto corrente deve tornare alla revisione ripristinata');

  // La configurazione ricaricata via API riflette il ripristino.
  const reloaded = await jsonReq(`${BASE}/api/gara-config?id=${configId}`, authed(session));
  assert.equal(reloaded.status, 200);
  assert.equal(reloaded.body.config.venditeForecast.target, 100);

  // La versione sostituita (v2) è stata archiviata a sua volta.
  const revs = await pool.query(
    'SELECT name, config FROM gara_config_history WHERE gara_config_id = $1 ORDER BY created_at DESC, id DESC',
    [configId],
  );
  assert.equal(revs.rowCount, 2, 'il ripristino deve archiviare la versione sostituita');
  assert.equal(revs.rows[0].name, 'Versione 2');
  assert.equal(revs.rows[0].config.venditeForecast.target, 200,
    'lo snapshot più recente deve contenere la versione sostituita dal ripristino');
});
