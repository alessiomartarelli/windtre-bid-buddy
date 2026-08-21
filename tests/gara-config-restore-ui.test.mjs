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
// gara_config_history). Le versioni differiscono per i pesi performance
// (input-weight-*), che sono il modo più diretto per leggere "i dati mostrati"
// dalla pagina. Poi via UI: apriamo la pagina (mostra la v2), apriamo la
// Cronologia, espandiamo le revisioni, ripristiniamo la v1 con conferma e
// verifichiamo che gli input tornino ai valori della v1 SENZA reload manuale.

const now = new Date();
const MONTH = now.getMonth() + 1;
const YEAR = now.getFullYear();

function authed(session, opts = {}) {
  return { ...opts, headers: { Cookie: session.cookieHeader, ...(opts.headers || {}) } };
}

// Attende che l'input peso `key` mostri esattamente `value`.
async function waitWeight(page, key, value) {
  await page.waitForFunction(
    ({ key: k, value: v }) => {
      const el = document.querySelector(`[data-testid="input-weight-${k}"]`);
      return el && el.value === v;
    },
    { key, value },
    { timeout: 15000 },
  );
}

async function readWeight(page, key) {
  return page.getByTestId(`input-weight-${key}`).inputValue();
}

test('restore revision from Cronologia updates the values shown on the page', async () => {
  const pool = await newPool();
  const session = await signup({ prefix: 'gara_rest_ui', fullName: 'Gara Restore UI', organizationName: uniq('GaraRestoreUI') });
  const browser = await launchBrowser();
  try {
    // --- Seed: v1 (mobile=5, fisso=7) poi v2 (mobile=9, fisso=2) sulla
    // stessa config => la v1 viene archiviata come revisione.
    const weightsV1 = { mobile: 5, fisso: 7 };
    const weightsV2 = { mobile: 9, fisso: 2 };
    const created = await jsonReq(`${BASE}/api/gara-config`, authed(session, {
      method: 'PUT',
      body: JSON.stringify({ month: MONTH, year: YEAR, name: 'Versione 1', config: { performanceWeights: weightsV1 } }),
    }));
    assert.equal(created.status, 200, JSON.stringify(created.body));
    const configId = created.body.id;

    const updated = await jsonReq(`${BASE}/api/gara-config`, authed(session, {
      method: 'PUT',
      body: JSON.stringify({ month: MONTH, year: YEAR, name: 'Versione 2', id: configId, config: { performanceWeights: weightsV2 } }),
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
    await page.getByTestId('card-performance-weights').waitFor({ state: 'visible', timeout: 20000 });
    await waitWeight(page, 'mobile', '9');
    assert.equal(await readWeight(page, 'fisso'), '2', 'page initially shows v2 weights');

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
    assert.equal(await readWeight(page, 'mobile'), '9', 'cancel keeps current (v2) values');

    // Ora conferma il ripristino.
    await restoreBtn.click();
    const confirmBtn = page.getByTestId('button-restore-confirm');
    await confirmBtn.waitFor({ state: 'visible', timeout: 10000 });
    await confirmBtn.click();

    // Il dialog Cronologia si chiude e la pagina ricarica lo stato: gli input
    // devono tornare ai valori della v1 SENZA reload manuale.
    await confirmBtn.waitFor({ state: 'hidden', timeout: 10000 });
    await waitWeight(page, 'mobile', '5');
    assert.equal(await readWeight(page, 'fisso'), '7', 'fisso restored to v1 on the page');

    // --- Verifica DB: la config corrente è tornata alla v1 e la v2 è stata
    // archiviata a sua volta (il ripristino resta annullabile).
    const cur = await pool.query(
      `SELECT name, config -> 'performanceWeights' AS w FROM gara_config WHERE id = $1`,
      [configId],
    );
    assert.equal(cur.rows[0].name, 'Versione 1');
    assert.equal(cur.rows[0].w.mobile, 5, 'DB config restored to v1');
    const revs = await pool.query(
      `SELECT name FROM gara_config_history WHERE gara_config_id = $1 ORDER BY created_at DESC, id DESC`,
      [configId],
    );
    assert.equal(revs.rowCount, 2, 'restore archives the replaced version');
    assert.equal(revs.rows[0].name, 'Versione 2');

    // --- Persistenza UI: dopo un reload la pagina mostra ancora la v1.
    await page.reload({ waitUntil: 'networkidle' });
    await page.getByTestId('card-performance-weights').waitFor({ state: 'visible', timeout: 20000 });
    await waitWeight(page, 'mobile', '5');
    assert.equal(await readWeight(page, 'fisso'), '7', 'v1 weights survive a page reload');

    await page.close();
    await context.close();
  } finally {
    await browser.close().catch(() => {});
    await cleanupOrg(pool, session);
    await pool.end().catch(() => {});
  }
});
