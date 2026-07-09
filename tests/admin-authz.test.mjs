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

// Crea un profilo bersaglio via SQL in una data org. Ritorna l'id.
async function createTargetUser(pool, orgId, role = 'operatore') {
  const id = uniq('target_user');
  await pool.query(
    `INSERT INTO profiles (id, email, full_name, organization_id, role)
       VALUES ($1, $2, $3, $4, $5)`,
    [id, `${id}@example.com`, 'Target User', orgId, role],
  );
  return id;
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

// ===========================================================================
// SCENARIO 3: POST /api/admin/update-user — un admin non può promuovere un
//   utente a `super_admin` (mentre il super_admin può).
//   (a) admin che fa update con role="super_admin" => 403, il ruolo NON cambia.
//   (b) super_admin con lo stesso update => 200, il ruolo diventa super_admin.
// ===========================================================================
test('scenario 3: admin cannot promote a user to super_admin on update-user', async () => {
  const pool = await newPool();
  const session = await signupAndLogin();
  let targetId;
  try {
    targetId = await createTargetUser(pool, session.orgId, 'operatore');

    // (a) admin tenta di promuovere a super_admin => 403.
    await setRole(pool, session.profileId, 'admin');
    const escalate = await jsonReq(`${BASE}/api/admin/update-user`, {
      method: 'POST',
      headers: { Cookie: session.cookieHeader },
      body: JSON.stringify({ user_id: targetId, role: 'super_admin' }),
    });
    assert.equal(
      escalate.status,
      403,
      `admin promoting a user to super_admin must be 403, got ${escalate.status}: ${JSON.stringify(escalate.body)}`,
    );
    assert.equal(
      escalate.body?.error,
      'Non puoi assegnare il ruolo super_admin',
      `unexpected error message on forbidden promotion: ${JSON.stringify(escalate.body)}`,
    );
    const afterAdmin = await pool.query(`SELECT role FROM profiles WHERE id = $1`, [targetId]);
    assert.equal(
      afterAdmin.rows[0]?.role,
      'operatore',
      'target role must NOT change after a forbidden admin promotion',
    );

    // (b) super_admin promuove lo stesso utente => 200.
    await setRole(pool, session.profileId, 'super_admin');
    const allowed = await jsonReq(`${BASE}/api/admin/update-user`, {
      method: 'POST',
      headers: { Cookie: session.cookieHeader },
      body: JSON.stringify({ user_id: targetId, role: 'super_admin' }),
    });
    assert.equal(
      allowed.status,
      200,
      `super_admin promoting a user must be 200, got ${allowed.status}: ${JSON.stringify(allowed.body)}`,
    );
    const afterSuper = await pool.query(`SELECT role FROM profiles WHERE id = $1`, [targetId]);
    assert.equal(
      afterSuper.rows[0]?.role,
      'super_admin',
      'super_admin must be able to promote a user to super_admin',
    );
  } finally {
    if (targetId) {
      await pool.query(`DELETE FROM profiles WHERE id = $1`, [targetId]).catch(() => {});
    }
    await cleanupOrg(pool, session);
    await pool.end().catch(() => {});
  }
});

// ===========================================================================
// SCENARIO 5 (Task #277): /api/admin/brands — CRUD riservato al super_admin.
//   (a) admin => 403 su GET/POST; operatore => 403.
//   (b) super_admin: crea, rinomina, associa a un'org (PUT multiselect),
//       il duplicato case-insensitive => 409, delete rimuove le associazioni.
// ===========================================================================
test('scenario 5: brand catalog is super_admin only, with org multiselect association', async () => {
  const pool = await newPool();
  const session = await signupAndLogin();
  const createdBrandIds = [];
  try {
    // (a) admin non può né leggere né creare brand.
    await setRole(pool, session.profileId, 'admin');
    const asAdminGet = await jsonReq(`${BASE}/api/admin/brands`, {
      headers: { Cookie: session.cookieHeader },
    });
    assert.equal(asAdminGet.status, 403, `admin GET brands must be 403, got ${asAdminGet.status}`);
    const asAdminPost = await jsonReq(`${BASE}/api/admin/brands`, {
      method: 'POST',
      headers: { Cookie: session.cookieHeader },
      body: JSON.stringify({ name: uniq('BrandX') }),
    });
    assert.equal(asAdminPost.status, 403, `admin POST brands must be 403, got ${asAdminPost.status}`);

    // operatore idem.
    await setRole(pool, session.profileId, 'operatore');
    const asOper = await jsonReq(`${BASE}/api/admin/brands`, {
      headers: { Cookie: session.cookieHeader },
    });
    assert.equal(asOper.status, 403, `operatore GET brands must be 403, got ${asOper.status}`);
    const asOperPut = await jsonReq(`${BASE}/api/admin/organizations/${session.orgId}/brands`, {
      method: 'PUT',
      headers: { Cookie: session.cookieHeader },
      body: JSON.stringify({ brandIds: [] }),
    });
    assert.equal(asOperPut.status, 403, `operatore PUT org brands must be 403, got ${asOperPut.status}`);

    // (b) super_admin: crea due brand.
    await setRole(pool, session.profileId, 'super_admin');
    const nameA = uniq('BrandA');
    const createA = await jsonReq(`${BASE}/api/admin/brands`, {
      method: 'POST',
      headers: { Cookie: session.cookieHeader },
      body: JSON.stringify({ name: nameA }),
    });
    assert.equal(createA.status, 201, `create brand A failed: ${JSON.stringify(createA.body)}`);
    createdBrandIds.push(createA.body.id);
    const createB = await jsonReq(`${BASE}/api/admin/brands`, {
      method: 'POST',
      headers: { Cookie: session.cookieHeader },
      body: JSON.stringify({ name: uniq('BrandB') }),
    });
    assert.equal(createB.status, 201, `create brand B failed: ${JSON.stringify(createB.body)}`);
    createdBrandIds.push(createB.body.id);

    // Duplicato case-insensitive => 409.
    const dupe = await jsonReq(`${BASE}/api/admin/brands`, {
      method: 'POST',
      headers: { Cookie: session.cookieHeader },
      body: JSON.stringify({ name: nameA.toUpperCase() }),
    });
    assert.equal(dupe.status, 409, `case-insensitive duplicate must be 409, got ${dupe.status}: ${JSON.stringify(dupe.body)}`);

    // Rinomina.
    const renamed = await jsonReq(`${BASE}/api/admin/brands/${createA.body.id}`, {
      method: 'PATCH',
      headers: { Cookie: session.cookieHeader },
      body: JSON.stringify({ name: `${nameA} Renamed` }),
    });
    assert.equal(renamed.status, 200, `rename failed: ${JSON.stringify(renamed.body)}`);
    assert.equal(renamed.body.name, `${nameA} Renamed`);

    // Associazione multiselect: entrambi i brand sull'org di test.
    const putBoth = await jsonReq(`${BASE}/api/admin/organizations/${session.orgId}/brands`, {
      method: 'PUT',
      headers: { Cookie: session.cookieHeader },
      body: JSON.stringify({ brandIds: createdBrandIds }),
    });
    assert.equal(putBoth.status, 200, `PUT org brands failed: ${JSON.stringify(putBoth.body)}`);
    const getAssoc = await jsonReq(`${BASE}/api/admin/organizations/${session.orgId}/brands`, {
      headers: { Cookie: session.cookieHeader },
    });
    assert.equal(getAssoc.status, 200);
    assert.deepEqual(
      [...getAssoc.body.brandIds].sort(),
      [...createdBrandIds].sort(),
      'both brands must be associated to the org',
    );

    // Brand inesistente nel PUT => 400.
    const putBad = await jsonReq(`${BASE}/api/admin/organizations/${session.orgId}/brands`, {
      method: 'PUT',
      headers: { Cookie: session.cookieHeader },
      body: JSON.stringify({ brandIds: ['nonexistent-brand-id'] }),
    });
    assert.equal(putBad.status, 400, `unknown brand id must be 400, got ${putBad.status}`);

    // DELETE del brand A rimuove anche l'associazione.
    const del = await jsonReq(`${BASE}/api/admin/brands/${createA.body.id}`, {
      method: 'DELETE',
      headers: { Cookie: session.cookieHeader },
    });
    assert.equal(del.status, 200, `delete failed: ${JSON.stringify(del.body)}`);
    assert.equal(del.body.removedAssociations, 1, 'delete must report the removed association');
    const leftover = await pool.query(
      `SELECT id FROM organization_brands WHERE brand_id = $1`,
      [createA.body.id],
    );
    assert.equal(leftover.rowCount, 0, 'associations must be removed with the brand');
  } finally {
    for (const id of createdBrandIds) {
      await pool.query(`DELETE FROM brands WHERE id = $1`, [id]).catch(() => {});
    }
    await pool.query(
      `DELETE FROM organization_brands WHERE organization_id = $1`,
      [session.orgId],
    ).catch(() => {});
    await cleanupOrg(pool, session);
    await pool.end().catch(() => {});
  }
});

// ===========================================================================
// SCENARIO 4: POST /api/admin/update-user — scoping per organizzazione.
//   (a) admin che modifica un utente di un'altra org => 403
//       ("Cannot update users outside your organization"), nessuna modifica.
//   (b) super_admin sullo stesso utente estraneo => 200 (nessun vincolo di org).
// ===========================================================================
test('scenario 4: update-user is org-scoped for admin but cross-org for super_admin', async () => {
  const pool = await newPool();
  const session = await signupAndLogin();
  let foreignOrgId;
  let foreignUserId;
  try {
    foreignOrgId = await createForeignOrg(pool);
    foreignUserId = await createTargetUser(pool, foreignOrgId, 'operatore');

    // (a) admin tenta di modificare un utente di un'altra org => 403.
    await setRole(pool, session.profileId, 'admin');
    const asAdmin = await jsonReq(`${BASE}/api/admin/update-user`, {
      method: 'POST',
      headers: { Cookie: session.cookieHeader },
      body: JSON.stringify({ user_id: foreignUserId, full_name: 'Hacked By Admin' }),
    });
    assert.equal(
      asAdmin.status,
      403,
      `admin updating a user of another org must be 403, got ${asAdmin.status}: ${JSON.stringify(asAdmin.body)}`,
    );
    assert.equal(
      asAdmin.body?.message,
      'Cannot update users outside your organization',
      `unexpected error message on cross-org update: ${JSON.stringify(asAdmin.body)}`,
    );
    const afterAdmin = await pool.query(`SELECT full_name FROM profiles WHERE id = $1`, [foreignUserId]);
    assert.equal(
      afterAdmin.rows[0]?.full_name,
      'Target User',
      'foreign user must NOT be modified by a cross-org admin',
    );

    // (b) super_admin modifica lo stesso utente estraneo => 200.
    await setRole(pool, session.profileId, 'super_admin');
    const asSuper = await jsonReq(`${BASE}/api/admin/update-user`, {
      method: 'POST',
      headers: { Cookie: session.cookieHeader },
      body: JSON.stringify({ user_id: foreignUserId, full_name: 'Renamed By Super' }),
    });
    assert.equal(
      asSuper.status,
      200,
      `super_admin must NOT be blocked cross-org, got ${asSuper.status}: ${JSON.stringify(asSuper.body)}`,
    );
    const afterSuper = await pool.query(`SELECT full_name FROM profiles WHERE id = $1`, [foreignUserId]);
    assert.equal(
      afterSuper.rows[0]?.full_name,
      'Renamed By Super',
      'super_admin must be able to update a user in any organization',
    );
  } finally {
    if (foreignUserId) {
      await pool.query(`DELETE FROM profiles WHERE id = $1`, [foreignUserId]).catch(() => {});
    }
    if (foreignOrgId) {
      await pool.query(`DELETE FROM organizations WHERE id = $1`, [foreignOrgId]).catch(() => {});
    }
    await cleanupOrg(pool, session);
    await pool.end().catch(() => {});
  }
});
