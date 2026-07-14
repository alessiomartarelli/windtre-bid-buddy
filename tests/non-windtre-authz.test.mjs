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

// Test suite brand gating per org NON-WindTre (Task #315).
//
// Dal Task #314 i moduli Vendite BiSuite, Incentivazione Interna e Customer
// Journey NON richiedono più il brand WindTre: un'org con solo brand Fastweb
// (caso Phone&Phone) deve poterli usare. Restano invece WindTre-gated i
// moduli simulatore / gara / DRMS.
//
// Questa suite congela il comportamento a livello di route HTTP: se qualcuno
// reintroduce per errore quei moduli in WINDTRE_GATED_MODULES (shared/
// modules.ts) o cambia requireModule (server/routes.ts), i test falliscono.
//
// Strategia (come module-permissions-authz): signup crea admin + org; le
// route rileggono profilo/org/brand dal DB ad ogni richiesta, quindi basta
// associare via SQL un brand Fastweb all'org sulla stessa sessione.

const signupAndLogin = () =>
  signup({ prefix: 'nonw3_authz_test', fullName: 'NonW3 Authz Test' });

// Route che DEVONO restare accessibili (NON 403) per un'org solo-Fastweb.
const ALLOWED_ROUTES = [
  '/api/customer-journeys', // customer_journey
  '/api/bisuite-sales', // vendite_bisuite (in alternativa ad altri moduli)
  '/api/incentivazione/config?month=7&year=2026', // incentivazione_interna
];

// Route che DEVONO restare bloccate (403) per un'org solo-Fastweb.
const BLOCKED_ROUTES = [
  '/api/preventivi', // simulatore
  '/api/gara-config?month=7&year=2026', // gara_configurazione | gara_dashboard
  '/api/drms', // drms_commissioning
];

async function attachBrand(pool, orgId, name) {
  const b = await pool.query(
    `INSERT INTO brands (name) VALUES ($1) RETURNING id`,
    [name],
  );
  const brandId = b.rows[0].id;
  await pool.query(
    `INSERT INTO organization_brands (organization_id, brand_id) VALUES ($1, $2)`,
    [orgId, brandId],
  );
  return brandId;
}

async function detachBrand(pool, brandId) {
  if (!brandId) return;
  await pool
    .query(`DELETE FROM organization_brands WHERE brand_id = $1`, [brandId])
    .catch(() => {});
  await pool.query(`DELETE FROM brands WHERE id = $1`, [brandId]).catch(() => {});
}

// ===========================================================================
// SCENARIO 1: org con SOLO brand Fastweb (non-WindTre).
//   - Vendite BiSuite / Customer Journey / Incentivazione => accesso (200);
//   - Simulatore / Gara / DRMS => 403 "Modulo non abilitato".
// ===========================================================================
test('scenario 1: Fastweb-only org keeps BiSuite/CJ/Incentivazione, loses WindTre-gated modules', async () => {
  const pool = await newPool();
  const session = await signupAndLogin();
  let brandId;
  try {
    // Admin: alcuni handler (es. /api/drms) richiedono ruolo admin — così
    // l'unico motivo di 403 è il brand gating di requireModule.
    await setRole(pool, session.profileId, 'admin');
    brandId = await attachBrand(pool, session.orgId, uniq('Fastweb'));

    for (const route of ALLOWED_ROUTES) {
      const r = await jsonReq(`${BASE}${route}`, {
        headers: { Cookie: session.cookieHeader },
      });
      assert.equal(
        r.status,
        200,
        `${route} must be 200 for a Fastweb-only org, got ${r.status}: ${JSON.stringify(r.body)}`,
      );
    }

    for (const route of BLOCKED_ROUTES) {
      const r = await jsonReq(`${BASE}${route}`, {
        headers: { Cookie: session.cookieHeader },
      });
      assert.equal(
        r.status,
        403,
        `${route} must be 403 for a Fastweb-only org, got ${r.status}: ${JSON.stringify(r.body)}`,
      );
      assert.equal(r.body?.error, 'Modulo non abilitato');
    }
  } finally {
    await detachBrand(pool, brandId);
    await cleanupOrg(pool, session);
    await pool.end().catch(() => {});
  }
});

// ===========================================================================
// SCENARIO 2 (controllo del setup): la STESSA org senza alcun brand associato
//   non subisce alcun filtro => anche le route WindTre-gated rispondono 200.
//   Garantisce che i 403 dello scenario 1 dipendano dal brand, non da altro.
// ===========================================================================
test('scenario 2: same org without brands has no gating (all routes 200)', async () => {
  const pool = await newPool();
  const session = await signupAndLogin();
  try {
    await setRole(pool, session.profileId, 'admin');

    for (const route of [...ALLOWED_ROUTES, ...BLOCKED_ROUTES]) {
      const r = await jsonReq(`${BASE}${route}`, {
        headers: { Cookie: session.cookieHeader },
      });
      assert.equal(
        r.status,
        200,
        `${route} must be 200 for an org without brands, got ${r.status}: ${JSON.stringify(r.body)}`,
      );
    }
  } finally {
    await cleanupOrg(pool, session);
    await pool.end().catch(() => {});
  }
});
