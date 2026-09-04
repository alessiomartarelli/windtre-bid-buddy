import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  BASE,
  uniq,
  jsonReq,
  signup,
  cleanupOrg,
  newPool,
  setCjTriggerDate,
} from './helpers/uiTest.mjs';

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

// Deve combaciare con CJ_TRIGGER_DATE in server/storage.ts: la journey si
// apre solo per attivazioni mobile da questa data in poi.
const SALE_DATE = '2026-07-15T10:00:00.000Z';

const signupAndLogin = () => signup({ prefix: 'cj_reconcile_test', fullName: 'CJ Reconcile Test' });

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
    headers: { Cookie: session.cookieHeader },
  });
  assert.equal(r.status, 200, `reconcile failed: ${JSON.stringify(r.body)}`);
  return r.body;
}

// GET della lista journey: questa route fa il reconcile automatico (stale-check)
// PRIMA di rispondere, così le vendite già nel DB compaiono senza "Rigenera".
async function listJourneys(session) {
  const r = await jsonReq(`${BASE}/api/customer-journeys`, {
    headers: { Cookie: session.cookieHeader },
  });
  assert.equal(r.status, 200, `list failed: ${JSON.stringify(r.body)}`);
  return r.body;
}

// Legge il watermark dell'ultimo reconcile dall'org config.
async function reconciledWatermark(pool, orgId) {
  const r = await pool.query(
    `SELECT config->>'customerJourneyReconciledAt' AS at
       FROM organization_config WHERE organization_id = $1`,
    [orgId],
  );
  return r.rows[0]?.at ?? null;
}

// cleanupOrg condiviso copre item/journey/profilo/org; qui ripuliamo prima
// le vendite BiSuite specifiche di questa suite.
async function cleanupSession(pool, session) {
  await pool
    .query(`DELETE FROM bisuite_sales WHERE organization_id = $1`, [session.orgId])
    .catch(() => {});
  await cleanupOrg(pool, session);
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
        headers: { Cookie: session.cookieHeader },
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

// ===========================================================================
// SCENARIO 5: reconcile automatico al load. Una vendita già nel DB (come se
// scaricata da un'altra pagina) deve comparire nella lista journey al primo
// GET /api/customer-journeys, SENZA chiamare il reconcile manuale. Un secondo
// GET non ricostruisce di nuovo (watermark stabile finché le vendite non
// cambiano); l'inserimento di una nuova vendita fa avanzare il watermark e
// compare la seconda journey.
// ===========================================================================
test('scenario 5: sales already in DB appear on list via auto-reconcile (no manual rigenera)', async () => {
  const pool = await newPool();
  const session = await signupAndLogin();
  const cf1 = uniq('AUTORC').toUpperCase();
  const cf2 = uniq('AUTOR2').toUpperCase();
  const phones = {
    manual: { imei: '111111111111111', importoFinanziato: '800' },
    auto: { imei: '222222222222222', importoFinanziato: '600' },
  };
  try {
    // Vendita presente nel DB (nessun reconcile manuale chiamato).
    await insertSale(pool, session.orgId, cf1, 'ADD AUTO', phones);

    // Prima del load non c'è ancora alcun reconcile né journey.
    assert.equal(await reconciledWatermark(pool, session.orgId), null, 'no watermark before first load');

    // Il GET della lista riconcilia automaticamente e ritorna la journey.
    const list1 = await listJourneys(session);
    assert.equal(list1.length, 1, 'auto-reconcile must surface the existing sale as a journey');
    const wm1 = await reconciledWatermark(pool, session.orgId);
    assert.ok(wm1, 'watermark must be set after the auto-reconcile');

    // Secondo GET: niente di nuovo nelle vendite => watermark invariato.
    const list2 = await listJourneys(session);
    assert.equal(list2.length, 1, 'no new journeys on a stale load');
    assert.equal(await reconciledWatermark(pool, session.orgId), wm1, 'watermark unchanged when no new sales');

    // Nuova vendita (altra pagina) => il load successivo la riconcilia.
    await insertSale(pool, session.orgId, cf2, 'ADD AUTO 2', phones);
    const list3 = await listJourneys(session);
    assert.equal(list3.length, 2, 'new sale must appear on the next load without manual rigenera');
    const wm3 = await reconciledWatermark(pool, session.orgId);
    assert.ok(wm3 && wm3 >= wm1, 'watermark advances after a newer sale');
  } finally {
    await cleanupSession(pool, session);
    await pool.end().catch(() => {});
  }
});

// ===========================================================================
// SCENARIO 6 (Task #555): gli acquisti dei mesi SUCCESSIVI alla SIM vengono
// agganciati alla stessa journey e fanno crescere il maturato.
//   1) vendita SIM mobile a luglio => journey aperta (T0 = luglio), nessuna
//      pista cross-sell => gettone 0 €.
//   2) arriva (fetch notturno / altra pagina) una vendita FISSO a settembre
//      per lo stesso CF, con last_seen_at più recente del watermark.
//   3) il load della lista riconcilia automaticamente: la scheda contiene
//      ENTRAMBI i contratti (luglio + settembre), la journey resta una sola e
//      il report/gettone del cliente passa a 1 pista => 20 €.
// ===========================================================================
const { buildGettoneJourneys } = await import('../shared/customerJourney.ts');

function buildRawDataFisso(cf, addetto) {
  return {
    cliente: { codiceFiscale: cf, clienteTipo: 'FISICA', nome: 'Mario', cognome: 'Rossi', codiceEsterno: 'CLI123' },
    addetto: { nominativo: addetto },
    attivita: { nominativo: 'PDV ORIGINE' },
    importoScontrino: 29.9,
    articoli: [
      {
        id: 2001,
        categoria: { nome: 'ADSL/FIBRA/FWA CF' },
        tipologia: { nome: 'FIBRA' },
        descrizione: 'Super Fibra',
        dettaglio: { prezzo: '29.9', venditaInfo1: 'CODICE CONTRATTO: 1680001' },
      },
    ],
  };
}

async function insertLaterSale(pool, orgId, cf, addetto, dataVendita, raw) {
  const bisuiteId = Math.floor(Math.random() * 2_000_000_000);
  // last_seen_at esplicitamente nel futuro rispetto al reconcile precedente:
  // è quello che fa il fetch BiSuite quando scarica il mese corrente.
  const res = await pool.query(
    `INSERT INTO bisuite_sales
       (organization_id, bisuite_id, data_vendita, nome_addetto, stato, raw_data, last_seen_at)
     VALUES ($1, $2, $3, $4, 'FINALIZZATA IN CASSA', $5::jsonb, now() + interval '1 second')
     RETURNING id`,
    [orgId, bisuiteId, dataVendita, addetto, JSON.stringify(raw)],
  );
  return res.rows[0].id;
}

async function reportRows(session) {
  const r = await jsonReq(`${BASE}/api/customer-journeys/report`, {
    headers: { Cookie: session.cookieHeader },
  });
  assert.equal(r.status, 200, `report failed: ${JSON.stringify(r.body)}`);
  return r.body;
}

test('scenario 6: a September purchase is linked to the July SIM journey and raises the maturato', async () => {
  const pool = await newPool();
  const session = await signupAndLogin();
  const cf = uniq('LATERS').toUpperCase();
  const addetto = 'MARIO ROSSI';
  const phones = {
    manual: { imei: '111111111111111', importoFinanziato: '800' },
    auto: { imei: '222222222222222', importoFinanziato: '600' },
  };
  try {
    // (1) SIM a luglio (SALE_DATE = 2026-07-15) => journey con solo mobile+telefono.
    const julySaleId = await insertSale(pool, session.orgId, cf, addetto, phones);
    const list1 = await listJourneys(session);
    assert.equal(list1.length, 1, 'July SIM opens exactly one journey');
    const journeyId = list1[0].id;
    assert.equal(list1[0].openedAt.slice(0, 7), '2026-07', 'T0 is July');
    const gettone1 = buildGettoneJourneys(await reportRows(session)).find((g) => g.journeyId === journeyId);
    assert.ok(gettone1, 'journey is in the gettone cohort (active mobile SIM)');
    const pisteBefore = gettone1.pisteAttive;
    const fatturatoBefore = gettone1.fatturato;
    assert.equal(gettone1.simAttive, 1);

    // (2) acquisto FISSO a settembre, stesso CF, visto da un fetch successivo.
    const sepSaleId = await insertLaterSale(
      pool, session.orgId, cf, addetto, '2026-09-02T10:00:00.000Z', buildRawDataFisso(cf, addetto),
    );

    // (3) il load successivo riconcilia (watermark superato) e aggancia la vendita.
    const list2 = await listJourneys(session);
    assert.equal(list2.length, 1, 'still ONE journey: the later purchase must not open a new one');
    assert.equal(list2[0].id, journeyId);
    assert.equal(list2[0].openedAt.slice(0, 7), '2026-07', 'T0 stays July (later sale is not a trigger)');
    const fissoDriver = list2[0].drivers.find((d) => d.driver === 'fisso');
    assert.equal(fissoDriver?.activated, true, 'FISSO driver activated on the card');
    assert.equal(fissoDriver?.phase, 'periodo', 'September is inside the journey window (>= T0 month)');

    const detail = await jsonReq(`${BASE}/api/customer-journeys/${journeyId}`, {
      headers: { Cookie: session.cookieHeader },
    });
    assert.equal(detail.status, 200);
    const saleIds = new Set(detail.body.items.map((it) => it.bisuiteSaleId));
    assert.ok(saleIds.has(julySaleId), 'detail/timeline contains the July SIM contract');
    assert.ok(saleIds.has(sepSaleId), 'detail/timeline contains the September FISSO contract');
    const sepItem = detail.body.items.find((it) => it.bisuiteSaleId === sepSaleId);
    assert.equal(sepItem.driver, 'fisso');
    assert.equal(sepItem.dataInserimento.slice(0, 7), '2026-09', 'event date of the later contract is September');
    assert.equal(sepItem.codiceContratto, '1680001');

    // Il maturato del cliente cresce: +1 pista cross-sell rispetto a prima.
    const gettone2 = buildGettoneJourneys(await reportRows(session)).find((g) => g.journeyId === journeyId);
    assert.ok(gettone2);
    assert.equal(gettone2.pisteAttive, pisteBefore + 1, 'one more cross-sell pista after the September purchase');
    assert.ok(gettone2.fatturato > fatturatoBefore, `maturato must grow (${fatturatoBefore} -> ${gettone2.fatturato})`);
  } finally {
    await cleanupSession(pool, session);
    await pool.end().catch(() => {});
  }
});

// ===========================================================================
// SCENARIO 7 (Task #555): le vendite senza CF/P.IVA non spariscono in
// silenzio: il reconcile manuale riporta quante ne ha scartate, distinguendo
// quelle che contenevano una pista tracciata (contratto perso) dalle altre
// (ricariche/accessori di clienti anonimi).
// ===========================================================================
test('scenario 7: reconcile reports sales skipped for missing customer identity', async () => {
  const pool = await newPool();
  const session = await signupAndLogin();
  const cf = uniq('SKIPID').toUpperCase();
  const phones = {
    manual: { imei: '111111111111111', importoFinanziato: '800' },
    auto: { imei: '222222222222222', importoFinanziato: '600' },
  };
  try {
    await insertSale(pool, session.orgId, cf, 'ADD X', phones);
    // Anonimo con pista tracciata (FISSO): contratto perso.
    await insertLaterSale(pool, session.orgId, '', 'ADD X', '2026-09-02T10:00:00.000Z', {
      ...buildRawDataFisso('', 'ADD X'),
      cliente: { codiceFiscale: '', piva: '', clienteTipo: 'FISICA', codiceEsterno: '0' },
    });
    // Anonimo con sola ricarica: scartato ma senza pista tracciata.
    await insertLaterSale(pool, session.orgId, '', 'ADD X', '2026-09-03T10:00:00.000Z', {
      cliente: { codiceEsterno: '0' },
      addetto: { nominativo: 'ADD X' },
      articoli: [{ id: 3001, categoria: { nome: 'RICARICHE' }, tipologia: { nome: 'RICARICA VIRTUALE STD' }, dettaglio: { prezzo: 10 } }],
    });

    const result = await reconcile(session);
    assert.equal(result.journeys, 1);
    assert.equal(result.skippedNoIdentity, 2, 'both anonymous sales are counted as skipped');
    assert.equal(result.skippedNoIdentityWithDriver, 1, 'only the one with a tracked pista is a lost contract');
  } finally {
    await cleanupSession(pool, session);
    await pool.end().catch(() => {});
  }
});

// ===========================================================================
// SCENARIO 8 (Task #557): spostare in avanti la data trigger deve RIMUOVERE le
// journey aperte con il trigger precedente (e i loro item), lasciando intatte
// quelle ancora qualificate — compresi i loro campi manuali. La lista Schede
// deve così coincidere col perimetro temporale dell'Analisi gettoni.
// ===========================================================================
test('scenario 8: moving the trigger date forward prunes journeys opened under the old trigger', async () => {
  const pool = await newPool();
  const session = await signupAndLogin();
  const cfJune = uniq('JUNE').toUpperCase();
  const cfJuly = uniq('JULY').toUpperCase();
  const phones = {
    manual: { imei: 'AAA111', importoFinanziato: 50 },
    auto: { imei: 'BBB222', importoFinanziato: 60 },
  };
  try {
    // Trigger anticipato a giugno: si aprono sia la journey di giugno sia quella di luglio.
    await setCjTriggerDate(pool, session.orgId, '2026-06-01');
    await insertLaterSale(pool, session.orgId, cfJune, 'ADD J', '2026-06-10T10:00:00.000Z', buildRawData(cfJune, 'ADD J', phones));
    await insertSale(pool, session.orgId, cfJuly, 'ADD L', phones); // SALE_DATE = 2026-07-15

    let result = await reconcile(session);
    assert.equal(result.journeys, 2, 'both June and July journeys open with a June trigger');
    assert.equal(result.removedJourneys, 0);
    let journeys = await journeyOf(pool, session.orgId);
    assert.deepEqual(journeys.map((j) => j.customer_key).sort(), [cfJuly, cfJune].sort());

    // Modifica manuale su un item della journey di LUGLIO (deve sopravvivere).
    let items = await itemsByArticle(pool, session.orgId);
    const julyItems = await pool.query(
      `SELECT i.id FROM customer_journey_items i JOIN customer_journeys j ON j.id = i.journey_id
        WHERE i.organization_id = $1 AND j.customer_key = $2 AND i.bisuite_article_id = $3`,
      [session.orgId, cfJuly, ART_MANUAL],
    );
    const patch = await jsonReq(`${BASE}/api/customer-journey-items/${julyItems.rows[0].id}/details`, {
      method: 'PATCH',
      headers: { Cookie: session.cookieHeader },
      body: JSON.stringify({ imei: 'IMEI_MANUALE', rata: '999' }),
    });
    assert.equal(patch.status, 200, `details PATCH failed: ${JSON.stringify(patch.body)}`);

    // Journey/item "estranei" in un'ALTRA org: la pulizia non deve toccarli.
    const other = await signupAndLogin();
    try {
      await setCjTriggerDate(pool, other.orgId, '2026-06-01');
      await insertLaterSale(pool, other.orgId, cfJune, 'ADD O', '2026-06-10T10:00:00.000Z', buildRawData(cfJune, 'ADD O', phones));
      await reconcile(other);
      assert.equal((await journeyOf(pool, other.orgId)).length, 1);

      // Sposta il trigger a luglio via API (come farebbe un admin) e ricarica
      // la lista: il cambio trigger deve invalidare il watermark e far
      // ripartire il reconcile anche senza nuove vendite.
      const put = await jsonReq(`${BASE}/api/customer-journey-config`, {
        method: 'PUT',
        headers: { Cookie: session.cookieHeader },
        body: JSON.stringify({ triggerDate: '2026-07-01' }),
      });
      assert.equal(put.status, 200, `config PUT failed: ${JSON.stringify(put.body)}`);
      assert.equal(await reconciledWatermark(pool, session.orgId), null, 'trigger change must reset the reconcile watermark');

      const list = await jsonReq(`${BASE}/api/customer-journeys`, { headers: { Cookie: session.cookieHeader } });
      assert.equal(list.status, 200);
      assert.deepEqual(
        list.body.map((j) => j.customerKey),
        [cfJuly],
        'the Schede list must only show the July journey after moving the trigger to July',
      );

      journeys = await journeyOf(pool, session.orgId);
      assert.deepEqual(journeys.map((j) => j.customer_key), [cfJuly], 'June journey must be deleted from the DB');
      const orphanItems = await pool.query(
        `SELECT COUNT(*)::int AS n FROM customer_journey_items WHERE organization_id = $1 AND cf = $2`,
        [session.orgId, cfJune],
      );
      assert.equal(orphanItems.rows[0].n, 0, 'items of the pruned June journey must be gone');

      // La journey di luglio conserva i campi manuali.
      items = await itemsByArticle(pool, session.orgId);
      const kept = items.get(ART_MANUAL);
      assert.equal(kept.details_manual, true);
      assert.equal(kept.imei, 'IMEI_MANUALE');
      assert.equal(kept.rata, '999');

      // Un reconcile esplicito riporta il conteggio dei rimossi = 0 (già puliti) e
      // l'altra org è rimasta intatta.
      result = await reconcile(session);
      assert.equal(result.journeys, 1);
      assert.equal(result.removedJourneys, 0);
      assert.equal(result.removedItems, 0);
      assert.equal((await journeyOf(pool, other.orgId)).length, 1, 'other org journeys must not be pruned');

      // Il conteggio dei rimossi include gli item caduti per cascade della
      // journey: sull'altra org (1 journey di giugno con 3 item) spostiamo il
      // trigger e rigeneriamo esplicitamente.
      await setCjTriggerDate(pool, other.orgId, '2026-07-01');
      const otherResult = await reconcile(other);
      assert.equal(otherResult.journeys, 0);
      assert.equal(otherResult.removedJourneys, 1);
      assert.equal(otherResult.removedItems, 3, 'items removed by journey cascade must be counted');
      assert.equal((await journeyOf(pool, other.orgId)).length, 0);
    } finally {
      await cleanupSession(pool, other);
    }
  } finally {
    await cleanupSession(pool, session);
    await pool.end().catch(() => {});
  }
});

// ===========================================================================
// SCENARIO 9 (Task #557): un cambio di data trigger che arriva MENTRE un
// reconcile è in corso non deve essere "annullato" dal reconcile (che
// riscriverebbe un watermark fresco col perimetro vecchio). Reconcile e
// salvataggio trigger sono serializzati da un advisory lock per org, quindi
// lanciandoli in parallelo il risultato finale deve comunque essere coerente
// con il trigger salvato: journey di giugno assente, watermark valido.
// ===========================================================================
test('scenario 9: a trigger change racing an in-flight reconcile still ends in the new perimeter', async () => {
  const pool = await newPool();
  const session = await signupAndLogin();
  const cfJune = uniq('RJUNE').toUpperCase();
  const cfJuly = uniq('RJULY').toUpperCase();
  const phones = {
    manual: { imei: 'AAA111', importoFinanziato: 50 },
    auto: { imei: 'BBB222', importoFinanziato: 60 },
  };
  try {
    await setCjTriggerDate(pool, session.orgId, '2026-06-01');
    await insertLaterSale(pool, session.orgId, cfJune, 'ADD J', '2026-06-10T10:00:00.000Z', buildRawData(cfJune, 'ADD J', phones));
    await insertSale(pool, session.orgId, cfJuly, 'ADD L', phones);
    await reconcile(session);
    assert.equal((await journeyOf(pool, session.orgId)).length, 2);

    for (let round = 0; round < 5; round++) {
      // Ripristina il trigger di giugno (riapre la journey di giugno)...
      await setCjTriggerDate(pool, session.orgId, '2026-06-01');
      await reconcile(session);
      assert.equal((await journeyOf(pool, session.orgId)).length, 2, `round ${round}: June journey reopened`);

      // ...poi reconcile e PUT trigger→luglio in parallelo, in entrambi gli ordini.
      const ops = [
        () => reconcile(session),
        () => jsonReq(`${BASE}/api/customer-journey-config`, {
          method: 'PUT',
          headers: { Cookie: session.cookieHeader },
          body: JSON.stringify({ triggerDate: '2026-07-01' }),
        }),
      ];
      if (round % 2 === 1) ops.reverse();
      const results = await Promise.all(ops.map((op) => op()));
      for (const r of results) if (r?.status != null) assert.equal(r.status, 200);

      // Stato finale osservabile dalla lista (che riconcilia se il watermark è
      // stato azzerato dal PUT): solo luglio.
      const list = await jsonReq(`${BASE}/api/customer-journeys`, { headers: { Cookie: session.cookieHeader } });
      assert.equal(list.status, 200);
      assert.deepEqual(list.body.map((j) => j.customerKey), [cfJuly], `round ${round}: only July after the race`);
      assert.deepEqual((await journeyOf(pool, session.orgId)).map((j) => j.customer_key), [cfJuly], `round ${round}: DB only July`);
    }
  } finally {
    await cleanupSession(pool, session);
    await pool.end().catch(() => {});
  }
});
