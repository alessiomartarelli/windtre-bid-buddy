import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

// Test suite DB-backed "Tally piste/addon dopo il refactor di aggregazione"
// (Task #297, regressione di Task #291).
//
// Task #291 ha estratto TUTTA l'aggregazione delle vendite mappate dalla route
// GET /api/admin/bisuite-mapped-sales nel modulo server/bisuiteMappedSales.ts
// (`aggregateMappedSales`). Le suite DB-backed esistenti coprono la fetta
// caring/CB (tests/caring-cb-exclusion-db.test.mjs) e le card
// device/accessori/servizi (tests/devices-accessori-servizi-db.test.mjs). Resta
// scoperto da una regressione DB-backed il CUORE del mapping per pista:
//   - gli item BASE (pezzi + canone accumulati per pista/targetCategory);
//   - il percorso ADDITIONAL / addon (occorrenze + canone, con il canone
//     accumulato SOLO per il set CANONE_BASED_ADDONS: CONVERGENZA /
//     LINEA_ATTIVA / FIBRA_FTTH_ADDON / VOCE_UNLIMITED / CONVERGENZA_LUCE_GAS /
//     CONVERGENTE_ASSICUR, e canone 0 per gli altri addon);
//   - le descrizioni accumulate per gli item SIM_IVA;
//   - i rollup totaliPerPista / totaliAddonsPerPista;
//   - i conteggi globali totalMapped / totalUnmapped / totalArticoli.
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
  const name = uniq('PistaAddonDB');
  const r = await pool.query(
    `INSERT INTO organizations (name) VALUES ($1) RETURNING id`,
    [name],
  );
  return r.rows[0].id;
}

// Costruisce un articolo BiSuite mappabile (categoria/tipologia/descrizione)
// con canone e domande/risposte opzionali nel dettaglio.
function art(catNome, tipNome, { descrizione, canone, domandeRisposte } = {}) {
  const dettaglio = {};
  if (canone !== undefined) dettaglio.canone = String(canone);
  if (domandeRisposte !== undefined) dettaglio.domandeRisposte = domandeRisposte;
  return {
    categoria: { nome: catNome },
    tipologia: { nome: tipNome },
    descrizione,
    dettaglio,
  };
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

function findItem(pdv, pista, targetCategory) {
  return pdv.items.find((i) => i.pista === pista && i.targetCategory === targetCategory);
}

function findAddon(pdv, pista, targetCategory) {
  return pdv.addons.find((a) => a.pista === pista && a.targetCategory === targetCategory);
}

// ===========================================================================
// SCENARIO 1: item BASE — pezzi + canone accumulati per pista/targetCategory,
// con rollup totaliPerPista e conteggi globali totalMapped/totalUnmapped.
// ===========================================================================
test('scenario 1: base items pezzi+canone per pista e rollup totaliPerPista', async () => {
  const orgId = await createOrg();
  try {
    const pos = { codicePos: 'POS-BASE', nomeNegozio: 'Negozio Base', ragioneSociale: 'Base Srl' };

    // 2 fisso base FISSO_FTTH: canone 20 + 30 = 50, pezzi 2 (pista fisso).
    await insertSale(orgId, { ...pos, articoli: [art('ADSL/FIBRA/FWA CF', 'FIBRA FTTH CF', { canone: 20 })] });
    await insertSale(orgId, { ...pos, articoli: [art('ADSL/FIBRA/FWA CF', 'FIBRA FTTH CF', { canone: 30 })] });
    // 1 mobile base TIED: canone 10, pezzi 1 (pista mobile).
    await insertSale(orgId, { ...pos, articoli: [art('TIED CF', 'VOCE EASYPAY', { canone: 10 })] });

    const sales = await storage.getBisuiteSalesByItalianMonth(orgId, YEAR, MONTH);
    assert.equal(sales.length, 3, 'devono tornare le 3 vendite seminate');

    const agg = aggregateMappedSales(sales, RULES);
    const posBase = pdvByPos(agg)['POS-BASE'];
    assert.ok(posBase, 'POS-BASE deve comparire');

    // Item base FISSO_FTTH (pista fisso): pezzi 2, canone 50, ruleType base.
    const ftth = findItem(posBase, 'fisso', 'FISSO_FTTH');
    assert.ok(ftth, 'item fisso:FISSO_FTTH atteso');
    assert.equal(ftth.pezzi, 2, 'FISSO_FTTH pezzi = 2');
    assert.equal(ftth.canone, 50, 'FISSO_FTTH canone = 20 + 30');
    assert.equal(ftth.ruleType, 'base', 'FISSO_FTTH ruleType = base');

    // Item base TIED (pista mobile): pezzi 1, canone 10.
    const tied = findItem(posBase, 'mobile', 'TIED');
    assert.ok(tied, 'item mobile:TIED atteso');
    assert.equal(tied.pezzi, 1, 'TIED pezzi = 1');
    assert.equal(tied.canone, 10, 'TIED canone = 10');

    // Rollup totaliPerPista.
    assert.equal(agg.totaliPerPista['fisso']?.['FISSO_FTTH']?.pezzi, 2, 'totali fisso FISSO_FTTH pezzi = 2');
    assert.equal(agg.totaliPerPista['fisso']?.['FISSO_FTTH']?.canone, 50, 'totali fisso FISSO_FTTH canone = 50');
    assert.equal(agg.totaliPerPista['mobile']?.['TIED']?.pezzi, 1, 'totali mobile TIED pezzi = 1');
    assert.equal(agg.totaliPerPista['mobile']?.['TIED']?.canone, 10, 'totali mobile TIED canone = 10');

    // Conteggi globali: 3 articoli, tutti mappati.
    assert.equal(agg.totalArticoli, 3, 'totalArticoli = 3');
    assert.equal(agg.totalMapped, 3, 'totalMapped = 3');
    assert.equal(agg.totalUnmapped, 0, 'totalUnmapped = 0');
  } finally {
    await cleanupOrg(orgId);
  }
});

// ===========================================================================
// SCENARIO 2: percorso ADDITIONAL/addon — occorrenze + canone, con canone
// SOLO per gli addon del set CANONE_BASED_ADDONS (CONVERGENZA) e canone 0 per
// gli altri (NETFLIX_CON_ADV). Rollup totaliAddonsPerPista. Il canone dell'item
// base viene accumulato separatamente dall'addon canone-based sullo stesso art.
// ===========================================================================
test('scenario 2: addon occorrenze+canone (canone solo per CANONE_BASED) e rollup addons', async () => {
  const orgId = await createOrg();
  try {
    const pos = { codicePos: 'POS-ADDON', nomeNegozio: 'Negozio Addon', ragioneSociale: 'Addon Srl' };

    // 2 articoli identici: base FISSO_FTTH (canone 35) + CONVERGENZA (canone
    // based) + NETFLIX_CON_ADV (non canone based), tutti sullo stesso articolo.
    const domande = [
      { domandaTesto: 'CONVERGENTE MOBILE', risposta: 'SI' },
      { domandaTesto: 'NETFLIX', risposta: 'SI' },
    ];
    await insertSale(orgId, { ...pos, articoli: [art('ADSL/FIBRA/FWA CF', 'FIBRA FTTH CF', { canone: 35, domandeRisposte: domande })] });
    await insertSale(orgId, { ...pos, articoli: [art('ADSL/FIBRA/FWA CF', 'FIBRA FTTH CF', { canone: 35, domandeRisposte: domande })] });

    const sales = await storage.getBisuiteSalesByItalianMonth(orgId, YEAR, MONTH);
    assert.equal(sales.length, 2, 'devono tornare le 2 vendite seminate');

    const agg = aggregateMappedSales(sales, RULES);
    const posAddon = pdvByPos(agg)['POS-ADDON'];
    assert.ok(posAddon, 'POS-ADDON deve comparire');

    // Item base FISSO_FTTH: pezzi 2, canone 70 (canone accumulato per l'item).
    const ftth = findItem(posAddon, 'fisso', 'FISSO_FTTH');
    assert.ok(ftth, 'item fisso:FISSO_FTTH atteso');
    assert.equal(ftth.pezzi, 2, 'FISSO_FTTH pezzi = 2');
    assert.equal(ftth.canone, 70, 'FISSO_FTTH canone = 35 * 2');

    // Addon CANONE_BASED: CONVERGENZA occorrenze 2, canone 70 (35 * 2).
    const conv = findAddon(posAddon, 'fisso', 'CONVERGENZA');
    assert.ok(conv, 'addon fisso:CONVERGENZA atteso');
    assert.equal(conv.occorrenze, 2, 'CONVERGENZA occorrenze = 2');
    assert.equal(conv.canone, 70, 'CONVERGENZA canone = 35 * 2 (canone based)');

    // Addon NON canone based: NETFLIX_CON_ADV occorrenze 2, canone 0.
    const netflix = findAddon(posAddon, 'fisso', 'NETFLIX_CON_ADV');
    assert.ok(netflix, 'addon fisso:NETFLIX_CON_ADV atteso');
    assert.equal(netflix.occorrenze, 2, 'NETFLIX_CON_ADV occorrenze = 2');
    assert.equal(netflix.canone, 0, 'NETFLIX_CON_ADV canone = 0 (non canone based)');

    // Rollup totaliAddonsPerPista.
    const addonsFisso = agg.totaliAddonsPerPista['fisso'] || {};
    assert.equal(addonsFisso['CONVERGENZA']?.occorrenze, 2, 'totali addon CONVERGENZA occorrenze = 2');
    assert.equal(addonsFisso['CONVERGENZA']?.canone, 70, 'totali addon CONVERGENZA canone = 70');
    assert.equal(addonsFisso['NETFLIX_CON_ADV']?.occorrenze, 2, 'totali addon NETFLIX occorrenze = 2');
    assert.equal(addonsFisso['NETFLIX_CON_ADV']?.canone, 0, 'totali addon NETFLIX canone = 0');

    // Gli addon NON sono item: gli item della pista fisso sono solo FISSO_FTTH.
    assert.equal(posAddon.items.filter((i) => i.pista === 'fisso').length, 1, 'un solo item base fisso (no addon negli items)');
    // 2 articoli canvass, entrambi mappati (base + addon dallo stesso art
    // contano come un solo articolo mappato).
    assert.equal(agg.totalArticoli, 2, 'totalArticoli = 2');
    assert.equal(agg.totalMapped, 2, 'totalMapped = 2');
    assert.equal(agg.totalUnmapped, 0, 'totalUnmapped = 0');
  } finally {
    await cleanupOrg(orgId);
  }
});

// ===========================================================================
// SCENARIO 3: item SIM_IVA — le descrizioni sono accumulate per descrizione,
// con i pezzi corretti.
// ===========================================================================
test('scenario 3: SIM_IVA accumula le descrizioni per descrizione', async () => {
  const orgId = await createOrg();
  try {
    const pos = { codicePos: 'POS-SIM', nomeNegozio: 'Negozio Sim', ragioneSociale: 'Sim Srl' };

    // 3 SIM IVA base (categoria TIED IVA / tipologia VOCE IVA). Le descrizioni
    // NON contengono "PROFESSIONAL ..." per non finire sulle varianti
    // Professional (priority 15): restano quindi su SIM_IVA (priority 10).
    await insertSale(orgId, { ...pos, articoli: [art('TIED IVA', 'VOCE IVA', { descrizione: 'Business Voce 50', canone: 5 })] });
    await insertSale(orgId, { ...pos, articoli: [art('TIED IVA', 'VOCE IVA', { descrizione: 'Business Voce 50', canone: 5 })] });
    await insertSale(orgId, { ...pos, articoli: [art('TIED IVA', 'VOCE IVA', { descrizione: 'Business Voce 100', canone: 8 })] });

    const sales = await storage.getBisuiteSalesByItalianMonth(orgId, YEAR, MONTH);
    assert.equal(sales.length, 3, 'devono tornare le 3 vendite seminate');

    const agg = aggregateMappedSales(sales, RULES);
    const posSim = pdvByPos(agg)['POS-SIM'];
    assert.ok(posSim, 'POS-SIM deve comparire');

    const sim = findItem(posSim, 'mobile', 'SIM_IVA');
    assert.ok(sim, 'item mobile:SIM_IVA atteso');
    assert.equal(sim.pezzi, 3, 'SIM_IVA pezzi = 3');
    assert.equal(sim.canone, 18, 'SIM_IVA canone = 5 + 5 + 8');
    assert.deepEqual(
      sim.descriptions,
      { 'Business Voce 50': 2, 'Business Voce 100': 1 },
      'descrizioni SIM_IVA accumulate per descrizione',
    );

    // Rollup: il totale per pista riflette i pezzi SIM_IVA.
    assert.equal(agg.totaliPerPista['mobile']?.['SIM_IVA']?.pezzi, 3, 'totali mobile SIM_IVA pezzi = 3');
  } finally {
    await cleanupOrg(orgId);
  }
});

// ===========================================================================
// SCENARIO 4: conteggi globali totalMapped / totalUnmapped / totalArticoli con
// un mix di articoli mappati e non mappati, e isolamento dei totali per PDV.
// ===========================================================================
test('scenario 4: totalMapped/totalUnmapped e separazione per PDV', async () => {
  const orgId = await createOrg();
  try {
    // POS-1: 1 fisso base mappato + 1 articolo canvass NON mappabile.
    await insertSale(orgId, {
      codicePos: 'POS-1', nomeNegozio: 'Uno', ragioneSociale: 'Uno Srl',
      articoli: [art('ADSL/FIBRA/FWA CF', 'FIBRA FTTH CF', { canone: 22 })],
    });
    await insertSale(orgId, {
      codicePos: 'POS-1', nomeNegozio: 'Uno', ragioneSociale: 'Uno Srl',
      // Categoria "canvass" (non PRODOTTI/SERVIZI) che non matcha alcuna regola.
      articoli: [art('UNTIED', 'TIPOLOGIA SCONOSCIUTA', { canone: 0 })],
    });

    // POS-2: 1 mobile base mappato.
    await insertSale(orgId, {
      codicePos: 'POS-2', nomeNegozio: 'Due', ragioneSociale: 'Due Srl',
      articoli: [art('TIED CF', 'VOCE EASYPAY', { canone: 12 })],
    });

    const sales = await storage.getBisuiteSalesByItalianMonth(orgId, YEAR, MONTH);
    assert.equal(sales.length, 3, 'devono tornare le 3 vendite seminate');

    const agg = aggregateMappedSales(sales, RULES);
    const byPos = pdvByPos(agg);
    const pos1 = byPos['POS-1'];
    const pos2 = byPos['POS-2'];
    assert.ok(pos1 && pos2, 'entrambi i PDV devono comparire');

    // POS-1: 2 articoli canvass, 1 mappato + 1 unmapped.
    assert.equal(pos1.totalArticoli, 2, 'POS-1 totalArticoli = 2');
    assert.equal(pos1.unmapped, 1, 'POS-1 unmapped = 1');
    assert.ok(findItem(pos1, 'fisso', 'FISSO_FTTH'), 'POS-1 ha il fisso mappato');
    // Il fisso di POS-1 NON travasa su POS-2.
    assert.equal(findItem(pos2, 'fisso', 'FISSO_FTTH'), undefined, 'POS-2 non ha il fisso di POS-1');

    // POS-2: 1 articolo mappato, nessun unmapped.
    assert.equal(pos2.totalArticoli, 1, 'POS-2 totalArticoli = 1');
    assert.equal(pos2.unmapped, 0, 'POS-2 unmapped = 0');
    assert.ok(findItem(pos2, 'mobile', 'TIED'), 'POS-2 ha il mobile mappato');

    // Conteggi globali: 3 articoli, 2 mappati, 1 unmapped.
    assert.equal(agg.totalArticoli, 3, 'totalArticoli = 3');
    assert.equal(agg.totalMapped, 2, 'totalMapped = 2');
    assert.equal(agg.totalUnmapped, 1, 'totalUnmapped = 1');
  } finally {
    await cleanupOrg(orgId);
  }
});
