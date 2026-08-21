import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

// Test suite DB-backed "Perimetro RS/PDV su vendite mappate" (Task #478).
//
// Copre `filterSalesByPerimeter` in server/bisuiteMappedSales.ts: il filtro
// opzionale della route GET /api/admin/bisuite-mapped-sales che restringe le
// vendite PRIMA dell'aggregazione, così che daily / totalSales (=sales.length)
// / totalImporto riflettano il perimetro RS/PDV scelto sulla Dashboard Gara
// Reale (non ricostruibili lato client per singolo PDV).
//
// Come le altre suite DB-backed: semina righe `bisuite_sales` per un'org
// effimera, le rilegge con lo storage usato dalla route, applica il filtro
// perimetro e aggrega, senza HTTP. Richiede solo DATABASE_URL.

const { storage } = await import('../server/storage.ts');
const { pool } = await import('../server/db.ts');
const { aggregateMappedSales, filterSalesByPerimeter } = await import('../server/bisuiteMappedSales.ts');
const {
  getDefaultMappingRules,
  mergeWithDefaultRules,
} = await import('../shared/bisuiteMapping.ts');

const RULES = mergeWithDefaultRules(getDefaultMappingRules());

const YEAR = 2026;
const MONTH = 7; // Luglio 2026.

function uniq(prefix) {
  return `${prefix}_${crypto.randomBytes(4).toString('hex')}`;
}

after(async () => {
  await pool.end().catch(() => {});
});

async function createOrg() {
  const name = uniq('PerimetroDB');
  const r = await pool.query(
    `INSERT INTO organizations (name) VALUES ($1) RETURNING id`,
    [name],
  );
  return r.rows[0].id;
}

// Un articolo mobile base TIED (pista mobile) — mappabile.
function tiedArt(canone = 10) {
  return {
    categoria: { nome: 'TIED CF' },
    tipologia: { nome: 'VOCE EASYPAY' },
    dettaglio: { canone: String(canone) },
  };
}

// Inserisce una vendita BiSuite con data, PDV, RS, totale e (opzionale)
// PDV di destinazione in rawData.attivitaDestinazione.
async function insertSale(orgId, {
  codicePos,
  nomeNegozio = 'Negozio',
  ragioneSociale = 'RS Srl',
  dataVendita,
  totale = 100,
  destinazione,
}) {
  const bisuiteId = Math.floor(Math.random() * 2_000_000_000);
  const raw = {
    cliente: { clienteTipo: 'PRIVATO' },
    articoli: [tiedArt()],
    ...(destinazione
      ? { attivitaDestinazione: { codiceOperatoreWind: destinazione.codicePos, nominativo: destinazione.nome || destinazione.codicePos } }
      : {}),
  };
  await pool.query(
    `INSERT INTO bisuite_sales
       (organization_id, bisuite_id, data_vendita, codice_pos, nome_negozio, ragione_sociale, stato, totale, raw_data)
     VALUES ($1, $2, $3, $4, $5, $6, 'ATTIVO', $7, $8::jsonb)`,
    [orgId, bisuiteId, dataVendita, codicePos, nomeNegozio, ragioneSociale, String(totale), JSON.stringify(raw)],
  );
}

async function cleanupOrg(orgId) {
  await pool.query(`DELETE FROM bisuite_sales WHERE organization_id = $1`, [orgId]).catch(() => {});
  await pool.query(`DELETE FROM organizations WHERE id = $1`, [orgId]).catch(() => {});
}

// ===========================================================================
// SCENARIO 1: filtro per codicePos — daily/totalSales/totalImporto contano
// solo le vendite del PDV scelto; senza perimetro (liste vuote) passa tutto.
// ===========================================================================
test('scenario 1: perimetro per codicePos scala daily e conteggi', async () => {
  const orgId = await createOrg();
  try {
    // POS-A: 2 vendite in 2 giorni diversi; POS-B: 1 vendita in un terzo giorno.
    await insertSale(orgId, { codicePos: 'POS-A', dataVendita: '2026-07-06T10:00:00.000Z', totale: 100 });
    await insertSale(orgId, { codicePos: 'POS-A', dataVendita: '2026-07-07T10:00:00.000Z', totale: 50 });
    await insertSale(orgId, { codicePos: 'POS-B', dataVendita: '2026-07-08T10:00:00.000Z', totale: 30 });

    const allSales = await storage.getBisuiteSalesByItalianMonth(orgId, YEAR, MONTH);
    assert.equal(allSales.length, 3);

    // Nessun perimetro (undefined o liste vuote): passa tutto, invariato.
    assert.equal(filterSalesByPerimeter(allSales, undefined, 'origine').length, 3);
    assert.equal(filterSalesByPerimeter(allSales, { codicePos: [], ragioniSociali: [] }, 'origine').length, 3);

    // Perimetro POS-A: 2 vendite, 2 giorni, importo 150.
    const filtered = filterSalesByPerimeter(allSales, { codicePos: ['POS-A'] }, 'origine');
    assert.equal(filtered.length, 2, 'totalSales = sales.length riflette il perimetro');
    const agg = aggregateMappedSales(filtered, RULES);
    assert.equal(agg.totalImporto, 150, 'totalImporto solo del PDV scelto');
    assert.deepEqual(agg.daily.map((d) => d.day), ['2026-07-06', '2026-07-07'], 'daily solo dei giorni del PDV scelto');
    assert.deepEqual(agg.daily.map((d) => d.vendite), [1, 1]);
    assert.deepEqual(agg.daily.map((d) => d.importo), [100, 50]);
    assert.equal(agg.pdvList.length, 1, 'aggregazione limitata al PDV in perimetro');
    assert.equal(agg.pdvList[0].codicePos, 'POS-A');

    // Perimetro multi-PDV: entrambi.
    const both = filterSalesByPerimeter(allSales, { codicePos: ['POS-A', 'POS-B'] }, 'origine');
    assert.equal(both.length, 3);
  } finally {
    await cleanupOrg(orgId);
  }
});

// ===========================================================================
// SCENARIO 2: filtro per ragione sociale — match sulla RS normalizzata
// (varianti maiuscole/spazi), in OR con la lista codicePos (come il memo
// client: PDV in config OPPURE RS delle vendite).
// ===========================================================================
test('scenario 2: perimetro per RS normalizzata, in OR con codicePos', async () => {
  const orgId = await createOrg();
  try {
    await insertSale(orgId, { codicePos: 'POS-R1', ragioneSociale: 'Alfa S.r.l.', dataVendita: '2026-07-06T10:00:00.000Z', totale: 10 });
    await insertSale(orgId, { codicePos: 'POS-R2', ragioneSociale: '  ALFA SRL ', dataVendita: '2026-07-07T10:00:00.000Z', totale: 20 });
    await insertSale(orgId, { codicePos: 'POS-X', ragioneSociale: 'Beta Spa', dataVendita: '2026-07-08T10:00:00.000Z', totale: 40 });

    const allSales = await storage.getBisuiteSalesByItalianMonth(orgId, YEAR, MONTH);

    // Solo RS: le due varianti "Alfa" reggono, Beta no.
    const rsOnly = filterSalesByPerimeter(allSales, { ragioniSociali: ['alfa srl'] }, 'origine');
    assert.equal(rsOnly.length, 2, 'match su RS normalizzata (varianti case/spazi)');
    const aggRs = aggregateMappedSales(rsOnly, RULES);
    assert.equal(aggRs.totalImporto, 30);
    assert.deepEqual(aggRs.daily.map((d) => d.day), ['2026-07-06', '2026-07-07']);

    // OR: RS Alfa + codicePos POS-X → tutte e 3.
    const orBoth = filterSalesByPerimeter(allSales, { codicePos: ['POS-X'], ragioniSociali: ['Alfa Srl'] }, 'origine');
    assert.equal(orBoth.length, 3, 'codicePos e RS sono in OR');
  } finally {
    await cleanupOrg(orgId);
  }
});

// ===========================================================================
// SCENARIO 3: vista Destinazione — il perimetro codicePos matcha il PDV
// risolto per la vista attiva (destinazione), non i campi legacy di origine.
// ===========================================================================
test('scenario 3: perimetro coerente con la vista PDV destinazione', async () => {
  const orgId = await createOrg();
  try {
    // Vendita trasferita: origine POS-O, destinazione POS-D.
    await insertSale(orgId, {
      codicePos: 'POS-O', dataVendita: '2026-07-06T10:00:00.000Z', totale: 70,
      destinazione: { codicePos: 'POS-D', nome: 'Dest' },
    });
    // Vendita senza destinazione su POS-O.
    await insertSale(orgId, { codicePos: 'POS-O', dataVendita: '2026-07-07T10:00:00.000Z', totale: 25 });

    const allSales = await storage.getBisuiteSalesByItalianMonth(orgId, YEAR, MONTH);

    // Vista origine: POS-D non matcha nulla, POS-O matcha entrambe.
    assert.equal(filterSalesByPerimeter(allSales, { codicePos: ['POS-D'] }, 'origine').length, 0);
    assert.equal(filterSalesByPerimeter(allSales, { codicePos: ['POS-O'] }, 'origine').length, 2);

    // Vista destinazione: POS-D matcha la trasferita; POS-O NON matcha nulla
    // (la vendita senza destinazione finisce nel bucket SENZA_DESTINAZIONE,
    // mai attribuita cross-fallback all'origine).
    const destD = filterSalesByPerimeter(allSales, { codicePos: ['POS-D'] }, 'destinazione');
    assert.equal(destD.length, 1);
    const aggD = aggregateMappedSales(destD, RULES, { pdvView: 'destinazione' });
    assert.equal(aggD.totalImporto, 70);
    assert.deepEqual(aggD.daily.map((d) => d.day), ['2026-07-06']);
    assert.equal(filterSalesByPerimeter(allSales, { codicePos: ['POS-O'] }, 'destinazione').length, 0, 'nessun cross-fallback origine in vista destinazione');
    assert.equal(filterSalesByPerimeter(allSales, { codicePos: ['SENZA_DESTINAZIONE'] }, 'destinazione').length, 1, 'bucket esplicito selezionabile');
  } finally {
    await cleanupOrg(orgId);
  }
});
