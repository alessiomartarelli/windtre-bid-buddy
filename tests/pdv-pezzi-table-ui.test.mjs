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
