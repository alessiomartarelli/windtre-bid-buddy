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

// Task #489 — pannello "Provenienza punti" sulle card pista della Dashboard
// Gara Reale. Verifica che:
//   - la card pista apre/chiude il pannello via bottone dedicato (btn-
//     provenienza-<pista>, con aria-expanded) e via click sulla card stessa;
//   - il pannello mostra il totale punti della card e una riga per PDV con
//     punti calcolati dagli STESSI calcolatori della card;
//   - i subtotali PDV sommano ESATTAMENTE al totale ("= totale card");
//   - le fonti (categorie mappate con pezzi) sono elencate per ogni PDV;
//   - il contesto (periodo, vista PDV, filtro in-gara) è dichiarato;
//   - il pannello resta visibile e leggibile anche in tema scuro.
//
// Scenario deterministico: 2 PDV mobile con soglia1 = 3 punti:
//   PDV A: 2 SIM TIED × 0,75 pt = 1,50 pt
//   PDV B: 4 SIM TIED × 0,75 pt = 3,00 pt
//   Totale card mobile = 4,50 pt → la somma dei subtotali deve quadrare.

const now = new Date();
const pad = (n) => String(n).padStart(2, '0');
const MONTH = now.getMonth() + 1;
const YEAR = now.getFullYear();
const DATA_VENDITA = `${YEAR}-${pad(MONTH)}-10T10:00:00.000Z`;

const artMobileTied = {
  categoria: { nome: 'TIED CF' },
  tipologia: { nome: 'VOCE EASYPAY' },
  dettaglio: { canone: '10' },
}; // mobile → TIED (0,75 punti)

async function insertSale(pool, orgId, { codicePos, nomeNegozio, ragioneSociale, articoli }) {
  const bisuiteId = Math.floor(Math.random() * 2_000_000_000);
  await pool.query(
    `INSERT INTO bisuite_sales
       (organization_id, bisuite_id, data_vendita, codice_pos, nome_negozio,
        ragione_sociale, stato, totale, raw_data)
     VALUES ($1, $2, $3, $4, $5, $6, 'FINALIZZATA', '10.00', $7::jsonb)`,
    [orgId, bisuiteId, DATA_VENDITA, codicePos, nomeNegozio, ragioneSociale,
     JSON.stringify({ cliente: { clienteTipo: 'PRIVATO' }, articoli })],
  );
}

const provNum = (txt) => Number(String(txt).replace(/[^\d,.-]/g, '').replace(',', '.'));

test('Dashboard Gara Reale: pannello Provenienza punti riconciliabile col totale card', async () => {
  const pool = await newPool();
  const session = await signup({ prefix: 'prov_punti', fullName: 'Provenienza Punti Test' });
  let browser;
  try {
    await setRole(pool, session.profileId, 'admin');

    const POS_A = uniq('PRVPOSA');
    const POS_B = uniq('PRVPOSB');
    const RS = uniq('ProvenienzaRs Srl');

    await pool.query(
      `INSERT INTO gara_config (organization_id, month, year, name, config)
       VALUES ($1, $2, $3, $4, $5::jsonb)`,
      [session.orgId, MONTH, YEAR, 'Provenienza punti test', JSON.stringify({
        pdvList: [
          { codicePos: POS_A, nome: 'Negozio Prov A', ragioneSociale: RS },
          { codicePos: POS_B, nome: 'Negozio Prov B', ragioneSociale: RS },
        ],
        pistaMobileConfig: {
          sogliePerPos: [POS_A, POS_B].map((posCode) => ({
            posCode,
            soglia1: 3, soglia2: 100, soglia3: 200, soglia4: 300,
            multiplierSoglia1: 1, multiplierSoglia2: 1.2,
            multiplierSoglia3: 1.5, multiplierSoglia4: 2,
          })),
        },
      })],
    );

    // PDV A: 2 TIED = 1,50 pt; PDV B: 4 TIED = 3,00 pt.
    for (let i = 0; i < 2; i++) {
      await insertSale(pool, session.orgId, {
        codicePos: POS_A, nomeNegozio: 'Negozio Prov A', ragioneSociale: RS,
        articoli: [artMobileTied],
      });
    }
    for (let i = 0; i < 4; i++) {
      await insertSale(pool, session.orgId, {
        codicePos: POS_B, nomeNegozio: 'Negozio Prov B', ragioneSociale: RS,
        articoli: [artMobileTied],
      });
    }

    browser = await launchBrowser();
    const context = await newAuthedContext(browser, session);
    const page = await context.newPage();
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(`${BASE}/dashboard-gara-reale`, { waitUntil: 'networkidle', timeout: 45000 });

    const card = page.getByTestId('ticker-pista-mobile');
    await card.waitFor({ state: 'visible', timeout: 30000 });
    const panel = page.getByTestId('provenienza-panel-mobile');
    const btn = page.getByTestId('btn-provenienza-mobile');

    // Chiuso di default.
    assert.equal(await panel.count(), 0, 'pannello chiuso al primo render');
    assert.equal(await btn.getAttribute('aria-expanded'), 'false', 'aria-expanded=false da chiuso');
    assert.match(await btn.innerText(), /Dettaglio punti/i, 'il comando deve essere testuale e visibile sulla card ticker');
    const btnBox = await btn.boundingBox();
    const cardBox = await card.boundingBox();
    assert.ok(btnBox && cardBox, 'pulsante e card devono avere dimensioni visibili su mobile');
    assert.ok(btnBox.x >= cardBox.x && btnBox.x + btnBox.width <= cardBox.x + cardBox.width,
      'il pulsante deve restare interamente dentro la card a 375px');

    // Apertura da tastiera (focus + Enter sul bottone dedicato).
    await btn.focus();
    await page.keyboard.press('Enter');
    await panel.waitFor({ state: 'visible', timeout: 10000 });
    assert.equal(await btn.getAttribute('aria-expanded'), 'true', 'aria-expanded=true da aperto');
    assert.equal(await card.locator('[data-testid="provenienza-panel-mobile"]').count(), 1,
      'il pannello deve essere contenuto nella card ticker colorata');
    assert.equal(await page.getByTestId('card-pista-mobile').locator('[data-testid="provenienza-panel-mobile"]').count(), 0,
      'la vecchia card bianca non deve contenere la provenienza punti');

    // Totale del pannello = totale card = 4,50 pt.
    const totale = provNum(await page.getByTestId('prov-totale-mobile').innerText());
    assert.equal(totale, 4.5, `totale pannello = 4,50 pt (letto ${totale})`);

    // Subtotali PDV: A = 1,50; B = 3,00; somma = totale card.
    const puntiA = provNum(await page.getByTestId(`prov-punti-pdv-mobile-${POS_A}`).innerText());
    const puntiB = provNum(await page.getByTestId(`prov-punti-pdv-mobile-${POS_B}`).innerText());
    assert.equal(puntiA, 1.5, `PDV A = 1,50 pt (letto ${puntiA})`);
    assert.equal(puntiB, 3, `PDV B = 3,00 pt (letto ${puntiB})`);
    assert.ok(Math.abs((puntiA + puntiB) - totale) < 0.005, 'somma subtotali PDV = totale pannello');

    const sommaTxt = await page.getByTestId('prov-somma-mobile').innerText();
    assert.match(sommaTxt, /4,50|4\.50/, 'riga somma mostra 4,50 pt');
    assert.match(sommaTxt, /= totale card/, 'riconciliazione esplicita col totale card');

    // Fonti: categoria TIED con i pezzi per PDV.
    const catA = await page.getByTestId(`prov-cat-mobile-${POS_A}-TIED`).innerText();
    assert.match(catA, /2\s*pz/, `fonte TIED del PDV A = 2 pz (letto "${catA}")`);
    const catB = await page.getByTestId(`prov-cat-mobile-${POS_B}-TIED`).innerText();
    assert.match(catB, /4\s*pz/, `fonte TIED del PDV B = 4 pz (letto "${catB}")`);

    // Il pannello è esclusivamente una provenienza punti: niente valori
    // economici o canoni.
    const panelText = await panel.innerText();
    assert.doesNotMatch(panelText, /€|canon/i, 'il dettaglio punti non deve contenere canoni o importi in euro');
    assert.ok(panelText.includes(RS), 'anche nel calcolo per-PDV deve essere visibile la Ragione Sociale sorgente');

    // Tema scuro: pannello ancora visibile e con testo non trasparente.
    await page.locator('html').evaluate((html) => html.classList.add('dark'));
    await panel.waitFor({ state: 'visible', timeout: 5000 });
    const darkColor = await panel.evaluate((el) => getComputedStyle(el).color);
    assert.notEqual(darkColor, 'rgba(0, 0, 0, 0)', 'testo del pannello visibile in dark');
    await page.locator('html').evaluate((html) => html.classList.remove('dark'));

    // Chiusura via click sulla card ticker (zona non interattiva: i punti).
    await page.getByTestId('ticker-punti-mobile').click();
    await panel.waitFor({ state: 'detached', timeout: 10000 });
    assert.equal(await btn.getAttribute('aria-expanded'), 'false', 'aria-expanded=false dopo chiusura');

    // Riapertura via click sulla card ticker.
    await page.getByTestId('ticker-punti-mobile').click();
    await panel.waitFor({ state: 'visible', timeout: 10000 });

    await page.close();
    await context.close();
  } finally {
    if (browser) await browser.close().catch(() => {});
    await cleanupOrg(pool, session);
    await pool.end().catch(() => {});
  }
});

test('Provenienza punti: modalità aggregazione per RS riconcilia i subtotali RS col totale card', async () => {
  const pool = await newPool();
  const session = await signup({ prefix: 'prov_rs', fullName: 'Provenienza RS Test' });
  let browser;
  try {
    await setRole(pool, session.profileId, 'admin');

    const POS_A = uniq('PRVRSA');
    const POS_B = uniq('PRVRSB');
    const RS = uniq('ProvenienzaRsAgg Srl');

    await pool.query(
      `INSERT INTO gara_config (organization_id, month, year, name, config)
       VALUES ($1, $2, $3, $4, $5::jsonb)`,
      [session.orgId, MONTH, YEAR, 'Provenienza punti RS test', JSON.stringify({
        tipologiaGara: 'gara_operatore_rs',
        modalitaInserimentoRS: 'per_rs',
        pdvList: [
          { codicePos: POS_A, nome: 'Negozio RS A', ragioneSociale: RS },
          { codicePos: POS_B, nome: 'Negozio RS B', ragioneSociale: RS },
        ],
        pistaMobileRSConfig: {
          sogliePerRS: [{
            ragioneSociale: RS,
            soglia1: 3, soglia2: 100, soglia3: 200, soglia4: 300,
            forecastTargetPunti: 10, clusterPista: 'cc_1',
          }],
        },
      })],
    );

    // Due PDV della stessa RS: 2 + 4 SIM TIED.
    for (let i = 0; i < 2; i++) {
      await insertSale(pool, session.orgId, {
        codicePos: POS_A, nomeNegozio: 'Negozio RS A', ragioneSociale: RS,
        articoli: [artMobileTied],
      });
    }
    for (let i = 0; i < 4; i++) {
      await insertSale(pool, session.orgId, {
        codicePos: POS_B, nomeNegozio: 'Negozio RS B', ragioneSociale: RS,
        articoli: [artMobileTied],
      });
    }

    browser = await launchBrowser();
    const context = await newAuthedContext(browser, session);
    const page = await context.newPage();
    await page.goto(`${BASE}/dashboard-gara-reale`, { waitUntil: 'networkidle', timeout: 45000 });

    const card = page.getByTestId('ticker-pista-mobile');
    await card.waitFor({ state: 'visible', timeout: 30000 });
    const btn = page.getByTestId('btn-provenienza-mobile');
    assert.equal(await card.locator('[data-testid="btn-provenienza-mobile"]').count(), 1,
      'il pulsante desktop deve essere dentro la card ticker');
    await btn.click();
    const panel = page.getByTestId('provenienza-panel-mobile');
    await panel.waitFor({ state: 'visible', timeout: 10000 });
    assert.equal(await card.locator('[data-testid="provenienza-panel-mobile"]').count(), 1,
      'il pannello desktop deve restare dentro la card ticker aperta');

    // Subtotali per RS presenti e riconciliati col totale del pannello.
    const totale = provNum(await page.getByTestId('prov-totale-mobile').innerText());
    const rsRows = page.locator('[data-testid^="prov-punti-rs-mobile-"]');
    const nRs = await rsRows.count();
    assert.ok(nRs >= 1, 'almeno una riga RS nel pannello in modalità per_rs');
    let sommaRs = 0;
    for (let i = 0; i < nRs; i++) sommaRs += provNum(await rsRows.nth(i).innerText());
    assert.ok(Math.abs(sommaRs - totale) < 0.005,
      `somma subtotali RS (${sommaRs}) = totale pannello (${totale})`);
    assert.match(await page.getByTestId('prov-somma-mobile').innerText(), /= totale card/,
      'riconciliazione esplicita col totale card in modalità RS');

    // I PDV della RS compaiono come fonti annidate con i pezzi.
    await page.getByTestId(`prov-row-pdv-mobile-${POS_A}`).waitFor({ state: 'visible', timeout: 5000 });
    await page.getByTestId(`prov-row-pdv-mobile-${POS_B}`).waitFor({ state: 'visible', timeout: 5000 });
    const catB = await page.getByTestId(`prov-cat-mobile-${POS_B}-TIED`).innerText();
    assert.match(catB, /4\s*pz/, `fonte TIED del PDV B = 4 pz (letto "${catB}")`);

    await page.close();
    await context.close();
  } finally {
    if (browser) await browser.close().catch(() => {});
    await cleanupOrg(pool, session);
    await pool.end().catch(() => {});
  }
});
