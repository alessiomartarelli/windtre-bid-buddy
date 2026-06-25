import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

// Test suite Customer Journey authorization (Task #160).
// Regola security-critical: gli operatori vedono SOLO i clienti collegati ai
// loro nominativi "addetto" BiSuite (`profiles.bisuiteAddetti`); admin e
// super_admin vedono tutte le journey dell'org. Un bug (poi corretto) faceva
// sì che un operatore SENZA addetti associati vedesse TUTTI i clienti del
// tenant (contratto null-vs-empty: `null` => nessun filtro, array vuoto =>
// nessun addetto => []). Questi test bloccano la regressione su:
//   - GET /api/customer-journeys (lista)
//   - GET /api/customer-journeys/:id (dettaglio, 403 per non proprietario)
//
// Strategia: signup crea un profilo `admin` + org. La route rilegge il
// profilo dal DB ad ogni richiesta, quindi mutiamo `role`/`bisuite_addetti`
// del profilo (stessa sessione/cookie) per simulare admin/operatore/super_admin
// senza dover creare login multipli.

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
  const email = `${uniq('cj_authz_test')}@example.com`;
  const password = 'Pa55word!';
  const orgName = uniq('CJTest');
  const r = await jsonReq(`${BASE}/api/auth/signup`, {
    method: 'POST',
    body: JSON.stringify({
      email,
      password,
      fullName: 'CJ Authz Test',
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

// Inserisce una journey con un singolo item gestito da `addetto`.
// Ritorna l'id della journey creata.
async function seedJourney(pool, orgId, { customerKey, nome, addetto, driver = 'fisso', pdv = null, importo = null }) {
  const cj = await pool.query(
    `INSERT INTO customer_journeys (organization_id, customer_key, customer_type, nome, status, opened_at)
       VALUES ($1, $2, 'privato', $3, 'aperta', now())
     RETURNING id`,
    [orgId, customerKey, nome],
  );
  const journeyId = cj.rows[0].id;
  await pool.query(
    `INSERT INTO customer_journey_items (journey_id, organization_id, driver, addetto, state, data_inserimento, pdv_destinazione, importo)
       VALUES ($1, $2, $3, $4, 'inserito', now(), $5, $6)`,
    [journeyId, orgId, driver, addetto, pdv, importo],
  );
  return journeyId;
}

// Aggiunge un altro item (di un addetto/pdv diverso) a una journey esistente.
async function addItem(pool, orgId, journeyId, { addetto, driver = 'energia', pdv = null, importo = null, state = 'inserito' }) {
  await pool.query(
    `INSERT INTO customer_journey_items (journey_id, organization_id, driver, addetto, state, data_inserimento, pdv_destinazione, importo)
       VALUES ($1, $2, $3, $4, $5, now(), $6, $7)`,
    [journeyId, orgId, driver, addetto, state, pdv, importo],
  );
}

async function setRole(pool, profileId, role, addetti = []) {
  await pool.query(
    `UPDATE profiles SET role = $2, bisuite_addetti = $3::text[] WHERE id = $1`,
    [profileId, role, addetti],
  );
}

async function cleanupSession(pool, session) {
  await pool
    .query(`DELETE FROM customer_journey_items WHERE organization_id = $1`, [session.orgId])
    .catch(() => {});
  await pool
    .query(`DELETE FROM customer_journeys WHERE organization_id = $1`, [session.orgId])
    .catch(() => {});
  await pool
    .query(`DELETE FROM profiles WHERE id = $1`, [session.profileId])
    .catch(() => {});
  await pool
    .query(`DELETE FROM organizations WHERE id = $1`, [session.orgId])
    .catch(() => {});
}

function newPool() {
  return import('pg').then((pgMod) => {
    const Pool = pgMod.default?.Pool || pgMod.Pool;
    assert.ok(process.env.DATABASE_URL, 'DATABASE_URL must be set for this test');
    return new Pool({ connectionString: process.env.DATABASE_URL });
  });
}

// ===========================================================================
// SCENARIO 1: filtro lista per ruolo.
//   - admin       => vede entrambe le journey dell'org
//   - operatore senza addetti (array vuoto) => vede 0 journey (no leakage!)
//   - operatore con un addetto corrispondente => vede SOLO la sua journey
//   - super_admin => vede entrambe le journey dell'org
// ===========================================================================
test('scenario 1: GET /api/customer-journeys is filtered by role and operator addetti', async () => {
  const pool = await newPool();
  const session = await signupAndLogin();
  try {
    // Due journey gestite da addetti diversi.
    const jMario = await seedJourney(pool, session.orgId, {
      customerKey: uniq('CFMARIO').toUpperCase(),
      nome: 'Cliente Mario',
      addetto: 'MARIO ROSSI',
    });
    await seedJourney(pool, session.orgId, {
      customerKey: uniq('CFLUIGI').toUpperCase(),
      nome: 'Cliente Luigi',
      addetto: 'LUIGI VERDI',
    });

    // (a) admin => entrambe.
    await setRole(pool, session.profileId, 'admin');
    const asAdmin = await jsonReq(`${BASE}/api/customer-journeys`, {
      headers: { Cookie: session.cookie },
    });
    assert.equal(asAdmin.status, 200, `admin list failed: ${JSON.stringify(asAdmin.body)}`);
    assert.equal(asAdmin.body.length, 2, 'admin must see all org journeys');

    // (b) operatore SENZA addetti => 0 journey (la regressione che testiamo).
    await setRole(pool, session.profileId, 'operatore', []);
    const noAddetti = await jsonReq(`${BASE}/api/customer-journeys`, {
      headers: { Cookie: session.cookie },
    });
    assert.equal(noAddetti.status, 200, `operator(empty) list failed: ${JSON.stringify(noAddetti.body)}`);
    assert.equal(
      noAddetti.body.length,
      0,
      'operator WITHOUT addetti must see 0 journeys (no tenant leakage)',
    );

    // (c) operatore con un addetto corrispondente => solo la sua.
    //     Usiamo casing diverso per verificare il match case-insensitive.
    await setRole(pool, session.profileId, 'operatore', ['mario rossi']);
    const matching = await jsonReq(`${BASE}/api/customer-journeys`, {
      headers: { Cookie: session.cookie },
    });
    assert.equal(matching.status, 200, `operator(match) list failed: ${JSON.stringify(matching.body)}`);
    assert.equal(matching.body.length, 1, 'operator must see exactly their own journey');
    assert.equal(matching.body[0].id, jMario, 'operator must see Mario journey, not Luigi');

    // (d) super_admin => entrambe.
    await setRole(pool, session.profileId, 'super_admin');
    const asSuper = await jsonReq(`${BASE}/api/customer-journeys`, {
      headers: { Cookie: session.cookie },
    });
    assert.equal(asSuper.status, 200, `super_admin list failed: ${JSON.stringify(asSuper.body)}`);
    assert.equal(asSuper.body.length, 2, 'super_admin must see all org journeys');
  } finally {
    await cleanupSession(pool, session);
    await pool.end().catch(() => {});
  }
});

// ===========================================================================
// SCENARIO 2: dettaglio per-operatore.
//   - operatore proprietario (addetto match) => 200 con journey/items/drivers
//   - operatore NON proprietario => 403
//   - operatore senza addetti => 403 anche sulla journey altrui
//   - admin => 200 su qualunque journey dell'org
// ===========================================================================
test('scenario 2: GET /api/customer-journeys/:id enforces per-operator ownership', async () => {
  const pool = await newPool();
  const session = await signupAndLogin();
  try {
    const jMario = await seedJourney(pool, session.orgId, {
      customerKey: uniq('CFMARIO').toUpperCase(),
      nome: 'Cliente Mario',
      addetto: 'MARIO ROSSI',
    });
    const jLuigi = await seedJourney(pool, session.orgId, {
      customerKey: uniq('CFLUIGI').toUpperCase(),
      nome: 'Cliente Luigi',
      addetto: 'LUIGI VERDI',
    });

    // (a) operatore proprietario di Mario => 200 su Mario.
    await setRole(pool, session.profileId, 'operatore', ['MARIO ROSSI']);
    const ownDetail = await jsonReq(`${BASE}/api/customer-journeys/${jMario}`, {
      headers: { Cookie: session.cookie },
    });
    assert.equal(ownDetail.status, 200, `owner detail failed: ${JSON.stringify(ownDetail.body)}`);
    assert.equal(ownDetail.body?.journey?.id, jMario, 'detail must return the owned journey');
    assert.ok(Array.isArray(ownDetail.body?.items), 'detail must include items array');
    assert.ok(Array.isArray(ownDetail.body?.drivers), 'detail must include drivers array');

    // (b) stesso operatore su journey altrui (Luigi) => 403.
    const foreignDetail = await jsonReq(`${BASE}/api/customer-journeys/${jLuigi}`, {
      headers: { Cookie: session.cookie },
    });
    assert.equal(
      foreignDetail.status,
      403,
      `operator must get 403 on a journey they do not own, got ${foreignDetail.status}`,
    );

    // (c) operatore senza addetti => 403 anche su Mario.
    await setRole(pool, session.profileId, 'operatore', []);
    const noAddettiDetail = await jsonReq(`${BASE}/api/customer-journeys/${jMario}`, {
      headers: { Cookie: session.cookie },
    });
    assert.equal(
      noAddettiDetail.status,
      403,
      `operator without addetti must get 403, got ${noAddettiDetail.status}`,
    );

    // (d) admin => 200 su qualunque journey.
    await setRole(pool, session.profileId, 'admin');
    const adminDetail = await jsonReq(`${BASE}/api/customer-journeys/${jLuigi}`, {
      headers: { Cookie: session.cookie },
    });
    assert.equal(adminDetail.status, 200, `admin detail failed: ${JSON.stringify(adminDetail.body)}`);
    assert.equal(adminDetail.body?.journey?.id, jLuigi, 'admin must access any org journey');
  } finally {
    await cleanupSession(pool, session);
    await pool.end().catch(() => {});
  }
});

// ===========================================================================
// SCENARIO 3: reportistica per-operatore (Task #187).
// GET /api/customer-journeys/report restituisce righe item-level aggregabili.
// Deve rispettare la stessa regola di isolamento della lista:
//   - admin       => righe di tutte le journey dell'org
//   - operatore senza addetti (array vuoto) => 0 righe (no leakage!)
//   - operatore con addetto corrispondente => SOLO le proprie righe
//   - super_admin => tutte le righe dell'org
// ===========================================================================
test('scenario 3: GET /api/customer-journeys/report enforces per-operator isolation', async () => {
  const pool = await newPool();
  const session = await signupAndLogin();
  try {
    await seedJourney(pool, session.orgId, {
      customerKey: uniq('CFMARIO').toUpperCase(),
      nome: 'Cliente Mario',
      addetto: 'MARIO ROSSI',
      pdv: 'PDV Milano',
      importo: '100.50',
    });
    await seedJourney(pool, session.orgId, {
      customerKey: uniq('CFLUIGI').toUpperCase(),
      nome: 'Cliente Luigi',
      addetto: 'LUIGI VERDI',
      pdv: 'PDV Roma',
      importo: '200.00',
    });

    // (a) admin => entrambe le righe.
    await setRole(pool, session.profileId, 'admin');
    const asAdmin = await jsonReq(`${BASE}/api/customer-journeys/report`, {
      headers: { Cookie: session.cookie },
    });
    assert.equal(asAdmin.status, 200, `admin report failed: ${JSON.stringify(asAdmin.body)}`);
    assert.equal(asAdmin.body.length, 2, 'admin must see all org report rows');
    const adminAddetti = asAdmin.body.map((r) => r.addetto).sort();
    assert.deepEqual(adminAddetti, ['LUIGI VERDI', 'MARIO ROSSI'], 'admin report includes both addetti');

    // (b) operatore SENZA addetti => 0 righe (regressione no leakage).
    await setRole(pool, session.profileId, 'operatore', []);
    const noAddetti = await jsonReq(`${BASE}/api/customer-journeys/report`, {
      headers: { Cookie: session.cookie },
    });
    assert.equal(noAddetti.status, 200, `operator(empty) report failed: ${JSON.stringify(noAddetti.body)}`);
    assert.equal(
      noAddetti.body.length,
      0,
      'operator WITHOUT addetti must see 0 report rows (no tenant leakage)',
    );

    // (c) operatore con addetto corrispondente (case-insensitive) => solo le sue.
    await setRole(pool, session.profileId, 'operatore', ['mario rossi']);
    const matching = await jsonReq(`${BASE}/api/customer-journeys/report`, {
      headers: { Cookie: session.cookie },
    });
    assert.equal(matching.status, 200, `operator(match) report failed: ${JSON.stringify(matching.body)}`);
    assert.equal(matching.body.length, 1, 'operator must see exactly their own report rows');
    assert.equal(matching.body[0].addetto, 'MARIO ROSSI', 'operator report row must be Mario, not Luigi');
    assert.equal(matching.body[0].pdv, 'PDV Milano', 'report row carries the item PDV');
    assert.equal(matching.body[0].valore, 100.5, 'report row carries the numeric valore');

    // (d) super_admin => entrambe.
    await setRole(pool, session.profileId, 'super_admin');
    const asSuper = await jsonReq(`${BASE}/api/customer-journeys/report`, {
      headers: { Cookie: session.cookie },
    });
    assert.equal(asSuper.status, 200, `super_admin report failed: ${JSON.stringify(asSuper.body)}`);
    assert.equal(asSuper.body.length, 2, 'super_admin must see all org report rows');
  } finally {
    await cleanupSession(pool, session);
    await pool.end().catch(() => {});
  }
});

// ---------------------------------------------------------------------------
// SCENARIO 4: facet della lista isolate su journey con item di più addetti
// (Task #187). Una stessa journey contiene item di Mario e Luigi: un operatore
// con solo l'addetto Mario NON deve vedere il PDV/addetto/stato di Luigi nelle
// facet usate dai filtri della lista schede. Admin vede entrambi.
// ---------------------------------------------------------------------------
test('scenario 4: list facets isolate per-operator on a mixed-addetto journey', async () => {
  const pool = await newPool();
  const session = await signupAndLogin();
  try {
    // Journey condivisa: item Mario (PDV Milano) + item Luigi (PDV Roma).
    const jid = await seedJourney(pool, session.orgId, {
      customerKey: uniq('CFMIX').toUpperCase(),
      nome: 'Cliente Misto',
      addetto: 'MARIO ROSSI',
      driver: 'fisso',
      pdv: 'PDV Milano',
      importo: '100.50',
    });
    await addItem(pool, session.orgId, jid, {
      addetto: 'LUIGI VERDI',
      driver: 'energia',
      pdv: 'PDV Roma',
      importo: '50.00',
      state: 'attivato',
    });

    // (a) admin => facet con entrambi gli addetti / PDV / stati.
    await setRole(pool, session.profileId, 'admin');
    const asAdmin = await jsonReq(`${BASE}/api/customer-journeys`, {
      headers: { Cookie: session.cookie },
    });
    assert.equal(asAdmin.status, 200, `admin list failed: ${JSON.stringify(asAdmin.body)}`);
    const adminJ = asAdmin.body.find((j) => j.id === jid);
    assert.ok(adminJ, 'admin must see the mixed journey');
    assert.deepEqual([...adminJ.addetti].sort(), ['LUIGI VERDI', 'MARIO ROSSI'], 'admin facet has both addetti');
    assert.deepEqual([...adminJ.pdvs].sort(), ['PDV Milano', 'PDV Roma'], 'admin facet has both PDVs');

    // (b) operatore con solo MARIO => facet con solo i suoi valori, niente Luigi.
    await setRole(pool, session.profileId, 'operatore', ['MARIO ROSSI']);
    const asOp = await jsonReq(`${BASE}/api/customer-journeys`, {
      headers: { Cookie: session.cookie },
    });
    assert.equal(asOp.status, 200, `operator list failed: ${JSON.stringify(asOp.body)}`);
    const opJ = asOp.body.find((j) => j.id === jid);
    assert.ok(opJ, 'operator with matching addetto must still see the journey');
    assert.deepEqual(opJ.addetti, ['MARIO ROSSI'], 'operator facet must NOT leak Luigi addetto');
    assert.deepEqual(opJ.pdvs, ['PDV Milano'], 'operator facet must NOT leak PDV Roma');
    assert.ok(!opJ.states.includes('attivato'), 'operator facet must NOT leak Luigi item state');
  } finally {
    await cleanupSession(pool, session);
    await pool.end().catch(() => {});
  }
});
