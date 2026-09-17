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

const OBSERVATION_MS = 4_000;
const SAMPLE_MS = 250;

function apiPath(rawUrl) {
  const url = new URL(rawUrl);
  return `${url.pathname}${url.search}`;
}

test('il tab Incentivazione resta montato senza rilanciare le API di configurazione gara', async () => {
  const pool = await newPool();
  const session = await signup({
    prefix: 'gara_inc_stability_ui',
    fullName: 'Gara Incentivazione Stability UI',
    organizationName: uniq('GaraIncStabilityUI'),
  });
  const browser = await launchBrowser();

  try {
    const context = await newAuthedContext(browser, session);
    const page = await context.newPage();
    const requests = [];
    page.on('request', (request) => {
      const path = apiPath(request.url());
      if (
        request.method() === 'GET'
        && (path.startsWith('/api/gara-config') || path === '/api/incentivazione/configs')
      ) {
        requests.push(path);
      }
    });

    await page.goto(`${BASE}/configurazione-gara`, { waitUntil: 'networkidle' });
    const tab = page.getByTestId('tab-incentivazione');
    await tab.waitFor({ state: 'visible', timeout: 20_000 });

    const garaRequestsBeforeClick = requests.filter((path) => path.startsWith('/api/gara-config')).length;
    assert.ok(garaRequestsBeforeClick > 0, 'la pagina deve aver caricato gara-config prima del click');

    const incentivazioneResponse = page.waitForResponse(
      (response) => (
        response.request().method() === 'GET'
        && new URL(response.url()).pathname === '/api/incentivazione/configs'
      ),
      { timeout: 20_000 },
    );
    await tab.click();
    await incentivazioneResponse;

    const heading = page.getByRole('heading', {
      name: 'Incentivazione interna · Configurazioni gara',
      exact: true,
    });
    await heading.waitFor({ state: 'visible', timeout: 20_000 });
    const mountedHeading = await heading.elementHandle();
    assert.ok(mountedHeading, 'la configurazione Incentivazione deve essere montata');

    const deadline = Date.now() + OBSERVATION_MS;
    while (Date.now() < deadline) {
      assert.equal(
        await mountedHeading.evaluate((node) => {
          const style = getComputedStyle(node);
          return node.isConnected
            && style.display !== 'none'
            && style.visibility !== 'hidden'
            && node.getBoundingClientRect().height > 0;
        }),
        true,
        'il contenuto Incentivazione non deve smontarsi o sparire',
      );
      assert.equal(await tab.getAttribute('data-state'), 'active', 'il tab Incentivazione deve restare attivo');
      await page.waitForTimeout(SAMPLE_MS);
    }

    const garaRequestsAfterObservation = requests.filter((path) => path.startsWith('/api/gara-config')).length;
    const incentivazioneRequests = requests.filter((path) => path === '/api/incentivazione/configs').length;
    assert.equal(
      garaRequestsAfterObservation,
      garaRequestsBeforeClick,
      'il click su Incentivazione non deve rilanciare le GET gara-config',
    );
    assert.equal(
      incentivazioneRequests,
      1,
      'la lista configurazioni Incentivazione deve essere richiesta una sola volta',
    );

    await page.close();
    await context.close();
  } finally {
    await browser.close().catch(() => {});
    await cleanupOrg(pool, session);
    await pool.end().catch(() => {});
  }
});