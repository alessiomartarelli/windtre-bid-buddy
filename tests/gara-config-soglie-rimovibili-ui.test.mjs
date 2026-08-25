import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BASE,
  uniq,
  jsonReq,
  signup,
  newPool,
  launchBrowser,
  newAuthedContext,
  cleanupOrg,
} from './helpers/uiTest.mjs';

// Soglie gara RIMOVIBILI (blocchi pista e singoli livelli per RS).
//
// Copre il flusso UI end-to-end su Configurazione Gara in modalità per_rs:
//   1. rimozione dell'intero blocco Energia di una RS (con AlertDialog di
//      conferma) => banner "rimossa", inputs nascosti;
//   2. rimozione di un singolo livello (S3) => input disabilitato;
//   3. salvataggio: il JSON persistito contiene rimosso:true / livelliRimossi,
//      il record NON viene cancellato dall'array;
//   4. reload: la rimozione persiste e gli initializer NON ricreano il blocco;
//   5. ripristino: il blocco torna con i valori conservati.
//
// La semantica di calcolo (blocco rimosso => nessun premio/marker) vive in
// shared/soglieRimovibili.ts + DashboardGaraReale; qui si protegge il wiring
// React di rimozione/persistenza/ripristino, che nessun test API copre.
//
// Task #501 — copertura aggiuntiva lato consumo dei flag:
//   - DashboardGaraReale: blocco Energia rimosso => premio 0, nessun marker
//     con le soglie della RS rimossa, breakdown per-PDV neutro; livello
//     Assicurazioni rimosso (S2) => neutralizzato (premio S1, nessun marker S2);
//   - blocchi Mobile/Fisso/Partnership rimossi => le piste non compaiono nel
//     ticker (premi assenti) pur con vendite presenti;
//   - Preventivatore in modalità per_rs: una RS con blocco Energia rimosso
//     non concorre al premio totale.

const now = new Date();
const MONTH = now.getMonth() + 1;
const YEAR = now.getFullYear();
const RS = 'CMS SRL';

function authed(session, opts = {}) {
  return { ...opts, headers: { Cookie: session.cookieHeader, ...(opts.headers || {}) } };
}

const PDV = {
  id: 'pdv-1',
  codicePos: 'POS001',
  nome: 'Negozio Uno',
  ragioneSociale: RS,
  tipoPosizione: 'negozio',
  canale: 'strada',
  clusterMobile: 'C1',
  clusterFisso: 'C1',
  clusterCB: 'C1',
  clusterPIva: 'C1',
  abilitaEnergia: true,
  abilitaAssicurazioni: true,
  calendar: { weeklySchedule: { workingDays: [1, 2, 3, 4, 5, 6] } },
};

const ENERGIA_RS = {
  ragioneSociale: RS,
  pdvInGara: 1,
  targetNoMalus: 10,
  targetS1: 15,
  targetS2: 25,
  targetS3: 40,
  premioS1: 250,
  premioS2: 500,
  premioS3: 1000,
  pistaSoglia_S1: 5,
  pistaSoglia_S2: 10,
  pistaSoglia_S3: 15,
  pistaSoglia_S4: 20,
  pistaSoglia_S5: 25,
};

test('removing and restoring the Energia RS block persists across save and reload', async () => {
  const pool = await newPool();
  const session = await signup({ prefix: 'gara_rimov', fullName: 'Gara Rimovibili UI', organizationName: uniq('GaraRimovibiliUI') });
  const browser = await launchBrowser();
  try {
    // --- Seed: config per_rs con un PDV e il blocco Energia per la RS.
    const created = await jsonReq(`${BASE}/api/gara-config`, authed(session, {
      method: 'PUT',
      body: JSON.stringify({
        month: MONTH, year: YEAR, name: 'Config rimovibili',
        config: {
          pdvList: [PDV],
          tipologiaGara: 'gara_operatore_rs',
          modalitaInserimentoRS: 'per_rs',
          energiaRSConfig: { configPerRS: [ENERGIA_RS] },
        },
      }),
    }));
    assert.equal(created.status, 200, JSON.stringify(created.body));
    const configId = created.body.id;

    const context = await newAuthedContext(browser, session);
    const page = await context.newPage();
    await page.goto(`${BASE}/configurazione-gara`, { waitUntil: 'networkidle' });

    // --- Tab Extra: il blocco Energia della RS è visibile e editabile.
    await page.getByTestId('tab-extra').click();
    const targetS1 = page.getByTestId(`input-energia-rs-targetS1-${RS}`);
    await targetS1.waitFor({ state: 'visible', timeout: 20000 });
    assert.equal(await targetS1.inputValue(), '15');

    // --- Rimuovi un singolo livello (S3): sparisce l'intera riga
    // (target + premio), ma resta disponibile il ripristino.
    await page.getByTestId(`button-energia-rs-livello-S3-${RS}`).click();
    const targetS3 = page.getByTestId(`input-energia-rs-targetS3-${RS}`);
    assert.equal(await targetS3.count(), 0, 'removed level S3 target is hidden');
    assert.equal(await page.getByTestId(`input-energia-rs-premioS3-${RS}`).count(), 0, 'removed level S3 premio is hidden');
    await page.getByTestId(`button-ripristina-energia-rs-livello-S3-${RS}`).waitFor({ state: 'visible' });

    // --- Rimuovi il blocco intero: prima ANNULLA (nessun effetto), poi conferma.
    await page.getByTestId(`button-rimuovi-energia-rs-${RS}`).click();
    await page.getByTestId('button-rimozione-blocco-cancel').waitFor({ state: 'visible', timeout: 10000 });
    await page.getByTestId('button-rimozione-blocco-cancel').click();
    await page.getByTestId('button-rimozione-blocco-confirm').waitFor({ state: 'hidden', timeout: 10000 });
    assert.equal(await targetS1.isVisible(), true, 'cancel keeps the block');

    await page.getByTestId(`button-rimuovi-energia-rs-${RS}`).click();
    await page.getByTestId('button-rimozione-blocco-confirm').waitFor({ state: 'visible', timeout: 10000 });
    await page.getByTestId('button-rimozione-blocco-confirm').click();
    await page.getByTestId(`banner-energia-rs-rimossa-${RS}`).waitFor({ state: 'visible', timeout: 10000 });
    assert.equal(await targetS1.count() === 0 || !(await targetS1.isVisible()), true, 'inputs hidden when block removed');

    // --- Salva (dialog nome -> conferma) e verifica il JSON persistito:
    // record conservato, flag espliciti.
    await page.getByTestId('button-save').click();
    await page.getByTestId('button-confirm-save').waitFor({ state: 'visible', timeout: 10000 });
    await page.getByTestId('button-confirm-save').click();
    await page.getByTestId('button-confirm-save').waitFor({ state: 'hidden', timeout: 10000 });
    await page.waitForTimeout(500);
    const saved = await pool.query(`SELECT config -> 'energiaRSConfig' -> 'configPerRS' AS c FROM gara_config WHERE id = $1`, [configId]);
    const arr = saved.rows[0].c;
    assert.equal(arr.length, 1, 'removed block is kept in the array, not deleted');
    assert.equal(arr[0].rimosso, true, 'block removal saved as explicit flag');
    assert.deepEqual(arr[0].livelliRimossi, ['S3'], 'removed level saved explicitly');
    assert.equal(arr[0].targetS3, 40, 'values are preserved, not zeroed');

    // --- Reload: la rimozione persiste, gli initializer non ricreano il blocco.
    await page.reload({ waitUntil: 'networkidle' });
    await page.getByTestId('tab-extra').click();
    await page.getByTestId(`banner-energia-rs-rimossa-${RS}`).waitFor({ state: 'visible', timeout: 20000 });

    // --- Ripristino: il blocco torna con i valori conservati e S3 ancora rimosso.
    await page.getByTestId(`button-ripristina-energia-rs-${RS}`).click();
    await targetS1.waitFor({ state: 'visible', timeout: 10000 });
    assert.equal(await targetS1.inputValue(), '15', 'restored block keeps its values');
    assert.equal(await page.getByTestId(`input-energia-rs-targetS3-${RS}`).count(), 0, 'whole removed row stays hidden after block restore');

    // Riattiva anche il livello S3.
    await page.getByTestId(`button-ripristina-energia-rs-livello-S3-${RS}`).click();
    assert.equal(await page.getByTestId(`input-energia-rs-targetS3-${RS}`).isVisible(), true, 'whole level row can be restored');
    assert.equal(await page.getByTestId(`input-energia-rs-premioS3-${RS}`).isVisible(), true, 'restored row includes its premio');

    // Salva e verifica che i flag siano rientrati.
    await page.getByTestId('button-save').click();
    await page.getByTestId('button-confirm-save').waitFor({ state: 'visible', timeout: 10000 });
    await page.getByTestId('button-confirm-save').click();
    await page.getByTestId('button-confirm-save').waitFor({ state: 'hidden', timeout: 10000 });
    await page.waitForTimeout(500);
    const saved2 = await pool.query(`SELECT config -> 'energiaRSConfig' -> 'configPerRS' AS c FROM gara_config WHERE id = $1`, [configId]);
    const arr2 = saved2.rows[0].c;
    assert.equal(arr2[0].rimosso, false, 'restore clears the removal flag');
    assert.deepEqual(arr2[0].livelliRimossi ?? [], [], 'no removed levels after re-enable');

    await page.close();
    await context.close();
  } finally {
    await browser.close().catch(() => {});
    await cleanupOrg(pool, session);
    await pool.end().catch(() => {});
  }
});

// --- Dashboard: un blocco Assicurazioni rimosso per una RS non deve
// contribuire a pezzi, premi e breakdown del ticker (nessun fallback).
const RS_B = 'BETA STORE SRL';
const PDV_B = {
  ...PDV,
  id: 'pdv-2',
  codicePos: 'POS002',
  nome: 'Negozio Due',
  ragioneSociale: RS_B,
};

const artAssicCasa = {
  categoria: { nome: 'ASSICURAZIONI' },
  tipologia: { nome: 'ASSICURAZIONI CASA' },
  descrizione: 'CASA FAMIGLIA START',
  dettaglio: { prezzo: '5.00' },
};

async function insertSale(pool, orgId, { codicePos, nomeNegozio, ragioneSociale }) {
  const pad = (n) => String(n).padStart(2, '0');
  const dataVendita = `${YEAR}-${pad(MONTH)}-10T10:00:00.000Z`;
  const bisuiteId = Math.floor(Math.random() * 2_000_000_000);
  await pool.query(
    `INSERT INTO bisuite_sales
       (organization_id, bisuite_id, data_vendita, codice_pos, nome_negozio,
        ragione_sociale, stato, totale, raw_data)
     VALUES ($1, $2, $3, $4, $5, $6, 'FINALIZZATA', '5.00', $7::jsonb)`,
    [orgId, bisuiteId, dataVendita, codicePos, nomeNegozio, ragioneSociale,
     JSON.stringify({ articoli: [artAssicCasa] })],
  );
}

test('dashboard excludes a removed Assicurazioni RS block from pieces, premi and ticker', async () => {
  const pool = await newPool();
  const session = await signup({ prefix: 'gara_rimov_dash', fullName: 'Gara Rimovibili Dash UI', organizationName: uniq('GaraRimovDashUI') });
  const browser = await launchBrowser();
  try {
    const mkAssicRS = (rs, extra = {}) => ({
      ragioneSociale: rs, pdvInGara: 1, targetNoMalus: 0,
      targetS1: 1, targetS2: 99999, premio: 750, premioS1: 750, premioS2: 1100,
      ...extra,
    });
    const created = await jsonReq(`${BASE}/api/gara-config`, authed(session, {
      method: 'PUT',
      body: JSON.stringify({
        month: MONTH, year: YEAR, name: 'Config rimovibili dash',
        config: {
          pdvList: [PDV, PDV_B],
          tipologiaGara: 'gara_operatore_rs',
          modalitaInserimentoRS: 'per_rs',
          assicurazioniConfig: { pdvInGara: 2, targetNoMalus: 0, targetS1: 1, targetS2: 99999, premio: 750, premioS1: 750, premioS2: 1100 },
          assicurazioniRSConfig: {
            configPerRS: [
              // Blocco della RS "CMS SRL" rimosso: non deve concorrere a nulla.
              mkAssicRS(RS, { rimosso: true }),
              mkAssicRS(RS_B),
            ],
          },
        },
      }),
    }));
    assert.equal(created.status, 200, JSON.stringify(created.body));

    // Una polizza (2 punti) per ciascun PDV: senza rimozione i pezzi sarebbero 2.
    await insertSale(pool, session.orgId, { codicePos: PDV.codicePos, nomeNegozio: PDV.nome, ragioneSociale: RS });
    await insertSale(pool, session.orgId, { codicePos: PDV_B.codicePos, nomeNegozio: PDV_B.nome, ragioneSociale: RS_B });

    const context = await newAuthedContext(browser, session);
    const page = await context.newPage();
    await page.goto(`${BASE}/dashboard-gara-reale`, { waitUntil: 'networkidle' });

    const card = page.getByTestId('ticker-pista-assicurazioni');
    await card.waitFor({ state: 'visible', timeout: 30000 });

    // Premio card = solo la RS attiva (750 × pdvInGara 1); la RS rimossa
    // non genera premio né fallback alla config globale.
    const premioTxt = (await page.getByTestId('ticker-premio-assicurazioni').innerText()).trim();
    const premioNum = Number(premioTxt.replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.'));
    assert.equal(premioNum, 750, `premio card = solo RS attiva (got ${premioTxt})`);

    // Apri il dettaglio: i pezzi totali contano solo la RS attiva (1 pz)
    // e nel breakdown non compaiono righe della RS rimossa.
    await page.getByTestId('ticker-toggle-assicurazioni').click();
    const pezziTxt = (await page.getByTestId('prov-totale-pezzi-assicurazioni').innerText()).trim();
    assert.match(pezziTxt, /^1\s*pz$/, `pezzi ticker escludono la RS rimossa (got "${pezziTxt}")`);
    const detail = page.getByTestId('ticker-detail-assicurazioni');
    const detailTxt = await detail.innerText();
    assert.ok(!detailTxt.includes(PDV.nome), 'il PDV della RS rimossa non compare nel breakdown');

    await page.close();
    await context.close();
  } finally {
    await browser.close().catch(() => {});
    await cleanupOrg(pool, session);
    await pool.end().catch(() => {});
  }
});

// --- Dashboard (Task #501): blocco Energia rimosso per una RS => premio 0,
// nessun marker con le soglie della RS rimossa, breakdown per-PDV neutro;
// livello Assicurazioni rimosso (S2) => bonus S1, nessun marker S2.
const artEnergiaSale = {
  categoria: { nome: 'ENERGIA W3' },
  tipologia: { nome: 'ENERGIA' },
  descrizione: 'OFFERTA LUCE',
  dettaglio: { prezzo: '0.00' },
};

async function insertSaleArticoli(pool, orgId, { codicePos, nomeNegozio, ragioneSociale, articoli, cliente }) {
  const pad = (n) => String(n).padStart(2, '0');
  const dataVendita = `${YEAR}-${pad(MONTH)}-10T10:00:00.000Z`;
  const bisuiteId = Math.floor(Math.random() * 2_000_000_000);
  await pool.query(
    `INSERT INTO bisuite_sales
       (organization_id, bisuite_id, data_vendita, codice_pos, nome_negozio,
        ragione_sociale, stato, totale, raw_data)
     VALUES ($1, $2, $3, $4, $5, $6, 'FINALIZZATA', '5.00', $7::jsonb)`,
    [orgId, bisuiteId, dataVendita, codicePos, nomeNegozio, ragioneSociale,
     JSON.stringify({ cliente, articoli })],
  );
}

test('dashboard: removed Energia block => premio 0/no markers/neutral breakdown; removed Assic S2 level => S1 bonus only', async () => {
  const pool = await newPool();
  const session = await signup({ prefix: 'gara_rimov_en', fullName: 'Gara Rimovibili Energia UI', organizationName: uniq('GaraRimovEnergiaUI') });
  const browser = await launchBrowser();
  try {
    const created = await jsonReq(`${BASE}/api/gara-config`, authed(session, {
      method: 'PUT',
      body: JSON.stringify({
        month: MONTH, year: YEAR, name: 'Config rimovibili energia',
        config: {
          pdvList: [PDV, PDV_B],
          tipologiaGara: 'gara_operatore_rs',
          modalitaInserimentoRS: 'per_rs',
          energiaRSConfig: {
            configPerRS: [
              // RS "CMS SRL": blocco Energia RIMOSSO. Target distintivi (7/8/9)
              // per verificare che i suoi marker non compaiano sul ticker.
              { ragioneSociale: RS, pdvInGara: 1, targetNoMalus: 0, targetS1: 7, targetS2: 8, targetS3: 9, premioS1: 999, premioS2: 999, premioS3: 999, rimosso: true },
              // RS "BETA STORE SRL": attiva, 1 pezzo raggiunge S1 => premio 250.
              {
                ragioneSociale: RS_B, pdvInGara: 1,
                targetNoMalus: 0, targetS1: 1, targetS2: 50, targetS3: 99,
                premioS1: 250, premioS2: 500, premioS3: 1000,
                // Le cinque "Soglie Pista" Energia devono alimentare il ticker.
                pistaSoglia_S1: 1, pistaSoglia_S2: 2, pistaSoglia_S3: 3,
                pistaSoglia_S4: 4, pistaSoglia_S5: 5,
              },
            ],
          },
          // La config globale serve al calcolo punti per-PDV; le soglie/premi
          // effettivi arrivano dal blocco per-RS sotto.
          assicurazioniConfig: { pdvInGara: 1, targetNoMalus: 0, targetS1: 1, targetS2: 2, premioS1: 500, premioS2: 1100 },
          assicurazioniRSConfig: {
            configPerRS: [
              // RS "CMS SRL": livello S2 rimosso. 1 polizza = 2 punti >= targetS2,
              // ma con S2 neutralizzato deve valere il bonus S1 (500), non 1100.
              { ragioneSociale: RS, pdvInGara: 1, targetNoMalus: 0, targetS1: 1, targetS2: 2, premioS1: 500, premioS2: 1100, livelliRimossi: ['S2'] },
            ],
          },
        },
      }),
    }));
    assert.equal(created.status, 200, JSON.stringify(created.body));

    // 1 contratto energia per ciascuna RS + 1 polizza sulla RS col livello rimosso.
    await insertSaleArticoli(pool, session.orgId, { codicePos: PDV.codicePos, nomeNegozio: PDV.nome, ragioneSociale: RS, articoli: [artEnergiaSale], cliente: { clienteTipo: 'FISICA' } });
    await insertSaleArticoli(pool, session.orgId, { codicePos: PDV_B.codicePos, nomeNegozio: PDV_B.nome, ragioneSociale: RS_B, articoli: [artEnergiaSale], cliente: { clienteTipo: 'FISICA' } });
    await insertSaleArticoli(pool, session.orgId, { codicePos: PDV.codicePos, nomeNegozio: PDV.nome, ragioneSociale: RS, articoli: [artAssicCasa], cliente: { clienteTipo: 'PRIVATO' } });

    const context = await newAuthedContext(browser, session);
    const page = await context.newPage();
    await page.goto(`${BASE}/dashboard-gara-reale`, { waitUntil: 'networkidle' });

    const energiaCard = page.getByTestId('ticker-pista-energia');
    await energiaCard.waitFor({ state: 'visible', timeout: 30000 });

    // Premio energia = solo RS attiva (250): la RS rimossa vale 0, senza
    // fallback ai default o alla config org.
    const premioEnTxt = (await page.getByTestId('ticker-premio-energia').innerText()).trim();
    const premioEn = Number(premioEnTxt.replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.'));
    assert.equal(premioEn, 250, `premio energia = solo RS attiva (got "${premioEnTxt}")`);

    // Nessun marker soglia con i target distintivi della RS rimossa (7/8/9).
    const markerValues = await page
      .locator('[data-testid^="ticker-threshold-energia-"]')
      .evaluateAll(els => els.map(el => el.getAttribute('data-threshold-value')));
    assert.deepEqual(markerValues, ['1', '2', '3', '4', '5'], 'ticker Energia mostra tutte le cinque Soglie Pista configurate');
    const markerLabels = await page
      .locator('[data-testid^="ticker-threshold-energia-"]')
      .evaluateAll(els => els.map(el => el.getAttribute('data-threshold-label')));
    assert.deepEqual(markerLabels, ['S1', 'S2', 'S3', 'S4', 'S5'], 'marker Energia etichettati S1–S5');
    for (const v of ['7', '8', '9']) {
      assert.ok(!markerValues.includes(v), `nessun marker con la soglia ${v} della RS rimossa (got ${JSON.stringify(markerValues)})`);
    }

    // Dettagli per-PDV neutri: i pezzi contano solo la RS attiva e la RS
    // rimossa (e il suo PDV) non compare nel breakdown.
    await page.getByTestId('ticker-toggle-energia').click();
    const pezziEnTxt = (await page.getByTestId('prov-totale-pezzi-energia').innerText()).trim();
    assert.match(pezziEnTxt, /^1\s*pz$/, `pezzi energia escludono la RS rimossa (got "${pezziEnTxt}")`);
    const detailEnTxt = await page.getByTestId('ticker-detail-energia').innerText();
    assert.ok(!detailEnTxt.includes(PDV.nome), 'il PDV della RS rimossa non compare nel breakdown energia');
    assert.ok(!detailEnTxt.toUpperCase().includes('CMS'), 'la RS rimossa non compare nel breakdown energia');

    // Assicurazioni: livello S2 rimosso => 2 punti valgono la soglia S1 (500 €).
    const premioAsTxt = (await page.getByTestId('ticker-premio-assicurazioni').innerText()).trim();
    const premioAs = Number(premioAsTxt.replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.'));
    assert.equal(premioAs, 500, `livello S2 rimosso => bonus S1 (got "${premioAsTxt}")`);
    assert.equal(
      (await page.getByTestId('ticker-soglia-attuale-assicurazioni').innerText()).trim(),
      'S1',
      'con S2 rimosso la soglia attuale resta S1',
    );
    const markerLabelsAs = await page
      .locator('[data-testid^="ticker-threshold-assicurazioni-"]')
      .evaluateAll(els => els.map(el => el.getAttribute('data-threshold-label')));
    assert.ok(!markerLabelsAs.includes('S2'), `nessun marker S2 con il livello rimosso (got ${JSON.stringify(markerLabelsAs)})`);

    await page.close();
    await context.close();
  } finally {
    await browser.close().catch(() => {});
    await cleanupOrg(pool, session);
    await pool.end().catch(() => {});
  }
});

// --- Dashboard (Task #501): blocchi Mobile, Fisso e Partnership rimossi =>
// le piste non compaiono nel ticker (premi assenti) pur con vendite presenti;
// le piste non rimosse (energia, cb) continuano a comparire.
test('dashboard: removed Mobile/Fisso/Partnership blocks keep their piste (and premi) out of the ticker', async () => {
  const pool = await newPool();
  const session = await signup({ prefix: 'gara_rimov_mfp', fullName: 'Gara Rimovibili MFP UI', organizationName: uniq('GaraRimovMfpUI') });
  const browser = await launchBrowser();
  try {
    const created = await jsonReq(`${BASE}/api/gara-config`, authed(session, {
      method: 'PUT',
      body: JSON.stringify({
        month: MONTH, year: YEAR, name: 'Config rimovibili mfp',
        config: {
          pdvList: [PDV],
          tipologiaGara: 'gara_operatore_rs',
          modalitaInserimentoRS: 'per_rs',
          pistaMobileRSConfig: {
            sogliePerRS: [{ ragioneSociale: RS, rimosso: true, soglia1: 1, soglia2: 2, soglia3: 3, soglia4: 4, forecastTargetPunti: 10 }],
          },
          pistaFissoRSConfig: {
            sogliePerRS: [{ ragioneSociale: RS, rimosso: true, soglia1: 1, soglia2: 2, soglia3: 3, soglia4: 4, soglia5: 5, forecastTargetPunti: 10 }],
          },
          partnershipRewardRSConfig: {
            configPerRS: [{ ragioneSociale: RS, rimosso: true, target100: 1, target80: 1, premio100: 100, premio80: 80 }],
          },
          // Blocco Energia ATTIVO: la card energia fa da ancora (pagina carica,
          // vendite processate) mentre le piste rimosse devono sparire.
          energiaRSConfig: {
            configPerRS: [{ ragioneSociale: RS, pdvInGara: 1, targetNoMalus: 0, targetS1: 1, targetS2: 50, targetS3: 99, premioS1: 200, premioS2: 500, premioS3: 1000 }],
          },
        },
      }),
    }));
    assert.equal(created.status, 200, JSON.stringify(created.body));

    // Vendite per TUTTE le piste: mobile (TIED), fisso (FTTH), cb+partnership
    // (MIA twin), energia.
    await insertSaleArticoli(pool, session.orgId, {
      codicePos: PDV.codicePos, nomeNegozio: PDV.nome, ragioneSociale: RS,
      articoli: [{ categoria: { nome: 'TIED CF' }, tipologia: { nome: 'VOCE EASYPAY' }, dettaglio: { canone: '10' } }],
      cliente: { clienteTipo: 'PRIVATO' },
    });
    await insertSaleArticoli(pool, session.orgId, {
      codicePos: PDV.codicePos, nomeNegozio: PDV.nome, ragioneSociale: RS,
      articoli: [{ categoria: { nome: 'ADSL/FIBRA/FWA CF' }, tipologia: { nome: 'FIBRA FTTH CF' }, dettaglio: { prezzo: '0.00' } }],
      cliente: { clienteTipo: 'PRIVATO' },
    });
    await insertSaleArticoli(pool, session.orgId, {
      codicePos: PDV.codicePos, nomeNegozio: PDV.nome, ragioneSociale: RS,
      articoli: [{ categoria: { nome: 'MIA TIED' }, tipologia: { nome: 'MIA EASYPAY STANDARD' }, dettaglio: { prezzo: '0.00' } }],
      cliente: { clienteTipo: 'PRIVATO' },
    });
    await insertSaleArticoli(pool, session.orgId, {
      codicePos: PDV.codicePos, nomeNegozio: PDV.nome, ragioneSociale: RS,
      articoli: [artEnergiaSale], cliente: { clienteTipo: 'FISICA' },
    });

    const context = await newAuthedContext(browser, session);
    const page = await context.newPage();
    await page.goto(`${BASE}/dashboard-gara-reale`, { waitUntil: 'networkidle' });

    // Ancore: energia (blocco attivo, premio 200) e cb (pista non rimovibile,
    // alimentata dalla stessa vendita MIA del twin partnership).
    await page.getByTestId('ticker-pista-energia').waitFor({ state: 'visible', timeout: 30000 });
    await page.getByTestId('ticker-pista-cb').waitFor({ state: 'visible', timeout: 15000 });
    const premioEnTxt = (await page.getByTestId('ticker-premio-energia').innerText()).trim();
    const premioEn = Number(premioEnTxt.replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.'));
    assert.equal(premioEn, 200, `il blocco energia attivo continua a premiare (got "${premioEnTxt}")`);

    // Le piste con blocco rimosso NON devono comparire (premi assenti),
    // nonostante le vendite mobile/fisso/MIA appena inserite.
    assert.equal(await page.getByTestId('ticker-pista-mobile').count(), 0,
      'pista mobile assente con blocco RS rimosso');
    assert.equal(await page.getByTestId('ticker-pista-fisso').count(), 0,
      'pista fisso assente con blocco RS rimosso');
    assert.equal(await page.getByTestId('ticker-pista-partnership').count(), 0,
      'pista partnership assente con blocco RS rimosso');

    await page.close();
    await context.close();
  } finally {
    await browser.close().catch(() => {});
    await cleanupOrg(pool, session);
    await pool.end().catch(() => {});
  }
});

// --- Preventivatore: una RS con blocco Assicurazioni rimosso non deve
// concorrere al premio totale del simulatore (né fallback alla config globale).
test('Preventivatore excludes a removed Assicurazioni RS block from premi', async () => {
  const pool = await newPool();
  const session = await signup({ prefix: 'gara_rimov_prev', fullName: 'Gara Rimovibili Prev UI', organizationName: uniq('GaraRimovPrevUI') });
  const browser = await launchBrowser();
  try {
    const emptyAssic = {
      protezionePro: 0, casaFamigliaFull: 0, casaFamigliaPlus: 0, casaFamigliaStart: 0,
      sportFamiglia: 0, sportIndividuale: 0, viaggiVacanze: 0, elettrodomestici: 0,
      micioFido: 0, pagamentoAnnuale: 0, viaggioMondo: 0, viaggioMondoPremio: 0, reloadForever: 0,
    };
    const pdvA = { ...PDV, abilitaEnergia: false };
    const pdvB = { ...PDV, id: 'pdv-2', codicePos: 'POS002', nome: 'Negozio Due', ragioneSociale: RS_B, abilitaEnergia: false };
    // 1 Casa Famiglia Start per RS: 2 punti (>= targetS1=1) => gettoni 40 + bonus 500 = 540 a RS.
    const preventivoData = {
      step: 0,
      configGara: { nomeGara: 'Test rimozioni', haLetteraUfficiale: false, annoGara: YEAR, meseGara: MONTH, tipoPeriodo: 'mensile', tipologiaGara: 'gara_operatore_rs' },
      numeroPdv: 2,
      puntiVendita: [pdvA, pdvB],
      modalitaInserimentoRS: 'per_rs',
      assicurazioniConfig: { pdvInGara: 2, targetNoMalus: 0, targetS1: 1, targetS2: 99999 },
      attivatoAssicurazioniByRS: {
        [RS]: { ...emptyAssic, casaFamigliaStart: 1 },
        [RS_B]: { ...emptyAssic, casaFamigliaStart: 1 },
      },
      // Blocco Assicurazioni della RS "CMS SRL" rimosso in Config Gara.
      assicurazioniRSConfig: {
        configPerRS: [
          { ragioneSociale: RS, pdvInGara: 1, targetNoMalus: 0, targetS1: 1, targetS2: 99999, rimosso: true },
          { ragioneSociale: RS_B, pdvInGara: 1, targetNoMalus: 0, targetS1: 1, targetS2: 99999 },
        ],
      },
    };
    const created = await jsonReq(`${BASE}/api/preventivi`, authed(session, {
      method: 'POST',
      body: JSON.stringify({ name: 'Preventivo rimozioni', data: preventivoData }),
    }));
    assert.equal(created.status, 201, JSON.stringify(created.body));

    const context = await newAuthedContext(browser, session);
    const page = await context.newPage();
    await page.goto(`${BASE}/preventivatore?id=${created.body.id}`, { waitUntil: 'networkidle' });

    // Il riepilogo esiste in due copie (mobile lg:hidden e sidebar desktop):
    // aspettiamo che una delle due abbia un importo, senza pretendere visibilità.
    await page.getByTestId('text-premio-totale').first().waitFor({ state: 'attached', timeout: 30000 });
    // Con la rimozione onorata il totale è solo la RS attiva: 540 €.
    // Senza fix sarebbe 1080 € (entrambe le RS con fallback alla config globale).
    await page.waitForFunction(() => {
      const el = document.querySelector('[data-testid="text-premio-totale"]');
      return el && /\d/.test(el.textContent || '');
    }, { timeout: 15000 });
    const txt = ((await page.getByTestId('text-premio-totale').first().textContent()) || '').trim();
    const num = Number(txt.replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.'));
    assert.equal(num, 540, `premio totale esclude la RS rimossa (got "${txt}")`);

    await page.close();
    await context.close();
  } finally {
    await browser.close().catch(() => {});
    await cleanupOrg(pool, session);
    await pool.end().catch(() => {});
  }
});

// --- Task #502: le rimozioni sono MENSILI e devono sopravvivere sia al cambio
// mese (avanti e indietro), sia al ripristino di una revisione che le contiene.
// Un loader che ricostruisse i default al cambio mese/ripristino potrebbe
// "resuscitare" silenziosamente i blocchi rimossi.

const MONTH_LABELS = ['Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno',
  'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre'];

// Seleziona un mese dal Select Radix (select-month) cliccando l'opzione col label.
async function selectMonth(page, month) {
  await page.getByTestId('select-month').click();
  await page.getByRole('option', { name: MONTH_LABELS[month - 1], exact: true }).click();
}

test('removed block survives switching month away and back', async () => {
  const pool = await newPool();
  const session = await signup({ prefix: 'gara_rimov_mese', fullName: 'Gara Rimovibili Mese UI', organizationName: uniq('GaraRimovMeseUI') });
  const browser = await launchBrowser();
  try {
    const OTHER_MONTH = MONTH === 1 ? 2 : MONTH - 1;

    const created = await jsonReq(`${BASE}/api/gara-config`, authed(session, {
      method: 'PUT',
      body: JSON.stringify({
        month: MONTH, year: YEAR, name: 'Config mese corrente',
        config: {
          pdvList: [PDV],
          tipologiaGara: 'gara_operatore_rs',
          modalitaInserimentoRS: 'per_rs',
          energiaRSConfig: { configPerRS: [ENERGIA_RS] },
        },
      }),
    }));
    assert.equal(created.status, 200, JSON.stringify(created.body));
    const configId = created.body.id;

    const context = await newAuthedContext(browser, session);
    const page = await context.newPage();
    await page.goto(`${BASE}/configurazione-gara`, { waitUntil: 'networkidle' });

    // --- Rimuovi livello S3 + blocco Energia della RS, poi salva.
    await page.getByTestId('tab-extra').click();
    const targetS1 = page.getByTestId(`input-energia-rs-targetS1-${RS}`);
    await targetS1.waitFor({ state: 'visible', timeout: 20000 });
    await page.getByTestId(`button-energia-rs-livello-S3-${RS}`).click();
    await page.getByTestId(`button-rimuovi-energia-rs-${RS}`).click();
    await page.getByTestId('button-rimozione-blocco-confirm').waitFor({ state: 'visible', timeout: 10000 });
    await page.getByTestId('button-rimozione-blocco-confirm').click();
    const banner = page.getByTestId(`banner-energia-rs-rimossa-${RS}`);
    await banner.waitFor({ state: 'visible', timeout: 10000 });

    await page.getByTestId('button-save').click();
    await page.getByTestId('button-confirm-save').waitFor({ state: 'visible', timeout: 10000 });
    await page.getByTestId('button-confirm-save').click();
    await page.getByTestId('button-confirm-save').waitFor({ state: 'hidden', timeout: 10000 });
    await page.waitForTimeout(500);

    // --- Cambia mese: il mese "altro" non ha config, la pagina si reinizializza.
    await selectMonth(page, OTHER_MONTH);
    await page.getByTestId('text-periodo-gara').filter({ hasText: MONTH_LABELS[OTHER_MONTH - 1].toLowerCase() }).waitFor({ state: 'visible', timeout: 20000 });
    await banner.waitFor({ state: 'detached', timeout: 20000 });

    // --- Torna al mese originale: la rimozione DEVE essere ancora lì.
    await selectMonth(page, MONTH);
    await page.getByTestId('text-periodo-gara').filter({ hasText: MONTH_LABELS[MONTH - 1].toLowerCase() }).waitFor({ state: 'visible', timeout: 20000 });
    await page.getByTestId('tab-extra').click();
    await banner.waitFor({ state: 'visible', timeout: 20000 });
    assert.equal(await targetS1.count() === 0 || !(await targetS1.isVisible()), true, 'block stays removed after month round-trip');

    // Il DB non deve essere stato riscritto senza i flag.
    const saved = await pool.query(`SELECT config -> 'energiaRSConfig' -> 'configPerRS' AS c FROM gara_config WHERE id = $1`, [configId]);
    const arr = saved.rows[0].c;
    assert.equal(arr.length, 1);
    assert.equal(arr[0].rimosso, true, 'rimosso flag still in DB after month switch');
    assert.deepEqual(arr[0].livelliRimossi, ['S3'], 'livelliRimossi still in DB after month switch');
    assert.equal(arr[0].targetS3, 40, 'values still preserved');

    // Ripristina il blocco: i valori conservati tornano e S3 resta rimosso.
    await page.getByTestId(`button-ripristina-energia-rs-${RS}`).click();
    await targetS1.waitFor({ state: 'visible', timeout: 10000 });
    assert.equal(await targetS1.inputValue(), '15', 'restored block keeps values after month round-trip');
    assert.equal(await page.getByTestId(`input-energia-rs-targetS3-${RS}`).count(), 0, 'removed row stays hidden after month round-trip');
    await page.getByTestId(`button-ripristina-energia-rs-livello-S3-${RS}`).waitFor({ state: 'visible' });

    await page.close();
    await context.close();
  } finally {
    await browser.close().catch(() => {});
    await cleanupOrg(pool, session);
    await pool.end().catch(() => {});
  }
});

test('restoring a revision containing removals keeps rimosso/livelliRimossi and preserved values', async () => {
  const pool = await newPool();
  const session = await signup({ prefix: 'gara_rimov_rev', fullName: 'Gara Rimovibili Rev UI', organizationName: uniq('GaraRimovRevUI') });
  const browser = await launchBrowser();
  try {
    const baseConfig = {
      pdvList: [PDV],
      tipologiaGara: 'gara_operatore_rs',
      modalitaInserimentoRS: 'per_rs',
    };
    // v1: blocco Energia RIMOSSO + livello S3 rimosso, valori conservati.
    const created = await jsonReq(`${BASE}/api/gara-config`, authed(session, {
      method: 'PUT',
      body: JSON.stringify({
        month: MONTH, year: YEAR, name: 'V1 con rimozioni',
        config: {
          ...baseConfig,
          energiaRSConfig: { configPerRS: [{ ...ENERGIA_RS, rimosso: true, livelliRimossi: ['S3'] }] },
        },
      }),
    }));
    assert.equal(created.status, 200, JSON.stringify(created.body));
    const configId = created.body.id;

    // v2: blocco attivo (nessuna rimozione) => la v1 finisce archiviata.
    const updated = await jsonReq(`${BASE}/api/gara-config`, authed(session, {
      method: 'PUT',
      body: JSON.stringify({
        month: MONTH, year: YEAR, name: 'V2 senza rimozioni', id: configId,
        config: {
          ...baseConfig,
          energiaRSConfig: { configPerRS: [{ ...ENERGIA_RS }] },
        },
      }),
    }));
    assert.equal(updated.status, 200, JSON.stringify(updated.body));

    const revList = await jsonReq(`${BASE}/api/gara-config/revisions?configId=${configId}`, authed(session));
    assert.equal(revList.status, 200);
    assert.equal(revList.body.length, 1, 'exactly one archived revision (v1) expected');
    const revId = revList.body[0].id;

    // --- Apri la pagina: mostra la v2, blocco attivo e editabile.
    const context = await newAuthedContext(browser, session);
    const page = await context.newPage();
    await page.goto(`${BASE}/configurazione-gara`, { waitUntil: 'networkidle' });
    await page.getByTestId('tab-extra').click();
    const targetS1 = page.getByTestId(`input-energia-rs-targetS1-${RS}`);
    await targetS1.waitFor({ state: 'visible', timeout: 20000 });

    // --- Storico -> revisioni -> ripristina la v1 (che contiene le rimozioni).
    await page.getByTestId('button-history').click();
    const revisionsBtn = page.getByTestId(`button-revisions-${configId}`);
    await revisionsBtn.waitFor({ state: 'visible', timeout: 10000 });
    await revisionsBtn.click();
    const restoreBtn = page.getByTestId(`button-restore-${revId}`);
    await restoreBtn.waitFor({ state: 'visible', timeout: 10000 });
    await restoreBtn.click();
    const confirmBtn = page.getByTestId('button-restore-confirm');
    await confirmBtn.waitFor({ state: 'visible', timeout: 10000 });
    await confirmBtn.click();
    await confirmBtn.waitFor({ state: 'hidden', timeout: 10000 });

    // --- La pagina ricarica lo stato ripristinato: il blocco è RIMOSSO
    // (banner visibile, inputs nascosti) SENZA reload manuale.
    await page.getByTestId('tab-extra').click();
    const banner = page.getByTestId(`banner-energia-rs-rimossa-${RS}`);
    await banner.waitFor({ state: 'visible', timeout: 20000 });
    assert.equal(await targetS1.count() === 0 || !(await targetS1.isVisible()), true, 'inputs hidden after restoring a revision with removals');

    // --- DB: flag e valori conservati, il loader non ha ricostruito i default.
    const cur = await pool.query(`SELECT name, config -> 'energiaRSConfig' -> 'configPerRS' AS c FROM gara_config WHERE id = $1`, [configId]);
    assert.equal(cur.rows[0].name, 'V1 con rimozioni');
    const arr = cur.rows[0].c;
    assert.equal(arr.length, 1, 'block record still present after restore');
    assert.equal(arr[0].rimosso, true, 'rimosso flag restored from revision');
    assert.deepEqual(arr[0].livelliRimossi, ['S3'], 'livelliRimossi restored from revision');
    assert.equal(arr[0].targetS3, 40, 'preserved values restored from revision');

    // --- Ripristino del blocco in pagina: valori conservati, S3 ancora rimosso.
    await page.getByTestId(`button-ripristina-energia-rs-${RS}`).click();
    await targetS1.waitFor({ state: 'visible', timeout: 10000 });
    assert.equal(await targetS1.inputValue(), '15', 'restored revision preserves block values');
    assert.equal(await page.getByTestId(`input-energia-rs-targetS3-${RS}`).count(), 0, 'removed row from revision stays hidden after block re-enable');
    await page.getByTestId(`button-ripristina-energia-rs-livello-S3-${RS}`).waitFor({ state: 'visible' });

    await page.close();
    await context.close();
  } finally {
    await browser.close().catch(() => {});
    await cleanupOrg(pool, session);
    await pool.end().catch(() => {});
  }
});

// --- Dashboard (Task #506): livello pista Energia rimosso (PS1–PS5 in
// livelliRimossi) => neutralizzaLivelliEnergia porta la soglia pista a
// Infinity: con volumi che supererebbero PS2 il bonus per contratto resta
// quello del livello PS1, senza fallback alle soglie default.
test('dashboard: removed Energia pista level (PS2) keeps the per-contract bonus at the lower level', async () => {
  const pool = await newPool();
  const session = await signup({ prefix: 'gara_rimov_ps', fullName: 'Gara Rimovibili Pista UI', organizationName: uniq('GaraRimovPistaUI') });
  const browser = await launchBrowser();
  try {
    // Blocchi identici per le due RS (target alti: nessun premio soglia, il
    // premio card è SOLO bonus pista): 2 pezzi superano pistaSoglia_S2=2.
    const mkEnergiaRS = (rs, extra = {}) => ({
      ragioneSociale: rs, pdvInGara: 1, targetNoMalus: 0,
      targetS1: 30, targetS2: 50, targetS3: 99,
      premioS1: 250, premioS2: 500, premioS3: 1000,
      pistaSoglia_S1: 1, pistaSoglia_S2: 2, pistaSoglia_S3: 90, pistaSoglia_S4: 95, pistaSoglia_S5: 99,
      ...extra,
    });
    const created = await jsonReq(`${BASE}/api/gara-config`, authed(session, {
      method: 'PUT',
      body: JSON.stringify({
        month: MONTH, year: YEAR, name: 'Config rimovibili pista energia',
        config: {
          pdvList: [PDV, PDV_B],
          tipologiaGara: 'gara_operatore_rs',
          modalitaInserimentoRS: 'per_rs',
          // Bonus per contratto distintivi: S1=10, S2=100. Con PS2 rimosso la
          // RS "CMS SRL" deve valere 10 €/contratto, non 100.
          // Compensi base azzerati: il premio card resta SOLO bonus pista.
          tabelleCalcolo: {
            energia: {
              bonusPerContratto: { S1: 10, S2: 100, S3: 15, S4: 30, S5: 45 },
              compensiBase: {
                CONSUMER_CON_SDD: 0, CONSUMER_NO_SDD: 0, BUSINESS_CON_SDD: 0, BUSINESS_NO_SDD: 0,
                CONSUMER_CON_SDD_W3: 0, CONSUMER_NO_SDD_W3: 0, BUSINESS_CON_SDD_W3: 0, BUSINESS_NO_SDD_W3: 0,
              },
            },
          },
          energiaRSConfig: {
            configPerRS: [
              // RS "CMS SRL": livello pista PS2 RIMOSSO => resta al bonus PS1.
              mkEnergiaRS(RS, { livelliRimossi: ['PS2'] }),
              // RS "BETA STORE SRL": controllo — stessi volumi, PS2 attivo.
              mkEnergiaRS(RS_B),
            ],
          },
        },
      }),
    }));
    assert.equal(created.status, 200, JSON.stringify(created.body));

    // 2 contratti energia per ciascuna RS: volume >= pistaSoglia_S2 (2).
    for (const target of [
      { codicePos: PDV.codicePos, nomeNegozio: PDV.nome, ragioneSociale: RS },
      { codicePos: PDV_B.codicePos, nomeNegozio: PDV_B.nome, ragioneSociale: RS_B },
    ]) {
      await insertSaleArticoli(pool, session.orgId, { ...target, articoli: [artEnergiaSale], cliente: { clienteTipo: 'FISICA' } });
      await insertSaleArticoli(pool, session.orgId, { ...target, articoli: [artEnergiaSale], cliente: { clienteTipo: 'FISICA' } });
    }

    const context = await newAuthedContext(browser, session);
    const page = await context.newPage();
    await page.goto(`${BASE}/dashboard-gara-reale`, { waitUntil: 'networkidle' });

    const energiaCard = page.getByTestId('ticker-pista-energia');
    await energiaCard.waitFor({ state: 'visible', timeout: 30000 });

    // Premio card = RS con PS2 rimosso (bonus PS1: 10 × 2 = 20) + RS di
    // controllo (bonus PS2: 100 × 2 = 200) = 220 €. Un regresso in
    // neutralizzaLivelliEnergia (PS2 che "rientra") darebbe 400 €.
    // Sanity sul volume: 2 pezzi per RS (>= pistaSoglia_S2), 4 totali.
    await page.getByTestId('ticker-toggle-energia').click();
    const pezziTxt = (await page.getByTestId('prov-totale-pezzi-energia').innerText()).trim();
    assert.match(pezziTxt, /^4\s*pz$/, `2 pezzi per RS, 4 totali (got "${pezziTxt}")`);

    const premioTxt = (await page.getByTestId('ticker-premio-energia').innerText()).trim();
    const premio = Number(premioTxt.replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.'));
    assert.equal(premio, 220, `PS2 rimosso => bonus pista al livello inferiore PS1 (got "${premioTxt}")`);

    // Nessun marker sul ticker mostra la soglia pista rimossa (valore 2):
    // i marker energia restano i target S1/S2/S3 (30/50/99).
    const markerValues = await page
      .locator('[data-testid^="ticker-threshold-energia-"]')
      .evaluateAll(els => els.map(el => el.getAttribute('data-threshold-value')));
    assert.ok(!markerValues.includes('2'), `nessun marker con la soglia pista rimossa (got ${JSON.stringify(markerValues)})`);

    await page.close();
    await context.close();
  } finally {
    await browser.close().catch(() => {});
    await cleanupOrg(pool, session);
    await pool.end().catch(() => {});
  }
});

// --- Preventivatore (Task #501): una RS con blocco ENERGIA rimosso non deve
// concorrere al premio totale in modalità per_rs (né base, né soglia, né pista).
test('Preventivatore excludes a removed Energia RS block from premi', async () => {
  const pool = await newPool();
  const session = await signup({ prefix: 'gara_rimov_pen', fullName: 'Gara Rimovibili Prev Energia UI', organizationName: uniq('GaraRimovPrevEnUI') });
  const browser = await launchBrowser();
  try {
    const pdvA = { ...PDV, abilitaAssicurazioni: false };
    const pdvB = { ...PDV, id: 'pdv-2', codicePos: 'POS002', nome: 'Negozio Due', ragioneSociale: RS_B, abilitaAssicurazioni: false };
    // 1 contratto CONSUMER_NO_SDD per RS: base 55 € + soglia S1 (target 1 => 250 €)
    // = 305 € a RS (nessun bonus pista sotto i default). Con la rimozione
    // onorata il totale è 305 € (solo la RS attiva); senza fix sarebbe 610 €.
    const rigaEnergia = [{ id: 'r1', category: 'CONSUMER_NO_SDD', pezzi: 1 }];
    const preventivoData = {
      step: 0,
      configGara: { nomeGara: 'Test rimozioni energia', haLetteraUfficiale: false, annoGara: YEAR, meseGara: MONTH, tipoPeriodo: 'mensile', tipologiaGara: 'gara_operatore_rs' },
      numeroPdv: 2,
      puntiVendita: [pdvA, pdvB],
      modalitaInserimentoRS: 'per_rs',
      energiaConfig: { pdvInGara: 1, targetNoMalus: 0, targetS1: 1, targetS2: 99, targetS3: 999 },
      attivatoEnergiaByRS: {
        [RS]: rigaEnergia,
        [RS_B]: rigaEnergia,
      },
      // Blocco Energia della RS "CMS SRL" rimosso in Config Gara.
      energiaRSConfig: {
        configPerRS: [
          { ragioneSociale: RS, pdvInGara: 1, targetNoMalus: 0, targetS1: 1, targetS2: 99, targetS3: 999, rimosso: true },
          { ragioneSociale: RS_B, pdvInGara: 1, targetNoMalus: 0, targetS1: 1, targetS2: 99, targetS3: 999 },
        ],
      },
    };
    const created = await jsonReq(`${BASE}/api/preventivi`, authed(session, {
      method: 'POST',
      body: JSON.stringify({ name: 'Preventivo rimozioni energia', data: preventivoData }),
    }));
    assert.equal(created.status, 201, JSON.stringify(created.body));

    const context = await newAuthedContext(browser, session);
    const page = await context.newPage();
    await page.goto(`${BASE}/preventivatore?id=${created.body.id}`, { waitUntil: 'networkidle' });

    await page.getByTestId('text-premio-totale').first().waitFor({ state: 'attached', timeout: 30000 });
    await page.waitForFunction(() => {
      const el = document.querySelector('[data-testid="text-premio-totale"]');
      return el && /\d/.test(el.textContent || '');
    }, { timeout: 15000 });
    const txt = ((await page.getByTestId('text-premio-totale').first().textContent()) || '').trim();
    const num = Number(txt.replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.'));
    assert.equal(num, 305, `premio totale energia esclude la RS rimossa (got "${txt}")`);

    await page.close();
    await context.close();
  } finally {
    await browser.close().catch(() => {});
    await cleanupOrg(pool, session);
    await pool.end().catch(() => {});
  }
});

// --- Task #507: il Preventivatore in modalità per_rs deve ignorare anche i
// blocchi MOBILE / FISSO / PARTNERSHIP rimossi (gate isPartnershipRSRimossa e
// i find `!rimosso` su sogliePerRS), non solo Energia/Assicurazioni.
// Pattern comune: due RS con attivazioni identiche, blocco rimosso su una;
// text-premio-totale deve contare SOLO la RS attiva (metà del totale pieno).

// Legge il premio totale dal riepilogo (prima copia attached, mobile o sidebar).
async function readPremioTotale(page) {
  await page.getByTestId('text-premio-totale').first().waitFor({ state: 'attached', timeout: 30000 });
  await page.waitForFunction(() => {
    const el = document.querySelector('[data-testid="text-premio-totale"]');
    return el && /\d/.test(el.textContent || '');
  }, { timeout: 15000 });
  const txt = ((await page.getByTestId('text-premio-totale').first().textContent()) || '').trim();
  return { txt, num: Number(txt.replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.')) };
}

test('Preventivatore excludes a removed Mobile RS block from premi', async () => {
  const pool = await newPool();
  const session = await signup({ prefix: 'gara_rimov_pmb', fullName: 'Gara Rimovibili Prev Mobile UI', organizationName: uniq('GaraRimovPrevMobUI') });
  const browser = await launchBrowser();
  try {
    const pdvA = { ...PDV, abilitaEnergia: false, abilitaAssicurazioni: false };
    const pdvB = { ...PDV, id: 'pdv-2', codicePos: 'POS002', nome: 'Negozio Due', ragioneSociale: RS_B, abilitaEnergia: false, abilitaAssicurazioni: false };
    // 10 TIED per RS: gettone contrattuale 5 €/pezzo = 50 € a RS, indipendente
    // dalle soglie (canoneMedio 0 => premioCanone 0, nessun extra gettone).
    const righeMobile = [{ id: 'm1', type: 'TIED', pezzi: 10 }];
    const preventivoData = {
      step: 0,
      configGara: { nomeGara: 'Test rimozioni mobile', haLetteraUfficiale: false, annoGara: YEAR, meseGara: MONTH, tipoPeriodo: 'mensile', tipologiaGara: 'gara_operatore_rs' },
      numeroPdv: 2,
      puntiVendita: [pdvA, pdvB],
      modalitaInserimentoRS: 'per_rs',
      attivatoMobileByRS: {
        [RS]: righeMobile,
        [RS_B]: righeMobile,
      },
      // Blocco Mobile della RS "CMS SRL" rimosso in Config Gara.
      pistaMobileRSConfig: {
        applicaDecurtazione30SeNoFissoO8Piva: true,
        sogliePerRS: [
          { ragioneSociale: RS, soglia1: 100, soglia2: 200, soglia3: 300, soglia4: 400, canoneMedio: 0, rimosso: true },
          { ragioneSociale: RS_B, soglia1: 100, soglia2: 200, soglia3: 300, soglia4: 400, canoneMedio: 0 },
        ],
      },
    };
    const created = await jsonReq(`${BASE}/api/preventivi`, authed(session, {
      method: 'POST',
      body: JSON.stringify({ name: 'Preventivo rimozioni mobile', data: preventivoData }),
    }));
    assert.equal(created.status, 201, JSON.stringify(created.body));

    const context = await newAuthedContext(browser, session);
    const page = await context.newPage();
    await page.goto(`${BASE}/preventivatore?id=${created.body.id}`, { waitUntil: 'networkidle' });

    // Con la rimozione onorata il totale è solo la RS attiva: 50 €.
    // Senza fix sarebbe 100 € (entrambe le RS).
    const { txt, num } = await readPremioTotale(page);
    assert.equal(num, 50, `premio totale mobile esclude la RS rimossa (got "${txt}")`);

    await page.close();
    await context.close();
  } finally {
    await browser.close().catch(() => {});
    await cleanupOrg(pool, session);
    await pool.end().catch(() => {});
  }
});

test('Preventivatore excludes a removed Fisso RS block from premi', async () => {
  const pool = await newPool();
  const session = await signup({ prefix: 'gara_rimov_pfs', fullName: 'Gara Rimovibili Prev Fisso UI', organizationName: uniq('GaraRimovPrevFisUI') });
  const browser = await launchBrowser();
  try {
    const pdvA = { ...PDV, abilitaEnergia: false, abilitaAssicurazioni: false };
    const pdvB = { ...PDV, id: 'pdv-2', codicePos: 'POS002', nome: 'Negozio Due', ragioneSociale: RS_B, abilitaEnergia: false, abilitaAssicurazioni: false };
    // 2 Migrazioni FTTH/FWA per RS: 80 €/pezzo (40 € gettone + 40 € euro/pezzo)
    // = 160 € a RS; 0 punti => nessun moltiplicatore soglia, valore deterministico.
    const righeFisso = [{ categoria: 'MIGRAZIONI_FTTH_FWA', pezzi: 2 }];
    const preventivoData = {
      step: 0,
      configGara: { nomeGara: 'Test rimozioni fisso', haLetteraUfficiale: false, annoGara: YEAR, meseGara: MONTH, tipoPeriodo: 'mensile', tipologiaGara: 'gara_operatore_rs' },
      numeroPdv: 2,
      puntiVendita: [pdvA, pdvB],
      modalitaInserimentoRS: 'per_rs',
      attivatoFissoByRS: {
        [RS]: righeFisso,
        [RS_B]: righeFisso,
      },
      // Blocco Fisso della RS "CMS SRL" rimosso in Config Gara.
      pistaFissoRSConfig: {
        sogliePerRS: [
          { ragioneSociale: RS, soglia1: 100, soglia2: 200, soglia3: 300, soglia4: 400, soglia5: 500, rimosso: true },
          { ragioneSociale: RS_B, soglia1: 100, soglia2: 200, soglia3: 300, soglia4: 400, soglia5: 500 },
        ],
      },
    };
    const created = await jsonReq(`${BASE}/api/preventivi`, authed(session, {
      method: 'POST',
      body: JSON.stringify({ name: 'Preventivo rimozioni fisso', data: preventivoData }),
    }));
    assert.equal(created.status, 201, JSON.stringify(created.body));

    const context = await newAuthedContext(browser, session);
    const page = await context.newPage();
    await page.goto(`${BASE}/preventivatore?id=${created.body.id}`, { waitUntil: 'networkidle' });

    // Con la rimozione onorata il totale è solo la RS attiva: 160 €.
    // Senza fix sarebbe 320 € (entrambe le RS).
    const { txt, num } = await readPremioTotale(page);
    assert.equal(num, 160, `premio totale fisso esclude la RS rimossa (got "${txt}")`);

    await page.close();
    await context.close();
  } finally {
    await browser.close().catch(() => {});
    await cleanupOrg(pool, session);
    await pool.end().catch(() => {});
  }
});

test('Preventivatore excludes a removed Partnership RS block from premi', async () => {
  const pool = await newPool();
  const session = await signup({ prefix: 'gara_rimov_ppr', fullName: 'Gara Rimovibili Prev Partnership UI', organizationName: uniq('GaraRimovPrevParUI') });
  const browser = await launchBrowser();
  try {
    const pdvA = { ...PDV, abilitaEnergia: false, abilitaAssicurazioni: false };
    const pdvB = { ...PDV, id: 'pdv-2', codicePos: 'POS002', nome: 'Negozio Due', ragioneSociale: RS_B, abilitaEnergia: false, abilitaAssicurazioni: false };
    // Un effetto del Preventivatore ri-sincronizza target100/target80 dai
    // default cluster CB (fallback 300/240 punti): i target seminati vengono
    // sovrascritti, quindi servono abbastanza punti da superare il default.
    // 1 evento CB da 400 punti partnership per RS => premio100 500 € a RS
    // (gettoni 0, così nessun altro contributo al totale).
    const righeCB = [{ eventType: 'CAMBIO_PIANO_CONSUMER', pezzi: 1, gettoni: 0, puntiPartnership: 400 }];
    const partnershipConf = { target100: 1, target80: 1, premio100: 500, premio80: 400 };
    const preventivoData = {
      step: 0,
      configGara: { nomeGara: 'Test rimozioni partnership', haLetteraUfficiale: false, annoGara: YEAR, meseGara: MONTH, tipoPeriodo: 'mensile', tipologiaGara: 'gara_operatore_rs' },
      numeroPdv: 2,
      puntiVendita: [pdvA, pdvB],
      modalitaInserimentoRS: 'per_rs',
      partnershipRewardConfig: {
        configPerPos: [
          { posCode: 'POS001', config: partnershipConf },
          { posCode: 'POS002', config: partnershipConf },
        ],
      },
      attivatoCBByRS: {
        [RS]: righeCB,
        [RS_B]: righeCB,
      },
      // Blocco Partnership della RS "CMS SRL" rimosso in Config Gara.
      partnershipRewardRSConfig: {
        configPerRS: [
          { ragioneSociale: RS, ...partnershipConf, rimosso: true },
          { ragioneSociale: RS_B, ...partnershipConf },
        ],
      },
    };
    const created = await jsonReq(`${BASE}/api/preventivi`, authed(session, {
      method: 'POST',
      body: JSON.stringify({ name: 'Preventivo rimozioni partnership', data: preventivoData }),
    }));
    assert.equal(created.status, 201, JSON.stringify(created.body));

    const context = await newAuthedContext(browser, session);
    const page = await context.newPage();
    await page.goto(`${BASE}/preventivatore?id=${created.body.id}`, { waitUntil: 'networkidle' });

    // Con la rimozione onorata il totale è solo la RS attiva: 500 €.
    // Senza fix sarebbe 1000 € (entrambe le RS).
    const { txt, num } = await readPremioTotale(page);
    assert.equal(num, 500, `premio totale partnership esclude la RS rimossa (got "${txt}")`);

    await page.close();
    await context.close();
  } finally {
    await browser.close().catch(() => {});
    await cleanupOrg(pool, session);
    await pool.end().catch(() => {});
  }
});
