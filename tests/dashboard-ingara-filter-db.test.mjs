import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

// Test suite DB-backed "Dashboard: solo vendite in-gara del mese selezionato"
// (Task #298).
//
// Copre il LAYER SOPRA l'aggregazione: il filtro che decide QUALI righe
// `bisuite_sales` vengono passate ad `aggregateMappedSales` nella route
// GET /api/admin/bisuite-mapped-sales, cioè:
//   - la finestra mensile italiana (storage.getBisuiteSalesByItalianMonth):
//     solo le vendite del mese/anno selezionato, escluse le ANNULLATA;
//   - il gating inGaraOnly + calendario (selectInGaraSales in
//     server/bisuiteGaraFilter.ts): con inGaraOnly attivo e calendari
//     configurati, solo le vendite che cadono in un giorno di apertura del PDV
//     (calendario italiano, fuso Europe/Rome, override specialDays) reggono;
//     senza calendari, o con inGaraOnly spento, passa tutto.
//
// Come le altre suite DB-backed: semina righe `bisuite_sales` per un'org
// effimera, le rilegge con lo storage usato dalla route e le passa a
// selectInGaraSales / aggregateMappedSales, senza HTTP. Richiede solo
// DATABASE_URL (non il dev server).

const { storage } = await import('../server/storage.ts');
const { pool } = await import('../server/db.ts');
const { aggregateMappedSales } = await import('../server/bisuiteMappedSales.ts');
const { selectInGaraSales } = await import('../server/bisuiteGaraFilter.ts');
const {
  getDefaultMappingRules,
  mergeWithDefaultRules,
} = await import('../shared/bisuiteMapping.ts');

// Regole EFFETTIVE: default + gemelli partnership sintetici, come fa la route.
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
  const name = uniq('IngaraFilterDB');
  const r = await pool.query(
    `INSERT INTO organizations (name) VALUES ($1) RETURNING id`,
    [name],
  );
  return r.rows[0].id;
}

// Semina la gara config con i calendari per PDV (stessa forma che la route
// legge da garaCfg.config.pdvList). Ogni PDV: { codicePos, calendar }.
async function insertGaraConfig(orgId, pdvList) {
  await pool.query(
    `INSERT INTO gara_config (organization_id, month, year, name, config)
     VALUES ($1, $2, $3, $4, $5::jsonb)`,
    [orgId, MONTH, YEAR, 'Gara test', JSON.stringify({ pdvList })],
  );
}

// Un articolo mobile base TIED (pista mobile) — mappabile, pezzi 1.
function tiedArt(canone = 10) {
  return {
    categoria: { nome: 'TIED CF' },
    tipologia: { nome: 'VOCE EASYPAY' },
    dettaglio: { canone: String(canone) },
  };
}

// Inserisce una vendita BiSuite (un solo articolo mobile base) con data e PDV.
async function insertSale(orgId, { codicePos, nomeNegozio = 'Negozio', ragioneSociale = 'RS Srl', dataVendita, stato = 'ATTIVO', canone = 10 }) {
  const bisuiteId = Math.floor(Math.random() * 2_000_000_000);
  const raw = { cliente: { clienteTipo: 'PRIVATO' }, articoli: [tiedArt(canone)] };
  await pool.query(
    `INSERT INTO bisuite_sales
       (organization_id, bisuite_id, data_vendita, codice_pos, nome_negozio, ragione_sociale, stato, raw_data)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)`,
    [orgId, bisuiteId, dataVendita, codicePos, nomeNegozio, ragioneSociale, stato, JSON.stringify(raw)],
  );
}

async function cleanupOrg(orgId) {
  await pool.query(`DELETE FROM bisuite_sales WHERE organization_id = $1`, [orgId]).catch(() => {});
  await pool.query(`DELETE FROM gara_config WHERE organization_id = $1`, [orgId]).catch(() => {});
  await pool.query(`DELETE FROM organizations WHERE id = $1`, [orgId]).catch(() => {});
}

// Calendario "lun–ven" (workingDays 1..5, chiuso sab/dom).
function weekdaysCalendar(specialDays) {
  return {
    weeklySchedule: { workingDays: [1, 2, 3, 4, 5] },
    ...(specialDays ? { specialDays } : {}),
  };
}

// Ripete il percorso della route: legge le vendite del mese e applica il
// filtro in-gara con la gara config del mese.
async function routeSelect(orgId, inGaraOnly) {
  const allSales = await storage.getBisuiteSalesByItalianMonth(orgId, YEAR, MONTH);
  const garaCfg = inGaraOnly ? await storage.getGaraConfig(orgId, MONTH, YEAR) : undefined;
  return { allSales, ...selectInGaraSales(allSales, inGaraOnly, garaCfg) };
}

// ===========================================================================
// SCENARIO 1: finestra mensile italiana — solo le vendite del mese selezionato
// (e non le ANNULLATA) reggono lo storage; le altre non arrivano nemmeno al
// filtro in-gara.
// ===========================================================================
test('scenario 1: finestra mensile italiana + esclusione ANNULLATA', async () => {
  const orgId = await createOrg();
  try {
    const pos = { codicePos: 'POS-M', nomeNegozio: 'Mese', ragioneSociale: 'Mese Srl' };
    // Dentro il mese (luglio 2026), giorni feriali.
    await insertSale(orgId, { ...pos, dataVendita: '2026-07-06T10:00:00.000Z' }); // lun
    await insertSale(orgId, { ...pos, dataVendita: '2026-07-15T10:00:00.000Z' }); // mer
    // Fuori dal mese: giugno e agosto 2026 — NON devono tornare.
    await insertSale(orgId, { ...pos, dataVendita: '2026-06-30T10:00:00.000Z' });
    await insertSale(orgId, { ...pos, dataVendita: '2026-08-01T10:00:00.000Z' });
    // Dentro il mese ma ANNULLATA — esclusa dallo storage.
    await insertSale(orgId, { ...pos, dataVendita: '2026-07-10T10:00:00.000Z', stato: 'ANNULLATA' });

    const allSales = await storage.getBisuiteSalesByItalianMonth(orgId, YEAR, MONTH);
    assert.equal(allSales.length, 2, 'solo le 2 vendite di luglio 2026 non annullate');
    for (const s of allSales) {
      const iso = new Date(s.dataVendita).toISOString();
      assert.ok(iso.startsWith('2026-07'), `vendita fuori mese: ${iso}`);
    }
  } finally {
    await cleanupOrg(orgId);
  }
});

// ===========================================================================
// SCENARIO 2: inGaraOnly con calendario — solo le vendite nei giorni di
// apertura del PDV reggono; i giorni chiusi (weekend) sono esclusi e non
// arrivano all'aggregazione.
// ===========================================================================
test('scenario 2: inGaraOnly esclude i giorni fuori calendario (weekend)', async () => {
  const orgId = await createOrg();
  try {
    const codicePos = 'POS-CAL';
    await insertGaraConfig(orgId, [{ codicePos, calendar: weekdaysCalendar() }]);

    // 2 vendite in giorni feriali (in gara) + 2 nel weekend (fuori gara).
    await insertSale(orgId, { codicePos, dataVendita: '2026-07-06T10:00:00.000Z' }); // lun (in)
    await insertSale(orgId, { codicePos, dataVendita: '2026-07-08T10:00:00.000Z' }); // mer (in)
    await insertSale(orgId, { codicePos, dataVendita: '2026-07-11T10:00:00.000Z' }); // sab (out)
    await insertSale(orgId, { codicePos, dataVendita: '2026-07-12T10:00:00.000Z' }); // dom (out)

    // inGaraOnly OFF: tutte e 4 passano.
    const off = await routeSelect(orgId, false);
    assert.equal(off.allSales.length, 4, 'lo storage rilegge tutte e 4 le vendite di luglio');
    assert.equal(off.sales.length, 4, 'inGaraOnly OFF: passano tutte');
    assert.equal(off.calendarsAvailable, false, 'senza inGaraOnly non si caricano calendari');

    // inGaraOnly ON: solo le 2 feriali.
    const on = await routeSelect(orgId, true);
    assert.equal(on.calendarsAvailable, true, 'calendario del PDV disponibile');
    assert.equal(on.sales.length, 2, 'inGaraOnly ON: solo i 2 giorni feriali');
    assert.equal(on.salesExcludedOutOfGara, 2, '2 vendite escluse (weekend)');

    // Aggregazione: mobile TIED pezzi = 2 (solo le feriali).
    const agg = aggregateMappedSales(on.sales, RULES);
    const pos = agg.pdvList.find((p) => p.codicePos === codicePos);
    assert.ok(pos, 'POS-CAL deve comparire');
    const tied = pos.items.find((i) => i.pista === 'mobile' && i.targetCategory === 'TIED');
    assert.ok(tied, 'item mobile:TIED atteso');
    assert.equal(tied.pezzi, 2, 'solo le 2 vendite in-gara arrivano all\'aggregazione');
    assert.equal(agg.totaliPerPista['mobile']?.['TIED']?.pezzi, 2, 'rollup pista mobile = 2');
  } finally {
    await cleanupOrg(orgId);
  }
});

// ===========================================================================
// SCENARIO 3: override specialDays — un giorno normalmente chiuso ma aperto
// (isOpen true) è in gara; un giorno normalmente aperto ma chiuso (isOpen
// false) è fuori gara.
// ===========================================================================
test('scenario 3: specialDays override i giorni feriali/weekend', async () => {
  const orgId = await createOrg();
  try {
    const codicePos = 'POS-SPEC';
    const specialDays = [
      { date: '2026-07-11', isOpen: true },  // sabato normalmente chiuso, aperto
      { date: '2026-07-08', isOpen: false }, // mercoledì normalmente aperto, chiuso
    ];
    await insertGaraConfig(orgId, [{ codicePos, calendar: weekdaysCalendar(specialDays) }]);

    await insertSale(orgId, { codicePos, dataVendita: '2026-07-06T10:00:00.000Z' }); // lun feriale (in)
    await insertSale(orgId, { codicePos, dataVendita: '2026-07-08T10:00:00.000Z' }); // mer chiuso override (out)
    await insertSale(orgId, { codicePos, dataVendita: '2026-07-11T10:00:00.000Z' }); // sab aperto override (in)
    await insertSale(orgId, { codicePos, dataVendita: '2026-07-12T10:00:00.000Z' }); // dom weekend (out)

    const on = await routeSelect(orgId, true);
    assert.equal(on.sales.length, 2, 'in gara: lun feriale + sab con override aperto');
    assert.equal(on.salesExcludedOutOfGara, 2, 'fuori gara: mer override chiuso + dom');

    const inIsos = on.sales.map((s) => new Date(s.dataVendita).toISOString().slice(0, 10)).sort();
    assert.deepEqual(inIsos, ['2026-07-06', '2026-07-11'], 'restano lun e sab (override)');
  } finally {
    await cleanupOrg(orgId);
  }
});

// ===========================================================================
// SCENARIO 4: nessun calendario configurato — con inGaraOnly attivo ma senza
// calendari (calendarsAvailable false) NON si filtra: passano tutte le vendite
// del mese (fallback anti-blackout). Idem per un PDV senza calendario.
// ===========================================================================
test('scenario 4: nessun calendario => fallback passa tutto (anche inGaraOnly)', async () => {
  const orgId = await createOrg();
  try {
    // Gara config presente ma senza calendari validi per i PDV.
    await insertGaraConfig(orgId, [{ codicePos: 'POS-NOCAL' }]);

    await insertSale(orgId, { codicePos: 'POS-NOCAL', dataVendita: '2026-07-11T10:00:00.000Z' }); // sab
    await insertSale(orgId, { codicePos: 'POS-NOCAL', dataVendita: '2026-07-12T10:00:00.000Z' }); // dom

    const on = await routeSelect(orgId, true);
    assert.equal(on.calendarsAvailable, false, 'nessun calendario valido');
    assert.equal(on.sales.length, 2, 'fallback: passano tutte le vendite del mese');
    assert.equal(on.salesExcludedOutOfGara, 0, 'niente escluso senza calendari');
  } finally {
    await cleanupOrg(orgId);
  }
});

// ===========================================================================
// SCENARIO 5: un PDV con calendario filtra solo le PROPRIE vendite; un altro
// PDV senza calendario passa comunque (fallback per PDV). Nessun
// doppio-conteggio: ogni vendita è valutata una sola volta.
// ===========================================================================
test('scenario 5: filtro per-PDV, no doppio conteggio', async () => {
  const orgId = await createOrg();
  try {
    // POS-A ha calendario lun-ven; POS-B non ha calendario.
    await insertGaraConfig(orgId, [
      { codicePos: 'POS-A', calendar: weekdaysCalendar() },
      { codicePos: 'POS-B' },
    ]);

    // POS-A: 1 feriale (in) + 1 weekend (out).
    await insertSale(orgId, { codicePos: 'POS-A', dataVendita: '2026-07-06T10:00:00.000Z' }); // lun in
    await insertSale(orgId, { codicePos: 'POS-A', dataVendita: '2026-07-11T10:00:00.000Z' }); // sab out
    // POS-B: 1 weekend — senza calendario passa (fallback).
    await insertSale(orgId, { codicePos: 'POS-B', dataVendita: '2026-07-12T10:00:00.000Z' }); // dom in (fallback)

    const on = await routeSelect(orgId, true);
    assert.equal(on.calendarsAvailable, true, 'almeno un PDV con calendario');
    assert.equal(on.sales.length, 2, 'POS-A feriale + POS-B fallback');
    assert.equal(on.salesExcludedOutOfGara, 1, 'solo il sabato di POS-A escluso');

    const agg = aggregateMappedSales(on.sales, RULES);
    const byPos = Object.fromEntries(agg.pdvList.map((p) => [p.codicePos, p]));
    const aItem = byPos['POS-A']?.items.find((i) => i.targetCategory === 'TIED');
    const bItem = byPos['POS-B']?.items.find((i) => i.targetCategory === 'TIED');
    assert.equal(aItem?.pezzi, 1, 'POS-A: solo la feriale (1)');
    assert.equal(bItem?.pezzi, 1, 'POS-B: fallback (1)');
    // Nessun doppio conteggio: rollup mobile = somma dei due (2).
    assert.equal(agg.totaliPerPista['mobile']?.['TIED']?.pezzi, 2, 'rollup mobile totale = 2');
  } finally {
    await cleanupOrg(orgId);
  }
});
