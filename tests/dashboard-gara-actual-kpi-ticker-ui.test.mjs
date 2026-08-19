import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BASE,
  uniq,
  signup,
  setRole,
  newPool,
  launchBrowser,
  newAuthedContext,
  cleanupOrg,
} from './helpers/uiTest.mjs';

// Task #426 — Suite UI Playwright per la Dashboard Gara Reale.
//
// Copre le regressioni del KPI Incentivi, del ticker e degli addon assicurativi:
//   (a) Card "€ Incentivi": deve mostrare la SOMMA dei premi di gara
//       (pistaStats[].calc.premioStimato), non il fatturato lordo. Il riquadro
//       "Premio di Gara" duplicato non deve essere renderizzato.
//   (b) Sezione "Piste in gara" (section-pista-ticker): mostra solo le piste
//       con totalePezzi > 0 o premioStimato > 0. Dal redesign "Shorts" le
//       piste sono card verticali cliccabili (ticker-pista-{p}, aria-expanded)
//       che aprono/chiudono un pannello dettaglio (ticker-detail-{p}).
//       Il vecchio pulsante btn-ticker-pause NON esiste più.
//
// Strategia di seed:
//   - Test 1 (1 pista): gara_config con energiaConfig bassa (targetS1=1),
//     1 vendita ENERGIA W3 + clienteTipo FISICA → pista energia con premio 200 €.
//     → Sezione piste: 1 sola card, nessun btn-ticker-pause (rimosso).
//   - Test 2 (3 piste): stessa org + 2 vendite extra:
//       · TIED CF + VOCE EASYPAY → mobile (totalePezzi > 0 tramite SIM_CONSUMER_CORE)
//       · MIA TIED + MIA EASYPAY STANDARD → cb (totalePezzi > 0)
//     → Sezione piste: 3 card → click/tastiera aprono e chiudono il
//       pannello dettaglio (aria-expanded + ticker-detail-{p}).
//
// I test richiedono dev server attivo su :5000 e DATABASE_URL.

const now = new Date();
const pad = (n) => String(n).padStart(2, '0');
const CUR_YEAR = now.getFullYear();
const CUR_MONTH = now.getMonth() + 1;
// Giorno 10 del mese corrente: dentro il range del mese e lontano dai bordi.
const DATA_VENDITA = `${CUR_YEAR}-${pad(CUR_MONTH)}-10T10:00:00.000Z`;

// Rimuove spazi e NBSP per confronti senza formattazione.
const flat = (s) => s.replace(/[\s\u00a0]+/g, '');

// Parsa un testo formattato in it-IT con simbolo "€" come numero.
// Es.: "200,00 €" → 200, "1.500 €" → 1500, "1.234,50 €" → 1234.50.
// Gestisce sia la card KPI (minimumFractionDigits:2) sia formatEuro (omette decimali per interi).
function parseEuroText(s) {
  const clean = flat(s).replace(/€/g, '').replace(/\./g, '').replace(',', '.');
  return parseFloat(clean || '0');
}

// ── Articoli BiSuite ──────────────────────────────────────────────────────
// ENERGIA W3 + clienteTipo FISICA → pista 'energia', targetCategory CONSUMER_NO_SDD
const artEnergia = {
  categoria: { nome: 'ENERGIA W3' },
  tipologia: { nome: 'ENERGIA' },
  descrizione: 'OFFERTA LUCE',
  dettaglio: { prezzo: '0.00' },
};
const clienteFisica = { clienteTipo: 'FISICA' };

// TIED CF + VOCE EASYPAY → pista 'mobile', targetCategory TIED (in SIM_CONSUMER_CORE)
const artTied = {
  categoria: { nome: 'TIED CF' },
  tipologia: { nome: 'VOCE EASYPAY' },
  dettaglio: { canone: '10' },
};
const clientePrivato = { clienteTipo: 'PRIVATO' };

// MIA TIED + MIA EASYPAY STANDARD → pista 'cb', targetCategory cambio_offerta_rivincoli
const artMia = {
  categoria: { nome: 'MIA TIED' },
  tipologia: { nome: 'MIA EASYPAY STANDARD' },
  dettaglio: { prezzo: '0.00' },
};

// Categoria assicurativa con tipologia volutamente non mappata come prodotto
// base: la sola voce prodotta è l'additional "Pagamento Annuale".
const artPagamentoAnnualeSolo = {
  categoria: { nome: 'ASSICURAZIONI' },
  tipologia: { nome: 'TIPOLOGIA NON MAPPATA' },
  descrizione: 'PRODOTTO NON MAPPATO',
  dettaglio: {
    prezzo: '0.00',
    domandeRisposte: [
      { domandaTesto: 'PAGAMENTO ANNUALE', risposta: 'SI' },
    ],
  },
};

// ── DB helpers ────────────────────────────────────────────────────────────
async function insertSale(pool, orgId, { codicePos, nomeNegozio = 'Negozio', ragioneSociale = 'RS Srl', articoli, cliente }) {
  const bisuiteId = Math.floor(Math.random() * 2_000_000_000);
  await pool.query(
    `INSERT INTO bisuite_sales
       (organization_id, bisuite_id, data_vendita, codice_pos, nome_negozio,
        ragione_sociale, stato, raw_data)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)`,
    [
      orgId, bisuiteId, DATA_VENDITA, codicePos, nomeNegozio, ragioneSociale,
      'ATTIVO', JSON.stringify({ cliente, articoli }),
    ],
  );
}

async function insertGaraConfig(pool, orgId, config) {
  await pool.query(
    `INSERT INTO gara_config (organization_id, month, year, name, config)
     VALUES ($1, $2, $3, $4, $5::jsonb)`,
    [orgId, CUR_MONTH, CUR_YEAR, 'Test Gara 426', JSON.stringify(config)],
  );
}

// ── UI helper: naviga alla Dashboard Gara Reale e aspetta il caricamento ──
// Aspetta card-kpi-actual visibile (implica pistaStats calcolato e rendering
// completato) + card-workday-info (conferma il layout è pronto).
async function openDashboard(page) {
  await page.goto(`${BASE}/dashboard-gara-reale`, { waitUntil: 'networkidle' });
  await page.getByTestId('card-kpi-actual').waitFor({ state: 'visible', timeout: 30000 });
  await page.getByTestId('card-workday-info').waitFor({ state: 'visible', timeout: 15000 });
}

// ── Test 1: card € Incentivi + ticker 1 pista senza pausa ─────────────────
test('Dashboard Gara: card € Incentivi mostra la somma premi senza riquadro duplicato', async () => {
  const pool = await newPool();
  const session = await signup({ prefix: 'gkpi_1p', fullName: 'Gara KPI 1 Pista' });
  let browser;
  try {
    await setRole(pool, session.profileId, 'admin');
    const POS = uniq('POS');

    // energiaConfig: targetS1=1 → 1 pezzo CONSUMER_NO_SDD raggiunge la soglia.
    // Premio aggregato = premioS1 ?? premio = 200 × pdvInGara (1) = 200 €.
    await insertGaraConfig(pool, session.orgId, {
      pdvList: [{ codicePos: POS, nome: 'Negozio', ragioneSociale: 'RS Srl', abilitaEnergia: true }],
      energiaConfig: {
        pdvInGara: 1,
        targetNoMalus: 0,
        targetS1: 1,
        targetS2: 5,
        targetS3: 10,
        premio: 200,
      },
    });
    // 1 sola vendita energia → 1 sola pista attiva.
    await insertSale(pool, session.orgId, { codicePos: POS, articoli: [artEnergia], cliente: clienteFisica });

    browser = await launchBrowser();
    const context = await newAuthedContext(browser, session);
    const page = await context.newPage();
    await openDashboard(page);

    // Premio atteso dal seed: energiaConfig.premio=200, pdvInGara=1, targetS1=1.
    // Con 1 pezzo CONSUMER_NO_SDD → totalPunti (1) ≥ targetS1 (1) → aggPremio = 200 €.
    const EXPECTED_PREMIO = 200;

    // ── (a) € Incentivi == valore di premio atteso dal seed ───────────────
    // Verifica indipendente sul valore atteso: una regressione che mostrasse
    // il fatturato lordo o zero farebbe fallire il check.
    assert.equal(
      (await page.getByTestId('label-kpi-actual').innerText()).trim(),
      '€ INCENTIVI',
      'la prima KPI deve chiamarsi € Incentivi',
    );
    assert.equal(
      await page.getByTestId('card-premio-totale').count(),
      0,
      'il riquadro Premio di Gara duplicato non deve essere presente',
    );
    const actualText = await page.getByTestId('text-kpi-actual').innerText();
    assert.equal(
      parseEuroText(actualText),
      EXPECTED_PREMIO,
      `text-kpi-actual deve valere ${EXPECTED_PREMIO} € (incentivi gara), trovato: "${actualText}"`,
    );

    // ── (a-bis) ticker-premio-energia coincide con la KPI € Incentivi ─────
    // Il cross-check usa il premio mostrato sulla card pista (stessa riduzione
    // su pistaStats, formattatore formatEuro).
    const tickerPremioCross = await page.getByTestId('ticker-premio-energia').innerText();
    assert.equal(
      parseEuroText(tickerPremioCross),
      EXPECTED_PREMIO,
      `ticker-premio-energia deve valere ${EXPECTED_PREMIO} €, trovato: "${tickerPremioCross}"`,
    );

    // ── (a-proj) text-kpi-actual-proj ≥ premio atteso (proiezione ≥ attuale) ──
    // La proiezione scala il premio per i giorni lavorativi rimanenti.
    // Con 1 pezzo e targetS1=1 la proiezione è sempre ≥ 200 € (stessa soglia).
    const actualProjText = await page.getByTestId('text-kpi-actual-proj').innerText();
    assert.ok(
      parseEuroText(actualProjText) >= EXPECTED_PREMIO,
      `text-kpi-actual-proj deve essere ≥ ${EXPECTED_PREMIO} € (proiezione ≥ attuale), trovato: "${actualProjText}"`,
    );

    // ── (b) Ticker: sezione visibile, energia UNICA riga, altre piste assenti ──
    const ticker = page.getByTestId('section-pista-ticker');
    await ticker.waitFor({ state: 'visible', timeout: 10000 });

    // Solo la pista energia ha attività: deve essere l'unica riga del ticker.
    await page.getByTestId('ticker-pista-energia').waitFor({ state: 'visible', timeout: 10000 });

    // Esattamente 1 riga ticker nel DOM (testid^="ticker-pista-" senza duplicati
    // perché loop=false con 1 sola pista, quindi aria-hidden copies assenti).
    const tickerPisteCount = await page.locator('[data-testid^="ticker-pista-"]').count();
    assert.equal(
      tickerPisteCount, 1,
      `Con 1 pista attiva il ticker deve avere esattamente 1 riga, trovate: ${tickerPisteCount}`,
    );

    // Le piste inattive NON devono comparire nel ticker.
    assert.equal(await page.getByTestId('ticker-pista-mobile').count(), 0,
      'ticker-pista-mobile non deve essere presente con 0 SIM mobile');
    assert.equal(await page.getByTestId('ticker-pista-fisso').count(), 0,
      'ticker-pista-fisso non deve essere presente con 0 contratti fisso');
    assert.equal(await page.getByTestId('ticker-pista-cb').count(), 0,
      'ticker-pista-cb non deve essere presente con 0 CB');

    // ticker-premio-energia: valore numerico = EXPECTED_PREMIO (non 0).
    const tickerPremioText = await page.getByTestId('ticker-premio-energia').innerText();
    assert.equal(
      parseEuroText(tickerPremioText),
      EXPECTED_PREMIO,
      `ticker-premio-energia deve mostrare ${EXPECTED_PREMIO} €, trovato: "${tickerPremioText}"`,
    );

    // ticker-punti-energia: la pista energia usa "punti" = pezzi energia (≥ 1).
    const tickerPuntiEl = page.getByTestId('ticker-punti-energia');
    await tickerPuntiEl.waitFor({ state: 'visible', timeout: 5000 });
    const tickerPuntiText = await tickerPuntiEl.innerText();
    assert.ok(
      parseInt(tickerPuntiText.replace(/\D/g, ''), 10) >= 1,
      `ticker-punti-energia deve essere ≥ 1, trovato: "${tickerPuntiText}"`,
    );

    // Con 1 sola pista attiva → loop=false → btn-ticker-pause NON renderizzato.
    const pauseCount = await page.getByTestId('btn-ticker-pause').count();
    assert.equal(
      pauseCount, 0,
      'Con 1 sola pista attiva btn-ticker-pause non deve essere presente nel DOM',
    );

    await page.close();
    await context.close();
  } finally {
    await browser?.close().catch(() => {});
    await cleanupOrg(pool, session);
    await pool.end().catch(() => {});
  }
});

// ── Test 2: griglia ≥ 3 piste → card cliccabili con pannello dettaglio ────
test('Dashboard Gara: griglia ≥3 piste → click e tastiera aprono/chiudono il pannello dettaglio (aria-expanded)', async () => {
  const pool = await newPool();
  const session = await signup({ prefix: 'gkpi_3p', fullName: 'Gara KPI 3 Piste' });
  let browser;
  try {
    await setRole(pool, session.profileId, 'admin');
    const POS = uniq('POS');

    // Stessa energiaConfig del Test 1.
    await insertGaraConfig(pool, session.orgId, {
      pdvList: [{ codicePos: POS, nome: 'Negozio', ragioneSociale: 'RS Srl', abilitaEnergia: true }],
      energiaConfig: {
        pdvInGara: 1,
        targetNoMalus: 0,
        targetS1: 1,
        targetS2: 5,
        targetS3: 10,
        premio: 200,
      },
    });

    // Vendita 1: energia → pista 'energia' (totalePezzi > 0, premioStimato > 0)
    await insertSale(pool, session.orgId, { codicePos: POS, articoli: [artEnergia], cliente: clienteFisica });
    // Vendita 2: TIED CF + VOCE EASYPAY → pista 'mobile' (totalePezzi > 0 via SIM_CONSUMER_CORE)
    await insertSale(pool, session.orgId, { codicePos: POS, articoli: [artTied], cliente: clientePrivato });
    // Vendita 3: MIA TIED + MIA EASYPAY STANDARD → pista 'cb' (totalePezzi > 0)
    await insertSale(pool, session.orgId, { codicePos: POS, articoli: [artMia], cliente: clientePrivato });

    browser = await launchBrowser();
    const context = await newAuthedContext(browser, session);
    const page = await context.newPage();
    await openDashboard(page);

    // Aspetta il ticker e verifica che siano visibili almeno 3 piste.
    const ticker = page.getByTestId('section-pista-ticker');
    await ticker.waitFor({ state: 'visible', timeout: 20000 });

    await page.waitForFunction(
      () => document.querySelectorAll('[data-testid^="ticker-pista-"]').length >= 3,
      null,
      { timeout: 15000 },
    );

    // Verifica le 3 piste attese: energia, mobile, cb.
    await page.getByTestId('ticker-pista-energia').waitFor({ state: 'visible', timeout: 5000 });
    await page.getByTestId('ticker-pista-mobile').waitFor({ state: 'visible', timeout: 5000 });
    await page.getByTestId('ticker-pista-cb').waitFor({ state: 'visible', timeout: 5000 });

    // Il vecchio pulsante pausa NON deve più esistere (redesign card Shorts).
    assert.equal(
      await page.getByTestId('btn-ticker-pause').count(), 0,
      'btn-ticker-pause non deve più esistere dopo il redesign a card',
    );

    // Stato iniziale: nessun pannello dettaglio aperto, card con aria-expanded=false.
    const energiaCard = page.getByTestId('ticker-pista-energia');
    assert.equal(
      await energiaCard.getAttribute('aria-expanded'), 'false',
      'La card energia deve partire con aria-expanded="false"',
    );
    assert.equal(
      await page.locator('[data-testid^="ticker-detail-"]').count(), 0,
      'Nessun pannello dettaglio deve essere aperto all\'avvio',
    );

    // ── Click → apre il pannello dettaglio della pista ────────────────────
    await energiaCard.click();
    assert.equal(
      await energiaCard.getAttribute('aria-expanded'), 'true',
      'La card energia deve diventare aria-expanded="true" dopo click',
    );
    await page.getByTestId('ticker-detail-energia').waitFor({ state: 'visible', timeout: 5000 });

    // ── Click su un'altra card → il dettaglio passa alla nuova pista ──────
    const mobileCard = page.getByTestId('ticker-pista-mobile');
    await mobileCard.click();
    await page.getByTestId('ticker-detail-mobile').waitFor({ state: 'visible', timeout: 5000 });
    assert.equal(
      await page.getByTestId('ticker-detail-energia').count(), 0,
      'Aprendo mobile il dettaglio energia deve chiudersi (un solo pannello alla volta)',
    );
    assert.equal(
      await energiaCard.getAttribute('aria-expanded'), 'false',
      'La card energia deve tornare aria-expanded="false" quando si apre mobile',
    );

    // ── Tastiera (Enter) sulla card aperta → chiude il pannello ───────────
    await mobileCard.focus();
    await page.keyboard.press('Enter');
    assert.equal(
      await mobileCard.getAttribute('aria-expanded'), 'false',
      'La card mobile deve tornare aria-expanded="false" dopo Enter da tastiera',
    );
    assert.equal(
      await page.locator('[data-testid^="ticker-detail-"]').count(), 0,
      'Dopo Enter nessun pannello dettaglio deve restare aperto',
    );

    await page.close();
    await context.close();
  } finally {
    await browser?.close().catch(() => {});
    await cleanupOrg(pool, session);
    await pool.end().catch(() => {});
  }
});

test('Dashboard Gara: il solo addon Pagamento Annuale mostra 0,5 punti e raggiunge S1/S2', async () => {
  const pool = await newPool();
  const session = await signup({ prefix: 'gkpi_pa', fullName: 'Gara KPI Pagamento Annuale' });
  let browser;
  try {
    await setRole(pool, session.profileId, 'admin');
    const POS = uniq('POS');

    await insertGaraConfig(pool, session.orgId, {
      pdvList: [{
        codicePos: POS,
        nome: 'Negozio',
        ragioneSociale: 'RS Srl',
        abilitaAssicurazioni: true,
      }],
      assicurazioniConfig: {
        pdvInGara: 1,
        targetNoMalus: 0,
        targetS1: 0.5,
        targetS2: 0.5,
        premioS1: 500,
        premioS2: 750,
      },
    });
    await insertSale(pool, session.orgId, {
      codicePos: POS,
      articoli: [artPagamentoAnnualeSolo],
      cliente: clientePrivato,
    });

    browser = await launchBrowser();
    const context = await newAuthedContext(browser, session);
    const page = await context.newPage();
    await openDashboard(page);

    const assicurazioniCard = page.getByTestId('ticker-pista-assicurazioni');
    await assicurazioniCard.waitFor({ state: 'visible', timeout: 10000 });
    assert.equal(
      await page.locator('[data-testid^="ticker-pista-"]').count(),
      1,
      'con il solo Pagamento Annuale deve comparire una sola pista',
    );
    assert.equal(
      flat(await page.getByTestId('ticker-punti-assicurazioni').innerText()),
      '0,5',
      'il Pagamento Annuale deve valere 0,5 punti nel ticker',
    );
    assert.equal(
      parseEuroText(await page.getByTestId('ticker-premio-assicurazioni').innerText()),
      750,
      'raggiungendo S2 deve essere applicato il premio della soglia più alta',
    );
    assert.equal(
      await assicurazioniCard.getByText('S2', { exact: true }).count(),
      1,
      'il mezzo punto deve raggiungere la soglia S2 configurata a 0,5',
    );

    await page.close();
    await context.close();
  } finally {
    await browser?.close().catch(() => {});
    await cleanupOrg(pool, session);
    await pool.end().catch(() => {});
  }
});
