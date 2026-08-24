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

    // --- Rimuovi un singolo livello (S3): input disabilitato.
    await page.getByTestId(`button-energia-rs-livello-S3-${RS}`).click();
    const targetS3 = page.getByTestId(`input-energia-rs-targetS3-${RS}`);
    assert.equal(await targetS3.isDisabled(), true, 'removed level S3 input is disabled');

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
    assert.equal(await page.getByTestId(`input-energia-rs-targetS3-${RS}`).isDisabled(), true, 'level removal survives block restore');

    // Riattiva anche il livello S3.
    await page.getByTestId(`button-energia-rs-livello-S3-${RS}`).click();
    assert.equal(await page.getByTestId(`input-energia-rs-targetS3-${RS}`).isDisabled(), false, 'level can be re-enabled');

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
