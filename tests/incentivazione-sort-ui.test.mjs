import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  BASE,
  uniq,
  signup,
  newPool,
  launchBrowser,
  newAuthedContext,
  seedValenze,
  cleanupOrg,
} from './helpers/uiTest.mjs';

// Test suite UI Playwright per l'ordinamento degli addetti nella pagina
// Incentivazione interna (Task #226).
//
// Perché serve un test UI e non solo logica pura: `sortEmps`
// (shared/incentivazione.ts) è già coperta dai test puri di
// `incentivazione.test.mjs`. Quello che NON è coperto è il wiring React fra i
// controlli (`select-sort-key`, `button-sort-dir`, `button-reset-filters`) e la
// griglia di schede renderizzata: la scelta del criterio + il toggle della
// direzione che si combinano con i filtri (stato/sblocco/ricerca), il reset che
// riporta a Stato/desc, e il fallback a "Stato" quando si cambia sezione e la
// pista scelta non esiste in quella sezione (`effectiveSortKey`). Una
// regressione di questo wiring (es. l'ordine non applicato, il filtro che
// azzera l'ordine, o un crash al cambio sezione) passerebbe inosservata.
//
// Strategia: signup crea un profilo admin + org (il modulo
// `incentivazione_interna` è abilitato di default). La config NON viene seminata
// — la pagina usa `defaultConfig`, che ha le sezioni W3/Vodafone già "ready".
// Seminiamo SOLO le righe valenze via SQL (`incentivazione_valenze`) con valori
// `mobile`/`fisso_pt` deterministici, così l'ordine atteso per pista è
// prevedibile (la chiave di sort per pista è il valore attuale, indipendente dal
// calendario). Iniettiamo il cookie di sessione nel browser Playwright e
// guidiamo la UI. Cleanup completo del dev DB alla fine.
//
// NB: la pagina apre di default sul mese/anno correnti, quindi seminiamo le
// valenze per lo stesso mese/anno di "now" sulla macchina di test.

const now = new Date();
const MONTH = now.getMonth() + 1;
const YEAR = now.getFullYear();

// Periodo PASSATO (Gennaio dell'anno scorso) usato dallo scenario 2: in un mese
// interamente trascorso il calendario ha `el == tot`, quindi proiezione == valore
// attuale e gli stati semaforo diventano DETERMINISTICI (g se valore>=target,
// altrimenti r — mai "a"). Così l'ordinamento per "Stato" del fallback è
// prevedibile. `select-year` espone sempre [annoCorrente-1, corrente, +1].
const PAST_MONTH = 1;
const PAST_MONTH_NAME = 'Gennaio';
const PAST_YEAR = YEAR - 1;

// Token univoco condiviso dai nomi addetto per evitare collisioni fra run.
// I tre addetti della sezione W3 condividono il cognome "ROSSI"/"VERDI" così la
// ricerca "rossi" ne seleziona un sottoinsieme deterministico.
const TAG = crypto.randomBytes(3).toString('hex').toUpperCase();
const ALFA = `ROSSI ALFA ${TAG}`; // mobile = 10
const BETA = `ROSSI BETA ${TAG}`; // mobile = 30
const GAMMA = `VERDI GAMMA ${TAG}`; // mobile = 20

// Addetti della sezione Vodafone (per il test di fallback al cambio sezione).
// I valori di "fisso_pt" (target 20) sono scelti così che l'ordine per STATO
// differisca dall'ordine per NOME, rendendo rilevabile una regressione del
// fallback: con mese passato (el==tot) UNO (5 < 20) => semaforo "r", DUE
// (25 >= 20) => semaforo "g". Ordine per Stato/desc (peggiori prima) =
// [UNO(r), DUE(g)]; ordine per nome (it) = [DUE, UNO] ("BIANCHI DUE" < "...UNO").
// Se il fallback NON scattasse e restasse la pista "mobile" (assente in VDF =>
// tutti i valori null => tie-break per nome) l'ordine sarebbe [DUE, UNO]: la
// nostra asserzione [UNO, DUE] coglie quindi la differenza.
const VDF_UNO = `BIANCHI UNO ${TAG}`; // fisso_pt = 5  -> "r"
const VDF_DUE = `BIANCHI DUE ${TAG}`; // fisso_pt = 25 -> "g"

// Legge i data-testid delle schede addetto NELL'ORDINE in cui compaiono nel DOM
// e ne estrae il nome (suffisso dopo "card-addetto-").
async function cardOrder(page) {
  const cards = await page.locator('[data-testid^="card-addetto-"]').all();
  const ids = await Promise.all(cards.map((c) => c.getAttribute('data-testid')));
  return ids.map((id) => (id || '').replace(/^card-addetto-/, ''));
}

// Apre la pagina Incentivazione interna autenticata e attende le schede W3.
async function openPage(context) {
  const page = await context.newPage();
  await page.goto(`${BASE}/incentivazione-interna`, { waitUntil: 'networkidle' });
  await page.getByTestId(`card-addetto-${ALFA}`).waitFor({ state: 'visible', timeout: 20000 });
  return page;
}

// ===========================================================================
// SCENARIO 1: scelta criterio pista + toggle direzione + filtro convivono,
// poi "Azzera filtri" ripristina Stato/desc e tutte le schede.
// ===========================================================================
test('scenario 1: pista sort + direction toggle coexist with a filter, reset restores Stato/desc', async () => {
  const pool = await newPool();
  const session = await signup({ prefix: 'inc_sort_ui', fullName: 'Inc Sort UI Test', organizationName: uniq('IncSortUI') });
  const browser = await launchBrowser();
  try {
    await seedValenze(pool, session.orgId, {
      month: MONTH,
      year: YEAR,
      sectionId: 'ss_w3',
      rows: [
        { name: ALFA, mobile: 10 },
        { name: BETA, mobile: 30 },
        { name: GAMMA, mobile: 20 },
      ],
    });

    const context = await newAuthedContext(browser, session);
    const page = await openPage(context);

    // Tutte e tre le schede sono presenti all'avvio.
    let order = await cardOrder(page);
    assert.equal(order.length, 3, 'three addetto cards must be rendered initially');
    assert.ok(order.includes(ALFA) && order.includes(BETA) && order.includes(GAMMA));

    // --- Ordina per la pista "mobile" (default dir = desc): valori alti prima.
    await page.getByTestId('select-sort-key').click();
    await page.getByTestId('option-sort-mobile').click();
    await assert.doesNotReject(async () => {
      await page.waitForFunction(
        (beta) => {
          const cards = Array.from(document.querySelectorAll('[data-testid^="card-addetto-"]'));
          return cards.length > 0 && cards[0].getAttribute('data-testid') === `card-addetto-${beta}`;
        },
        BETA,
        { timeout: 10000 },
      );
    }, 'BETA (mobile 30) must sort first when sorting by mobile desc');
    order = await cardOrder(page);
    assert.deepEqual(order, [BETA, GAMMA, ALFA], 'mobile desc order: 30, 20, 10');

    // --- Inverti la direzione (desc -> asc): valori bassi prima.
    await page.getByTestId('button-sort-dir').click();
    await page.waitForFunction(
      (alfa) => {
        const cards = Array.from(document.querySelectorAll('[data-testid^="card-addetto-"]'));
        return cards.length > 0 && cards[0].getAttribute('data-testid') === `card-addetto-${alfa}`;
      },
      ALFA,
      { timeout: 10000 },
    );
    order = await cardOrder(page);
    assert.deepEqual(order, [ALFA, GAMMA, BETA], 'mobile asc order: 10, 20, 30');

    // --- Applica un filtro di ricerca: deve CONVIVERE con l'ordinamento.
    // "rossi" tiene solo ALFA e BETA; l'ordine asc per mobile resta (ALFA<BETA).
    await page.getByTestId('input-search-addetto').fill('rossi');
    await page.waitForFunction(
      () => Array.from(document.querySelectorAll('[data-testid^="card-addetto-"]')).length === 2,
      null,
      { timeout: 10000 },
    );
    order = await cardOrder(page);
    assert.deepEqual(order, [ALFA, BETA], 'filter + sort coexist: only ROSSI cards, still mobile asc');
    assert.ok(!order.includes(GAMMA), 'VERDI GAMMA must be filtered out by the search');

    // --- "Azzera filtri" ripristina Stato/desc e rimuove la ricerca.
    await page.getByTestId('button-reset-filters').click();
    await page.waitForFunction(
      () => Array.from(document.querySelectorAll('[data-testid^="card-addetto-"]')).length === 3,
      null,
      { timeout: 10000 },
    );
    // La ricerca è svuotata.
    assert.equal(
      await page.getByTestId('input-search-addetto').inputValue(),
      '', 'search must be cleared after reset',
    );
    // Il criterio torna a "Stato".
    assert.equal(
      (await page.getByTestId('select-sort-key').innerText()).trim(),
      'Stato', 'sort key must reset to Stato',
    );
    // La direzione torna a desc (la freccia giù è l'icona del bottone) e il
    // bottone "Azzera filtri" sparisce perché lo stato è quello di default.
    assert.equal(
      await page.getByTestId('button-reset-filters').count(),
      0, 'reset button must disappear once filters are back to default',
    );

    await page.close();
    await context.close();
  } finally {
    await browser.close().catch(() => {});
    await cleanupOrg(pool, session);
    await pool.end().catch(() => {});
  }
});

// ===========================================================================
// SCENARIO 2: cambiando sezione, un criterio-pista non valido nella nuova
// sezione ricade su "Stato" senza crash (effectiveSortKey).
// ===========================================================================
test('scenario 2: switching section falls back to Stato when the pista key is invalid (no crash)', async () => {
  const pool = await newPool();
  const session = await signup({ prefix: 'inc_sort_ui', fullName: 'Inc Sort UI Test', organizationName: uniq('IncSortUI') });
  const browser = await launchBrowser();
  try {
    // Operiamo su un mese PASSATO (Gennaio anno scorso) così gli stati semaforo
    // sono deterministici (el==tot) e l'ordine per "Stato" è prevedibile.
    // Valenze per W3 (con pista "mobile") e per Vodafone (senza pista "mobile",
    // ma con "fisso_pt"): il criterio "mobile" è valido solo in W3.
    await seedValenze(pool, session.orgId, {
      month: PAST_MONTH,
      year: PAST_YEAR,
      sectionId: 'ss_w3',
      rows: [
        { name: ALFA, mobile: 10 },
        { name: BETA, mobile: 30 },
        { name: GAMMA, mobile: 20 },
      ],
    });
    await seedValenze(pool, session.orgId, {
      month: PAST_MONTH,
      year: PAST_YEAR,
      sectionId: 'ss_vdf',
      rows: [
        { name: VDF_UNO, fisso_pt: 5 },  // < 20 -> "r"
        { name: VDF_DUE, fisso_pt: 25 }, // >= 20 -> "g"
      ],
    });

    const context = await newAuthedContext(browser, session);
    const page = await context.newPage();
    await page.goto(`${BASE}/incentivazione-interna`, { waitUntil: 'networkidle' });

    // Porta la pagina sul periodo passato seminato e attendi le schede W3.
    await page.getByTestId('select-month').click();
    await page.getByRole('option', { name: PAST_MONTH_NAME, exact: true }).click();
    await page.getByTestId('select-year').click();
    await page.getByRole('option', { name: String(PAST_YEAR), exact: true }).click();
    await page.getByTestId(`card-addetto-${ALFA}`).waitFor({ state: 'visible', timeout: 20000 });

    // Ordina la sezione W3 per la pista "mobile" (default dir = desc).
    await page.getByTestId('select-sort-key').click();
    await page.getByTestId('option-sort-mobile').click();
    await page.waitForFunction(
      (beta) => {
        const cards = Array.from(document.querySelectorAll('[data-testid^="card-addetto-"]'));
        return cards.length > 0 && cards[0].getAttribute('data-testid') === `card-addetto-${beta}`;
      },
      BETA,
      { timeout: 10000 },
    );

    // Cambia sezione su Vodafone: "mobile" non è una pista valida lì.
    // effectiveSortKey deve ricadere su "Stato" SENZA crash e le schede della
    // sezione Vodafone devono renderizzare regolarmente.
    await page.getByTestId('tab-ss_vdf').click();
    await page.getByTestId(`card-addetto-${VDF_UNO}`).waitFor({ state: 'visible', timeout: 15000 });
    await page.getByTestId(`card-addetto-${VDF_DUE}`).waitFor({ state: 'visible', timeout: 15000 });

    let vdfOrder = await cardOrder(page);
    assert.equal(vdfOrder.length, 2, 'Vodafone section must render its two cards after the section switch');
    assert.ok(vdfOrder.includes(VDF_UNO) && vdfOrder.includes(VDF_DUE), 'no W3 card should leak into the Vodafone section');
    // Nessuna scheda W3 residua.
    assert.equal(
      await page.getByTestId(`card-addetto-${ALFA}`).count(),
      0, 'W3 cards must not be visible in the Vodafone section',
    );

    // --- ASSERZIONE DI FALLBACK (semantica, non solo "no crash"):
    // il sort effettivo è ora per "Stato/desc" (peggiori prima), NON per la
    // pista "mobile" rimasta nello stato. Atteso [UNO(r), DUE(g)]. Questo ordine
    // differisce dall'ordine per nome [DUE, UNO] che si otterrebbe se il
    // fallback non scattasse (pista assente => tie-break per nome): una
    // regressione del fallback sarebbe quindi rilevata.
    assert.deepEqual(
      vdfOrder, [VDF_UNO, VDF_DUE],
      'fallback to Stato/desc: worst status (r) first — distinct from name order [DUE, UNO]',
    );

    // --- Conferma che l'ordinamento attivo RISPONDE alla direzione (prova che è
    // davvero un sort per "Stato", non un ordine per nome invariante): invertendo
    // a "asc" i migliori vengono prima => [DUE(g), UNO(r)].
    await page.getByTestId('button-sort-dir').click();
    await page.waitForFunction(
      (due) => {
        const cards = Array.from(document.querySelectorAll('[data-testid^="card-addetto-"]'));
        return cards.length === 2 && cards[0].getAttribute('data-testid') === `card-addetto-${due}`;
      },
      VDF_DUE,
      { timeout: 10000 },
    );
    vdfOrder = await cardOrder(page);
    assert.deepEqual(
      vdfOrder, [VDF_DUE, VDF_UNO],
      'Stato/asc: best status (g) first — sort responds to direction (no crash)',
    );

    await page.close();
    await context.close();
  } finally {
    await browser.close().catch(() => {});
    await cleanupOrg(pool, session);
    await pool.end().catch(() => {});
  }
});
