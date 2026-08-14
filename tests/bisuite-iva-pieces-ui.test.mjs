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
  categoria: { nome: 'ACCESSORI' },
  tipologia: { nome: 'ACCESSORIO' },
  descrizione: 'COVER SMARTPHONE',
  dettaglio: { prezzo: '15.00' },
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

    // A filtri default l'accessorio (tipo prodotti) è contato nella card
    // Prodotti: il marcatore "(acc. netto IVA)" appare solo se accLordo > 0.
    await page.getByText('(acc. netto IVA)').waitFor({ timeout: 15000 });

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
  } finally {
    if (browser) await browser.close().catch(() => {});
    await cleanupOrg(pool, session);
    await pool.end().catch(() => {});
  }
});
