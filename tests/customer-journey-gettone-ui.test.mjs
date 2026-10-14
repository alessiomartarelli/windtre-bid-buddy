import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import {
  BASE,
  uniq,
  signup,
  newPool,
  launchBrowser,
  newAuthedContext,
  setRole,
  seedJourney,
  setCjTriggerDate,
  cleanupOrg,
} from './helpers/uiTest.mjs';
const { CJ_NO_DESTINATION_FILTER_VALUE } = await import('../shared/customerJourney.ts');
const XLSXmod = await import('xlsx');
const XLSX = XLSXmod.default ?? XLSXmod;

function pdfTextTokens(buf) {
  const raw = buf.toString('latin1');
  const tokens = [];
  const re = /\(((?:\\.|[^\\()])*)\)\s*Tj/g;
  let match;
  while ((match = re.exec(raw)) !== null) {
    tokens.push(match[1].replace(/\\([()\\])/g, '$1'));
  }
  return tokens;
}

// Test suite UI per l'espansione del dettaglio dell'Analisi gettoni
// (Task #194). Protegge da regressioni l'interazione di espansione/chiusura
// della riga PDV/addetto nella vista "Reportistica > Analisi gettoni" e
// l'isolamento per operatore di quella stessa vista.
//
// Task #195: estende la copertura a TUTTE le tabelle report interattive della
// Reportistica, non solo all'espansione della riga Addetto:
//   - scenario 1 espande ANCHE una riga nella dimensione NEGOZIO/PDV
//     (`button-gettone-dim-negozio`) e verifica la sua sotto-tabella, così una
//     regressione del solo ramo negozio non passa inosservata;
//   - scenario 3 copre la tab "Dettaglio" (ReportView): verifica che le righe
//     aggregate rendano i valori attesi e che il selettore di dimensione
//     (`button-report-dim-*`) funzioni (interazione che cambia il grouping).
//
// Perché serve un test UI e non solo logica pura: i builder gettone
// (`buildGettoneJourneys`, `simSaturationPct`, `gettoneDetailByKey`) sono già
// coperti dai test puri di `customer-journey-report.test.mjs`. Quello che NON
// è coperto è il rendering React: il toggle `useState` che apre/chiude la
// sotto-tabella in `AnalisiView` e la corretta proiezione delle colonne
// (Cliente / SIM attive / Piste attive / % saturazione / Fatturato). Una
// modifica accidentale a `AnalisiView` potrebbe rompere l'espansione o
// l'isolamento senza che nessun test puro se ne accorga.
//
// Strategia: signup crea un profilo `admin` + org (la route report richiede
// l'org). Seminiamo DIRETTAMENTE due journey con i loro item (mobile attiva +
// cross-sell) via SQL — è deterministico e dà pieno controllo su
// driver/stato/PDV/addetto, così i valori di saturazione/fatturato attesi
// sono prevedibili (il reconcile da BiSuite è già coperto altrove e la vista
// gettone consuma comunque l'output di `/api/customer-journeys/report`,
// identico nelle due strade). Iniettiamo il cookie di sessione nel browser
// Playwright e guidiamo la UI. Per l'isolamento mutiamo `role`/`bisuite_addetti`
// del profilo (la route rilegge il profilo ad ogni richiesta) e ricarichiamo
// la pagina. Cleanup completo del dev DB alla fine.
//
// Il boilerplate (chromium path, launch browser, signup + cookie injection,
// pool pg, seed/cleanup, setRole) vive ora in `tests/helpers/uiTest.mjs`,
// condiviso con gli altri test UI/DB-backed.

// Driver/stato attesi -> 2 piste cross-sell per Mario (energia + fisso) e 1
// per Luigi (energia). gettoneForPiste: [0,20,30,40,100,120], CJ_MAX_PISTE=5.
// Mario: 2 piste => fatturato 30€, saturazione 2/5 = 40%.
// Luigi: 1 pista  => fatturato 20€, saturazione 1/5 = 20%.
const MARIO_ADDETTO = `MARIO ROSSI ${crypto.randomBytes(3).toString('hex')}`.toUpperCase();
const LUIGI_ADDETTO = `LUIGI VERDI ${crypto.randomBytes(3).toString('hex')}`.toUpperCase();
// PDV univoci per testare la dimensione NEGOZIO senza collisioni di test-id.
const MARIO_PDV = `PDV MILANO ${crypto.randomBytes(3).toString('hex')}`.toUpperCase();
const LUIGI_PDV = `PDV ROMA ${crypto.randomBytes(3).toString('hex')}`.toUpperCase();
// Addetto/PDV dedicati allo scenario 4 (contratti annullati): hanno una pista
// cross-sell ATTIVA (energia) + una ANNULLATA (fisso). Se la vista contasse per
// errore l'annullato, Anna avrebbe 2 piste / 40% / 30€ invece di 1 / 20% / 20€.
const ANNA_ADDETTO = `ANNA NERI ${crypto.randomBytes(3).toString('hex')}`.toUpperCase();
const ANNA_PDV = `PDV TORINO ${crypto.randomBytes(3).toString('hex')}`.toUpperCase();
// Addetto/PDV dedicati allo scenario 7 (SIM mobile annullata): la journey ha la
// SIM mobile in stato "annullato" + cross-sell ATTIVI. Poiché la cohort gettone
// richiede simAttive >= 1, l'intera journey deve essere ESCLUSA dall'Analisi
// gettoni. Se la cohort la ammettesse per errore, Gina comparirebbe come riga.
const GINA_ADDETTO = `GINA BLU ${crypto.randomBytes(3).toString('hex')}`.toUpperCase();
const GINA_PDV = `PDV GENOVA ${crypto.randomBytes(3).toString('hex')}`.toUpperCase();

// Apre la pagina Customer Journey autenticata con il cookie di sessione e
// naviga fino alla vista Analisi gettoni raggruppata per addetto.
async function openAnalisiByAddetto(context) {
  const page = await context.newPage();
  await page.goto(`${BASE}/customer-journey`, { waitUntil: 'networkidle' });
  // Reportistica -> Analisi gettoni -> raggruppa per Addetto.
  await page.getByTestId('tab-report').click();
  await page.getByTestId('button-report-tab-analisi').click();
  await page.getByTestId('button-gettone-dim-addetto').click();
  return page;
}

// ---------------------------------------------------------------------------
// SCENARIO 1: admin — espansione/chiusura riga + sotto-tabella dettaglio.
// ---------------------------------------------------------------------------
test('scenario 1: admin can expand a gettone row and see the saturation detail', async () => {
  const pool = await newPool();
  const session = await signup({ prefix: 'cj_gettone_ui', fullName: 'CJ Gettone UI Test', organizationName: uniq('CJGettoneUI') });
  const browser = await launchBrowser();
  try {
    // Le journey sono seminate con data "now()": abbassiamo il trigger così
    // il floor dell'Analisi gettoni (SIM dal trigger in poi) non le esclude.
    await setCjTriggerDate(pool, session.orgId, '2026-01-01');
    const jMario = await seedJourney(pool, session.orgId, {
      customerKey: uniq('CFMARIO').toUpperCase(),
      nome: 'Cliente Mario',
      addetto: MARIO_ADDETTO,
      pdv: MARIO_PDV,
      items: [
        { driver: 'mobile', state: 'inserito' },
        { driver: 'energia', state: 'inserito', importo: '50.00' },
        { driver: 'fisso', state: 'inserito', importo: '20.00' },
      ],
    });
    await seedJourney(pool, session.orgId, {
      customerKey: uniq('CFLUIGI').toUpperCase(),
      nome: 'Cliente Luigi',
      addetto: LUIGI_ADDETTO,
      pdv: LUIGI_PDV,
      items: [
        { driver: 'mobile', state: 'inserito' },
        { driver: 'energia', state: 'inserito', importo: '30.00' },
      ],
    });

    const context = await newAuthedContext(browser, session);
    const page = await openAnalisiByAddetto(context);

    // Entrambe le righe addetto sono presenti.
    const marioRow = page.getByTestId(`row-gettone-${MARIO_ADDETTO}`);
    const luigiRow = page.getByTestId(`row-gettone-${LUIGI_ADDETTO}`);
    await marioRow.waitFor({ state: 'visible', timeout: 15000 });
    await luigiRow.waitFor({ state: 'visible', timeout: 15000 });

    // Valori aggregati attesi per la riga di Mario.
    assert.equal(
      (await page.getByTestId(`text-gettone-sim-${MARIO_ADDETTO}`).innerText()).trim(),
      '1', 'Mario row: 1 SIM attivata',
    );
    assert.equal(
      (await page.getByTestId(`text-gettone-clienti-${MARIO_ADDETTO}`).innerText()).trim(),
      '1', 'Mario row: 1 cliente',
    );
    assert.equal(
      (await page.getByTestId(`text-gettone-conprodotti-${MARIO_ADDETTO}`).innerText()).trim(),
      '1', 'Mario row: 1 cliente con cross-sell',
    );

    // Il dettaglio non è ancora aperto.
    assert.equal(
      await page.getByTestId(`row-gettone-detail-${MARIO_ADDETTO}`).count(),
      0, 'detail row must NOT exist before expanding',
    );

    // Espandi la riga di Mario.
    await marioRow.click();
    const detail = page.getByTestId(`row-gettone-detail-${MARIO_ADDETTO}`);
    await detail.waitFor({ state: 'visible', timeout: 10000 });

    // La sotto-tabella mostra la riga cliente con i valori attesi.
    const simRow = detail.getByTestId(`row-gettone-sim-${jMario}`);
    await simRow.waitFor({ state: 'visible', timeout: 10000 });
    assert.equal(
      (await detail.getByTestId(`text-gettone-sim-cliente-${jMario}`).innerText()).trim(),
      'Cliente Mario', 'detail row shows the customer name',
    );
    assert.equal(
      (await detail.getByTestId(`text-gettone-sim-saturazione-${jMario}`).innerText()).trim(),
      '40%', 'detail row shows 40% saturation (2/5 piste)',
    );
    // Verifica le intestazioni della sotto-tabella.
    const detailText = await detail.innerText();
    for (const h of ['Cliente', 'SIM attive', 'Piste attive', '% saturazione', 'Stimato', 'Incl. presunti']) {
      assert.ok(detailText.includes(h), `detail table must include header "${h}"`);
    }
    assert.ok(detailText.includes('2/5'), 'detail row shows 2/5 piste attive');
    const diagnostics = page.getByTestId('cj-sim-diagnostics');
    await diagnostics.waitFor({ state: 'visible' });
    assert.ok((await diagnostics.innerText()).includes('SIM valide nel periodo'));
    assert.ok((await diagnostics.innerText()).includes('Gettone calcolato su piste con esito positivo esplicito'));
    assert.ok((await diagnostics.innerText()).includes('non una prova di bonifico'));
    await page.setViewportSize({ width: 375, height: 812 });
    assert.ok(await diagnostics.evaluate(el => el.getBoundingClientRect().width <= 375), 'diagnostic card fits mobile');
    await diagnostics.getByRole('button', { name: 'Mostra contratti e articoli' }).click();
    assert.ok((await diagnostics.innerText()).includes('Esiti SIM dei clienti selezionati'));
    await diagnostics.getByRole('button', { name: 'Nascondi contratti e articoli' }).click();
    await page.setViewportSize({ width: 1280, height: 720 });

    // Richiudi la riga: la sotto-tabella sparisce.
    await marioRow.click();
    await detail.waitFor({ state: 'detached', timeout: 10000 });
    assert.equal(
      await page.getByTestId(`row-gettone-detail-${MARIO_ADDETTO}`).count(),
      0, 'detail row must be removed after collapsing',
    );

    // --- Dimensione NEGOZIO/PDV (Task #195): stessa interazione di espansione,
    // ma sul ramo `negozio` di AnalisiView, che la sola riga Addetto non copre.
    await page.getByTestId('button-gettone-dim-negozio').click();
    const milanoRow = page.getByTestId(`row-gettone-${MARIO_PDV}`);
    const romaRow = page.getByTestId(`row-gettone-${LUIGI_PDV}`);
    await milanoRow.waitFor({ state: 'visible', timeout: 15000 });
    await romaRow.waitFor({ state: 'visible', timeout: 15000 });

    // Valori aggregati attesi per il PDV di Mario (una journey, una SIM attiva).
    assert.equal(
      (await page.getByTestId(`text-gettone-sim-${MARIO_PDV}`).innerText()).trim(),
      '1', 'Milano PDV row: 1 SIM attivata',
    );
    assert.equal(
      (await page.getByTestId(`text-gettone-clienti-${MARIO_PDV}`).innerText()).trim(),
      '1', 'Milano PDV row: 1 cliente',
    );

    // Il dettaglio del negozio non è ancora aperto.
    assert.equal(
      await page.getByTestId(`row-gettone-detail-${MARIO_PDV}`).count(),
      0, 'negozio detail row must NOT exist before expanding',
    );

    // Espandi la riga del PDV di Mario.
    await milanoRow.click();
    const milanoDetail = page.getByTestId(`row-gettone-detail-${MARIO_PDV}`);
    await milanoDetail.waitFor({ state: 'visible', timeout: 10000 });

    // La sotto-tabella mostra la stessa journey con i valori attesi.
    const milanoSimRow = milanoDetail.getByTestId(`row-gettone-sim-${jMario}`);
    await milanoSimRow.waitFor({ state: 'visible', timeout: 10000 });
    assert.equal(
      (await milanoDetail.getByTestId(`text-gettone-sim-cliente-${jMario}`).innerText()).trim(),
      'Cliente Mario', 'negozio detail row shows the customer name',
    );
    assert.equal(
      (await milanoDetail.getByTestId(`text-gettone-sim-saturazione-${jMario}`).innerText()).trim(),
      '40%', 'negozio detail row shows 40% saturation (2/5 piste)',
    );
    const milanoDetailText = await milanoDetail.innerText();
    for (const h of ['Cliente', 'SIM attive', 'Piste attive', '% saturazione', 'Stimato', 'Incl. presunti']) {
      assert.ok(milanoDetailText.includes(h), `negozio detail table must include header "${h}"`);
    }
    assert.ok(milanoDetailText.includes('2/5'), 'negozio detail row shows 2/5 piste attive');

    // Richiudi: la sotto-tabella del negozio sparisce.
    await milanoRow.click();
    await milanoDetail.waitFor({ state: 'detached', timeout: 10000 });
    assert.equal(
      await page.getByTestId(`row-gettone-detail-${MARIO_PDV}`).count(),
      0, 'negozio detail row must be removed after collapsing',
    );

    // Le due card gettone aprono breakdown completi usando la stessa coorte e
    // il link cliente richiude il dialogo prima di aprire la scheda.
    await page.setViewportSize({ width: 375, height: 812 });
    await page.getByTestId('button-gettone-open-estimated-detail').click();
    const estimatedDialog = page.getByTestId('dialog-gettone-detail');
    await estimatedDialog.waitFor({ state: 'visible' });
    const estimatedText = await estimatedDialog.innerText();
    assert.ok(estimatedText.includes('Scaglioni del gettone base'));
    assert.ok(estimatedText.includes('Contratti ammissibili'));
    assert.ok(estimatedText.includes('T0–T5'));
    await estimatedDialog.getByTestId(`button-gettone-audit-open-${jMario}`).click();
    await page.getByTestId('button-back').waitFor({ state: 'visible', timeout: 10000 });
    await page.getByTestId('text-detail-title').waitFor({ state: 'visible', timeout: 15000 });
    assert.ok((await page.getByTestId('text-detail-title').innerText()).includes('Cliente Mario'));
    await page.getByTestId('button-back').click();
    await page.getByTestId('button-gettone-open-matured-detail').click();
    const maturedDialog = page.getByTestId('dialog-gettone-detail');
    await maturedDialog.waitFor({ state: 'visible' });
    const maturedText = await maturedDialog.innerText();
    assert.ok(maturedText.includes('Base da esiti espliciti'));
    assert.ok(maturedText.includes('Gettone confermato manualmente'));
    assert.ok(maturedText.includes('non prova un pagamento realmente ricevuto'));
    await page.keyboard.press('Escape');
    await maturedDialog.waitFor({ state: 'detached' });
    await page.setViewportSize({ width: 1280, height: 720 });

    await page.close();
    await context.close();
  } finally {
    await browser.close().catch(() => {});
    await cleanupOrg(pool, session);
    await pool.end().catch(() => {});
  }
});

// ---------------------------------------------------------------------------
// SCENARIO 2: operatore — vede SOLO i propri clienti nell'Analisi gettoni.
// ---------------------------------------------------------------------------
test('scenario 2: operator sees only their own clients in the gettone analysis', async () => {
  const pool = await newPool();
  const session = await signup({ prefix: 'cj_gettone_ui', fullName: 'CJ Gettone UI Test', organizationName: uniq('CJGettoneUI') });
  const browser = await launchBrowser();
  try {
    // Trigger abbassato: il floor dell'Analisi gettoni vale ANCHE per gli
    // operatori, quindi senza questo le journey "now()" verrebbero escluse.
    await setCjTriggerDate(pool, session.orgId, '2026-01-01');
    const operatorJourney = await seedJourney(pool, session.orgId, {
      customerKey: uniq('CFMARIO').toUpperCase(),
      nome: 'Cliente Mario',
      addetto: MARIO_ADDETTO,
      pdv: MARIO_PDV,
      items: [
        { driver: 'mobile', state: 'inserito' },
        { driver: 'energia', state: 'inserito', importo: '50.00' },
        { driver: 'fisso', state: 'inserito', importo: '20.00' },
      ],
    });
    await seedJourney(pool, session.orgId, {
      customerKey: uniq('CFLUIGI').toUpperCase(),
      nome: 'Cliente Luigi',
      addetto: LUIGI_ADDETTO,
      pdv: LUIGI_PDV,
      items: [
        { driver: 'mobile', state: 'inserito' },
        { driver: 'energia', state: 'inserito', importo: '30.00' },
      ],
    });

    // L'operatore è associato SOLO all'addetto di Mario (match case-insensitive).
    await setRole(pool, session.profileId, 'operatore', [MARIO_ADDETTO.toLowerCase()]);

    const context = await newAuthedContext(browser, session);
    const page = await openAnalisiByAddetto(context);

    // Vede la riga di Mario...
    await page.getByTestId(`row-gettone-${MARIO_ADDETTO}`).waitFor({ state: 'visible', timeout: 15000 });
    // ...e NON quella di Luigi (nessun leakage del tenant).
    assert.equal(
      await page.getByTestId(`row-gettone-${LUIGI_ADDETTO}`).count(),
      0, 'operator must NOT see Luigi gettone row',
    );

    // Solo una riga gettone totale presente.
    const allRows = await page.locator('[data-testid^="row-gettone-"]:not([data-testid^="row-gettone-detail-"]):not([data-testid^="row-gettone-sim-"])').count();
    assert.equal(allRows, 1, 'operator must see exactly one gettone row');
    await page.getByTestId('button-gettone-open-estimated-detail').click();
    const operatorDetail = page.getByTestId('dialog-gettone-detail');
    await operatorDetail.waitFor({ state: 'visible' });
    const operatorDetailText = await operatorDetail.innerText();
    assert.ok(operatorDetailText.includes('Cliente Mario'));
    assert.ok(!operatorDetailText.includes('Cliente Luigi'), 'detail must keep the operator customer perimeter');
    await operatorDetail.getByTestId(`button-gettone-audit-open-${operatorJourney}`).waitFor({ state: 'visible' });

    await page.close();
    await context.close();
  } finally {
    await browser.close().catch(() => {});
    await cleanupOrg(pool, session);
    await pool.end().catch(() => {});
  }
});

// ---------------------------------------------------------------------------
// SCENARIO 3 (Task #195): tab "Dettaglio" (ReportView) — le righe aggregate
// rendono i valori attesi e il selettore di dimensione funziona.
// A differenza dell'Analisi gettoni le righe della tab Dettaglio non sono
// espandibili, ma il selettore "Raggruppa per" (`button-report-dim-*`) cambia
// il grouping a runtime: senza questo test una regressione del rendering o del
// re-grouping di ReportView passerebbe inosservata.
// ---------------------------------------------------------------------------
test('scenario 3: admin sees the Dettaglio report rows and the dimension switcher works', async () => {
  const pool = await newPool();
  const session = await signup({ prefix: 'cj_gettone_ui', fullName: 'CJ Gettone UI Test', organizationName: uniq('CJGettoneUI') });
  const browser = await launchBrowser();
  try {
    await seedJourney(pool, session.orgId, {
      customerKey: uniq('CFMARIO').toUpperCase(),
      nome: 'Cliente Mario',
      addetto: MARIO_ADDETTO,
      pdv: MARIO_PDV,
      items: [
        { driver: 'mobile', state: 'inserito' },
        { driver: 'energia', state: 'inserito', importo: '50.00' },
        { driver: 'fisso', state: 'inserito', importo: '20.00' },
      ],
    });
    await seedJourney(pool, session.orgId, {
      customerKey: uniq('CFLUIGI').toUpperCase(),
      nome: 'Cliente Luigi',
      addetto: LUIGI_ADDETTO,
      pdv: LUIGI_PDV,
      items: [
        { driver: 'mobile', state: 'inserito' },
        { driver: 'energia', state: 'inserito', importo: '30.00' },
      ],
    });

    const context = await newAuthedContext(browser, session);
    const page = await context.newPage();
    await page.goto(`${BASE}/customer-journey`, { waitUntil: 'networkidle' });
    // Reportistica -> tab "Dettaglio".
    await page.getByTestId('tab-report').click();
    await page.getByTestId('button-report-tab-dettaglio').click();

    // Default dim = "negozio": una riga per PDV. Verifica i valori di Mario.
    const milanoReportRow = page.getByTestId(`row-report-${MARIO_PDV}`);
    await milanoReportRow.waitFor({ state: 'visible', timeout: 15000 });
    assert.equal(
      (await page.getByTestId(`text-report-label-${MARIO_PDV}`).innerText()).trim(),
      MARIO_PDV, 'Milano report row shows the PDV label',
    );
    assert.equal(
      (await page.getByTestId(`text-report-clienti-${MARIO_PDV}`).innerText()).trim(),
      '1', 'Milano report row: 1 cliente',
    );
    assert.equal(
      (await page.getByTestId(`text-report-contratti-${MARIO_PDV}`).innerText()).trim(),
      '3', 'Milano report row: 3 contratti (mobile + energia + fisso)',
    );
    assert.equal(
      (await page.getByTestId(`text-report-attivati-${MARIO_PDV}`).innerText()).trim(),
      '3', 'Milano report row: 3 contratti attivi',
    );
    // Anche la riga del PDV di Luigi è presente nel grouping per negozio.
    await page.getByTestId(`row-report-${LUIGI_PDV}`).waitFor({ state: 'visible', timeout: 10000 });

    // Interazione: cambia il grouping su "addetto" -> compaiono le righe addetto
    // e spariscono quelle PDV.
    await page.getByTestId('button-report-dim-addetto').click();
    await page.getByTestId(`row-report-${MARIO_ADDETTO}`).waitFor({ state: 'visible', timeout: 10000 });
    await page.getByTestId(`row-report-${LUIGI_ADDETTO}`).waitFor({ state: 'visible', timeout: 10000 });
    assert.equal(
      await page.getByTestId(`row-report-${MARIO_PDV}`).count(),
      0, 'PDV rows must disappear after switching grouping to addetto',
    );
    assert.equal(
      (await page.getByTestId(`text-report-contratti-${MARIO_ADDETTO}`).innerText()).trim(),
      '3', 'Mario addetto report row: 3 contratti',
    );

    await page.close();
    await context.close();
  } finally {
    await browser.close().catch(() => {});
    await cleanupOrg(pool, session);
    await pool.end().catch(() => {});
  }
});

// ---------------------------------------------------------------------------
// SCENARIO 4 (Task #199): i filtri condivisi (negozio/PDV) narrowano davvero
// le tabelle report. La logica del predicato `matchesCjFilters` è coperta dai
// test puri di `customer-journey-report.test.mjs`, ma nessun test verificava
// che interagire col CONTROLLO di filtro nella barra condivisa re-renderizzi
// le tabelle Dettaglio e Analisi gettoni con il sottoinsieme corretto. Una
// regressione di wiring tra il <Select> negozio e la tabella renderizzata
// passerebbe inosservata.
// ---------------------------------------------------------------------------
test('scenario 4: the shared store (PDV) filter narrows both the Dettaglio and gettone tables', async () => {
  const pool = await newPool();
  const session = await signup({ prefix: 'cj_gettone_ui', fullName: 'CJ Gettone UI Test', organizationName: uniq('CJGettoneUI') });
  const browser = await launchBrowser();
  try {
    // Journey con data "now()": trigger abbassato così il floor gettone non le esclude.
    await setCjTriggerDate(pool, session.orgId, '2026-01-01');
    await seedJourney(pool, session.orgId, {
      customerKey: uniq('CFMARIO').toUpperCase(),
      nome: 'Cliente Mario',
      addetto: MARIO_ADDETTO,
      pdv: MARIO_PDV,
      items: [
        { driver: 'mobile', state: 'inserito' },
        { driver: 'energia', state: 'inserito', importo: '50.00' },
        { driver: 'fisso', state: 'inserito', importo: '20.00' },
      ],
    });
    await seedJourney(pool, session.orgId, {
      customerKey: uniq('CFLUIGI').toUpperCase(),
      nome: 'Cliente Luigi',
      addetto: LUIGI_ADDETTO,
      pdv: LUIGI_PDV,
      items: [
        { driver: 'mobile', state: 'inserito' },
        { driver: 'energia', state: 'inserito', importo: '30.00' },
      ],
    });

    const context = await newAuthedContext(browser, session);
    const page = await context.newPage();
    await page.goto(`${BASE}/customer-journey`, { waitUntil: 'networkidle' });
    await page.getByTestId('tab-report').click();
    await page.getByTestId('button-report-tab-dettaglio').click();

    // Entrambi i PDV sono presenti prima di filtrare.
    await page.getByTestId(`row-report-${MARIO_PDV}`).waitFor({ state: 'visible', timeout: 15000 });
    await page.getByTestId(`row-report-${LUIGI_PDV}`).waitFor({ state: 'visible', timeout: 10000 });

    // Applica il filtro Negozio = PDV di Mario tramite il controllo <Select>.
    await page.getByTestId('select-filter-negozio').click();
    await page.getByTestId(`option-select-filter-negozio-${MARIO_PDV}`).click();
    await page.keyboard.press('Escape');

    // La tabella Dettaglio si restringe alla sola riga di Mario.
    await page.getByTestId(`row-report-${MARIO_PDV}`).waitFor({ state: 'visible', timeout: 10000 });
    await page.getByTestId(`row-report-${LUIGI_PDV}`).waitFor({ state: 'detached', timeout: 10000 });
    assert.equal(
      await page.getByTestId(`row-report-${LUIGI_PDV}`).count(),
      0, 'Luigi PDV report row must disappear once the store filter is applied',
    );

    // Il filtro è condiviso: anche l'Analisi gettoni (per addetto) si restringe.
    await page.getByTestId('button-report-tab-analisi').click();
    await page.getByTestId('button-gettone-dim-addetto').click();
    await page.getByTestId(`row-gettone-${MARIO_ADDETTO}`).waitFor({ state: 'visible', timeout: 10000 });
    assert.equal(
      await page.getByTestId(`row-gettone-${LUIGI_ADDETTO}`).count(),
      0, 'Luigi gettone row must disappear under the active store filter',
    );
    await page.getByTestId('button-gettone-open-estimated-detail').click();
    const filteredAudit = page.getByTestId('dialog-gettone-detail');
    await filteredAudit.waitFor({ state: 'visible' });
    const filteredAuditText = await filteredAudit.innerText();
    assert.ok(filteredAuditText.includes('Cliente Mario'));
    assert.ok(!filteredAuditText.includes('Cliente Luigi'), 'detail must inherit the active PDV filter');
    await page.keyboard.press('Escape');
    await filteredAudit.waitFor({ state: 'detached' });

    // Multi-selezione (Task #466): aggiungendo anche il PDV di Luigi entrambe
    // le righe tornano visibili (semantica OR fra i negozi selezionati).
    await page.getByTestId('select-filter-negozio').click();
    await page.getByTestId(`option-select-filter-negozio-${LUIGI_PDV}`).click();
    await page.keyboard.press('Escape');
    await page.getByTestId(`row-gettone-${MARIO_ADDETTO}`).waitFor({ state: 'visible', timeout: 10000 });
    await page.getByTestId(`row-gettone-${LUIGI_ADDETTO}`).waitFor({ state: 'visible', timeout: 10000 });

    // "Tutti i negozi" azzera la selezione multipla: tutto resta visibile e il
    // filtro non è più attivo.
    await page.getByTestId('select-filter-negozio').click();
    await page.getByTestId('option-select-filter-negozio-all').click();
    await page.keyboard.press('Escape');
    await page.getByTestId(`row-gettone-${MARIO_ADDETTO}`).waitFor({ state: 'visible', timeout: 10000 });
    await page.getByTestId(`row-gettone-${LUIGI_ADDETTO}`).waitFor({ state: 'visible', timeout: 10000 });

    // Riapplica il filtro sul solo PDV di Mario e azzera con il reset globale.
    await page.getByTestId('select-filter-negozio').click();
    await page.getByTestId(`option-select-filter-negozio-${MARIO_PDV}`).click();
    await page.keyboard.press('Escape');
    await page.getByTestId(`row-gettone-${LUIGI_ADDETTO}`).waitFor({ state: 'detached', timeout: 10000 });

    // Azzerando il filtro torna anche Luigi.
    await page.getByTestId('button-reset-filters').click();
    await page.getByTestId(`row-gettone-${LUIGI_ADDETTO}`).waitFor({ state: 'visible', timeout: 10000 });
    await page.getByTestId(`row-gettone-${MARIO_ADDETTO}`).waitFor({ state: 'visible', timeout: 10000 });

    await page.close();
    await context.close();
  } finally {
    await browser.close().catch(() => {});
    await cleanupOrg(pool, session);
    await pool.end().catch(() => {});
  }
});

// ---------------------------------------------------------------------------
// SCENARIO 5 (Task #199, aggiornato Task #232): il filtro a intervallo
// dell'Analisi gettoni (`input-gettone-date-from`/`input-gettone-date-to`) ora
// ragiona per data di INSERIMENTO della SIM, non per data attivazione.
// `filterGettoneByInsertDate` è coperta dai test puri, ma il wiring tra gli
// <Input type="date"> e la tabella gettone re-renderizzata no. Seminiamo due
// journey con date di inserimento SIM diverse e verifichiamo che impostare il
// range escluda la coorte fuori intervallo.
// ---------------------------------------------------------------------------
test('scenario 5: the SIM-insertion date range filter narrows the gettone cohort', async () => {
  const pool = await newPool();
  const session = await signup({ prefix: 'cj_gettone_ui', fullName: 'CJ Gettone UI Test', organizationName: uniq('CJGettoneUI') });
  const browser = await launchBrowser();
  try {
    // Mario inserisce a marzo, Luigi a gennaio: un range a febbraio li separa.
    // `dataInserimento` di journey si applica a tutti gli item (la coorte usa
    // la SIM mobile più vecchia). `openedAt` resta coerente per la finestra T0.
    // Trigger abbassato a inizio gennaio così il floor (per data attivazione)
    // non esclude nessuna delle due: il test isola il filtro per inserimento.
    await setCjTriggerDate(pool, session.orgId, '2026-01-01');
    await seedJourney(pool, session.orgId, {
      customerKey: uniq('CFMARIO').toUpperCase(),
      nome: 'Cliente Mario',
      addetto: MARIO_ADDETTO,
      pdv: MARIO_PDV,
      openedAt: '2026-03-15T10:00:00Z',
      dataInserimento: '2026-03-15T10:00:00Z',
      items: [
        { driver: 'mobile', state: 'inserito' },
        { driver: 'energia', state: 'inserito', importo: '50.00' },
        { driver: 'fisso', state: 'inserito', importo: '20.00' },
      ],
    });
    await seedJourney(pool, session.orgId, {
      customerKey: uniq('CFLUIGI').toUpperCase(),
      nome: 'Cliente Luigi',
      addetto: LUIGI_ADDETTO,
      pdv: LUIGI_PDV,
      openedAt: '2026-01-10T10:00:00Z',
      dataInserimento: '2026-01-10T10:00:00Z',
      items: [
        { driver: 'mobile', state: 'inserito' },
        { driver: 'energia', state: 'inserito', importo: '30.00' },
      ],
    });

    const context = await newAuthedContext(browser, session);
    const page = await openAnalisiByAddetto(context);

    // Senza filtro entrambe le coorti sono presenti.
    await page.getByTestId(`row-gettone-${MARIO_ADDETTO}`).waitFor({ state: 'visible', timeout: 15000 });
    await page.getByTestId(`row-gettone-${LUIGI_ADDETTO}`).waitFor({ state: 'visible', timeout: 10000 });

    // "dal 2026-02-01" => resta solo Mario (marzo), Luigi (gennaio) esce.
    await page.getByTestId('input-gettone-date-from').fill('2026-02-01');
    await page.getByTestId(`row-gettone-${LUIGI_ADDETTO}`).waitFor({ state: 'detached', timeout: 10000 });
    await page.getByTestId(`row-gettone-${MARIO_ADDETTO}`).waitFor({ state: 'visible', timeout: 10000 });
    assert.equal(
      await page.getByTestId(`row-gettone-${LUIGI_ADDETTO}`).count(),
      0, 'Luigi (Jan) must be excluded by a "from 2026-02-01" filter',
    );

    // Azzera le date: tornano entrambe.
    await page.getByTestId('button-gettone-reset-date').click();
    await page.getByTestId(`row-gettone-${LUIGI_ADDETTO}`).waitFor({ state: 'visible', timeout: 10000 });
    await page.getByTestId(`row-gettone-${MARIO_ADDETTO}`).waitFor({ state: 'visible', timeout: 10000 });

    // "al 2026-02-01" => resta solo Luigi (gennaio), Mario (marzo) esce.
    await page.getByTestId('input-gettone-date-to').fill('2026-02-01');
    await page.getByTestId(`row-gettone-${MARIO_ADDETTO}`).waitFor({ state: 'detached', timeout: 10000 });
    await page.getByTestId(`row-gettone-${LUIGI_ADDETTO}`).waitFor({ state: 'visible', timeout: 10000 });
    assert.equal(
      await page.getByTestId(`row-gettone-${MARIO_ADDETTO}`).count(),
      0, 'Mario (Mar) must be excluded by a "to 2026-02-01" filter',
    );

    await page.close();
    await context.close();
  } finally {
    await browser.close().catch(() => {});
    await cleanupOrg(pool, session);
    await pool.end().catch(() => {});
  }
});

// ---------------------------------------------------------------------------
// SCENARIO 6 (Task #198): contratti ANNULLATI/KO esclusi da attivi/saturazione/
// fatturato. I report e l'Analisi gettoni escludono per design gli item in stato
// ko/stornato/annullato (isCjItemActive in shared/customerJourney.ts). Una
// regressione che li contasse di nuovo nella sotto-tabella gettone o nella riga
// Dettaglio NON sarebbe rilevata dagli scenari 1-3 (che seminano solo item
// attivi). Qui seminiamo una journey con una pista cross-sell ATTIVA (energia)
// e una ANNULLATA (fisso) accanto alla SIM mobile: la vista deve contare 1
// pista (20% / 20€), non 2 (40% / 30€), e la riga Dettaglio 2 contratti attivi
// su 3, non 3.
// ---------------------------------------------------------------------------
test('scenario 6: i contratti annullati/rifiutati sono esclusi da attivi, saturazione e fatturato', async () => {
  const pool = await newPool();
  const session = await signup({ prefix: 'cj_gettone_ui', fullName: 'CJ Gettone UI Test', organizationName: uniq('CJGettoneUI') });
  const browser = await launchBrowser();
  try {
    // Journey con data "now()": trigger abbassato così il floor gettone non le esclude.
    await setCjTriggerDate(pool, session.orgId, '2026-01-01');
    const jAnna = await seedJourney(pool, session.orgId, {
      customerKey: uniq('CFANNA').toUpperCase(),
      nome: 'Cliente Anna',
      addetto: ANNA_ADDETTO,
      pdv: ANNA_PDV,
      items: [
        { driver: 'mobile', state: 'inserito' },
        { driver: 'energia', state: 'inserito', importo: '50.00' },
        // Contratto cross-sell ANNULLATO: NON deve contare come pista attiva.
        { driver: 'fisso', state: 'annullato', importo: '20.00' },
      ],
    });

    const context = await newAuthedContext(browser, session);
    const page = await openAnalisiByAddetto(context);

    // --- Analisi gettoni: la riga addetto conta 1 cliente con cross-sell.
    const annaRow = page.getByTestId(`row-gettone-${ANNA_ADDETTO}`);
    await annaRow.waitFor({ state: 'visible', timeout: 15000 });
    assert.equal(
      (await page.getByTestId(`text-gettone-clienti-${ANNA_ADDETTO}`).innerText()).trim(),
      '1', 'riga Anna: 1 cliente',
    );
    assert.equal(
      (await page.getByTestId(`text-gettone-conprodotti-${ANNA_ADDETTO}`).innerText()).trim(),
      '1', 'riga Anna: 1 cliente con cross-sell (solo energia, fisso annullato escluso)',
    );
    // Fatturato = 20€ (1 pista), NON 30€ (che sarebbe 2 piste se contasse l'annullato).
    const fatturato = (await page.getByTestId(`text-gettone-fatturato-${ANNA_ADDETTO}`).innerText()).trim();
    assert.ok(fatturato.includes('20'), `il fatturato di Anna deve essere 20€ (1 pista), trovato "${fatturato}"`);
    assert.ok(!fatturato.includes('30'), `il fatturato di Anna NON deve essere 30€ (annullato conteggiato), trovato "${fatturato}"`);

    // Espandi la riga: la sotto-tabella mostra 1/5 piste e 20% saturazione.
    await annaRow.click();
    const detail = page.getByTestId(`row-gettone-detail-${ANNA_ADDETTO}`);
    await detail.waitFor({ state: 'visible', timeout: 10000 });
    const simRow = detail.getByTestId(`row-gettone-sim-${jAnna}`);
    await simRow.waitFor({ state: 'visible', timeout: 10000 });
    assert.equal(
      (await detail.getByTestId(`text-gettone-sim-saturazione-${jAnna}`).innerText()).trim(),
      '20%', 'la riga di dettaglio mostra 20% di saturazione (1/5 piste, fisso annullato escluso)',
    );
    const detailText = await detail.innerText();
    assert.ok(detailText.includes('1/5'), 'la riga di dettaglio mostra 1/5 piste attive (non 2/5)');
    assert.ok(!detailText.includes('2/5'), 'la riga di dettaglio NON deve mostrare 2/5 piste (annullato conteggiato)');
    assert.ok(!detailText.includes('40%'), 'la riga di dettaglio NON deve mostrare 40% di saturazione (annullato conteggiato)');

    // --- Tab "Dettaglio" (ReportView): 3 contratti totali, ma solo 2 attivi.
    await page.getByTestId('button-report-tab-dettaglio').click();
    await page.getByTestId('button-report-dim-addetto').click();
    const reportRow = page.getByTestId(`row-report-${ANNA_ADDETTO}`);
    await reportRow.waitFor({ state: 'visible', timeout: 15000 });
    assert.equal(
      (await page.getByTestId(`text-report-contratti-${ANNA_ADDETTO}`).innerText()).trim(),
      '3', 'riga report Anna: 3 contratti totali (mobile + energia + fisso)',
    );
    assert.equal(
      (await page.getByTestId(`text-report-attivati-${ANNA_ADDETTO}`).innerText()).trim(),
      '2', 'riga report Anna: 2 contratti attivi (fisso annullato escluso)',
    );

    await page.close();
    await context.close();
  } finally {
    await browser.close().catch(() => {});
    await cleanupOrg(pool, session);
    await pool.end().catch(() => {});
  }
});

// ---------------------------------------------------------------------------
// SCENARIO 7 (Task #200): un cliente la cui SIM MOBILE è annullata/rifiutata è
// escluso dall'intera coorte gettone. Lo scenario 6 copre un cross-sell
// annullato accanto a una SIM ATTIVA; qui invece è la SIM mobile stessa ad
// essere in stato non attivo ("annullato"). `buildGettoneJourneys` richiede
// almeno una SIM mobile attiva (`simAttive >= 1`) perché una journey entri
// nella coorte: una regressione che ammettesse questi clienti li farebbe
// comparire come riga nell'Analisi gettoni. La logica pura è coperta dai test
// di `customer-journey-report.test.mjs`, ma NESSUN test UI verificava il
// rendering React di questa esclusione. Seminiamo Gina (SIM mobile annullata +
// cross-sell energia ATTIVO) accanto a Mario (SIM attiva): solo Mario deve
// comparire.
// ---------------------------------------------------------------------------
test('scenario 7: a customer whose mobile SIM is cancelled is excluded from the gettone cohort', async () => {
  const pool = await newPool();
  const session = await signup({ prefix: 'cj_gettone_ui', fullName: 'CJ Gettone UI Test', organizationName: uniq('CJGettoneUI') });
  const browser = await launchBrowser();
  try {
    // Journey con data "now()": trigger abbassato così il floor gettone non le esclude.
    await setCjTriggerDate(pool, session.orgId, '2026-01-01');
    // Mario: SIM mobile ATTIVA + cross-sell => entra nella coorte.
    await seedJourney(pool, session.orgId, {
      customerKey: uniq('CFMARIO').toUpperCase(),
      nome: 'Cliente Mario',
      addetto: MARIO_ADDETTO,
      pdv: MARIO_PDV,
      items: [
        { driver: 'mobile', state: 'inserito' },
        { driver: 'energia', state: 'inserito', importo: '50.00' },
        { driver: 'fisso', state: 'inserito', importo: '20.00' },
      ],
    });
    // Gina: SIM mobile ANNULLATA + cross-sell ATTIVO => esclusa dalla coorte.
    await seedJourney(pool, session.orgId, {
      customerKey: uniq('CFGINA').toUpperCase(),
      nome: 'Cliente Gina',
      addetto: GINA_ADDETTO,
      pdv: GINA_PDV,
      items: [
        { driver: 'mobile', state: 'annullato' },
        { driver: 'energia', state: 'inserito', importo: '30.00' },
      ],
    });

    const context = await newAuthedContext(browser, session);
    const page = await openAnalisiByAddetto(context);

    // Mario (SIM attiva) compare nell'Analisi gettoni...
    await page.getByTestId(`row-gettone-${MARIO_ADDETTO}`).waitFor({ state: 'visible', timeout: 15000 });
    // ...mentre Gina (SIM mobile annullata) è esclusa dalla coorte.
    assert.equal(
      await page.getByTestId(`row-gettone-${GINA_ADDETTO}`).count(),
      0, 'Gina (cancelled mobile SIM) must NOT appear in the gettone analysis',
    );

    // Solo una riga gettone totale presente (quella di Mario).
    const allRows = await page.locator('[data-testid^="row-gettone-"]:not([data-testid^="row-gettone-detail-"]):not([data-testid^="row-gettone-sim-"])').count();
    assert.equal(allRows, 1, 'exactly one gettone row (Mario); the cancelled-SIM customer is excluded');

    // Sanity check sulla tab "Dettaglio": Gina è comunque presente come riga
    // report (i suoi contratti esistono), così l'esclusione è specifica della
    // coorte gettone e non un effetto di un filtro globale.
    await page.getByTestId('button-report-tab-dettaglio').click();
    await page.getByTestId('button-report-dim-addetto').click();
    await page.getByTestId(`row-report-${GINA_ADDETTO}`).waitFor({ state: 'visible', timeout: 15000 });

    await page.close();
    await context.close();
  } finally {
    await browser.close().catch(() => {});
    await cleanupOrg(pool, session);
    await pool.end().catch(() => {});
  }
});

// ---------------------------------------------------------------------------
// SCENARIO 8 (Task #229): il simulatore di scenari gettone. Accanto a
// "Saturazione attesa" (% clienti) c'è un selettore "Prodotti in più / cliente"
// (+1..+5). Combinati simulano "il X% dei clienti attiva +N prodotti" e il
// "Potenziale non espresso" si ricalcola di conseguenza. La logica pura
// (`gettoneIncremento` + il parametro `addProducts`) è coperta dai test puri di
// `customer-journey-report.test.mjs`; qui si protegge il WIRING React: lo stato
// `extraProdotti` threaded da parent a `AnalisiView`, le useMemo che rialimentano
// `gettoneTotals`, e il re-render della card Potenziale. Seminiamo un cliente con
// 2 piste cross-sell attive (energia + fisso) => 30€ maturato. Default (+5,
// 100%) => potenziale pieno residuo 120-30 = 90€. Con +1 (=> 3 piste, 40€) il
// potenziale scende a 10€; al 50% si dimezza.
// ---------------------------------------------------------------------------
test('scenario 8: the gettone scenario simulator recomputes the projected potential', async () => {
  const pool = await newPool();
  const session = await signup({ prefix: 'cj_gettone_ui', fullName: 'CJ Gettone UI Test', organizationName: uniq('CJGettoneUI') });
  const browser = await launchBrowser();
  try {
    // Journey con data "now()": trigger abbassato così il floor gettone non le esclude.
    await setCjTriggerDate(pool, session.orgId, '2026-01-01');
    await seedJourney(pool, session.orgId, {
      customerKey: uniq('CFMARIO').toUpperCase(),
      nome: 'Cliente Mario',
      addetto: MARIO_ADDETTO,
      pdv: MARIO_PDV,
      items: [
        { driver: 'mobile', state: 'inserito' },
        { driver: 'energia', state: 'inserito', importo: '50.00' },
        { driver: 'fisso', state: 'inserito', importo: '20.00' },
      ],
    });

    const context = await newAuthedContext(browser, session);
    const page = await openAnalisiByAddetto(context);

    await page.getByTestId(`row-gettone-${MARIO_ADDETTO}`).waitFor({ state: 'visible', timeout: 15000 });

    const potenzialeText = () => page.getByTestId('text-gettone-potenziale').innerText();

    // Default (+5, 100%): potenziale pieno residuo 90€.
    assert.ok(
      (await potenzialeText()).includes('90'),
      `il potenziale di default (+5, 100%) deve essere 90€, trovato "${await potenzialeText()}"`,
    );

    // Cambia "Prodotti in più" a +1 => 3 piste (40€) => potenziale 10€.
    await page.getByTestId('select-gettone-prodotti').click();
    await page.getByTestId('option-gettone-prodotti-1').click();
    await assert.doesNotReject(async () => {
      await page.getByText('Potenziale non espresso').waitFor({ state: 'visible', timeout: 5000 });
    });
    // attende l'aggiornamento del valore (10€), non più 90€.
    await page.waitForFunction(
      () => {
        const el = document.querySelector('[data-testid="text-gettone-potenziale"]');
        return !!el && el.textContent.includes('10') && !el.textContent.includes('90');
      },
      { timeout: 10000 },
    );

    // Lo scenario è descritto in chiaro.
    const scenarioText = (await page.getByTestId('text-gettone-scenario').innerText()).trim();
    assert.ok(scenarioText.includes('+1'), `il testo scenario deve citare +1, trovato "${scenarioText}"`);
    assert.ok(scenarioText.includes('100%'), `il testo scenario deve citare 100%, trovato "${scenarioText}"`);

    // Riduci la saturazione al 50% (resta +1): potenziale 10€ * 50% = 5€.
    await page.getByTestId('select-gettone-saturation').click();
    await page.getByText('50%', { exact: true }).click();
    await page.waitForFunction(
      () => {
        const el = document.querySelector('[data-testid="text-gettone-potenziale"]');
        return !!el && el.textContent.includes('5') && !el.textContent.includes('10');
      },
      { timeout: 10000 },
    );

    // Il fatturato maturato resta invariato dallo scenario (30€): è già maturato.
    assert.ok(
      (await page.getByTestId('text-gettone-fatturato').innerText()).includes('30'),
      'il fatturato maturato non cambia con lo scenario',
    );

    // "Azzera scenario" riporta saturazione=100% e prodotti=+5 (potenziale 90€).
    await page.getByTestId('button-gettone-reset-scenario').click();
    await page.waitForFunction(
      () => {
        const el = document.querySelector('[data-testid="text-gettone-potenziale"]');
        return !!el && el.textContent.includes('90');
      },
      { timeout: 10000 },
    );
    const baseScenario = (await page.getByTestId('text-gettone-scenario').innerText()).trim();
    assert.ok(
      baseScenario.toLowerCase().includes('base'),
      `dopo l'azzeramento il testo deve indicare lo scenario base, trovato "${baseScenario}"`,
    );
    // Il pulsante di reset sparisce quando si è tornati al base.
    assert.equal(
      await page.getByTestId('button-gettone-reset-scenario').count(),
      0, 'il pulsante "Azzera scenario" non è mostrato nello scenario base',
    );

    await page.close();
    await context.close();
  } finally {
    await browser.close().catch(() => {});
    await cleanupOrg(pool, session);
    await pool.end().catch(() => {});
  }
});

// ---------------------------------------------------------------------------
// SCENARIO 9 (regressione del bug "floor solo per admin"): il floor alla data
// trigger dell'Analisi gettoni deve valere ANCHE per gli operatori. Storicamente
// `configQuery` era `enabled: isAdmin`, quindi gli operatori non caricavano la
// config e vedevano SIM antecedenti al cutover. Qui semina, per lo stesso
// operatore, una journey PRE-trigger (deve sparire) e una POST-trigger (deve
// restare): se il floor non fosse applicato all'operatore comparirebbero
// entrambe le righe addetto.
// ---------------------------------------------------------------------------
test('scenario 9: the gettone trigger floor is enforced for operators too', async () => {
  const pool = await newPool();
  const session = await signup({ prefix: 'cj_gettone_ui', fullName: 'CJ Gettone UI Test', organizationName: uniq('CJGettoneUI') });
  const browser = await launchBrowser();
  // Addetti dedicati: uno PRE-trigger, uno POST-trigger, entrambi dell'operatore.
  const PRE_ADDETTO = `PRE FLOOR ${crypto.randomBytes(3).toString('hex')}`.toUpperCase();
  const POST_ADDETTO = `POST FLOOR ${crypto.randomBytes(3).toString('hex')}`.toUpperCase();
  try {
    // Trigger al 2026-06-15: la SIM attivata prima è fuori cohort, quella dopo dentro.
    await setCjTriggerDate(pool, session.orgId, '2026-06-15');
    await seedJourney(pool, session.orgId, {
      customerKey: uniq('CFPRE').toUpperCase(),
      nome: 'Cliente Pre',
      addetto: PRE_ADDETTO,
      pdv: MARIO_PDV,
      openedAt: '2026-06-01', // attivazione SIM PRIMA del trigger => floored out
      items: [
        { driver: 'mobile', state: 'inserito' },
        { driver: 'energia', state: 'inserito', importo: '30.00' },
      ],
    });
    await seedJourney(pool, session.orgId, {
      customerKey: uniq('CFPOST').toUpperCase(),
      nome: 'Cliente Post',
      addetto: POST_ADDETTO,
      pdv: LUIGI_PDV,
      openedAt: '2026-06-20', // attivazione SIM DOPO il trigger => in cohort
      items: [
        { driver: 'mobile', state: 'inserito' },
        { driver: 'energia', state: 'inserito', importo: '30.00' },
      ],
    });

    // Operatore associato a ENTRAMBI gli addetti: la sola cosa che esclude la
    // riga PRE è il floor, non l'isolamento per addetto.
    await setRole(pool, session.profileId, 'operatore', [
      PRE_ADDETTO.toLowerCase(),
      POST_ADDETTO.toLowerCase(),
    ]);

    const context = await newAuthedContext(browser, session);
    const page = await openAnalisiByAddetto(context);

    // La riga POST-trigger c'è...
    await page.getByTestId(`row-gettone-${POST_ADDETTO}`).waitFor({ state: 'visible', timeout: 15000 });
    // ...la PRE-trigger NO (floored anche per l'operatore).
    assert.equal(
      await page.getByTestId(`row-gettone-${PRE_ADDETTO}`).count(),
      0, 'la riga PRE-trigger deve essere esclusa dal floor anche per l\'operatore',
    );

    await page.close();
    await context.close();
  } finally {
    await browser.close().catch(() => {});
    await cleanupOrg(pool, session);
    await pool.end().catch(() => {});
  }
});

// ---------------------------------------------------------------------------
// SCENARIO 10 (Task #648/#651): filtri indipendenti per PDV origine/destinazione
// e ragione sociale, applicati sia alle Schede sia al Dettaglio report; su
// viewport mobile devono restare raggiungibili senza overflow. Coorti conserva
// i propri filtri locali e non eredita quelli condivisi.
// ---------------------------------------------------------------------------
test('scenario 10: shared filters stay independent and usable on mobile without changing Coorti', async () => {
  const pool = await newPool();
  const session = await signup({ prefix: 'cj_gettone_ui', fullName: 'CJ Filter UI Test', organizationName: uniq('CJFilterUI') });
  const browser = await launchBrowser();
  const token = crypto.randomBytes(3).toString('hex').toUpperCase();
  const marioOrigin = `ORIGINE MILANO ${token}`;
  const marioDestination = `DESTINAZIONE MILANO ${token}`;
  const luigiOrigin = `ORIGINE ROMA ${token}`;
  const luigiDestination = `DESTINAZIONE ROMA ${token}`;
  const marioCompany = `ALFA TELECOM ${token} SRL`;
  const marioKey = uniq('CFORIGINE').toUpperCase();
  const luigiKey = uniq('CFDESTINAZIONE').toUpperCase();
  const luigiCompany = `BETA SERVIZI ${token} SRL`;
  let marioId;
  let luigiId;
  try {
    await setCjTriggerDate(pool, session.orgId, '2026-01-01');
    marioId = await seedJourney(pool, session.orgId, {
      customerKey: marioKey,
      nome: 'Contatto Mario',
      customerType: 'azienda',
      ragioneSociale: marioCompany,
      addetto: MARIO_ADDETTO,
      items: [
        { driver: 'mobile', state: 'inserito', pdvOrigine: marioOrigin, pdvDestinazione: marioDestination },
        { driver: 'energia', state: 'inserito', importo: '50.00', pdvOrigine: marioOrigin, pdvDestinazione: marioDestination },
        { driver: 'fisso', state: 'inserito', importo: '20.00', pdvOrigine: marioOrigin, pdvDestinazione: null },
      ],
    });
    luigiId = await seedJourney(pool, session.orgId, {
      customerKey: luigiKey,
      nome: 'Contatto Luigi',
      customerType: 'azienda',
      ragioneSociale: luigiCompany,
      addetto: LUIGI_ADDETTO,
      items: [
        { driver: 'mobile', state: 'inserito', pdvOrigine: luigiOrigin, pdvDestinazione: luigiDestination },
        { driver: 'energia', state: 'inserito', importo: '30.00', pdvOrigine: luigiOrigin, pdvDestinazione: luigiDestination },
      ],
    });

    const context = await newAuthedContext(browser, session, { mobile: true });
    const page = await context.newPage();
    await page.goto(`${BASE}/customer-journey`, { waitUntil: 'networkidle' });

    const assertNoMobileOverflow = async (view) => {
      const dimensions = await page.evaluate(() => ({
        width: window.innerWidth,
        documentWidth: document.documentElement.scrollWidth,
      }));
      assert.ok(
        dimensions.documentWidth <= dimensions.width,
        `${view}: document must not scroll horizontally at ${dimensions.width}px (content ${dimensions.documentWidth}px)`,
      );
    };
    const assertFilterFits = async (testid) => {
      const control = page.getByTestId(testid);
      await control.scrollIntoViewIfNeeded();
      assert.ok(await control.isVisible(), `${testid} must remain visible on mobile`);
      const box = await control.boundingBox();
      assert.ok(box, `${testid} must have a mobile hit target`);
      assert.ok(box.x >= 0 && box.x + box.width <= 375, `${testid} must fit within the 375px viewport`);
    };
    const sharedFilterIds = [
      'select-filter-pdv-origine',
      'select-filter-pdv-destinazione',
      'input-filter-ragione-sociale',
    ];
    await assertNoMobileOverflow('Schede');
    for (const testid of sharedFilterIds) await assertFilterFits(testid);
    const originTop = await page.getByTestId(sharedFilterIds[0]).evaluate(el => el.getBoundingClientRect().top);
    const destinationTop = await page.getByTestId(sharedFilterIds[1]).evaluate(el => el.getBoundingClientRect().top);
    const companyTop = await page.getByTestId(sharedFilterIds[2]).evaluate(el => el.getBoundingClientRect().top);
    assert.ok(originTop < destinationTop && destinationTop < companyTop, 'shared filters must stack without overlapping on mobile');

    // Le Schede usano il PDV origine e la ragione sociale dedicata.
    await page.getByTestId(`card-journey-${marioId}`).waitFor({ state: 'visible', timeout: 15000 });
    await page.getByTestId(`card-journey-${luigiId}`).waitFor({ state: 'visible', timeout: 10000 });
    await page.getByTestId('select-filter-pdv-origine').click();
    const originSearch = page.getByPlaceholder('Cerca PDV origine...');
    await originSearch.waitFor({ state: 'visible' });
    assert.ok((await originSearch.boundingBox()).x >= 0, 'origin search must be reachable on mobile');
    await assertNoMobileOverflow('Schede origin menu');
    await page.getByTestId(`option-select-filter-pdv-origine-${marioOrigin}`).click();
    await page.keyboard.press('Escape');
    await page.getByTestId(`card-journey-${marioId}`).waitFor({ state: 'visible' });
    assert.equal(await page.getByTestId(`card-journey-${luigiId}`).count(), 0, 'origin filter must hide the other journey');
    await assertNoMobileOverflow('Schede with origin selected');

    // I download di Schede devono contenere lo stesso insieme di clienti
    // mostrato dalla UI quando origine, destinazione e ragione sociale sono
    // selezionati insieme (ricerca parziale e case-insensitive).
    await page.getByTestId('select-filter-pdv-destinazione').click();
    await page.getByTestId(`option-select-filter-pdv-destinazione-${marioDestination}`).click();
    await page.keyboard.press('Escape');
    await page.getByTestId('input-filter-ragione-sociale').fill(`telecom ${token.toLowerCase()}`);
    await page.getByTestId(`card-journey-${marioId}`).waitFor({ state: 'visible' });
    assert.equal(await page.getByTestId(`card-journey-${luigiId}`).count(), 0);
    const visibleJourneyNames = await page.locator('[data-testid^="card-journey-"]').evaluateAll(cards =>
      cards.filter(card => card.getClientRects().length > 0).map(card => {
        const id = card.getAttribute('data-testid').slice('card-journey-'.length);
        return document.querySelector(`[data-testid="text-journey-name-${id}"]`)?.textContent?.trim();
      }).filter(Boolean));

    const excelPending = page.waitForEvent('download');
    await page.getByTestId('button-export-list-excel').click();
    const excelDownload = await excelPending;
    const excelBook = XLSX.read(fs.readFileSync(await excelDownload.path()), { type: 'buffer' });
    const excelRows = XLSX.utils.sheet_to_json(excelBook.Sheets.Elenco, { header: 1, defval: '' });
    const excelHeaderIndex = excelRows.findIndex(row => row[0] === 'Cliente');
    assert.notEqual(excelHeaderIndex, -1, 'Excel list must contain the client header');
    assert.deepEqual(
      excelRows.slice(excelHeaderIndex + 1).map(row => row[0]).filter(Boolean),
      visibleJourneyNames,
      'Excel client rows must exactly match the visible Schede cards',
    );

    const pdfPending = page.waitForEvent('download');
    await page.getByTestId('button-export-list-pdf').click();
    const pdfDownload = await pdfPending;
    const pdfText = pdfTextTokens(fs.readFileSync(await pdfDownload.path())).join(' ').replace(/\s+/g, '');
    for (const name of visibleJourneyNames) {
      assert.ok(pdfText.includes(name.replace(/\s+/g, '')), `PDF must include visible client ${name}`);
    }
    assert.ok(!pdfText.includes(`BETASERVIZI${token}SRL`), 'PDF must not include the filtered-out client');

    await page.getByTestId('button-reset-filters').click();
    await page.getByTestId(`card-journey-${luigiId}`).waitFor({ state: 'visible' });
    await page.getByTestId('input-filter-ragione-sociale').fill(`telecom ${token.toLowerCase()}`);
    await page.getByTestId(`card-journey-${marioId}`).waitFor({ state: 'visible' });
    assert.equal(await page.getByTestId(`card-journey-${luigiId}`).count(), 0, 'partial case-insensitive ragione sociale filter must hide the other journey');
    await assertNoMobileOverflow('Schede with company selected');

    // Reportistica uses the actual destination, with missing destination as
    // an explicit option; origin is never substituted for it.
    await page.getByTestId('button-reset-filters').click();
    await page.getByTestId('tab-report').click();
    await page.getByTestId('button-report-tab-dettaglio').click();
    await assertNoMobileOverflow('Reportistica');
    for (const testid of sharedFilterIds) await assertFilterFits(testid);
    await page.getByTestId(`row-report-${marioDestination}`).waitFor({ state: 'visible', timeout: 15000 });
    await page.getByTestId(`row-report-${marioOrigin}`).waitFor({ state: 'visible', timeout: 10000 });
    await page.getByTestId(`row-report-${luigiDestination}`).waitFor({ state: 'visible', timeout: 10000 });

    await page.getByTestId('select-filter-pdv-destinazione').click();
    const destinationSearch = page.getByPlaceholder('Cerca PDV destinazione...');
    await destinationSearch.waitFor({ state: 'visible' });
    assert.ok((await destinationSearch.boundingBox()).x >= 0, 'destination search must be reachable on mobile');
    await assertNoMobileOverflow('Reportistica destination menu');
    await page.getByTestId(`option-select-filter-pdv-destinazione-${marioDestination}`).click();
    await page.keyboard.press('Escape');
    await page.getByTestId('select-filter-pdv-origine').click();
    await page.getByTestId(`option-select-filter-pdv-origine-${marioOrigin}`).click();
    await page.keyboard.press('Escape');
    await page.getByTestId('input-filter-ragione-sociale').fill(`telecom ${token.toLowerCase()}`);
    await page.getByTestId(`row-report-${marioDestination}`).waitFor({ state: 'visible' });
    assert.equal(await page.getByTestId(`row-report-${marioOrigin}`).count(), 0, 'destination filter must not match an origin-only row');
    assert.equal(await page.getByTestId(`row-report-${luigiDestination}`).count(), 0, 'destination filter must hide unrelated destinations');
    await assertNoMobileOverflow('Reportistica with destination selected');
    await page.getByTestId('button-report-tab-analisi').click();
    await page.getByTestId('button-gettone-dim-addetto').click();
    await page.getByTestId(`row-gettone-${MARIO_ADDETTO}`).waitFor({ state: 'visible', timeout: 10000 });
    assert.equal(await page.getByTestId(`row-gettone-${LUIGI_ADDETTO}`).count(), 0, 'the Analisi table must share destination filtering');

    // Anche l'Excel disponibile in Reportistica usa origine, destinazione e
    // ricerca parziale sulla ragione sociale, come la tabella filtrata.
    await page.getByTestId('cj-sim-diagnostics-export').waitFor({ state: 'visible' });
    await page.waitForFunction(() => {
      const button = document.querySelector('[data-testid="cj-sim-diagnostics-export"]');
      return button && !button.disabled;
    });
    const reportExcelPending = page.waitForEvent('download');
    await page.getByTestId('cj-sim-diagnostics-export').click();
    const reportExcelDownload = await reportExcelPending;
    const reportWorkbook = XLSX.read(fs.readFileSync(await reportExcelDownload.path()), { type: 'buffer' });
    const contractRows = XLSX.utils.sheet_to_json(reportWorkbook.Sheets['Contratti SIM CJ'], { header: 1, defval: '' });
    const contractHeaderIndex = contractRows.findIndex(row => row[0] === 'ID CJ');
    assert.notEqual(contractHeaderIndex, -1, 'Reportistica Excel must contain the CJ contracts sheet');
    const exportedCustomerKeys = contractRows.slice(contractHeaderIndex + 1)
      .filter(row => row[0])
      .map(row => row[5]);
    assert.deepEqual(exportedCustomerKeys, [marioKey], 'Reportistica Excel must include only the filtered customer');
    assert.ok(!exportedCustomerKeys.includes(luigiKey), 'the filtered-out customer must not enter the Reportistica export');
    await page.getByTestId('button-report-tab-dettaglio').click();

    await page.getByTestId('button-reset-filters').click();
    await page.getByTestId('select-filter-pdv-destinazione').click();
    await page.getByTestId(`option-select-filter-pdv-destinazione-${CJ_NO_DESTINATION_FILTER_VALUE}`).click();
    await page.keyboard.press('Escape');
    await page.getByTestId(`row-report-${marioOrigin}`).waitFor({ state: 'visible' });
    assert.equal(await page.getByTestId(`row-report-${marioDestination}`).count(), 0, 'missing destination must not use the origin as a fallback');
    assert.equal(await page.getByTestId(`row-report-${luigiDestination}`).count(), 0, 'missing destination filter must hide rows with real destinations');
    await assertNoMobileOverflow('Reportistica with missing destination selected');

    await page.getByTestId('button-reset-filters').click();
    await page.getByTestId('select-filter-pdv-origine').click();
    await page.getByTestId(`option-select-filter-pdv-origine-${marioOrigin}`).click();
    await page.keyboard.press('Escape');
    await page.getByTestId(`row-report-${marioOrigin}`).waitFor({ state: 'visible' });
    assert.equal(await page.getByTestId(`row-report-${luigiOrigin}`).count(), 0, 'origin filter must independently hide rows from another origin');
    await assertNoMobileOverflow('Reportistica with origin selected');

    await page.getByTestId('button-reset-filters').click();
    await page.getByTestId('input-filter-ragione-sociale').fill(`telecom ${token.toLowerCase()}`);
    await page.getByTestId(`row-report-${marioOrigin}`).waitFor({ state: 'visible' });
    assert.equal(await page.getByTestId(`row-report-${luigiDestination}`).count(), 0, 'company filter must independently hide the other company');
    await assertNoMobileOverflow('Reportistica with company selected');

    // Le tre selezioni condivise non devono restringere lo storico Coorti; i
    // filtri locali della vista restano disponibili anche su schermo stretto.
    await page.getByTestId('select-filter-pdv-origine').click();
    await page.getByTestId(`option-select-filter-pdv-origine-${marioOrigin}`).click();
    await page.keyboard.press('Escape');
    await page.getByTestId('select-filter-pdv-destinazione').click();
    await page.getByTestId(`option-select-filter-pdv-destinazione-${marioDestination}`).click();
    await page.keyboard.press('Escape');
    await page.getByTestId('report-tab-coorti').click();
    const cohortReport = page.getByTestId('cohort-report');
    await cohortReport.waitFor({ state: 'visible', timeout: 15000 });
    assert.equal(await page.getByTestId('select-filter-pdv-origine').count(), 0, 'shared origin filter stays local to Schede and standard reports');
    assert.equal(await page.getByTestId('select-filter-pdv-destinazione').count(), 0, 'shared destination filter stays local to Schede and standard reports');
    assert.equal(await page.getByTestId('input-filter-ragione-sociale').count(), 0, 'shared company filter stays local to Schede and standard reports');
    await cohortReport.getByTestId('cohort-advanced-details').locator('summary').click();
    const cohortShop = page.getByText('Negozio apertura', { exact: true }).locator('..').getByRole('combobox');
    await cohortShop.scrollIntoViewIfNeeded();
    assert.ok(await cohortShop.isVisible(), 'Coorti keeps its own local shop filter');
    await cohortShop.click();
    await page.getByRole('option', { name: 'Tutti i negozi' }).click();
    const cohortClients = cohortReport.getByTestId('cohort-clients-panel');
    await cohortClients.getByText(marioCompany, { exact: true }).waitFor({ state: 'visible', timeout: 10000 });
    await cohortClients.getByText(luigiCompany, { exact: true }).waitFor({ state: 'visible', timeout: 10000 });
    await assertNoMobileOverflow('Coorti with local filters');

    await page.close();
    await context.close();
  } finally {
    await browser.close().catch(() => {});
    await cleanupOrg(pool, session);
    await pool.end().catch(() => {});
  }
});
