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
      articoli: [artTiedIva, artUntied],
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
  } finally {
    if (browser) await browser.close().catch(() => {});
    await cleanupOrg(pool, session);
    await pool.end().catch(() => {});
  }
});
