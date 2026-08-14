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

// Mobile UI (375×812 + touch) per il task #376: Vendite BiSuite e pagine
// restanti (Controllo di Gestione, Gestione DTS, Configurazione Gara).
// Verifica: nessun overflow orizzontale, toolbar che wrappa, tabelle in
// ScrollableTable con header sticky.

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

// Come in mobile-cj-admin-ui.test.mjs: tabella dentro ScrollableTable con
// header sticky e contenitore verticale delimitato.
async function assertStickyScrollableTable(page, containerSelector, label) {
  const info = await page.evaluate((sel) => {
    const root = document.querySelector(sel);
    if (!root) return { error: 'container not found' };
    const vp = root.querySelector('[data-testid="scrollable-table-viewport"]');
    const th = vp?.querySelector('thead th');
    const vscroll = vp?.querySelector('.overflow-y-auto');
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

async function seedBisuiteSales(pool, orgId, { count = 30, addetto = 'Mario Rossi' } = {}) {
  for (let i = 0; i < count; i++) {
    await pool.query(
      `INSERT INTO bisuite_sales
         (organization_id, bisuite_id, data_vendita, codice_pos, nome_negozio,
          nome_addetto, nome_cliente, totale, stato, raw_data)
       VALUES ($1, $2, now() - ($3 || ' hours')::interval, $4, $5, $6, $7, $8, $9, $10::jsonb)`,
      [
        orgId,
        100000 + i,
        String(i),
        'POS001',
        'Negozio Mobile 376',
        addetto,
        `Cliente ${i}`,
        '25.00',
        'FINALIZZATA',
        JSON.stringify({ articoli: [] }),
      ],
    );
  }
}

test('mobile: Vendite BiSuite e Controllo di Gestione usabili su smartphone', async () => {
  const pool = await newPool();
  const session = await signup({ prefix: 'mob_vb', fullName: 'Mobile VB', organizationName: uniq('MobVB') });
  const browser = await launchBrowser();
  try {
    await seedBisuiteSales(pool, session.orgId, { count: 30 });

    const context = await newAuthedContext(browser, session, { mobile: true });
    const page = await context.newPage();

    // ── Vendite BiSuite: lista vendite in ScrollableTable, nessun overflow ──
    await page.goto(`${BASE}/vendite-bisuite`, { waitUntil: 'networkidle' });
    await page.getByTestId('button-view-vendite').waitFor({ state: 'visible', timeout: 20000 });
    await page.waitForSelector('[data-testid="scrollable-table-viewport"] table', { timeout: 20000 });
    await assertNoHorizontalOverflow(page, 'VenditeBiSuite');
    await assertStickyScrollableTable(page, 'body', 'VenditeBiSuite lista vendite');

    // ── Vista per addetto: dettaglio vendite addetto sticky + scrollabile ──
    await page.getByTestId('button-view-addetti').click();
    // Il bottone "Vedi tutte le vendite" vive nell'AccordionContent: espandi prima.
    const trigger = page.locator('button:has-text("Mario Rossi")').first();
    await trigger.waitFor({ state: 'visible', timeout: 20000 });
    await trigger.click();
    const viewAddetto = page.locator('[data-testid^="button-view-addetto-"]').first();
    await viewAddetto.scrollIntoViewIfNeeded();
    await viewAddetto.click();
    await page.getByTestId('button-back-addetti').waitFor({ state: 'visible', timeout: 20000 });
    await assertNoHorizontalOverflow(page, 'VenditeBiSuite/addetto');
    await assertStickyScrollableTable(page, 'body', 'VenditeBiSuite dettaglio addetto');

    // ── Controllo di Gestione: nessun overflow ──
    await page.goto(`${BASE}/controllo-gestione`, { waitUntil: 'networkidle' });
    await page.waitForSelector('main, h1, h2', { timeout: 20000 });
    await assertNoHorizontalOverflow(page, 'ControlloGestione');

    // ── Gestione DTS: nessun overflow ──
    await page.goto(`${BASE}/gestione-dts`, { waitUntil: 'networkidle' });
    await page.waitForSelector('main, h1, h2', { timeout: 20000 });
    await assertNoHorizontalOverflow(page, 'GestioneDts');

    // ── Configurazione Gara: nessun overflow ──
    await page.goto(`${BASE}/configurazione-gara`, { waitUntil: 'networkidle' });
    await page.waitForSelector('main, h1, h2', { timeout: 20000 });
    await assertNoHorizontalOverflow(page, 'ConfigurazioneGara');

    await page.close();
    await context.close();
  } finally {
    await browser.close().catch(() => {});
    await cleanupOrg(pool, session);
    await pool.end().catch(() => {});
  }
});
