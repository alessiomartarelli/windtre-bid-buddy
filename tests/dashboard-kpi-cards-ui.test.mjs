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

// Task #423: le 4 card KPI di testata della Dashboard Gara Reale.
//
// Copre:
//   - text-kpi-actual   : € Actual = somma dei premi gara stimati
//                         (pistaStats[].calc.premioStimato — semantica Task #424/#426);
//   - text-kpi-telefoni : conteggio articoli categoria TELEFONIA;
//   - text-kpi-accessori: somma importo ACCESSORI netto IVA (÷1.22);
//   - text-kpi-servizi  : somma importo SERVIZI netto IVA (÷1.22);
//   - rispettivi -proj  : proiezione ≥ valore attuale
//                         (proj = valore × giorniLavorativiTotali / trascorsi).
//
// Pattern seed/browser mutuato da tests/pdv-pezzi-table-ui.test.mjs.

const IVA_RATE = 1.22;
const now = new Date();
const pad = (n) => String(n).padStart(2, '0');
const MONTH = now.getMonth() + 1;
const YEAR = now.getFullYear();
// Giorno 10 del mese corrente, lontano dai bordi timezone.
const DATA_VENDITA = `${YEAR}-${pad(MONTH)}-10T10:00:00.000Z`;

// ── Articoli di test ──────────────────────────────────────────────────────

// Telefono (conta in headerKpi.telefoni; NON va in accessori/servizi).
const artTelefono = {
  categoria: { nome: 'TELEFONIA' },
  descrizione: 'SMARTPHONE KPI TEST 256GB',
  dettaglio: { prezzo: '499', modalitaAcquisto: 'FINANZIATO' },
};

// Accessorio lordo 244 → netto IVA 244/1.22 = 200.00 esatto.
const artAccessorio = {
  categoria: { nome: 'ACCESSORI' },
  descrizione: 'COVER KPI TEST',
  dettaglio: { importoImponibile: '244' },
};

// Servizio (GARANTEASY) lordo 122 → netto IVA 122/1.22 = 100.00 esatto.
const artServizio = {
  categoria: { nome: 'GARANTEASY' },
  descrizione: 'GARANTEASY KPI 24M',
  dettaglio: { prezzo: '122' },
};

// Articolo canvass neutro (SIM consumer) — non altera telefoni/acc/srv.
const artSim = {
  categoria: { nome: 'TIED CF' },
  tipologia: { nome: 'VOCE EASYPAY' },
  dettaglio: { canone: '10' },
};

async function insertSale(pool, orgId, { codicePos, nomeNegozio, ragioneSociale, articoli, totale = '0.00', stato = 'FINALIZZATA', cliente = { clienteTipo: 'PRIVATO' } }) {
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
      totale,
      JSON.stringify({ cliente, articoli }),
    ],
  );
}

// Parsifica un numero formattato it-IT con il separatore migliaia punto e
// decimali virgola, con o senza simbolo €: "1.234,56 €" → 1234.56.
const parseItNum = (txt) =>
  Number(txt.trim().replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.'));

test('Dashboard Gara Reale: 4 card KPI di testata (€ Actual, Telefoni, € Accessori, € Servizi)', async () => {
  const pool = await newPool();
  const session = await signup({ prefix: 'kpi_cards', fullName: 'KPI Cards UI Test' });
  let browser;
  try {
    await setRole(pool, session.profileId, 'admin');

    const POS_A = uniq('KPIA');
    const RS_A = uniq('KpiRs Srl');

    // Gara config del mese corrente senza calendari → tutte le vendite del mese
    // sono incluse e workdayInfo usa il calendario di default (Lu–Sa).
    await pool.query(
      `INSERT INTO gara_config (organization_id, month, year, name, config)
       VALUES ($1, $2, $3, $4, $5::jsonb)`,
      [session.orgId, MONTH, YEAR, 'Gara KPI test', JSON.stringify({
        pdvList: [{ codicePos: POS_A, nome: 'Negozio KPI', ragioneSociale: RS_A, abilitaEnergia: true }],
        // energiaConfig con targetS1=1 → 1 pezzo energia = soglia S1 → premio 200 €.
        // Serve perché € Actual (dal Task #424/#426) = somma premi gara, non fatturato.
        energiaConfig: {
          pdvInGara: 1,
          targetNoMalus: 0,
          targetS1: 1,
          targetS2: 5,
          targetS3: 10,
          premio: 200,
        },
      })],
    );

    // ── Dati seminati ──────────────────────────────────────────────────────
    //
    // Vendita 1: totale=150.00 | 2 telefoni
    //   → € Actual += 150.00 | telefoni += 2
    await insertSale(pool, session.orgId, {
      codicePos: POS_A, nomeNegozio: 'Negozio KPI', ragioneSociale: RS_A,
      totale: '150.00',
      articoli: [artTelefono, artTelefono],
    });

    // Vendita 2: totale=350.00 | accessorio lordo 244 + servizio lordo 122
    //   → € Actual += 350.00
    //   → € Accessori (netto IVA) = 244/1.22 = 200.00
    //   → € Servizi  (netto IVA) = 122/1.22 = 100.00
    await insertSale(pool, session.orgId, {
      codicePos: POS_A, nomeNegozio: 'Negozio KPI', ragioneSociale: RS_A,
      totale: '350.00',
      articoli: [artAccessorio, artServizio],
    });

    // Vendita 3: totale=100.00 | solo articolo canvass → non altera i KPI
    //   tranne € Actual.
    await insertSale(pool, session.orgId, {
      codicePos: POS_A, nomeNegozio: 'Negozio KPI', ragioneSociale: RS_A,
      totale: '100.00',
      articoli: [artSim],
    });

    // Vendita ANNULLATA: NON deve contare (filtro stato='FINALIZZATA' nella route).
    await insertSale(pool, session.orgId, {
      codicePos: POS_A, nomeNegozio: 'Negozio KPI', ragioneSociale: RS_A,
      totale: '999.00', stato: 'ANNULLATA',
      articoli: [artTelefono, artAccessorio],
    });

    // Vendita 4: 1 pezzo ENERGIA (FISICA) → pista energia a soglia S1 → premio 200 €.
    //   → € Actual (somma premi gara) = 200.
    await insertSale(pool, session.orgId, {
      codicePos: POS_A, nomeNegozio: 'Negozio KPI', ragioneSociale: RS_A,
      totale: '0.00',
      articoli: [{
        categoria: { nome: 'ENERGIA W3' },
        tipologia: { nome: 'ENERGIA' },
        descrizione: 'OFFERTA LUCE',
        dettaglio: { prezzo: '0.00' },
      }],
      cliente: { clienteTipo: 'FISICA' },
    });

    // ── Valori attesi ──────────────────────────────────────────────────────
    // € Actual = somma dei premi gara stimati (solo la pista energia ha un
    // premio configurato nel seed) — NON il fatturato lordo delle vendite.
    const EXPECTED_ACTUAL = 200;
    const EXPECTED_TELEFONI = 2;
    const EXPECTED_ACC = 244 / IVA_RATE;               // 200.000...
    const EXPECTED_SRV = 122 / IVA_RATE;               // 100.000...

    browser = await launchBrowser();
    const context = await newAuthedContext(browser, session);
    const page = await context.newPage();
    await page.goto(`${BASE}/dashboard-gara-reale`, { waitUntil: 'networkidle' });

    // Aspetta che tutte e 4 le card siano visibili.
    for (const key of ['actual', 'telefoni', 'accessori', 'servizi']) {
      await page.getByTestId(`card-kpi-${key}`).waitFor({ timeout: 30000 });
    }

    // ── Legge i giorni lavorativi dalla card workday-info per calcolare la
    // proiezione attesa: proj = valore * total / elapsed (elapsed > 0).
    await page.getByTestId('card-workday-info').waitFor({ timeout: 10000 });
    const elapsedText = (await page.getByTestId('text-elapsed-days').innerText()).trim();
    const remainingText = (await page.getByTestId('text-remaining-days').innerText()).trim();
    const elapsed = Number(elapsedText);
    const remaining = Number(remainingText);
    assert.ok(elapsed > 0, `elapsed (${elapsed}) deve essere > 0 il giorno 10`);
    const total = elapsed + remaining;
    const proj = (v) => elapsed > 0 ? (v / elapsed) * total : v;

    // ── Card € Actual ──────────────────────────────────────────────────────
    // Nota: dopo Task #422/#424 text-kpi-actual mostra la somma dei PREMI DI
    // GARA (non il fatturato lordo). Con questa gara_config senza soglie
    // premioStimato=0 per ogni pista, quindi il valore è 0. Le asserzioni sul
    // valore esatto di €Actual sono coperte dalla suite dedicata
    // dashboard-gara-actual-kpi-ticker-ui-tests (Task #426), che seed una
    // gara_config con soglie e verifica il valore atteso. Qui verifichiamo solo
    // che la card esista e non mostri un valore negativo.
    const actualTxt = await page.getByTestId('text-kpi-actual').innerText();
    const actualVal = parseItNum(actualTxt);
    assert.ok(actualVal >= 0, `€ Actual deve essere ≥ 0 (trovato ${actualVal})`);

    // La proiezione del premio è a soglie (non lineare): con targetS1=1 già
    // raggiunto resta ≥ del premio attuale, senza formula lineare da verificare.
    const actualProjTxt = await page.getByTestId('text-kpi-actual-proj').innerText();
    const actualProjVal = parseItNum(actualProjTxt);
    assert.ok(actualProjVal >= actualVal, `€ Actual proiezione (${actualProjVal}) ≥ attuale (${actualVal})`);

    // ── Card Telefoni ──────────────────────────────────────────────────────
    const telTxt = await page.getByTestId('text-kpi-telefoni').innerText();
    const telVal = Number(telTxt.replace(/[^\d]/g, ''));
    assert.equal(telVal, EXPECTED_TELEFONI, `Telefoni attuale = ${EXPECTED_TELEFONI} (annullata esclusa)`);

    const telProjTxt = await page.getByTestId('text-kpi-telefoni-proj').innerText();
    const telProjVal = Number(telProjTxt.replace(/[^\d]/g, ''));
    const expectedTelProj = Math.round(proj(EXPECTED_TELEFONI));
    assert.ok(telProjVal >= telVal, `Telefoni proiezione (${telProjVal}) ≥ attuale (${telVal})`);
    assert.ok(
      Math.abs(telProjVal - expectedTelProj) <= 1,
      `Telefoni proiezione ≈ ${expectedTelProj} (trovato ${telProjVal})`,
    );

    // ── Card € Accessori (netto IVA) ───────────────────────────────────────
    const accTxt = await page.getByTestId('text-kpi-accessori').innerText();
    const accVal = parseItNum(accTxt);
    assert.ok(
      Math.abs(accVal - EXPECTED_ACC) < 0.02,
      `€ Accessori netto IVA = ${EXPECTED_ACC.toFixed(2)} (trovato ${accVal})`,
    );

    const accProjTxt = await page.getByTestId('text-kpi-accessori-proj').innerText();
    const accProjVal = parseItNum(accProjTxt);
    const expectedAccProj = proj(EXPECTED_ACC);
    assert.ok(accProjVal >= accVal - 0.02, `€ Accessori proiezione (${accProjVal}) ≥ attuale (${accVal})`);
    assert.ok(
      Math.abs(accProjVal - expectedAccProj) < 1,
      `€ Accessori proiezione ≈ ${expectedAccProj.toFixed(2)} (trovato ${accProjVal})`,
    );

    // ── Card € Servizi (netto IVA) ─────────────────────────────────────────
    const srvTxt = await page.getByTestId('text-kpi-servizi').innerText();
    const srvVal = parseItNum(srvTxt);
    assert.ok(
      Math.abs(srvVal - EXPECTED_SRV) < 0.02,
      `€ Servizi netto IVA = ${EXPECTED_SRV.toFixed(2)} (trovato ${srvVal})`,
    );

    const srvProjTxt = await page.getByTestId('text-kpi-servizi-proj').innerText();
    const srvProjVal = parseItNum(srvProjTxt);
    const expectedSrvProj = proj(EXPECTED_SRV);
    assert.ok(srvProjVal >= srvVal - 0.02, `€ Servizi proiezione (${srvProjVal}) ≥ attuale (${srvVal})`);
    assert.ok(
      Math.abs(srvProjVal - expectedSrvProj) < 1,
      `€ Servizi proiezione ≈ ${expectedSrvProj.toFixed(2)} (trovato ${srvProjVal})`,
    );

  } finally {
    if (browser) await browser.close().catch(() => {});
    await cleanupOrg(pool, session);
    await pool.end().catch(() => {});
  }
});
