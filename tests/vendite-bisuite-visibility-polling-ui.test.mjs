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

async function setVisibility(page, state) {
  await page.evaluate((nextState) => {
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => nextState,
    });
    document.dispatchEvent(new Event('visibilitychange'));
  }, state);
}

test('Vendite BiSuite: il polling Oggi si ferma quando la pagina è nascosta', async () => {
  const pool = await newPool();
  const session = await signup({
    prefix: 'bisuite_visibility',
    fullName: 'BiSuite Visibility',
    organizationName: uniq('BiSuiteVisibility'),
  });
  const browser = await launchBrowser();

  try {
    const context = await newAuthedContext(browser, session);
    const page = await context.newPage();
    const automaticSyncs = [];

    await page.route('**/api/bisuite-credentials-status', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{"configured":true}' });
    });
    await page.route('**/api/bisuite-fetch', async (route) => {
      const body = route.request().postDataJSON();
      if (body?.automatic) automaticSyncs.push(body);
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ count: 0, message: 'Nessuna nuova vendita' }),
      });
    });

    await page.goto(`${BASE}/vendite-bisuite`, { waitUntil: 'networkidle' });
    await page.getByTestId('button-sales-today').waitFor({ state: 'visible', timeout: 20_000 });
    await page.clock.install();

    await page.getByTestId('button-sales-today').click();
    await page.waitForFunction(() => {
      const label = document.querySelector('[data-testid="text-last-bisuite-sync"]');
      return label?.textContent?.includes('Auto ogni 5 min');
    });
    await page.waitForTimeout(0);
    assert.equal(automaticSyncs.length, 1, 'selezionando Oggi deve partire subito una sincronizzazione automatica');
    assert.equal(automaticSyncs[0].start_date, automaticSyncs[0].end_date);

    await setVisibility(page, 'hidden');
    await page.clock.fastForward(4 * 60 * 1000);
    await setVisibility(page, 'visible');
    await page.waitForTimeout(0);
    assert.equal(automaticSyncs.length, 1, 'tornare visibile prima dei 5 minuti non deve anticipare la sincronizzazione');

    await setVisibility(page, 'hidden');
    await page.clock.fastForward(60 * 1000 + 1);
    await page.waitForTimeout(0);
    assert.equal(automaticSyncs.length, 1, 'la scadenza dell’intervallo a pagina nascosta non deve sincronizzare');

    await setVisibility(page, 'visible');
    await page.waitForTimeout(0);
    assert.equal(automaticSyncs.length, 2, 'tornando visibile dopo 5 minuti la sincronizzazione deve ripartire');

    await page.getByTestId('input-from-date').fill('2020-01-01');
    await page.getByTestId('input-to-date').fill('2020-01-31');
    await page.waitForFunction(() => {
      const from = document.querySelector('[data-testid="input-from-date"]');
      const to = document.querySelector('[data-testid="input-to-date"]');
      return from?.value === '2020-01-01' && to?.value === '2020-01-31';
    });
    await page.clock.fastForward(10 * 60 * 1000);
    await page.waitForTimeout(0);
    assert.equal(automaticSyncs.length, 2, 'gli intervalli storici non devono attivare polling');

    await context.close();
  } finally {
    await browser.close();
    await cleanupOrg(pool, session.orgId);
    await pool.end();
  }
});