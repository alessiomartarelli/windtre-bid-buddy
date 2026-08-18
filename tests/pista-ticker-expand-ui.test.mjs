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

// Task #432/#433/#434 – verifica automatica della sezione "Piste in gara"
// (PistaTicker) della Dashboard Gara Reale.
//
// La sezione è una griglia di card "Shorts" (grid-cols-2 sm:grid-cols-3
// xl:grid-cols-4, card aspect-[9/14]): ogni pista con attività genera una
// card `ticker-pista-{p}` con il valore punti/pezzi (`ticker-punti-{p}`) e
// il premio (`ticker-premio-{p}`). Le piste a zero attività NON hanno card.
// Il click su una card apre il pannello dettaglio `ticker-detail-{p}` sotto
// la griglia; senza breakdown per RS il pannello mostra un unico blocco
// `ticker-detail-rs-{p}-totale`. Un secondo click chiude il pannello.
//
// Copre:
//   - la card ticker-pista-{p} compare per piste con dati e i sub-testids
//     ticker-punti-{p} / ticker-premio-{p} sono presenti;
//   - piste a zero attività non generano card;
//   - card per ogni pista attiva; click apre ticker-detail-{p} con blocco
//     "totale"; secondo click chiude; nessun btn-ticker-pause (layout Shorts);
//   - (Task #434) stesso comportamento su viewport mobile 375×812;
//   - (Task #433) premio non-zero, soglia raggiunta e badge proiezione con
//     soglie note, per intercettare regressioni che azzerano i calcoli.

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

// Semina una gara config standard con un solo PDV e 3 SIM mobile,
// così la pista mobile ha totalePezzi=3 > 0 e genera una card.
async function seedMobilePista(pool, session, { posPrefix, rsPrefix, negozio, garaName }) {
  const POS = uniq(posPrefix);
  const RS = uniq(rsPrefix);
  await pool.query(
    `INSERT INTO gara_config (organization_id, month, year, name, config)
     VALUES ($1, $2, $3, $4, $5::jsonb)`,
    [
      session.orgId, MONTH, YEAR, garaName,
      JSON.stringify({
        pdvList: [{ codicePos: POS, nome: negozio, ragioneSociale: RS }],
      }),
    ],
  );
  for (let i = 0; i < 3; i++) {
    await insertSale(pool, session.orgId, {
      codicePos: POS, nomeNegozio: negozio, ragioneSociale: RS,
      articoli: [artMobileTied],
    });
  }
  return { POS, RS };
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

// ---------------------------------------------------------------------------
// SCENARIO 1 – piste con attività → card nel ticker;
//              piste a zero → nessuna card.
// ---------------------------------------------------------------------------
test('scenario 1: card ticker compaiono per piste con dati e assenti per zero-attività', async () => {
  const pool = await newPool();
  const session = await signup({ prefix: 'ticker_rows', fullName: 'Ticker Rows Test' });
  let browser;
  try {
    await setRole(pool, session.profileId, 'admin');
    await seedMobilePista(pool, session, {
      posPrefix: 'TKRPOS', rsPrefix: 'TickerRowRs Srl',
      negozio: 'Negozio Ticker', garaName: 'Ticker rows test',
    });

    browser = await launchBrowser();
    const context = await newAuthedContext(browser, session);
    const page = await openDashboard(context);

    // La sezione ticker deve essere visibile.
    await page.getByTestId('section-pista-ticker').waitFor({ state: 'visible', timeout: 15000 });

    // La card della pista mobile deve comparire (ha dati).
    await page.getByTestId('ticker-pista-mobile').waitFor({ state: 'visible', timeout: 15000 });

    // I sub-testids punti e premio devono esistere nella card.
    await page.getByTestId('ticker-punti-mobile').waitFor({ state: 'visible', timeout: 10000 });
    await page.getByTestId('ticker-premio-mobile').waitFor({ state: 'visible', timeout: 10000 });

    // Il valore punti/pezzi deve essere numerico e > 0.
    const puntiTxt = (await page.getByTestId('ticker-punti-mobile').innerText()).trim();
    const puntiVal = Number(puntiTxt.replace(/[^\d,.-]/g, '').replace(',', '.'));
    assert.ok(puntiVal > 0, `ticker-punti-mobile deve essere > 0 (trovato "${puntiTxt}")`);

    // Piste senza dati NON devono avere card nel ticker.
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

    await page.close();
    await context.close();
  } finally {
    if (browser) await browser.close().catch(() => {});
    await cleanupOrg(pool, session);
    await pool.end().catch(() => {});
  }
});

// ---------------------------------------------------------------------------
// SCENARIO 2 – ≥3 piste attive → una card per pista nella griglia Shorts;
// click su una card apre il pannello dettaglio con blocco "totale",
// secondo click lo richiude.
// (La modalità ciclica con btn-ticker-pause è stata rimossa dal layout
// Shorts: le card sono tutte visibili in griglia.)
// ---------------------------------------------------------------------------
test('scenario 2: card per ogni pista attiva ed espansione/chiusura del dettaglio', async () => {
  const pool = await newPool();
  const session = await signup({ prefix: 'ticker_expand', fullName: 'Ticker Expand Test' });
  let browser;
  try {
    await setRole(pool, session.profileId, 'admin');

    const POS_A = uniq('TKEPOS');
    const RS_A = uniq('TickerExpRs Srl');

    // Gara config con il PDV.
    await pool.query(
      `INSERT INTO gara_config (organization_id, month, year, name, config)
       VALUES ($1, $2, $3, $4, $5::jsonb)`,
      [
        session.orgId, MONTH, YEAR, 'Ticker expand test',
        JSON.stringify({
          pdvList: [{ codicePos: POS_A, nome: 'Negozio Expand', ragioneSociale: RS_A }],
        }),
      ],
    );

    // Semina dati per 3 piste diverse (mobile, fisso, cb): ogni pista con
    // attività deve generare la propria card nella griglia.
    for (let i = 0; i < 2; i++) {
      await insertSale(pool, session.orgId, {
        codicePos: POS_A, nomeNegozio: 'Negozio Expand', ragioneSociale: RS_A,
        articoli: [artMobileTied],
      });
      await insertSale(pool, session.orgId, {
        codicePos: POS_A, nomeNegozio: 'Negozio Expand', ragioneSociale: RS_A,
        articoli: [artFissoFtth],
      });
      await insertSale(pool, session.orgId, {
        codicePos: POS_A, nomeNegozio: 'Negozio Expand', ragioneSociale: RS_A,
        articoli: [artCbMiaTied],
      });
    }

    browser = await launchBrowser();
    const context = await newAuthedContext(browser, session);
    const page = await openDashboard(context);

    // Tutte e 3 le piste con dati devono avere una card nella griglia.
    const cardMobile = page.getByTestId('ticker-pista-mobile');
    await cardMobile.waitFor({ state: 'visible', timeout: 15000 });
    await page.getByTestId('ticker-pista-fisso').waitFor({ state: 'visible', timeout: 15000 });
    await page.getByTestId('ticker-pista-cb').waitFor({ state: 'visible', timeout: 15000 });

    // Il layout Shorts non ha più il pulsante pausa: non deve esistere.
    assert.equal(
      await page.getByTestId('btn-ticker-pause').count(),
      0,
      'btn-ticker-pause non deve esistere nel layout Shorts',
    );

    // Prima del click: nessun pannello dettaglio.
    assert.equal(
      await page.getByTestId('ticker-detail-mobile').count(),
      0,
      'ticker-detail-mobile non deve esistere prima del click',
    );

    // Click → pannello dettaglio aperto con blocco "totale" (gara standard,
    // nessun breakdown per RS) e aria-expanded=true.
    await cardMobile.click();
    await page.getByTestId('ticker-detail-mobile').waitFor({ state: 'visible', timeout: 10000 });
    await page.getByTestId('ticker-detail-rs-mobile-totale').waitFor({ state: 'visible', timeout: 10000 });
    assert.equal(
      await cardMobile.getAttribute('aria-expanded'),
      'true',
      'aria-expanded deve essere "true" a pannello aperto',
    );

    // Secondo click → pannello chiuso.
    await cardMobile.click();
    await page.getByTestId('ticker-detail-mobile').waitFor({ state: 'detached', timeout: 10000 });
    assert.equal(
      await cardMobile.getAttribute('aria-expanded'),
      'false',
      'aria-expanded deve tornare "false" dopo la chiusura',
    );

    await page.close();
    await context.close();
  } finally {
    if (browser) await browser.close().catch(() => {});
    await cleanupOrg(pool, session);
    await pool.end().catch(() => {});
  }
});

// ---------------------------------------------------------------------------
// SCENARIO 3 (Task #434) – layout Shorts su viewport mobile (375×812):
//              la card è visibile e cliccabile, il pannello dettaglio
//              compare sotto la griglia e non è clippato/invisibile.
// ---------------------------------------------------------------------------
test('scenario 3: card e dettaglio funzionano su viewport mobile 375×812', async () => {
  const pool = await newPool();
  const session = await signup({ prefix: 'ticker_mobilevp', fullName: 'Ticker MobileVP Test' });
  let browser;
  try {
    await setRole(pool, session.profileId, 'admin');
    await seedMobilePista(pool, session, {
      posPrefix: 'TKMPOS', rsPrefix: 'TickerMobRs Srl',
      negozio: 'Negozio MobileVP', garaName: 'Ticker mobile viewport test',
    });

    browser = await launchBrowser();
    // Context mobile: viewport 375×812 + touch + isMobile.
    const context = await newAuthedContext(browser, session, { mobile: true });
    const page = await openDashboard(context);

    await page.getByTestId('section-pista-ticker').waitFor({ state: 'visible', timeout: 15000 });

    // La card mobile deve essere visibile anche a 375px di larghezza.
    const cardMobile = page.getByTestId('ticker-pista-mobile');
    await cardMobile.waitFor({ state: 'visible', timeout: 15000 });

    // La card deve stare dentro il viewport in larghezza (grid-cols-2 a 375px).
    const box = await cardMobile.boundingBox();
    assert.ok(box, 'bounding box della card mobile deve esistere');
    assert.ok(box.width > 0 && box.width <= 375, `card larga ${box.width}px, deve stare in 375px`);

    // Click sulla card (tap su device mobile) → pannello dettaglio visibile.
    await cardMobile.click();
    await page.getByTestId('ticker-detail-mobile').waitFor({ state: 'visible', timeout: 10000 });
    await page.getByTestId('ticker-detail-rs-mobile-totale').waitFor({ state: 'visible', timeout: 10000 });

    // Il pannello deve essere realmente visibile (non clippato a 0px).
    const detailBox = await page.getByTestId('ticker-detail-mobile').boundingBox();
    assert.ok(detailBox, 'bounding box del pannello dettaglio deve esistere');
    assert.ok(detailBox.width > 0 && detailBox.height > 0, 'il pannello dettaglio non deve essere clippato');

    await page.close();
    await context.close();
  } finally {
    if (browser) await browser.close().catch(() => {});
    await cleanupOrg(pool, session);
    await pool.end().catch(() => {});
  }
});

// ---------------------------------------------------------------------------
// SCENARIO 4 (Task #433) – valori premio/soglia dentro la card e nel
// dettaglio espanso: con soglie note (soglia1 = 3 punti) e 4 SIM TIED
// (0,75 punti l'una → 3 punti) la pista mobile deve mostrare:
//   - ticker-premio-mobile con un valore € > 0;
//   - nel blocco dettaglio una soglia raggiunta (badge "S1", non "—");
//   - il badge proiezione ticker-premio-proj-mobile quando la proiezione
//     fine mese supera l'attuale (sempre, tranne l'ultimo giorno del mese).
// Se una regressione azzera premio/soglia, questi assert falliscono invece
// di lasciare sparire silenziosamente la card.
// ---------------------------------------------------------------------------
test('scenario 4: premio non-zero, soglia raggiunta e badge proiezione con soglie note', async () => {
  const pool = await newPool();
  const session = await signup({ prefix: 'ticker_premio', fullName: 'Ticker Premio Test' });
  let browser;
  try {
    await setRole(pool, session.profileId, 'admin');

    const POS_A = uniq('TKVPOS');
    const RS_A = uniq('TickerPremioRs Srl');

    // Calendario 7/7: elapsedWorkingDays = giorno del mese,
    // totalWorkingDays = giorni del mese → ratio proiezione deterministico.
    const calendar = {
      weeklySchedule: { workingDays: [0, 1, 2, 3, 4, 5, 6] },
      specialDays: [],
    };

    // Gara config con soglie mobile note: soglia1 = 3 punti (raggiunta con
    // 4 TIED × 0,75 punti), soglie superiori irraggiungibili.
    await pool.query(
      `INSERT INTO gara_config (organization_id, month, year, name, config)
       VALUES ($1, $2, $3, $4, $5::jsonb)`,
      [
        session.orgId, MONTH, YEAR, 'Ticker premio test',
        JSON.stringify({
          pdvList: [{ codicePos: POS_A, nome: 'Negozio Premio', ragioneSociale: RS_A, calendar }],
          pistaMobileConfig: {
            sogliePerPos: [{
              posCode: POS_A,
              soglia1: 3, soglia2: 100, soglia3: 200, soglia4: 300,
              multiplierSoglia1: 1, multiplierSoglia2: 1.2,
              multiplierSoglia3: 1.5, multiplierSoglia4: 2,
              canoneMedio: 10,
            }],
          },
        }),
      ],
    );

    // 4 SIM TIED → 3 punti = soglia1; premio > 0 (gettone TIED 5€/pezzo
    // + moltiplicatore canone alla soglia raggiunta).
    for (let i = 0; i < 4; i++) {
      await insertSale(pool, session.orgId, {
        codicePos: POS_A, nomeNegozio: 'Negozio Premio', ragioneSociale: RS_A,
        articoli: [artMobileTied],
      });
    }

    browser = await launchBrowser();
    const context = await newAuthedContext(browser, session);
    const page = await openDashboard(context);

    await page.getByTestId('section-pista-ticker').waitFor({ state: 'visible', timeout: 15000 });
    const rowMobile = page.getByTestId('ticker-pista-mobile');
    await rowMobile.waitFor({ state: 'visible', timeout: 15000 });

    // --- Premio attuale non-zero sulla card ---
    const premioTxt = (await page.getByTestId('ticker-premio-mobile').innerText()).trim();
    const premioVal = Number(premioTxt.replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.'));
    assert.ok(
      Number.isFinite(premioVal) && premioVal > 0,
      `ticker-premio-mobile deve mostrare un € > 0 (trovato "${premioTxt}")`,
    );

    // --- Badge proiezione: presente quando la proiezione supera l'attuale.
    // Ratio = giorniMese/giornoOdierno (calendario 7/7): > 1 tranne
    // l'ultimo giorno del mese, dove la proiezione coincide con l'attuale.
    const today = new Date();
    const daysInMonth = new Date(YEAR, MONTH, 0).getDate();
    const isLastDay = today.getDate() >= daysInMonth;
    if (!isLastDay) {
      const projLoc = page.getByTestId('ticker-premio-proj-mobile');
      await projLoc.waitFor({ state: 'visible', timeout: 10000 });
      const projTxt = (await projLoc.innerText()).trim();
      const projVal = Number(projTxt.replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.'));
      assert.ok(
        Number.isFinite(projVal) && projVal > 0,
        `ticker-premio-proj-mobile deve mostrare un € > 0 (trovato "${projTxt}")`,
      );
      assert.ok(
        projVal >= premioVal,
        `proiezione (${projVal}) attesa >= attuale (${premioVal})`,
      );
    } else {
      // Ultimo giorno del mese: proiezione == attuale → il badge può
      // legittimamente non comparire; niente assert sulla proiezione.
      console.log('[scenario 4] ultimo giorno del mese: skip assert badge proiezione');
    }

    // --- Dettaglio espanso: soglia raggiunta (non "—") ---
    await rowMobile.click();
    const detail = page.getByTestId('ticker-detail-mobile');
    await detail.waitFor({ state: 'visible', timeout: 10000 });

    const totBlock = page.getByTestId('ticker-detail-rs-mobile-totale');
    await totBlock.waitFor({ state: 'visible', timeout: 10000 });
    const blockTxt = (await totBlock.innerText()).replace(/\s+/g, ' ');

    // La soglia attuale deve essere una soglia reale (S1) e non "—".
    assert.match(
      blockTxt,
      /S1/,
      `il blocco dettaglio deve mostrare la soglia raggiunta S1 (trovato: "${blockTxt}")`,
    );

    // Nessun badge soglia deve essere il placeholder "—": con soglia1=3
    // raggiunta, sia l'attuale sia la proiezione mostrano una soglia reale.
    assert.ok(
      !blockTxt.includes('—'),
      `nessun badge soglia deve essere "—" nel dettaglio (trovato: "${blockTxt}")`,
    );

    await page.close();
    await context.close();
  } finally {
    if (browser) await browser.close().catch(() => {});
    await cleanupOrg(pool, session);
    await pool.end().catch(() => {});
  }
});
