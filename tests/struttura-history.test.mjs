import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  BASE,
  jsonReq,
  signup,
  setRole,
  cleanupOrg,
  newPool,
} from './helpers/uiTest.mjs';

// Test dello storico struttura RS/PDV (Task #339).
//
// Ogni upsert di organization_config che CAMBIA puntiVendita e/o
// ragioniSociali deve archiviare la versione PRECEDENTE in
// organization_config_history (retention: ultime 20 per org). Gli endpoint
// /api/admin/struttura/history permettono a admin/super_admin di ispezionare
// e ripristinare una versione.

const pdv = (i, extra = {}) => ({
  id: `pdv-${i}-hist`,
  codicePos: `910100${i}`,
  nome: `Negozio H${i}`,
  ragioneSociale: 'Hist RS S.R.L',
  canale: 'franchising',
  tipoPosizione: 'strada',
  ...extra,
});

const STRUTTURA = [pdv(0), pdv(1)];

async function seedConfig(pool, orgId, config) {
  await pool.query(
    `INSERT INTO organization_config (organization_id, config, config_version)
       VALUES ($1, $2, '2.0')
     ON CONFLICT (organization_id)
       DO UPDATE SET config = EXCLUDED.config`,
    [orgId, JSON.stringify(config)],
  );
}

async function historyRows(pool, orgId) {
  const r = await pool.query(
    `SELECT id, punti_vendita, ragioni_sociali, changed_by
       FROM organization_config_history
      WHERE organization_id = $1
      ORDER BY created_at DESC, id DESC`,
    [orgId],
  );
  return r.rows;
}

const putConfig = (session, config) =>
  jsonReq(`${BASE}/api/organization-config`, {
    method: 'PUT',
    headers: { Cookie: session.cookieHeader },
    body: JSON.stringify({ config, configVersion: '2.0' }),
  });

const api = (session, path, opts = {}) =>
  jsonReq(`${BASE}${path}`, {
    ...opts,
    headers: { Cookie: session.cookieHeader, ...(opts.headers || {}) },
  });

test('struttura history: archivio automatico, retention, restore', async () => {
  const pool = await newPool();
  const session = await signup({ prefix: 'strut_hist_test', fullName: 'Strut Hist Test' });
  try {
    await setRole(pool, session.profileId, 'admin');
    await seedConfig(pool, session.orgId, {
      puntiVendita: STRUTTURA,
      ragioniSociali: ['Hist RS S.R.L'],
      altroSetting: 'x',
    });

    // 1) Modifica NON strutturale => nessuna riga di storico.
    const nonStruct = await putConfig(session, {
      puntiVendita: STRUTTURA,
      ragioniSociali: ['Hist RS S.R.L'],
      altroSetting: 'y',
    });
    assert.equal(nonStruct.status, 200);
    assert.equal((await historyRows(pool, session.orgId)).length, 0,
      'non-structural change must not archive');

    // 2) Il PUT generico non può alterare la struttura: usare la route dedicata.
    const rinominata = [pdv(0), pdv(1, { nome: 'Negozio Rinominato' })];
    const legit = await putConfig(session, {
      puntiVendita: rinominata,
      ragioniSociali: ['Hist RS S.R.L'],
      altroSetting: 'y',
    });
    assert.equal(legit.status, 409, JSON.stringify(legit.body));
    const rename = await api(session, '/api/admin/struttura/pdv', {
      method: 'PUT',
      body: JSON.stringify({ oldRagioneSociale: 'Hist RS S.R.L', oldCodicePos: '9101001', nome: 'Negozio Rinominato' }),
    });
    assert.equal(rename.status, 200, JSON.stringify(rename.body));
    let rows = await historyRows(pool, session.orgId);
    assert.equal(rows.length, 1, 'structural change must archive previous version');
    assert.deepEqual(rows[0].punti_vendita, STRUTTURA, 'snapshot must be the PREVIOUS structure');
    assert.equal(rows[0].changed_by, session.profileId);

    // 3) Anche gli endpoint /api/admin/struttura/* archiviano (creazione PDV).
    const created = await api(session, '/api/admin/struttura/pdv', {
      method: 'POST',
      body: JSON.stringify({ codicePos: '9101009', nome: 'Nuovo H', ragioneSociale: 'Hist RS S.R.L' }),
    });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    rows = await historyRows(pool, session.orgId);
    assert.equal(rows.length, 2, 'struttura endpoint write must archive too');

    // 4) Lista via endpoint (solo metadati + conteggi).
    const list = await api(session, '/api/admin/struttura/history');
    assert.equal(list.status, 200);
    assert.equal(list.body.length, 2);
    assert.equal(list.body[0].puntiVenditaCount, 2, 'latest snapshot = renamed structure (2 PDV)');
    assert.ok(list.body[0].changedByName, 'changedByName must be resolved');
    assert.ok(!('puntiVendita' in list.body[0]), 'list must not include full snapshots');

    // 5) Dettaglio versione.
    const oldest = list.body[1];
    const detail = await api(session, `/api/admin/struttura/history/${oldest.id}`);
    assert.equal(detail.status, 200);
    assert.deepEqual(detail.body.puntiVendita, STRUTTURA);

    // 6) Una versione senza il PDV aggiunto non può eliminare quel PDV.
    const restore = await api(session, `/api/admin/struttura/history/${oldest.id}/restore`, { method: 'POST' });
    assert.equal(restore.status, 409, JSON.stringify(restore.body));
    const cur = await pool.query(
      `SELECT config->'puntiVendita' AS pv, config->>'altroSetting' AS s
         FROM organization_config WHERE organization_id = $1`,
      [session.orgId],
    );
    assert.equal(cur.rows[0].pv.length, 3, 'ripristino non può eliminare il nuovo PDV');
    assert.equal(cur.rows[0].s, 'y', 'ripristino rifiutato non tocca gli altri dati');
    rows = await historyRows(pool, session.orgId);
    assert.equal(rows.length, 2, 'ripristino rifiutato non crea versioni');

    // 7) Retention: dopo molte modifiche strutturali restano al massimo 20 versioni.
    for (let i = 0; i < 22; i++) {
      const r = await api(session, '/api/admin/struttura/pdv', {
        method: 'PUT',
        body: JSON.stringify({ oldRagioneSociale: 'Hist RS S.R.L', oldCodicePos: '9101000', nome: `Negozio Iter ${i}` }),
      });
      assert.equal(r.status, 200, `iter ${i}: ${JSON.stringify(r.body)}`);
    }
    rows = await historyRows(pool, session.orgId);
    assert.equal(rows.length, 20, `retention must cap at 20, got ${rows.length}`);

    // 8) Restore di una versione di un'altra org / id inesistente => 404.
    const notFound = await api(session, '/api/admin/struttura/history/00000000-0000-0000-0000-000000000000/restore', { method: 'POST' });
    assert.equal(notFound.status, 404);
  } finally {
    await pool.query(`DELETE FROM organization_config_history WHERE organization_id = $1`, [session.orgId]).catch(() => {});
    await cleanupOrg(pool, session);
    await pool.end().catch(() => {});
  }
});

test('struttura history: endpoint riservati ad admin/super_admin', async () => {
  const pool = await newPool();
  const session = await signup({ prefix: 'strut_hist_authz', fullName: 'Strut Hist Authz' });
  try {
    await setRole(pool, session.profileId, 'operatore');
    const list = await api(session, '/api/admin/struttura/history');
    assert.equal(list.status, 403, `operatore must get 403, got ${list.status}`);
    const restore = await api(session, '/api/admin/struttura/history/x/restore', { method: 'POST' });
    assert.equal(restore.status, 403);
  } finally {
    await cleanupOrg(pool, session);
    await pool.end().catch(() => {});
  }
});
