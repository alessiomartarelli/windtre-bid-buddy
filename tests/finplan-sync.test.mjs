import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

// Test suite FinPlan-sync (post Task #148, cutover finale alla shell React).
// Tutti gli scenari iframe-shim (vm-loaded da client/public/finplan/index.html)
// sono stati rimossi insieme al file HTML standalone. Restano i test di
// persistenza/gating server-side che proteggono `/api/finplan` GET/PUT,
// `/api/finplan/preload(/status)` e la logica del setup wizard.

const BASE = process.env.FINPLAN_BASE_URL || 'http://localhost:5000';

function uniq(prefix) {
  return `${prefix}_${crypto.randomBytes(4).toString('hex')}`;
}

async function jsonReq(url, opts = {}) {
  const r = await fetch(url, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      ...(opts.headers || {}),
    },
  });
  let body = null;
  const ct = r.headers.get('content-type') || '';
  if (ct.includes('application/json')) body = await r.json().catch(() => null);
  else body = await r.text().catch(() => null);
  return { status: r.status, headers: r.headers, body };
}

function pickCookie(headers) {
  const sc = headers.getSetCookie?.() || headers.raw?.()['set-cookie'] || [];
  const arr = Array.isArray(sc) ? sc : [sc];
  return arr
    .map((c) => c.split(';')[0])
    .filter(Boolean)
    .join('; ');
}

async function signupAndLogin() {
  const email = `${uniq('finplan_test')}@example.com`;
  const password = 'Pa55word!';
  const orgName = uniq('FPTest');
  const r = await jsonReq(`${BASE}/api/auth/signup`, {
    method: 'POST',
    body: JSON.stringify({
      email,
      password,
      fullName: 'FinPlan Test',
      organizationName: orgName,
    }),
  });
  assert.equal(r.status, 201, `signup failed: ${JSON.stringify(r.body)}`);
  const cookie = pickCookie(r.headers);
  assert.ok(cookie, 'no session cookie returned by signup');
  const profileId = r.body?.id;
  const orgId = r.body?.organization?.id || r.body?.organizationId;
  assert.ok(profileId && orgId, `missing ids in signup response: ${JSON.stringify(r.body)}`);
  return { email, password, cookie, profileId, orgId };
}

// ===========================================================================
// SCENARIO 1: /api/finplan PUT then GET round-trip con auth.
// Conferma il path di persistenza usato dalla shell React (`useFinplan`):
// signup → enable module in DB → PUT → GET → cleanup.
// ===========================================================================
test('scenario 1: authenticated PUT then GET round-trip persists data and returns updatedAt', async () => {
  const pgMod = await import('pg');
  const Pool = pgMod.default?.Pool || pgMod.Pool;
  assert.ok(process.env.DATABASE_URL, 'DATABASE_URL must be set for this test');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  const session = await signupAndLogin();
  try {
    // Enable the finplan module gate on this fresh org so /api/finplan
    // is reachable. Done via direct DB because the app has no public
    // endpoint to flip enabled_modules.
    await pool.query(
      `UPDATE organizations
         SET enabled_modules = '{"amministrazione":true,"controllo_gestione":true}'::jsonb
       WHERE id = $1`,
      [session.orgId],
    );

    const payload = { __test: 'roundtrip', n: Math.floor(Math.random() * 1e6) };
    const put = await jsonReq(`${BASE}/api/finplan`, {
      method: 'PUT',
      headers: { Cookie: session.cookie },
      body: JSON.stringify({ data: payload }),
    });
    assert.equal(put.status, 200, `PUT failed: ${JSON.stringify(put.body)}`);
    assert.equal(put.body?.ok, true, 'PUT response must include ok:true');
    assert.ok(
      typeof put.body?.updatedAt === 'string' && put.body.updatedAt.length > 0,
      'PUT response must include a non-empty updatedAt',
    );
    const putUpdatedAt = put.body.updatedAt;

    const get = await jsonReq(`${BASE}/api/finplan`, {
      headers: { Cookie: session.cookie },
    });
    assert.equal(get.status, 200, `GET failed: ${JSON.stringify(get.body)}`);
    assert.deepEqual(
      get.body?.data,
      payload,
      'GET must return exactly the data we just PUT',
    );
    assert.equal(
      get.body?.updatedAt,
      putUpdatedAt,
      'GET updatedAt must match the value returned by the PUT',
    );
  } finally {
    await pool
      .query(`DELETE FROM finplan_data WHERE organization_id = $1`, [session.orgId])
      .catch(() => {});
    await pool
      .query(`DELETE FROM profiles WHERE id = $1`, [session.profileId])
      .catch(() => {});
    await pool
      .query(`DELETE FROM organizations WHERE id = $1`, [session.orgId])
      .catch(() => {});
    await pool.end().catch(() => {});
  }
});

// ===========================================================================
// SCENARIO 2: PRELOAD gating multi-tenant.
// (a) Org NON allowlisted → /api/finplan/preload risponde 204 (workspace vuoto).
// (b) Senza autenticazione → 401/403.
// Garantisce che i dati Cms Group non siano leakable tra tenant.
// ===========================================================================
test('scenario 2: preload gated — non-allowlisted org gets 204; unauthenticated gets 401/403', async () => {
  const pgMod = await import('pg');
  const Pool = pgMod.default?.Pool || pgMod.Pool;
  assert.ok(process.env.DATABASE_URL, 'DATABASE_URL must be set for this test');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  const session = await signupAndLogin();
  try {
    // Abilita modulo amministrazione così l'endpoint passa requireModule.
    await pool.query(
      `UPDATE organizations
         SET enabled_modules = '{"amministrazione":true,"controllo_gestione":true}'::jsonb
       WHERE id = $1`,
      [session.orgId],
    );

    // (a) Fresh org NON è in FINPLAN_PRELOAD_ORGS → deve ricevere 204.
    const r = await fetch(`${BASE}/api/finplan/preload`, {
      headers: { Cookie: session.cookie },
    });
    assert.equal(
      r.status,
      204,
      `non-allowlisted org must receive 204 from /api/finplan/preload, got ${r.status}`,
    );
    const buf = await r.arrayBuffer();
    assert.equal(buf.byteLength, 0, '204 response must carry no body');

    // (b) Senza autenticazione: 401 / 403.
    const noAuth = await fetch(`${BASE}/api/finplan/preload`);
    assert.ok(
      noAuth.status === 401 || noAuth.status === 403,
      `unauthenticated request must be rejected (got ${noAuth.status})`,
    );
    await noAuth.arrayBuffer();
  } finally {
    await pool
      .query(`DELETE FROM finplan_data WHERE organization_id = $1`, [session.orgId])
      .catch(() => {});
    await pool
      .query(`DELETE FROM profiles WHERE id = $1`, [session.profileId])
      .catch(() => {});
    await pool
      .query(`DELETE FROM organizations WHERE id = $1`, [session.orgId])
      .catch(() => {});
    await pool.end().catch(() => {});
  }
});

// ===========================================================================
// SCENARIO 3: PRELOAD allowlisted — happy path.
// Riassegniamo il profilo di un utente di test all'org `org-admin-windtre`
// (l'unica in `FINPLAN_PRELOAD_ORGS` di default) e verifichiamo che
// `/api/finplan/preload` risponda 200 + JSON valido + ETag, e che un
// secondo GET con `If-None-Match` ritorni 304.
// ===========================================================================
test('scenario 3: allowlisted org gets 200 + JSON preload, conditional GET returns 304', async () => {
  const pgMod = await import('pg');
  const Pool = pgMod.default?.Pool || pgMod.Pool;
  assert.ok(process.env.DATABASE_URL, 'DATABASE_URL must be set for this test');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  const session = await signupAndLogin();
  const ALLOWED_ORG = 'org-admin-windtre';
  const originalOrgId = session.orgId;
  // Su DB pristini l'org allowlistata può non esistere → FK fail. Upsertiamo
  // garantendo che esista, e ricordiamo se l'abbiamo creata noi per non
  // cancellare in cleanup la riga reale ("Cms Group") quando il test gira
  // su un DB già popolato.
  const upsertRes = await pool.query(
    `INSERT INTO organizations (id, name, enabled_modules)
       VALUES ($1, 'Cms Group (test)', '{"amministrazione":true,"controllo_gestione":true}'::jsonb)
       ON CONFLICT (id) DO UPDATE
         SET enabled_modules = organizations.enabled_modules ||
             '{"amministrazione":true,"controllo_gestione":true}'::jsonb
       RETURNING (xmax = 0) AS inserted`,
    [ALLOWED_ORG],
  );
  const createdAllowedOrg = !!upsertRes.rows[0]?.inserted;
  try {
    await pool.query(
      `UPDATE profiles SET organization_id = $1 WHERE id = $2`,
      [ALLOWED_ORG, session.profileId],
    );

    const r1 = await fetch(`${BASE}/api/finplan/preload`, {
      headers: { Cookie: session.cookie },
    });
    assert.equal(
      r1.status,
      200,
      `allowlisted org must receive 200, got ${r1.status}`,
    );
    const etag = r1.headers.get('etag');
    assert.ok(etag, 'preload response must include an ETag');
    const ct = r1.headers.get('content-type') || '';
    assert.match(ct, /application\/json/i, 'Content-Type must be JSON');
    const body = await r1.json();
    assert.ok(body && typeof body === 'object', 'body must be a JSON object');
    assert.ok(
      Array.isArray(body.data),
      'preload payload must contain a `data` array (5 companies)',
    );

    // Conditional GET con stesso ETag → 304 vuoto.
    const r2 = await fetch(`${BASE}/api/finplan/preload`, {
      headers: { Cookie: session.cookie, 'If-None-Match': etag },
    });
    assert.equal(
      r2.status,
      304,
      `conditional GET with matching ETag must return 304, got ${r2.status}`,
    );
    const buf = await r2.arrayBuffer();
    assert.equal(buf.byteLength, 0, '304 response must have empty body');
  } finally {
    await pool
      .query(`UPDATE profiles SET organization_id = $1 WHERE id = $2`, [originalOrgId, session.profileId])
      .catch(() => {});
    await pool
      .query(`DELETE FROM finplan_data WHERE organization_id = $1`, [originalOrgId])
      .catch(() => {});
    await pool
      .query(`DELETE FROM profiles WHERE id = $1`, [session.profileId])
      .catch(() => {});
    await pool
      .query(`DELETE FROM organizations WHERE id = $1`, [originalOrgId])
      .catch(() => {});
    if (createdAllowedOrg) {
      await pool
        .query(`DELETE FROM finplan_data WHERE organization_id = $1`, [ALLOWED_ORG])
        .catch(() => {});
      await pool
        .query(`DELETE FROM organizations WHERE id = $1`, [ALLOWED_ORG])
        .catch(() => {});
    }
    await pool.end().catch(() => {});
  }
});

// ===========================================================================
// SCENARIO 4: Wizard di setup iniziale FinPlan — gating multi-tenant.
// Replica la logica di `finplanNeedsSetup` in `Amministrazione.tsx`:
//   wizard mostrato sse  !hasPreload && !updatedAt && !dismissed
// Verifichiamo i tre stati osservabili lato API/localStorage che pilotano
// quel calcolo:
//   (a) Org nuova senza preload e senza dati  → wizard MOSTRATO
//   (b) Org allowlistata (preload presente)   → wizard NASCOSTO
//   (c) Org con dati salvati (updatedAt != null) → wizard NASCOSTO
// Una regressione su uno di questi tre branch farebbe ricomparire il wizard
// alle org Cms Group o nasconderlo alle nuove (Task #136).
// ===========================================================================
function finplanNeedsSetup({ hasPreload, updatedAt, dismissed = false }) {
  // Replica fedele di client/src/pages/Amministrazione.tsx.
  if (dismissed) return false;
  if (hasPreload) return false;
  if (updatedAt) return false;
  return true;
}

test('scenario 4: setup wizard gating — shown only for fresh non-allowlisted orgs without saved data', async () => {
  const pgMod = await import('pg');
  const Pool = pgMod.default?.Pool || pgMod.Pool;
  assert.ok(process.env.DATABASE_URL, 'DATABASE_URL must be set for this test');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  // Sanity-check del predicato locale prima di interrogare la rete.
  assert.equal(
    finplanNeedsSetup({ hasPreload: false, updatedAt: null }),
    true,
    'predicate: vergine + nessun preload → wizard',
  );
  assert.equal(
    finplanNeedsSetup({ hasPreload: true, updatedAt: null }),
    false,
    'predicate: preload allowlistato → niente wizard',
  );
  assert.equal(
    finplanNeedsSetup({ hasPreload: false, updatedAt: '2026-05-15T10:00:00Z' }),
    false,
    'predicate: dati salvati → niente wizard',
  );
  assert.equal(
    finplanNeedsSetup({ hasPreload: false, updatedAt: null, dismissed: true }),
    false,
    'predicate: dismiss in localStorage → niente wizard',
  );

  // -------------------------------------------------------------------------
  // (a) Org NUOVA senza preload e senza dati → wizard mostrato.
  // -------------------------------------------------------------------------
  const sessionA = await signupAndLogin();
  let createdAllowedOrg = false;
  let sessionB = null;
  let sessionC = null;
  const ALLOWED_ORG = 'org-admin-windtre';
  try {
    await pool.query(
      `UPDATE organizations
         SET enabled_modules = '{"amministrazione":true,"controllo_gestione":true}'::jsonb
       WHERE id = $1`,
      [sessionA.orgId],
    );

    const statusA = await jsonReq(`${BASE}/api/finplan/preload/status`, {
      headers: { Cookie: sessionA.cookie },
    });
    assert.equal(statusA.status, 200, `(a) preload/status must be 200, got ${statusA.status}`);
    assert.equal(
      statusA.body?.hasPreload,
      false,
      '(a) fresh non-allowlisted org must report hasPreload:false',
    );

    const dataA = await jsonReq(`${BASE}/api/finplan`, {
      headers: { Cookie: sessionA.cookie },
    });
    assert.equal(dataA.status, 200, `(a) GET /api/finplan must be 200, got ${dataA.status}`);
    assert.equal(
      dataA.body?.updatedAt,
      null,
      '(a) fresh org must have updatedAt:null',
    );

    assert.equal(
      finplanNeedsSetup({
        hasPreload: statusA.body.hasPreload,
        updatedAt: dataA.body.updatedAt,
      }),
      true,
      '(a) fresh non-allowlisted org WITHOUT saved data must show the setup wizard',
    );

    // -----------------------------------------------------------------------
    // (b) Org allowlistata (preload presente) → wizard NASCOSTO.
    // -----------------------------------------------------------------------
    sessionB = await signupAndLogin();
    const upsertRes = await pool.query(
      `INSERT INTO organizations (id, name, enabled_modules)
         VALUES ($1, 'Cms Group (test)', '{"amministrazione":true,"controllo_gestione":true}'::jsonb)
         ON CONFLICT (id) DO UPDATE
           SET enabled_modules = organizations.enabled_modules ||
               '{"amministrazione":true,"controllo_gestione":true}'::jsonb
         RETURNING (xmax = 0) AS inserted`,
      [ALLOWED_ORG],
    );
    createdAllowedOrg = !!upsertRes.rows[0]?.inserted;
    await pool.query(
      `UPDATE profiles SET organization_id = $1 WHERE id = $2`,
      [ALLOWED_ORG, sessionB.profileId],
    );

    const statusB = await jsonReq(`${BASE}/api/finplan/preload/status`, {
      headers: { Cookie: sessionB.cookie },
    });
    assert.equal(statusB.status, 200, `(b) preload/status must be 200, got ${statusB.status}`);
    assert.equal(
      statusB.body?.hasPreload,
      true,
      '(b) allowlisted org must report hasPreload:true (preload payload available)',
    );

    const dataB = await jsonReq(`${BASE}/api/finplan`, {
      headers: { Cookie: sessionB.cookie },
    });
    assert.equal(dataB.status, 200, `(b) GET /api/finplan must be 200, got ${dataB.status}`);

    assert.equal(
      finplanNeedsSetup({
        hasPreload: statusB.body.hasPreload,
        updatedAt: dataB.body.updatedAt,
      }),
      false,
      '(b) allowlisted org with preload must NOT show the setup wizard',
    );

    // -----------------------------------------------------------------------
    // (c) Org con dati già salvati (updatedAt non nullo) → wizard NASCOSTO.
    // -----------------------------------------------------------------------
    sessionC = await signupAndLogin();
    await pool.query(
      `UPDATE organizations
         SET enabled_modules = '{"amministrazione":true,"controllo_gestione":true}'::jsonb
       WHERE id = $1`,
      [sessionC.orgId],
    );

    const putC = await jsonReq(`${BASE}/api/finplan`, {
      method: 'PUT',
      headers: { Cookie: sessionC.cookie },
      body: JSON.stringify({ data: { __test: 'scenario4_saved', n: 1 } }),
    });
    assert.equal(putC.status, 200, `(c) seed PUT must be 200, got ${putC.status}`);
    assert.ok(
      typeof putC.body?.updatedAt === 'string' && putC.body.updatedAt.length > 0,
      '(c) PUT must return a non-empty updatedAt',
    );

    const statusC = await jsonReq(`${BASE}/api/finplan/preload/status`, {
      headers: { Cookie: sessionC.cookie },
    });
    assert.equal(statusC.status, 200, `(c) preload/status must be 200, got ${statusC.status}`);
    assert.equal(
      statusC.body?.hasPreload,
      false,
      '(c) non-allowlisted org must still report hasPreload:false',
    );

    const dataC = await jsonReq(`${BASE}/api/finplan`, {
      headers: { Cookie: sessionC.cookie },
    });
    assert.equal(dataC.status, 200, `(c) GET /api/finplan must be 200, got ${dataC.status}`);
    assert.ok(
      typeof dataC.body?.updatedAt === 'string' && dataC.body.updatedAt.length > 0,
      '(c) org with previous PUT must have a non-empty updatedAt',
    );

    assert.equal(
      finplanNeedsSetup({
        hasPreload: statusC.body.hasPreload,
        updatedAt: dataC.body.updatedAt,
      }),
      false,
      '(c) org with saved data must NOT show the setup wizard',
    );
  } finally {
    for (const s of [sessionA, sessionB, sessionC].filter(Boolean)) {
      await pool
        .query(`DELETE FROM finplan_data WHERE organization_id = $1`, [s.orgId])
        .catch(() => {});
      await pool
        .query(`DELETE FROM profiles WHERE id = $1`, [s.profileId])
        .catch(() => {});
      await pool
        .query(`DELETE FROM organizations WHERE id = $1`, [s.orgId])
        .catch(() => {});
    }
    if (createdAllowedOrg) {
      await pool
        .query(`DELETE FROM finplan_data WHERE organization_id = $1`, [ALLOWED_ORG])
        .catch(() => {});
      await pool
        .query(`DELETE FROM organizations WHERE id = $1`, [ALLOWED_ORG])
        .catch(() => {});
    }
    await pool.end().catch(() => {});
  }
});
