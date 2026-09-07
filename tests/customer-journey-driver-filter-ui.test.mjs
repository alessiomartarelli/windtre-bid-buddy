import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BASE,
  uniq,
  signup,
  newPool,
  launchBrowser,
  newAuthedContext,
  setCjTriggerDate,
  seedJourney,
  addJourneyItem,
  cleanupOrg,
} from './helpers/uiTest.mjs';

// Test UI Playwright: filtro "Prodotti acquistati" sopra le schede clienti.
// Ogni pista cross-sell cicla tutti → con (già acquistata) → senza (non
// acquistata); le condizioni sui vari driver sono in AND e i contatori dei chip
// Tutti/Privati/Business seguono il set filtrato. La logica pura è coperta in
// tests/customer-journey-report.test.mjs (matchesCjDriverFilter); qui si
// verifica il ciclo dei click e l'effetto sulla lista renderizzata.

async function seedCohort(pool, orgId) {
  const specs = [
    ['SoloMobile', []],
    ['ConFisso', ['fisso']],
    ['FissoEnergia', ['fisso', 'energia']],
  ];
  const ids = {};
  for (const [key, drivers] of specs) {
    const id = await seedJourney(pool, orgId, {
      customerKey: key, nome: key, addetto: 'Mario', pdv: 'PDV 1',
      openedAt: '2026-07-05', dataInserimento: '2026-07-05',
    });
    await addJourneyItem(pool, orgId, id, { driver: 'mobile', state: 'attivo', dataInserimento: '2026-07-05' });
    for (const d of drivers) {
      await addJourneyItem(pool, orgId, id, { driver: d, state: 'attivo', dataInserimento: '2026-07-06' });
    }
    ids[key] = id;
  }
  return ids;
}

test('schede clienti: filtro con/senza per driver acquistati', async () => {
  const pool = await newPool();
  const session = await signup({ prefix: 'cj_drvf', fullName: 'CJ Driver Filter', organizationName: uniq('CJDRVF') });
  const browser = await launchBrowser();
  try {
    await setCjTriggerDate(pool, session.orgId, '2026-07-01');
    const ids = await seedCohort(pool, session.orgId);

    const context = await newAuthedContext(browser, session);
    const page = await context.newPage();
    await page.goto(`${BASE}/customer-journey`, { waitUntil: 'networkidle' });
    for (const id of Object.values(ids)) {
      await page.getByTestId(`card-journey-${id}`).waitFor({ state: 'visible', timeout: 20000 });
    }
    const visible = async () => {
      const out = {};
      for (const [k, id] of Object.entries(ids)) out[k] = await page.getByTestId(`card-journey-${id}`).isVisible();
      return out;
    };
    const countTutti = async () => (await page.getByTestId('button-filter-tutti').innerText()).replace(/\D/g, '');

    const fisso = page.getByTestId('button-driver-filter-fisso');
    const energia = page.getByTestId('button-driver-filter-energia');
    assert.equal(await fisso.getAttribute('data-mode'), 'any', 'default: nessun filtro driver');
    assert.equal(await page.getByTestId('button-driver-filter-reset').count(), 0);

    // 1° click: "con fisso" ⇒ restano ConFisso e FissoEnergia.
    await fisso.click();
    assert.equal(await fisso.getAttribute('data-mode'), 'con');
    await page.getByTestId(`card-journey-${ids.SoloMobile}`).waitFor({ state: 'hidden', timeout: 10000 });
    assert.deepEqual(await visible(), { SoloMobile: false, ConFisso: true, FissoEnergia: true });
    assert.equal(await countTutti(), '2', 'il chip Tutti segue il filtro driver');

    // + "senza energia" (2 click sull'energia: con → senza) ⇒ solo ConFisso.
    await energia.click();
    assert.equal(await energia.getAttribute('data-mode'), 'con');
    await energia.click();
    assert.equal(await energia.getAttribute('data-mode'), 'senza');
    await page.getByTestId(`card-journey-${ids.FissoEnergia}`).waitFor({ state: 'hidden', timeout: 10000 });
    assert.deepEqual(await visible(), { SoloMobile: false, ConFisso: true, FissoEnergia: false });
    assert.equal(await countTutti(), '1');

    // 3° click sul fisso: senza fisso + senza energia ⇒ solo SoloMobile.
    await fisso.click();
    assert.equal(await fisso.getAttribute('data-mode'), 'senza');
    await page.getByTestId(`card-journey-${ids.SoloMobile}`).waitFor({ state: 'visible', timeout: 10000 });
    assert.deepEqual(await visible(), { SoloMobile: true, ConFisso: false, FissoEnergia: false });

    // Reset dedicato ⇒ torna tutto visibile.
    await page.getByTestId('button-driver-filter-reset').click();
    await page.getByTestId(`card-journey-${ids.FissoEnergia}`).waitFor({ state: 'visible', timeout: 10000 });
    assert.deepEqual(await visible(), { SoloMobile: true, ConFisso: true, FissoEnergia: true });
    assert.equal(await fisso.getAttribute('data-mode'), 'any');
    assert.equal(await energia.getAttribute('data-mode'), 'any');
    assert.equal(await countTutti(), '3');

    // "Azzera filtri" generale azzera anche il filtro driver.
    await fisso.click();
    await page.getByTestId(`card-journey-${ids.SoloMobile}`).waitFor({ state: 'hidden', timeout: 10000 });
    await page.getByTestId('button-reset-filters').click();
    await page.getByTestId(`card-journey-${ids.SoloMobile}`).waitFor({ state: 'visible', timeout: 10000 });
    assert.equal(await fisso.getAttribute('data-mode'), 'any');

    await page.close();
    await context.close();
  } finally {
    await browser.close().catch(() => {});
    await cleanupOrg(pool, session);
    await pool.end().catch(() => {});
  }
});
