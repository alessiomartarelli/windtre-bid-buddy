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

// Test suite UI Playwright per la card "Contenuti report Telegram" nella
// pagina Configurazione Gara (`card-telegram-content`, Task #515 — sostituisce
// la vecchia card dei pesi performance).
//
// Perché serve un test UI e non solo logica pura: il parser/normalizzatore
// (parseTelegramReportContent in shared/telegramReportContent.ts) è coperto
// dai test puri. Quello che NON è coperto è il wiring React fra i checkbox
// `checkbox-tg-*`, il salvataggio in `gara_config.config.telegramReportContent`
// e il ricaricamento al reload / al cambio mese. Una regressione qui (piste
// deselezionate non persistite, o il mese sbagliato che eredita la selezione
// di un altro) passerebbe inosservata.
//
// Strategia: signup crea un profilo admin + org. La pagina apre sul mese/anno
// correnti con la selezione di default (tutte le piste legacy). Deselezioniamo
// alcune piste (visibili + gruppi), salviamo, poi verifichiamo la persistenza
// sia via DB sia ricaricando la UI. Uno scenario dedicato prova che cambiando
// mese la selezione torna al default e che tornando al mese salvato si
// ricarica. Cleanup completo del dev DB alla fine.

const now = new Date();
const CUR_MONTH = now.getMonth() + 1;
const CUR_YEAR = now.getFullYear();

const OTHER_MONTH = CUR_MONTH === 1 ? 2 : 1;
const OTHER_MONTH_NAME = OTHER_MONTH === 1 ? 'Gennaio' : 'Febbraio';
const CUR_MONTH_NAME = [
  'Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno',
  'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre',
][CUR_MONTH - 1];

// Apre la pagina Configurazione Gara autenticata e attende la card contenuti.
//
// ATTENZIONE (anti-flake): la card è renderizzata SUBITO, mentre
// `loadMonthConfig` gira async al mount e per un'org appena creata RESETTA lo
// stato al default dopo la GET `/api/gara-config?...`, chiamando poi
// `/api/gara-config/pdv-from-sales`. Se clicchiamo prima che quel load
// finisca, il reset cancella la selezione appena fatta. Attendiamo quindi la
// risposta di `pdv-from-sales` (ultima fetch del ramo, successiva al reset).
async function openPage(context) {
  const page = await context.newPage();
  const pdvFromSales = page
    .waitForResponse(
      (r) => r.url().includes('/api/gara-config/pdv-from-sales'),
      { timeout: 20000 },
    )
    .catch(() => null);
  await page.goto(`${BASE}/configurazione-gara`, { waitUntil: 'networkidle' });
  await page.getByTestId('card-telegram-content').waitFor({ state: 'visible', timeout: 20000 });
  await pdvFromSales;
  // Default: protecta visibile (checkbox spuntato) dopo il load iniziale.
  await waitChecked(page, 'pisteVisibili', 'protecta', true);
  return page;
}

function cb(page, field, pista) {
  return page.getByTestId(`checkbox-tg-${field}-${pista}`);
}

async function isChecked(page, field, pista) {
  return (await cb(page, field, pista).getAttribute('data-state')) === 'checked';
}

async function waitChecked(page, field, pista, expected, timeout = 15000) {
  await page.waitForFunction(
    ({ sel, want }) => {
      const el = document.querySelector(sel);
      return !!el && (el.getAttribute('data-state') === 'checked') === want;
    },
    { sel: `[data-testid="checkbox-tg-${field}-${pista}"]`, want: expected },
    { timeout },
  );
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

// Legge telegramReportContent persistito nel DB per (org, month, year).
async function readPersistedContent(pool, orgId, month, year) {
  const r = await pool.query(
    `SELECT config -> 'telegramReportContent' AS c
       FROM gara_config
      WHERE organization_id = $1 AND month = $2 AND year = $3
      ORDER BY updated_at DESC
      LIMIT 1`,
    [orgId, month, year],
  );
  return r.rows[0]?.c ?? null;
}

// ===========================================================================
// SCENARIO 1: deselezionare piste (visibili + gruppo), salvare, ricaricare ->
// selezione persistita in gara_config.config.telegramReportContent.
// ===========================================================================
test('scenario 1: telegram content selection saves, persists to gara_config, and reloads', async () => {
  const pool = await newPool();
  const session = await signup({ prefix: 'gara_tgcontent_ui', fullName: 'Gara TgContent UI', organizationName: uniq('GaraTgContentUI') });
  const browser = await launchBrowser();
  try {
    const context = await newAuthedContext(browser, session);
    const page = await openPage(context);

    // Deseleziona protecta e cb dalle piste visibili, e fisso dal gruppo TELCO.
    await cb(page, 'pisteVisibili', 'protecta').click();
    await cb(page, 'pisteVisibili', 'cb').click();
    await cb(page, 'telcoPiste', 'fisso').click();

    await saveConfig(page, 'Contenuti Test');

    // --- Verifica DB: array normalizzati senza le piste deselezionate.
    const persisted = await readPersistedContent(pool, session.orgId, CUR_MONTH, CUR_YEAR);
    assert.ok(persisted, 'telegramReportContent must be persisted in gara_config');
    assert.deepEqual(persisted.pisteVisibili, ['mobile', 'fisso', 'assicurazioni', 'energia'], 'protecta+cb removed from visible piste');
    assert.deepEqual(persisted.telcoPiste, ['mobile'], 'fisso removed from TELCO group');
    assert.deepEqual(persisted.newCorePiste, ['assicurazioni', 'energia'], 'NEW CORE group untouched (defaults)');

    // --- Ricarica la pagina: la selezione salvata deve ripopolare i checkbox.
    await page.reload({ waitUntil: 'networkidle' });
    await page.getByTestId('card-telegram-content').waitFor({ state: 'visible', timeout: 20000 });
    await waitChecked(page, 'pisteVisibili', 'protecta', false);

    assert.equal(await isChecked(page, 'pisteVisibili', 'protecta'), false, 'protecta stays unchecked after reload');
    assert.equal(await isChecked(page, 'pisteVisibili', 'cb'), false, 'cb stays unchecked after reload');
    assert.equal(await isChecked(page, 'pisteVisibili', 'mobile'), true, 'mobile still checked after reload');
    assert.equal(await isChecked(page, 'telcoPiste', 'fisso'), false, 'TELCO fisso stays unchecked after reload');
    assert.equal(await isChecked(page, 'telcoPiste', 'mobile'), true, 'TELCO mobile still checked');
    assert.equal(await isChecked(page, 'newCorePiste', 'energia'), true, 'NEW CORE energia still checked');

    // I criteri fissi restano documentati nella card.
    const fixed = await page.getByTestId('text-tg-criteri-fissi').textContent();
    assert.ok(/Telefoni: pezzi/.test(fixed), 'fixed criteria note present');

    await page.close();
    await context.close();
  } finally {
    await browser.close().catch(() => {});
    await cleanupOrg(pool, session);
    await pool.end().catch(() => {});
  }
});

// ===========================================================================
// SCENARIO 2: cambiando mese la selezione torna al default (mese senza
// config); tornando al mese salvato si ricarica.
// ===========================================================================
test('scenario 2: switching month resets selection to defaults, switching back reloads it', async () => {
  const pool = await newPool();
  const session = await signup({ prefix: 'gara_tgcontent_ui', fullName: 'Gara TgContent UI', organizationName: uniq('GaraTgContentUI') });
  const browser = await launchBrowser();
  try {
    const context = await newAuthedContext(browser, session);
    const page = await openPage(context);

    // Salva selezione per il mese corrente (senza energia visibile).
    await cb(page, 'pisteVisibili', 'energia').click();
    await saveConfig(page, 'Contenuti Mese Corrente');
    assert.equal(await isChecked(page, 'pisteVisibili', 'energia'), false, 'energia unchecked for current month');

    // --- Cambia mese verso un mese SENZA config: torna al default (spuntato).
    await page.getByTestId('select-month').click();
    await page.getByRole('option', { name: OTHER_MONTH_NAME, exact: true }).click();
    await waitChecked(page, 'pisteVisibili', 'energia', true);
    assert.equal(await isChecked(page, 'pisteVisibili', 'energia'), true, 'selection reset to defaults on unconfigured month');

    // --- Torna al mese salvato: la selezione deve ricaricarsi.
    await page.getByTestId('select-month').click();
    await page.getByRole('option', { name: CUR_MONTH_NAME, exact: true }).click();
    await waitChecked(page, 'pisteVisibili', 'energia', false);
    assert.equal(await isChecked(page, 'pisteVisibili', 'energia'), false, 'saved selection reloaded when switching back');

    await page.close();
    await context.close();
  } finally {
    await browser.close().catch(() => {});
    await cleanupOrg(pool, session);
    await pool.end().catch(() => {});
  }
});
