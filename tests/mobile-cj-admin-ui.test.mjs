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
  seedJourney,
  setCjTriggerDate,
  setRole,
} from './helpers/uiTest.mjs';

// Mobile UI (375×812 + touch) per il blocco task #373: Customer Journey,
// Preventivatore, Simulatore, Canvass, Incentivazione, Admin, SuperAdmin,
// Profilo, Dashboard (tabella PDV). Verifica: nessun overflow orizzontale,
// dialog full-screen (ResponsiveDialogContent), timeline CJ e tabella PDV con
// header sticky + scroll orizzontale accessibile (ScrollableTable).

async function assertNoHorizontalOverflow(page, label) {
  const o = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  assert.ok(
    o.scrollWidth <= o.innerWidth + 1,
    `${label}: horizontal overflow on mobile (scrollWidth=${o.scrollWidth}, innerWidth=${o.innerWidth})`,
  );
}

// Dialog full-screen mobile di ResponsiveDialogContent: misura DOPO
// l'animazione zoom-in-95, altrimenti si legge il 95% del viewport.
async function assertFullScreenDialog(page, label) {
  const dialog = page.locator('[role="dialog"]');
  await dialog.waitFor({ state: 'visible', timeout: 10000 });
  await page.waitForFunction(() => {
    const el = document.querySelector('[role="dialog"]');
    return el && Math.abs(el.getBoundingClientRect().width - window.innerWidth) <= 2;
  }, null, { timeout: 10000 }).catch(async () => {
    const w = await page.evaluate(() => document.querySelector('[role="dialog"]')?.getBoundingClientRect().width);
    assert.fail(`${label}: dialog must be full-screen on mobile (width=${w})`);
  });
}

async function closeDialog(page) {
  await page.keyboard.press('Escape');
  await page.locator('[role="dialog"]').waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {});
}

// Tabella dentro ScrollableTable con header sticky: dato un selettore che
// individua il CONTENITORE (antenato) della tabella, verifica che
// 1) il viewport orizzontale scorra davvero (scrollWidth > clientWidth);
// 2) l'header th sia sticky e resti visibile dopo uno scroll verticale
//    reale del contenitore delimitato (overflow-y-auto).
async function assertStickyScrollableTable(page, containerSelector, label) {
  const info = await page.evaluate((sel) => {
    const root = document.querySelector(sel);
    if (!root) return { error: 'container not found' };
    const vp = root.querySelector('[data-testid="scrollable-table-viewport"]');
    const th = root.querySelector('thead th');
    const vscroll = root.querySelector('.overflow-y-auto');
    if (!vp || !th || !vscroll) return { error: `missing pieces vp=${!!vp} th=${!!th} vscroll=${!!vscroll}` };
    const before = th.getBoundingClientRect().top;
    vscroll.scrollTop = 200;
    const after = th.getBoundingClientRect().top;
    return {
      hScrollable: vp.scrollWidth > vp.clientWidth + 4,
      vScrollable: vscroll.scrollHeight > vscroll.clientHeight + 4,
      sticky: getComputedStyle(th).position === 'sticky',
      headerStays: Math.abs(after - before) <= 2,
      scrolled: vscroll.scrollTop > 0,
    };
  }, containerSelector);
  assert.ok(!info.error, `${label}: ${info.error}`);
  assert.ok(info.hScrollable, `${label}: la tabella deve scorrere orizzontalmente nel viewport ScrollableTable`);
  assert.ok(info.vScrollable && info.scrolled, `${label}: il contenitore verticale deve scorrere (righe sufficienti)`);
  assert.ok(info.sticky, `${label}: header th deve essere sticky`);
  assert.ok(info.headerStays, `${label}: header deve restare visibile durante lo scroll verticale`);
}

test('mobile: CJ, Preventivatore, Simulatore, Canvass, Incentivazione, Admin, SuperAdmin, Profilo usabili su smartphone', async () => {
  const pool = await newPool();
  const session = await signup({ prefix: 'mob_cja', fullName: 'Mobile CJA', organizationName: uniq('MobCJA') });
  const browser = await launchBrowser();
  try {
    // ── Seed: journey CJ con molti item (timeline con scroll verticale) ──
    await setCjTriggerDate(pool, session.orgId, '2020-01-01');
    const items = [{ driver: 'mobile', state: 'attivo' }];
    for (let i = 0; i < 14; i++) {
      items.push({ driver: i % 2 ? 'accessorio' : 'servizio', state: 'inserito' });
    }
    const journeyId = await seedJourney(pool, session.orgId, {
      customerKey: 'CF-MOB-373',
      nome: 'Cliente Mobile 373',
      pdv: 'PDV Test',
      items,
    });

    // ── Seed: preventivo con molti PDV (tabella Dashboard con scroll) ──
    const puntiVendita = Array.from({ length: 30 }, (_, i) => ({
      id: `pdv-${i}`,
      codicePos: `POS${String(i).padStart(3, '0')}`,
      nome: `Negozio Test ${i}`,
    }));
    const prevRes = await pool.query(
      `INSERT INTO preventivi (name, data, organization_id, created_by)
         VALUES ($1, $2::jsonb, $3, $4) RETURNING id`,
      ['Preventivo Mobile 373', JSON.stringify({ puntiVendita }), session.orgId, session.profileId],
    );
    const preventivoId = prevRes.rows[0].id;

    const context = await newAuthedContext(browser, session, { mobile: true });
    const page = await context.newPage();

    // ── Customer Journey: filtri leggibili, nessun overflow ──
    await page.goto(`${BASE}/customer-journey`, { waitUntil: 'networkidle' });
    await page.getByTestId('button-filter-tutti').waitFor({ state: 'visible', timeout: 20000 });
    await assertNoHorizontalOverflow(page, 'CustomerJourney');

    // Dettaglio journey: timeline sticky + scrollabile, dialog edit full-screen.
    await page.getByTestId(`card-journey-${journeyId}`).click();
    await page.getByTestId('card-timeline').waitFor({ state: 'visible', timeout: 20000 });
    await assertNoHorizontalOverflow(page, 'CustomerJourney/dettaglio');
    await assertStickyScrollableTable(page, '[data-testid="card-timeline"]', 'CJ timeline');
    const editBtn = page.locator('[data-testid^="button-edit-details-"]').first();
    await editBtn.scrollIntoViewIfNeeded();
    await editBtn.click();
    await assertFullScreenDialog(page, 'CustomerJourney dialog dettagli item');
    await closeDialog(page);

    // ── Preventivatore: riepilogo wizard mobile + dialog salvataggio ──
    await page.goto(`${BASE}/preventivatore`, { waitUntil: 'networkidle' });
    await page.getByTestId('wizard-summary-mobile').waitFor({ state: 'visible', timeout: 20000 });
    await assertNoHorizontalOverflow(page, 'Preventivatore');
    await page.getByTestId('button-save-config').click();
    await assertFullScreenDialog(page, 'Preventivatore dialog salva configurazione');
    await closeDialog(page);

    // ── Dashboard: tabella dettaglio PDV sticky + scrollabile ──
    await page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle' });
    // La tabella PDV vive nel tab Analytics con un preventivo selezionato.
    await page.getByRole('tab', { name: /Analytics/ }).click();
    await page.getByRole('combobox').first().click();
    await page.getByRole('option', { name: /Preventivo Mobile 373/ }).click();
    await page.waitForSelector('[data-testid="scrollable-table-viewport"] table', { timeout: 20000 });
    await assertStickyScrollableTable(page, 'body', 'PdvDataTable');

    // ── Simulatore: home senza overflow ──
    await page.goto(`${BASE}/simulatore`, { waitUntil: 'networkidle' });
    await page.waitForSelector('main, h1, h2', { timeout: 20000 });
    await assertNoHorizontalOverflow(page, 'SimulatoreHome');

    // ── Canvass: tab wrap, nessun overflow ──
    await page.goto(`${BASE}/canvass-vodafone-fastweb`, { waitUntil: 'networkidle' });
    await page.getByTestId('tabs-canvass').waitFor({ state: 'visible', timeout: 20000 });
    await assertNoHorizontalOverflow(page, 'Canvass');

    // ── Incentivazione interna: header wrap, nessun overflow ──
    await page.goto(`${BASE}/incentivazione-interna`, { waitUntil: 'networkidle' });
    await page.getByTestId('select-month').waitFor({ state: 'visible', timeout: 20000 });
    await assertNoHorizontalOverflow(page, 'IncentivazioneInterna');

    // ── Admin: pannello + dialog rinomina org full-screen ──
    await page.goto(`${BASE}/admin`, { waitUntil: 'networkidle' });
    const renameOrg = page.getByTestId('button-rename-org');
    await renameOrg.waitFor({ state: 'visible', timeout: 20000 });
    await assertNoHorizontalOverflow(page, 'AdminPanel');
    await renameOrg.click();
    await assertFullScreenDialog(page, 'AdminPanel dialog rinomina org');
    await closeDialog(page);

    // ── SuperAdmin: dialog "Crea Admin" full-screen ──
    await setRole(pool, session.profileId, 'super_admin');
    await page.goto(`${BASE}/super-admin`, { waitUntil: 'networkidle' });
    const createAdmin = page.getByRole('button', { name: /Crea Admin/ });
    await createAdmin.waitFor({ state: 'visible', timeout: 20000 });
    await assertNoHorizontalOverflow(page, 'SuperAdminPanel');
    await createAdmin.click();
    await assertFullScreenDialog(page, 'SuperAdminPanel dialog crea admin');
    await closeDialog(page);
    await setRole(pool, session.profileId, 'admin');

    // ── Profilo: nessun overflow ──
    await page.goto(`${BASE}/profile`, { waitUntil: 'networkidle' });
    await page.waitForSelector('main, h1, h2', { timeout: 20000 });
    await assertNoHorizontalOverflow(page, 'Profile');

    await page.close();
    await context.close();
  } finally {
    await browser.close().catch(() => {});
    await cleanupOrg(pool, session);
    await pool.end().catch(() => {});
  }
});
