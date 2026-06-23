import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

// Test suite Customer Journey reconcile / preservazione campi manuali (Task #164).
//
// Regola critica: il reconcile (`reconcileCustomerJourneys`) deriva le journey
// e i loro item dalle vendite BiSuite. IMEI e RATA possono però essere
// compilati a mano dall'operatore (BiSuite non li fornisce in modo
// affidabile) e DATA ATTIVAZIONE / PDV DESTINAZIONE sono SOLO manuali. Una
// volta salvati (`details_manual = true`), un successivo "Rigenera da BiSuite"
// NON deve sovrascriverli, altrimenti gli operatori perderebbero il lavoro
// manuale ad ogni sync.
//
// Implementazione sotto test:
//   - IMEI/RATA: `CASE WHEN details_manual THEN <valore esistente> ELSE
//     excluded.<campo> END` nell'upsert.
//   - data_attivazione / pdv_destinazione: esclusi del tutto dall'upsert
//     (vengono valorizzati solo da updateCustomerJourneyItemDetails).
//
// Strategia: signup crea un profilo `admin` + org (il reconcile richiede
// admin/super_admin). Inseriamo una vendita BiSuite con rawData che innesca
// la journey (attivazione mobile dal CJ_TRIGGER_DATE) e due dispositivi
// TELEFONIA finanziati (IMEI + RATA derivabili). Guidiamo reconcile e
// PATCH dettagli via HTTP; leggiamo lo stato finale degli item dal DB per
// asserzioni precise sui singoli campi.

const BASE = process.env.FINPLAN_BASE_URL || 'http://localhost:5000';

// Deve combaciare con CJ_TRIGGER_DATE in server/storage.ts: la journey si
// apre solo per attivazioni mobile da questa data in poi.
const SALE_DATE = '2026-07-15T10:00:00.000Z';

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
  const email = `${uniq('cj_reconcile_test')}@example.com`;
  const password = 'Pa55word!';
  const orgName = uniq('CJReconcile');
  const r = await jsonReq(`${BASE}/api/auth/signup`, {
    method: 'POST',
    body: JSON.stringify({
      email,
      password,
      fullName: 'CJ Reconcile Test',
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

// Article id costanti del fixture: 1000 è l'attivazione mobile che innesca la
// journey; 1001 e 1002 sono i due dispositivi finanziati (IMEI + RATA).
const ART_TRIGGER = 1000;
const ART_MANUAL = 1001; // verrà modificato a mano
const ART_AUTO = 1002; // resta automatico

// Costruisce il rawData di una vendita BiSuite con un'attivazione mobile +
// due telefoni finanziati. `phones` permette di variare IMEI/importoFinanziato
// fra il primo e il secondo reconcile.
function buildRawData(cf, addetto, phones) {
  return {
    cliente: {
      codiceFiscale: cf,
      clienteTipo: 'FISICA',
      nome: 'Mario',
      cognome: 'Rossi',
      tel1: '3331234567',
      codiceEsterno: 'CLI123',
    },
    addetto: { nominativo: addetto },
    attivita: { nominativo: 'PDV ORIGINE' },
    importoScontrino: 1400,
    articoli: [
      {
        id: ART_TRIGGER,
        categoria: { nome: 'UNTIED' },
        tipologia: { nome: 'RICARICABILE' },
        descrizione: 'Nuova SIM mobile',
        dettaglio: { prezzo: 0 },
      },
      {
        id: ART_MANUAL,
        categoria: { nome: 'TELEFONIA' },
        tipologia: { nome: 'SMARTPHONE' },
        descrizione: 'iPhone',
        dettaglio: {
          prezzo: '800',
          tipologiaVendita: 'FINANZIAMENTO',
          importoFinanziato: phones.manual.importoFinanziato,
          venditaInfo1: `IMEI/SERIALE DISPOSITIVO ASSOCIATO: ${phones.manual.imei}`,
        },
      },
      {
        id: ART_AUTO,
        categoria: { nome: 'TELEFONIA' },
        tipologia: { nome: 'SMARTPHONE' },
        descrizione: 'Samsung',
        dettaglio: {
          prezzo: '600',
          tipologiaVendita: 'FINANZIAMENTO',
          importoFinanziato: phones.auto.importoFinanziato,
          venditaInfo1: `IMEI/SERIALE DISPOSITIVO ASSOCIATO: ${phones.auto.imei}`,
        },
      },
    ],
  };
}

async function insertSale(pool, orgId, cf, addetto, phones) {
  const bisuiteId = Math.floor(Math.random() * 2_000_000_000);
  const raw = buildRawData(cf, addetto, phones);
  const res = await pool.query(
    `INSERT INTO bisuite_sales
       (organization_id, bisuite_id, data_vendita, nome_addetto, stato, raw_data)
     VALUES ($1, $2, $3, $4, 'ATTIVO', $5::jsonb)
     RETURNING id`,
    [orgId, bisuiteId, SALE_DATE, addetto, JSON.stringify(raw)],
  );
  return res.rows[0].id;
}

async function updateSaleRaw(pool, saleId, cf, addetto, phones) {
  const raw = buildRawData(cf, addetto, phones);
  await pool.query(`UPDATE bisuite_sales SET raw_data = $2::jsonb WHERE id = $1`, [
    saleId,
    JSON.stringify(raw),
  ]);
}

// Costruisce il rawData di una vendita con un'anagrafica cliente arbitraria
// (`cliente`) e un addetto vendita (`addetto`) distinti. Serve a verificare
// che la journey salvi i dati del CLIENTE (nominativo/ragione sociale) mentre
// l'item conservi il nome dell'ADDETTO vendita (Task #178).
function buildRawDataCliente(cliente, addetto) {
  return {
    cliente,
    addetto: { nominativo: addetto },
    attivita: { nominativo: 'PDV ORIGINE' },
    importoScontrino: 1400,
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

async function insertSaleCliente(pool, orgId, cliente, addetto) {
  const bisuiteId = Math.floor(Math.random() * 2_000_000_000);
  const raw = buildRawDataCliente(cliente, addetto);
  const res = await pool.query(
    `INSERT INTO bisuite_sales
       (organization_id, bisuite_id, data_vendita, nome_addetto, stato, raw_data)
     VALUES ($1, $2, $3, $4, 'ATTIVO', $5::jsonb)
     RETURNING id`,
    [orgId, bisuiteId, SALE_DATE, addetto, JSON.stringify(raw)],
  );
  return res.rows[0].id;
}

// Legge la (singola) journey dell'org dal DB.
async function journeyOf(pool, orgId) {
  const r = await pool.query(
    `SELECT customer_key, customer_type, nome, cognome, ragione_sociale, nominativo
       FROM customer_journeys
      WHERE organization_id = $1`,
    [orgId],
  );
  return r.rows;
}

// Legge gli item della journey dell'org (per asserire l'addetto vendita).
async function itemsOf(pool, orgId) {
  const r = await pool.query(
    `SELECT bisuite_article_id, addetto, nome, cognome, piva, cf
       FROM customer_journey_items
      WHERE organization_id = $1`,
    [orgId],
  );
  return r.rows;
}

// Mappa gli item della journey per bisuite_article_id, leggendo dal DB.
async function itemsByArticle(pool, orgId) {
  const r = await pool.query(
    `SELECT bisuite_article_id, id, imei, rata, data_attivazione, pdv_destinazione, details_manual
       FROM customer_journey_items
      WHERE organization_id = $1`,
    [orgId],
  );
  const map = new Map();
  for (const row of r.rows) map.set(Number(row.bisuite_article_id), row);
  return map;
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
// SCENARIO 1: i quattro campi manuali sopravvivono al reconcile.
//   1) reconcile iniziale => item derivati da BiSuite (IMEI/RATA auto).
//   2) updateCustomerJourneyItemDetails sull'item "manuale" (data attivazione,
//      PDV destinazione, IMEI, RATA) => details_manual = true.
//   3) cambiano IMEI/importoFinanziato della vendita BiSuite.
//   4) reconcile di nuovo => l'item manuale NON deve cambiare su nessuno dei
//      quattro campi.
// ===========================================================================
test('scenario 1: manual contract fields survive a re-reconcile', async () => {
  const pool = await newPool();
  const session = await signupAndLogin();
  const cf = uniq('RSSMRA').toUpperCase();
  const addetto = 'MARIO ROSSI';
  try {
    const saleId = await insertSale(pool, session.orgId, cf, addetto, {
      manual: { imei: 'AAA111', importoFinanziato: 50 },
      auto: { imei: 'BBB222', importoFinanziato: 60 },
    });

    // (1) primo reconcile.
    await reconcile(session);
    let items = await itemsByArticle(pool, session.orgId);
    const before = items.get(ART_MANUAL);
    assert.ok(before, 'manual phone item must exist after first reconcile');
    assert.equal(before.imei, 'AAA111', 'IMEI must come from BiSuite at first reconcile');
    assert.equal(before.rata, null, 'RATA is manual-only: not auto-derived from BiSuite');
    assert.equal(before.details_manual, false, 'item starts as non-manual');

    // (2) modifica manuale dei quattro campi.
    const patch = await jsonReq(
      `${BASE}/api/customer-journey-items/${before.id}/details`,
      {
        method: 'PATCH',
        headers: { Cookie: session.cookie },
        body: JSON.stringify({
          dataAttivazione: '2026-08-01',
          pdvDestinazione: 'PDV DESTINAZIONE MANUALE',
          imei: 'IMEI_MANUALE',
          rata: '999',
        }),
      },
    );
    assert.equal(patch.status, 200, `details PATCH failed: ${JSON.stringify(patch.body)}`);

    items = await itemsByArticle(pool, session.orgId);
    const edited = items.get(ART_MANUAL);
    assert.equal(edited.details_manual, true, 'details_manual must be true after manual edit');
    assert.equal(edited.imei, 'IMEI_MANUALE');
    assert.equal(edited.rata, '999');
    assert.equal(edited.pdv_destinazione, 'PDV DESTINAZIONE MANUALE');
    assert.ok(edited.data_attivazione, 'data_attivazione must be set after manual edit');
    const savedActivation = new Date(edited.data_attivazione).toISOString().slice(0, 10);
    assert.equal(savedActivation, '2026-08-01');

    // (3) BiSuite cambia IMEI e importo finanziato della stessa vendita.
    await updateSaleRaw(pool, saleId, cf, addetto, {
      manual: { imei: 'AAA999', importoFinanziato: 55 },
      auto: { imei: 'BBB999', importoFinanziato: 65 },
    });

    // (4) reconcile di nuovo: l'item manuale resta invariato su tutti e 4 i campi.
    await reconcile(session);
    items = await itemsByArticle(pool, session.orgId);
    const after = items.get(ART_MANUAL);
    assert.ok(after, 'manual item must still exist after re-reconcile');
    assert.equal(after.imei, 'IMEI_MANUALE', 'manual IMEI must NOT be overwritten by BiSuite');
    assert.equal(after.rata, '999', 'manual RATA must NOT be overwritten by BiSuite');
    assert.equal(
      after.pdv_destinazione,
      'PDV DESTINAZIONE MANUALE',
      'manual PDV destinazione must NOT be overwritten',
    );
    assert.ok(after.data_attivazione, 'manual data_attivazione must NOT be cleared');
    const afterActivation = new Date(after.data_attivazione).toISOString().slice(0, 10);
    assert.equal(afterActivation, '2026-08-01', 'manual data_attivazione must NOT change');
  } finally {
    await cleanupSession(pool, session);
    await pool.end().catch(() => {});
  }
});

// ===========================================================================
// SCENARIO 2: gli item NON modificati a mano vengono comunque aggiornati con
// IMEI/RATA derivati da BiSuite ad ogni reconcile (il ramo ELSE excluded).
// ===========================================================================
test('scenario 2: non-manual items are refreshed with BiSuite IMEI/RATA', async () => {
  const pool = await newPool();
  const session = await signupAndLogin();
  const cf = uniq('VRDLGI').toUpperCase();
  const addetto = 'LUIGI VERDI';
  try {
    const saleId = await insertSale(pool, session.orgId, cf, addetto, {
      manual: { imei: 'AAA111', importoFinanziato: 50 },
      auto: { imei: 'BBB222', importoFinanziato: 60 },
    });

    await reconcile(session);
    let items = await itemsByArticle(pool, session.orgId);
    const before = items.get(ART_AUTO);
    assert.ok(before, 'auto phone item must exist after first reconcile');
    assert.equal(before.imei, 'BBB222');
    assert.equal(before.rata, null, 'RATA is manual-only: not auto-derived from BiSuite');
    assert.equal(before.details_manual, false);

    // BiSuite aggiorna IMEI e importo finanziato; l'item non è mai stato
    // toccato a mano, quindi il reconcile deve riflettere i nuovi valori.
    await updateSaleRaw(pool, saleId, cf, addetto, {
      manual: { imei: 'AAA999', importoFinanziato: 55 },
      auto: { imei: 'BBB999', importoFinanziato: 65 },
    });

    await reconcile(session);
    items = await itemsByArticle(pool, session.orgId);
    const after = items.get(ART_AUTO);
    assert.ok(after, 'auto item must still exist after re-reconcile');
    assert.equal(after.imei, 'BBB999', 'non-manual IMEI must be refreshed from BiSuite');
    assert.equal(after.rata, null, 'RATA stays manual-only: never auto-derived from BiSuite');
    assert.equal(after.details_manual, false, 'non-manual item stays non-manual');
  } finally {
    await cleanupSession(pool, session);
    await pool.end().catch(() => {});
  }
});

// ===========================================================================
// SCENARIO 3: cliente AZIENDA (GIURIDICA) — la journey deve mostrare il
// CLIENTE (ragione sociale / nominativo), NON l'addetto vendita; l'item deve
// conservare il nome dell'addetto vendita nel campo `addetto`. Regressione del
// fix Task #178 che separa l'anagrafica della journey dall'addetto per-item.
// ===========================================================================
test('scenario 3: business journey shows the customer, item keeps the addetto', async () => {
  const pool = await newPool();
  const session = await signupAndLogin();
  const piva = uniq('PIVA').toUpperCase();
  const ragioneSociale = 'ACME COSTRUZIONI SRL';
  const addetto = 'GIANNI BIANCHI';
  try {
    const cliente = {
      piva,
      clienteTipo: 'GIURIDICA',
      ragioneSociale,
      nominativo: ragioneSociale,
      tel1: '0612345678',
      codiceEsterno: 'AZ999',
    };
    await insertSaleCliente(pool, session.orgId, cliente, addetto);

    await reconcile(session);

    const journeys = await journeyOf(pool, session.orgId);
    assert.equal(journeys.length, 1, 'exactly one business journey expected');
    const j = journeys[0];
    assert.equal(j.customer_type, 'azienda', 'GIURIDICA client => customer_type azienda');
    assert.equal(j.customer_key, piva, 'business journey keyed by piva');
    assert.equal(j.nominativo, ragioneSociale, 'journey nominativo must be the CUSTOMER, not the addetto');
    assert.equal(j.ragione_sociale, ragioneSociale, 'journey ragione_sociale must be the customer');
    assert.notEqual(j.nominativo, addetto, 'journey nominativo must NOT be the addetto');

    const items = await itemsOf(pool, session.orgId);
    assert.ok(items.length >= 1, 'business journey must have at least one item');
    for (const it of items) {
      assert.equal(it.addetto, addetto, 'item addetto must be the sales addetto');
      assert.equal(it.piva, piva, 'item piva must be the customer piva');
    }
  } finally {
    await cleanupSession(pool, session);
    await pool.end().catch(() => {});
  }
});

// ===========================================================================
// SCENARIO 4: cliente PRIVATO (FISICA) — regressione: la journey salva
// Nome+Cognome del cliente e l'item conserva l'addetto vendita distinto.
// ===========================================================================
test('scenario 4: private journey shows the customer name, item keeps the addetto', async () => {
  const pool = await newPool();
  const session = await signupAndLogin();
  const cf = uniq('NREANN').toUpperCase();
  const addetto = 'CARLO GIALLI';
  try {
    const cliente = {
      codiceFiscale: cf,
      clienteTipo: 'FISICA',
      nome: 'Anna',
      cognome: 'Neri',
      tel1: '3339876543',
      codiceEsterno: 'CLI777',
    };
    await insertSaleCliente(pool, session.orgId, cliente, addetto);

    await reconcile(session);

    const journeys = await journeyOf(pool, session.orgId);
    assert.equal(journeys.length, 1, 'exactly one private journey expected');
    const j = journeys[0];
    assert.equal(j.customer_type, 'privato', 'FISICA client => customer_type privato');
    assert.equal(j.customer_key, cf, 'private journey keyed by codice fiscale');
    assert.equal(j.nome, 'Anna', 'journey nome must be the customer first name');
    assert.equal(j.cognome, 'Neri', 'journey cognome must be the customer last name');
    assert.notEqual(j.nome, addetto, 'journey nome must NOT be the addetto');

    const items = await itemsOf(pool, session.orgId);
    assert.ok(items.length >= 1, 'private journey must have at least one item');
    for (const it of items) {
      assert.equal(it.addetto, addetto, 'item addetto must be the sales addetto');
      assert.equal(it.cf, cf, 'item cf must be the customer cf');
      assert.equal(it.nome, 'Anna', 'item nome must be the customer first name');
    }
  } finally {
    await cleanupSession(pool, session);
    await pool.end().catch(() => {});
  }
});
