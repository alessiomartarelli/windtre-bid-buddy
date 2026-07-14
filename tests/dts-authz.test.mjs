import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  BASE,
  uniq,
  jsonReq,
  signup,
  setRole,
  cleanupOrg,
  newPool,
} from './helpers/uiTest.mjs';

// Test authz Gestione DTS (Task #322).
//
// Le route di scrittura del modulo Gestione DTS (POST /api/dts/upload,
// DELETE /api/dts/leads) sono admin-only e org-scoped, ma non avevano un
// test di integrazione: una regressione futura (es. rimozione di
// requireAdminRole) passerebbe in silenzio su un percorso che scrive dati.
//
// Strategia (stessa di admin-authz): signup crea un profilo admin + org;
// le route rileggono il profilo dal DB ad ogni richiesta, quindi mutiamo
// `role` via SQL (stessa sessione/cookie) per simulare operatore/admin.
// Una seconda org "estranea" con un lead seminato via SQL verifica lo
// scoping per organizzazione di lettura e cancellazione.

const signupAndLogin = () => signup({ prefix: 'dts_authz_test', fullName: 'DTS Authz Test' });

// Payload minimo valido per POST /api/dts/upload.
function uploadBody(leadKey) {
  return {
    fileName: 'dts-authz-test.xlsx',
    leads: [
      {
        leadKey,
        consulente: 'Test Consulente',
        campagna: 'Campagna Test',
        nominativo: 'Mario Rossi',
        data: '2026-07-01',
        idVendita: null,
      },
    ],
  };
}

// Crea una org "estranea" con un lead DTS seminato via SQL.
async function seedForeignOrgWithLead(pool) {
  const org = await pool.query(
    `INSERT INTO organizations (name) VALUES ($1) RETURNING id`,
    [uniq('DtsForeignOrg')],
  );
  const orgId = org.rows[0].id;
  const leadKey = uniq('foreign_lead');
  await pool.query(
    `INSERT INTO dts_leads (organization_id, lead_key, nominativo, file_name)
       VALUES ($1, $2, 'Foreign Lead', 'foreign.xlsx')`,
    [orgId, leadKey],
  );
  return { orgId, leadKey };
}

async function cleanupForeignOrg(pool, orgId) {
  await pool.query(`DELETE FROM dts_leads WHERE organization_id = $1`, [orgId]).catch(() => {});
  await pool.query(`DELETE FROM organizations WHERE id = $1`, [orgId]).catch(() => {});
}

// ===========================================================================
// SCENARIO 1: un operatore NON può caricare né cancellare i lead DTS.
//   (a) POST /api/dts/upload da operatore => 403, nessun lead scritto.
//   (b) DELETE /api/dts/leads da operatore => 403, i lead esistenti restano.
//   La lettura (GET /api/dts/leads) resta invece consentita all'operatore.
// ===========================================================================
test('scenario 1: operatore cannot upload or delete DTS leads (403), but can read', async () => {
  const pool = await newPool();
  const session = await signupAndLogin();
  try {
    // Semina un lead nell'org (via SQL) per verificare che il DELETE
    // negato non lo tocchi.
    const existingKey = uniq('existing_lead');
    await pool.query(
      `INSERT INTO dts_leads (organization_id, lead_key, nominativo, file_name)
         VALUES ($1, $2, 'Existing Lead', 'seed.xlsx')`,
      [session.orgId, existingKey],
    );

    await setRole(pool, session.profileId, 'operatore');

    // (a) upload da operatore => 403 e nessuna scrittura.
    const deniedKey = uniq('denied_lead');
    const up = await jsonReq(`${BASE}/api/dts/upload`, {
      method: 'POST',
      headers: { Cookie: session.cookieHeader },
      body: JSON.stringify(uploadBody(deniedKey)),
    });
    assert.equal(
      up.status,
      403,
      `operatore uploading DTS leads must be 403, got ${up.status}: ${JSON.stringify(up.body)}`,
    );
    const leaked = await pool.query(
      `SELECT id FROM dts_leads WHERE organization_id = $1 AND lead_key = $2`,
      [session.orgId, deniedKey],
    );
    assert.equal(leaked.rowCount, 0, 'no lead must be written by a denied operator upload');

    // (b) delete da operatore => 403 e il lead esistente sopravvive.
    const del = await jsonReq(`${BASE}/api/dts/leads`, {
      method: 'DELETE',
      headers: { Cookie: session.cookieHeader },
    });
    assert.equal(
      del.status,
      403,
      `operatore deleting DTS leads must be 403, got ${del.status}: ${JSON.stringify(del.body)}`,
    );
    const survived = await pool.query(
      `SELECT id FROM dts_leads WHERE organization_id = $1 AND lead_key = $2`,
      [session.orgId, existingKey],
    );
    assert.equal(survived.rowCount, 1, 'existing leads must survive a denied operator delete');

    // La lettura resta consentita all'operatore (il modulo è abilitato).
    const list = await jsonReq(`${BASE}/api/dts/leads`, {
      headers: { Cookie: session.cookieHeader },
    });
    assert.equal(list.status, 200, `operatore GET leads must be 200, got ${list.status}`);
    assert.ok(
      list.body.some((l) => l.leadKey === existingKey),
      'operatore must see the org leads on GET',
    );
  } finally {
    await pool.query(`DELETE FROM dts_leads WHERE organization_id = $1`, [session.orgId]).catch(() => {});
    await cleanupOrg(pool, session);
    await pool.end().catch(() => {});
  }
});

// ===========================================================================
// SCENARIO 2: admin può caricare/cancellare SOLO nella propria org.
//   (a) upload da admin => 200, il lead finisce nella SUA org.
//   (b) GET /api/dts/leads è scoped: il lead dell'org estranea non appare.
//   (c) DELETE cancella solo la propria org: il lead estraneo sopravvive.
// ===========================================================================
test('scenario 2: admin upload/delete are org-scoped; read never leaks other orgs', async () => {
  const pool = await newPool();
  const session = await signupAndLogin();
  let foreign;
  try {
    foreign = await seedForeignOrgWithLead(pool);
    await setRole(pool, session.profileId, 'admin');

    // (a) upload da admin => 200 nella propria org.
    const ownKey = uniq('own_lead');
    const up = await jsonReq(`${BASE}/api/dts/upload`, {
      method: 'POST',
      headers: { Cookie: session.cookieHeader },
      body: JSON.stringify(uploadBody(ownKey)),
    });
    assert.equal(up.status, 200, `admin upload failed: ${JSON.stringify(up.body)}`);
    assert.equal(up.body?.count, 1, `upload must report 1 lead, got ${JSON.stringify(up.body)}`);
    const stored = await pool.query(
      `SELECT organization_id FROM dts_leads WHERE lead_key = $1`,
      [ownKey],
    );
    assert.equal(stored.rowCount, 1, 'uploaded lead must be stored');
    assert.equal(
      stored.rows[0].organization_id,
      session.orgId,
      'uploaded lead must belong to the admin org',
    );

    // (b) GET è scoped per org: vede il proprio lead, NON quello estraneo.
    const list = await jsonReq(`${BASE}/api/dts/leads`, {
      headers: { Cookie: session.cookieHeader },
    });
    assert.equal(list.status, 200, `GET leads failed: ${JSON.stringify(list.body)}`);
    assert.ok(
      list.body.some((l) => l.leadKey === ownKey),
      'admin must see the lead of their own org',
    );
    assert.ok(
      !list.body.some((l) => l.leadKey === foreign.leadKey),
      'GET leads must NOT leak leads of another org',
    );

    // (c) DELETE cancella solo la propria org.
    const del = await jsonReq(`${BASE}/api/dts/leads`, {
      method: 'DELETE',
      headers: { Cookie: session.cookieHeader },
    });
    assert.equal(del.status, 200, `admin delete failed: ${JSON.stringify(del.body)}`);
    const ownLeft = await pool.query(
      `SELECT id FROM dts_leads WHERE organization_id = $1`,
      [session.orgId],
    );
    assert.equal(ownLeft.rowCount, 0, 'admin delete must remove all leads of their org');
    const foreignLeft = await pool.query(
      `SELECT id FROM dts_leads WHERE organization_id = $1`,
      [foreign.orgId],
    );
    assert.equal(foreignLeft.rowCount, 1, 'delete must NOT touch leads of another org');
  } finally {
    await pool.query(`DELETE FROM dts_leads WHERE organization_id = $1`, [session.orgId]).catch(() => {});
    if (foreign) await cleanupForeignOrg(pool, foreign.orgId);
    await cleanupOrg(pool, session);
    await pool.end().catch(() => {});
  }
});
