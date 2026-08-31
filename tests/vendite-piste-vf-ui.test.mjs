import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import {
  BASE,
  uniq,
  jsonReq,
  signup,
  cleanupOrg,
  newPool,
  launchBrowser,
  newAuthedContext,
} from './helpers/uiTest.mjs';

// Task #535 — scenario end-to-end Vodafone/Fastweb per la pagina Vendite
// BiSuite (Task #534): un'org con brand VF (hasCanvassBrand) deve vedere
// grafico "Andamento KPI", Tabella PDV × Pista (Pezzi), filtro Pista ed
// export Excel/CSV/PDF con la tassonomia VF a 8 piste
// (Mobile/Fisso/CB/Luce/Gas/IVA Mobile/IVA Wireline/VAS), SENZA le piste
// WindTre-only (Energia/Assicurazioni/Windtre Protetti) né la P.IVA
// generica, e senza le colonne extra IVA/CB (che nel modello VF sono piste).
//
// Le offerte da seminare NON sono hardcodate: si legge il listino canvass
// effettivo via /api/bisuite-canvass-reference (baked o override salvato in
// system_config) e si sceglie, per ciascuna delle 8 piste, un'offerta il cui
// match risolve su quella pista con lo stesso helper condiviso del client
// (pistaFromCanvassMatch). Così il test resta allineato alla classificazione
// reale anche se il listino cambia.

import {
  VENDITE_PISTE_VF,
  pistaFromCanvassMatch,
  getPistaCanvassLabels,
} from '../shared/bisuiteClassification.ts';

const XLSXmod = await import('xlsx');
const XLSX = XLSXmod.default ?? XLSXmod;

const TODAY = new Date().toISOString().slice(0, 10);
const VF_LABELS = getPistaCanvassLabels(true);

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

let nextBisuiteId = 535_000_000 + Math.floor(Math.random() * 1_000_000);
let minutesAgo = 5;

// Una vendita FINALIZZATA di oggi con un articolo del listino canvass:
// il match avviene per `codice` esatto (chiave primaria del classificatore).
async function insertVfSale(pool, orgId, { codicePos, nomeNegozio, ragioneSociale, offer }) {
  await pool.query(
    `INSERT INTO bisuite_sales
       (organization_id, bisuite_id, data_vendita, codice_pos, nome_negozio,
        nome_addetto, nome_cliente, totale, stato, ragione_sociale, raw_data)
     VALUES ($1, $2, now() - ($3 || ' minutes')::interval, $4, $5,
             'Addetto VF', 'Cliente VF', '10.00', 'FINALIZZATA', $6, $7::jsonb)`,
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
            codice: offer.codice,
            categoria: { nome: offer.categoria },
            tipologia: { nome: offer.tipologia },
            descrizione: offer.nomeEtichetta,
            dettaglio: { prezzo: '10.00' },
          },
        ],
      }),
    ],
  );
}

// Piste WindTre-only che NON devono comparire nel modello VF (né la P.IVA
// generica "iva", né le colonne extra iva/cb come colonne separate).
const W3_ONLY = ['energia', 'assicurazioni', 'protecta', 'iva'];
const W3_ONLY_LABELS = ['Energia', 'Assicurazioni', 'Windtre Protetti', 'P.IVA'];

// AOA (array di array) del foglio, celle vuote → ''.
function sheetAoa(ws) {
  return XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
}

// Verifica header + righe RS/PDV/TOTALE dell'export contro il seed VF.
function assertVfExportRows(aoa, label) {
  const header = aoa[0];
  assert.equal(header[0], 'Tipo', `${label}: prima colonna header`);
  assert.equal(header[1], 'Ragione Sociale', `${label}: header RS`);
  assert.equal(header[2], 'Codice PDV', `${label}: header codice`);
  assert.equal(header[3], 'Nome PDV', `${label}: header nome`);

  // 8 colonne pista VF, nell'ordine della tassonomia condivisa, subito dopo
  // le 4 colonne anagrafiche.
  const expectedPisteHeaders = VENDITE_PISTE_VF.map((p) => `${VF_LABELS[p]} - Volumi`);
  assert.deepEqual(
    header.slice(4, 4 + expectedPisteHeaders.length),
    expectedPisteHeaders,
    `${label}: colonne pista VF in ordine`,
  );
  // Colonne extra VF: Telefoni + € (niente IVA/CB come colonne extra).
  assert.deepEqual(
    header.slice(4 + expectedPisteHeaders.length),
    ['Telefoni', '€ Accessori (netto IVA)', '€ Servizi (netto IVA)', 'Totale Volumi'],
    `${label}: colonne extra VF (senza IVA/CB) + Totale`,
  );
  for (const bad of ['Energia - Volumi', 'Assicurazioni - Volumi', 'Windtre Protetti - Volumi', 'P.IVA - Volumi', 'IVA', 'CB']) {
    assert.ok(!header.includes(bad), `${label}: colonna WindTre-only/extra "${bad}" assente (header: ${header.join(', ')})`);
  }

  const body = aoa.slice(1).filter((r) => r.some((v) => v !== ''));
  // [mobile,fisso,cb,luce,gas,iva_mobile,iva_wireline,vas, tel,acc,srv, tot]
  const expected = [
    ['RS', 'VF Uno Srl', '', '', 2, 1, 1, 1, 1, 1, 1, 2, 0, 0, 0, 10],
    ['PDV', 'VF Uno Srl', 'POSV1', 'Negozio VF 1', 2, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 5],
    ['PDV', 'VF Uno Srl', 'POSV2', 'Negozio VF 2', 0, 0, 0, 0, 1, 1, 1, 2, 0, 0, 0, 5],
    ['TOTALE', 'Totale complessivo', '', '', 2, 1, 1, 1, 1, 1, 1, 2, 0, 0, 0, 10],
  ];
  assert.equal(body.length, expected.length, `${label}: ${expected.length} righe attese, trovate ${body.length}: ${JSON.stringify(body.map((r) => [r[0], r[1]]))}`);
  expected.forEach((exp, i) => {
    const row = body[i];
    const got = [row[0], row[1], String(row[2]), String(row[3]), ...row.slice(4).map(Number)];
    assert.deepEqual(got, exp, `${label}: riga ${i + 1} (${exp[0]} ${exp[1]})`);
  });
}

test('Vendite BiSuite (org Vodafone/Fastweb): grafico, tabella, filtro Pista ed export con le piste VF', async () => {
  const pool = await newPool();
  const session = await signup({ prefix: 'vf_piste', fullName: 'VF Piste UI Test', organizationName: uniq('VfPisteOrg') });
  let browser;
  let brandId;
  try {
    // Brand VF: il nome deve solo matchare /vodafone|fastweb/i.
    const b = await pool.query(`INSERT INTO brands (name) VALUES ($1) RETURNING id`, [uniq('Vodafone')]);
    brandId = b.rows[0].id;
    await pool.query(
      `INSERT INTO organization_brands (organization_id, brand_id) VALUES ($1, $2)`,
      [session.orgId, brandId],
    );

    // Listino canvass EFFETTIVO (baked o override) visto dal client.
    const ref = await jsonReq(`${BASE}/api/bisuite-canvass-reference`, {
      headers: { Cookie: session.cookieHeader },
    });
    assert.equal(ref.status, 200, `canvass-reference: ${JSON.stringify(ref.body)}`);
    assert.equal(ref.body?.hasCanvassBrand, true, 'org con brand VF: hasCanvassBrand=true');
    const offers = ref.body?.offers || [];
    assert.ok(offers.length > 0, 'listino canvass non vuoto');

    // Per ogni pista VF, un'offerta che il classificatore condiviso risolve
    // proprio su quella pista (match per codice esatto).
    const offerFor = {};
    for (const offer of offers) {
      const p = pistaFromCanvassMatch(offer);
      if (p && !offerFor[p]) offerFor[p] = offer;
    }
    for (const p of VENDITE_PISTE_VF) {
      assert.ok(offerFor[p], `listino: nessuna offerta risolve sulla pista VF "${p}"`);
    }

    // Seed: 1 RS, 2 PDV, 10 vendite che coprono TUTTE le 8 piste VF.
    //   POSV1: 2 mobile + 1 fisso + 1 cb + 1 luce            (tot 5)
    //   POSV2: 1 gas + 1 iva_mobile + 1 iva_wireline + 2 vas (tot 5)
    const seeds = [
      ...Array(2).fill(['POSV1', 'mobile']),
      ['POSV1', 'fisso'],
      ['POSV1', 'cb'],
      ['POSV1', 'luce'],
      ['POSV2', 'gas'],
      ['POSV2', 'iva_mobile'],
      ['POSV2', 'iva_wireline'],
      ...Array(2).fill(['POSV2', 'vas']),
    ];
    for (const [codicePos, pista] of seeds) {
      await insertVfSale(pool, session.orgId, {
        codicePos,
        nomeNegozio: codicePos === 'POSV1' ? 'Negozio VF 1' : 'Negozio VF 2',
        ragioneSociale: 'VF Uno Srl',
        offer: offerFor[pista],
      });
    }

    browser = await launchBrowser();
    const context = await newAuthedContext(browser, session);
    const page = await context.newPage();
    await page.goto(`${BASE}/vendite-bisuite`, { waitUntil: 'networkidle' });

    const card = page.locator('[data-testid="card-tabella-pdv-pista-pezzi"]');
    await card.waitFor({ state: 'visible', timeout: 20000 });

    // ── Tabella: intestazioni = 8 piste VF, ciascuna con controllo di
    // ordinamento (le colonne pista hanno il bottone sort, le extra no). ──
    for (const p of VENDITE_PISTE_VF) {
      const th = page.getByTestId(`th-pezzi-${p}`);
      await th.waitFor({ state: 'visible', timeout: 10000 });
      assert.equal(
        await th.locator(`[data-testid="btn-pezzi-sort-${p}"]`).count(),
        1,
        `th-pezzi-${p}: è una colonna pista (bottone sort presente)`,
      );
      const text = (await th.innerText()).trim();
      assert.ok(text.includes(VF_LABELS[p]), `th-pezzi-${p}: label "${VF_LABELS[p]}" (trovato "${text}")`);
    }
    // Niente colonne WindTre-only né extra IVA/CB (cb qui è pista, già
    // verificata sopra col bottone sort; "iva" generica proprio assente).
    for (const p of W3_ONLY) {
      assert.equal(await page.getByTestId(`th-pezzi-${p}`).count(), 0, `th-pezzi-${p}: assente nel modello VF`);
    }
    // Colonne extra VF presenti (Telefoni, senza bottone sort).
    assert.equal(await page.getByTestId('th-pezzi-telefoni').count(), 1, 'colonna extra Telefoni presente');
    assert.equal(await page.locator('[data-testid="btn-pezzi-sort-telefoni"]').count(), 0, 'Telefoni: colonna extra, non pista');

    // ── Riga totale: pezzi per pista e totale generale coerenti col seed. ──
    const expectedTotals = { mobile: '2', fisso: '1', cb: '1', luce: '1', gas: '1', iva_mobile: '1', iva_wireline: '1', vas: '2' };
    for (const [p, v] of Object.entries(expectedTotals)) {
      assert.equal((await page.getByTestId(`cell-pezzi-tot-${p}`).innerText()).trim(), v, `totale colonna ${p}`);
    }
    assert.equal((await page.getByTestId('cell-pezzi-tot-generale').innerText()).trim(), '10', 'totale generale');

    // ── Grafico Andamento KPI: chip = 8 piste VF + Totale, niente piste
    // WindTre-only né P.IVA generica. ──
    const chart = page.getByTestId('card-andamento-pezzi');
    await chart.waitFor({ state: 'visible', timeout: 10000 });
    for (const p of VENDITE_PISTE_VF) {
      assert.equal(await page.getByTestId(`btn-trend-${p}`).count(), 1, `chip btn-trend-${p} presente`);
    }
    assert.equal(await page.getByTestId('btn-trend-totale').count(), 1, 'chip Totale pezzi presente');
    for (const p of W3_ONLY) {
      assert.equal(await page.getByTestId(`btn-trend-${p}`).count(), 0, `chip btn-trend-${p} assente nel modello VF`);
    }

    // ── Filtro Pista: solo le 8 piste VF (+ "Tutte le piste"). ──
    await page.getByTestId('select-pista').click();
    const optionsLoc = page.getByRole('option');
    await optionsLoc.first().waitFor({ state: 'visible', timeout: 5000 });
    const options = (await optionsLoc.allInnerTexts()).map((t) => t.trim());
    const expectedOptions = ['Tutte le piste', ...VENDITE_PISTE_VF.map((p) => VF_LABELS[p])];
    assert.deepEqual(options, expectedOptions, `filtro Pista: opzioni VF in ordine (trovate: ${options.join(', ')})`);
    for (const label of W3_ONLY_LABELS) {
      assert.ok(!options.includes(label), `filtro Pista: opzione WindTre-only "${label}" assente`);
    }
    await page.keyboard.press('Escape');

    // ── Export Excel/CSV/PDF: stesse colonne VF e stessi numeri. ──
    const download = async (testId) => {
      const [dl] = await Promise.all([
        page.waitForEvent('download', { timeout: 15000 }),
        page.getByTestId(testId).click(),
      ]);
      const p = await dl.path();
      assert.ok(p, `${testId}: download.path() disponibile`);
      return { dl, buf: fs.readFileSync(p) };
    };

    const { dl: dlX, buf: bufX } = await download('btn-pezzi-export-excel');
    assert.equal(dlX.suggestedFilename(), `tabella-pdv-pista-volumi_vendite_${TODAY}.xlsx`);
    const wb = XLSX.read(bufX, { type: 'buffer' });
    assert.deepEqual(wb.SheetNames, ['PDV x Pista (Volumi)']);
    assertVfExportRows(sheetAoa(wb.Sheets['PDV x Pista (Volumi)']), 'Excel');

    const { dl: dlC, buf: bufC } = await download('btn-pezzi-export-csv');
    assert.equal(dlC.suggestedFilename(), `tabella-pdv-pista-volumi_vendite_${TODAY}.csv`);
    const csvText = bufC.toString('utf8');
    assert.ok(csvText.startsWith('\uFEFF'), 'CSV: BOM UTF-8 presente');
    const wbCsv = XLSX.read(csvText.replace(/^\uFEFF/, ''), { type: 'string', FS: ';' });
    assertVfExportRows(sheetAoa(wbCsv.Sheets[wbCsv.SheetNames[0]]), 'CSV');

    const { dl: dlP, buf: bufP } = await download('btn-pezzi-export-pdf');
    assert.equal(dlP.suggestedFilename(), `tabella-pdv-pista-volumi_vendite_${TODAY}.pdf`);
    assert.equal(bufP.subarray(0, 5).toString('latin1'), '%PDF-', 'PDF: magic header');
    const pdfTokens = pdfTextTokens(bufP);
    assert.ok(pdfTokens.length > 0, 'PDF: testo estraibile');
    const pdfNoSpace = pdfTokens.join(' ').replace(/\s+/g, '');
    // Header pista VF presenti (le celle autotable possono spezzare le label
    // anche a metà parola → confronto senza spazi).
    for (const p of VENDITE_PISTE_VF) {
      const needle = `${VF_LABELS[p]}-Volumi`.replace(/\s+/g, '');
      assert.ok(pdfNoSpace.includes(needle), `PDF: header "${VF_LABELS[p]} - Volumi" presente`);
    }
    for (const bad of ['Energia-Volumi', 'Assicurazioni-Volumi', 'WindtreProtetti', 'P.IVA-Volumi']) {
      assert.ok(!pdfNoSpace.includes(bad), `PDF: "${bad}" assente nel modello VF`);
    }
    // Riga TOTALE: [8 piste] + [tel, acc, srv] + totale = 12 numeri.
    const idxTot = pdfTokens.indexOf('Totale complessivo');
    assert.ok(idxTot >= 0, 'PDF: riga "Totale complessivo" presente');
    const totNums = pdfTokens.slice(idxTot + 1, idxTot + 25)
      .filter((t) => /^-?\d+(\.\d+)?$/.test(t))
      .map(Number)
      .slice(0, 12);
    assert.deepEqual(
      totNums,
      [2, 1, 1, 1, 1, 1, 1, 2, 0, 0, 0, 10],
      `PDF: TOTALE [mob,fis,cb,luce,gas,ivaM,ivaW,vas,tel,acc,srv,tot] (trovato: ${totNums.join(',')})`,
    );

    await page.close();
    await context.close();
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (brandId) {
      await pool.query(`DELETE FROM organization_brands WHERE brand_id = $1`, [brandId]).catch(() => {});
      await pool.query(`DELETE FROM brands WHERE id = $1`, [brandId]).catch(() => {});
    }
    await cleanupOrg(pool, session);
    await pool.end().catch(() => {});
  }
});
