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

// Task #432 – verifica automatica della sezione "Piste in gara" (PistaTicker)
// della Dashboard Gara Reale.
//
// La sezione (post Task #426) è una lista di righe scorrevoli: ogni pista con
// attività genera una riga identificata da `ticker-pista-{p}` con il valore
// punti/pezzi (`ticker-punti-{p}`) e il premio (`ticker-premio-{p}`).
// Le piste a zero attività NON hanno riga. Con ≥3 piste il ticker è
// ciclico e mostra il pulsante pausa/riprendi (`btn-ticker-pause`).
//
// Copre:
//   - la riga ticker-pista-{p} compare per piste con dati e i sub-testids
//     ticker-punti-{p} / ticker-premio-{p} sono presenti;
//   - piste a zero attività non generano righe;
//   - il pulsante pausa compare quando ci sono ≥3 piste attive.

const now = new Date();
const pad = (n) => String(n).padStart(2, '0');
const MONTH = now.getMonth() + 1;
const YEAR = now.getFullYear();
const DATA_VENDITA = `${YEAR}-${pad(MONTH)}-10T10:00:00.000Z`;

// Articolo mobile consumer (TIED CF → categoria interna TIED = SIM_CONSUMER_CORE).
const artMobileTied = {
  categoria: { nome: 'TIED CF' },
  tipologia: { nome: 'VOCE EASYPAY' },
  dettaglio: { canone: '10' },
};

// Articolo fisso consumer (ADSL/FIBRA → FISSO_FTTH).
const artFissoFtth = {
  categoria: { nome: 'ADSL/FIBRA/FWA CF' },
  tipologia: { nome: 'FIBRA FTTH CF' },
  dettaglio: { canone: '25' },
};

// Articolo CB cambio piano (MIA TIED + MIA EASYPAY STANDARD → cb/cambio_offerta_rivincoli).
const artCbMiaTied = {
  categoria: { nome: 'MIA TIED' },
  tipologia: { nome: 'MIA EASYPAY STANDARD' },
  dettaglio: { canone: '12' },
};

async function insertSale(pool, orgId, { codicePos, nomeNegozio, ragioneSociale, articoli, stato = 'FINALIZZATA' }) {
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
      JSON.stringify({ cliente: { clienteTipo: 'PRIVATO' }, articoli }),
    ],
  );
}

// Apre la dashboard e attende che la sezione ticker o la card
// "nessun dato" siano visibili (evita timeout aperti).
async function openDashboard(context) {
  const page = await context.newPage();
  await page.goto(`${BASE}/dashboard-gara-reale`, { waitUntil: 'networkidle', timeout: 45000 });
  await Promise.race([
    page.getByTestId('section-pista-ticker').waitFor({ state: 'visible', timeout: 30000 }),
    page.getByTestId('card-no-gara-config').waitFor({ state: 'visible', timeout: 30000 }),
    page.getByTestId('text-no-data').waitFor({ state: 'visible', timeout: 30000 }),
  ]);
  return page;
}

// ===========================================================================
// SCENARIO 1 – piste con attività → righe nel ticker;
//              piste a zero → nessuna riga.
// ===========================================================================
test('scenario 1: righe ticker compaiono per piste con dati e assenti per zero-attività', async () => {
  const pool = await newPool();
  const session = await signup({ prefix: 'ticker_rows', fullName: 'Ticker Rows Test' });
  let browser;
  try {
    await setRole(pool, session.profileId, 'admin');

    const POS_A = uniq('TKRPOS');
    const RS_A = uniq('TickerRowRs Srl');

    // Gara config standard con un PDV.
    await pool.query(
      `INSERT INTO gara_config (organization_id, month, year, name, config)
       VALUES ($1, $2, $3, $4, $5::jsonb)`,
      [
        session.orgId, MONTH, YEAR, 'Ticker rows test',
        JSON.stringify({
          pdvList: [{ codicePos: POS_A, nome: 'Negozio Ticker', ragioneSociale: RS_A }],
        }),
      ],
    );

    // Semina 3 SIM mobile → pista mobile ha totalePezzi=3 > 0.
    for (let i = 0; i < 3; i++) {
      await insertSale(pool, session.orgId, {
        codicePos: POS_A, nomeNegozio: 'Negozio Ticker', ragioneSociale: RS_A,
        articoli: [artMobileTied],
      });
    }

    browser = await launchBrowser();
    const context = await newAuthedContext(browser, session);
    const page = await openDashboard(context);

    // La sezione ticker deve essere visibile.
    await page.getByTestId('section-pista-ticker').waitFor({ state: 'visible', timeout: 15000 });

    // La riga della pista mobile deve comparire (ha dati).
    const rowMobile = page.getByTestId('ticker-pista-mobile');
    await rowMobile.waitFor({ state: 'visible', timeout: 15000 });

    // I sub-testids punti e premio devono esistere nella riga.
    await page.getByTestId('ticker-punti-mobile').waitFor({ state: 'visible', timeout: 10000 });
    await page.getByTestId('ticker-premio-mobile').waitFor({ state: 'visible', timeout: 10000 });

    // Il valore punti/pezzi deve essere numerico e > 0.
    const puntiTxt = (await page.getByTestId('ticker-punti-mobile').innerText()).trim();
    const puntiVal = Number(puntiTxt.replace(/[^\d,.-]/g, '').replace(',', '.'));
    assert.ok(puntiVal > 0, `ticker-punti-mobile deve essere > 0 (trovato "${puntiTxt}")`);

    // Piste senza dati NON devono avere righe nel ticker.
    assert.equal(
      await page.getByTestId('ticker-pista-energia').count(),
      0,
      'ticker-pista-energia non deve esistere (zero attività)',
    );
    assert.equal(
      await page.getByTestId('ticker-pista-assicurazioni').count(),
      0,
      'ticker-pista-assicurazioni non deve esistere (zero attività)',
    );

    // Con solo 1 pista il ticker non è ciclico → nessun pulsante pausa.
    assert.equal(
      await page.getByTestId('btn-ticker-pause').count(),
      0,
      'btn-ticker-pause non deve esistere con meno di 3 piste',
    );

    await page.close();
    await context.close();
  } finally {
    if (browser) await browser.close().catch(() => {});
    await cleanupOrg(pool, session);
    await pool.end().catch(() => {});
  }
});

// ===========================================================================
// SCENARIO 2 – ≥3 piste attive → ticker ciclico con pulsante pausa.
// ===========================================================================
test('scenario 2: pulsante pausa presente quando ≥3 piste hanno dati', async () => {
  const pool = await newPool();
  const session = await signup({ prefix: 'ticker_pause', fullName: 'Ticker Pause Test' });
  let browser;
  try {
    await setRole(pool, session.profileId, 'admin');

    const POS_A = uniq('TKPPOS');
    const RS_A = uniq('TickerPauseRs Srl');

    // Gara config con il PDV.
    await pool.query(
      `INSERT INTO gara_config (organization_id, month, year, name, config)
       VALUES ($1, $2, $3, $4, $5::jsonb)`,
      [
        session.orgId, MONTH, YEAR, 'Ticker pause test',
        JSON.stringify({
          pdvList: [{ codicePos: POS_A, nome: 'Negozio Pause', ragioneSociale: RS_A }],
        }),
      ],
    );

    // Semina dati per 3 piste diverse (mobile, fisso, cb) in modo che
    // items.length >= 3 e il ticker attivi la modalità ciclica.
    for (let i = 0; i < 2; i++) {
      await insertSale(pool, session.orgId, {
        codicePos: POS_A, nomeNegozio: 'Negozio Pause', ragioneSociale: RS_A,
        articoli: [artMobileTied],
      });
      await insertSale(pool, session.orgId, {
        codicePos: POS_A, nomeNegozio: 'Negozio Pause', ragioneSociale: RS_A,
        articoli: [artFissoFtth],
      });
      await insertSale(pool, session.orgId, {
        codicePos: POS_A, nomeNegozio: 'Negozio Pause', ragioneSociale: RS_A,
        articoli: [artCbMiaTied],
      });
    }

    browser = await launchBrowser();
    const context = await newAuthedContext(browser, session);
    const page = await openDashboard(context);

    await page.getByTestId('section-pista-ticker').waitFor({ state: 'visible', timeout: 15000 });

    // Tutte e 3 le piste con dati devono avere una riga nel ticker.
    await page.getByTestId('ticker-pista-mobile').waitFor({ state: 'visible', timeout: 15000 });
    await page.getByTestId('ticker-pista-fisso').waitFor({ state: 'visible', timeout: 15000 });
    await page.getByTestId('ticker-pista-cb').waitFor({ state: 'visible', timeout: 15000 });

    // Con ≥3 piste il ticker entra in modalità ciclica: il pulsante pausa
    // deve essere presente e funzionante.
    const pauseBtn = page.getByTestId('btn-ticker-pause');
    await pauseBtn.waitFor({ state: 'visible', timeout: 10000 });
    assert.ok(await pauseBtn.isVisible(), 'btn-ticker-pause deve essere visibile con 3 piste');

    // Click sul pausa: aria-pressed deve diventare "true".
    await pauseBtn.click();
    const pressedAfter = await pauseBtn.getAttribute('aria-pressed');
    assert.equal(pressedAfter, 'true', 'aria-pressed deve essere "true" dopo il click pausa');

    // Secondo click: riprende (aria-pressed torna "false").
    await pauseBtn.click();
    const pressedResumed = await pauseBtn.getAttribute('aria-pressed');
    assert.equal(pressedResumed, 'false', 'aria-pressed deve essere "false" dopo il click riprendi');

    await page.close();
    await context.close();
  } finally {
    if (browser) await browser.close().catch(() => {});
    await cleanupOrg(pool, session);
    await pool.end().catch(() => {});
  }
});
