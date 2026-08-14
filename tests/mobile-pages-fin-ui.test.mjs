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

// Mobile UI (375×812 + touch) per le pagine finanziarie/vendita:
// Vendite BiSuite, Amministrazione, Controllo di Gestione, Gestione DTS.
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

// Verifica che il dialog aperto occupi tutta la larghezza del viewport
// (comportamento full-screen mobile di ResponsiveDialogContent). Attende la
// fine dell'animazione di apertura (zoom-in 95%) prima di misurare.
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

test('mobile: pagine finanziarie usabili su smartphone', async () => {
  const pool = await newPool();
  const session = await signup({ prefix: 'mob_fin', fullName: 'Mobile Fin', organizationName: uniq('MobFin') });
  const browser = await launchBrowser();
  try {
    const context = await newAuthedContext(browser, session, { mobile: true });
    const page = await context.newPage();

    // ── Vendite BiSuite: filtri collassati di default su mobile, toggle apre ──
    await page.goto(`${BASE}/vendite-bisuite`, { waitUntil: 'networkidle' });
    await page.getByTestId('filter-bar').waitFor({ state: 'visible', timeout: 20000 });
    const toggle = page.getByTestId('button-toggle-filters');
    await toggle.waitFor({ state: 'visible', timeout: 10000 });
    assert.equal(await toggle.getAttribute('aria-expanded'), 'false',
      'VenditeBiSuite: filters must start collapsed on mobile');
    await toggle.click();
    assert.equal(await toggle.getAttribute('aria-expanded'), 'true',
      'VenditeBiSuite: toggle must expand filters');
    await assertNoHorizontalOverflow(page, 'VenditeBiSuite');

    // Dialog "Allinea con BiSuite" full-screen su mobile.
    const openReconcile = page.getByTestId('button-open-reconcile');
    if (await openReconcile.isVisible().catch(() => false)) {
      await openReconcile.click();
      await assertFullScreenDialog(page, 'VenditeBiSuite reconcile dialog');
      await page.keyboard.press('Escape');
      await page.locator('[role="dialog"]').waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {});
    }

    // ── Amministrazione: tab visibili e cambio tab funzionante ──
    await page.goto(`${BASE}/amministrazione`, { waitUntil: 'networkidle' });
    const tabIva = page.getByTestId('tab-iva');
    await tabIva.waitFor({ state: 'visible', timeout: 20000 });
    await tabIva.click();
    await page.waitForFunction(() => window.location.hash === '#iva', null, { timeout: 10000 });
    await assertNoHorizontalOverflow(page, 'Amministrazione');

    // ── Controllo di Gestione: tab Spese + dialog nuova spesa full-screen ──
    await page.goto(`${BASE}/controllo-gestione`, { waitUntil: 'networkidle' });
    const tabSpese = page.getByTestId('tab-spese');
    await tabSpese.waitFor({ state: 'visible', timeout: 20000 });
    await tabSpese.click();
    const nuovaSpesa = page.getByTestId('button-new-spesa');
    await nuovaSpesa.waitFor({ state: 'visible', timeout: 10000 });
    await nuovaSpesa.click();
    await assertFullScreenDialog(page, 'CdG spesa dialog');
    await page.keyboard.press('Escape');
    await page.locator('[role="dialog"]').waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {});
    await assertNoHorizontalOverflow(page, 'ControlloGestione');

    // Anagrafiche: dialog "Nuova RS" full-screen su mobile.
    const tabAnag = page.getByTestId('tab-anagrafiche');
    await tabAnag.click();
    const newRs = page.getByTestId('button-new-rs');
    await newRs.waitFor({ state: 'visible', timeout: 10000 });
    await newRs.click();
    await assertFullScreenDialog(page, 'CdG dialog Nuova RS');
    await page.keyboard.press('Escape');
    await page.locator('[role="dialog"]').waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {});

    // ── Gestione DTS: pagina carica senza overflow (empty state) ──
    await page.goto(`${BASE}/gestione-dts`, { waitUntil: 'networkidle' });
    await page.getByTestId('text-dts-title').waitFor({ state: 'visible', timeout: 20000 });
    await assertNoHorizontalOverflow(page, 'GestioneDts');

    await page.close();
    await context.close();
  } finally {
    await browser.close().catch(() => {});
    await cleanupOrg(pool, session);
    await pool.end().catch(() => {});
  }
});
