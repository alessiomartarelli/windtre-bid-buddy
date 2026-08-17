import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import {
  BASE,
  uniq,
  signup,
  setRole,
  cleanupOrg,
  newPool,
  launchBrowser,
  newAuthedContext,
} from './helpers/uiTest.mjs';

// Task #384: vista "Pezzi" della Tabella PDV × Pista nella Dashboard Gara Reale.
//
// Copre:
//   - il toggle Punti/Pezzi sulla card (btn-tabella-mode-pezzi);
//   - colonne Mobile, Fisso, Energia, Assicurazioni con valori Attuale in
//     pezzi per PDV e per RS (Energia = CF consumer + P.IVA business sommati);
//   - colonna "Totale" per riga (RS e PDV) e riga finale di totale
//     complessivo con totali di colonna e totale generale;
//   - coerenza con i pezzi seminati (stessa fonte dati del breakdown:
//     pdvBreakdown.pezzi, esclusioni annullate/filtri gara della route
//     /api/admin/bisuite-mapped-sales?inGaraOnly=true).

const now = new Date();
const pad = (n) => String(n).padStart(2, '0');
const MONTH = now.getMonth() + 1;
const YEAR = now.getFullYear();
// Giorno 10 del mese corrente, lontano dai bordi timezone.
const DATA_VENDITA = `${YEAR}-${pad(MONTH)}-10T10:00:00.000Z`;

// Articoli canvass mappabili con le regole di default.
const artMobileTied = {
  categoria: { nome: 'TIED CF' },
  tipologia: { nome: 'VOCE EASYPAY' },
  dettaglio: { canone: '10' },
}; // mobile → TIED (SIM_CONSUMER_CORE)
const artFissoFtth = {
  categoria: { nome: 'ADSL/FIBRA/FWA CF' },
  tipologia: { nome: 'FIBRA FTTH CF' },
  dettaglio: { canone: '25' },
}; // fisso → FISSO_FTTH (FISSO_CONSUMER_CORE)
const artEnergia = {
  categoria: { nome: 'ENERGIA W3' },
  tipologia: { nome: 'ENERGIA' },
  descrizione: 'OFFERTA LUCE',
  dettaglio: { prezzo: '0.00' },
}; // energia → CONSUMER_NO_SDD (FISICA) / BUSINESS_NO_SDD (GIURIDICA)
const artAssicCasa = {
  categoria: { nome: 'ASSICURAZIONI' },
  tipologia: { nome: 'ASSICURAZIONI CASA' },
  descrizione: 'CASA FAMIGLIA START',
  dettaglio: { prezzo: '5.00' },
}; // assicurazioni → casaFamigliaStart

async function insertSale(pool, orgId, { codicePos, nomeNegozio, ragioneSociale, clienteTipo, articoli, stato = 'FINALIZZATA' }) {
  const bisuiteId = Math.floor(Math.random() * 2_000_000_000);
  await pool.query(
    `INSERT INTO bisuite_sales
       (organization_id, bisuite_id, data_vendita, codice_pos, nome_negozio,
        ragione_sociale, stato, totale, raw_data)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)`,
    [
      orgId,
      bisuiteId,
      DATA_VENDITA,
      codicePos,
      nomeNegozio,
      ragioneSociale,
      stato,
      '10.00',
      JSON.stringify({ cliente: { clienteTipo: clienteTipo || 'PRIVATO' }, articoli }),
    ],
  );
}

const cellNum = async (page, testId) => {
  const txt = (await page.getByTestId(testId).innerText()).trim();
  return Number(txt.replace(/[^\d-]/g, ''));
};

test('Dashboard Gara Reale: vista Pezzi della Tabella PDV × Pista con totali riga/colonna', async () => {
  const pool = await newPool();
  const session = await signup({ prefix: 'pezzi_tab', fullName: 'Pezzi Table UI Test' });
  let browser;
  try {
    await setRole(pool, session.profileId, 'admin');

    const POS_A = uniq('POSA');
    const POS_B = uniq('POSB');
    const POS_C = uniq('POSC');
    const RS_ALFA = uniq('Alfa Srl');
    const RS_BETA = uniq('Beta Srl');

    // Gara config del mese corrente (senza calendari: passa tutto il mese).
    await pool.query(
      `INSERT INTO gara_config (organization_id, month, year, name, config)
       VALUES ($1, $2, $3, $4, $5::jsonb)`,
      [session.orgId, MONTH, YEAR, 'Gara pezzi test', JSON.stringify({
        pdvList: [
          { codicePos: POS_A, nome: 'Negozio Alfa 1', ragioneSociale: RS_ALFA },
          { codicePos: POS_B, nome: 'Negozio Alfa 2', ragioneSociale: RS_ALFA },
          { codicePos: POS_C, nome: 'Negozio Beta', ragioneSociale: RS_BETA },
        ],
      })],
    );

    // RS Alfa / PDV A: 2 mobile + 1 fisso.
    await insertSale(pool, session.orgId, {
      codicePos: POS_A, nomeNegozio: 'Negozio Alfa 1', ragioneSociale: RS_ALFA,
      articoli: [artMobileTied, artMobileTied, artFissoFtth],
    });
    // RS Alfa / PDV B: energia CF (FISICA) 1 + energia P.IVA (GIURIDICA) 2
    // → colonna Energia aggregata = 3.
    await insertSale(pool, session.orgId, {
      codicePos: POS_B, nomeNegozio: 'Negozio Alfa 2', ragioneSociale: RS_ALFA,
      clienteTipo: 'FISICA', articoli: [artEnergia],
    });
    await insertSale(pool, session.orgId, {
      codicePos: POS_B, nomeNegozio: 'Negozio Alfa 2', ragioneSociale: RS_ALFA,
      clienteTipo: 'GIURIDICA', articoli: [artEnergia, artEnergia],
    });
    // RS Beta / PDV C: 1 assicurazione.
    await insertSale(pool, session.orgId, {
      codicePos: POS_C, nomeNegozio: 'Negozio Beta', ragioneSociale: RS_BETA,
      articoli: [artAssicCasa],
    });
    // Vendita ANNULLATA: NON deve contare (stesse esclusioni della dashboard).
    await insertSale(pool, session.orgId, {
      codicePos: POS_A, nomeNegozio: 'Negozio Alfa 1', ragioneSociale: RS_ALFA,
      articoli: [artMobileTied], stato: 'ANNULLATA',
    });

    browser = await launchBrowser();
    const context = await newAuthedContext(browser, session);
    const page = await context.newPage();
    await page.goto(`${BASE}/dashboard-gara-reale`, { waitUntil: 'networkidle' });

    // Card + toggle Pezzi.
    await page.getByTestId('card-tabella-pdv-pista').waitFor({ timeout: 30000 });
    await page.getByTestId('btn-tabella-mode-pezzi').click();
    await page.getByTestId('table-pdv-pista-pezzi').waitFor({ timeout: 15000 });

    // Header: 4 piste + colonna Totale.
    for (const pista of ['mobile', 'fisso', 'energia', 'assicurazioni']) {
      await page.getByTestId(`th-tabella-pezzi-${pista}`).waitFor({ timeout: 5000 });
    }
    await page.getByTestId('th-tabella-pezzi-totale').waitFor({ timeout: 5000 });

    // Trova le righe RS delle due ragioni sociali seminate.
    const rsRows = page.locator('[data-testid^="row-table-pezzi-rs-"]');
    const nRows = await rsRows.count();
    let alfaKey = null, betaKey = null;
    for (let i = 0; i < nRows; i++) {
      const row = rsRows.nth(i);
      const text = await row.innerText();
      const tid = await row.getAttribute('data-testid');
      if (text.includes(RS_ALFA)) alfaKey = tid.replace('row-table-pezzi-rs-', '');
      if (text.includes(RS_BETA)) betaKey = tid.replace('row-table-pezzi-rs-', '');
    }
    assert.ok(alfaKey, 'riga RS Alfa presente nella vista pezzi');
    assert.ok(betaKey, 'riga RS Beta presente nella vista pezzi');

    // ── RS Alfa: mobile 2, fisso 1, energia 3 (CF 1 + P.IVA 2), totale 6 ──
    assert.equal(await cellNum(page, `cell-pezzi-${alfaKey}-mobile-attuale`), 2, 'RS Alfa mobile attuale = 2 (annullata esclusa)');
    assert.equal(await cellNum(page, `cell-pezzi-${alfaKey}-fisso-attuale`), 1, 'RS Alfa fisso attuale = 1');
    assert.equal(await cellNum(page, `cell-pezzi-${alfaKey}-energia-attuale`), 3, 'RS Alfa energia attuale = 3 (CF+P.IVA sommati)');
    assert.equal(await cellNum(page, `cell-pezzi-${alfaKey}-totale-attuale`), 6, 'RS Alfa totale riga = 6');

    // ── RS Beta: assicurazioni 1, totale 1 ──
    assert.equal(await cellNum(page, `cell-pezzi-${betaKey}-assicurazioni-attuale`), 1, 'RS Beta assicurazioni attuale = 1');
    assert.equal(await cellNum(page, `cell-pezzi-${betaKey}-totale-attuale`), 1, 'RS Beta totale riga = 1');

    // ── Espandi RS Alfa: righe PDV con totale riga ──
    await page.getByTestId(`row-table-pezzi-rs-${alfaKey}`).click();
    await page.getByTestId(`row-table-pezzi-pdv-${POS_A}`).waitFor({ timeout: 10000 });
    assert.equal(await cellNum(page, `cell-pezzi-${POS_A}-mobile-attuale`), 2, 'PDV A mobile attuale = 2');
    assert.equal(await cellNum(page, `cell-pezzi-${POS_A}-totale-attuale`), 3, 'PDV A totale riga = 3 (2 mobile + 1 fisso)');
    assert.equal(await cellNum(page, `cell-pezzi-${POS_B}-energia-attuale`), 3, 'PDV B energia attuale = 3');
    assert.equal(await cellNum(page, `cell-pezzi-${POS_B}-totale-attuale`), 3, 'PDV B totale riga = 3');

    // ── Riga totale complessivo: totali di colonna + totale generale ──
    await page.getByTestId('row-table-pezzi-totale').waitFor({ timeout: 5000 });
    assert.equal(await cellNum(page, 'cell-pezzi-totale-mobile-attuale'), 2, 'totale colonna mobile = 2');
    assert.equal(await cellNum(page, 'cell-pezzi-totale-fisso-attuale'), 1, 'totale colonna fisso = 1');
    assert.equal(await cellNum(page, 'cell-pezzi-totale-energia-attuale'), 3, 'totale colonna energia = 3');
    assert.equal(await cellNum(page, 'cell-pezzi-totale-assicurazioni-attuale'), 1, 'totale colonna assicurazioni = 1');
    assert.equal(await cellNum(page, 'cell-pezzi-totale-generale-attuale'), 7, 'totale generale = 7');

    // Le proiezioni sono >= dei valori attuali (stessa proiezione per giorni
    // lavorativi usata dal breakdown: mai sotto l'attuale a metà mese).
    const projTot = await cellNum(page, 'cell-pezzi-totale-generale-proiezione');
    assert.ok(projTot >= 7, `proiezione totale generale (${projTot}) >= attuale (7)`);

    // ── Toggle di ritorno: la vista punti resta intatta ──
    await page.getByTestId('btn-tabella-mode-punti').click();
    await page.getByTestId('table-pdv-pista').waitFor({ timeout: 10000 });
  } finally {
    if (browser) await browser.close().catch(() => {});
    await cleanupOrg(pool, session);
    await pool.end().catch(() => {});
  }
});

// ─────────────────────────────────────────────────────────────────────────
// Task #387: gli export Excel/CSV/PDF della vista Pezzi devono contenere i
// totali giusti (buildExportRowsPezzi):
//   - CSV/Excel: header "<Pista> - Pezzi Attuali/Proiezione" + "Totale - ...",
//     righe RS/PDV coi valori seminati e riga finale TOTALE con totali di
//     colonna e totale generale;
//   - PDF con filtro piste (solo Mobile): i totali di riga e la riga TOTALE
//     si ricalcolano sulle sole piste incluse.
// ─────────────────────────────────────────────────────────────────────────

const XLSXmod = await import('xlsx');
const XLSX = XLSXmod.default ?? XLSXmod;

// Estrae le stringhe testuali `(...) Tj` dal PDF jsPDF (stream non compressi).
function pdfTextTokens(buf) {
  const raw = buf.toString('latin1');
  const tokens = [];
  const re = /\(((?:\\.|[^\\()])*)\)\s*Tj/g;
  let m;
  while ((m = re.exec(raw)) !== null) {
    tokens.push(m[1].replace(/\\([()\\])/g, '$1'));
  }
  return tokens;
}

test('Dashboard Gara Reale: export Excel/CSV/PDF della vista Pezzi con i totali giusti', async () => {
  const pool = await newPool();
  const session = await signup({ prefix: 'pezzi_exp', fullName: 'Pezzi Export UI Test' });
  let browser;
  try {
    await setRole(pool, session.profileId, 'admin');

    const POS_A = uniq('POSA');
    const POS_B = uniq('POSB');
    const POS_C = uniq('POSC');
    const RS_ALFA = uniq('Alfa Srl');
    const RS_BETA = uniq('Beta Srl');

    await pool.query(
      `INSERT INTO gara_config (organization_id, month, year, name, config)
       VALUES ($1, $2, $3, $4, $5::jsonb)`,
      [session.orgId, MONTH, YEAR, 'Gara pezzi export test', JSON.stringify({
        pdvList: [
          { codicePos: POS_A, nome: 'Negozio Alfa 1', ragioneSociale: RS_ALFA },
          { codicePos: POS_B, nome: 'Negozio Alfa 2', ragioneSociale: RS_ALFA },
          { codicePos: POS_C, nome: 'Negozio Beta', ragioneSociale: RS_BETA },
        ],
      })],
    );

    // Stessi dati del test tabella: Alfa/A 2 mobile + 1 fisso; Alfa/B energia
    // CF 1 + P.IVA 2 (colonna Energia = 3); Beta/C 1 assicurazione; una
    // ANNULLATA che NON deve contare.
    await insertSale(pool, session.orgId, {
      codicePos: POS_A, nomeNegozio: 'Negozio Alfa 1', ragioneSociale: RS_ALFA,
      articoli: [artMobileTied, artMobileTied, artFissoFtth],
    });
    await insertSale(pool, session.orgId, {
      codicePos: POS_B, nomeNegozio: 'Negozio Alfa 2', ragioneSociale: RS_ALFA,
      clienteTipo: 'FISICA', articoli: [artEnergia],
    });
    await insertSale(pool, session.orgId, {
      codicePos: POS_B, nomeNegozio: 'Negozio Alfa 2', ragioneSociale: RS_ALFA,
      clienteTipo: 'GIURIDICA', articoli: [artEnergia, artEnergia],
    });
    await insertSale(pool, session.orgId, {
      codicePos: POS_C, nomeNegozio: 'Negozio Beta', ragioneSociale: RS_BETA,
      articoli: [artAssicCasa],
    });
    await insertSale(pool, session.orgId, {
      codicePos: POS_A, nomeNegozio: 'Negozio Alfa 1', ragioneSociale: RS_ALFA,
      articoli: [artMobileTied], stato: 'ANNULLATA',
    });

    browser = await launchBrowser();
    const context = await newAuthedContext(browser, session);
    const page = await context.newPage();
    await page.goto(`${BASE}/dashboard-gara-reale`, { waitUntil: 'networkidle' });

    await page.getByTestId('card-tabella-pdv-pista').waitFor({ timeout: 30000 });
    await page.getByTestId('btn-tabella-mode-pezzi').click();
    await page.getByTestId('table-pdv-pista-pezzi').waitFor({ timeout: 15000 });
    await page.getByTestId('row-table-pezzi-totale').waitFor({ timeout: 10000 });

    // Proiezioni lette a schermo: gli export devono replicarle identiche.
    const projMobile = await cellNum(page, 'cell-pezzi-totale-mobile-proiezione');
    const projFisso = await cellNum(page, 'cell-pezzi-totale-fisso-proiezione');
    const projEnergia = await cellNum(page, 'cell-pezzi-totale-energia-proiezione');
    const projAssic = await cellNum(page, 'cell-pezzi-totale-assicurazioni-proiezione');
    const projTot = await cellNum(page, 'cell-pezzi-totale-generale-proiezione');

    const EXPECTED_HEADER = [
      'Tipo', 'Ragione Sociale', 'Codice PDV', 'Nome PDV',
      'Mobile - Pezzi Attuali', 'Mobile - Pezzi Proiezione',
      'Fisso - Pezzi Attuali', 'Fisso - Pezzi Proiezione',
      'Energia - Pezzi Attuali', 'Energia - Pezzi Proiezione',
      'Assicurazioni - Pezzi Attuali', 'Assicurazioni - Pezzi Proiezione',
      'Totale - Pezzi Attuali', 'Totale - Pezzi Proiezione',
    ];

    // Verifica una matrice di righe (aoa) prodotta da CSV o Excel.
    const checkRows = (rows, src) => {
      assert.deepEqual(rows[0].map(String), EXPECTED_HEADER, `${src}: header piste + Totale`);
      const col = (name) => rows[0].indexOf(name);
      const num = (v) => Number(v ?? 0) || 0;
      const findRow = (tipo, match) => rows.find(r => String(r[0]) === tipo && match(r));
      const rsAlfa = findRow('RS', r => String(r[1]) === RS_ALFA);
      assert.ok(rsAlfa, `${src}: riga RS Alfa presente`);
      assert.equal(num(rsAlfa[col('Mobile - Pezzi Attuali')]), 2, `${src}: RS Alfa mobile = 2 (annullata esclusa)`);
      assert.equal(num(rsAlfa[col('Fisso - Pezzi Attuali')]), 1, `${src}: RS Alfa fisso = 1`);
      assert.equal(num(rsAlfa[col('Energia - Pezzi Attuali')]), 3, `${src}: RS Alfa energia = 3 (CF+P.IVA)`);
      assert.equal(num(rsAlfa[col('Totale - Pezzi Attuali')]), 6, `${src}: RS Alfa totale riga = 6`);
      const rsBeta = findRow('RS', r => String(r[1]) === RS_BETA);
      assert.ok(rsBeta, `${src}: riga RS Beta presente`);
      assert.equal(num(rsBeta[col('Assicurazioni - Pezzi Attuali')]), 1, `${src}: RS Beta assicurazioni = 1`);
      assert.equal(num(rsBeta[col('Totale - Pezzi Attuali')]), 1, `${src}: RS Beta totale riga = 1`);
      // Righe PDV (sempre presenti nell'export, anche se collassate a schermo).
      const pdvA = findRow('PDV', r => String(r[2]) === POS_A);
      assert.ok(pdvA, `${src}: riga PDV A presente`);
      assert.equal(num(pdvA[col('Mobile - Pezzi Attuali')]), 2, `${src}: PDV A mobile = 2`);
      assert.equal(num(pdvA[col('Totale - Pezzi Attuali')]), 3, `${src}: PDV A totale riga = 3`);
      const pdvB = findRow('PDV', r => String(r[2]) === POS_B);
      assert.ok(pdvB, `${src}: riga PDV B presente`);
      assert.equal(num(pdvB[col('Energia - Pezzi Attuali')]), 3, `${src}: PDV B energia = 3`);
      assert.equal(num(pdvB[col('Totale - Pezzi Attuali')]), 3, `${src}: PDV B totale riga = 3`);
      const pdvC = findRow('PDV', r => String(r[2]) === POS_C);
      assert.ok(pdvC, `${src}: riga PDV C presente`);
      assert.equal(num(pdvC[col('Assicurazioni - Pezzi Attuali')]), 1, `${src}: PDV C assicurazioni = 1`);
      // Riga finale TOTALE: totali di colonna + totale generale + proiezioni.
      const tot = rows.at(-1);
      assert.equal(String(tot[0]), 'TOTALE', `${src}: ultima riga = TOTALE`);
      assert.equal(num(tot[col('Mobile - Pezzi Attuali')]), 2, `${src}: TOTALE mobile = 2`);
      assert.equal(num(tot[col('Fisso - Pezzi Attuali')]), 1, `${src}: TOTALE fisso = 1`);
      assert.equal(num(tot[col('Energia - Pezzi Attuali')]), 3, `${src}: TOTALE energia = 3`);
      assert.equal(num(tot[col('Assicurazioni - Pezzi Attuali')]), 1, `${src}: TOTALE assicurazioni = 1`);
      assert.equal(num(tot[col('Totale - Pezzi Attuali')]), 7, `${src}: TOTALE generale = 7`);
      assert.equal(num(tot[col('Mobile - Pezzi Proiezione')]), projMobile, `${src}: TOTALE proiezione mobile = schermo`);
      assert.equal(num(tot[col('Fisso - Pezzi Proiezione')]), projFisso, `${src}: TOTALE proiezione fisso = schermo`);
      assert.equal(num(tot[col('Energia - Pezzi Proiezione')]), projEnergia, `${src}: TOTALE proiezione energia = schermo`);
      assert.equal(num(tot[col('Assicurazioni - Pezzi Proiezione')]), projAssic, `${src}: TOTALE proiezione assicurazioni = schermo`);
      assert.equal(num(tot[col('Totale - Pezzi Proiezione')]), projTot, `${src}: TOTALE proiezione generale = schermo`);
    };

    // ── CSV ──
    const [dlCsv] = await Promise.all([
      page.waitForEvent('download', { timeout: 15000 }),
      page.getByTestId('btn-tabella-export-csv').click(),
    ]);
    assert.match(dlCsv.suggestedFilename(), /^tabella-pdv-pista-pezzi_.+\.csv$/, 'nome file CSV vista pezzi');
    const csvPath = await dlCsv.path();
    assert.ok(csvPath, 'download.path() CSV disponibile');
    const csvText = fs.readFileSync(csvPath, 'utf8').replace(/^\uFEFF/, '');
    const csvRows = csvText.trim().split(/\r?\n/).map(l => l.split(';'));
    checkRows(csvRows, 'CSV');

    // ── Excel ──
    const [dlXlsx] = await Promise.all([
      page.waitForEvent('download', { timeout: 15000 }),
      page.getByTestId('btn-tabella-export-excel').click(),
    ]);
    assert.match(dlXlsx.suggestedFilename(), /^tabella-pdv-pista-pezzi_.+\.xlsx$/, 'nome file Excel vista pezzi');
    const xlsxPath = await dlXlsx.path();
    assert.ok(xlsxPath, 'download.path() Excel disponibile');
    const wb = XLSX.read(fs.readFileSync(xlsxPath), { type: 'buffer' });
    assert.deepEqual(wb.SheetNames, ['PDV x Pista (Pezzi)'], 'foglio della vista Pezzi');
    const xlsxRows = XLSX.utils.sheet_to_json(wb.Sheets['PDV x Pista (Pezzi)'], { header: 1, defval: '' });
    checkRows(xlsxRows, 'Excel');

    // ── PDF con filtro piste: solo Mobile ──
    await page.getByTestId('btn-tabella-export-pdf').click();
    await page.getByTestId('dialog-tabella-pdf-export').waitFor({ timeout: 10000 });
    await page.getByTestId('btn-tabella-pdf-cols-none').click();
    await page.getByTestId('checkbox-tabella-pdf-col-mobile').click();
    const [dlPdf] = await Promise.all([
      page.waitForEvent('download', { timeout: 15000 }),
      page.getByTestId('btn-tabella-pdf-confirm').click(),
    ]);
    assert.match(dlPdf.suggestedFilename(), /^tabella-pdv-pista-pezzi_.+\.pdf$/, 'nome file PDF vista pezzi');
    const pdfPath = await dlPdf.path();
    assert.ok(pdfPath, 'download.path() PDF disponibile');
    const tokens = pdfTextTokens(fs.readFileSync(pdfPath));
    assert.ok(tokens.length > 0, 'testo estraibile dal PDF (stream non compressi)');
    const joined = tokens.join(' ');
    // Solo la pista Mobile è inclusa: nessuna colonna Fisso/Energia/Assicurazioni.
    assert.ok(joined.includes('Mobile'), 'PDF: colonna Mobile presente');
    for (const escluso of ['Fisso', 'Energia', 'Assicurazioni']) {
      assert.ok(!joined.includes(escluso), `PDF: pista esclusa "${escluso}" assente dal PDF filtrato`);
    }
    // Riga TOTALE ricalcolata sulle sole piste incluse: mobile 2/projMobile e
    // totale generale = 2/projMobile (NON più 7/projTot).
    const idxTot = tokens.indexOf('Totale complessivo');
    assert.ok(idxTot >= 0, 'PDF: riga "Totale complessivo" presente');
    const totNums = tokens.slice(idxTot + 1, idxTot + 20)
      .filter(t => /^-?\d+(\.\d+)?$/.test(t))
      .map(Number)
      .slice(0, 4);
    assert.deepEqual(
      totNums,
      [2, projMobile, 2, projMobile],
      `PDF filtrato: TOTALE = [mobile att, mobile proi, tot att, tot proi] ricalcolati solo su Mobile (trovato: ${totNums.join(',')})`,
    );
    // Anche il totale di riga RS Alfa si ricalcola: 2 (solo mobile), non 6.
    const idxAlfa = tokens.indexOf(RS_ALFA);
    assert.ok(idxAlfa >= 0, 'PDF: riga RS Alfa presente');
    const alfaNums = tokens.slice(idxAlfa + 1, idxAlfa + 12)
      .filter(t => /^-?\d+(\.\d+)?$/.test(t))
      .map(Number)
      .slice(0, 4);
    assert.equal(alfaNums[0], 2, 'PDF filtrato: RS Alfa mobile attuale = 2');
    assert.equal(alfaNums[2], 2, `PDF filtrato: RS Alfa totale riga = 2 (solo Mobile, non 6) — trovato ${alfaNums.join(',')}`);
  } finally {
    if (browser) await browser.close().catch(() => {});
    await cleanupOrg(pool, session);
    await pool.end().catch(() => {});
  }
});

// ─────────────────────────────────────────────────────────────────────────
// Task #388: gli export Excel/CSV/PDF della vista Punti (buildExportRows
// non-pezzi) devono contenere i valori giusti:
//   - CSV/Excel: header "<Pista> - Punti Attuali/Proiezione/Soglia Attuale/
//     Soglia Proiezione" per ogni pista attiva, righe RS/PDV con punti e
//     soglie coerenti con quanto mostrato a schermo (stessa fonte dati);
//   - PDF con filtro piste (solo Mobile) via dialog tabella-pdf: le piste
//     escluse spariscono e i punti Mobile restano quelli a schermo.
// ─────────────────────────────────────────────────────────────────────────

const PISTA_LABELS = {
  mobile: 'Mobile',
  fisso: 'Fisso',
  energia: 'Energia',
  assicurazioni: 'Assicurazioni',
  partnership: 'Partnership',
  cb: 'Customer Base',
  protecta: 'Windtre Protetti',
  extra_gara_iva: 'Extra Gara P.IVA',
};

// Legge una cella della vista Punti: numero (toFixed(1)) + eventuale badge
// soglia; "—" → null. Il marker "~" delle quote RS viene ignorato.
async function readPuntiCell(page, testId) {
  const loc = page.getByTestId(testId);
  if ((await loc.count()) === 0) return null;
  const txt = (await loc.innerText()).replace(/\s+/g, ' ').trim();
  if (!txt || txt === '—') return null;
  const m = txt.match(/-?\d+(?:\.\d+)?/);
  if (!m) return null;
  const val = Number(m[0]);
  const soglia = txt
    .slice(txt.indexOf(m[0]) + m[0].length)
    .replace(/~/g, '')
    .trim();
  return { val, soglia };
}

test('Dashboard Gara Reale: export Excel/CSV/PDF della vista Punti con punti e soglie giusti', async () => {
  const pool = await newPool();
  const session = await signup({ prefix: 'punti_exp', fullName: 'Punti Export UI Test' });
  let browser;
  try {
    await setRole(pool, session.profileId, 'admin');

    const POS_A = uniq('POSA');
    const POS_B = uniq('POSB');
    const POS_C = uniq('POSC');
    const RS_ALFA = uniq('Alfa Srl');
    const RS_BETA = uniq('Beta Srl');

    await pool.query(
      `INSERT INTO gara_config (organization_id, month, year, name, config)
       VALUES ($1, $2, $3, $4, $5::jsonb)`,
      [session.orgId, MONTH, YEAR, 'Gara punti export test', JSON.stringify({
        pdvList: [
          { codicePos: POS_A, nome: 'Negozio Alfa 1', ragioneSociale: RS_ALFA },
          { codicePos: POS_B, nome: 'Negozio Alfa 2', ragioneSociale: RS_ALFA },
          { codicePos: POS_C, nome: 'Negozio Beta', ragioneSociale: RS_BETA },
        ],
        // Soglie mobile per POS_A: senza config il calcolo punti mobile
        // torna 0 e il test non distinguerebbe un export rotto.
        pistaMobileConfig: {
          sogliePerPos: [{
            posCode: POS_A,
            soglia1: 1, soglia2: 50, soglia3: 100, soglia4: 150,
            multiplierSoglia1: 1, multiplierSoglia2: 1.2,
            multiplierSoglia3: 1.5, multiplierSoglia4: 2,
          }],
        },
      })],
    );

    // Stessi dati seminati dei test vista Pezzi: Alfa/A 2 mobile + 1 fisso;
    // Alfa/B energia CF 1 + P.IVA 2; Beta/C 1 assicurazione; una ANNULLATA
    // che NON deve contare.
    await insertSale(pool, session.orgId, {
      codicePos: POS_A, nomeNegozio: 'Negozio Alfa 1', ragioneSociale: RS_ALFA,
      articoli: [artMobileTied, artMobileTied, artFissoFtth],
    });
    await insertSale(pool, session.orgId, {
      codicePos: POS_B, nomeNegozio: 'Negozio Alfa 2', ragioneSociale: RS_ALFA,
      clienteTipo: 'FISICA', articoli: [artEnergia],
    });
    await insertSale(pool, session.orgId, {
      codicePos: POS_B, nomeNegozio: 'Negozio Alfa 2', ragioneSociale: RS_ALFA,
      clienteTipo: 'GIURIDICA', articoli: [artEnergia, artEnergia],
    });
    await insertSale(pool, session.orgId, {
      codicePos: POS_C, nomeNegozio: 'Negozio Beta', ragioneSociale: RS_BETA,
      articoli: [artAssicCasa],
    });
    await insertSale(pool, session.orgId, {
      codicePos: POS_A, nomeNegozio: 'Negozio Alfa 1', ragioneSociale: RS_ALFA,
      articoli: [artMobileTied], stato: 'ANNULLATA',
    });

    browser = await launchBrowser();
    const context = await newAuthedContext(browser, session);
    const page = await context.newPage();
    await page.goto(`${BASE}/dashboard-gara-reale`, { waitUntil: 'networkidle' });

    // Vista Punti = default della card.
    await page.getByTestId('card-tabella-pdv-pista').waitFor({ timeout: 30000 });
    await page.getByTestId('table-pdv-pista').waitFor({ timeout: 15000 });

    // Piste attive nell'ordine di render (stesso ordine di buildExportRows).
    const pisteOrder = await page.$$eval(
      'table[data-testid="table-pdv-pista"] thead th[data-testid^="th-tabella-"]',
      ths => ths
        .map(t => t.getAttribute('data-testid').replace('th-tabella-', ''))
        .filter(k => !k.endsWith('-attuale') && !k.endsWith('-proiezione')),
    );
    assert.ok(pisteOrder.length >= 4, `almeno 4 piste attive (trovate: ${pisteOrder.join(',')})`);
    for (const p of ['mobile', 'fisso', 'energia', 'assicurazioni']) {
      assert.ok(pisteOrder.includes(p), `pista ${p} presente nella vista Punti`);
    }

    // Righe RS delle due ragioni sociali seminate.
    const rsRows = page.locator('[data-testid^="row-table-rs-"]');
    const nRows = await rsRows.count();
    let alfaKey = null, betaKey = null;
    for (let i = 0; i < nRows; i++) {
      const row = rsRows.nth(i);
      const text = await row.innerText();
      const tid = await row.getAttribute('data-testid');
      if (text.includes(RS_ALFA)) alfaKey = tid.replace('row-table-rs-', '');
      if (text.includes(RS_BETA)) betaKey = tid.replace('row-table-rs-', '');
    }
    assert.ok(alfaKey, 'riga RS Alfa presente nella vista punti');
    assert.ok(betaKey, 'riga RS Beta presente nella vista punti');

    // Espandi entrambe le RS per leggere anche le celle PDV a schermo.
    await page.getByTestId(`row-table-rs-${alfaKey}`).click();
    await page.getByTestId(`row-table-rs-${betaKey}`).click();
    await page.getByTestId(`row-table-pdv-${POS_A}`).waitFor({ timeout: 10000 });
    await page.getByTestId(`row-table-pdv-${POS_C}`).waitFor({ timeout: 10000 });

    // Snapshot dei valori a schermo: RS e PDV, per ogni pista attiva.
    const screen = {};
    for (const key of [alfaKey, betaKey, POS_A, POS_B, POS_C]) {
      screen[key] = {};
      for (const p of pisteOrder) {
        screen[key][p] = {
          att: await readPuntiCell(page, `cell-table-${key}-${p}-attuale`),
          proi: await readPuntiCell(page, `cell-table-${key}-${p}-proiezione`),
        };
      }
    }
    // I punti Mobile di RS Alfa devono esserci ed essere > 0 (2 SIM TIED
    // seminate): senza questo il test passerebbe anche esportando solo vuoti.
    assert.ok(screen[alfaKey].mobile.att, 'RS Alfa: punti Mobile attuali presenti a schermo');
    assert.ok(screen[alfaKey].mobile.att.val > 0, `RS Alfa: punti Mobile > 0 (trovato ${screen[alfaKey].mobile.att?.val})`);

    const EXPECTED_HEADER = ['Tipo', 'Ragione Sociale', 'Codice PDV', 'Nome PDV'];
    for (const p of pisteOrder) {
      const label = PISTA_LABELS[p] ?? p;
      EXPECTED_HEADER.push(
        `${label} - Punti Attuali`, `${label} - Proiezione`,
        `${label} - Soglia Attuale`, `${label} - Soglia Proiezione`,
      );
    }

    // La cella export (2 dec) deve coincidere con la cella a schermo (1 dec)
    // a meno del solo arrotondamento di visualizzazione (±0.05), con la
    // stessa soglia (vuota se il badge non è mostrato).
    const TOL = 0.051;
    const checkRows = (rows, src) => {
      assert.deepEqual(rows[0].map(String), EXPECTED_HEADER, `${src}: header piste vista Punti`);
      const col = (name) => rows[0].indexOf(name);
      const findRow = (tipo, match) => rows.find(r => String(r[0]) === tipo && match(r));
      const rowFor = {
        [alfaKey]: findRow('RS', r => String(r[1]) === RS_ALFA),
        [betaKey]: findRow('RS', r => String(r[1]) === RS_BETA),
        [POS_A]: findRow('PDV', r => String(r[2]) === POS_A),
        [POS_B]: findRow('PDV', r => String(r[2]) === POS_B),
        [POS_C]: findRow('PDV', r => String(r[2]) === POS_C),
      };
      for (const [key, row] of Object.entries(rowFor)) {
        assert.ok(row, `${src}: riga per ${key} presente`);
      }
      for (const [key, row] of Object.entries(rowFor)) {
        for (const p of pisteOrder) {
          const label = PISTA_LABELS[p] ?? p;
          const sc = screen[key][p];
          const expAtt = row[col(`${label} - Punti Attuali`)];
          const expProi = row[col(`${label} - Proiezione`)];
          const expSogliaAtt = String(row[col(`${label} - Soglia Attuale`)] ?? '');
          const expSogliaProi = String(row[col(`${label} - Soglia Proiezione`)] ?? '');
          if (sc.att === null) {
            assert.equal(String(expAtt ?? ''), '', `${src}: ${key}/${p} attuale vuoto come a schermo`);
          } else {
            assert.ok(
              Math.abs(Number(expAtt) - sc.att.val) <= TOL,
              `${src}: ${key}/${p} punti attuali export (${expAtt}) = schermo (${sc.att.val})`,
            );
            assert.equal(expSogliaAtt, sc.att.soglia, `${src}: ${key}/${p} soglia attuale = schermo`);
          }
          if (sc.proi === null) {
            assert.equal(String(expProi ?? ''), '', `${src}: ${key}/${p} proiezione vuota come a schermo`);
          } else {
            assert.ok(
              Math.abs(Number(expProi) - sc.proi.val) <= TOL,
              `${src}: ${key}/${p} proiezione export (${expProi}) = schermo (${sc.proi.val})`,
            );
            assert.equal(expSogliaProi, sc.proi.soglia, `${src}: ${key}/${p} soglia proiezione = schermo`);
          }
        }
      }
      // Nessuna riga TOTALE nella vista Punti.
      assert.ok(!rows.some(r => String(r[0]) === 'TOTALE'), `${src}: la vista Punti non ha riga TOTALE`);
    };

    // ── CSV ──
    const [dlCsv] = await Promise.all([
      page.waitForEvent('download', { timeout: 15000 }),
      page.getByTestId('btn-tabella-export-csv').click(),
    ]);
    assert.match(dlCsv.suggestedFilename(), /^tabella-pdv-pista_.+\.csv$/, 'nome file CSV vista punti (senza -pezzi)');
    const csvPath = await dlCsv.path();
    assert.ok(csvPath, 'download.path() CSV disponibile');
    const csvText = fs.readFileSync(csvPath, 'utf8').replace(/^\uFEFF/, '');
    const csvRows = csvText.trim().split(/\r?\n/).map(l => l.split(';'));
    checkRows(csvRows, 'CSV');

    // ── Excel ──
    const [dlXlsx] = await Promise.all([
      page.waitForEvent('download', { timeout: 15000 }),
      page.getByTestId('btn-tabella-export-excel').click(),
    ]);
    assert.match(dlXlsx.suggestedFilename(), /^tabella-pdv-pista_.+\.xlsx$/, 'nome file Excel vista punti');
    const xlsxPath = await dlXlsx.path();
    assert.ok(xlsxPath, 'download.path() Excel disponibile');
    const wb = XLSX.read(fs.readFileSync(xlsxPath), { type: 'buffer' });
    assert.deepEqual(wb.SheetNames, ['PDV x Pista'], 'foglio della vista Punti');
    const xlsxRows = XLSX.utils.sheet_to_json(wb.Sheets['PDV x Pista'], { header: 1, defval: '' });
    checkRows(xlsxRows, 'Excel');

    // ── PDF con filtro piste: solo Mobile ──
    await page.getByTestId('btn-tabella-export-pdf').click();
    await page.getByTestId('dialog-tabella-pdf-export').waitFor({ timeout: 10000 });
    await page.getByTestId('btn-tabella-pdf-cols-none').click();
    await page.getByTestId('checkbox-tabella-pdf-col-mobile').click();
    const [dlPdf] = await Promise.all([
      page.waitForEvent('download', { timeout: 15000 }),
      page.getByTestId('btn-tabella-pdf-confirm').click(),
    ]);
    assert.match(dlPdf.suggestedFilename(), /^tabella-pdv-pista_.+\.pdf$/, 'nome file PDF vista punti');
    const pdfPath = await dlPdf.path();
    assert.ok(pdfPath, 'download.path() PDF disponibile');
    const tokens = pdfTextTokens(fs.readFileSync(pdfPath));
    assert.ok(tokens.length > 0, 'testo estraibile dal PDF (stream non compressi)');
    const joined = tokens.join(' ');
    assert.ok(joined.includes('Mobile'), 'PDF: colonna Mobile presente');
    for (const p of pisteOrder) {
      if (p === 'mobile') continue;
      const label = PISTA_LABELS[p] ?? p;
      assert.ok(!joined.includes(label), `PDF: pista esclusa "${label}" assente dal PDF filtrato`);
    }
    // Riga RS Alfa: i primi numeri dopo il nome sono Punti Attuali e
    // Proiezione Mobile, uguali (±0.05) ai valori a schermo.
    const idxAlfa = tokens.indexOf(RS_ALFA);
    assert.ok(idxAlfa >= 0, 'PDF: riga RS Alfa presente');
    const alfaNums = tokens.slice(idxAlfa + 1, idxAlfa + 10)
      .filter(t => /^-?\d+(\.\d+)?$/.test(t))
      .map(Number);
    assert.ok(alfaNums.length >= 1, `PDF filtrato: valori Mobile RS Alfa presenti (trovati: ${alfaNums.join(',')})`);
    assert.ok(
      Math.abs(alfaNums[0] - screen[alfaKey].mobile.att.val) <= TOL,
      `PDF filtrato: RS Alfa punti Mobile attuali (${alfaNums[0]}) = schermo (${screen[alfaKey].mobile.att.val})`,
    );
    if (screen[alfaKey].mobile.proi && alfaNums.length >= 2) {
      assert.ok(
        Math.abs(alfaNums[1] - screen[alfaKey].mobile.proi.val) <= TOL,
        `PDF filtrato: RS Alfa proiezione Mobile (${alfaNums[1]}) = schermo (${screen[alfaKey].mobile.proi.val})`,
      );
    }
  } finally {
    if (browser) await browser.close().catch(() => {});
    await cleanupOrg(pool, session);
    await pool.end().catch(() => {});
  }
});
