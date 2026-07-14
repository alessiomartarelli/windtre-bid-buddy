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

// Test suite authz route canvass Vodafone/Fastweb (Task #302).
//
// Le route canvass sono riservate ad admin/super_admin (oltre al gate modulo
// `mappatura_bisuite`). Un `operatore` NON deve poter leggere catalogo o
// vendite categorizzate, né importare/resettare il listino. Un `admin` può
// leggere solo i dati della PROPRIA org (organization_id estraneo => 403) e
// NON può importare/resettare (solo super_admin).
//
// Strategia (identica a admin-authz): signup crea profilo+org; le route
// rileggono il profilo dal DB ad ogni richiesta, quindi mutiamo `role` con
// la stessa sessione/cookie.

const signupAndLogin = () => signup({ prefix: 'canvass_authz_test', fullName: 'Canvass Authz Test' });

async function createForeignOrg(pool) {
  const r = await pool.query(
    `INSERT INTO organizations (name) VALUES ($1) RETURNING id`,
    [uniq('CanvassForeignOrg')],
  );
  return r.rows[0].id;
}

const CANVASS_ROUTES = [
  { method: 'GET', path: '/api/admin/canvass-catalog' },
  { method: 'GET', path: '/api/admin/canvass-mapped-sales' },
  { method: 'POST', path: '/api/admin/canvass-catalog/import' },
  { method: 'POST', path: '/api/admin/canvass-catalog/reset' },
];

// ===========================================================================
// SCENARIO 1: un operatore riceve 403 su TUTTE le route canvass.
// ===========================================================================
test('scenario 1: operatore => 403 su tutte le route canvass', async () => {
  const pool = await newPool();
  const session = await signupAndLogin();
  try {
    await setRole(pool, session.profileId, 'operatore');
    for (const r of CANVASS_ROUTES) {
      const res = await jsonReq(`${BASE}${r.path}`, {
        method: r.method,
        headers: { Cookie: session.cookieHeader },
        ...(r.method === 'POST' ? { body: JSON.stringify({}) } : {}),
      });
      assert.equal(
        res.status,
        403,
        `operatore su ${r.method} ${r.path} deve essere 403, got ${res.status}: ${JSON.stringify(res.body)}`,
      );
    }
  } finally {
    await cleanupOrg(pool, session);
    await pool.end();
  }
});

// ===========================================================================
// SCENARIO 2: un admin legge SOLO la propria org e non può importare/resettare.
//   (a) GET canvass-catalog => 200
//   (b) GET canvass-mapped-sales (propria org) => 200
//   (c) GET canvass-mapped-sales?organization_id=<altra org> => 403
//   (d) POST import => 403 (solo super_admin)
//   (e) POST reset => 403 (solo super_admin)
// ===========================================================================
test('scenario 2: admin limitato alla propria org, niente import/reset', async () => {
  const pool = await newPool();
  const session = await signupAndLogin();
  let foreignOrgId;
  try {
    foreignOrgId = await createForeignOrg(pool);
    await setRole(pool, session.profileId, 'admin');

    const catalog = await jsonReq(`${BASE}/api/admin/canvass-catalog`, {
      headers: { Cookie: session.cookieHeader },
    });
    assert.equal(catalog.status, 200, `catalog admin deve essere 200: ${JSON.stringify(catalog.body)}`);
    assert.ok(Array.isArray(catalog.body?.offers), 'catalog deve avere offers');

    const own = await jsonReq(`${BASE}/api/admin/canvass-mapped-sales`, {
      headers: { Cookie: session.cookieHeader },
    });
    assert.equal(own.status, 200, `mapped-sales propria org deve essere 200: ${JSON.stringify(own.body)}`);

    const foreign = await jsonReq(
      `${BASE}/api/admin/canvass-mapped-sales?organization_id=${encodeURIComponent(foreignOrgId)}`,
      { headers: { Cookie: session.cookieHeader } },
    );
    assert.equal(
      foreign.status,
      403,
      `mapped-sales su org estranea deve essere 403, got ${foreign.status}: ${JSON.stringify(foreign.body)}`,
    );

    const imp = await jsonReq(`${BASE}/api/admin/canvass-catalog/import`, {
      method: 'POST',
      headers: { Cookie: session.cookieHeader },
      body: JSON.stringify({}),
    });
    assert.equal(imp.status, 403, `import admin deve essere 403, got ${imp.status}`);

    const rst = await jsonReq(`${BASE}/api/admin/canvass-catalog/reset`, {
      method: 'POST',
      headers: { Cookie: session.cookieHeader },
      body: JSON.stringify({}),
    });
    assert.equal(rst.status, 403, `reset admin deve essere 403, got ${rst.status}`);
  } finally {
    if (foreignOrgId) {
      await pool.query(`DELETE FROM organizations WHERE id = $1`, [foreignOrgId]).catch(() => {});
    }
    await cleanupOrg(pool, session);
    await pool.end();
  }
});

// ===========================================================================
// SCENARIO 3: import con listino non valido (colonne sbagliate => 0 offerte)
//   viene rifiutato con 400 anche per super_admin (Task #305, difesa server).
// ===========================================================================
test('scenario 3: super_admin, reference senza offerte => 400', async () => {
  const pool = await newPool();
  const session = await signupAndLogin();
  try {
    await setRole(pool, session.profileId, 'super_admin');
    const res = await jsonReq(`${BASE}/api/admin/canvass-catalog/import`, {
      method: 'POST',
      headers: { Cookie: session.cookieHeader },
      body: JSON.stringify({ reference: { periodo: 'AGOSTO 2026', offers: [], steps: [] } }),
    });
    assert.equal(
      res.status,
      400,
      `reference senza offerte deve essere 400, got ${res.status}: ${JSON.stringify(res.body)}`,
    );
  } finally {
    await cleanupOrg(pool, session);
    await pool.end();
  }
});
