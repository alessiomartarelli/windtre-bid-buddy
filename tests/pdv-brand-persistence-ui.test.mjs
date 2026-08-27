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

// Test suite UI Playwright per i brand per PDV (Task #519 / #521).
//
// Il dialog PDV di Amministrazione → Struttura permette di assegnare uno o
// più brand al PDV (checkbox `checkbox-pdv-brand-<id>`). Il bug corretto nel
// Task #519: `fetchOrgConfig` in AdminPanel.tsx perdeva `brandIds` durante
// l'hydrate, così un NORMALE edit del PDV (cambiare solo il nome) li avrebbe
// azzerati silenziosamente — il PDV sarebbe sparito dai report Telegram del
// suo brand senza alcun segnale. Questa suite copre il ciclo completo in UI:
//   1. crea PDV con più brand → persistiti in organization_config;
//   2. reload pagina → i checkbox si ripopolano dal server;
//   3. edit di un ALTRO campo (nome) → save → i brandIds restano intatti;
//   4. il PUT generico /api/organization-config normalizza i brandIds
//      (dedup + scarto di brand non associati all'org).
//
// I brand vengono seminati direttamente nel dev DB (brands +
// organization_brands) PRIMA di aprire la pagina, perché la sezione brand del
// dialog è renderizzata solo se l'org ha brand associati (arrivano da
// /api/auth/me). Nomi brand casuali NON WindTre per non attivare il gating
// moduli per brand. Cleanup completo (brand inclusi) alla fine.

// --- Seed: crea `count` brand e li associa all'org. Ritorna [{id, name}].
async function seedOrgBrands(pool, orgId, count = 2) {
  const out = [];
  for (let i = 0; i < count; i++) {
    const name = uniq(`BrandUI${i}`);
    const r = await pool.query(`INSERT INTO brands (name) VALUES ($1) RETURNING id, name`, [name]);
    await pool.query(
      `INSERT INTO organization_brands (organization_id, brand_id) VALUES ($1, $2)`,
      [orgId, r.rows[0].id],
    );
    out.push(r.rows[0]);
  }
  return out;
}

// Brand esistente ma NON associato all'org (per il test di normalizzazione).
async function seedForeignBrand(pool) {
  const r = await pool.query(
    `INSERT INTO brands (name) VALUES ($1) RETURNING id, name`,
    [uniq('BrandForeign')],
  );
  return r.rows[0];
}

async function cleanupBrands(pool, brands) {
  for (const b of brands) {
    // organization_brands cade in cascade (FK ON DELETE CASCADE).
    await pool.query(`DELETE FROM brands WHERE id = $1`, [b.id]).catch(() => {});
  }
}

// Legge i puntiVendita persistiti in organization_config per l'org.
async function readPersistedPdvs(pool, orgId) {
  const r = await pool.query(
    `SELECT config -> 'puntiVendita' AS pv
       FROM organization_config
      WHERE organization_id = $1
      ORDER BY updated_at DESC NULLS LAST
      LIMIT 1`,
    [orgId],
  );
  const pv = r.rows[0]?.pv;
  return Array.isArray(pv) ? pv : [];
}

// Apre /admin (tab Struttura, default) e attende che la config sia caricata
// (bottone "Aggiungi PDV" o empty-state visibile).
async function openStruttura(context) {
  const page = await context.newPage();
  await page.goto(`${BASE}/admin`, { waitUntil: 'networkidle' });
  await page.getByTestId('tab-struttura').waitFor({ state: 'visible', timeout: 20000 });
  await page
    .locator('[data-testid="button-add-pdv"], [data-testid="button-add-first-pdv"]')
    .first()
    .waitFor({ state: 'visible', timeout: 20000 });
  return page;
}

function brandCb(page, brandId) {
  return page.getByTestId(`checkbox-pdv-brand-${brandId}`);
}

async function isBrandChecked(page, brandId) {
  return (await brandCb(page, brandId).getAttribute('data-state')) === 'checked';
}

// Salva il dialog PDV e attende che si chiuda.
async function savePdvDialog(page) {
  await page.getByTestId('button-save-pdv').click();
  await page.getByTestId('button-save-pdv').waitFor({ state: 'hidden', timeout: 15000 });
}

// Apre il dialog di edit del PDV (espandendo prima l'accordion della RS).
async function openEditDialog(page, rsName, codicePos) {
  const editBtn = page.getByTestId(`button-edit-pdv-${codicePos}`);
  if (!(await editBtn.isVisible().catch(() => false))) {
    await page.getByTestId(`trigger-rs-${rsName}`).click();
  }
  await editBtn.waitFor({ state: 'visible', timeout: 15000 });
  await editBtn.click();
  await page.getByTestId('button-save-pdv').waitFor({ state: 'visible', timeout: 15000 });
}

// ===========================================================================
// SCENARIO 1: crea PDV con 2 brand → reload → edit del solo nome → i brand
// restano (in DB e nei checkbox del dialog).
// ===========================================================================
test('scenario 1: PDV multi-brand survives reload and unrelated-field edit', async () => {
  const pool = await newPool();
  const session = await signup({ prefix: 'pdv_brand_ui', fullName: 'Pdv Brand UI', organizationName: uniq('PdvBrandUI') });
  const brands = await seedOrgBrands(pool, session.orgId, 2);
  const RS = 'RS Brand Test';
  const POS = `90${Math.floor(100000 + Math.random() * 899999)}`;
  const browser = await launchBrowser();
  try {
    const context = await newAuthedContext(browser, session);
    const page = await openStruttura(context);

    // --- Crea il PDV con entrambi i brand spuntati.
    await page
      .locator('[data-testid="button-add-pdv"], [data-testid="button-add-first-pdv"]')
      .first()
      .click();
    await page.getByTestId('input-pdv-codicePos').fill(POS);
    await page.getByTestId('input-pdv-nome').fill('Negozio Brand Test');
    await page.getByTestId('input-pdv-rs').fill(RS);
    for (const b of brands) {
      await brandCb(page, b.id).click();
      assert.equal(await isBrandChecked(page, b.id), true, `brand ${b.name} checked in create dialog`);
    }
    await savePdvDialog(page);

    // --- DB: il PDV creato ha entrambi i brandIds.
    let pdvs = await readPersistedPdvs(pool, session.orgId);
    let mine = pdvs.find((p) => p.codicePos === POS);
    assert.ok(mine, 'created PDV persisted in organization_config');
    assert.deepEqual(
      [...(mine.brandIds ?? [])].sort(),
      brands.map((b) => b.id).sort(),
      'both brandIds persisted on create',
    );

    // --- Reload: l'hydrate del form NON deve perdere i brandIds.
    await page.reload({ waitUntil: 'networkidle' });
    await page
      .locator('[data-testid="button-add-pdv"], [data-testid="button-add-first-pdv"]')
      .first()
      .waitFor({ state: 'visible', timeout: 20000 });
    await openEditDialog(page, RS, POS);
    for (const b of brands) {
      assert.equal(await isBrandChecked(page, b.id), true, `brand ${b.name} still checked after reload`);
    }

    // --- Edit di un ALTRO campo (nome): i brand non vanno toccati.
    await page.getByTestId('input-pdv-nome').fill('Negozio Brand Test RINOMINATO');
    await savePdvDialog(page);

    pdvs = await readPersistedPdvs(pool, session.orgId);
    mine = pdvs.find((p) => p.codicePos === POS);
    assert.ok(mine, 'PDV still present after edit');
    assert.equal(mine.nome, 'Negozio Brand Test RINOMINATO', 'nome updated by the edit');
    assert.deepEqual(
      [...(mine.brandIds ?? [])].sort(),
      brands.map((b) => b.id).sort(),
      'brandIds NOT wiped by editing an unrelated field (regression Task #519)',
    );

    // --- Riapertura del dialog: i checkbox riflettono ancora i brand salvati.
    await openEditDialog(page, RS, POS);
    for (const b of brands) {
      assert.equal(await isBrandChecked(page, b.id), true, `brand ${b.name} still checked after edit+reopen`);
    }

    // --- Togliere un brand dal dialog deve invece persistere la rimozione
    // (i checkbox sono davvero collegati, non read-only).
    await brandCb(page, brands[0].id).click();
    await savePdvDialog(page);
    pdvs = await readPersistedPdvs(pool, session.orgId);
    mine = pdvs.find((p) => p.codicePos === POS);
    assert.deepEqual(mine.brandIds ?? [], [brands[1].id], 'explicit uncheck removes only that brand');

    await page.close();
    await context.close();
  } finally {
    await browser.close().catch(() => {});
    await cleanupBrands(pool, brands);
    await cleanupOrg(pool, session);
    await pool.end().catch(() => {});
  }
});

// ===========================================================================
// SCENARIO 2: il PUT generico /api/organization-config normalizza i brandIds
// dei puntiVendita: dedup + scarto di brand NON associati all'org.
// ===========================================================================
test('scenario 2: generic PUT /api/organization-config drops foreign brands and dedups', async () => {
  const pool = await newPool();
  const session = await signup({ prefix: 'pdv_brand_put', fullName: 'Pdv Brand PUT', organizationName: uniq('PdvBrandPUT') });
  const brands = await seedOrgBrands(pool, session.orgId, 1);
  const foreign = await seedForeignBrand(pool);
  const headers = { 'Content-Type': 'application/json', Cookie: session.cookieHeader };
  try {
    // Config con un PDV che dichiara: brand valido (duplicato), brand
    // estraneo all'org e un id inesistente.
    const dirtyPdv = {
      id: 'pdv-put-test-1',
      codicePos: '90999001',
      nome: 'PDV PUT Test',
      ragioneSociale: 'RS PUT Test',
      canale: '',
      clusterMobile: '',
      clusterFisso: '',
      clusterCB: '',
      tipoPosizione: '',
      brandIds: [brands[0].id, brands[0].id, foreign.id, 'brand-inesistente'],
    };
    const put = await fetch(`${BASE}/api/organization-config`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ config: { puntiVendita: [dirtyPdv], ragioniSociali: ['RS PUT Test'] } }),
    });
    assert.equal(put.status, 200, `PUT organization-config failed: ${await put.text()}`);

    // GET: i brandIds devono essere normalizzati al solo brand dell'org.
    const get = await fetch(`${BASE}/api/organization-config`, { headers: { Cookie: session.cookieHeader } });
    assert.equal(get.status, 200);
    const cfg = await get.json();
    const saved = (cfg?.config?.puntiVendita ?? []).find((p) => p.codicePos === '90999001');
    assert.ok(saved, 'PDV saved via generic PUT');
    assert.deepEqual(saved.brandIds, [brands[0].id], 'foreign/unknown brands dropped, duplicates deduped');

    // Anche nel DB (non solo nella risposta).
    const pdvs = await readPersistedPdvs(pool, session.orgId);
    const inDb = pdvs.find((p) => p.codicePos === '90999001');
    assert.deepEqual(inDb?.brandIds, [brands[0].id], 'normalized brandIds persisted in DB');
  } finally {
    await cleanupBrands(pool, [...brands, foreign]);
    await cleanupOrg(pool, session);
    await pool.end().catch(() => {});
  }
});
