import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BASE,
  uniq,
  signup,
  newPool,
  launchBrowser,
  newAuthedContext,
  setRole,
  cleanupOrg,
} from './helpers/uiTest.mjs';

// Test suite UI Playwright per l'atterraggio post-login sulla Home hub.
//
// Perché serve: il bug originale era il rimbalzo continuo su `/` per le org
// senza moduli WindTre (redirect verso un modulo disabilitato). Ora `/`
// (client/src/pages/Index.tsx) rende la Home hub per admin/operatore e
// reindirizza SOLO super_admin a `/super-admin`. La Home
// (client/src/pages/Home.tsx) non è mai un modulo gated: mostra solo le
// scorciatoie ai moduli attivi e, quando non ce ne sono, il messaggio
// "Nessun modulo attivo". Senza questo test una regressione (redirect verso
// un modulo, Home vuota che sembra bloccata, super_admin non più su
// /super-admin) passerebbe inosservata.
//
// Strategia: signup crea un profilo admin + org con tutti i moduli abilitati
// di default e nessun brand associato (=> nessun filtro brand gating).
//   - Scenario 1: l'admin atterra sulla Home (non su un modulo) e vede le
//     scorciatoie dei moduli attivi.
//   - Scenario 2: si porta il profilo a "operatore" e si associa un brand NON
//     WindTre (Vodafone) all'org. Così tutti i moduli WindTre-gated sono
//     nascosti e le scorciatoie admin non spettano all'operatore: la Home
//     mostra "Nessun modulo attivo" SENZA restare bloccata su un redirect.
//   - Scenario 3: si porta il profilo a "super_admin": `/` reindirizza a
//     `/super-admin`.
// Cookie di sessione iniettato nel browser Playwright; cleanup completo del
// dev DB (org + eventuale brand di test) alla fine.

// Helper: associa un brand (per nome) all'org di test. Ritorna il brandId per
// il cleanup. Il nome è reso univoco per evitare collisioni con l'indice unico
// case-insensitive su brands.name.
async function attachBrand(pool, orgId, brandName) {
  const b = await pool.query(
    `INSERT INTO brands (name) VALUES ($1) RETURNING id`,
    [brandName],
  );
  const brandId = b.rows[0].id;
  await pool.query(
    `INSERT INTO organization_brands (organization_id, brand_id) VALUES ($1, $2)
       ON CONFLICT (organization_id, brand_id) DO NOTHING`,
    [orgId, brandId],
  );
  return brandId;
}

// Legge le chiavi delle scorciatoie renderizzate NELL'ORDINE del DOM
// (suffisso dopo "link-home-shortcut-").
async function shortcutKeys(page) {
  const els = await page.locator('[data-testid^="link-home-shortcut-"]').all();
  const ids = await Promise.all(els.map((e) => e.getAttribute('data-testid')));
  return ids.map((id) => (id || '').replace(/^link-home-shortcut-/, ''));
}

// ===========================================================================
// SCENARIO 1: admin atterra sulla Home (non su un modulo) e vede le
// scorciatoie ai moduli attivi.
// ===========================================================================
test('scenario 1: admin lands on Home (not a module) and sees active-module shortcuts', async () => {
  const pool = await newPool();
  const session = await signup({ prefix: 'home_ui', fullName: 'Home UI Test', organizationName: uniq('HomeUI') });
  const browser = await launchBrowser();
  try {
    const context = await newAuthedContext(browser, session);
    const page = await context.newPage();
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });

    // Atterra sulla Home: titolo hub visibile e URL ancora su "/"
    // (nessun redirect verso un modulo).
    await page.getByTestId('text-home-title').waitFor({ state: 'visible', timeout: 20000 });
    assert.equal(new URL(page.url()).pathname, '/', 'admin must stay on "/" (Home), not be redirected to a module');

    // La sezione scorciatoie c'è e mostra i moduli attivi.
    await page.getByTestId('section-home-shortcuts').waitFor({ state: 'visible', timeout: 10000 });
    const keys = await shortcutKeys(page);
    assert.ok(keys.length > 0, 'admin with all modules enabled must see at least one shortcut');
    // Moduli chiave attesi per un admin con org di default (nessun brand => nessun filtro).
    for (const expected of ['amministrazione', 'simulatore', 'customer_journey']) {
      assert.ok(keys.includes(expected), `expected shortcut "${expected}" to be present, got: ${keys.join(', ')}`);
    }
    // L'empty-state NON deve comparire quando ci sono scorciatoie.
    assert.equal(
      await page.getByTestId('text-home-no-modules').count(),
      0, '"Nessun modulo attivo" must not appear when there are shortcuts',
    );

    await page.close();
    await context.close();
  } finally {
    await browser.close().catch(() => {});
    await cleanupOrg(pool, session);
    await pool.end().catch(() => {});
  }
});

// ===========================================================================
// SCENARIO 2: org senza moduli WindTre (operatore + brand non-WindTre) vede la
// Home e il messaggio "Nessun modulo attivo", senza restare bloccata.
// ===========================================================================
test('scenario 2: org without WindTre modules sees Home with "Nessun modulo attivo"', async () => {
  const pool = await newPool();
  const session = await signup({ prefix: 'home_ui', fullName: 'Home UI Test', organizationName: uniq('HomeUI') });
  const browser = await launchBrowser();
  let brandId = null;
  try {
    // Operatore: le scorciatoie admin (Amministrazione, DRMS, Config Gara,
    // Tabelle Calcolo) non gli spettano.
    await setRole(pool, session.profileId, 'operatore');
    // Brand NON WindTre associato: tutti i moduli WindTre-gated
    // (simulatore, gara_dashboard, vendite_bisuite, customer_journey,
    // incentivazione_interna, ...) vengono filtrati via => nessuna scorciatoia.
    brandId = await attachBrand(pool, session.orgId, uniq('Vodafone'));

    const context = await newAuthedContext(browser, session);
    const page = await context.newPage();
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });

    // Atterra sulla Home (non su un modulo, non bloccato in redirect).
    await page.getByTestId('text-home-title').waitFor({ state: 'visible', timeout: 20000 });
    assert.equal(new URL(page.url()).pathname, '/', 'operator must stay on "/" (Home), not be bounced');

    // Nessuna scorciatoia => empty-state "Nessun modulo attivo".
    await page.getByTestId('text-home-no-modules').waitFor({ state: 'visible', timeout: 10000 });
    const empty = await page.getByTestId('text-home-no-modules').innerText();
    assert.match(empty, /Nessun modulo attivo/i, 'empty state must show "Nessun modulo attivo"');

    const keys = await shortcutKeys(page);
    assert.equal(keys.length, 0, `no shortcut must be shown for an operator without WindTre brand, got: ${keys.join(', ')}`);

    await page.close();
    await context.close();
  } finally {
    await browser.close().catch(() => {});
    await cleanupOrg(pool, session);
    if (brandId) await pool.query(`DELETE FROM brands WHERE id = $1`, [brandId]).catch(() => {});
    await pool.end().catch(() => {});
  }
});

// ===========================================================================
// SCENARIO 3: super_admin continua a essere reindirizzato a /super-admin.
// ===========================================================================
test('scenario 3: super_admin is redirected from "/" to /super-admin', async () => {
  const pool = await newPool();
  const session = await signup({ prefix: 'home_ui', fullName: 'Home UI Test', organizationName: uniq('HomeUI') });
  const browser = await launchBrowser();
  try {
    await setRole(pool, session.profileId, 'super_admin');

    const context = await newAuthedContext(browser, session);
    const page = await context.newPage();
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });

    // Il redirect di Index deve portare su /super-admin.
    await page.waitForURL((url) => url.pathname === '/super-admin', { timeout: 20000 });
    assert.equal(new URL(page.url()).pathname, '/super-admin', 'super_admin must be redirected to /super-admin');

    await page.close();
    await context.close();
  } finally {
    await browser.close().catch(() => {});
    await cleanupOrg(pool, session);
    await pool.end().catch(() => {});
  }
});
