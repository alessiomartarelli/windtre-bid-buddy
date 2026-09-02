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
    // Brand NON WindTre associato: Simulatore/Tabelle/DRMS vengono filtrati.
    // I moduli multi-brand vanno disabilitati esplicitamente per ottenere
    // l'empty-state.
    brandId = await attachBrand(pool, session.orgId, uniq('Vodafone'));
    await pool.query(
      `UPDATE organizations SET enabled_modules = $2 WHERE id = $1`,
      [session.orgId, JSON.stringify({
        vendite_bisuite: false,
        customer_journey: false,
        incentivazione_interna: false,
        gestione_dts: false,
        gara_dashboard: false,
        gara_configurazione: false,
        amministrazione: false,
        controllo_gestione: false,
      })],
    );

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

// ---------------------------------------------------------------------------
// Helper Task #542 — semina una RS nel registro canonico + un'operazione
// plafond 'imposta' con saldo assoluto `saldo`. Il saldo viene DERIVATO in
// lettura (op 'imposta' + consumo ricariche = 0 per un'org appena creata),
// quindi basta l'op per pilotare inAllerta: saldo sotto la soglia default
// (50€) o negativo => allerta; saldo alto => nessuna allerta.
async function seedPlafond(pool, orgId, { rsNome, saldo }) {
  const rs = await pool.query(
    `INSERT INTO cdg_ragioni_sociali (organization_id, nome, origine)
       VALUES ($1, $2, 'manuale') RETURNING id`,
    [orgId, rsNome],
  );
  const rsId = rs.rows[0].id;
  // Task #548: una RS senza PDV in Struttura non compare più nei saldi —
  // il seed le associa un PDV (senza dealer) in organization_config.
  const pdv = JSON.stringify([{ codicePos: `POS ${rsNome}`.toUpperCase(), nome: `PDV ${rsNome}`, ragioneSociale: rsNome, codiceDealer: '' }]);
  await pool.query(
    `INSERT INTO organization_config (organization_id, config)
       VALUES ($1, jsonb_build_object('puntiVendita', $2::jsonb))
     ON CONFLICT (organization_id) DO UPDATE SET
       config = organization_config.config || jsonb_build_object(
         'puntiVendita', COALESCE(organization_config.config->'puntiVendita', '[]'::jsonb) || $2::jsonb),
       updated_at = now()`,
    [orgId, pdv],
  );
  await pool.query(
    `INSERT INTO plafond_ricariche_ops
       (organization_id, ragione_sociale_id, tipo, importo, saldo_prima, saldo_dopo, consumo_cutoff, created_by_name)
     VALUES ($1, $2, 'imposta', $3, 0, $3, now(), 'seed test')`,
    [orgId, rsId, saldo],
  );
  return rsId;
}

// ===========================================================================
// SCENARIO 4 (Task #542): con una RS in allerta plafond (saldo sotto la
// soglia default), la scorciatoia Vendite BiSuite mostra il badge "Plafond".
// ===========================================================================
test('scenario 4: plafond badge appears on Vendite BiSuite shortcut when an RS is in allerta', async () => {
  const pool = await newPool();
  const session = await signup({ prefix: 'home_ui', fullName: 'Home UI Test', organizationName: uniq('HomeUI') });
  const browser = await launchBrowser();
  try {
    // Saldo 10€ < soglia default 50€ => inAllerta true.
    await seedPlafond(pool, session.orgId, { rsNome: uniq('RS Allerta'), saldo: 10 });

    const context = await newAuthedContext(browser, session);
    const page = await context.newPage();
    // Aspetta la risposta del plafond (parte solo se il modulo è visibile).
    const plafondResp = page.waitForResponse(
      (r) => r.url().includes('/api/ricariche-plafond') && r.request().method() === 'GET',
      { timeout: 20000 },
    );
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });

    await page.getByTestId('text-home-title').waitFor({ state: 'visible', timeout: 20000 });
    const keys = await shortcutKeys(page);
    assert.ok(keys.includes('vendite_bisuite'), `expected vendite_bisuite shortcut, got: ${keys.join(', ')}`);

    const resp = await plafondResp;
    assert.equal(resp.status(), 200, 'plafond endpoint must respond 200 for an admin with the module');

    await page.getByTestId('badge-home-plafond-allerta').waitFor({ state: 'visible', timeout: 10000 });
    const badge = await page.getByTestId('badge-home-plafond-allerta').innerText();
    assert.match(badge, /Plafond/i, 'badge must mention "Plafond"');

    await page.close();
    await context.close();
  } finally {
    await browser.close().catch(() => {});
    await cleanupOrg(pool, session);
    await pool.end().catch(() => {});
  }
});

// ===========================================================================
// SCENARIO 5 (Task #542): saldo sopra soglia => NESSUN badge plafond.
// ===========================================================================
test('scenario 5: no plafond badge when the saldo is above the alert threshold', async () => {
  const pool = await newPool();
  const session = await signup({ prefix: 'home_ui', fullName: 'Home UI Test', organizationName: uniq('HomeUI') });
  const browser = await launchBrowser();
  try {
    // Saldo 500€ >> soglia default 50€ => inAllerta false.
    await seedPlafond(pool, session.orgId, { rsNome: uniq('RS Serena'), saldo: 500 });

    const context = await newAuthedContext(browser, session);
    const page = await context.newPage();
    const plafondResp = page.waitForResponse(
      (r) => r.url().includes('/api/ricariche-plafond') && r.request().method() === 'GET',
      { timeout: 20000 },
    );
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });

    await page.getByTestId('text-home-title').waitFor({ state: 'visible', timeout: 20000 });
    const keys = await shortcutKeys(page);
    assert.ok(keys.includes('vendite_bisuite'), `expected vendite_bisuite shortcut, got: ${keys.join(', ')}`);

    // Asserzione di assenza SOLO dopo che i dati plafond sono arrivati:
    // altrimenti un badge in ritardo passerebbe inosservato.
    const resp = await plafondResp;
    assert.equal(resp.status(), 200, 'plafond endpoint must respond 200');
    const body = await resp.json();
    assert.ok(Array.isArray(body?.saldi) && body.saldi.length > 0, 'seeded RS must be in the saldi response');
    assert.ok(body.saldi.every((s) => !s.inAllerta), 'no RS must be in allerta with saldo above threshold');

    assert.equal(
      await page.getByTestId('badge-home-plafond-allerta').count(),
      0, 'plafond badge must NOT appear when no RS is in allerta',
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
// SCENARIO 6 (Task #542): utente senza modulo vendite_bisuite => la Home non
// chiama MAI /api/ricariche-plafond (hook disabilitato) e niente badge.
// ===========================================================================
test('scenario 6: no /api/ricariche-plafond request without the vendite_bisuite module', async () => {
  const pool = await newPool();
  const session = await signup({ prefix: 'home_ui', fullName: 'Home UI Test', organizationName: uniq('HomeUI') });
  const browser = await launchBrowser();
  try {
    // Semina comunque una RS in allerta: se il gating regredisse, il badge
    // comparirebbe e la richiesta partirebbe.
    await seedPlafond(pool, session.orgId, { rsNome: uniq('RS Gated'), saldo: -20 });
    // Disabilita SOLO il modulo Vendite BiSuite per l'org.
    await pool.query(
      `UPDATE organizations SET enabled_modules = $2 WHERE id = $1`,
      [session.orgId, JSON.stringify({ vendite_bisuite: false })],
    );

    const context = await newAuthedContext(browser, session);
    const page = await context.newPage();
    // Intercetta TUTTE le richieste verso il plafond fatte dalla pagina.
    const plafondRequests = [];
    page.on('request', (req) => {
      if (req.url().includes('/api/ricariche-plafond')) plafondRequests.push(req.url());
    });
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });

    await page.getByTestId('text-home-title').waitFor({ state: 'visible', timeout: 20000 });
    const keys = await shortcutKeys(page);
    assert.ok(!keys.includes('vendite_bisuite'), 'vendite_bisuite shortcut must be hidden when the module is disabled');
    assert.ok(keys.length > 0, 'other module shortcuts must still be visible');

    // Margine extra: eventuali query in ritardo dopo il networkidle.
    await page.waitForTimeout(1500);

    assert.equal(
      plafondRequests.length,
      0, `no request to /api/ricariche-plafond must be made, got: ${plafondRequests.join(', ')}`,
    );
    assert.equal(
      await page.getByTestId('badge-home-plafond-allerta').count(),
      0, 'plafond badge must NOT appear without the vendite_bisuite module',
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
