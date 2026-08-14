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

// Smoke test mobile (viewport 375×812, touch): fondamenta della versione
// mobile dell'app (Task fondamenta mobile).
//
// Verifica che su smartphone:
//   1. la Home hub sia usabile: titolo e scorciatoie visibili, NESSUNO
//      scroll orizzontale della pagina;
//   2. la navigazione desktop sia nascosta e il menu hamburger visibile,
//      con touch target ≥44px;
//   3. dal menu hamburger si navighi davvero a un modulo (Vendite BiSuite).
//
// Il context usa l'opzione `mobile: true` del helper condiviso: le suite dei
// task successivi possono riusarla per testare le singole pagine su mobile.

test('mobile smoke: Home usabile + menu hamburger naviga a un modulo', async () => {
  const pool = await newPool();
  const session = await signup({ prefix: 'mob_smoke', fullName: 'Mobile Smoke', organizationName: uniq('MobSmoke') });
  const browser = await launchBrowser();
  try {
    const context = await newAuthedContext(browser, session, { mobile: true });
    const page = await context.newPage();
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });

    // 1) Home hub visibile e senza overflow orizzontale.
    await page.getByTestId('text-home-title').waitFor({ state: 'visible', timeout: 20000 });
    await page.getByTestId('section-home-shortcuts').waitFor({ state: 'visible', timeout: 10000 });
    const overflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
    }));
    assert.ok(
      overflow.scrollWidth <= overflow.innerWidth + 1,
      `Home has horizontal overflow on mobile: scrollWidth=${overflow.scrollWidth} innerWidth=${overflow.innerWidth}`,
    );

    // 2) Nav desktop nascosta, hamburger visibile con touch target ≥44px.
    assert.equal(
      await page.getByTestId('nav-gara-menu').isVisible().catch(() => false),
      false,
      'desktop nav must be hidden on mobile viewport',
    );
    const burger = page.getByTestId('button-mobile-menu');
    await burger.waitFor({ state: 'visible', timeout: 10000 });
    const box = await burger.boundingBox();
    assert.ok(box && box.width >= 44 && box.height >= 44,
      `hamburger touch target must be >=44px, got ${box?.width}x${box?.height}`);

    // 3) Dal menu hamburger si naviga a Vendite BiSuite.
    await burger.click();
    const item = page.getByRole('menuitem', { name: 'Vendite BiSuite' });
    await item.waitFor({ state: 'visible', timeout: 10000 });
    const itemBox = await item.boundingBox();
    assert.ok(itemBox && itemBox.height >= 40,
      `menu item touch target too small: ${itemBox?.height}px`);
    await item.click();
    await page.waitForURL((url) => url.pathname === '/vendite-bisuite', { timeout: 20000 });

    await page.close();
    await context.close();
  } finally {
    await browser.close().catch(() => {});
    await cleanupOrg(pool, session);
    await pool.end().catch(() => {});
  }
});
