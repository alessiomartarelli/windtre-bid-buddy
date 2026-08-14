import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import {
  BASE,
  uniq,
  jsonReq,
  signup,
  setRole,
  cleanupOrg,
  newPool,
  launchBrowser,
  newAuthedContext,
} from './helpers/uiTest.mjs';

// Task #358: il pulsante Export della card "Pivot voci di costo" deve
// scaricare DAVVERO un file .xlsx coerente con i filtri a schermo:
//   - default (raggruppa per RS, periodo Anno): foglio "Totale" che replica
//     la tabella a schermo (riga Totale inclusa) + un foglio per RS;
//   - toggle PDV + periodo Mese: righe "Punto Vendita", importi limitati al
//     mese selezionato, nome file pivot-costi-<mese>-<anno>-<vista>.xlsx.
// Il file scaricato viene ispezionato con SheetJS (XLSX.read su buffer:
// readFile non esiste in ESM/tsx).

const XLSXmod = await import('xlsx');
const XLSX = XLSXmod.default ?? XLSXmod;

const api = (session, method, path, body) =>
  jsonReq(`${BASE}${path}`, {
    method,
    headers: { Cookie: session.cookieHeader },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });

const YEAR = new Date().getFullYear();

async function readDownloadedWorkbook(download) {
  const p = await download.path();
  assert.ok(p, 'download.path() disponibile');
  const buf = fs.readFileSync(p);
  return XLSX.read(buf, { type: 'buffer' });
}

function sheetRows(wb, name) {
  const ws = wb.Sheets[name];
  assert.ok(ws, `foglio "${name}" presente (fogli: ${wb.SheetNames.join(', ')})`);
  return XLSX.utils.sheet_to_json(ws, { defval: 0 });
}

test('pivot export: il pulsante Excel scarica il file coerente con i filtri a schermo', async () => {
  const pool = await newPool();
  const session = await signup({ prefix: 'cdg_pivot_ui', fullName: 'Cdg Pivot UI Test' });
  let browser;
  try {
    await setRole(pool, session.profileId, 'admin');

    const rs = uniq('RS PivotUI');
    const createRs = await api(session, 'POST', '/api/cdg/ragioni-sociali', { nome: rs });
    assert.equal(createRs.status, 201, `create RS: ${JSON.stringify(createRs.body)}`);

    // Due PDV manuali della stessa RS.
    const pdvA = await api(session, 'POST', '/api/cdg/pdv-manuali', {
      ragioneSociale: rs, codice: uniq('PVA'), nome: 'Negozio Centro UI',
    });
    assert.equal(pdvA.status, 201, `create pdv A: ${JSON.stringify(pdvA.body)}`);
    const pdvB = await api(session, 'POST', '/api/cdg/pdv-manuali', {
      ragioneSociale: rs, codice: uniq('PVB'), nome: 'Negozio Mare UI',
    });
    assert.equal(pdvB.status, 201, `create pdv B: ${JSON.stringify(pdvB.body)}`);
    const codA = pdvA.body.codice;
    const codB = pdvB.body.codice;

    // Due categorie (colonne della pivot).
    const catAffitto = await api(session, 'POST', '/api/cdg/categorie', {
      nome: uniq('Affitto UI'), ragioniSociali: [rs],
    });
    assert.equal(catAffitto.status, 201, `create cat: ${JSON.stringify(catAffitto.body)}`);
    const catUtenze = await api(session, 'POST', '/api/cdg/categorie', {
      nome: uniq('Utenze UI'), ragioniSociali: [rs],
    });
    assert.equal(catUtenze.status, 201, `create cat: ${JSON.stringify(catUtenze.body)}`);
    const affitto = catAffitto.body.nome;
    const utenze = catUtenze.body.nome;

    // Spese nell'anno corrente: gennaio (PDV A: 1000 affitto + 200 utenze) e
    // febbraio (PDV B: 300 affitto). Importi = imponibile (netto IVA), che è
    // ciò che pivotData usa a schermo.
    const spese = [
      { desc: 'Affitto gen', cat: catAffitto.body.id, pdv: codA, imp: '1000.00', ym: `${YEAR}-01` },
      { desc: 'Utenze gen', cat: catUtenze.body.id, pdv: codA, imp: '200.00', ym: `${YEAR}-01` },
      { desc: 'Affitto feb', cat: catAffitto.body.id, pdv: codB, imp: '300.00', ym: `${YEAR}-02` },
    ];
    for (const s of spese) {
      const r = await api(session, 'POST', '/api/cdg/spese', {
        ragioneSociale: rs,
        descrizione: s.desc,
        categoriaId: s.cat,
        pdvCodice: s.pdv,
        imponibile: s.imp,
        aliquotaIva: '22.00',
        dataPagamento: `${s.ym}-05`,
        meseCompetenza: s.ym,
        ricorrente: false,
      });
      assert.equal(r.status, 201, `create spesa ${s.desc}: ${JSON.stringify(r.body)}`);
    }

    browser = await launchBrowser();
    const context = await newAuthedContext(browser, session);
    const page = await context.newPage();
    await page.goto(`${BASE}/amministrazione#controllo`, { waitUntil: 'networkidle' });

    // Pivot popolata (default: raggruppa per RS, periodo Anno, vista competenza).
    await page.getByTestId('row-pivot-0').waitFor({ timeout: 15000 });
    const exportBtn = page.getByTestId('button-export-pivot-xlsx');
    assert.ok(await exportBtn.isEnabled(), 'pulsante export abilitato con dati');

    // --- Export 1: default RS × Anno ---
    const [dl1] = await Promise.all([
      page.waitForEvent('download', { timeout: 15000 }),
      exportBtn.click(),
    ]);
    assert.equal(dl1.suggestedFilename(), `pivot-costi-${YEAR}-competenza.xlsx`);
    const wb1 = await readDownloadedWorkbook(dl1);
    assert.deepEqual(wb1.SheetNames, ['Totale', rs], 'foglio Totale + un foglio per RS');

    const tot1 = sheetRows(wb1, 'Totale');
    assert.equal(tot1.length, 2, '1 riga RS + riga Totale');
    assert.equal(tot1[0]['Ragione Sociale'], rs);
    assert.equal(tot1[0][affitto], 1300);
    assert.equal(tot1[0][utenze], 200);
    assert.equal(tot1[0]['Totale'], 1500);
    const last1 = tot1.at(-1);
    assert.equal(last1['Ragione Sociale'], 'Totale');
    assert.equal(last1['Totale'], 1500, 'riga Totale del file = totale generale a schermo');

    // Il totale a schermo coincide con quello del file (fmtEur it-IT).
    const screenText = (await page.getByTestId('row-pivot-0').innerText()).replace(/[\s\u00a0]/g, '');
    assert.ok(screenText.includes('1.500,00'), `riga a schermo mostra 1.500,00: ${screenText}`);

    // Foglio RS: voci di costo non-zero + riga Totale.
    const rsSheet1 = sheetRows(wb1, rs);
    assert.deepEqual(
      rsSheet1.map(r => r['Voce di costo']).sort(),
      [affitto, 'Totale', utenze].sort(),
    );
    assert.equal(rsSheet1.find(r => r['Voce di costo'] === 'Totale')['Importo'], 1500);

    // --- Export 2: toggle PDV + periodo Mese (Gennaio) ---
    await page.getByTestId('btn-pivot-pdv').click();
    await page.getByTestId('btn-pivot-mese').click();
    await page.getByTestId('select-pivot-mese').click();
    await page.getByRole('option', { name: 'Gennaio' }).click();
    await page.getByTestId('row-pivot-0').waitFor({ timeout: 10000 });

    const [dl2] = await Promise.all([
      page.waitForEvent('download', { timeout: 15000 }),
      page.getByTestId('button-export-pivot-xlsx').click(),
    ]);
    assert.equal(dl2.suggestedFilename(), `pivot-costi-gen-${YEAR}-competenza.xlsx`);
    const wb2 = await readDownloadedWorkbook(dl2);
    assert.deepEqual(wb2.SheetNames, ['Totale', rs]);

    // Foglio Totale in modalità PDV: header "Punto Vendita", solo gennaio
    // (niente 300 di febbraio / PDV B), riga PDV A = 1200.
    const tot2 = sheetRows(wb2, 'Totale');
    assert.ok('Punto Vendita' in tot2[0], 'header riga = Punto Vendita');
    assert.equal(tot2.length, 2, 'solo PDV A + riga Totale (febbraio escluso)');
    assert.equal(tot2[0]['Punto Vendita'], `Negozio Centro UI · ${rs}`);
    assert.equal(tot2[0][affitto], 1000);
    assert.equal(tot2[0][utenze], 200);
    assert.equal(tot2[0]['Totale'], 1200);
    const last2 = tot2.at(-1);
    assert.equal(last2['Punto Vendita'], 'Totale');
    assert.equal(last2['Totale'], 1200, 'il file rispetta il filtro mese a schermo');
    assert.ok(
      !tot2.some(r => String(r['Punto Vendita']).includes('Negozio Mare UI')),
      'PDV di febbraio assente con periodo = Gennaio',
    );

    // Foglio RS in modalità PDV: righe PDV + riga Totale RS.
    const rsSheet2 = sheetRows(wb2, rs);
    assert.equal(rsSheet2.at(-1)['Punto Vendita'], 'Totale');
    assert.equal(rsSheet2.at(-1)['Totale'], 1200);
  } finally {
    if (browser) await browser.close();
    await cleanupOrg(pool, session);
    await pool.end();
  }
});
