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

// Test suite admin role/org boundary (Task #211).
//
// Task #207 ha aggiunto controlli lato server che impediscono a un admin di
// tenant di scavalcare i limiti di ruolo o di organizzazione:
//   (a) un admin NON può promuovere un utente a `super_admin`;
//   (b) un admin crea/gestisce utenti SOLO nella propria org (qualsiasi
//       organizationId falsificato nel payload viene ignorato e forzato a
//       quello dell'admin);
//   (c) un admin può usare /api/admin/bisuite-api SOLO per la propria org
//       (un organization_id di un'altra org => 403), mentre il super_admin
//       può operare su qualsiasi org.
//
// Questi controlli non avevano test di regressione: una modifica futura
// potrebbe riaprire il buco senza che nessuno se ne accorga. Questi test li
// bloccano.
//
// Strategia (identica a customer-journey-authz): signup crea un profilo
// `admin` + org. Le route rileggono il profilo dal DB ad ogni richiesta,
// quindi mutiamo `role` del profilo (stessa sessione/cookie) per simulare
// admin/super_admin senza login multipli. Una seconda org "estranea" viene
// creata via SQL per i tentativi cross-org.

const signupAndLogin = () => signup({ prefix: 'admin_authz_test', fullName: 'Admin Authz Test' });

// Crea una org "estranea" (diversa da quella dell'admin) via SQL. Ritorna l'id.
async function createForeignOrg(pool) {
  const r = await pool.query(
    `INSERT INTO organizations (name) VALUES ($1) RETURNING id`,
    [uniq('ForeignOrg')],
  );
  return r.rows[0].id;
}

// ===========================================================================
// SCENARIO 1: POST /api/admin/create-user — un admin non può scavalcare
//   ruolo (super_admin) né organizzazione.
//   (a) role="super_admin" forzato nel payload => 403, nessun utente creato.
//   (b) organization_id di un'altra org nel payload => ignorato, l'utente
//       viene creato nella org dell'admin.
// ===========================================================================
test('scenario 1: admin cannot escalate role or forge organization on create-user', async () => {
  const pool = await newPool();
  const session = await signupAndLogin();
  const createdUserIds = [];
  let foreignOrgId;
  try {
    foreignOrgId = await createForeignOrg(pool);
    await setRole(pool, session.profileId, 'admin');

    // (a) admin tenta di creare un super_admin => 403.
    const escalate = await jsonReq(`${BASE}/api/admin/create-user`, {
      method: 'POST',
      headers: { Cookie: session.cookieHeader },
      body: JSON.stringify({
        email: `${uniq('escalate')}@example.com`,
        fullName: 'Would Be Super',
        role: 'super_admin',
      }),
    });
    assert.equal(
      escalate.status,
      403,
      `admin escalating to super_admin must be 403, got ${escalate.status}: ${JSON.stringify(escalate.body)}`,
    );
    // Nessun utente deve essere stato creato.
    const leaked = await pool.query(
      `SELECT id FROM profiles WHERE role = 'super_admin' AND organization_id = $1`,
      [session.orgId],
    );
    assert.equal(leaked.rowCount, 0, 'no super_admin profile must be created by an admin');

    // (b) admin crea un utente ma forgia organization_id su un'altra org.
    const forgedEmail = `${uniq('forged')}@example.com`;
    const forged = await jsonReq(`${BASE}/api/admin/create-user`, {
      method: 'POST',
      headers: { Cookie: session.cookieHeader },
      body: JSON.stringify({
        email: forgedEmail,
        fullName: 'Forged Org User',
        role: 'operatore',
        organization_id: foreignOrgId,
        organizationId: foreignOrgId,
      }),
    });
    assert.equal(forged.status, 200, `create-user failed: ${JSON.stringify(forged.body)}`);
    if (forged.body?.id) createdUserIds.push(forged.body.id);
    assert.equal(
      forged.body?.organizationId,
      session.orgId,
      'forged organization_id must be ignored: user belongs to the admin org',
    );
    assert.notEqual(
      forged.body?.organizationId,
      foreignOrgId,
      'user must NOT be created in the foreign org',
    );
  } finally {
    for (const id of createdUserIds) {
      await pool.query(`DELETE FROM profiles WHERE id = $1`, [id]).catch(() => {});
    }
    if (foreignOrgId) {
      await pool.query(`DELETE FROM organizations WHERE id = $1`, [foreignOrgId]).catch(() => {});
    }
    await cleanupOrg(pool, session);
    await pool.end().catch(() => {});
  }
});

// ===========================================================================
// SCENARIO 2: POST /api/admin/bisuite-api — scoping per organizzazione.
//   (a) admin con organization_id di un'altra org => 403 (cross-org negato).
//   (b) super_admin con lo stesso organization_id => NON 403: supera il
//       controllo cross-org e raggiunge il lookup credenziali (400 perché
//       la org estranea non ha credenziali BiSuite configurate).
// ===========================================================================
test('scenario 2: bisuite-api is org-scoped for admin but cross-org for super_admin', async () => {
  const pool = await newPool();
  const session = await signupAndLogin();
  let foreignOrgId;
  try {
    foreignOrgId = await createForeignOrg(pool);

    // (a) admin punta a un'altra org => 403.
    await setRole(pool, session.profileId, 'admin');
    const asAdmin = await jsonReq(`${BASE}/api/admin/bisuite-api`, {
      method: 'POST',
      headers: { Cookie: session.cookieHeader },
      body: JSON.stringify({ action: 'fetch_sales', organization_id: foreignOrgId }),
    });
    assert.equal(
      asAdmin.status,
      403,
      `admin using another org's BiSuite API must be 403, got ${asAdmin.status}: ${JSON.stringify(asAdmin.body)}`,
    );

    // (b) super_admin sulla stessa org estranea => supera il check cross-org.
    //     La org non ha credenziali => 400 (NON 403): prova che il
    //     super_admin non è bloccato dal vincolo di organizzazione.
    await setRole(pool, session.profileId, 'super_admin');
    const asSuper = await jsonReq(`${BASE}/api/admin/bisuite-api`, {
      method: 'POST',
      headers: { Cookie: session.cookieHeader },
      body: JSON.stringify({ action: 'fetch_sales', organization_id: foreignOrgId }),
    });
    assert.notEqual(
      asSuper.status,
      403,
      `super_admin must NOT be blocked cross-org, got 403: ${JSON.stringify(asSuper.body)}`,
    );
    assert.equal(
      asSuper.status,
      400,
      `super_admin reaches the creds lookup (missing creds => 400), got ${asSuper.status}: ${JSON.stringify(asSuper.body)}`,
    );
  } finally {
    if (foreignOrgId) {
      await pool.query(`DELETE FROM organizations WHERE id = $1`, [foreignOrgId]).catch(() => {});
    }
    await cleanupOrg(pool, session);
    await pool.end().catch(() => {});
  }
});
