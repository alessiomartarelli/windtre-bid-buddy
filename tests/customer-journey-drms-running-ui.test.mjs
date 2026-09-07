import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BASE, signup, cleanupOrg, newPool, launchBrowser, newAuthedContext,
  setCjTriggerDate, seedJourney,
} from './helpers/uiTest.mjs';

// UI: il pulsante "Esita da DRMS" resta disabilitato mentre il ricalcolo è in
// corso lato server (drms-status.outcomeRunning=true), poi si riabilita e i
// dati CJ vengono ricaricati. Il run lungo è simulato con l'hook non-prod
// `x-test-cj-drms-delay-ms` (vedi server/routes.ts): l'attesa inline è 10s,
// quindi con un ritardo maggiore la POST risponde 202.
// Richiede dev server su :5000 + DATABASE_URL.

const DELAY_HEADER = 'x-test-cj-drms-delay-ms';
const RUN_DELAY_MS = 16_000;

test('DRMS running: pulsante disabilitato durante il run, riabilitato e refetch al termine', async (t) => {
  const pool = await newPool();
  const session = await signup({ prefix: 'cj_drms_running_ui', fullName: 'CJ DRMS Running' });
  const { orgId } = session;
  const browser = await launchBrowser();
  t.after(async () => {
    await browser.close().catch(() => {});
    await cleanupOrg(pool, orgId);
    await pool.end();
  });

  await setCjTriggerDate(pool, orgId, '2026-01-01');
  const journeyId = await seedJourney(pool, orgId, {
    customerKey: 'RSSMRA80A01H501U', nome: 'Mario Prima', openedAt: '2026-07-11T00:00:00.000Z', dataInserimento: '2026-07-11T10:00:00.000Z',
    items: [{ driver: 'mobile' }],
  });

  const ctx = await newAuthedContext(browser, session);
  const page = await ctx.newPage();

  // Inietta l'header di ritardo SOLO sulla POST "Esita da DRMS" partita dal click.
  let esitaCalls = 0;
  await page.route('**/api/customer-journeys/esita-drms', async (route) => {
    esitaCalls++;
    await route.continue({ headers: { ...route.request().headers(), [DELAY_HEADER]: String(RUN_DELAY_MS) } });
  });

  await page.goto(`${BASE}/customer-journey`, { waitUntil: 'domcontentloaded' });
  const card = page.getByTestId(`card-journey-${journeyId}`);
  await card.waitFor({ state: 'visible', timeout: 30000 });
  assert.match(await card.innerText(), /Mario Prima/);

  const btn = page.getByTestId('button-esita-drms');
  await btn.waitFor({ state: 'visible', timeout: 10000 });
  assert.equal(await btn.getAttribute('data-drms-running'), 'false');
  assert.equal(await btn.isDisabled(), false);

  // 1) Click → mutation pending (disabilitato) → 202 → outcomeRunning=true.
  const esitaResponse = page.waitForResponse((r) => r.url().includes('/api/customer-journeys/esita-drms'), { timeout: 30000 });
  await btn.click();
  await page.waitForFunction(() => document.querySelector('[data-testid="button-esita-drms"]')?.hasAttribute('disabled'), null, { timeout: 5000 });

  // Il server conferma il run in corso anche via drms-status.
  const statusApi = await ctx.request.get(`${BASE}/api/customer-journeys/drms-status`);
  assert.equal(statusApi.status(), 200);
  assert.equal((await statusApi.json()).outcomeRunning, true);

  const res = await esitaResponse;
  assert.equal(res.status(), 202, 'con il ritardo iniettato la POST deve rispondere 202');

  await page.waitForFunction(() => document.querySelector('[data-testid="button-esita-drms"]')?.getAttribute('data-drms-running') === 'true', null, { timeout: 10000 });
  assert.equal(await btn.isDisabled(), true);
  assert.match(await btn.innerText(), /Esito DRMS in corso…/);
  assert.equal(await btn.locator('svg.animate-spin').count(), 1);

  // Un secondo click non deve partire (pulsante disabilitato).
  await btn.click({ force: true, trial: false }).catch(() => {});
  assert.equal(esitaCalls, 1);

  // 2) Durante il run modifico un dato in DB: al termine la pagina deve
  //    rifetchare le journey e mostrare il nuovo nome senza reload.
  await pool.query(`UPDATE customer_journeys SET nome = 'Mario Dopo' WHERE id = $1`, [journeyId]);
  assert.doesNotMatch(await card.innerText(), /Mario Dopo/);

  // 3) Fine del run: riabilitato, testo originale, toast, refetch.
  await page.waitForFunction(() => document.querySelector('[data-testid="button-esita-drms"]')?.getAttribute('data-drms-running') === 'false', null, { timeout: RUN_DELAY_MS + 20000 });
  assert.equal(await btn.isDisabled(), false);
  assert.match(await btn.innerText(), /^Esita da DRMS$/m);
  await page.getByText('Esito da DRMS terminato').first().waitFor({ state: 'visible', timeout: 10000 });
  await page.waitForFunction((id) => /Mario Dopo/.test(document.querySelector(`[data-testid="card-journey-${id}"]`)?.textContent ?? ''), journeyId, { timeout: 15000 });

  const statusAfter = await (await ctx.request.get(`${BASE}/api/customer-journeys/drms-status`)).json();
  assert.equal(statusAfter.outcomeRunning, false);
  // Il riepilogo del run "pending" è arrivato in notifica.
  const notif = await pool.query(`SELECT status FROM bisuite_sync_notifications WHERE organization_id = $1 AND status = 'cj_drms_outcome'`, [orgId]);
  assert.equal(notif.rows.length, 1);
});
