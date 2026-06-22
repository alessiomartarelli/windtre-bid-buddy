import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

// Test suite Customer Journey: data trigger configurabile per org (Task #167).
//
// La data dalla quale si aprono le journey (nuova attivazione mobile) non è
// più una costante: è memorizzata in
// `organization_config.config.customerJourneyTriggerDate` ed è modificabile da
// un admin via `PUT /api/customer-journey-config`. Il reconcile deve usare la
// data configurata; in mancanza, il default 2026-07-01.
//
// Strategia: signup crea un profilo `admin` + org. Inseriamo una vendita
// BiSuite con un'attivazione mobile datata PRIMA del default (2026-05-15):
//   - con la config di default la journey NON si apre (data < 2026-07-01);
//   - dopo aver anticipato la data trigger a 2026-01-01 la journey si apre.

const BASE = process.env.FINPLAN_BASE_URL || 'http://localhost:5000';

// Datata prima del default 2026-07-01: con il default NON apre la journey.
const EARLY_SALE_DATE = '2026-05-15T10:00:00.000Z';
const DEFAULT_TRIGGER = '2026-07-01';
const EARLIER_TRIGGER = '2026-01-01';

const ART_TRIGGER = 1000;

function uniq(prefix) {
  return `${prefix}_${crypto.randomBytes(4).toString('hex')}`;
}

async function jsonReq(url, opts = {}) {
  const r = await fetch(url, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
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
  return arr.map((c) => c.split(';')[0]).filter(Boolean).join('; ');
}

async function signupAndLogin() {
  const email = `${uniq('cj_trigger_test')}@example.com`;
  const r = await jsonReq(`${BASE}/api/auth/signup`, {
    method: 'POST',
    body: JSON.stringify({
      email,
      password: 'Pa55word!',
      fullName: 'CJ Trigger Test',
      organizationName: uniq('CJTrigger'),
    }),
  });
  assert.equal(r.status, 201, `signup failed: ${JSON.stringify(r.body)}`);
  const cookie = pickCookie(r.headers);
  assert.ok(cookie, 'no session cookie returned by signup');
  const profileId = r.body?.id;
  const orgId = r.body?.organization?.id || r.body?.organizationId;
  assert.ok(profileId && orgId, `missing ids in signup response: ${JSON.stringify(r.body)}`);
  return { email, cookie, profileId, orgId };
}

function buildRawData(cf) {
  return {
    cliente: {
      codiceFiscale: cf,
      clienteTipo: 'FISICA',
      nome: 'Anna',
      cognome: 'Bianchi',
      tel1: '3331234567',
      codiceEsterno: 'CLI777',
    },
    addetto: { nominativo: 'ANNA BIANCHI' },
    attivita: { nominativo: 'PDV ORIGINE' },
    importoScontrino: 0,
    articoli: [
      {
        id: ART_TRIGGER,
        categoria: { nome: 'UNTIED' },
        tipologia: { nome: 'RICARICABILE' },
        descrizione: 'Nuova SIM mobile',
        dettaglio: { prezzo: 0 },
      },
    ],
  };
}

async function insertSale(pool, orgId, cf) {
  const bisuiteId = Math.floor(Math.random() * 2_000_000_000);
  const res = await pool.query(
    `INSERT INTO bisuite_sales
       (organization_id, bisuite_id, data_vendita, nome_addetto, stato, raw_data)
     VALUES ($1, $2, $3, 'ANNA BIANCHI', 'ATTIVO', $4::jsonb)
     RETURNING id`,
    [orgId, bisuiteId, EARLY_SALE_DATE, JSON.stringify(buildRawData(cf))],
  );
  return res.rows[0].id;
}

async function reconcile(session) {
  const r = await jsonReq(`${BASE}/api/customer-journeys/reconcile`, {
    method: 'POST',
    headers: { Cookie: session.cookie },
  });
  assert.equal(r.status, 200, `reconcile failed: ${JSON.stringify(r.body)}`);
  return r.body;
}

async function cleanupSession(pool, session) {
  for (const q of [
    [`DELETE FROM customer_journey_items WHERE organization_id = $1`, [session.orgId]],
    [`DELETE FROM customer_journeys WHERE organization_id = $1`, [session.orgId]],
    [`DELETE FROM bisuite_sales WHERE organization_id = $1`, [session.orgId]],
    [`DELETE FROM organization_config WHERE organization_id = $1`, [session.orgId]],
    [`DELETE FROM profiles WHERE id = $1`, [session.profileId]],
    [`DELETE FROM organizations WHERE id = $1`, [session.orgId]],
  ]) {
    await pool.query(q[0], q[1]).catch(() => {});
  }
}

function newPool() {
  return import('pg').then((pgMod) => {
    const Pool = pgMod.default?.Pool || pgMod.Pool;
    assert.ok(process.env.DATABASE_URL, 'DATABASE_URL must be set for this test');
    return new Pool({ connectionString: process.env.DATABASE_URL });
  });
}

// ===========================================================================
// SCENARIO 1: con la data di default una vendita anteriore al trigger NON
// apre la journey; anticipando la data trigger la journey si apre.
// ===========================================================================
test('scenario 1: configurable trigger date drives journey opening', async () => {
  const pool = await newPool();
  const session = await signupAndLogin();
  const cf = uniq('BNCANN').toUpperCase();
  try {
    await insertSale(pool, session.orgId, cf);

    // GET di default: triggerDate == default.
    const cfg0 = await jsonReq(`${BASE}/api/customer-journey-config`, {
      headers: { Cookie: session.cookie },
    });
    assert.equal(cfg0.status, 200, `config GET failed: ${JSON.stringify(cfg0.body)}`);
    assert.equal(cfg0.body.triggerDate, DEFAULT_TRIGGER, 'default triggerDate must be 2026-07-01');
    assert.equal(cfg0.body.defaultTriggerDate, DEFAULT_TRIGGER);

    // (1) reconcile con default: la vendita di maggio è anteriore => 0 journey.
    const r0 = await reconcile(session);
    assert.equal(r0.journeys, 0, 'sale before default trigger must NOT open a journey');

    // (2) anticipa la data trigger.
    const put = await jsonReq(`${BASE}/api/customer-journey-config`, {
      method: 'PUT',
      headers: { Cookie: session.cookie },
      body: JSON.stringify({ triggerDate: EARLIER_TRIGGER }),
    });
    assert.equal(put.status, 200, `config PUT failed: ${JSON.stringify(put.body)}`);
    assert.equal(put.body.triggerDate, EARLIER_TRIGGER, 'PUT must persist the new trigger date');

    // (3) reconcile con data anticipata: ora la journey si apre.
    const r1 = await reconcile(session);
    assert.equal(r1.journeys, 1, 'sale after the earlier trigger must open a journey');

    // (4) ripristina il default: la journey resta in DB ma non si riapre da
    // vendite anteriori; verifichiamo solo che il GET rifletta il reset.
    const reset = await jsonReq(`${BASE}/api/customer-journey-config`, {
      method: 'PUT',
      headers: { Cookie: session.cookie },
      body: JSON.stringify({ triggerDate: null }),
    });
    assert.equal(reset.status, 200, `config reset failed: ${JSON.stringify(reset.body)}`);
    assert.equal(reset.body.triggerDate, DEFAULT_TRIGGER, 'null trigger date must fall back to default');
  } finally {
    await cleanupSession(pool, session);
    await pool.end().catch(() => {});
  }
});

// ===========================================================================
// SCENARIO 2: un payload con data malformata è rifiutato (400) e non altera
// la config esistente.
// ===========================================================================
test('scenario 2: invalid trigger date is rejected', async () => {
  const pool = await newPool();
  const session = await signupAndLogin();
  try {
    const bad = await jsonReq(`${BASE}/api/customer-journey-config`, {
      method: 'PUT',
      headers: { Cookie: session.cookie },
      body: JSON.stringify({ triggerDate: '15-05-2026' }),
    });
    assert.equal(bad.status, 400, 'malformed date must be rejected with 400');

    const cfg = await jsonReq(`${BASE}/api/customer-journey-config`, {
      headers: { Cookie: session.cookie },
    });
    assert.equal(cfg.status, 200);
    assert.equal(cfg.body.triggerDate, DEFAULT_TRIGGER, 'config must remain at default after a rejected PUT');
  } finally {
    await cleanupSession(pool, session);
    await pool.end().catch(() => {});
  }
});
