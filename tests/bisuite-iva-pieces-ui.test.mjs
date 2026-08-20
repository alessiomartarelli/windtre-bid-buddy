import { test } from 'node:test';
import assert from 'node:assert/strict';

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

// Task #379: verifica UI dei "pezzi IVA" per pista canvass in /vendite-bisuite
// con vendite seminate realistiche (raw_data.articoli come arriva da BiSuite).
//
// Copre:
//   - badge "di cui N IVA" nel riquadro Canvass globale (data-testid
//     text-iva-<pista>) per mobile (TIED IVA), fisso (ADSL/FIBRA/FWA IVA)
//     ed energia (descrizione offerta MICROBUSINESS);
//   - tabella "Categorie canvass" nel dettaglio espanso per PDV
//     (pdv-<codicePos>-categorie-canvass) e per Addetto
//     (addetto-<nome>-categorie-canvass), con "· N IVA" per pista e
//     "(N IVA)" per categoria;
//   - coerenza: la somma dei pezzi IVA dei riepiloghi PDV eguaglia il
//     riquadro globale a parità di filtri (default: mese corrente, stato
//     finalizzate, tipo/pista "all").

const now = new Date();
const pad = (n) => String(n).padStart(2, '0');
// Giorno 10 del mese corrente: dentro il range di default (mese corrente)
// e lontano dai bordi timezone.
const DATA_VENDITA = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-10T10:00:00.000Z`;

const flat = (s) => s.replace(/[\s\u00a0]/g, '');

// Articoli realistici: la classificazione usa categoria.nome + descrizione.
const artTiedIva = {
  categoria: { nome: 'TIED IVA' },
  tipologia: { nome: 'SIM' },
  descrizione: 'WINDTRE BUSINESS TIED',
  dettaglio: { prezzo: '10.00' },
};
const artUntied = {
  categoria: { nome: 'UNTIED' },
  tipologia: { nome: 'SIM' },
  descrizione: 'WINDTRE UNTIED CONSUMER',
  dettaglio: { prezzo: '5.00' },
};
const artFissoIva = {
  categoria: { nome: 'ADSL/FIBRA/FWA IVA' },
  tipologia: { nome: 'FISSO' },
  descrizione: 'SUPER FIBRA PARTITA IVA',
  dettaglio: { prezzo: '20.00' },
};
const artEnergiaBusiness = {
  categoria: { nome: 'ENERGIA W3' },
  tipologia: { nome: 'ENERGIA' },
  descrizione: 'OFFERTA LUCE MICROBUSINESS',
  dettaglio: { prezzo: '0.00' },
};
// Articolo NON canvass (tipo "prodotti"): serve a verificare che il filtro
// Tipo = Canvass lo escluda davvero dagli aggregati globali.
const artAccessorio = {
  tipo: 'P',
  categoria: { nome: 'ACCESSORI' },
  tipologia: { nome: 'ACCESSORIO' },
  descrizione: 'COVER SMARTPHONE',
  dettaglio: { prezzo: '15.00', scontrino: 1, importoScontrino: '15.00' },
};
const artEnergiaConsumer = {
  categoria: { nome: 'ENERGIA W3' },
  tipologia: { nome: 'ENERGIA' },
  descrizione: 'OFFERTA LUCE CASA',
  dettaglio: { prezzo: '0.00' },
};

async function insertSale(pool, orgId, { codicePos, nomeNegozio, nomeAddetto, articoli }) {
  const bisuiteId = Math.floor(Math.random() * 2_000_000_000);
  await pool.query(
    `INSERT INTO bisuite_sales
       (organization_id, bisuite_id, data_vendita, codice_pos, nome_negozio,
        nome_addetto, stato, totale, raw_data)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)`,
    [
      orgId,
      bisuiteId,
      DATA_VENDITA,
      codicePos,
      nomeNegozio,
      nomeAddetto,
      'FINALIZZATA',
      '35.00',
      JSON.stringify({ articoli }),
    ],
  );
}

test('Vendite BiSuite UI: pezzi IVA per pista nel riquadro Canvass e nei dettagli PDV/Addetto', async () => {
  const pool = await newPool();
  const session = await signup({ prefix: 'iva_ui', fullName: 'IVA Pieces UI Test' });
  let browser;
  try {
    await setRole(pool, session.profileId, 'admin');

    // Nomi univoci per evitare collisioni tra run paralleli.
    const POS_A = uniq('POSA');
    const POS_B = uniq('POSB');
    const ADD_A = uniq('LUCA VERDI');
    const ADD_B = uniq('ANNA BIANCHI');

    // PDV A / addetto A:
    //   vendita 1: TIED IVA (mobile, IVA) + UNTIED (mobile, non IVA)
    //   vendita 2: ADSL/FIBRA/FWA IVA (fisso, IVA)
    await insertSale(pool, session.orgId, {
      codicePos: POS_A, nomeNegozio: 'Negozio Alfa', nomeAddetto: ADD_A,
      articoli: [artTiedIva, artUntied, artAccessorio],
    });
    await insertSale(pool, session.orgId, {
      codicePos: POS_A, nomeNegozio: 'Negozio Alfa', nomeAddetto: ADD_A,
      articoli: [artFissoIva],
    });
    // PDV B / addetto B:
    //   vendita 3: ENERGIA W3 MICROBUSINESS (energia, IVA) + ENERGIA W3 casa (non IVA)
    await insertSale(pool, session.orgId, {
      codicePos: POS_B, nomeNegozio: 'Negozio Beta', nomeAddetto: ADD_B,
      articoli: [artEnergiaBusiness, artEnergiaConsumer],
    });

    browser = await launchBrowser();
    const context = await newAuthedContext(browser, session);
    const page = await context.newPage();
    await page.goto(`${BASE}/vendite-bisuite`, { waitUntil: 'networkidle' });
    await page.getByTestId('button-view-vendite').waitFor({ timeout: 20000 });

    // ── Riquadro Canvass globale: "di cui N IVA" per pista ──
    await page.getByTestId('text-iva-mobile').waitFor({ timeout: 20000 });
    assert.equal(flat(await page.getByTestId('text-iva-mobile').innerText()), 'dicui1IVA', 'mobile: 1 pezzo IVA (TIED IVA), UNTIED escluso');
    assert.equal(flat(await page.getByTestId('text-iva-fisso').innerText()), 'dicui1IVA', 'fisso: 1 pezzo IVA (ADSL/FIBRA/FWA IVA)');
    assert.equal(flat(await page.getByTestId('text-iva-energia').innerText()), 'dicui1IVA', 'energia: 1 pezzo IVA (MICROBUSINESS), consumer escluso');
    assert.ok(
      flat(await page.getByTestId('sales-category-panel-canvass').innerText()).includes('35,00€'),
      'pannello Canvass: totale articoli 35,00 €',
    );

    // Task #461: le vecchie tre card sono un pannello navigabile. Su desktop
    // ci sono quattro pulsanti verticali e Accessori è scorporato da Prodotti.
    const desktopCategoryNav = page.getByTestId('sales-category-nav-desktop');
    await desktopCategoryNav.waitFor({ state: 'visible', timeout: 15000 });
    assert.equal(
      await desktopCategoryNav.locator('button').count(),
      4,
      'desktop: quattro categorie (Canvass, Servizi, Accessori, Prodotti)',
    );
    await page.getByTestId('sales-category-desktop-accessori').click();
    await page.getByTestId('sales-category-panel-accessori').waitFor({ state: 'visible', timeout: 15000 });
    // Il marcatore compare solo se il lordo Accessori è > 0.
    await page.getByText('(acc. netto IVA)').waitFor({ timeout: 15000 });
    const accessoriText = flat(await page.getByTestId('sales-category-panel-accessori').innerText());
    assert.ok(accessoriText.includes('12,30€'), `Accessori: imponibile netto IVA 12,30 € (${accessoriText})`);
    assert.ok(accessoriText.includes('IVA2,70€'), `Accessori: IVA separata 2,70 € (${accessoriText})`);
    assert.ok(accessoriText.includes('Scontrinato15,00€'), `Accessori: riepilogo incasso scontrinato 15,00 € (${accessoriText})`);

    // ── Dettaglio PDV A (accordion): tabella "Categorie canvass" ──
    await page.locator(`button:has-text("Negozio Alfa")`).first().click();
    const pdvA = page.getByTestId(`pdv-${POS_A}-categorie-canvass`);
    await pdvA.waitFor({ timeout: 15000 });
    const pdvAText = flat(await pdvA.innerText());
    assert.ok(pdvAText.includes('Mobile·1IVA'), `PDV A: pista Mobile · 1 IVA: ${pdvAText}`);
    assert.ok(pdvAText.includes('TIEDIVA1(1IVA)'), `PDV A: categoria TIED IVA 1 (1 IVA): ${pdvAText}`);
    assert.ok(pdvAText.includes('UNTIED1') && !pdvAText.includes('UNTIED1('), `PDV A: UNTIED senza marcatore IVA: ${pdvAText}`);
    assert.ok(pdvAText.includes('Fisso·1IVA'), `PDV A: pista Fisso · 1 IVA: ${pdvAText}`);
    assert.ok(pdvAText.includes('ADSL/FIBRA/FWAIVA1(1IVA)'), `PDV A: categoria fisso IVA marcata: ${pdvAText}`);

    // ── Dettaglio PDV B: energia con 2 pezzi, 1 IVA ──
    await page.locator(`button:has-text("Negozio Beta")`).first().click();
    const pdvB = page.getByTestId(`pdv-${POS_B}-categorie-canvass`);
    await pdvB.waitFor({ timeout: 15000 });
    const pdvBText = flat(await pdvB.innerText());
    assert.ok(pdvBText.includes('Energia·1IVA'), `PDV B: pista Energia · 1 IVA: ${pdvBText}`);
    assert.ok(pdvBText.includes('ENERGIAW32(1IVA)'), `PDV B: categoria ENERGIA W3 2 (1 IVA): ${pdvBText}`);

    // ── Coerenza globale ↔ riepiloghi PDV a parità di filtri ──
    // Globale: mobile 1 + fisso 1 + energia 1 = 3 pezzi IVA.
    // PDV: A ha 2 (mobile+fisso), B ha 1 (energia) → stessa somma.
    const ivaPdvA = (pdvAText.match(/·1IVA/g) || []).length;
    const ivaPdvB = (pdvBText.match(/·1IVA/g) || []).length;
    assert.equal(ivaPdvA + ivaPdvB, 3, 'somma pezzi IVA nei riepiloghi PDV = 3 come il riquadro globale');

    // ── Vista per Addetto: stessa tabella con prefix addetto-<nome> ──
    await page.getByTestId('button-view-addetti').click();
    await page.locator(`button:has-text("${ADD_A}")`).first().click();
    const addA = page.getByTestId(`addetto-${ADD_A}-categorie-canvass`);
    await addA.waitFor({ timeout: 15000 });
    const addAText = flat(await addA.innerText());
    assert.ok(addAText.includes('Mobile·1IVA'), `Addetto A: Mobile · 1 IVA: ${addAText}`);
    assert.ok(addAText.includes('Fisso·1IVA'), `Addetto A: Fisso · 1 IVA: ${addAText}`);
    assert.ok(addAText.includes('TIEDIVA1(1IVA)'), `Addetto A: TIED IVA marcato: ${addAText}`);

    await page.locator(`button:has-text("${ADD_B}")`).first().click();
    const addB = page.getByTestId(`addetto-${ADD_B}-categorie-canvass`);
    await addB.waitFor({ timeout: 15000 });
    const addBText = flat(await addB.innerText());
    assert.ok(addBText.includes('Energia·1IVA'), `Addetto B: Energia · 1 IVA: ${addBText}`);
    assert.ok(addBText.includes('ENERGIAW32(1IVA)'), `Addetto B: ENERGIA W3 2 (1 IVA): ${addBText}`);

    // ── Task #381: coerenza pezzi IVA con filtro Pista attivo ──
    // Torna alla vista PDV e filtra per pista Mobile: il riquadro globale
    // deve mostrare SOLO la pista Mobile con lo stesso conteggio IVA di
    // prima (1), le altre piste devono sparire dal riquadro.
    await page.getByTestId('button-view-vendite').click();
    await page.getByTestId('select-pista').click();
    await page.getByRole('option', { name: 'Mobile', exact: true }).click();

    await page.getByTestId('text-iva-mobile').waitFor({ timeout: 15000 });
    assert.equal(flat(await page.getByTestId('text-iva-mobile').innerText()), 'dicui1IVA', 'filtro pista=mobile: badge IVA mobile invariato (1)');
    assert.equal(await page.getByTestId('text-iva-fisso').count(), 0, 'filtro pista=mobile: badge IVA fisso sparito');
    assert.equal(await page.getByTestId('text-iva-energia').count(), 0, 'filtro pista=mobile: badge IVA energia sparito');
    assert.equal(await page.getByText('(acc. netto IVA)').count(), 0, 'filtro pista=mobile: accessorio (prodotti, senza pista) escluso dalla card Prodotti');
    // KPI "Articoli Mobile": solo TIED IVA + UNTIED = 2 (accessorio e altre piste esclusi).
    assert.equal(flat(await page.getByTestId('text-total-sales').innerText()), '2', 'filtro pista=mobile: KPI articoli = 2');

    // PDV B (solo energia) non deve comparire tra i PDV a filtro attivo.
    assert.equal(await page.locator(`button:has-text("Negozio Beta")`).count(), 0, 'filtro pista=mobile: PDV B (solo energia) non listato');

    // Dettaglio PDV A: la tabella Categorie canvass mostra solo la pista
    // Mobile (con IVA invariato) e niente riga Fisso.
    const pdvAFiltered = page.getByTestId(`pdv-${POS_A}-categorie-canvass`);
    if (!(await pdvAFiltered.isVisible().catch(() => false))) {
      await page.locator(`button:has-text("Negozio Alfa")`).first().click();
    }
    await pdvAFiltered.waitFor({ timeout: 15000 });
    const pdvAFilteredText = flat(await pdvAFiltered.innerText());
    assert.ok(pdvAFilteredText.includes('Mobile·1IVA'), `filtro pista=mobile, PDV A: Mobile · 1 IVA invariato: ${pdvAFilteredText}`);
    assert.ok(pdvAFilteredText.includes('TIEDIVA1(1IVA)'), `filtro pista=mobile, PDV A: TIED IVA marcato: ${pdvAFilteredText}`);
    assert.ok(pdvAFilteredText.includes('UNTIED1') && !pdvAFilteredText.includes('UNTIED1('), `filtro pista=mobile, PDV A: UNTIED senza marcatore IVA: ${pdvAFilteredText}`);
    assert.ok(!pdvAFilteredText.includes('Fisso'), `filtro pista=mobile, PDV A: riga Fisso sparita: ${pdvAFilteredText}`);
    assert.ok(!pdvAFilteredText.includes('ADSL'), `filtro pista=mobile, PDV A: categoria fisso sparita: ${pdvAFilteredText}`);

    // ── Task #383: vista per Addetto con filtro Pista = Mobile attivo ──
    // Addetto B (solo energia) deve sparire dalla lista; Addetto A resta
    // con i conteggi IVA della sola pista Mobile invariati (1) e senza
    // righe/categorie Fisso.
    await page.getByTestId('button-view-addetti').click();
    await page.locator(`button:has-text("${ADD_A}")`).first().waitFor({ timeout: 15000 });
    assert.equal(await page.locator(`button:has-text("${ADD_B}")`).count(), 0, 'filtro pista=mobile: Addetto B (solo energia) non listato');

    const addAFiltered = page.getByTestId(`addetto-${ADD_A}-categorie-canvass`);
    if (!(await addAFiltered.isVisible().catch(() => false))) {
      await page.locator(`button:has-text("${ADD_A}")`).first().click();
    }
    await addAFiltered.waitFor({ timeout: 15000 });
    const addAFilteredText = flat(await addAFiltered.innerText());
    assert.ok(addAFilteredText.includes('Mobile·1IVA'), `filtro pista=mobile, Addetto A: Mobile · 1 IVA invariato: ${addAFilteredText}`);
    assert.ok(addAFilteredText.includes('TIEDIVA1(1IVA)'), `filtro pista=mobile, Addetto A: TIED IVA marcato: ${addAFilteredText}`);
    assert.ok(addAFilteredText.includes('UNTIED1') && !addAFilteredText.includes('UNTIED1('), `filtro pista=mobile, Addetto A: UNTIED senza marcatore IVA: ${addAFilteredText}`);
    assert.ok(!addAFilteredText.includes('Fisso'), `filtro pista=mobile, Addetto A: riga Fisso sparita: ${addAFilteredText}`);
    assert.ok(!addAFilteredText.includes('ADSL'), `filtro pista=mobile, Addetto A: categoria fisso sparita: ${addAFilteredText}`);

    // Torna alla vista PDV prima della sezione successiva.
    await page.getByTestId('button-view-vendite').click();

    // ── Task #381: coerenza pezzi IVA con filtro Tipo = Canvass ──
    // Reset pista a "Tutte" e tipo = Canvass: tutti gli articoli seminati
    // sono canvass, quindi i badge IVA devono restare identici al default.
    await page.getByTestId('select-pista').click();
    await page.getByRole('option', { name: 'Tutte le piste', exact: true }).click();
    await page.getByTestId('select-tipo').click();
    await page.getByRole('option', { name: 'Canvass', exact: true }).click();

    await page.getByTestId('text-iva-mobile').waitFor({ timeout: 15000 });
    assert.equal(flat(await page.getByTestId('text-iva-mobile').innerText()), 'dicui1IVA', 'filtro tipo=canvass: badge IVA mobile invariato');
    assert.equal(flat(await page.getByTestId('text-iva-fisso').innerText()), 'dicui1IVA', 'filtro tipo=canvass: badge IVA fisso invariato');
    assert.equal(flat(await page.getByTestId('text-iva-energia').innerText()), 'dicui1IVA', 'filtro tipo=canvass: badge IVA energia invariato');

    // L'accessorio (tipo prodotti, stessa vendita della SIM TIED IVA) deve
    // essere ESCLUSO dagli aggregati quando Tipo = Canvass: il marcatore
    // "(acc. netto IVA)" della card Prodotti sparisce.
    assert.equal(await page.getByText('(acc. netto IVA)').count(), 0, 'filtro tipo=canvass: accessorio escluso dalla card Prodotti');
    // KPI "Articoli Canvass": TIED IVA + UNTIED + fisso IVA + 2 energia = 5.
    // Se l'accessorio (prodotti) fosse erroneamente incluso sarebbe 6.
    assert.equal(flat(await page.getByTestId('text-total-sales').innerText()), '5', 'filtro tipo=canvass: KPI articoli = 5, accessorio escluso');
    // Importo filtrato = somma prezzi dei soli articoli canvass (10+5+20+0+0
    // = 35 €); con l'accessorio incluso sarebbe 50 €.
    assert.ok(flat(await page.getByTestId('text-total-amount').innerText()).startsWith('35,00'), 'filtro tipo=canvass: importo filtrato 35,00 € senza accessorio');

    // Entrambi i PDV restano visibili e le loro tabelle canvass invariate.
    const pdvBFiltered = page.getByTestId(`pdv-${POS_B}-categorie-canvass`);
    if (!(await pdvBFiltered.isVisible().catch(() => false))) {
      await page.locator(`button:has-text("Negozio Beta")`).first().click();
    }
    await pdvBFiltered.waitFor({ timeout: 15000 });
    const pdvBFilteredText = flat(await pdvBFiltered.innerText());
    assert.ok(pdvBFilteredText.includes('Energia·1IVA'), `filtro tipo=canvass, PDV B: Energia · 1 IVA invariato: ${pdvBFilteredText}`);
    assert.ok(pdvBFilteredText.includes('ENERGIAW32(1IVA)'), `filtro tipo=canvass, PDV B: ENERGIA W3 2 (1 IVA): ${pdvBFilteredText}`);

    // Task #461: su mobile lo stesso selettore diventa una barra a quattro
    // icone, mantiene lo stato ARIA e cambia davvero il pannello visibile.
    await page.getByTestId('select-tipo').click();
    await page.getByRole('option', { name: 'Tutti i tipi', exact: true }).click();
    await page.setViewportSize({ width: 390, height: 844 });
    const mobileCategoryNav = page.getByTestId('sales-category-nav-mobile');
    await mobileCategoryNav.waitFor({ state: 'visible', timeout: 15000 });
    assert.equal(await mobileCategoryNav.locator('button').count(), 4, 'mobile: quattro categorie a icona');
    await page.getByTestId('sales-category-mobile-servizi').click();
    await page.getByTestId('sales-category-panel-servizi').waitFor({ state: 'visible', timeout: 15000 });
    assert.equal(
      await page.getByTestId('sales-category-mobile-servizi').getAttribute('aria-pressed'),
      'true',
      'mobile: la categoria selezionata espone aria-pressed=true',
    );
  } finally {
    if (browser) await browser.close().catch(() => {});
    await cleanupOrg(pool, session);
    await pool.end().catch(() => {});
  }
});

// Task #463: filtro PDV multiselezione nella pagina Vendite BiSuite.
// Copre: selezione di due PDV (semantica OR), deselezione di uno,
// ripristino "Tutti i punti vendita", drill-down dal riepilogo PDV che
// AGGIUNGE al filtro senza doppioni, e reset filtri che azzera tutto.
test('Vendite BiSuite UI: filtro PDV multiselezione (selezione, deselezione, tutti, drill-down)', async () => {
  const pool = await newPool();
  const session = await signup({ prefix: 'pdv_ms', fullName: 'PDV MultiSelect UI Test' });
  let browser;
  try {
    await setRole(pool, session.profileId, 'admin');

    const POS_A = uniq('MSA');
    const POS_B = uniq('MSB');
    const POS_C = uniq('MSC');

    // A: 2 vendite, B: 1 vendita, C: 1 vendita (tutte FINALIZZATA).
    await insertSale(pool, session.orgId, {
      codicePos: POS_A, nomeNegozio: 'Negozio MS Alfa', nomeAddetto: 'ADD MS A',
      articoli: [artUntied],
    });
    await insertSale(pool, session.orgId, {
      codicePos: POS_A, nomeNegozio: 'Negozio MS Alfa', nomeAddetto: 'ADD MS A',
      articoli: [artTiedIva],
    });
    await insertSale(pool, session.orgId, {
      codicePos: POS_B, nomeNegozio: 'Negozio MS Beta', nomeAddetto: 'ADD MS B',
      articoli: [artFissoIva],
    });
    await insertSale(pool, session.orgId, {
      codicePos: POS_C, nomeNegozio: 'Negozio MS Gamma', nomeAddetto: 'ADD MS C',
      articoli: [artEnergiaConsumer],
    });

    browser = await launchBrowser();
    const context = await newAuthedContext(browser, session);
    const page = await context.newPage();
    await page.goto(`${BASE}/vendite-bisuite`, { waitUntil: 'networkidle' });
    await page.getByTestId('button-view-vendite').waitFor({ timeout: 20000 });

    const trigger = page.getByTestId('select-pdv-filter');
    await trigger.waitFor({ timeout: 20000 });
    assert.equal((await trigger.innerText()).trim(), 'Tutti i punti vendita', 'default: nessuna selezione = tutti i PDV');
    assert.equal(flat(await page.getByTestId('text-total-sales').innerText()), '4', 'default: 4 vendite totali');

    // ── Seleziona due PDV (A + B): semantica "uno qualsiasi dei scelti" ──
    await trigger.click();
    await page.getByTestId(`option-select-pdv-filter-${POS_A}`).click();
    await page.getByTestId(`option-select-pdv-filter-${POS_B}`).click();
    await page.keyboard.press('Escape');
    assert.equal((await trigger.innerText()).trim(), '2 punti vendita', 'trigger mostra il conteggio con 2 selezioni');

    await page.waitForFunction(
      () => document.querySelector('[data-testid="text-total-sales"]')?.textContent?.trim() === '3',
      null, { timeout: 15000 },
    );
    // Riepilogo per PDV: solo A e B, niente C, nessun doppione.
    assert.equal(await page.locator('button:has-text("Negozio MS Alfa")').count(), 1, 'PDV A listato una sola volta');
    assert.equal(await page.locator('button:has-text("Negozio MS Beta")').count(), 1, 'PDV B listato una sola volta');
    assert.equal(await page.locator('button:has-text("Negozio MS Gamma")').count(), 0, 'PDV C (non selezionato) escluso');
    assert.ok(
      flat(await page.getByTestId('card-lista-vendite').innerText()).includes('3record'),
      'tabella vendite: 3 record (2 di A + 1 di B)',
    );
    assert.ok(
      (await page.getByTestId('card-lista-vendite').innerText()).includes('2 punti vendita'),
      'header tabella vendite riflette le 2 selezioni',
    );

    // ── Deseleziona B: resta solo A, il trigger mostra il nome del PDV ──
    await trigger.click();
    await page.getByTestId(`option-select-pdv-filter-${POS_B}`).click();
    await page.keyboard.press('Escape');
    assert.equal((await trigger.innerText()).trim(), 'Negozio MS Alfa', 'trigger mostra il nome con 1 selezione');
    await page.waitForFunction(
      () => document.querySelector('[data-testid="text-total-sales"]')?.textContent?.trim() === '2',
      null, { timeout: 15000 },
    );
    assert.equal(await page.locator('button:has-text("Negozio MS Beta")').count(), 0, 'PDV B deselezionato escluso');

    // ── "Tutti i punti vendita" azzera la selezione ──
    await trigger.click();
    await page.getByTestId('option-select-pdv-filter-all').click();
    await page.keyboard.press('Escape');
    assert.equal((await trigger.innerText()).trim(), 'Tutti i punti vendita', 'voce "tutti" azzera la selezione');
    await page.waitForFunction(
      () => document.querySelector('[data-testid="text-total-sales"]')?.textContent?.trim() === '4',
      null, { timeout: 15000 },
    );
    assert.equal(await page.locator('button:has-text("Negozio MS Gamma")').count(), 1, 'tutti i PDV di nuovo visibili');

    // ── Drill-down dal riepilogo: aggiunge al filtro senza doppioni ──
    await page.locator('button:has-text("Negozio MS Gamma")').first().click();
    await page.getByTestId(`button-view-pdv-${POS_C}`).click();
    assert.equal((await trigger.innerText()).trim(), 'Negozio MS Gamma', 'drill-down imposta il PDV nel filtro');
    await page.waitForFunction(
      () => document.querySelector('[data-testid="text-total-sales"]')?.textContent?.trim() === '1',
      null, { timeout: 15000 },
    );
    // Ripetere il drill-down sullo stesso PDV non crea doppioni.
    await page.locator('button:has-text("Negozio MS Gamma")').first().click();
    await page.getByTestId(`button-view-pdv-${POS_C}`).click();
    assert.equal((await trigger.innerText()).trim(), 'Negozio MS Gamma', 'drill-down ripetuto: nessun doppione (resta 1 selezione)');

    // ── Reset filtri: pulisce tutte le selezioni ──
    await page.getByTestId('button-reset-filters').click();
    assert.equal((await trigger.innerText()).trim(), 'Tutti i punti vendita', 'reset filtri torna a tutti i PDV');
    await page.waitForFunction(
      () => document.querySelector('[data-testid="text-total-sales"]')?.textContent?.trim() === '4',
      null, { timeout: 15000 },
    );
  } finally {
    if (browser) await browser.close().catch(() => {});
    await cleanupOrg(pool, session);
    await pool.end().catch(() => {});
  }
});
