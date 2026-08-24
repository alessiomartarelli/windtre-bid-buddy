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

// Mobile UI (375×812 + touch) per il blocco gara: Dashboard Gara Reale,
// Configurazione Gara, Tabelle Calcolo, Mappatura BiSuite, DRMS.
// Per ogni pagina verifica un flusso chiave su smartphone e che il documento
// non abbia overflow orizzontale (niente zoom/pan forzato).

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

test('mobile: blocco gara usabile su smartphone', async () => {
  const pool = await newPool();
  const session = await signup({ prefix: 'mob_gara', fullName: 'Mobile Gara', organizationName: uniq('MobGara') });
  const browser = await launchBrowser();
  try {
    const context = await newAuthedContext(browser, session, { mobile: true });
    const page = await context.newPage();

    // ── Dashboard Gara Reale: carica (empty state) senza overflow ──
    await page.goto(`${BASE}/dashboard-gara-reale`, { waitUntil: 'networkidle' });
    await page.waitForSelector('main, [data-testid="select-period-trigger"], h1', { timeout: 20000 });
    await assertNoHorizontalOverflow(page, 'DashboardGaraReale');

    // ── Configurazione Gara: tab e dialog full-screen ──
    await page.goto(`${BASE}/configurazione-gara`, { waitUntil: 'networkidle' });
    const addPdv = page.getByTestId('button-add-pdv');
    await addPdv.waitFor({ state: 'visible', timeout: 20000 });
    await assertNoHorizontalOverflow(page, 'ConfigurazioneGara');
    await addPdv.click();
    await assertFullScreenDialog(page, 'ConfigurazioneGara dialog Aggiungi PDV');
    await closeDialog(page);
    // Tab "Tabelle Calcolo": tabelle con hint di scroll (ScrollableTable).
    await page.getByTestId('tab-tabelle-calcolo').click();
    await page.getByTestId('scrollable-table-viewport').first().waitFor({ state: 'visible', timeout: 20000 });
    await page.getByTestId('tab-gara-tc-fisso').click();
    const fissoPuntiFtth = page.getByTestId('input-gara-fisso-punti-FISSO_FTTH');
    await fissoPuntiFtth.waitFor({ state: 'visible', timeout: 10000 });
    assert.equal(await fissoPuntiFtth.inputValue(), '1', 'Configurazione Gara mostra i punti/pezzo Fisso');
    await assertNoHorizontalOverflow(page, 'ConfigurazioneGara/TabelleCalcolo');

    // ── Tabelle Calcolo (pagina): sezione gara operatore, tabelle scrollabili ──
    await page.goto(`${BASE}/tabelle-calcolo`, { waitUntil: 'networkidle' });
    const cardGara = page.getByTestId('card-gara-operatore');
    await cardGara.waitFor({ state: 'visible', timeout: 20000 });
    await cardGara.click();
    await page.getByTestId('scrollable-table-viewport').first().waitFor({ state: 'visible', timeout: 20000 });
    await assertNoHorizontalOverflow(page, 'TabelleCalcolo');
    // Le tabelle larghe devono scorrere DENTRO il viewport dedicato (hint
    // frecce visibile) e la prima colonna deve restare sticky.
    const tblInfo = await page.evaluate(() => {
      const vps = Array.from(document.querySelectorAll('[data-testid="scrollable-table-viewport"]'));
      const vp = vps.find((el) => el.scrollWidth > el.clientWidth + 4);
      if (!vp) return null;
      const cell = vp.querySelector('tbody td');
      return {
        scrollable: true,
        stickyFirstCol: cell ? getComputedStyle(cell).position === 'sticky' : false,
      };
    });
    assert.ok(tblInfo?.scrollable, 'TabelleCalcolo: almeno una tabella deve scorrere nel proprio viewport');
    assert.ok(tblInfo.stickyFirstCol, 'TabelleCalcolo: prima colonna deve essere sticky');
    await page.getByTestId('button-scroll-right').first().waitFor({ state: 'visible', timeout: 10000 });

    // ── Mappatura BiSuite: tab scrollabili + dialog regola full-screen ──
    await page.goto(`${BASE}/mappatura-bisuite`, { waitUntil: 'networkidle' });
    const addRule = page.getByTestId('btn-add-rule-mobile');
    await addRule.waitFor({ state: 'visible', timeout: 20000 });
    await assertNoHorizontalOverflow(page, 'MappaturaBiSuite');
    await addRule.click();
    await assertFullScreenDialog(page, 'MappaturaBiSuite dialog regola');
    await closeDialog(page);

    // ── DRMS Commissioning: carica senza overflow ──
    await page.goto(`${BASE}/drms-commissioning`, { waitUntil: 'networkidle' });
    await page.getByTestId('input-drms-file').waitFor({ state: 'attached', timeout: 20000 });
    await assertNoHorizontalOverflow(page, 'DrmsCommissioning');

    await page.close();
    await context.close();
  } finally {
    await browser.close().catch(() => {});
    await cleanupOrg(pool, session);
    await pool.end().catch(() => {});
  }
});
