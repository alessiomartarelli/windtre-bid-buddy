import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

// Test suite di authorization per la dashboard gare addetto (Task #175).
//
// Regola security-critical: nella route
//   GET /api/incentivazione/dashboard/:month/:year   (server/routes.ts)
// admin e super_admin vedono i dati live Accessori/Servizi (`live`) e le
// righe valenze di TUTTI gli addetti dell'org; un operatore vede SOLO i propri
// addetti (`profiles.bisuiteAddetti`, match case-insensitive via normN); un
// operatore SENZA addetti (array vuoto) NON deve vedere nulla (mai leak del
// tenant). Stessa regola null-vs-empty dell'isolamento Customer Journey:
// `addettiFilter === null` (admin/super) => nessun filtro; array (anche vuoto)
// => `allowed(name)` vero solo se il nome è incluso.
//
// Si verificano DUE superfici della risposta:
//   - `live`  (somme Accessori/Servizi da BiSuite, filtrate per addetto)
//   - `valenze[sectionId].rows`  (valenze piste, filtrate per addetto)
//
// Strategia (come tests/customer-journey-authz.test.mjs): signup crea un
// profilo `admin` + org. La route rilegge il profilo dal DB ad ogni richiesta,
// quindi mutiamo `role`/`bisuite_addetti` dello stesso profilo (stessa
// sessione/cookie) per simulare admin/operatore/super_admin.
//
// È DB-backed e passa dall'HTTP: richiede DATABASE_URL e il workflow
// "Start application" attivo su localhost:5000.

const BASE = process.env.FINPLAN_BASE_URL || 'http://localhost:5000';

// Mese interamente nel passato rispetto a "now" reale: buildCalendar produce
// allora una finestra che copre TUTTO il mese (from = 1° giorno, to = ultimo
// giorno), così le vendite di test cadono sempre nell'intervallo. Se invece
// usassimo un mese futuro/corrente la finestra sarebbe parziale e le vendite
// rischierebbero di restare fuori range.
function pastMonthYear() {
  const now = new Date();
  // primo giorno del mese corrente, poi -1 giorno => mese precedente
  const d = new Date(now.getFullYear(), now.getMonth(), 1);
  d.setDate(d.getDate() - 1);
  return { month: d.getMonth() + 1, year: d.getFullYear() };
}

const { month: MONTH, year: YEAR } = pastMonthYear();
// Vendita a metà mese: sempre dentro la finestra del mese passato.
const SALE_DATE = `${YEAR}-${String(MONTH).padStart(2, '0')}-15T10:00:00.000Z`;

// Categorie di test (mappate nella config inserita).
const CAT_ACC = [9100, 9101];
const CAT_SERV = [9200, 9201];

const SECTION_ID = 'ss_w3';

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
  const email = `${uniq('inc_authz_test')}@example.com`;
  const password = 'Pa55word!';
  const orgName = uniq('IncTest');
  const r = await jsonReq(`${BASE}/api/auth/signup`, {
    method: 'POST',
    body: JSON.stringify({
      email,
      password,
      fullName: 'Inc Authz Test',
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

async function seedConfig(pool, orgId) {
  // catAcc/catServ noti, così sappiamo quali categorie contano nelle somme.
  const config = { catAcc: CAT_ACC, catServ: CAT_SERV };
  await pool.query(
    `INSERT INTO incentivazione_config (organization_id, month, year, config)
       VALUES ($1, $2, $3, $4::jsonb)`,
    [orgId, MONTH, YEAR, JSON.stringify(config)],
  );
}

async function seedValenze(pool, orgId, names) {
  const rows = names.map((name) => ({ name, p1: 1 }));
  await pool.query(
    `INSERT INTO incentivazione_valenze (organization_id, month, year, section_id, file_name, rows)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
    [orgId, MONTH, YEAR, SECTION_ID, 'valenze-test.xlsx', JSON.stringify(rows)],
  );
}

// Inserisce una vendita BiSuite con un articolo Accessorio (cat 9100).
async function insertSale(pool, orgId, addetto, prezzo) {
  const bisuiteId = Math.floor(Math.random() * 2_000_000_000);
  const raw = {
    addetto: { nominativo: addetto },
    articoli: [{ categoria: { id: CAT_ACC[0] }, dettaglio: { prezzo: String(prezzo) } }],
  };
  await pool.query(
    `INSERT INTO bisuite_sales
       (organization_id, bisuite_id, data_vendita, nome_addetto, stato, raw_data)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
    [orgId, bisuiteId, SALE_DATE, addetto, 'ATTIVO', JSON.stringify(raw)],
  );
}

async function setRole(pool, profileId, role, addetti = []) {
  await pool.query(
    `UPDATE profiles SET role = $2, bisuite_addetti = $3::text[] WHERE id = $1`,
    [profileId, role, addetti],
  );
}

async function cleanupSession(pool, session) {
  const { orgId, profileId } = session;
  await pool.query(`DELETE FROM bisuite_sales WHERE organization_id = $1`, [orgId]).catch(() => {});
  await pool.query(`DELETE FROM incentivazione_valenze WHERE organization_id = $1`, [orgId]).catch(() => {});
  await pool.query(`DELETE FROM incentivazione_config WHERE organization_id = $1`, [orgId]).catch(() => {});
  await pool.query(`DELETE FROM profiles WHERE id = $1`, [profileId]).catch(() => {});
  await pool.query(`DELETE FROM organizations WHERE id = $1`, [orgId]).catch(() => {});
}

function newPool() {
  return import('pg').then((pgMod) => {
    const Pool = pgMod.default?.Pool || pgMod.Pool;
    assert.ok(process.env.DATABASE_URL, 'DATABASE_URL must be set for this test');
    return new Pool({ connectionString: process.env.DATABASE_URL });
  });
}

async function fetchDashboard(session) {
  return jsonReq(`${BASE}/api/incentivazione/dashboard/${MONTH}/${YEAR}`, {
    headers: { Cookie: session.cookie },
  });
}

function liveNames(body) {
  return (body?.live ?? []).map((l) => String(l.name).toLowerCase().trim()).sort();
}

function valenzeNames(body) {
  const rows = body?.valenze?.[SECTION_ID]?.rows ?? [];
  return rows.map((r) => String(r.name).toLowerCase().trim()).sort();
}

// ===========================================================================
// SCENARIO 1: i dati LIVE Accessori/Servizi sono filtrati per ruolo/addetti.
//   - admin       => vede entrambi gli addetti
//   - operatore senza addetti (array vuoto) => 0 (no leak)
//   - operatore con un addetto => SOLO il proprio (case-insensitive)
//   - super_admin => vede entrambi
// ===========================================================================
test('scenario 1: dashboard live data is filtered by role and operator addetti', async () => {
  const pool = await newPool();
  const session = await signupAndLogin();
  try {
    await seedConfig(pool, session.orgId);
    await insertSale(pool, session.orgId, 'MARIO ROSSI', 50);
    await insertSale(pool, session.orgId, 'LUIGI VERDI', 80);

    // (a) admin => entrambi.
    await setRole(pool, session.profileId, 'admin');
    const asAdmin = await fetchDashboard(session);
    assert.equal(asAdmin.status, 200, `admin dashboard failed: ${JSON.stringify(asAdmin.body)}`);
    assert.deepEqual(
      liveNames(asAdmin.body),
      ['luigi verdi', 'mario rossi'],
      'admin must see live data for all addetti',
    );

    // (b) operatore SENZA addetti => 0 (la regressione che testiamo).
    await setRole(pool, session.profileId, 'operatore', []);
    const noAddetti = await fetchDashboard(session);
    assert.equal(noAddetti.status, 200, `operator(empty) dashboard failed: ${JSON.stringify(noAddetti.body)}`);
    assert.deepEqual(
      liveNames(noAddetti.body),
      [],
      'operator WITHOUT addetti must see 0 live rows (no tenant leakage)',
    );

    // (c) operatore con un addetto (casing diverso) => solo il proprio.
    await setRole(pool, session.profileId, 'operatore', ['mario rossi']);
    const matching = await fetchDashboard(session);
    assert.equal(matching.status, 200, `operator(match) dashboard failed: ${JSON.stringify(matching.body)}`);
    assert.deepEqual(
      liveNames(matching.body),
      ['mario rossi'],
      'operator must see only their own live row (case-insensitive)',
    );
    // Sanity: la somma acc è quella di MARIO, non di LUIGI.
    const mario = matching.body.live.find((l) => l.name.toLowerCase().trim() === 'mario rossi');
    assert.equal(mario.acc, 50, 'operator live acc must be their own value');

    // (d) super_admin => entrambi.
    await setRole(pool, session.profileId, 'super_admin');
    const asSuper = await fetchDashboard(session);
    assert.equal(asSuper.status, 200, `super_admin dashboard failed: ${JSON.stringify(asSuper.body)}`);
    assert.deepEqual(
      liveNames(asSuper.body),
      ['luigi verdi', 'mario rossi'],
      'super_admin must see live data for all addetti',
    );
  } finally {
    await cleanupSession(pool, session);
    await pool.end().catch(() => {});
  }
});

// ===========================================================================
// SCENARIO 3 (Task #273, multi-config): gestione configurazioni con nome.
//   - la creazione/rinomina/duplicazione/eliminazione è SOLO admin/super
//     (operatore => 403);
//   - due configurazioni con nomi diversi coesistono nello stesso mese
//     (nome duplicato => 409);
//   - la dashboard seleziona la config via /:configId e espone `configs`.
// ===========================================================================
test('scenario 3: multi-config management is admin-only, coexists per month, dashboard selects by configId', async () => {
  const pool = await newPool();
  const session = await signupAndLogin();
  try {
    await setRole(pool, session.profileId, 'admin');

    // (a) admin crea la prima config con nome.
    const created1 = await jsonReq(`${BASE}/api/incentivazione/configs`, {
      method: 'POST',
      headers: { Cookie: session.cookie },
      body: JSON.stringify({ month: MONTH, year: YEAR, name: 'Gara A', config: { catAcc: CAT_ACC, catServ: CAT_SERV } }),
    });
    assert.equal(created1.status, 201, `create #1 failed: ${JSON.stringify(created1.body)}`);
    assert.equal(created1.body.name, 'Gara A');

    // (b) seconda config con nome diverso nello STESSO mese => coesiste.
    const created2 = await jsonReq(`${BASE}/api/incentivazione/configs`, {
      method: 'POST',
      headers: { Cookie: session.cookie },
      body: JSON.stringify({ month: MONTH, year: YEAR, name: 'Gara B', sourceId: created1.body.id }),
    });
    assert.equal(created2.status, 201, `create #2 (duplicate from source) failed: ${JSON.stringify(created2.body)}`);

    // (c) stesso nome (case-insensitive) => 409.
    const dupName = await jsonReq(`${BASE}/api/incentivazione/configs`, {
      method: 'POST',
      headers: { Cookie: session.cookie },
      body: JSON.stringify({ month: MONTH, year: YEAR, name: 'gara a' }),
    });
    assert.equal(dupName.status, 409, 'duplicate name in same period must be rejected');

    // (d) la lista admin contiene entrambe.
    const list = await jsonReq(`${BASE}/api/incentivazione/configs`, {
      headers: { Cookie: session.cookie },
    });
    assert.equal(list.status, 200);
    const names = list.body.filter((c) => c.month === MONTH && c.year === YEAR).map((c) => c.name).sort();
    assert.deepEqual(names, ['Gara A', 'Gara B'], 'both configs must coexist in the same month');

    // (e) rinomina.
    const renamed = await jsonReq(`${BASE}/api/incentivazione/configs/${created2.body.id}`, {
      method: 'PATCH',
      headers: { Cookie: session.cookie },
      body: JSON.stringify({ name: 'Gara B2' }),
    });
    assert.equal(renamed.status, 200, `rename failed: ${JSON.stringify(renamed.body)}`);
    assert.equal(renamed.body.name, 'Gara B2');

    // (f) la dashboard espone `configs` a TUTTI e seleziona per :configId.
    const dashDefault = await fetchDashboard(session);
    assert.equal(dashDefault.status, 200);
    assert.equal(dashDefault.body.configs.length, 2, 'dashboard must list both configs');
    assert.equal(dashDefault.body.configId, created1.body.id, 'default = first/oldest config');
    const dashB = await jsonReq(
      `${BASE}/api/incentivazione/dashboard/${MONTH}/${YEAR}/${created2.body.id}`,
      { headers: { Cookie: session.cookie } },
    );
    assert.equal(dashB.status, 200);
    assert.equal(dashB.body.configId, created2.body.id, 'dashboard must honor :configId');
    assert.equal(dashB.body.configName, 'Gara B2');
    // configId inesistente => 404.
    const dashMissing = await jsonReq(
      `${BASE}/api/incentivazione/dashboard/${MONTH}/${YEAR}/00000000-0000-0000-0000-000000000000`,
      { headers: { Cookie: session.cookie } },
    );
    assert.equal(dashMissing.status, 404, 'unknown configId must be 404');

    // (g) operatore: la gestione è vietata (403) su tutte le superfici,
    // ma la dashboard resta accessibile con l'elenco configs.
    await setRole(pool, session.profileId, 'operatore', ['mario rossi']);
    const opList = await jsonReq(`${BASE}/api/incentivazione/configs`, { headers: { Cookie: session.cookie } });
    assert.equal(opList.status, 403, 'operator must not list configs (admin surface)');
    const opCreate = await jsonReq(`${BASE}/api/incentivazione/configs`, {
      method: 'POST',
      headers: { Cookie: session.cookie },
      body: JSON.stringify({ month: MONTH, year: YEAR, name: 'Hack' }),
    });
    assert.equal(opCreate.status, 403, 'operator must not create configs');
    const opPatch = await jsonReq(`${BASE}/api/incentivazione/configs/${created1.body.id}`, {
      method: 'PATCH',
      headers: { Cookie: session.cookie },
      body: JSON.stringify({ name: 'Hack' }),
    });
    assert.equal(opPatch.status, 403, 'operator must not rename configs');
    const opDelete = await jsonReq(`${BASE}/api/incentivazione/configs/${created1.body.id}`, {
      method: 'DELETE',
      headers: { Cookie: session.cookie },
    });
    assert.equal(opDelete.status, 403, 'operator must not delete configs');
    const opDash = await fetchDashboard(session);
    assert.equal(opDash.status, 200, 'operator dashboard must still work');
    assert.equal(opDash.body.configs.length, 2, 'operator sees the configs list for the selector');

    // (h) admin elimina la seconda config.
    await setRole(pool, session.profileId, 'admin');
    const del = await jsonReq(`${BASE}/api/incentivazione/configs/${created2.body.id}`, {
      method: 'DELETE',
      headers: { Cookie: session.cookie },
    });
    assert.equal(del.status, 200, `delete failed: ${JSON.stringify(del.body)}`);
    const dashAfter = await fetchDashboard(session);
    assert.equal(dashAfter.body.configs.length, 1, 'deleted config must disappear from dashboard list');
  } finally {
    await cleanupSession(pool, session);
    await pool.end().catch(() => {});
  }
});

// ===========================================================================
// SCENARIO 2: le righe VALENZE restituite dalla dashboard sono filtrate per
// addetto esattamente come i dati live.
//   - admin       => tutte le righe
//   - operatore senza addetti => 0 righe
//   - operatore con un addetto => solo la propria riga
//   - super_admin => tutte le righe
// ===========================================================================
test('scenario 2: dashboard valenze rows are filtered by role and operator addetti', async () => {
  const pool = await newPool();
  const session = await signupAndLogin();
  try {
    await seedConfig(pool, session.orgId);
    await seedValenze(pool, session.orgId, ['MARIO ROSSI', 'LUIGI VERDI']);

    // (a) admin => entrambe le righe.
    await setRole(pool, session.profileId, 'admin');
    const asAdmin = await fetchDashboard(session);
    assert.equal(asAdmin.status, 200, `admin dashboard failed: ${JSON.stringify(asAdmin.body)}`);
    assert.deepEqual(
      valenzeNames(asAdmin.body),
      ['luigi verdi', 'mario rossi'],
      'admin must see valenze rows for all addetti',
    );

    // (b) operatore SENZA addetti => 0 righe (no leak).
    await setRole(pool, session.profileId, 'operatore', []);
    const noAddetti = await fetchDashboard(session);
    assert.equal(noAddetti.status, 200, `operator(empty) dashboard failed: ${JSON.stringify(noAddetti.body)}`);
    assert.deepEqual(
      valenzeNames(noAddetti.body),
      [],
      'operator WITHOUT addetti must see 0 valenze rows (no tenant leakage)',
    );

    // (c) operatore con un addetto (casing diverso) => solo la propria riga.
    await setRole(pool, session.profileId, 'operatore', ['MARIO ROSSI']);
    const matching = await fetchDashboard(session);
    assert.equal(matching.status, 200, `operator(match) dashboard failed: ${JSON.stringify(matching.body)}`);
    assert.deepEqual(
      valenzeNames(matching.body),
      ['mario rossi'],
      'operator must see only their own valenze row (case-insensitive)',
    );

    // (d) super_admin => entrambe le righe.
    await setRole(pool, session.profileId, 'super_admin');
    const asSuper = await fetchDashboard(session);
    assert.equal(asSuper.status, 200, `super_admin dashboard failed: ${JSON.stringify(asSuper.body)}`);
    assert.deepEqual(
      valenzeNames(asSuper.body),
      ['luigi verdi', 'mario rossi'],
      'super_admin must see valenze rows for all addetti',
    );
  } finally {
    await cleanupSession(pool, session);
    await pool.end().catch(() => {});
  }
});
