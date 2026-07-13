import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

// Test suite DB-backed "Coupon Caring esclusi dai totali CB via sync live"
// (Task #291, regressione di Task #289/#290).
//
// A differenza del test PURO (tests/caring-cb-exclusion.test.mjs) che alimenta
// le funzioni di mapping/calc con fixture in-memory, questo test esercita il
// VERO percorso di aggregazione server-side: semina righe `bisuite_sales`
// persistite per un'org effimera, le rilegge con lo stesso storage usato dalla
// route GET /api/admin/bisuite-mapped-sales, applica `mergeWithDefaultRules`
// (regole EFFETTIVE) e `aggregateMappedSales` (la funzione estratta dalla route
// e da essa richiamata) e verifica che:
//   - le offerte COUPON CARING TIED/UNTIED finiscano SOLO nella categoria
//     `coupon_caring` della pista `cb`, con i pezzi corretti per PDV;
//   - i veri eventi CB (rivincoli/untied) NON vengano gonfiati dal caring;
//   - il caring NON generi un gemello sulla pista `partnership`.
//
// DB-backed ma NON passa dall'HTTP: chiama direttamente storage +
// aggregateMappedSales via loader `tsx`, sullo stesso pool `pg`.
// Richiede solo DATABASE_URL (non il dev server).

const { storage } = await import('../server/storage.ts');
const { pool } = await import('../server/db.ts');
const { aggregateMappedSales } = await import('../server/bisuiteMappedSales.ts');
const {
  getDefaultMappingRules,
  mergeWithDefaultRules,
  COUPON_CARING_CATEGORY,
} = await import('../shared/bisuiteMapping.ts');

// Regole EFFETTIVE: default + gemelli partnership sintetici, esattamente come
// fa la route quando l'org non ha salvato regole custom.
const RULES = mergeWithDefaultRules(getDefaultMappingRules());

// Mese/anno del seed. Le date sono ancorate a metà mese in UTC per stare al
// sicuro dentro il range del mese italiano indipendentemente dal fuso.
const YEAR = 2026;
const MONTH = 7;
const DATA_VENDITA = '2026-07-15T10:00:00.000Z';

// Articoli chiave (categoria/tipologia) e come devono essere mappati sulla CB.
const ART_CARING_TIED = { categoria: { nome: 'MIA TIED' }, tipologia: { nome: 'COUPON CARING TIED' } };
const ART_CARING_UNTIED = { categoria: { nome: 'MIA UNTIED' }, tipologia: { nome: 'COUPON CARING UNTIED' } };
const ART_RIVINCOLO = { categoria: { nome: 'RIVINCOLO' }, tipologia: { nome: 'RIVINCOLO VOCE' } };
const ART_MIA_UNTIED = { categoria: { nome: 'MIA UNTIED' }, tipologia: { nome: 'MIA UNTIED STANDARD' } };

function uniq(prefix) {
  return `${prefix}_${crypto.randomBytes(4).toString('hex')}`;
}

after(async () => {
  await pool.end().catch(() => {});
});

async function createOrg() {
  const name = uniq('CaringDB');
  const r = await pool.query(
    `INSERT INTO organizations (name) VALUES ($1) RETURNING id`,
    [name],
  );
  return r.rows[0].id;
}

// Inserisce una vendita BiSuite con un singolo articolo, associata a un PDV.
async function insertSale(orgId, { codicePos, nomeNegozio, ragioneSociale, articolo, stato = 'ATTIVO', clienteTipo = 'PRIVATO', dataVendita = DATA_VENDITA }) {
  const bisuiteId = Math.floor(Math.random() * 2_000_000_000);
  const raw = {
    cliente: { clienteTipo },
    articoli: [articolo],
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

// Ricava, dalla struttura byPdv aggregata, i pezzi di una categoria CB per PDV.
function cbPezzi(pdv, targetCategory) {
  const item = pdv.items.find((i) => i.pista === 'cb' && i.targetCategory === targetCategory);
  return item ? item.pezzi : 0;
}

// ===========================================================================
// SCENARIO 1: il caring atterra su cb:coupon_caring con i pezzi corretti per
// PDV, e i veri eventi CB non vengono gonfiati.
// ===========================================================================
test('scenario 1: caring lands in cb:coupon_caring per PDV, real CB events not inflated', async () => {
  const orgId = await createOrg();
  try {
    // POS-A: 3 caring (2 tied + 1 untied) + 2 veri eventi CB (1 rivincolo + 1 untied).
    await insertSale(orgId, { codicePos: 'POS-A', nomeNegozio: 'Negozio A', ragioneSociale: 'Alpha Srl', articolo: ART_CARING_TIED });
    await insertSale(orgId, { codicePos: 'POS-A', nomeNegozio: 'Negozio A', ragioneSociale: 'Alpha Srl', articolo: ART_CARING_TIED });
    await insertSale(orgId, { codicePos: 'POS-A', nomeNegozio: 'Negozio A', ragioneSociale: 'Alpha Srl', articolo: ART_CARING_UNTIED });
    await insertSale(orgId, { codicePos: 'POS-A', nomeNegozio: 'Negozio A', ragioneSociale: 'Alpha Srl', articolo: ART_RIVINCOLO });
    await insertSale(orgId, { codicePos: 'POS-A', nomeNegozio: 'Negozio A', ragioneSociale: 'Alpha Srl', articolo: ART_MIA_UNTIED });

    // POS-B: 1 caring untied, nessun vero evento CB.
    await insertSale(orgId, { codicePos: 'POS-B', nomeNegozio: 'Negozio B', ragioneSociale: 'Beta Snc', articolo: ART_CARING_UNTIED });

    const sales = await storage.getBisuiteSalesByItalianMonth(orgId, YEAR, MONTH);
    assert.equal(sales.length, 6, 'devono tornare le 6 vendite ATTIVO seminate');

    const agg = aggregateMappedSales(sales, RULES);
    const byPos = Object.fromEntries(agg.pdvList.map((p) => [p.codicePos, p]));

    const posA = byPos['POS-A'];
    assert.ok(posA, 'POS-A deve comparire');
    // Caring: 3 pezzi nella categoria dedicata coupon_caring.
    assert.equal(cbPezzi(posA, COUPON_CARING_CATEGORY), 3, 'POS-A: 3 caring su cb:coupon_caring');
    // Veri eventi CB: 1 rivincolo + 1 untied, NON gonfiati dal caring.
    assert.equal(cbPezzi(posA, 'cambio_offerta_rivincoli'), 1, 'POS-A: 1 solo rivincolo');
    assert.equal(cbPezzi(posA, 'cambio_offerta_untied'), 1, 'POS-A: 1 solo untied');

    const posB = byPos['POS-B'];
    assert.ok(posB, 'POS-B deve comparire');
    assert.equal(cbPezzi(posB, COUPON_CARING_CATEGORY), 1, 'POS-B: 1 caring su cb:coupon_caring');
    assert.equal(cbPezzi(posB, 'cambio_offerta_rivincoli'), 0, 'POS-B: nessun rivincolo');
    assert.equal(cbPezzi(posB, 'cambio_offerta_untied'), 0, 'POS-B: nessun untied');

    // Totali per pista: coupon_caring è separato dai veri eventi CB.
    const cbTot = agg.totaliPerPista['cb'] || {};
    assert.equal(cbTot[COUPON_CARING_CATEGORY]?.pezzi, 4, 'totale caring = 3 (A) + 1 (B)');
    assert.equal(cbTot['cambio_offerta_rivincoli']?.pezzi, 1, 'totale rivincoli = 1');
    assert.equal(cbTot['cambio_offerta_untied']?.pezzi, 1, 'totale untied = 1');
  } finally {
    await cleanupOrg(orgId);
  }
});

// ===========================================================================
// SCENARIO 2: il caring NON genera un gemello sulla pista partnership, mentre i
// veri eventi CB (rivincoli/untied) sì.
// ===========================================================================
test('scenario 2: caring produces no partnership twin; real CB events do', async () => {
  const orgId = await createOrg();
  try {
    await insertSale(orgId, { codicePos: 'POS-C', nomeNegozio: 'Negozio C', ragioneSociale: 'Gamma Srl', articolo: ART_CARING_TIED });
    await insertSale(orgId, { codicePos: 'POS-C', nomeNegozio: 'Negozio C', ragioneSociale: 'Gamma Srl', articolo: ART_CARING_UNTIED });
    await insertSale(orgId, { codicePos: 'POS-C', nomeNegozio: 'Negozio C', ragioneSociale: 'Gamma Srl', articolo: ART_RIVINCOLO });
    await insertSale(orgId, { codicePos: 'POS-C', nomeNegozio: 'Negozio C', ragioneSociale: 'Gamma Srl', articolo: ART_MIA_UNTIED });

    const sales = await storage.getBisuiteSalesByItalianMonth(orgId, YEAR, MONTH);
    const agg = aggregateMappedSales(sales, RULES);
    const posC = Object.fromEntries(agg.pdvList.map((p) => [p.codicePos, p]))['POS-C'];
    assert.ok(posC, 'POS-C deve comparire');

    // Nessun item su pista partnership con targetCategory coupon_caring.
    const partnershipCaring = posC.items.filter(
      (i) => i.pista === 'partnership' && i.targetCategory === COUPON_CARING_CATEGORY,
    );
    assert.equal(partnershipCaring.length, 0, 'il caring non deve avere gemello partnership');

    // Sanity: i veri eventi CB producono i gemelli partnership attesi.
    const partnershipTot = agg.totaliPerPista['partnership'] || {};
    assert.equal(partnershipTot['cambio_offerta_rivincoli']?.pezzi, 1, 'gemello partnership rivincoli atteso');
    assert.equal(partnershipTot['cambio_offerta_untied']?.pezzi, 1, 'gemello partnership untied atteso');
    // E il gemello partnership NON esiste per coupon_caring.
    assert.equal(partnershipTot[COUPON_CARING_CATEGORY], undefined, 'nessun totale partnership per coupon_caring');
  } finally {
    await cleanupOrg(orgId);
  }
});

// ===========================================================================
// SCENARIO 3: le vendite ANNULLATA (caring o CB) sono escluse dall'aggregazione
// (getBisuiteSalesByItalianMonth non le restituisce di default).
// ===========================================================================
test('scenario 3: ANNULLATA caring/CB sales are excluded from the aggregation', async () => {
  const orgId = await createOrg();
  try {
    // Vendite valide.
    await insertSale(orgId, { codicePos: 'POS-D', nomeNegozio: 'Negozio D', ragioneSociale: 'Delta Srl', articolo: ART_CARING_TIED });
    await insertSale(orgId, { codicePos: 'POS-D', nomeNegozio: 'Negozio D', ragioneSociale: 'Delta Srl', articolo: ART_RIVINCOLO });
    // Vendite ANNULLATA: NON devono contare.
    await insertSale(orgId, { codicePos: 'POS-D', nomeNegozio: 'Negozio D', ragioneSociale: 'Delta Srl', articolo: ART_CARING_TIED, stato: 'ANNULLATA' });
    await insertSale(orgId, { codicePos: 'POS-D', nomeNegozio: 'Negozio D', ragioneSociale: 'Delta Srl', articolo: ART_RIVINCOLO, stato: 'ANNULLATA' });

    const sales = await storage.getBisuiteSalesByItalianMonth(orgId, YEAR, MONTH);
    assert.equal(sales.length, 2, 'le vendite ANNULLATA devono essere escluse dal load');

    const agg = aggregateMappedSales(sales, RULES);
    const posD = Object.fromEntries(agg.pdvList.map((p) => [p.codicePos, p]))['POS-D'];
    assert.ok(posD, 'POS-D deve comparire');
    assert.equal(cbPezzi(posD, COUPON_CARING_CATEGORY), 1, 'solo 1 caring valido');
    assert.equal(cbPezzi(posD, 'cambio_offerta_rivincoli'), 1, 'solo 1 rivincolo valido');
  } finally {
    await cleanupOrg(orgId);
  }
});
