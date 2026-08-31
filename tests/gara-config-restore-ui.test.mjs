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

// Task #480 — test UI Playwright per il RIPRISTINO di una revisione dalla
// Cronologia della pagina Configurazione Gara.
//
// Il flusso API/DB è già coperto da tests/gara-config-restore-db.test.mjs.
// Quello che NON era coperto è il wiring React del dialog Cronologia:
//   button-history -> button-revisions-<configId> (espansione revisioni)
//   -> button-restore-<revId> -> AlertDialog di conferma
//   (button-restore-confirm / button-restore-cancel)
//   -> loadConfigById che RICARICA lo stato mostrato in pagina.
// Una regressione su uno qualunque di questi selettori, o su
// handleRestoreRevision (che deve ricaricare la config ripristinata negli
// input), passerebbe inosservata ai test API.
//
// Strategia (pattern di tests/gara-config-weights-ui.test.mjs): signup crea
// admin+org; seminiamo DUE versioni della config del mese corrente via API
// (PUT /api/gara-config con lo stesso id => la v1 finisce archiviata in
// gara_config_history). Le versioni differiscono per le piste visibili del
// report Telegram (config.telegramReportContent, card sostitutiva dei vecchi
// pesi performance — Task #515): i checkbox `checkbox-tg-pisteVisibili-*`
// sono il modo più diretto per leggere "i dati mostrati" dalla pagina.
// Poi via UI: apriamo la pagina (mostra la v2), apriamo la Cronologia,
// espandiamo le revisioni, ripristiniamo la v1 con conferma e verifichiamo
// che i checkbox tornino allo stato della v1 SENZA reload manuale.

const now = new Date();
const MONTH = now.getMonth() + 1;
const YEAR = now.getFullYear();

function authed(session, opts = {}) {
  return { ...opts, headers: { Cookie: session.cookieHeader, ...(opts.headers || {}) } };
}

// Attende che il checkbox pisteVisibili della pista mostri lo stato atteso.
async function waitVisChecked(page, pista, expected, timeout = 15000) {
  await page.waitForFunction(
    ({ sel, want }) => {
      const el = document.querySelector(sel);
      return !!el && (el.getAttribute('data-state') === 'checked') === want;
    },
    { sel: `[data-testid="checkbox-tg-pisteVisibili-${pista}"]`, want: expected },
    { timeout },
  );
}

async function isVisChecked(page, pista) {
  const state = await page
    .getByTestId(`checkbox-tg-pisteVisibili-${pista}`)
    .getAttribute('data-state');
  return state === 'checked';
}

test('restore revision from Cronologia updates the values shown on the page', async () => {
  const pool = await newPool();
  const session = await signup({ prefix: 'gara_rest_ui', fullName: 'Gara Restore UI', organizationName: uniq('GaraRestoreUI') });
  const browser = await launchBrowser();
  try {
    // --- Seed: v1 (energia NASCOSTA, cb visibile) poi v2 (energia visibile,
    // cb NASCOSTA) sulla stessa config => la v1 viene archiviata.
    const contentV1 = {
      pisteVisibili: ['mobile', 'fisso', 'cb', 'assicurazioni', 'protecta'],
      telcoPiste: ['mobile', 'fisso'],
      newCorePiste: ['assicurazioni'],
    };
    const contentV2 = {
      pisteVisibili: ['mobile', 'fisso', 'assicurazioni', 'protecta', 'energia'],
      telcoPiste: ['mobile', 'fisso'],
      newCorePiste: ['assicurazioni', 'energia'],
    };
    const created = await jsonReq(`${BASE}/api/gara-config`, authed(session, {
      method: 'PUT',
      body: JSON.stringify({ month: MONTH, year: YEAR, name: 'Versione 1', config: { telegramReportContent: contentV1 } }),
    }));
    assert.equal(created.status, 200, JSON.stringify(created.body));
    const configId = created.body.id;

    const updated = await jsonReq(`${BASE}/api/gara-config`, authed(session, {
      method: 'PUT',
      body: JSON.stringify({ month: MONTH, year: YEAR, name: 'Versione 2', id: configId, expectedUpdatedAt: created.body.updatedAt, config: { telegramReportContent: contentV2 } }),
    }));
    assert.equal(updated.status, 200, JSON.stringify(updated.body));

    // Id della revisione archiviata (v1), serve per i data-testid dinamici.
    const revList = await jsonReq(`${BASE}/api/gara-config/revisions?configId=${configId}`, authed(session));
    assert.equal(revList.status, 200);
    assert.equal(revList.body.length, 1, 'exactly one archived revision (v1) expected');
    const revId = revList.body[0].id;
    assert.equal(revList.body[0].name, 'Versione 1');

    // --- Apri la pagina: deve mostrare la v2 (config corrente del mese).
    const context = await newAuthedContext(browser, session);
    const page = await context.newPage();
    await page.goto(`${BASE}/configurazione-gara`, { waitUntil: 'networkidle' });
    await page.getByTestId('card-telegram-content').waitFor({ state: 'visible', timeout: 20000 });
    await waitVisChecked(page, 'energia', true); // v2: energia visibile
    assert.equal(await isVisChecked(page, 'cb'), false, 'page initially shows v2 (cb hidden)');

    // --- Cronologia -> espandi revisioni -> Ripristina (v1).
    await page.getByTestId('button-history').click();
    const revisionsBtn = page.getByTestId(`button-revisions-${configId}`);
    await revisionsBtn.waitFor({ state: 'visible', timeout: 10000 });
    await revisionsBtn.click();
    const restoreBtn = page.getByTestId(`button-restore-${revId}`);
    await restoreBtn.waitFor({ state: 'visible', timeout: 10000 });

    // Prima prova l'ANNULLA: il dialog si chiude e i valori NON cambiano.
    await restoreBtn.click();
    await page.getByTestId('button-restore-cancel').waitFor({ state: 'visible', timeout: 10000 });
    await page.getByTestId('button-restore-cancel').click();
    await page.getByTestId('button-restore-confirm').waitFor({ state: 'hidden', timeout: 10000 });
    assert.equal(await isVisChecked(page, 'energia'), true, 'cancel keeps current (v2) values');

    // Ora conferma il ripristino.
    await restoreBtn.click();
    const confirmBtn = page.getByTestId('button-restore-confirm');
    await confirmBtn.waitFor({ state: 'visible', timeout: 10000 });
    await confirmBtn.click();

    // Il dialog Cronologia si chiude e la pagina ricarica lo stato: i checkbox
    // devono tornare allo stato della v1 SENZA reload manuale.
    await confirmBtn.waitFor({ state: 'hidden', timeout: 10000 });
    await waitVisChecked(page, 'energia', false); // v1: energia nascosta
    assert.equal(await isVisChecked(page, 'cb'), true, 'cb restored to v1 on the page');

    // --- Verifica DB: la config corrente è tornata alla v1 e la v2 è stata
    // archiviata a sua volta (il ripristino resta annullabile).
    const cur = await pool.query(
      `SELECT name, config -> 'telegramReportContent' AS c FROM gara_config WHERE id = $1`,
      [configId],
    );
    assert.equal(cur.rows[0].name, 'Versione 1');
    assert.deepEqual(cur.rows[0].c.pisteVisibili.slice().sort(), contentV1.pisteVisibili.slice().sort(), 'DB config restored to v1');
    const revs = await pool.query(
      `SELECT name FROM gara_config_history WHERE gara_config_id = $1 ORDER BY created_at DESC, id DESC`,
      [configId],
    );
    assert.equal(revs.rowCount, 2, 'restore archives the replaced version');
    assert.equal(revs.rows[0].name, 'Versione 2');

    // --- Persistenza UI: dopo un reload la pagina mostra ancora la v1.
    await page.reload({ waitUntil: 'networkidle' });
    await page.getByTestId('card-telegram-content').waitFor({ state: 'visible', timeout: 20000 });
    await waitVisChecked(page, 'energia', false);
    assert.equal(await isVisChecked(page, 'cb'), true, 'v1 content survives a page reload');

    await page.close();
    await context.close();
  } finally {
    await browser.close().catch(() => {});
    await cleanupOrg(pool, session);
    await pool.end().catch(() => {});
  }
});
