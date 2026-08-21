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

// Categorie BiSuite → pista (CATEGORY_MAP condivisa client/server).
const CAT_BY_PISTA = {
  mobile: 'UNTIED',
  fisso: 'ADSL/FIBRA/FWA CF',
  energia: 'ENERGIA W3',
  assicurazioni: 'ASSICURAZIONI',
  protecta: 'ALLARMI',
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
  const cPro = col('Windtre Protetti - Pezzi');
  const cTot = col('Totale Pezzi');

  const body = aoa.slice(1).filter((r) => r.some((v) => v !== ''));

  // Ordine: RS in ordine alfabetico, PDV di ogni RS subito dopo, TOTALE in fondo.
  const expected = [
    ['RS', 'Delta Srl', '', '', 0, 1, 0, 1, 1, 3],
    ['PDV', 'Delta Srl', 'POSD1', 'Negozio Delta', 0, 1, 0, 1, 1, 3],
    ['RS', gammaDisplay, '', '', 4, 3, 4, 0, 0, 11],
    ['PDV', gammaDisplay, 'POSG1', 'Negozio Gamma 1', 2, 1, 0, 0, 0, 3],
    ['PDV', gammaDisplay, 'POSG2', 'Negozio Gamma 2', 1, 0, 3, 0, 0, 4],
    ['PDV', gammaDisplay, 'POSG3', 'Negozio Gamma 3', 1, 2, 1, 0, 0, 4],
    ['TOTALE', 'Totale complessivo', '', '', 4, 4, 4, 1, 1, 14],
  ];
  assert.equal(
    body.length,
    expected.length,
    `${label}: ${expected.length} righe attese (1 RS Gamma unificata, non 2), trovate ${body.length}: ${JSON.stringify(body.map((r) => [r[0], r[1]]))}`,
  );
  expected.forEach((exp, i) => {
    const row = body[i];
    const got = [row[0], row[1], String(row[2]), String(row[3]), +row[cMob], +row[cFis], +row[cEne], +row[cAss], +row[cPro], +row[cTot]];
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
    //   POSG3 (GAMMA SRL):    1 mobile + 2 fisso + 1 energia
    //   POSD1 (Delta Srl):    1 fisso + 1 assicurazioni
    const seeds = [
      ...Array(2).fill({ codicePos: 'POSG1', nomeNegozio: 'Negozio Gamma 1', ragioneSociale: 'Gamma S.R.L.', pista: 'mobile' }),
      { codicePos: 'POSG1', nomeNegozio: 'Negozio Gamma 1', ragioneSociale: 'Gamma S.R.L.', pista: 'fisso' },
      { codicePos: 'POSG2', nomeNegozio: 'Negozio Gamma 2', ragioneSociale: 'GAMMA SRL', pista: 'mobile' },
      ...Array(3).fill({ codicePos: 'POSG2', nomeNegozio: 'Negozio Gamma 2', ragioneSociale: 'GAMMA SRL', pista: 'energia' }),
      { codicePos: 'POSG3', nomeNegozio: 'Negozio Gamma 3', ragioneSociale: 'GAMMA SRL', pista: 'mobile' },
      ...Array(2).fill({ codicePos: 'POSG3', nomeNegozio: 'Negozio Gamma 3', ragioneSociale: 'GAMMA SRL', pista: 'fisso' }),
      { codicePos: 'POSG3', nomeNegozio: 'Negozio Gamma 3', ragioneSociale: 'GAMMA SRL', pista: 'energia' },
      { codicePos: 'POSD1', nomeNegozio: 'Negozio Delta', ragioneSociale: 'Delta Srl', pista: 'fisso' },
      { codicePos: 'POSD1', nomeNegozio: 'Negozio Delta', ragioneSociale: 'Delta Srl', pista: 'assicurazioni' },
      // Task #470: colonna Windtre Protetti (ALLARMI → protecta).
      { codicePos: 'POSD1', nomeNegozio: 'Negozio Delta', ragioneSociale: 'Delta Srl', pista: 'protecta' },
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
      protecta: 'bg-rose-500', // Task #470
    };
    for (const [pista, colorClass] of Object.entries(EXPECTED_HEADER_ICONS)) {
      const th = page.getByTestId(`th-pezzi-${pista}`);
      await th.waitFor({ state: 'visible', timeout: 10000 });
      const wrapClass = await th.locator('button.flex').getAttribute('class');
      assert.ok(wrapClass.includes('justify-end'), `th-pezzi-${pista}: header allineato a destra (justify-end), trovato "${wrapClass}"`);
      const iconBox = th.locator(`div.${colorClass}`);
      assert.equal(await iconBox.count(), 1, `th-pezzi-${pista}: quadratino colorato ${colorClass} presente`);
      const boxClass = await iconBox.getAttribute('class');
      assert.ok(boxClass.includes('text-white'), `th-pezzi-${pista}: icona bianca (text-white), trovato "${boxClass}"`);
      assert.equal(await iconBox.locator('svg').count(), 1, `th-pezzi-${pista}: icona svg dentro il quadratino ${colorClass}`);
    }

    // ── Task #470: icone colorate anche su IVA e CB (colonne extra) ──
    const EXPECTED_EXTRA_ICONS = { iva: 'bg-slate-500', cb: 'bg-cyan-500' };
    for (const [key, colorClass] of Object.entries(EXPECTED_EXTRA_ICONS)) {
      const th = page.getByTestId(`th-pezzi-${key}`);
      await th.waitFor({ state: 'visible', timeout: 10000 });
      const iconBox = th.locator(`div.${colorClass}`);
      assert.equal(await iconBox.count(), 1, `th-pezzi-${key}: quadratino colorato ${colorClass} presente`);
      const boxClass = await iconBox.getAttribute('class');
      assert.ok(boxClass.includes('text-white'), `th-pezzi-${key}: icona bianca (text-white), trovato "${boxClass}"`);
      assert.equal(await iconBox.locator('svg').count(), 1, `th-pezzi-${key}: icona svg dentro il quadratino ${colorClass}`);
    }

    // Sanity a schermo: RS Gamma unificata (2 righe RS totali) e totali colonna.
    const rsCount = await page.locator('[data-testid^="row-pezzi-rs-"]').count();
    assert.equal(rsCount, 2, `a schermo: 2 righe RS (Gamma unificata + Delta), trovate ${rsCount}`);
    assert.equal((await page.getByTestId('cell-pezzi-tot-mobile').innerText()).trim(), '4');
    assert.equal((await page.getByTestId('cell-pezzi-tot-generale').innerText()).trim(), '14');

    // ── Task #443: righe RS espandibili anche da tastiera ──
    // Il toggle è un vero <button> con aria-expanded e aria-controls che
    // punta alle righe PDV controllate; Enter/Spazio funzionano nativamente
    // e il click sulla riga (fuori dal bottone) resta attivo senza doppio
    // toggle (stopPropagation sul bottone).
    const deltaRs = page.locator('[data-testid^="row-pezzi-rs-"]').filter({ hasText: /Delta/i });
    const deltaKey = (await deltaRs.getAttribute('data-testid')).replace('row-pezzi-rs-', '');
    const deltaToggle = page.getByTestId(`btn-pezzi-rs-toggle-${deltaKey}`);
    assert.equal(await deltaToggle.evaluate((el) => el.tagName), 'BUTTON', 'toggle RS: elemento <button> semantico');
    assert.equal(await deltaToggle.getAttribute('aria-expanded'), 'false', 'toggle RS: chiuso all\'avvio');
    assert.match(await deltaToggle.getAttribute('aria-label'), /Espandi/i, 'toggle RS chiuso: label "Espandi"');
    const deltaPdvRow = page.getByTestId('row-pezzi-pdv-POSD1');
    assert.equal(await deltaPdvRow.count(), 0, 'PDV Delta nascosti da chiuso');

    // Tastiera: Enter espande.
    await deltaToggle.focus();
    await page.keyboard.press('Enter');
    assert.equal(await deltaToggle.getAttribute('aria-expanded'), 'true', 'Enter: aria-expanded=true');
    assert.match(await deltaToggle.getAttribute('aria-label'), /Comprimi/i, 'toggle RS aperto: label "Comprimi"');
    await deltaPdvRow.waitFor({ state: 'visible', timeout: 5000 });
    const deltaControls = (await deltaToggle.getAttribute('aria-controls')).split(/\s+/);
    const deltaPdvId = await deltaPdvRow.getAttribute('id');
    assert.ok(deltaPdvId, 'riga PDV Delta ha un id');
    assert.ok(deltaControls.includes(deltaPdvId), `aria-controls (${deltaControls.join(' ')}) include l'id della riga PDV (${deltaPdvId})`);

    // Tastiera: Spazio richiude.
    await page.keyboard.press('Space');
    assert.equal(await deltaToggle.getAttribute('aria-expanded'), 'false', 'Spazio: aria-expanded=false');
    assert.equal(await deltaPdvRow.count(), 0, 'Spazio: PDV Delta di nuovo nascosti');

    // Mouse: click sulla riga fuori dal bottone espande ancora.
    await deltaRs.locator('td').last().click();
    assert.equal(await deltaToggle.getAttribute('aria-expanded'), 'true', 'click riga: espande come prima');
    await deltaPdvRow.waitFor({ state: 'visible', timeout: 5000 });

    // Mouse: click sul bottone richiude una volta sola (niente doppio toggle da bubbling).
    await deltaToggle.click();
    assert.equal(await deltaToggle.getAttribute('aria-expanded'), 'false', 'click bottone: singolo toggle, richiuso');
    assert.equal(await deltaPdvRow.count(), 0, 'click bottone: PDV nascosti');

    // ── Task #442: ordinamento locale dei PDV per pista ──
    // Espandiamo entrambi i gruppi: l'ordinamento opera sui soli PDV, senza
    // spostare la riga RS o alterare i totali. Gamma contiene valori Mobile
    // diversi e un pareggio (POSG2/POSG3 = 1) risolto dal nome del negozio.
    await page.getByTestId('btn-pezzi-expand-all').click();
    const gammaRs = page.locator('[data-testid^="row-pezzi-rs-"]').filter({ hasText: /GAMMA/i });
    const gammaKey = (await gammaRs.getAttribute('data-testid')).replace('row-pezzi-rs-', '');
    const visibleGammaPdvCodes = async () => {
      const rows = page.locator('[data-testid^="row-pezzi-pdv-POSG"]');
      return rows.evaluateAll((els) => els.map((el) => el.getAttribute('data-testid').replace('row-pezzi-pdv-', '')));
    };

    const mobileHeader = page.getByTestId('th-pezzi-mobile');
    const mobileSort = page.getByTestId('btn-pezzi-sort-mobile');
    assert.equal(await mobileHeader.getAttribute('aria-sort'), 'none', 'Mobile: nessun ordinamento attivo inizialmente');
    assert.match(await mobileSort.getAttribute('aria-label'), /ordine crescente.*non applicato/i, 'Mobile: controllo annunciabile prima del click');
    await mobileSort.click();
    assert.equal(await mobileHeader.getAttribute('aria-sort'), 'ascending', 'Mobile: primo click crescente');
    assert.deepEqual(await visibleGammaPdvCodes(), ['POSG2', 'POSG3', 'POSG1'], 'Mobile crescente: pareggio risolto per nome, poi valore più alto');
    assert.equal(await page.locator('[data-testid^="row-pezzi-rs-"]').count(), 2, 'ordinamento: gruppi RS invariati');
    assert.equal((await page.getByTestId('cell-pezzi-tot-generale').innerText()).trim(), '14', 'ordinamento: totale invariato');

    await mobileSort.click();
    assert.equal(await mobileHeader.getAttribute('aria-sort'), 'descending', 'Mobile: secondo click decrescente');
    assert.deepEqual(await visibleGammaPdvCodes(), ['POSG1', 'POSG2', 'POSG3'], 'Mobile decrescente: valore alto prima, pareggio stabile per nome');

    const fissoHeader = page.getByTestId('th-pezzi-fisso');
    await page.getByTestId('btn-pezzi-sort-fisso').press('Enter');
    assert.equal(await mobileHeader.getAttribute('aria-sort'), 'none', 'cambio pista: Mobile non più attiva');
    assert.equal(await fissoHeader.getAttribute('aria-sort'), 'ascending', 'Fisso: nuova pista avvia il crescente anche da tastiera');
    assert.deepEqual(await visibleGammaPdvCodes(), ['POSG2', 'POSG1', 'POSG3'], 'Fisso crescente: 0, 1, 2');
    assert.equal(await page.getByTestId(`row-pezzi-rs-${gammaKey}`).count(), 1, 'cambio pista: gruppo Gamma ancora presente ed espanso');

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

    // ── PDF ── download valido + contenuto testuale verificato (Task #472):
    // header e valori della colonna "Windtre Protetti" devono comparire
    // davvero dentro il PDF, non basta il magic header.
    const { dl: dlP, buf: bufP } = await download('btn-pezzi-export-pdf');
    assert.equal(dlP.suggestedFilename(), `tabella-pdv-pista-pezzi_vendite_${TODAY}.pdf`);
    assert.ok(bufP.length > 1000, `PDF non vuoto (bytes=${bufP.length})`);
    assert.equal(bufP.subarray(0, 5).toString('latin1'), '%PDF-', 'PDF: magic header');
    const pdfTokens = pdfTextTokens(bufP);
    assert.ok(pdfTokens.length > 0, 'PDF: testo estraibile (stream jsPDF non compressi)');
    const pdfJoined = pdfTokens.join(' ');
    // La label può andare a capo (anche a metà parola) nella cella autotable
    // → confronto senza spazi.
    assert.ok(pdfJoined.replace(/\s+/g, '').includes('WindtreProtetti'), `PDF: header "Windtre Protetti" presente (testo: ${pdfJoined.slice(0, 400)})`);
    // Riga RS Delta: [mobile, fisso, energia, assicurazioni, protecta,
    // iva, cb, telefoni, € acc, € srv, totale] = [0,1,0,1,1,0,0,0,0,0,3]
    // — la protecta seminata (ALLARMI) conta 1 nella 5ª colonna pista.
    const idxDelta = pdfTokens.indexOf('Delta Srl');
    assert.ok(idxDelta >= 0, 'PDF: riga RS Delta presente');
    const deltaNums = pdfTokens.slice(idxDelta + 1, idxDelta + 20)
      .filter(t => /^-?\d+(\.\d+)?$/.test(t))
      .map(Number)
      .slice(0, 11);
    assert.deepEqual(deltaNums, [0, 1, 0, 1, 1, 0, 0, 0, 0, 0, 3], `PDF: RS Delta [mob,fis,ene,ass,pro,iva,cb,tel,acc,srv,tot] (trovato: ${deltaNums.join(',')})`);
    // Riga TOTALE: protecta = 1 e totale generale = 14.
    const idxTotPdf = pdfTokens.indexOf('Totale complessivo');
    assert.ok(idxTotPdf >= 0, 'PDF: riga "Totale complessivo" presente');
    const totNumsPdf = pdfTokens.slice(idxTotPdf + 1, idxTotPdf + 20)
      .filter(t => /^-?\d+(\.\d+)?$/.test(t))
      .map(Number)
      .slice(0, 11);
    assert.deepEqual(totNumsPdf, [4, 4, 4, 1, 1, 0, 0, 0, 0, 0, 14], `PDF: TOTALE [mob,fis,ene,ass,pro,iva,cb,tel,acc,srv,tot] (trovato: ${totNumsPdf.join(',')})`);

    await page.close();
    await context.close();
  } finally {
    if (browser) await browser.close().catch(() => {});
    await cleanupOrg(pool, session);
    await pool.end().catch(() => {});
  }
});
