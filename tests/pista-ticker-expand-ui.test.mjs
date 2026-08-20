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
// La sezione è una griglia di card "Shorts" (grid-cols-1 sm:grid-cols-3
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
//   - (Task #434/#447) stesso comportamento su viewport mobile 375×812,
//     con card a tutta larghezza in una sola colonna anche con più piste;
//   - (Task #433) premio non-zero, soglia raggiunta e badge proiezione con
//     soglie note, per intercettare regressioni che azzerano i calcoli;
//   - (Task #436) stesse verifiche valore per la pista FISSO, che usa un
//     percorso di calcolo diverso (calcolaPremioPistaFissoPerPos, gettoni
//     contrattuali, soglie a 5 livelli) e può regredire a zero da sola.
//   - (Task #440) le card restano data-first: nessuna immagine o background
//     URL; traiettoria attuale→proiezione visibile e separata dai KPI in tema
//     chiaro/scuro, desktop e mobile.

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

const artExtraGaraWorld = {
  categoria: { nome: 'TIED IVA' },
  tipologia: { nome: 'VOCE IVA' },
  descrizione: 'PROFESSIONAL WORLD',
  dettaglio: { canone: '15' },
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
        pistaMobileConfig: {
          sogliePerPos: [{
            posCode: POS,
            soglia1: 3, soglia2: 100, soglia3: 200, soglia4: 300,
            multiplierSoglia1: 1, multiplierSoglia2: 1.2,
            multiplierSoglia3: 1.5, multiplierSoglia4: 2,
          }],
        },
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

async function assertDataFirstTickerCard(page, { theme, viewport }) {
  const card = page.getByTestId('ticker-pista-mobile');
  const trajectory = page.getByTestId('ticker-trajectory-mobile');
  const trajectoryLabels = page.getByTestId('ticker-trajectory-labels-mobile');
  const track = page.getByTestId('ticker-trajectory-track-mobile');
  const trajectoryReadout = page.getByTestId('ticker-trajectory-readout-mobile');
  const kpis = page.getByTestId('ticker-kpis-mobile');

  await card.waitFor({ state: 'visible', timeout: 15000 });
  await trajectory.waitFor({ state: 'visible', timeout: 10000 });
  await trajectoryLabels.waitFor({ state: 'visible', timeout: 10000 });
  await track.waitFor({ state: 'visible', timeout: 10000 });
  await trajectoryReadout.waitFor({ state: 'visible', timeout: 10000 });
  await kpis.waitFor({ state: 'visible', timeout: 10000 });

  const visual = await card.evaluate((element) => {
    const allElements = [element, ...element.querySelectorAll('*')];
    const thresholdTick = element.querySelector('.pista-threshold-tick > span');
    return {
      imageCount: element.querySelectorAll('img').length,
      illustrationIconCount: element.querySelectorAll('.pista-illustration__icon').length,
      urlBackgrounds: allElements
        .map((node) => getComputedStyle(node).backgroundImage)
        .filter((backgroundImage) => backgroundImage.includes('url(')),
      cardBackground: getComputedStyle(element).backgroundImage,
      illustrationBackground: getComputedStyle(element.querySelector('.pista-illustration')).backgroundImage,
      pistaGlow: getComputedStyle(element).getPropertyValue('--pista-glow').trim(),
      trajectoryBackground: getComputedStyle(element.querySelector('[data-testid="ticker-trajectory-mobile"]')).backgroundImage,
      track: getComputedStyle(element.querySelector('[data-testid="ticker-trajectory-track-mobile"]')).backgroundColor,
      kpisBackground: getComputedStyle(element.querySelector('[data-testid="ticker-kpis-mobile"]')).backgroundImage,
      thresholdTickBackground: thresholdTick ? getComputedStyle(thresholdTick).backgroundColor : '',
      thresholdTickBorder: thresholdTick ? getComputedStyle(thresholdTick).borderColor : '',
      thresholdTickHeight: thresholdTick ? thresholdTick.getBoundingClientRect().height : 0,
    };
  });
  assert.equal(visual.imageCount, 0, `${theme}/${viewport}: la card non deve contenere immagini`);
  assert.equal(visual.illustrationIconCount, 1, `${theme}/${viewport}: la card deve mantenere una sola icona vettoriale di pista`);
  assert.deepEqual(visual.urlBackgrounds, [], `${theme}/${viewport}: nessuno sfondo della card deve usare url(...)`);
  assert.ok(
    (visual.cardBackground.match(/gradient/gi) ?? []).length >= 3,
    `${theme}/${viewport}: il fondale deve usare un gradiente moderno multilivello`,
  );
  assert.ok(
    (visual.illustrationBackground.match(/gradient/gi) ?? []).length >= 3,
    `${theme}/${viewport}: l'illustrazione deve mantenere profondità cromatica multilivello`,
  );
  assert.notEqual(visual.pistaGlow, '', `${theme}/${viewport}: la pista deve avere un secondo tono cromatico dedicato`);
  assert.notEqual(visual.trajectoryBackground, 'none', `${theme}/${viewport}: la traiettoria deve avere una superficie di contrasto dedicata`);
  assert.notEqual(visual.track, 'rgba(0, 0, 0, 0)', `${theme}/${viewport}: la traccia deve restare visibile`);
  assert.notEqual(visual.kpisBackground, 'none', `${theme}/${viewport}: i KPI devono avere una superficie di contrasto dedicata`);
  assert.notEqual(visual.thresholdTickBackground, 'rgba(0, 0, 0, 0)', `${theme}/${viewport}: le stanghette soglia devono avere un riempimento visibile`);
  assert.notEqual(visual.thresholdTickBorder, visual.thresholdTickBackground, `${theme}/${viewport}: le stanghette soglia devono avere un bordo di contrasto`);
  assert.ok(visual.thresholdTickHeight >= 12, `${theme}/${viewport}: le stanghette soglia devono essere chiaramente visibili`);

  assert.match(await trajectoryLabels.innerText(), /Soglia attuale/i, `${theme}/${viewport}: l'etichetta Soglia attuale deve essere visibile`);
  assert.match(await trajectoryLabels.innerText(), /Soglia proiezione/i, `${theme}/${viewport}: l'etichetta Soglia proiezione deve essere visibile`);
  assert.match(
    await page.getByTestId('ticker-soglia-attuale-mobile').innerText(),
    /^(Non raggiunta|S[1-4])$/,
    `${theme}/${viewport}: lo stato attuale deve essere una soglia o un fallback esplicito`,
  );
  assert.match(
    await page.getByTestId('ticker-soglia-proiezione-mobile').innerText(),
    /^(Non raggiunta|S[1-4])$/,
    `${theme}/${viewport}: lo stato proiettato deve essere una soglia o un fallback esplicito`,
  );
  assert.equal(await card.locator('.pista-card-threshold').count(), 0, `${theme}/${viewport}: il vecchio badge soglia in intestazione deve essere rimosso`);
  assert.match(await trajectoryReadout.innerText(), /Avanzamento/i, `${theme}/${viewport}: la percentuale deve avere un'etichetta leggibile`);

  const [cardBox, trajectoryBox, labelsBox, trackBox, readoutBox, kpiBox] = await Promise.all([
    card.boundingBox(),
    trajectory.boundingBox(),
    trajectoryLabels.boundingBox(),
    track.boundingBox(),
    trajectoryReadout.boundingBox(),
    kpis.boundingBox(),
  ]);
  assert.ok(cardBox && trajectoryBox && labelsBox && trackBox && readoutBox && kpiBox, `${theme}/${viewport}: i box della card devono esistere`);
  assert.ok(trackBox.width > 0 && trackBox.height > 0, `${theme}/${viewport}: la traiettoria deve avere dimensioni visibili`);
  assert.ok(
    trajectoryBox.y >= cardBox.y && trajectoryBox.y + trajectoryBox.height <= cardBox.y + cardBox.height,
    `${theme}/${viewport}: la traiettoria deve restare dentro la card`,
  );
  assert.ok(
    trajectoryBox.y + trajectoryBox.height <= kpiBox.y,
    `${theme}/${viewport}: la traiettoria non deve sovrapporsi ai KPI`,
  );
  assert.ok(
    labelsBox.y >= trajectoryBox.y && labelsBox.y + labelsBox.height <= trackBox.y,
    `${theme}/${viewport}: Attuale e Proiezione devono restare sopra la barra senza essere tagliati`,
  );
  assert.ok(
    readoutBox.y >= trackBox.y + trackBox.height && readoutBox.y + readoutBox.height <= trajectoryBox.y + trajectoryBox.height,
    `${theme}/${viewport}: la percentuale deve restare sotto la barra e dentro la superficie`,
  );
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
    const toggleMobile = page.getByTestId('ticker-toggle-mobile');
    await cardMobile.waitFor({ state: 'visible', timeout: 15000 });
    await page.getByTestId('ticker-pista-fisso').waitFor({ state: 'visible', timeout: 15000 });
    await page.getByTestId('ticker-pista-cb').waitFor({ state: 'visible', timeout: 15000 });
    assert.equal(
      (await page.getByTestId('ticker-soglia-attuale-cb').innerText()).trim(),
      'Non prevista',
      'Customer Base non deve inventare una soglia attuale',
    );
    assert.equal(
      (await page.getByTestId('ticker-soglia-proiezione-cb').innerText()).trim(),
      'Non prevista',
      'Customer Base non deve inventare una soglia proiettata',
    );
    assert.equal(
      await page.locator('[data-testid^="ticker-threshold-cb-"]').count(),
      0,
      'Customer Base non deve mostrare marker senza un modello soglia condiviso',
    );

    const visualIdentities = await Promise.all(
      ['mobile', 'fisso', 'cb'].map((pista) => page.getByTestId(`ticker-pista-${pista}`).evaluate((element) => ({
        ink: getComputedStyle(element).getPropertyValue('--pista-ink').trim(),
        glow: getComputedStyle(element).getPropertyValue('--pista-glow').trim(),
      }))),
    );
    assert.equal(
      new Set(visualIdentities.map(({ ink, glow }) => `${ink}|${glow}`)).size,
      3,
      'mobile, fisso e customer base devono mantenere identità sfumate cromaticamente distinte',
    );

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
      await toggleMobile.getAttribute('aria-expanded'),
      'true',
      'il controllo della card deve avere aria-expanded="true" a pannello aperto',
    );

    // Secondo click → pannello chiuso.
    await cardMobile.click();
    await page.getByTestId('ticker-detail-mobile').waitFor({ state: 'detached', timeout: 10000 });
    assert.equal(
      await toggleMobile.getAttribute('aria-expanded'),
      'false',
      'il controllo della card deve tornare aria-expanded="false" dopo la chiusura',
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
// SCENARIO 3 (Task #434/#447) – layout Shorts su viewport mobile (375×812):
//              tre piste attive sono impilate in una colonna a tutta
//              larghezza; card, tooltip e pannello dettaglio restano
//              visibili e cliccabili.
// ---------------------------------------------------------------------------
test('scenario 3: piste impilate e dettaglio funzionante su viewport mobile 375×812', async () => {
  const pool = await newPool();
  const session = await signup({ prefix: 'ticker_mobilevp', fullName: 'Ticker MobileVP Test' });
  let browser;
  try {
    await setRole(pool, session.profileId, 'admin');
    const POS = uniq('TKMPOS');
    const RS = uniq('TickerMobRs Srl');
    await pool.query(
      `INSERT INTO gara_config (organization_id, month, year, name, config)
       VALUES ($1, $2, $3, $4, $5::jsonb)`,
      [
        session.orgId, MONTH, YEAR, 'Ticker mobile viewport test',
        JSON.stringify({
          pdvList: [{ codicePos: POS, nome: 'Negozio MobileVP', ragioneSociale: RS }],
          pistaMobileConfig: {
            sogliePerPos: [{
              posCode: POS,
              soglia1: 3, soglia2: 100, soglia3: 200, soglia4: 300,
              multiplierSoglia1: 1, multiplierSoglia2: 1.2,
              multiplierSoglia3: 1.5, multiplierSoglia4: 2,
            }],
          },
        }),
      ],
    );
    for (let i = 0; i < 3; i++) {
      await insertSale(pool, session.orgId, {
        codicePos: POS, nomeNegozio: 'Negozio MobileVP', ragioneSociale: RS,
        articoli: [artMobileTied],
      });
      await insertSale(pool, session.orgId, {
        codicePos: POS, nomeNegozio: 'Negozio MobileVP', ragioneSociale: RS,
        articoli: [artFissoFtth],
      });
      await insertSale(pool, session.orgId, {
        codicePos: POS, nomeNegozio: 'Negozio MobileVP', ragioneSociale: RS,
        articoli: [artCbMiaTied],
      });
    }

    browser = await launchBrowser();
    // Context mobile: viewport 375×812 + touch + isMobile.
    const context = await newAuthedContext(browser, session, { mobile: true });
    const page = await openDashboard(context);

    await page.getByTestId('section-pista-ticker').waitFor({ state: 'visible', timeout: 15000 });

    // La card mobile deve essere visibile anche a 375px di larghezza.
    const cardMobile = page.getByTestId('ticker-pista-mobile');
    const toggleMobile = page.getByTestId('ticker-toggle-mobile');
    await cardMobile.waitFor({ state: 'visible', timeout: 15000 });
    await page.getByTestId('ticker-pista-fisso').waitFor({ state: 'visible', timeout: 15000 });
    await page.getByTestId('ticker-pista-cb').waitFor({ state: 'visible', timeout: 15000 });

    // Sotto sm la griglia deve avere UNA SOLA colonna: le tre card hanno la
    // stessa x, quasi tutta la larghezza disponibile e occupano righe diverse.
    const cardBoxes = await Promise.all(
      ['mobile', 'fisso', 'cb'].map((pista) => page.getByTestId(`ticker-pista-${pista}`).boundingBox()),
    );
    assert.ok(cardBoxes.every(Boolean), 'tutte le card mobile devono avere un bounding box');
    const boxes = cardBoxes;
    const [mobileBox] = boxes;
    assert.ok(
      mobileBox.width > 300 && mobileBox.width <= 375,
      `la card mobile deve usare tutta la riga disponibile, trovati ${mobileBox.width}px`,
    );
    assert.ok(
      boxes.every((box) => Math.abs(box.x - mobileBox.x) < 1 && Math.abs(box.width - mobileBox.width) < 1),
      'le card devono condividere la stessa colonna a tutta larghezza sul viewport mobile',
    );
    const stackedBoxes = [...boxes].sort((a, b) => a.y - b.y);
    assert.ok(
      stackedBoxes.every((box, index) => index === 0 || box.y >= stackedBoxes[index - 1].y + stackedBoxes[index - 1].height),
      'le card devono essere impilate verticalmente senza affiancamenti o sovrapposizioni',
    );
    const mobileGridTemplate = await cardMobile.evaluate(
      (element) => getComputedStyle(element.parentElement).gridTemplateColumns,
    );
    assert.equal(
      mobileGridTemplate.trim().split(/\s+/).length,
      1,
      `la griglia mobile deve dichiarare una sola colonna, trovate "${mobileGridTemplate}"`,
    );

    // Tap su una soglia → tooltip leggibile, senza espandere la card.
    const firstThreshold = page.getByTestId('ticker-threshold-mobile-1');
    await firstThreshold.click();
    const thresholdTooltip = page.getByRole('tooltip');
    await thresholdTooltip.waitFor({ state: 'visible', timeout: 5000 });
    assert.match(
      (await thresholdTooltip.innerText()).replace(/\s+/g, ' '),
      /Soglia S1:.*3 punti/,
      'su touch il tap deve spiegare la prima soglia',
    );
    assert.equal(
      await toggleMobile.getAttribute('aria-expanded'),
      'false',
      'il tap sulla soglia non deve aprire il dettaglio',
    );
    await page.keyboard.press('Escape');

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
// SCENARIO 3b (Task #440) – card data-first e traiettoria leggibile.
// ---------------------------------------------------------------------------
test('scenario 3b: card ticker senza foto e traiettoria separata dai KPI in chiaro/scuro, desktop/mobile', async () => {
  const pool = await newPool();
  const session = await signup({ prefix: 'ticker_datafirst', fullName: 'Ticker Data First Test' });
  let browser;
  try {
    await setRole(pool, session.profileId, 'admin');
    await seedMobilePista(pool, session, {
      posPrefix: 'TKDFPOS', rsPrefix: 'TickerDataFirstRs Srl',
      negozio: 'Negozio Data First', garaName: 'Ticker data-first test',
    });

    browser = await launchBrowser();
    const desktopContext = await newAuthedContext(browser, session);
    const desktopPage = await openDashboard(desktopContext);

    await assertDataFirstTickerCard(desktopPage, { theme: 'chiaro', viewport: 'desktop' });
    await desktopPage.locator('html').evaluate((html) => html.classList.add('dark'));
    await assertDataFirstTickerCard(desktopPage, { theme: 'scuro', viewport: 'desktop' });
    await desktopPage.close();
    await desktopContext.close();

    const mobileContext = await newAuthedContext(browser, session, { mobile: true });
    const mobilePage = await openDashboard(mobileContext);
    await assertDataFirstTickerCard(mobilePage, { theme: 'chiaro', viewport: 'mobile' });
    await mobilePage.locator('html').evaluate((html) => html.classList.add('dark'));
    await assertDataFirstTickerCard(mobilePage, { theme: 'scuro', viewport: 'mobile' });
    await mobilePage.close();
    await mobileContext.close();
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
    const toggleMobile = page.getByTestId('ticker-toggle-mobile');
    await rowMobile.waitFor({ state: 'visible', timeout: 15000 });

    // --- Marker soglie: tutte le soglie configurate sono visibili e
    // spiegate via tooltip senza aprire il dettaglio della card. ---
    const thresholdMarkers = rowMobile.locator('[data-testid^="ticker-threshold-mobile-"]');
    assert.equal(
      await thresholdMarkers.count(),
      4,
      'la barra mobile deve mostrare una stanghetta per ciascuna delle 4 soglie configurate',
    );
    const firstThreshold = thresholdMarkers.first();
    assert.equal(
      await firstThreshold.getAttribute('aria-label'),
      'Soglia S1: 3 punti',
      'la prima stanghetta deve descrivere nome, valore e unità della soglia',
    );
    await firstThreshold.hover();
    const thresholdTooltip = page.getByRole('tooltip');
    await thresholdTooltip.waitFor({ state: 'visible', timeout: 5000 });
    assert.match(
      (await thresholdTooltip.innerText()).replace(/\s+/g, ' '),
      /S1.*3 punti/,
      'hover sulla stanghetta deve mostrare il valore della soglia',
    );
    await firstThreshold.click();
    assert.equal(
      await toggleMobile.getAttribute('aria-expanded'),
      'false',
      'interagire con una soglia non deve aprire il dettaglio della card',
    );
    await page.keyboard.press('Escape');
    await firstThreshold.focus();
    await thresholdTooltip.waitFor({ state: 'visible', timeout: 5000 });
    await page.keyboard.press('Enter');
    assert.equal(
      await toggleMobile.getAttribute('aria-expanded'),
      'false',
      'Enter sulla soglia deve lasciare chiuso il dettaglio della card',
    );
    await page.keyboard.press('Escape');

    // --- La fascia sopra la barra confronta le soglie, senza ripetere i KPI. ---
    assert.equal(
      (await page.getByTestId('ticker-soglia-attuale-mobile').innerText()).trim(),
      'S1',
      'la soglia attuale deve essere mostrata nella fascia sopra la barra',
    );
    assert.match(
      (await page.getByTestId('ticker-soglia-proiezione-mobile').innerText()).trim(),
      /^S[1-4]$/,
      'la soglia proiettata deve essere mostrata senza inventare S0',
    );
    assert.equal(
      await rowMobile.locator('.pista-card-threshold').count(),
      0,
      'il vecchio badge soglia nell’intestazione non deve più duplicare lo stato',
    );

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

// ---------------------------------------------------------------------------
// SCENARIO 5 (Task #436) – valori premio/soglia per la pista FISSO: percorso
// di calcolo diverso dalla mobile (calcolaPremioPistaFissoPerPos: gettone
// contrattuale 23€/pezzo, canone 23€ × moltiplicatore soglia, soglie a 5
// livelli). Con soglia1 = 4 punti e 4 vendite FTTH (1 punto l'una → 4 punti)
// la pista fisso deve mostrare:
//   - ticker-premio-fisso con un valore € > 0
//     (4×23€ gettone + 4×23€×mult + 4×23€ fissi FTTH);
//   - nel blocco dettaglio "totale" la soglia S1 raggiunta, nessun "—";
//   - il badge proiezione ticker-premio-proj-fisso quando la proiezione
//     fine mese supera l'attuale (sempre, tranne l'ultimo giorno del mese).
// Se una regressione azzera premio/soglia fisso, questi assert falliscono
// invece di lasciare sparire silenziosamente la card.
// ---------------------------------------------------------------------------
test('scenario 5: pista fisso – premio non-zero, soglia raggiunta e badge proiezione con soglie note', async () => {
  const pool = await newPool();
  const session = await signup({ prefix: 'ticker_fisso', fullName: 'Ticker Fisso Test' });
  let browser;
  try {
    await setRole(pool, session.profileId, 'admin');

    const POS_A = uniq('TKFPOS');
    const RS_A = uniq('TickerFissoRs Srl');

    // Calendario 7/7: elapsedWorkingDays = giorno del mese,
    // totalWorkingDays = giorni del mese → ratio proiezione deterministico.
    const calendar = {
      weeklySchedule: { workingDays: [0, 1, 2, 3, 4, 5, 6] },
      specialDays: [],
    };

    // Gara config con soglie FISSO note: soglia1 = 4 punti (raggiunta con
    // 4 FTTH × 1 punto), soglie superiori irraggiungibili. Nessun
    // clusterFisso sul PDV → niente override soglie da cluster.
    await pool.query(
      `INSERT INTO gara_config (organization_id, month, year, name, config)
       VALUES ($1, $2, $3, $4, $5::jsonb)`,
      [
        session.orgId, MONTH, YEAR, 'Ticker fisso premio test',
        JSON.stringify({
          pdvList: [{ codicePos: POS_A, nome: 'Negozio Fisso', ragioneSociale: RS_A, calendar }],
          pistaFissoConfig: {
            sogliePerPos: [{
              posCode: POS_A,
              soglia1: 4, soglia2: 100, soglia3: 200, soglia4: 300, soglia5: 400,
              multiplierSoglia1: 2, multiplierSoglia2: 3,
              multiplierSoglia3: 3.5, multiplierSoglia4: 4, multiplierSoglia5: 5,
            }],
          },
        }),
      ],
    );

    // 4 vendite FTTH → 4 punti = soglia1; premio > 0 (gettone contrattuale
    // 23€/pezzo + canone 23€ × moltiplicatore + 23€ fissi FTTH per pezzo).
    for (let i = 0; i < 4; i++) {
      await insertSale(pool, session.orgId, {
        codicePos: POS_A, nomeNegozio: 'Negozio Fisso', ragioneSociale: RS_A,
        articoli: [artFissoFtth],
      });
    }

    browser = await launchBrowser();
    const context = await newAuthedContext(browser, session);
    const page = await openDashboard(context);

    await page.getByTestId('section-pista-ticker').waitFor({ state: 'visible', timeout: 15000 });
    const cardFisso = page.getByTestId('ticker-pista-fisso');
    await cardFisso.waitFor({ state: 'visible', timeout: 15000 });
    assert.equal(
      (await page.getByTestId('ticker-soglia-attuale-fisso').innerText()).trim(),
      'S1',
      'la card fisso deve mostrare S1 come soglia attuale',
    );

    // --- Punti sulla card: 4 FTTH × 1 punto = valore > 0 ---
    const puntiTxt = (await page.getByTestId('ticker-punti-fisso').innerText()).trim();
    const puntiVal = Number(puntiTxt.replace(/[^\d,.-]/g, '').replace(',', '.'));
    assert.ok(puntiVal > 0, `ticker-punti-fisso deve essere > 0 (trovato "${puntiTxt}")`);

    // --- Premio attuale non-zero sulla card ---
    const premioTxt = (await page.getByTestId('ticker-premio-fisso').innerText()).trim();
    const premioVal = Number(premioTxt.replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.'));
    assert.ok(
      Number.isFinite(premioVal) && premioVal > 0,
      `ticker-premio-fisso deve mostrare un € > 0 (trovato "${premioTxt}")`,
    );

    // --- Badge proiezione: presente quando la proiezione supera l'attuale.
    // Ratio = giorniMese/giornoOdierno (calendario 7/7): > 1 tranne
    // l'ultimo giorno del mese, dove la proiezione coincide con l'attuale.
    const today = new Date();
    const daysInMonth = new Date(YEAR, MONTH, 0).getDate();
    const isLastDay = today.getDate() >= daysInMonth;
    if (!isLastDay) {
      const projLoc = page.getByTestId('ticker-premio-proj-fisso');
      await projLoc.waitFor({ state: 'visible', timeout: 10000 });
      const projTxt = (await projLoc.innerText()).trim();
      const projVal = Number(projTxt.replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.'));
      assert.ok(
        Number.isFinite(projVal) && projVal > 0,
        `ticker-premio-proj-fisso deve mostrare un € > 0 (trovato "${projTxt}")`,
      );
      assert.ok(
        projVal >= premioVal,
        `proiezione fisso (${projVal}) attesa >= attuale (${premioVal})`,
      );
    } else {
      console.log('[scenario 5] ultimo giorno del mese: skip assert badge proiezione');
    }

    // --- Dettaglio espanso: soglia raggiunta (non "—") ---
    await cardFisso.click();
    const detail = page.getByTestId('ticker-detail-fisso');
    await detail.waitFor({ state: 'visible', timeout: 10000 });

    const totBlock = page.getByTestId('ticker-detail-rs-fisso-totale');
    await totBlock.waitFor({ state: 'visible', timeout: 10000 });
    const blockTxt = (await totBlock.innerText()).replace(/\s+/g, ' ');

    // La soglia attuale deve essere una soglia reale (S1) e non "—".
    assert.match(
      blockTxt,
      /S1/,
      `il blocco dettaglio fisso deve mostrare la soglia raggiunta S1 (trovato: "${blockTxt}")`,
    );

    // Nessun badge soglia deve essere il placeholder "—": con soglia1=4
    // raggiunta, sia l'attuale sia la proiezione mostrano una soglia reale.
    assert.ok(
      !blockTxt.includes('—'),
      `nessun badge soglia deve essere "—" nel dettaglio fisso (trovato: "${blockTxt}")`,
    );

    await page.close();
    await context.close();
  } finally {
    if (browser) await browser.close().catch(() => {});
    await cleanupOrg(pool, session);
    await pool.end().catch(() => {});
  }
});

test('scenario 6: scale uniformi tra RS mostrano i marker, scale diverse restano nel dettaglio', async () => {
  const pool = await newPool();
  const session = await signup({ prefix: 'ticker_rs_thresholds', fullName: 'Ticker RS Threshold Test' });
  let browser;
  try {
    await setRole(pool, session.profileId, 'admin');

    const POS_A = uniq('TKRSPOSA');
    const POS_B = uniq('TKRSPOSB');
    const RS_A = uniq('TickerRsAlfa Srl');
    const RS_B = uniq('TickerRsBeta Srl');
    const config = {
      tipologiaGara: 'gara_operatore_rs',
      modalitaInserimentoRS: 'per_rs',
      pdvList: [
        { codicePos: POS_A, nome: 'Negozio RS Alfa', ragioneSociale: RS_A },
        { codicePos: POS_B, nome: 'Negozio RS Beta', ragioneSociale: RS_B },
      ],
      pistaMobileRSConfig: {
        applicaDecurtazione30SeNoFissoO8Piva: false,
        sogliePerRS: [
          {
            ragioneSociale: RS_A,
            soglia1: 3, soglia2: 6, soglia3: 9, soglia4: 12,
            multiplierSoglia1: 1, multiplierSoglia2: 1.2,
            multiplierSoglia3: 1.5, multiplierSoglia4: 2,
          },
          {
            ragioneSociale: RS_B,
            soglia1: 3, soglia2: 6, soglia3: 9, soglia4: 12,
            multiplierSoglia1: 1, multiplierSoglia2: 1.2,
            multiplierSoglia3: 1.5, multiplierSoglia4: 2,
          },
        ],
      },
    };

    await pool.query(
      `INSERT INTO gara_config (organization_id, month, year, name, config)
       VALUES ($1, $2, $3, $4, $5::jsonb)`,
      [session.orgId, MONTH, YEAR, 'Ticker soglie RS test', JSON.stringify(config)],
    );
    for (const [codicePos, nomeNegozio, ragioneSociale] of [
      [POS_A, 'Negozio RS Alfa', RS_A],
      [POS_B, 'Negozio RS Beta', RS_B],
    ]) {
      for (let i = 0; i < 2; i++) {
        await insertSale(pool, session.orgId, {
          codicePos, nomeNegozio, ragioneSociale, articoli: [artMobileTied],
        });
      }
    }

    browser = await launchBrowser();
    const context = await newAuthedContext(browser, session);
    const page = await openDashboard(context);
    const card = page.getByTestId('ticker-pista-mobile');
    await card.waitFor({ state: 'visible', timeout: 15000 });

    assert.equal(await card.getAttribute('data-threshold-scale'), 'shared');
    assert.equal(await card.getAttribute('data-threshold-scope'), 'rs');
    assert.equal(
      await card.locator('[data-testid^="ticker-threshold-mobile-"]').count(),
      4,
      'due RS con la stessa scala devono condividere le quattro stanghette',
    );
    assert.match(
      (await page.getByTestId('ticker-trajectory-labels-mobile').innerText()).replace(/\s+/g, ' '),
      /Soglia attuale Non raggiunta migliore RS/i,
      'lo stato aggregato deve essere qualificato come migliore RS',
    );
    const actualFillWidth = Number.parseFloat(
      (await page.getByTestId('ticker-trajectory-track-mobile').locator('.pista-trajectory-fill').getAttribute('style'))?.match(/width:\s*([\d.]+)%/)?.[1] ?? 'NaN',
    );
    const s1MarkerLeft = Number.parseFloat(
      (await page.getByTestId('ticker-threshold-mobile-1').getAttribute('style'))?.match(/left:\s*([\d.]+)%/)?.[1] ?? 'NaN',
    );
    assert.ok(
      Number.isFinite(actualFillWidth) && Number.isFinite(s1MarkerLeft) && actualFillWidth < s1MarkerLeft,
      'due RS entrambe sotto S1 non devono far avanzare la barra fino a S1 sommando i loro punti',
    );

    config.pistaMobileRSConfig.sogliePerRS[1] = {
      ...config.pistaMobileRSConfig.sogliePerRS[1],
      soglia1: 10,
      soglia2: 20,
      soglia3: 30,
      soglia4: 40,
    };
    await pool.query(
      `UPDATE gara_config
       SET config = $2::jsonb
       WHERE organization_id = $1 AND month = $3 AND year = $4`,
      [session.orgId, JSON.stringify(config), MONTH, YEAR],
    );
    await page.reload({ waitUntil: 'networkidle', timeout: 45000 });
    await card.waitFor({ state: 'visible', timeout: 15000 });

    assert.equal(await card.getAttribute('data-threshold-scale'), 'mixed');
    assert.equal(
      await card.locator('[data-testid^="ticker-threshold-mobile-"]').count(),
      0,
      'scale RS diverse non devono essere presentate come una falsa scala comune',
    );
    assert.match(
      (await page.getByTestId('ticker-trajectory-labels-mobile').innerText()).replace(/\s+/g, ' '),
      /migliore RS/i,
      'anche senza scala comune lo stato deve dichiarare l’ambito RS',
    );

    await card.click();
    await page.getByTestId('ticker-detail-mobile').waitFor({ state: 'visible', timeout: 10000 });
    const detailThresholds = page.locator('[data-testid^="ticker-detail-thresholds-mobile-"]');
    assert.equal(
      await detailThresholds.count(),
      2,
      'i riferimenti specifici delle due RS devono restare disponibili nel dettaglio',
    );
    const detailTexts = await detailThresholds.allInnerTexts();
    assert.ok(detailTexts.some((text) => /S1:\s*3/.test(text)), 'il dettaglio deve conservare la scala della prima RS');
    assert.ok(detailTexts.some((text) => /S1:\s*10/.test(text)), 'il dettaglio deve conservare la scala diversa della seconda RS');

    await page.close();
    await context.close();
  } finally {
    if (browser) await browser.close().catch(() => {});
    await cleanupOrg(pool, session);
    await pool.end().catch(() => {});
  }
});

test('scenario 7: Extra Gara P.IVA mantiene marker e tooltip della scala effettiva', async () => {
  const pool = await newPool();
  const session = await signup({ prefix: 'ticker_extra_iva', fullName: 'Ticker Extra IVA Test' });
  let browser;
  try {
    await setRole(pool, session.profileId, 'admin');

    const POS = uniq('TKEGPOS');
    const RS = uniq('TickerExtraIva Srl');
    await pool.query(
      `INSERT INTO gara_config (organization_id, month, year, name, config)
       VALUES ($1, $2, $3, $4, $5::jsonb)`,
      [
        session.orgId, MONTH, YEAR, 'Ticker Extra Gara IVA test',
        JSON.stringify({
          pdvList: [{
            codicePos: POS,
            nome: 'Negozio Extra IVA',
            ragioneSociale: RS,
            clusterPIva: 'business_promoter',
          }],
          extraGaraIvaSogliePerRS: {
            [RS]: {
              s1: 1,
              s2: 2,
              s3: 3,
              s4: 4,
              pdvCount: 1,
              clusterPIva: 'business_promoter',
            },
          },
        }),
      ],
    );
    await insertSale(pool, session.orgId, {
      codicePos: POS,
      nomeNegozio: 'Negozio Extra IVA',
      ragioneSociale: RS,
      articoli: [artExtraGaraWorld],
    });

    browser = await launchBrowser();
    const context = await newAuthedContext(browser, session, { mobile: true });
    const page = await openDashboard(context);
    const card = page.getByTestId('ticker-pista-extra_gara_iva');
    const toggle = page.getByTestId('ticker-toggle-extra_gara_iva');
    await card.waitFor({ state: 'visible', timeout: 15000 });

    assert.equal(await card.getAttribute('data-threshold-scale'), 'shared');
    assert.equal(
      await card.locator('[data-testid^="ticker-threshold-extra_gara_iva-"]').count(),
      4,
      'Extra Gara P.IVA deve mostrare tutte le quattro soglie configurate',
    );
    assert.equal(
      (await page.getByTestId('ticker-soglia-attuale-extra_gara_iva').innerText()).trim(),
      'S1',
      '1,5 punti devono raggiungere la soglia S1 configurata a 1',
    );

    const s4Marker = page.getByTestId('ticker-threshold-extra_gara_iva-4');
    assert.equal(await s4Marker.getAttribute('aria-label'), 'Soglia S4: 4 punti');
    await s4Marker.click();
    const tooltip = page.getByRole('tooltip');
    await tooltip.waitFor({ state: 'visible', timeout: 5000 });
    assert.match((await tooltip.innerText()).replace(/\s+/g, ' '), /Soglia S4: 4 punti/);
    assert.equal(
      await toggle.getAttribute('aria-expanded'),
      'false',
      'il tap su una soglia Extra Gara non deve aprire il dettaglio',
    );

    await page.close();
    await context.close();
  } finally {
    if (browser) await browser.close().catch(() => {});
    await cleanupOrg(pool, session);
    await pool.end().catch(() => {});
  }
});
