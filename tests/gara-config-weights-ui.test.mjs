import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BASE,
  uniq,
  signup,
  newPool,
  launchBrowser,
  newAuthedContext,
  cleanupOrg,
} from './helpers/uiTest.mjs';

// Test suite UI Playwright per la card "Pesi punteggio performance" nella
// pagina Configurazione Gara (`card-performance-weights`).
//
// Perché serve un test UI e non solo logica pura: gli helper puri
// (weightsToForm/weightsFormToPayload/weightsFormHasValue in
// ConfigurazioneGara.tsx, allineati a DEFAULT_PERFORMANCE_WEIGHTS di
// shared/venditeReport.ts) sono coperti dai test puri. Quello che NON è
// coperto è il wiring React fra gli input `input-weight-*`, il salvataggio in
// `gara_config.config.performanceWeights` e il ricaricamento al reload / al
// cambio mese. Una regressione qui (valori non persistiti, campi non
// ricaricati, o il mese sbagliato che eredita i pesi di un altro) passerebbe
// inosservata.
//
// Strategia: signup crea un profilo admin + org (il modulo
// `gara_configurazione` è abilitato di default). La pagina apre sul mese/anno
// correnti. Riempiamo alcuni campi peso, lasciandone altri VUOTI (per provare
// il fallback ai default di sistema = payload null), salviamo con un nome
// configurazione, poi verifichiamo la persistenza sia via DB sia ricaricando
// la UI. Uno scenario dedicato prova che cambiando mese i pesi si azzerano e
// che tornando al mese salvato si ricaricano. Cleanup completo del dev DB alla
// fine.

const now = new Date();
const CUR_MONTH = now.getMonth() + 1;
const CUR_YEAR = now.getFullYear();

// Mese "vuoto" (diverso da quello corrente) per lo scenario di cambio mese:
// scegliamo un mese sicuramente diverso da CUR_MONTH così `loadMonthConfig`
// non trova config e i pesi devono azzerarsi.
const OTHER_MONTH = CUR_MONTH === 1 ? 2 : 1;
const OTHER_MONTH_NAME = OTHER_MONTH === 1 ? 'Gennaio' : 'Febbraio';
const CUR_MONTH_NAME = [
  'Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno',
  'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre',
][CUR_MONTH - 1];

// Apre la pagina Configurazione Gara autenticata e attende la card dei pesi.
//
// ATTENZIONE (anti-flake): la card `card-performance-weights` è renderizzata
// SUBITO (i Tabs non sono gated dal caricamento iniziale), mentre
// `loadMonthConfig` gira async al mount. Per un'org appena creata (nessuna
// config) il ramo "vuoto" di quel load AZZERA i pesi (`EMPTY_WEIGHTS_FORM`)
// dopo che la GET `/api/gara-config?month=...` risolve, e SOLO DOPO chiama
// `/api/gara-config/pdv-from-sales`. Se digitiamo prima che quel load finisca,
// sotto carico il wipe cancella i valori appena inseriti. Attendiamo quindi la
// risposta di `pdv-from-sales` (ultima fetch del ramo, successiva al wipe) così
// lo stato dei pesi è stabile prima di digitare.
async function openPage(context) {
  const page = await context.newPage();
  const pdvFromSales = page
    .waitForResponse(
      (r) => r.url().includes('/api/gara-config/pdv-from-sales'),
      { timeout: 20000 },
    )
    .catch(() => null);
  await page.goto(`${BASE}/configurazione-gara`, { waitUntil: 'networkidle' });
  await page.getByTestId('card-performance-weights').waitFor({ state: 'visible', timeout: 20000 });
  await pdvFromSales;
  // I pesi partono vuoti dopo il load iniziale di un'org senza config.
  await page.waitForFunction(
    () => {
      const el = document.querySelector('[data-testid="input-weight-mobile"]');
      return el && el.value === '';
    },
    null,
    { timeout: 15000 },
  );
  return page;
}

// Compila un campo peso (svuota + digita).
async function fillWeight(page, key, value) {
  const input = page.getByTestId(`input-weight-${key}`);
  await input.fill(value);
}

// Legge il valore corrente di un input peso.
async function readWeight(page, key) {
  return page.getByTestId(`input-weight-${key}`).inputValue();
}

// Salva la configurazione corrente: apre il dialog (button-save), scrive il
// nome e conferma. Attende la chiusura del dialog.
async function saveConfig(page, name) {
  await page.getByTestId('button-save').click();
  const nameInput = page.getByTestId('input-config-name');
  await nameInput.waitFor({ state: 'visible', timeout: 10000 });
  await nameInput.fill(name);
  await page.getByTestId('button-confirm-save').click();
  await page.getByTestId('input-config-name').waitFor({ state: 'hidden', timeout: 10000 });
}

// Legge performanceWeights persistito nel DB per (org, month, year).
async function readPersistedWeights(pool, orgId, month, year) {
  const r = await pool.query(
    `SELECT config -> 'performanceWeights' AS w
       FROM gara_config
      WHERE organization_id = $1 AND month = $2 AND year = $3
      ORDER BY updated_at DESC
      LIMIT 1`,
    [orgId, month, year],
  );
  return r.rows[0]?.w ?? null;
}

// ===========================================================================
// SCENARIO 1: digitare pesi, salvare, ricaricare -> valori persistiti; i campi
// lasciati vuoti restano vuoti (fallback ai default = payload null).
// ===========================================================================
test('scenario 1: weights save, persist to gara_config, and reload; empty fields fall back to defaults', async () => {
  const pool = await newPool();
  const session = await signup({ prefix: 'gara_weights_ui', fullName: 'Gara Weights UI', organizationName: uniq('GaraWeightsUI') });
  const browser = await launchBrowser();
  try {
    const context = await newAuthedContext(browser, session);
    const page = await openPage(context);

    // Compila alcuni pesi (mobile/fisso interi, cb decimale — l'input è
    // type=number quindi il separatore è il punto), lasciando VUOTI
    // energia/assicurazioni/protecta/telefoni.
    await fillWeight(page, 'mobile', '5');
    await fillWeight(page, 'fisso', '7');
    await fillWeight(page, 'cb', '1.5');
    await fillWeight(page, 'ivaMultiplier', '3');

    await saveConfig(page, 'Pesi Test');

    // --- Verifica DB: i pesi compilati sono numeri, i vuoti sono null.
    const persisted = await readPersistedWeights(pool, session.orgId, CUR_MONTH, CUR_YEAR);
    assert.ok(persisted, 'performanceWeights must be persisted in gara_config');
    assert.equal(persisted.mobile, 5, 'mobile weight persisted');
    assert.equal(persisted.fisso, 7, 'fisso weight persisted');
    assert.equal(persisted.cb, 1.5, 'cb decimal (comma) persisted as 1.5');
    assert.equal(persisted.ivaMultiplier, 3, 'ivaMultiplier persisted');
    assert.equal(persisted.energia, null, 'empty energia stored as null (falls back to default)');
    assert.equal(persisted.assicurazioni, null, 'empty assicurazioni stored as null');
    assert.equal(persisted.protecta, null, 'empty protecta stored as null');
    assert.equal(persisted.telefoni, null, 'empty telefoni stored as null');

    // --- Ricarica la pagina: i valori salvati devono ripopolare gli input,
    // i campi vuoti devono restare vuoti (mostrano il placeholder = default).
    await page.reload({ waitUntil: 'networkidle' });
    await page.getByTestId('card-performance-weights').waitFor({ state: 'visible', timeout: 20000 });
    // Attende che il reload della config abbia ripopolato "mobile".
    await page.waitForFunction(
      () => {
        const el = document.querySelector('[data-testid="input-weight-mobile"]');
        return el && el.value === '5';
      },
      null,
      { timeout: 15000 },
    );

    assert.equal(await readWeight(page, 'mobile'), '5', 'mobile reloaded');
    assert.equal(await readWeight(page, 'fisso'), '7', 'fisso reloaded');
    assert.equal(await readWeight(page, 'ivaMultiplier'), '3', 'ivaMultiplier reloaded');
    // cb può essere formattato con il punto dopo il round-trip JSON -> string.
    const cb = await readWeight(page, 'cb');
    assert.ok(cb === '1,5' || cb === '1.5', `cb reloaded (got ${JSON.stringify(cb)})`);
    // I campi lasciati vuoti restano vuoti dopo il reload.
    assert.equal(await readWeight(page, 'energia'), '', 'empty energia stays empty after reload');
    assert.equal(await readWeight(page, 'protecta'), '', 'empty protecta stays empty after reload');
    assert.equal(await readWeight(page, 'telefoni'), '', 'empty telefoni stays empty after reload');

    await page.close();
    await context.close();
  } finally {
    await browser.close().catch(() => {});
    await cleanupOrg(pool, session);
    await pool.end().catch(() => {});
  }
});

// ===========================================================================
// SCENARIO 2: cambiando mese i pesi si azzerano (mese senza config); tornando
// al mese salvato i pesi si ricaricano.
// ===========================================================================
test('scenario 2: switching month clears weights, switching back reloads them', async () => {
  const pool = await newPool();
  const session = await signup({ prefix: 'gara_weights_ui', fullName: 'Gara Weights UI', organizationName: uniq('GaraWeightsUI') });
  const browser = await launchBrowser();
  try {
    const context = await newAuthedContext(browser, session);
    const page = await openPage(context);

    // Salva pesi per il mese corrente.
    await fillWeight(page, 'mobile', '8');
    await fillWeight(page, 'fisso', '4');
    await saveConfig(page, 'Pesi Mese Corrente');
    assert.equal(await readWeight(page, 'mobile'), '8', 'mobile set for current month');

    // --- Cambia mese verso un mese SENZA config: i pesi devono azzerarsi.
    await page.getByTestId('select-month').click();
    await page.getByRole('option', { name: OTHER_MONTH_NAME, exact: true }).click();
    await page.waitForFunction(
      () => {
        const el = document.querySelector('[data-testid="input-weight-mobile"]');
        return el && el.value === '';
      },
      null,
      { timeout: 15000 },
    );
    assert.equal(await readWeight(page, 'mobile'), '', 'weights cleared when switching to an unconfigured month');
    assert.equal(await readWeight(page, 'fisso'), '', 'fisso cleared for the other month');

    // --- Torna al mese salvato: i pesi devono ricaricarsi.
    await page.getByTestId('select-month').click();
    await page.getByRole('option', { name: CUR_MONTH_NAME, exact: true }).click();
    await page.waitForFunction(
      () => {
        const el = document.querySelector('[data-testid="input-weight-mobile"]');
        return el && el.value === '8';
      },
      null,
      { timeout: 15000 },
    );
    assert.equal(await readWeight(page, 'mobile'), '8', 'weights reloaded when switching back to the saved month');
    assert.equal(await readWeight(page, 'fisso'), '4', 'fisso reloaded for the saved month');

    await page.close();
    await context.close();
  } finally {
    await browser.close().catch(() => {});
    await cleanupOrg(pool, session);
    await pool.end().catch(() => {});
  }
});
