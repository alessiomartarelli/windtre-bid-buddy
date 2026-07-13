import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

// Test suite DB-backed "Device tally + Accessori/Servizi dopo il refactor di
// aggregazione" (Task #293, regressione di Task #291).
//
// Task #291 ha estratto TUTTA l'aggregazione delle vendite mappate dalla route
// GET /api/admin/bisuite-mapped-sales nel modulo server/bisuiteMappedSales.ts
// (`aggregateMappedSales`). Solo la fetta caring/CB era coperta da un test
// DB-backed (tests/caring-cb-exclusion-db.test.mjs). Questa suite copre il
// resto del modulo, ossia le card della dashboard che NON passano dal mapping
// delle piste:
//   - il conteggio device (smartphone / smartDevice / internetDevice) con lo
//     split per modalità finanziato/rate/altro dedotta dalle domandeRisposte;
//   - le descrizioni per device accumulate per modalità;
//   - i secchi Accessori e Servizi (pezzi + importo), con importoImponibile
//     e fallback su prezzo;
//   - la separazione dei totali per PDV.
//
// Come le altre suite DB-backed: semina righe `bisuite_sales` per un'org
// effimera, le rilegge con lo storage usato dalla route e le passa a
// `aggregateMappedSales`, senza HTTP. Richiede solo DATABASE_URL (non il dev
// server).

const { storage } = await import('../server/storage.ts');
const { pool } = await import('../server/db.ts');
const { aggregateMappedSales } = await import('../server/bisuiteMappedSales.ts');
const {
  getDefaultMappingRules,
  mergeWithDefaultRules,
} = await import('../shared/bisuiteMapping.ts');

// Regole EFFETTIVE: default + gemelli partnership sintetici, come fa la route.
const RULES = mergeWithDefaultRules(getDefaultMappingRules());

const YEAR = 2026;
const MONTH = 7;
const DATA_VENDITA = '2026-07-15T10:00:00.000Z';

function uniq(prefix) {
  return `${prefix}_${crypto.randomBytes(4).toString('hex')}`;
}

after(async () => {
  await pool.end().catch(() => {});
});

async function createOrg() {
  const name = uniq('DevAccServ');
  const r = await pool.query(
    `INSERT INTO organizations (name) VALUES ($1) RETURNING id`,
    [name],
  );
  return r.rows[0].id;
}

// Costruisce un articolo BiSuite con categoria/descrizione e dettaglio
// (importoImponibile / prezzo / domandeRisposte).
function art(catNome, descrizione, { importoImponibile, prezzo, domandeRisposte } = {}) {
  const dettaglio = {};
  if (importoImponibile !== undefined) dettaglio.importoImponibile = String(importoImponibile);
  if (prezzo !== undefined) dettaglio.prezzo = String(prezzo);
  if (domandeRisposte !== undefined) dettaglio.domandeRisposte = domandeRisposte;
  return { categoria: { nome: catNome }, descrizione, dettaglio };
}

// Inserisce una vendita BiSuite con uno o più articoli, associata a un PDV.
async function insertSale(orgId, { codicePos, nomeNegozio, ragioneSociale, articoli, stato = 'ATTIVO', clienteTipo = 'PRIVATO', dataVendita = DATA_VENDITA }) {
  const bisuiteId = Math.floor(Math.random() * 2_000_000_000);
  const raw = {
    cliente: { clienteTipo },
    articoli,
  };
  await pool.query(
    `INSERT INTO bisuite_sales
       (organization_id, bisuite_id, data_vendita, codice_pos, nome_negozio, ragione_sociale, stato, raw_data)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)`,
    [orgId, bisuiteId, dataVendita, codicePos, nomeNegozio, ragioneSociale, stato, JSON.stringify(raw)],
  );
}

async function cleanupOrg(orgId) {
  await pool.query(`DELETE FROM bisuite_sales WHERE organization_id = $1`, [orgId]).catch(() => {});
  await pool.query(`DELETE FROM organizations WHERE id = $1`, [orgId]).catch(() => {});
}

function pdvByPos(agg) {
  return Object.fromEntries(agg.pdvList.map((p) => [p.codicePos, p]));
}

// Domande di finanziamento/rate riconosciute dal modulo.
const Q_COMPASS_SI = [{ domanda: 'TELEFONO INCLUSO COMPASS', risposta: 'SI' }];
const Q_FINDOMESTIC_SI = [{ domanda: 'TELEFONO INCLUSO FINDOMESTIC', risposta: 'SI' }];
const Q_MULTIFIN_SI = [{ domanda: 'TELEFONO INCLUSO MULTI FINANZIAMENTO', risposta: 'SI' }];
const Q_MIA_FIN = [{ domanda: 'MIA TELEFONO FINANZIAMENTO', risposta: '36' }];
const Q_VAR_SI = [{ domanda: 'TELEFONO INCLUSO VAR', risposta: 'SI' }];
const Q_MIA_VAR = [{ domanda: 'MIA TELEFONO VAR', risposta: '24' }];

// ===========================================================================
// SCENARIO 1: split device per modalità (finanziato / rate / altro) sulle tre
// famiglie smartphone / smartDevice / internetDevice, con le descrizioni
// accumulate per modalità.
// ===========================================================================
test('scenario 1: device tally split by finanziato/rate/altro with descriptions', async () => {
  const orgId = await createOrg();
  try {
    const pos = { codicePos: 'POS-DEV', nomeNegozio: 'Negozio Dev', ragioneSociale: 'Dev Srl' };

    // Smartphone (categoria TELEFONIA).
    await insertSale(orgId, { ...pos, articoli: [art('TELEFONIA', 'iPhone 15', { domandeRisposte: Q_COMPASS_SI })] });
    await insertSale(orgId, { ...pos, articoli: [art('TELEFONIA', 'iPhone 15', { domandeRisposte: Q_FINDOMESTIC_SI })] });
    await insertSale(orgId, { ...pos, articoli: [art('TELEFONIA', 'Galaxy S24', { domandeRisposte: Q_VAR_SI })] });
    await insertSale(orgId, { ...pos, articoli: [art('TELEFONIA', 'Nokia 3310')] });

    // Smart device (categoria SMART DEVICE).
    await insertSale(orgId, { ...pos, articoli: [art('SMART DEVICE', 'Watch')] });
    await insertSale(orgId, { ...pos, articoli: [art('SMART DEVICE', 'Watch Pro', { domandeRisposte: Q_MULTIFIN_SI })] });

    // Internet device (categorie INTERNET DEVICE e MODEM/ROUTER).
    await insertSale(orgId, { ...pos, articoli: [art('INTERNET DEVICE', 'Router')] });
    await insertSale(orgId, { ...pos, articoli: [art('MODEM/ROUTER', 'Modem', { domandeRisposte: Q_MIA_VAR })] });
    await insertSale(orgId, { ...pos, articoli: [art('INTERNET DEVICE', 'FWA', { domandeRisposte: Q_MIA_FIN })] });

    const sales = await storage.getBisuiteSalesByItalianMonth(orgId, YEAR, MONTH);
    assert.equal(sales.length, 9, 'devono tornare le 9 vendite seminate');

    const agg = aggregateMappedSales(sales, RULES);
    const posDev = pdvByPos(agg)['POS-DEV'];
    assert.ok(posDev, 'POS-DEV deve comparire');
    const d = posDev.devices;

    // Smartphone.
    assert.equal(d.smartphone.finanziato.pezzi, 2, 'smartphone finanziato = 2 (compass + findomestic)');
    assert.deepEqual(d.smartphone.finanziato.descriptions, { 'iPhone 15': 2 });
    assert.equal(d.smartphone.rate.pezzi, 1, 'smartphone rate = 1 (VAR SI)');
    assert.deepEqual(d.smartphone.rate.descriptions, { 'Galaxy S24': 1 });
    assert.equal(d.smartphone.altro.pezzi, 1, 'smartphone altro = 1 (nessuna domanda)');
    assert.deepEqual(d.smartphone.altro.descriptions, { 'Nokia 3310': 1 });

    // Smart device.
    assert.equal(d.smartDevice.altro.pezzi, 1, 'smartDevice altro = 1');
    assert.deepEqual(d.smartDevice.altro.descriptions, { 'Watch': 1 });
    assert.equal(d.smartDevice.finanziato.pezzi, 1, 'smartDevice finanziato = 1 (multi finanziamento)');
    assert.deepEqual(d.smartDevice.finanziato.descriptions, { 'Watch Pro': 1 });
    assert.equal(d.smartDevice.rate.pezzi, 0, 'smartDevice rate = 0');

    // Internet device (INTERNET DEVICE + MODEM/ROUTER confluiscono qui).
    assert.equal(d.internetDevice.altro.pezzi, 1, 'internetDevice altro = 1 (Router)');
    assert.deepEqual(d.internetDevice.altro.descriptions, { 'Router': 1 });
    assert.equal(d.internetDevice.rate.pezzi, 1, 'internetDevice rate = 1 (MIA VAR)');
    assert.deepEqual(d.internetDevice.rate.descriptions, { 'Modem': 1 });
    assert.equal(d.internetDevice.finanziato.pezzi, 1, 'internetDevice finanziato = 1 (MIA FINANZIAMENTO)');
    assert.deepEqual(d.internetDevice.finanziato.descriptions, { 'FWA': 1 });

    // Gli articoli device sono categorie PRODOTTI: NON contano come articoli
    // "canvass" mappabili, quindi non gonfiano totalArticoli/unmapped.
    assert.equal(posDev.totalArticoli, 0, 'i device non contano come articoli mappabili');
    assert.equal(posDev.unmapped, 0, 'nessun articolo mappabile => nessun unmapped');
  } finally {
    await cleanupOrg(orgId);
  }
});

// ===========================================================================
// SCENARIO 2: secchi Accessori e Servizi — pezzi + importo, con importoImponibile
// e fallback su prezzo; GARANTEASY conta come servizio dashboard.
// ===========================================================================
test('scenario 2: accessori/servizi pezzi + importo (importoImponibile with prezzo fallback)', async () => {
  const orgId = await createOrg();
  try {
    const pos = { codicePos: 'POS-AS', nomeNegozio: 'Negozio AS', ragioneSociale: 'AS Srl' };

    // Accessori: 3 pezzi, importo 10 + 5.5 + 8(prezzo fallback) = 23.5.
    await insertSale(orgId, { ...pos, articoli: [art('ACCESSORI', 'Cover', { importoImponibile: 10 })] });
    await insertSale(orgId, { ...pos, articoli: [art('ACCESSORI', 'Cavo', { importoImponibile: 5.5 })] });
    await insertSale(orgId, { ...pos, articoli: [art('ACCESSORI', 'Vetro', { prezzo: 8 })] });

    // Servizi dashboard: SPEDIZIONE + ASSISTENZA + GARANTEASY = 3 pezzi,
    // importo 7 + 20 + 15(prezzo) = 42.
    await insertSale(orgId, { ...pos, articoli: [art('SPEDIZIONE', 'Consegna', { importoImponibile: 7 })] });
    await insertSale(orgId, { ...pos, articoli: [art('ASSISTENZA', 'Setup', { importoImponibile: 20 })] });
    await insertSale(orgId, { ...pos, articoli: [art('GARANTEASY', 'Garanzia', { prezzo: 15 })] });

    const sales = await storage.getBisuiteSalesByItalianMonth(orgId, YEAR, MONTH);
    assert.equal(sales.length, 6, 'devono tornare le 6 vendite seminate');

    const agg = aggregateMappedSales(sales, RULES);
    const posAs = pdvByPos(agg)['POS-AS'];
    assert.ok(posAs, 'POS-AS deve comparire');

    assert.equal(posAs.accessori.pezzi, 3, 'accessori pezzi = 3');
    assert.equal(posAs.accessori.importo, 23.5, 'accessori importo = 10 + 5.5 + 8(prezzo fallback)');

    assert.equal(posAs.servizi.pezzi, 3, 'servizi pezzi = 3 (spedizione + assistenza + garanteasy)');
    assert.equal(posAs.servizi.importo, 42, 'servizi importo = 7 + 20 + 15(prezzo fallback)');
  } finally {
    await cleanupOrg(orgId);
  }
});

// ===========================================================================
// SCENARIO 3: separazione dei totali per PDV — device/accessori/servizi non
// devono travasare da un PDV all'altro.
// ===========================================================================
test('scenario 3: device/accessori/servizi totals are isolated per PDV', async () => {
  const orgId = await createOrg();
  try {
    // POS-1: 2 smartphone altro + 1 accessorio (importo 12).
    await insertSale(orgId, { codicePos: 'POS-1', nomeNegozio: 'Uno', ragioneSociale: 'Uno Srl', articoli: [art('TELEFONIA', 'A1')] });
    await insertSale(orgId, { codicePos: 'POS-1', nomeNegozio: 'Uno', ragioneSociale: 'Uno Srl', articoli: [art('TELEFONIA', 'A2')] });
    await insertSale(orgId, { codicePos: 'POS-1', nomeNegozio: 'Uno', ragioneSociale: 'Uno Srl', articoli: [art('ACCESSORI', 'Cover1', { importoImponibile: 12 })] });

    // POS-2: 1 internet device finanziato + 1 servizio (importo 30).
    await insertSale(orgId, { codicePos: 'POS-2', nomeNegozio: 'Due', ragioneSociale: 'Due Srl', articoli: [art('INTERNET DEVICE', 'B1', { domandeRisposte: Q_COMPASS_SI })] });
    await insertSale(orgId, { codicePos: 'POS-2', nomeNegozio: 'Due', ragioneSociale: 'Due Srl', articoli: [art('ASSISTENZA', 'Serv2', { importoImponibile: 30 })] });

    const sales = await storage.getBisuiteSalesByItalianMonth(orgId, YEAR, MONTH);
    assert.equal(sales.length, 5, 'devono tornare le 5 vendite seminate');

    const agg = aggregateMappedSales(sales, RULES);
    const byPos = pdvByPos(agg);
    const pos1 = byPos['POS-1'];
    const pos2 = byPos['POS-2'];
    assert.ok(pos1 && pos2, 'entrambi i PDV devono comparire');

    // POS-1: solo smartphone altro (2) + accessori; nessun internet/servizio.
    assert.equal(pos1.devices.smartphone.altro.pezzi, 2, 'POS-1: 2 smartphone');
    assert.equal(pos1.devices.internetDevice.finanziato.pezzi, 0, 'POS-1: nessun internet device');
    assert.equal(pos1.accessori.pezzi, 1, 'POS-1: 1 accessorio');
    assert.equal(pos1.accessori.importo, 12, 'POS-1: accessori importo 12');
    assert.equal(pos1.servizi.pezzi, 0, 'POS-1: nessun servizio');

    // POS-2: solo internet device finanziato + servizio; nessuno smartphone.
    assert.equal(pos2.devices.smartphone.altro.pezzi, 0, 'POS-2: nessuno smartphone');
    assert.equal(pos2.devices.internetDevice.finanziato.pezzi, 1, 'POS-2: 1 internet device finanziato');
    assert.deepEqual(pos2.devices.internetDevice.finanziato.descriptions, { 'B1': 1 });
    assert.equal(pos2.accessori.pezzi, 0, 'POS-2: nessun accessorio');
    assert.equal(pos2.servizi.pezzi, 1, 'POS-2: 1 servizio');
    assert.equal(pos2.servizi.importo, 30, 'POS-2: servizi importo 30');
  } finally {
    await cleanupOrg(orgId);
  }
});

// ===========================================================================
// SCENARIO 4: la modalità è dedotta a livello di VENDITA — una domanda su un
// articolo qualsiasi della vendita marca TUTTI i device della stessa vendita,
// e più device nella stessa vendita condividono la modalità.
// ===========================================================================
test('scenario 4: sale-level modality applies to all devices in the sale', async () => {
  const orgId = await createOrg();
  try {
    // Una sola vendita con smartphone + smart device + un accessorio che porta
    // la domanda di finanziamento (COMPASS SI). Entrambi i device => finanziato.
    await insertSale(orgId, {
      codicePos: 'POS-MULTI', nomeNegozio: 'Multi', ragioneSociale: 'Multi Srl',
      articoli: [
        art('TELEFONIA', 'PhoneA'),
        art('SMART DEVICE', 'TabA'),
        art('ACCESSORI', 'Cover', { importoImponibile: 10, domandeRisposte: Q_COMPASS_SI }),
      ],
    });

    const sales = await storage.getBisuiteSalesByItalianMonth(orgId, YEAR, MONTH);
    assert.equal(sales.length, 1, 'una sola vendita seminata');

    const agg = aggregateMappedSales(sales, RULES);
    const posMulti = pdvByPos(agg)['POS-MULTI'];
    assert.ok(posMulti, 'POS-MULTI deve comparire');

    // La domanda sull'accessorio marca finanziato l'intera vendita.
    assert.equal(posMulti.devices.smartphone.finanziato.pezzi, 1, 'smartphone finanziato dalla domanda su altro articolo');
    assert.deepEqual(posMulti.devices.smartphone.finanziato.descriptions, { 'PhoneA': 1 });
    assert.equal(posMulti.devices.smartDevice.finanziato.pezzi, 1, 'smart device finanziato dalla stessa vendita');
    assert.deepEqual(posMulti.devices.smartDevice.finanziato.descriptions, { 'TabA': 1 });
    assert.equal(posMulti.devices.smartphone.altro.pezzi, 0, 'nessuno smartphone in altro');

    // L'accessorio è comunque conteggiato nel secchio accessori.
    assert.equal(posMulti.accessori.pezzi, 1, '1 accessorio');
    assert.equal(posMulti.accessori.importo, 10, 'accessori importo 10');
  } finally {
    await cleanupOrg(orgId);
  }
});
