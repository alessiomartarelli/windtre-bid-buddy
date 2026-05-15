import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
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

// ---------------------------------------------------------------------------
// Shim loader: extract the IIFE from client/public/finplan/index.html and
// run it in a vm sandbox with mocked browser globals so we can exercise the
// debounce / reconcile / conflict-guard logic deterministically.
// ---------------------------------------------------------------------------

function loadShimSource() {
  const html = fs.readFileSync(
    path.resolve(__dirname, '..', 'client', 'public', 'finplan', 'index.html'),
    'utf8',
  );
  // The shim is the FIRST <script> in <head> (no src), starting with the
  // header comment "=== FinPlan ↔ server sync".
  const m = html.match(/<script>\s*\/\* === FinPlan[\s\S]*?<\/script>/);
  assert.ok(m, 'finplan shim <script> not found in index.html');
  return m[0].replace(/^<script>/, '').replace(/<\/script>$/, '');
}

function makeSandbox({ orgId, initialKVs = {}, fetchImpl }) {
  // localStorage backed by a real Map; setItem patched by the shim must keep
  // working after patching, so we expose Storage as a real constructor.
  function Storage() {}
  Storage.prototype.setItem = function (k, v) {
    this._data.set(String(k), String(v));
  };
  Storage.prototype.getItem = function (k) {
    return this._data.has(String(k)) ? this._data.get(String(k)) : null;
  };
  Storage.prototype.removeItem = function (k) {
    this._data.delete(String(k));
  };

  const localStorage = Object.create(Storage.prototype);
  localStorage._data = new Map(Object.entries(initialKVs));

  // Capture timers so tests can deterministically flush them by delay value.
  const timers = [];
  function setTimeout(fn, ms) {
    const t = { fn, ms, cancelled: false };
    timers.push(t);
    return timers.length - 1;
  }
  function clearTimeout(id) {
    if (timers[id]) timers[id].cancelled = true;
  }

  const reload = { count: 0 };
  const consoleLog = [];
  const sandboxConsole = {
    log: (...a) => consoleLog.push(['log', ...a]),
    warn: (...a) => consoleLog.push(['warn', ...a]),
    error: (...a) => consoleLog.push(['error', ...a]),
    info: (...a) => consoleLog.push(['info', ...a]),
  };

  const documentEl = {
    body: { appendChild() {} },
    createElement: () => ({
      style: { cssText: '' },
      parentNode: null,
      appendChild() {},
    }),
    getElementById: () => null,
  };

  const windowObj = {
    location: {
      search: orgId ? `?org=${orgId}` : '',
      href: `http://localhost:5000/finplan/index.html${orgId ? `?org=${orgId}` : ''}`,
      pathname: '/finplan/index.html',
      reload: () => {
        reload.count++;
      },
    },
    localStorage,
    finplanApi: undefined,
    __finplanKey: undefined,
  };

  const sandbox = {
    window: windowObj,
    document: documentEl,
    localStorage,
    Storage,
    fetch: fetchImpl,
    setTimeout,
    clearTimeout,
    console: sandboxConsole,
    URL,
    URLSearchParams,
  };
  vm.createContext(sandbox);

  return {
    sandbox,
    timers,
    reload,
    localStorage,
    consoleLog,
    flushTimer(ms) {
      const idx = timers.findIndex((t) => !t.cancelled && t.ms === ms);
      if (idx === -1) return false;
      timers[idx].cancelled = true;
      timers[idx].fn();
      return true;
    },
    pendingTimers() {
      return timers.filter((t) => !t.cancelled).map((t) => t.ms);
    },
  };
}

const SHIM_SRC = loadShimSource();
const BASE_KEY = 'finplan_edg_20260505_134919';

async function microflush(n = 10) {
  for (let i = 0; i < n; i++) await Promise.resolve();
}

// ===========================================================================
// SCENARIO 1: ETag / 304 on second open
// ===========================================================================
test('scenario 1: /finplan/index.html sends ETag and returns 304 on revalidation', async () => {
  const r1 = await fetch(`${BASE}/finplan/index.html`);
  assert.equal(r1.status, 200, 'first request must be 200');
  const etag = r1.headers.get('etag');
  assert.ok(etag, 'first response must include an ETag header');
  const cc = r1.headers.get('cache-control') || '';
  assert.match(
    cc,
    /must-revalidate/,
    'Cache-Control must be must-revalidate so the browser revalidates each load',
  );
  // Drain body so connection closes cleanly.
  await r1.arrayBuffer();

  const r2 = await fetch(`${BASE}/finplan/index.html`, {
    headers: { 'If-None-Match': etag },
  });
  assert.equal(r2.status, 304, 'conditional GET with matching ETag must return 304');
  // 304 must not carry a body.
  const buf = await r2.arrayBuffer();
  assert.equal(buf.byteLength, 0, '304 response must have empty body');
});

// ===========================================================================
// SCENARIO 2: PUT debounce — local setItem(KEY, ...) flushes a PUT after 3s
// ===========================================================================
test('scenario 2: local edit triggers a debounced (3s) PUT carrying the new payload', async () => {
  const orgId = uniq('org');
  const fetchCalls = [];
  const fetchImpl = (url, opts) => {
    fetchCalls.push({ url, method: opts?.method || 'GET', body: opts?.body });
    if (opts?.method === 'PUT') {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({ ok: true, updatedAt: new Date().toISOString() }),
      });
    }
    // Cold-start GET: no data yet.
    return Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ data: {}, updatedAt: null, updatedBy: null }),
    });
  };

  const env = makeSandbox({ orgId, initialKVs: {}, fetchImpl });
  vm.runInContext(SHIM_SRC, env.sandbox);

  // Cold-start path: shim issues fetch() immediately (no setTimeout
  // wrapper). Wait for the promise chain to settle.
  await microflush();
  await microflush();

  const KEY = env.sandbox.window.__finplanKey;
  assert.equal(
    KEY,
    `${BASE_KEY}__org_${orgId}`,
    'window.__finplanKey must be org-scoped',
  );

  // Cold-start GET should have happened.
  const initialGets = fetchCalls.filter((c) => c.method === 'GET');
  assert.ok(initialGets.length >= 1, 'cold-start GET must fire');

  // Simulate a user edit inside the iframe. The shim's patched setItem
  // schedules a setTimeout(_, 3000). No PUT must fire yet.
  fetchCalls.length = 0;
  env.sandbox.localStorage.setItem(
    KEY,
    JSON.stringify({ __test: 'scenario2', n: 42 }),
  );
  assert.deepEqual(
    env.pendingTimers(),
    [3000],
    'setItem must schedule exactly one debounce timer at 3000ms (the configured debounce)',
  );
  assert.equal(
    fetchCalls.filter((c) => c.method === 'PUT').length,
    0,
    'no PUT must fire before the 3s debounce elapses',
  );

  // Flush the 3s debounce.
  env.flushTimer(3000);
  await microflush();

  const puts = fetchCalls.filter((c) => c.method === 'PUT');
  assert.equal(puts.length, 1, 'exactly one PUT must fire after debounce');
  const sentBody = JSON.parse(puts[0].body);
  assert.deepEqual(
    sentBody,
    { data: { __test: 'scenario2', n: 42 } },
    'PUT body must wrap the payload under {data}',
  );
});

// ===========================================================================
// SCENARIO 3: Vergine session → external server change triggers reload
// ===========================================================================
test('scenario 3: in a vergine session, a newer server updatedAt triggers reload + cache update', async () => {
  const orgId = uniq('org');
  const KEY = `${BASE_KEY}__org_${orgId}`;
  const REMOTE_AT = `${KEY}_remoteAt`;
  const oldUpdatedAt = '2026-05-14T10:00:00.000Z';
  const newUpdatedAt = '2026-05-14T11:00:00.000Z';

  const fetchCalls = [];
  const fetchImpl = (url, opts) => {
    fetchCalls.push({ url, method: opts?.method || 'GET' });
    return Promise.resolve({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          data: { __test: 'scenario3_external' },
          updatedAt: newUpdatedAt,
          updatedBy: null,
        }),
    });
  };

  const env = makeSandbox({
    orgId,
    initialKVs: {
      [KEY]: JSON.stringify({ __test: 'scenario3_old' }),
      [REMOTE_AT]: oldUpdatedAt,
    },
    fetchImpl,
  });
  vm.runInContext(SHIM_SRC, env.sandbox);

  // hasLocal=true path: shim schedules the reconcile via setTimeout(0).
  assert.ok(
    env.pendingTimers().includes(0),
    'reconcile must be scheduled via setTimeout(_, 0)',
  );

  // Flush the reconcile timer; vergine session (no setItem yet) means
  // _applyRemote() must overwrite the cache and call window.location.reload.
  env.flushTimer(0);
  await microflush();
  await microflush();

  assert.equal(
    env.reload.count,
    1,
    'window.location.reload must be called exactly once when remote is newer and session is vergine',
  );
  const cached = JSON.parse(env.localStorage.getItem(KEY));
  assert.deepEqual(
    cached,
    { __test: 'scenario3_external' },
    'cache must be overwritten with the newer server data',
  );
  assert.equal(
    env.localStorage.getItem(REMOTE_AT),
    newUpdatedAt,
    'remoteAt marker must be advanced to the newer updatedAt',
  );
});

// ===========================================================================
// SCENARIO 4: Conflict guard — dirty session must NOT be clobbered
// ===========================================================================
test('scenario 4: a local setItem before the reconcile resolves prevents reload + cache overwrite', async () => {
  const orgId = uniq('org');
  const KEY = `${BASE_KEY}__org_${orgId}`;
  const REMOTE_AT = `${KEY}_remoteAt`;
  const oldUpdatedAt = '2026-05-14T10:00:00.000Z';
  const newUpdatedAt = '2026-05-14T12:00:00.000Z';

  const fetchCalls = [];
  // Server fetch resolves "after" the user's local setItem.
  let resolveGet;
  const getPromise = new Promise((res) => {
    resolveGet = res;
  });
  const fetchImpl = (url, opts) => {
    const method = opts?.method || 'GET';
    fetchCalls.push({ url, method, body: opts?.body });
    if (method === 'PUT') {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ ok: true, updatedAt: newUpdatedAt }),
      });
    }
    // Hold the GET pending until the test releases it.
    return getPromise;
  };

  const env = makeSandbox({
    orgId,
    initialKVs: {
      [KEY]: JSON.stringify({ __test: 'scenario4_base' }),
      [REMOTE_AT]: oldUpdatedAt,
    },
    fetchImpl,
  });
  vm.runInContext(SHIM_SRC, env.sandbox);

  // Trigger the reconcile timer (issues the GET, which is now pending).
  env.flushTimer(0);
  await microflush();

  // User edits locally BEFORE the GET resolves — sets _userWroteThisSession.
  const dirtyPayload = { __test: 'scenario4_local_dirty', ts: 999 };
  env.sandbox.localStorage.setItem(KEY, JSON.stringify(dirtyPayload));

  // Now release the server response with a newer updatedAt + different data.
  resolveGet({
    ok: true,
    status: 200,
    json: () =>
      Promise.resolve({
        data: { __test: 'scenario4_external_newer' },
        updatedAt: newUpdatedAt,
        updatedBy: null,
      }),
  });
  await microflush();
  await microflush();

  // Conflict guard must trip: no reload, cache untouched.
  assert.equal(
    env.reload.count,
    0,
    'reload must NOT fire when the user has already written in this session',
  );
  const cached = JSON.parse(env.localStorage.getItem(KEY));
  assert.deepEqual(
    cached,
    dirtyPayload,
    'cache must keep the local dirty write (NOT the external newer remote)',
  );

  // Latest-wins: when the debounce flushes, the dirty write reaches the server.
  assert.deepEqual(
    env.pendingTimers(),
    [3000],
    'a single 3s debounce must be queued by the dirty setItem',
  );
  env.flushTimer(3000);
  await microflush();

  const puts = fetchCalls.filter((c) => c.method === 'PUT');
  assert.equal(puts.length, 1, 'dirty write must flush exactly one PUT');
  assert.deepEqual(
    JSON.parse(puts[0].body),
    { data: dirtyPayload },
    'PUT body must be the dirty payload (latest-wins)',
  );
});

// ===========================================================================
// SCENARIO 1b (server integration): /api/finplan PUT then GET round-trip
// with auth. Confirms the same persistence path the shim relies on, end
// to end (signup → enable module in DB → PUT → GET → cleanup).
// ===========================================================================
test('scenario 1b: authenticated PUT then GET round-trip persists data and returns updatedAt', async () => {
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
      'PUT response must include a non-empty updatedAt the shim uses as remoteAt marker',
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
    // Cleanup: DELETE finplan_data first (FK-friendly), then profile + org.
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
// SCENARIO 5: PRELOAD gating multi-tenant
// (a) Org NON allowlisted → /api/finplan/preload risponde 204 (workspace vuoto).
// (b) Accesso diretto al file statico /finplan/preload.json → 404 (bloccato a
//     livello di handler statico). Garantisce che i dati Cms Group non siano
//     leakable via URL pubblico anche senza login.
// ===========================================================================
test('scenario 5: preload gated — non-allowlisted org gets 204 and static URL is 404', async () => {
  const pgMod = await import('pg');
  const Pool = pgMod.default?.Pool || pgMod.Pool;
  assert.ok(process.env.DATABASE_URL, 'DATABASE_URL must be set for this test');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  // (b) Accesso diretto al file statico — niente auth, deve fare 404.
  const direct = await fetch(`${BASE}/finplan/preload.json`);
  assert.equal(
    direct.status,
    404,
    'preload.json must NOT be served directly by the static handler',
  );
  await direct.arrayBuffer();

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

    // E senza autenticazione: 401.
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
