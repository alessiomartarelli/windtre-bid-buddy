import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import {
  BASE,
  uniq,
  signup,
  cleanupOrg,
  newPool,
  launchBrowser,
  newAuthedContext,
} from './helpers/uiTest.mjs';

// Task #391: gli export Excel/CSV/PDF della Tabella PDV × Pista (Pezzi)
// nella pagina Vendite BiSuite devono contenere i numeri giusti.
//
// Copre:
//   - Excel: foglio "PDV x Pista (Pezzi)" con header, righe RS/PDV e riga
//     TOTALE coerenti coi pezzi seminati (classificazione client-side,
//     shared/bisuiteClassification CATEGORY_MAP);
//   - CSV: stesso contenuto (separatore ";", BOM UTF-8);
//   - PDF: il download avviene e il file non è vuoto (magic %PDF);
//   - RS con varianti di nome ("Gamma S.R.L." vs "GAMMA SRL") che devono
//     confluire in un'UNICA riga RS via normalizeRsName.
//
// Il file scaricato viene ispezionato con SheetJS (XLSX.read su buffer:
// readFile non esiste in ESM/tsx).

const XLSXmod = await import('xlsx');
const XLSX = XLSXmod.default ?? XLSXmod;

const TODAY = new Date().toISOString().slice(0, 10);

// Categorie BiSuite → pista (CATEGORY_MAP condivisa client/server).
const CAT_BY_PISTA = {
  mobile: 'UNTIED',
  fisso: 'ADSL/FIBRA/FWA CF',
  energia: 'ENERGIA W3',
  assicurazioni: 'ASSICURAZIONI',
};

let nextBisuiteId = 391_000_000 + Math.floor(Math.random() * 1_000_000);
let minutesAgo = 5;

// Una vendita FINALIZZATA di oggi con un articolo canvass per pista.
async function insertSale(pool, orgId, { codicePos, nomeNegozio, ragioneSociale, pista }) {
  await pool.query(
    `INSERT INTO bisuite_sales
       (organization_id, bisuite_id, data_vendita, codice_pos, nome_negozio,
        nome_addetto, nome_cliente, totale, stato, ragione_sociale, raw_data)
     VALUES ($1, $2, now() - ($3 || ' minutes')::interval, $4, $5,
             'Addetto Export', 'Cliente Export', '10.00', 'FINALIZZATA', $6, $7::jsonb)`,
    [
      orgId,
      nextBisuiteId++,
      String(minutesAgo++),
      codicePos,
      nomeNegozio,
      ragioneSociale,
      JSON.stringify({
        articoli: [
          {
            categoria: { nome: CAT_BY_PISTA[pista] },
            tipologia: { nome: 'OFFERTA' },
            descrizione: `Offerta ${pista}`,
            dettaglio: { prezzo: '10.00' },
          },
        ],
      }),
    ],
  );
}

// AOA (array di array) del foglio, celle vuote → ''.
function sheetAoa(ws) {
  return XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
}

// Verifica header + righe RS/PDV/TOTALE contro i valori attesi.
// expected: array di righe [Tipo, RS, CodicePDV, NomePDV, mobile, fisso, energia, assicurazioni, totale]
function assertExportRows(aoa, { gammaDisplay }, label) {
  const header = aoa[0];
  assert.equal(header[0], 'Tipo', `${label}: prima colonna header`);
  assert.equal(header[1], 'Ragione Sociale', `${label}: header RS`);
  assert.equal(header[2], 'Codice PDV', `${label}: header codice`);
  assert.equal(header[3], 'Nome PDV', `${label}: header nome`);
  const col = (name) => {
    const i = header.indexOf(name);
    assert.ok(i >= 0, `${label}: colonna "${name}" presente (header: ${header.join(', ')})`);
    return i;
  };
  const cMob = col('Mobile - Pezzi');
  const cFis = col('Fisso - Pezzi');
  const cEne = col('Energia - Pezzi');
  const cAss = col('Assicurazioni - Pezzi');
  const cTot = col('Totale Pezzi');

  const body = aoa.slice(1).filter((r) => r.some((v) => v !== ''));

  // Ordine: RS in ordine alfabetico, PDV di ogni RS subito dopo, TOTALE in fondo.
  const expected = [
    ['RS', 'Delta Srl', '', '', 0, 1, 0, 1, 2],
    ['PDV', 'Delta Srl', 'POSD1', 'Negozio Delta', 0, 1, 0, 1, 2],
    ['RS', gammaDisplay, '', '', 3, 1, 3, 0, 7],
    ['PDV', gammaDisplay, 'POSG1', 'Negozio Gamma 1', 2, 1, 0, 0, 3],
    ['PDV', gammaDisplay, 'POSG2', 'Negozio Gamma 2', 1, 0, 3, 0, 4],
    ['TOTALE', 'Totale complessivo', '', '', 3, 2, 3, 1, 9],
  ];
  assert.equal(
    body.length,
    expected.length,
    `${label}: ${expected.length} righe attese (1 RS Gamma unificata, non 2), trovate ${body.length}: ${JSON.stringify(body.map((r) => [r[0], r[1]]))}`,
  );
  expected.forEach((exp, i) => {
    const row = body[i];
    const got = [row[0], row[1], String(row[2]), String(row[3]), +row[cMob], +row[cFis], +row[cEne], +row[cAss], +row[cTot]];
    assert.deepEqual(got, exp, `${label}: riga ${i + 1} (${exp[0]} ${exp[1]})`);
  });

  // La variante di nome NON deve produrre una seconda riga RS Gamma.
  const rsGammaRows = body.filter((r) => r[0] === 'RS' && /GAMMA/i.test(String(r[1])));
  assert.equal(rsGammaRows.length, 1, `${label}: le varianti "Gamma S.R.L."/"GAMMA SRL" confluiscono in una sola riga RS`);
}

test('Vendite BiSuite: export Excel/CSV/PDF della Tabella PDV × Pista (Pezzi) coerenti col seed', async () => {
  const pool = await newPool();
  const session = await signup({ prefix: 'pezzi_exp', fullName: 'Pezzi Export UI Test', organizationName: uniq('PezziExpOrg') });
  let browser;
  try {
    // Seed: due varianti della stessa RS (unificate da normalizeRsName:
    // punti rimossi + uppercase) + una RS distinta.
    //   POSG1 (Gamma S.R.L.): 2 mobile + 1 fisso
    //   POSG2 (GAMMA SRL):    1 mobile + 3 energia
    //   POSD1 (Delta Srl):    1 fisso + 1 assicurazioni
    const seeds = [
      ...Array(2).fill({ codicePos: 'POSG1', nomeNegozio: 'Negozio Gamma 1', ragioneSociale: 'Gamma S.R.L.', pista: 'mobile' }),
      { codicePos: 'POSG1', nomeNegozio: 'Negozio Gamma 1', ragioneSociale: 'Gamma S.R.L.', pista: 'fisso' },
      { codicePos: 'POSG2', nomeNegozio: 'Negozio Gamma 2', ragioneSociale: 'GAMMA SRL', pista: 'mobile' },
      ...Array(3).fill({ codicePos: 'POSG2', nomeNegozio: 'Negozio Gamma 2', ragioneSociale: 'GAMMA SRL', pista: 'energia' }),
      { codicePos: 'POSD1', nomeNegozio: 'Negozio Delta', ragioneSociale: 'Delta Srl', pista: 'fisso' },
      { codicePos: 'POSD1', nomeNegozio: 'Negozio Delta', ragioneSociale: 'Delta Srl', pista: 'assicurazioni' },
    ];
    for (const s of seeds) await insertSale(pool, session.orgId, s);

    // Il displayName della RS unificata è la prima variante incontrata:
    // dipende dall'ordine di pdvSummaries, accettiamo entrambe.
    const gammaDisplays = ['Gamma S.R.L.', 'GAMMA SRL'];

    browser = await launchBrowser();
    const context = await newAuthedContext(browser, session);
    const page = await context.newPage();
    await page.goto(`${BASE}/vendite-bisuite`, { waitUntil: 'networkidle' });

    const card = page.locator('[data-testid="card-tabella-pdv-pista-pezzi"]');
    await card.waitFor({ state: 'visible', timeout: 20000 });

    // ── Task #396: icone colorate delle piste nelle intestazioni ──
    // Ogni th-pezzi-{pista} deve contenere il quadratino colorato (classe
    // bg-* attesa) con dentro l'icona lucide (svg) e testo bianco, allineato
    // a destra (justify-end). Una regressione (refactor colonne, rimozione
    // config PISTA_HEADER_ICONS) deve far fallire questa sezione.
    const EXPECTED_HEADER_ICONS = {
      mobile: 'bg-blue-500',
      fisso: 'bg-green-500',
      energia: 'bg-amber-500',
      assicurazioni: 'bg-purple-500',
    };
    for (const [pista, colorClass] of Object.entries(EXPECTED_HEADER_ICONS)) {
      const th = page.getByTestId(`th-pezzi-${pista}`);
      await th.waitFor({ state: 'visible', timeout: 10000 });
      const wrapClass = await th.locator('div.flex').first().getAttribute('class');
      assert.ok(wrapClass.includes('justify-end'), `th-pezzi-${pista}: header allineato a destra (justify-end), trovato "${wrapClass}"`);
      const iconBox = th.locator(`div.${colorClass}`);
      assert.equal(await iconBox.count(), 1, `th-pezzi-${pista}: quadratino colorato ${colorClass} presente`);
      const boxClass = await iconBox.getAttribute('class');
      assert.ok(boxClass.includes('text-white'), `th-pezzi-${pista}: icona bianca (text-white), trovato "${boxClass}"`);
      assert.equal(await iconBox.locator('svg').count(), 1, `th-pezzi-${pista}: icona svg dentro il quadratino ${colorClass}`);
    }

    // Sanity a schermo: RS Gamma unificata (2 righe RS totali) e totali colonna.
    const rsCount = await page.locator('[data-testid^="row-pezzi-rs-"]').count();
    assert.equal(rsCount, 2, `a schermo: 2 righe RS (Gamma unificata + Delta), trovate ${rsCount}`);
    assert.equal((await page.getByTestId('cell-pezzi-tot-mobile').innerText()).trim(), '3');
    assert.equal((await page.getByTestId('cell-pezzi-tot-generale').innerText()).trim(), '9');

    const download = async (testId) => {
      const [dl] = await Promise.all([
        page.waitForEvent('download', { timeout: 15000 }),
        page.getByTestId(testId).click(),
      ]);
      const p = await dl.path();
      assert.ok(p, `${testId}: download.path() disponibile`);
      return { dl, buf: fs.readFileSync(p) };
    };

    // ── Excel ──
    const { dl: dlX, buf: bufX } = await download('btn-pezzi-export-excel');
    assert.equal(dlX.suggestedFilename(), `tabella-pdv-pista-pezzi_vendite_${TODAY}.xlsx`);
    const wb = XLSX.read(bufX, { type: 'buffer' });
    assert.deepEqual(wb.SheetNames, ['PDV x Pista (Pezzi)']);
    const aoaXlsx = sheetAoa(wb.Sheets['PDV x Pista (Pezzi)']);
    const gammaDisplay = gammaDisplays.find((g) => aoaXlsx.some((r) => r[1] === g));
    assert.ok(gammaDisplay, `una variante Gamma presente nel file: ${JSON.stringify(aoaXlsx.map((r) => r[1]))}`);
    assertExportRows(aoaXlsx, { gammaDisplay }, 'Excel');

    // ── CSV ── (BOM UTF-8 + separatore ";"; riparsato con SheetJS)
    const { dl: dlC, buf: bufC } = await download('btn-pezzi-export-csv');
    assert.equal(dlC.suggestedFilename(), `tabella-pdv-pista-pezzi_vendite_${TODAY}.csv`);
    const csvText = bufC.toString('utf8');
    assert.ok(csvText.startsWith('\uFEFF'), 'CSV: BOM UTF-8 presente');
    assert.ok(csvText.split('\n')[0].includes(';'), 'CSV: separatore ";"');
    const wbCsv = XLSX.read(csvText.replace(/^\uFEFF/, ''), { type: 'string', FS: ';' });
    const aoaCsv = sheetAoa(wbCsv.Sheets[wbCsv.SheetNames[0]]);
    assertExportRows(aoaCsv, { gammaDisplay }, 'CSV');

    // ── PDF ── download avvenuto e file non vuoto/valido.
    const { dl: dlP, buf: bufP } = await download('btn-pezzi-export-pdf');
    assert.equal(dlP.suggestedFilename(), `tabella-pdv-pista-pezzi_vendite_${TODAY}.pdf`);
    assert.ok(bufP.length > 1000, `PDF non vuoto (bytes=${bufP.length})`);
    assert.equal(bufP.subarray(0, 5).toString('latin1'), '%PDF-', 'PDF: magic header');

    await page.close();
    await context.close();
  } finally {
    if (browser) await browser.close().catch(() => {});
    await cleanupOrg(pool, session);
    await pool.end().catch(() => {});
  }
});
