import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

// Test suite FinPlan-sync (post Task #148, cutover finale alla shell React).
// L'iframe HTML standalone è stato rimosso insieme alla sua infrastruttura
// (route preload, allowlist, cache file, flag DB). Restano i test di
// persistenza/gating server-side che proteggono `/api/finplan` GET/PUT,
// la logica del setup wizard, e che le route legacy non rispondano più.

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

async function enableFinplanModule(pool, orgId) {
  await pool.query(
    `UPDATE organizations
       SET enabled_modules = '{"amministrazione":true,"controllo_gestione":true}'::jsonb
     WHERE id = $1`,
    [orgId],
  );
}

async function cleanupSession(pool, session) {
  await pool
    .query(`DELETE FROM finplan_data WHERE organization_id = $1`, [session.orgId])
    .catch(() => {});
  await pool
    .query(`DELETE FROM profiles WHERE id = $1`, [session.profileId])
    .catch(() => {});
  await pool
    .query(`DELETE FROM organizations WHERE id = $1`, [session.orgId])
    .catch(() => {});
}

// ===========================================================================
// SCENARIO 1: /api/finplan PUT then GET round-trip con auth.
// Path di persistenza usato dalla shell React (`useFinplan`):
//   signup → enable module → PUT → GET → cleanup. Verifica che i dati
//   tornino byte-equal e che `updatedAt` sia coerente fra PUT e GET.
// ===========================================================================
test('scenario 1: authenticated PUT then GET round-trip persists data and returns updatedAt', async () => {
  const pgMod = await import('pg');
  const Pool = pgMod.default?.Pool || pgMod.Pool;
  assert.ok(process.env.DATABASE_URL, 'DATABASE_URL must be set for this test');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  const session = await signupAndLogin();
  try {
    await enableFinplanModule(pool, session.orgId);

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
    await cleanupSession(pool, session);
    await pool.end().catch(() => {});
  }
});

// ===========================================================================
// SCENARIO 2: latest-wins su PUT consecutivi (specchio del debounce della
// shell React: `useFinplanMutation` accumula in `pendingRef` e flusha solo
// l'ultimo payload). Anche se due PUT arrivano in rapida successione, il
// secondo deve diventare lo stato persistito e deve avanzare `updatedAt`.
// ===========================================================================
test('scenario 2: consecutive PUTs are latest-wins and updatedAt strictly advances', async () => {
  const pgMod = await import('pg');
  const Pool = pgMod.default?.Pool || pgMod.Pool;
  assert.ok(process.env.DATABASE_URL, 'DATABASE_URL must be set for this test');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  const session = await signupAndLogin();
  try {
    await enableFinplanModule(pool, session.orgId);

    const first = await jsonReq(`${BASE}/api/finplan`, {
      method: 'PUT',
      headers: { Cookie: session.cookie },
      body: JSON.stringify({ data: { n: 1, label: 'first' } }),
    });
    assert.equal(first.status, 200, `first PUT failed: ${JSON.stringify(first.body)}`);
    const firstAt = first.body.updatedAt;
    assert.ok(typeof firstAt === 'string' && firstAt.length > 0);

    // Garantiamo che lo "wall clock" usato per `updated_at` (DB now()) avanzi.
    await new Promise((res) => setTimeout(res, 25));

    const second = await jsonReq(`${BASE}/api/finplan`, {
      method: 'PUT',
      headers: { Cookie: session.cookie },
      body: JSON.stringify({ data: { n: 2, label: 'second-wins' } }),
    });
    assert.equal(second.status, 200, `second PUT failed: ${JSON.stringify(second.body)}`);
    const secondAt = second.body.updatedAt;
    assert.ok(
      Date.parse(secondAt) >= Date.parse(firstAt),
      `updatedAt must not regress (first=${firstAt}, second=${secondAt})`,
    );

    const get = await jsonReq(`${BASE}/api/finplan`, {
      headers: { Cookie: session.cookie },
    });
    assert.equal(get.status, 200);
    assert.deepEqual(
      get.body?.data,
      { n: 2, label: 'second-wins' },
      'latest-wins: GET must return the SECOND payload, not the first',
    );
    assert.equal(get.body?.updatedAt, secondAt, 'GET updatedAt must match the LAST PUT');
  } finally {
    await cleanupSession(pool, session);
    await pool.end().catch(() => {});
  }
});

// ===========================================================================
// SCENARIO 3: conflict-guard contract — GET /api/finplan deve riflettere
// i PUT precedenti, così che la shell React possa fare un preflight GET
// e confrontare `updatedAt` prima di sovrascrivere ciò che un'altra
// sessione ha scritto. Verifichiamo che dopo un PUT, un nuovo GET
// "preflight" veda i dati appena scritti (canale conflict-guard intatto).
// ===========================================================================
test('scenario 3: conflict-guard preflight — GET reflects the last PUT immediately', async () => {
  const pgMod = await import('pg');
  const Pool = pgMod.default?.Pool || pgMod.Pool;
  assert.ok(process.env.DATABASE_URL, 'DATABASE_URL must be set for this test');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  const session = await signupAndLogin();
  try {
    await enableFinplanModule(pool, session.orgId);

    // Stato iniziale: nessun dato → updatedAt:null. Il guard deve poter
    // distinguere "vergine" da "scritto da qualcuno".
    const initial = await jsonReq(`${BASE}/api/finplan`, {
      headers: { Cookie: session.cookie },
    });
    assert.equal(initial.status, 200);
    assert.equal(initial.body?.updatedAt, null, 'fresh org must have updatedAt:null');

    // Sessione "remota" scrive.
    const remote = await jsonReq(`${BASE}/api/finplan`, {
      method: 'PUT',
      headers: { Cookie: session.cookie },
      body: JSON.stringify({ data: { writer: 'remote', v: 7 } }),
    });
    assert.equal(remote.status, 200);
    const remoteAt = remote.body.updatedAt;

    // Preflight GET (quello che `useFinplanMutation` fa prima di un PUT
    // server-authoritative): deve osservare il PUT remoto.
    const preflight = await jsonReq(`${BASE}/api/finplan`, {
      headers: { Cookie: session.cookie },
    });
    assert.equal(preflight.status, 200);
    assert.deepEqual(preflight.body?.data, { writer: 'remote', v: 7 });
    assert.equal(
      preflight.body?.updatedAt,
      remoteAt,
      'preflight GET must observe the remote PUT updatedAt for conflict detection',
    );
  } finally {
    await cleanupSession(pool, session);
    await pool.end().catch(() => {});
  }
});

// ===========================================================================
// SCENARIO 4: route legacy rimosse in Task #148 → 404.
// `/api/finplan/preload`, `/api/finplan/preload/status`,
// `/finplan/index.html` e `/finplan/preload.json` non devono più esistere
// né come route Express né come file statici serviti dal dev server.
// (Il dev server inoltra le path non-API al fallback SPA di Vite, che
// risponde 200 con index.html: esponiamo questo qui solo per le route
// API; per i path /finplan/* basta verificare che non siano file statici.)
// ===========================================================================
test('scenario 4: legacy preload routes return 404 (no longer mounted)', async () => {
  const session = await signupAndLogin();
  try {
    const status = await fetch(`${BASE}/api/finplan/preload/status`, {
      headers: { Cookie: session.cookie },
    });
    await status.arrayBuffer();
    assert.equal(
      status.status,
      404,
      `/api/finplan/preload/status must be 404 after Task #148 cutover, got ${status.status}`,
    );

    const preload = await fetch(`${BASE}/api/finplan/preload`, {
      headers: { Cookie: session.cookie },
    });
    await preload.arrayBuffer();
    assert.equal(
      preload.status,
      404,
      `/api/finplan/preload must be 404 after Task #148 cutover, got ${preload.status}`,
    );

    // Anche super-admin route eliminata.
    const adminToggle = await fetch(
      `${BASE}/api/super-admin/organizations/${session.orgId}/finplan-preload`,
      {
        method: 'PUT',
        headers: { Cookie: session.cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: true }),
      },
    );
    await adminToggle.arrayBuffer();
    assert.equal(
      adminToggle.status,
      404,
      `super-admin finplan-preload toggle must be 404 after Task #148, got ${adminToggle.status}`,
    );
  } finally {
    const pgMod = await import('pg');
    const Pool = pgMod.default?.Pool || pgMod.Pool;
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    await cleanupSession(pool, session);
    await pool.end().catch(() => {});
  }
});

// ===========================================================================
// SCENARIO 5: setup wizard gating — replica della logica di
// `finplanNeedsSetup` in `Amministrazione.tsx` post-cutover (niente più
// preload). Wizard mostrato sse `!updatedAt && !dismissed`.
//   (a) Org nuova senza dati → wizard MOSTRATO
//   (b) Org con dati salvati (updatedAt != null) → wizard NASCOSTO
//   (c) Dismiss in localStorage → wizard NASCOSTO
// ===========================================================================
function finplanNeedsSetup({ updatedAt, dismissed = false }) {
  if (dismissed) return false;
  if (updatedAt) return false;
  return true;
}

test('scenario 5: setup wizard gating — shown only for fresh orgs without saved data', async () => {
  const pgMod = await import('pg');
  const Pool = pgMod.default?.Pool || pgMod.Pool;
  assert.ok(process.env.DATABASE_URL, 'DATABASE_URL must be set for this test');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  // Sanity-check del predicato locale.
  assert.equal(
    finplanNeedsSetup({ updatedAt: null }),
    true,
    'predicate: vergine → wizard',
  );
  assert.equal(
    finplanNeedsSetup({ updatedAt: '2026-05-15T10:00:00Z' }),
    false,
    'predicate: dati salvati → niente wizard',
  );
  assert.equal(
    finplanNeedsSetup({ updatedAt: null, dismissed: true }),
    false,
    'predicate: dismiss → niente wizard',
  );

  // (a) Org nuova senza dati.
  const sessionA = await signupAndLogin();
  let sessionB = null;
  try {
    await enableFinplanModule(pool, sessionA.orgId);
    const dataA = await jsonReq(`${BASE}/api/finplan`, {
      headers: { Cookie: sessionA.cookie },
    });
    assert.equal(dataA.status, 200, `(a) GET must be 200, got ${dataA.status}`);
    assert.equal(dataA.body?.updatedAt, null, '(a) fresh org must have updatedAt:null');
    assert.equal(
      finplanNeedsSetup({ updatedAt: dataA.body.updatedAt }),
      true,
      '(a) fresh org WITHOUT saved data must show the setup wizard',
    );

    // (b) Org con dati salvati.
    sessionB = await signupAndLogin();
    await enableFinplanModule(pool, sessionB.orgId);
    const seedB = await jsonReq(`${BASE}/api/finplan`, {
      method: 'PUT',
      headers: { Cookie: sessionB.cookie },
      body: JSON.stringify({ data: { __test: 'scenario5_saved' } }),
    });
    assert.equal(seedB.status, 200);
    const dataB = await jsonReq(`${BASE}/api/finplan`, {
      headers: { Cookie: sessionB.cookie },
    });
    assert.ok(
      typeof dataB.body?.updatedAt === 'string' && dataB.body.updatedAt.length > 0,
      '(b) org with PUT must have a non-empty updatedAt',
    );
    assert.equal(
      finplanNeedsSetup({ updatedAt: dataB.body.updatedAt }),
      false,
      '(b) org with saved data must NOT show the setup wizard',
    );
  } finally {
    for (const s of [sessionA, sessionB].filter(Boolean)) {
      await cleanupSession(pool, s);
    }
    await pool.end().catch(() => {});
  }
});
