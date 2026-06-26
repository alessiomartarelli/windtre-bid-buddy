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
  setRole,
  seedJourney,
  cleanupOrg,
} from './helpers/uiTest.mjs';

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

// ===========================================================================
// SCENARIO 1: admin — espansione/chiusura riga + sotto-tabella dettaglio.
// ===========================================================================
test('scenario 1: admin can expand a gettone row and see the saturation detail', async () => {
  const pool = await newPool();
  const session = await signup({ prefix: 'cj_gettone_ui', fullName: 'CJ Gettone UI Test', organizationName: uniq('CJGettoneUI') });
  const browser = await launchBrowser();
  try {
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
    for (const h of ['Cliente', 'SIM attive', 'Piste attive', '% saturazione', 'Fatturato']) {
      assert.ok(detailText.includes(h), `detail table must include header "${h}"`);
    }
    assert.ok(detailText.includes('2/5'), 'detail row shows 2/5 piste attive');

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
    for (const h of ['Cliente', 'SIM attive', 'Piste attive', '% saturazione', 'Fatturato']) {
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

    await page.close();
    await context.close();
  } finally {
    await browser.close().catch(() => {});
    await cleanupOrg(pool, session);
    await pool.end().catch(() => {});
  }
});

// ===========================================================================
// SCENARIO 2: operatore — vede SOLO i propri clienti nell'Analisi gettoni.
// ===========================================================================
test('scenario 2: operator sees only their own clients in the gettone analysis', async () => {
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

    await page.close();
    await context.close();
  } finally {
    await browser.close().catch(() => {});
    await cleanupOrg(pool, session);
    await pool.end().catch(() => {});
  }
});

// ===========================================================================
// SCENARIO 3 (Task #195): tab "Dettaglio" (ReportView) — le righe aggregate
// rendono i valori attesi e il selettore di dimensione funziona.
// A differenza dell'Analisi gettoni le righe della tab Dettaglio non sono
// espandibili, ma il selettore "Raggruppa per" (`button-report-dim-*`) cambia
// il grouping a runtime: senza questo test una regressione del rendering o del
// re-grouping di ReportView passerebbe inosservata.
// ===========================================================================
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
