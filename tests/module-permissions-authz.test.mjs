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

// Test suite permessi moduli per-utente lato server (Task #311).
//
// Il middleware requireModule(key) su una route protetta (es. /api/drms,
// gated su "drms_commissioning") ora considera, oltre a org (enabledModules)
// e brand gating, anche la whitelist per-utente `profiles.moduli_consentiti`:
//   - NULL   => nessuna restrizione (eredita l'org): route accessibile;
//   - array  => whitelist: la route è accessibile solo se la chiave è dentro;
//   - super_admin bypassa tutto.
//
// Inoltre POST /api/admin/update-user consente a un admin di impostare
// moduli_consentiti SOLO entro il perimetro org ∩ brand, e MAI su un
// super_admin.
//
// Strategia (come admin-authz): signup crea admin + org; le route rileggono
// il profilo dal DB ad ogni richiesta, quindi mutiamo role/moduli_consentiti
// via SQL sulla stessa sessione.

const signupAndLogin = () =>
  signup({ prefix: 'modperm_authz_test', fullName: 'ModPerm Authz Test' });

// Imposta moduli_consentiti (array o null) sul profilo via SQL.
async function setModuli(pool, profileId, moduli) {
  await pool.query(
    `UPDATE profiles SET moduli_consentiti = $2 WHERE id = $1`,
    [profileId, moduli], // node-pg mappa un array JS su text[]; null => NULL
  );
}

async function createTargetUser(pool, orgId, role = 'operatore') {
  const id = uniq('modperm_target');
  await pool.query(
    `INSERT INTO profiles (id, email, full_name, organization_id, role)
       VALUES ($1, $2, $3, $4, $5)`,
    [id, `${id}@example.com`, 'Target User', orgId, role],
  );
  return id;
}

// ===========================================================================
// SCENARIO 1: requireModule rispetta la whitelist per-utente.
//   La route /api/drms è gated su "drms_commissioning". L'org di signup ha
//   tutti i moduli abilitati e nessun brand => nessun filtro org/brand.
//   (a) moduli_consentiti NULL => accesso (NON 403);
//   (b) whitelist SENZA drms_commissioning => 403;
//   (c) whitelist CON drms_commissioning => accesso (NON 403);
//   (d) super_admin con whitelist che esclude tutto => bypassa (NON 403).
// ===========================================================================
test('scenario 1: requireModule enforces per-user module whitelist', async () => {
  const pool = await newPool();
  const session = await signupAndLogin();
  try {
    // /api/drms richiede ruolo admin nel handler: usiamo un admin così, oltre
    // a requireModule, anche il controllo di ruolo interno passa e possiamo
    // isolare l'effetto della whitelist per-utente.
    await setRole(pool, session.profileId, 'admin');

    // (a) nessuna restrizione => accesso.
    await setModuli(pool, session.profileId, null);
    const inherit = await jsonReq(`${BASE}/api/drms`, {
      headers: { Cookie: session.cookieHeader },
    });
    assert.notEqual(
      inherit.status,
      403,
      `null moduli_consentiti must inherit org (not 403), got ${inherit.status}: ${JSON.stringify(inherit.body)}`,
    );

    // (b) whitelist senza drms => 403.
    await setModuli(pool, session.profileId, ['customer_journey']);
    const blocked = await jsonReq(`${BASE}/api/drms`, {
      headers: { Cookie: session.cookieHeader },
    });
    assert.equal(
      blocked.status,
      403,
      `module not in whitelist must be 403, got ${blocked.status}: ${JSON.stringify(blocked.body)}`,
    );
    assert.equal(blocked.body?.error, 'Modulo non abilitato');

    // (c) whitelist con drms => accesso.
    await setModuli(pool, session.profileId, ['drms_commissioning']);
    const allowed = await jsonReq(`${BASE}/api/drms`, {
      headers: { Cookie: session.cookieHeader },
    });
    assert.notEqual(
      allowed.status,
      403,
      `module in whitelist must NOT be 403, got ${allowed.status}: ${JSON.stringify(allowed.body)}`,
    );

    // (d) super_admin bypassa anche con whitelist restrittiva.
    await setRole(pool, session.profileId, 'super_admin');
    await setModuli(pool, session.profileId, []);
    const asSuper = await jsonReq(`${BASE}/api/drms`, {
      headers: { Cookie: session.cookieHeader },
    });
    assert.notEqual(
      asSuper.status,
      403,
      `super_admin must bypass per-user whitelist, got ${asSuper.status}: ${JSON.stringify(asSuper.body)}`,
    );
  } finally {
    await cleanupOrg(pool, session);
    await pool.end().catch(() => {});
  }
});

// ===========================================================================
// SCENARIO 2: update-user filtra i moduli concessi al perimetro org ∩ brand.
//   (a) modulo disabilitato per l'org => scartato dalla whitelist salvata;
//   (b) modulo WindTre-gated con org SENZA brand WindTre => scartato;
//   (c) chiave ignota => scartata; chiave valida nel perimetro => tenuta.
// ===========================================================================
test('scenario 2: update-user clamps granted modules to org and brand perimeter', async () => {
  const pool = await newPool();
  const session = await signupAndLogin();
  let targetId;
  let brandId;
  try {
    targetId = await createTargetUser(pool, session.orgId, 'operatore');
    await setRole(pool, session.profileId, 'admin');

    // Disabilita controllo_gestione per l'org e associa un brand NON WindTre,
    // così i moduli WindTre-gated (es. tabelle_calcolo) sono fuori perimetro.
    await pool.query(
      `UPDATE organizations SET enabled_modules = $2 WHERE id = $1`,
      [session.orgId, JSON.stringify({ controllo_gestione: false })],
    );
    const b = await pool.query(
      `INSERT INTO brands (name) VALUES ($1) RETURNING id`,
      [uniq('Vodafone')],
    );
    brandId = b.rows[0].id;
    await pool.query(
      `INSERT INTO organization_brands (organization_id, brand_id) VALUES ($1, $2)`,
      [session.orgId, brandId],
    );

    const res = await jsonReq(`${BASE}/api/admin/update-user`, {
      method: 'POST',
      headers: { Cookie: session.cookieHeader },
      body: JSON.stringify({
        user_id: targetId,
        moduliConsentiti: [
          'controllo_gestione', // disabilitato per l'org => scartato
          'customer_journey', // NON più brand-gated => tenuto
          'chiave_inventata', // ignota => scartata
          'tabelle_calcolo', // WindTre-gated => scartato
          'mappatura_bisuite', // superOnly => scartato
        ],
      }),
    });
    assert.equal(res.status, 200, `update-user failed: ${JSON.stringify(res.body)}`);

    const saved = await pool.query(
      `SELECT moduli_consentiti FROM profiles WHERE id = $1`,
      [targetId],
    );
    const moduli = saved.rows[0]?.moduli_consentiti ?? [];
    assert.ok(!moduli.includes('controllo_gestione'), 'org-disabled module must be dropped');
    assert.ok(moduli.includes('customer_journey'), 'non-gated module must be kept');
    assert.ok(!moduli.includes('tabelle_calcolo'), 'brand-gated module must be dropped');
    assert.ok(!moduli.includes('chiave_inventata'), 'unknown key must be dropped');
    assert.ok(!moduli.includes('mappatura_bisuite'), 'superOnly module must be dropped');
  } finally {
    if (targetId) {
      await pool.query(`DELETE FROM profiles WHERE id = $1`, [targetId]).catch(() => {});
    }
    if (brandId) {
      await pool.query(`DELETE FROM organization_brands WHERE brand_id = $1`, [brandId]).catch(() => {});
      await pool.query(`DELETE FROM brands WHERE id = $1`, [brandId]).catch(() => {});
    }
    await cleanupOrg(pool, session);
    await pool.end().catch(() => {});
  }
});

// ===========================================================================
// SCENARIO 3: update-user NON può modificare i permessi di un super_admin.
//   admin (o chiunque) che invia moduliConsentiti su un target super_admin
//   => 403, nessuna modifica.
// ===========================================================================
test('scenario 3: update-user cannot set module permissions on a super_admin', async () => {
  const pool = await newPool();
  const session = await signupAndLogin();
  let targetId;
  try {
    targetId = await createTargetUser(pool, session.orgId, 'super_admin');
    await setRole(pool, session.profileId, 'super_admin');

    const res = await jsonReq(`${BASE}/api/admin/update-user`, {
      method: 'POST',
      headers: { Cookie: session.cookieHeader },
      body: JSON.stringify({
        user_id: targetId,
        moduliConsentiti: ['customer_journey'],
      }),
    });
    assert.equal(
      res.status,
      403,
      `setting modules on a super_admin must be 403, got ${res.status}: ${JSON.stringify(res.body)}`,
    );
    assert.equal(res.body?.error, 'Non puoi modificare i permessi di un super_admin');

    const saved = await pool.query(
      `SELECT moduli_consentiti FROM profiles WHERE id = $1`,
      [targetId],
    );
    assert.equal(
      saved.rows[0]?.moduli_consentiti,
      null,
      'super_admin moduli_consentiti must remain untouched (null)',
    );
  } finally {
    if (targetId) {
      await pool.query(`DELETE FROM profiles WHERE id = $1`, [targetId]).catch(() => {});
    }
    await cleanupOrg(pool, session);
    await pool.end().catch(() => {});
  }
});
