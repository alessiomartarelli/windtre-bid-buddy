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
} from './helpers/uiTest.mjs';

// Task #375 — Mobile (375×812 + touch): la "Tabella Dettaglio PDV"
// (client/src/components/PdvDataTable.tsx, Dashboard tab Analytics) e la
// timeline Customer Journey (card-timeline) usano ScrollableTable con scroll
// verticale delimitato e header sticky. Questa suite semina abbastanza dati
// da attivare lo scroll verticale e verifica che:
//   1) il contenitore verticale scorra davvero (righe sufficienti);
//   2) l'header resti FERMO e visibile durante lo scroll verticale;
//   3) le frecce di ScrollableTable (button-scroll-right / button-scroll-left)
//      siano visibili e FUNZIONANTI (il click sposta scrollLeft del viewport).

// Verifica sticky header dentro un contenitore: scrolla il div overflow-y-auto
// e misura la posizione del primo th prima/dopo.
async function assertStickyHeaderOnVerticalScroll(page, containerSelector, label) {
  const info = await page.evaluate((sel) => {
    const root = document.querySelector(sel);
    if (!root) return { error: 'container not found' };
    const vscroll = root.querySelector('.overflow-y-auto');
    const th = root.querySelector('thead th');
    if (!vscroll || !th) return { error: `missing pieces vscroll=${!!vscroll} th=${!!th}` };
    const containerTop = vscroll.getBoundingClientRect().top;
    const before = th.getBoundingClientRect().top;
    vscroll.scrollTop = vscroll.scrollHeight; // fino in fondo
    const after = th.getBoundingClientRect().top;
    return {
      vScrollable: vscroll.scrollHeight > vscroll.clientHeight + 4,
      scrolled: vscroll.scrollTop > 100,
      sticky: getComputedStyle(th).position === 'sticky',
      headerStays: Math.abs(after - before) <= 2,
      // header ancorato al bordo superiore del contenitore di scroll
      headerAtTop: Math.abs(after - containerTop) <= 4,
    };
  }, containerSelector);
  assert.ok(!info.error, `${label}: ${info.error}`);
  assert.ok(info.vScrollable, `${label}: il contenitore deve avere scroll verticale (dati insufficienti?)`);
  assert.ok(info.scrolled, `${label}: lo scroll verticale deve avvenire davvero`);
  assert.ok(info.sticky, `${label}: header th deve essere position:sticky`);
  assert.ok(info.headerStays, `${label}: header deve restare fermo durante lo scroll verticale`);
  assert.ok(info.headerAtTop, `${label}: header deve restare agganciato al bordo superiore del viewport`);
}

// Verifica che le frecce di ScrollableTable funzionino: il viewport parte da
// scrollLeft=0, il click su button-scroll-right lo sposta a destra, poi
// button-scroll-left riporta indietro.
async function assertScrollArrowsWork(page, containerSelector, label) {
  const container = page.locator(containerSelector);
  const viewport = container.locator('[data-testid="scrollable-table-viewport"]');
  const right = container.locator('[data-testid="button-scroll-right"]');

  // La tabella deve essere più larga del viewport (altrimenti niente frecce).
  const hScrollable = await viewport.evaluate((el) => el.scrollWidth > el.clientWidth + 4);
  assert.ok(hScrollable, `${label}: la tabella deve scorrere orizzontalmente su mobile`);

  await right.waitFor({ state: 'visible', timeout: 10000 });
  const before = await viewport.evaluate((el) => el.scrollLeft);
  await right.click();
  // scrollBy è smooth: attendi che lo scroll avanzi davvero.
  await page.waitForFunction(
    ({ sel, start }) => {
      const vp = document.querySelector(sel)?.querySelector('[data-testid="scrollable-table-viewport"]');
      return vp && vp.scrollLeft > start + 50;
    },
    { sel: containerSelector, start: before },
    { timeout: 10000 },
  );

  // Ora deve comparire la freccia sinistra e il click deve tornare indietro.
  const left = container.locator('[data-testid="button-scroll-left"]');
  await left.waitFor({ state: 'visible', timeout: 10000 });
  const mid = await viewport.evaluate((el) => el.scrollLeft);
  await left.click();
  await page.waitForFunction(
    ({ sel, start }) => {
      const vp = document.querySelector(sel)?.querySelector('[data-testid="scrollable-table-viewport"]');
      return vp && vp.scrollLeft < start - 50;
    },
    { sel: containerSelector, start: mid },
    { timeout: 10000 },
  );
}

test('mobile: header sticky e frecce scroll su Tabella PDV e timeline CJ', async () => {
  const pool = await newPool();
  const session = await signup({ prefix: 'mob_sticky', fullName: 'Mobile Sticky', organizationName: uniq('MobSticky') });
  const browser = await launchBrowser();
  try {
    // ── Seed CJ: journey con molti item → timeline con scroll verticale ──
    await setCjTriggerDate(pool, session.orgId, '2020-01-01');
    const items = [{ driver: 'mobile', state: 'attivo' }];
    for (let i = 0; i < 18; i++) {
      items.push({ driver: i % 2 ? 'accessorio' : 'servizio', state: 'inserito' });
    }
    const journeyId = await seedJourney(pool, session.orgId, {
      customerKey: 'CF-MOB-375',
      nome: 'Cliente Sticky 375',
      pdv: 'PDV Test',
      items,
    });

    // ── Seed preventivo: 40 PDV → tabella Dettaglio PDV con scroll verticale ──
    const puntiVendita = Array.from({ length: 40 }, (_, i) => ({
      id: `pdv-${i}`,
      codicePos: `POS${String(i).padStart(3, '0')}`,
      nome: `Negozio Sticky ${i}`,
    }));
    await pool.query(
      `INSERT INTO preventivi (name, data, organization_id, created_by)
         VALUES ($1, $2::jsonb, $3, $4)`,
      ['Preventivo Sticky 375', JSON.stringify({ puntiVendita }), session.orgId, session.profileId],
    );

    const context = await newAuthedContext(browser, session, { mobile: true });
    const page = await context.newPage();

    // ── Dashboard → tab Analytics → seleziona il preventivo ──
    await page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle' });
    await page.getByRole('tab', { name: /Analytics/ }).click();
    await page.getByRole('combobox').first().click();
    await page.getByRole('option', { name: /Preventivo Sticky 375/ }).click();
    await page.waitForSelector('[data-testid="scrollable-table-viewport"] table', { timeout: 20000 });

    // La card "Tabella Dettaglio PDV" (data-testid="card-pdv-table") contiene
    // il viewport ScrollableTable e il contenitore di scroll verticale.
    const pdvContainer = '[data-testid="card-pdv-table"]';
    await page.waitForSelector(`${pdvContainer} tbody tr`, { timeout: 20000 });
    // 40 PDV seminati: tutte le righe devono essere renderizzate.
    const rowCount = await page.locator(`${pdvContainer} tbody tr`).count();
    assert.ok(rowCount >= 40, `PdvDataTable: attese >=40 righe PDV, trovate ${rowCount}`);

    await assertStickyHeaderOnVerticalScroll(page, pdvContainer, 'PdvDataTable');
    await assertScrollArrowsWork(page, pdvContainer, 'PdvDataTable');

    // ── Customer Journey → dettaglio journey → card-timeline ──
    await page.goto(`${BASE}/customer-journey`, { waitUntil: 'networkidle' });
    await page.getByTestId(`card-journey-${journeyId}`).click();
    await page.getByTestId('card-timeline').waitFor({ state: 'visible', timeout: 20000 });
    await page.waitForSelector('[data-testid="card-timeline"] tbody tr', { timeout: 20000 });
    const tlRows = await page.locator('[data-testid="card-timeline"] tbody tr').count();
    assert.ok(tlRows >= 19, `CJ timeline: attese >=19 righe, trovate ${tlRows}`);

    await assertStickyHeaderOnVerticalScroll(page, '[data-testid="card-timeline"]', 'CJ timeline');
    await assertScrollArrowsWork(page, '[data-testid="card-timeline"]', 'CJ timeline');

    await page.close();
    await context.close();
  } finally {
    await browser.close().catch(() => {});
    await cleanupOrg(pool, session);
    await pool.end().catch(() => {});
  }
});
