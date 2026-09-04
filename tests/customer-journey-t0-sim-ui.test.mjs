// UI test (Playwright, DB-backed): il marker T0 della scheda cliente deve
// stare sulla riga della SIM mobile anche quando la vendita trigger BiSuite è
// multi-articolo (SIM + fisso + smartphone nello stesso scontrino).
//
// La scelta della riga T0 è già coperta a livello di logica pura
// (tests/customer-journey-timeline.test.mjs); qui verifichiamo che il browser
// renderizzi davvero:
//   - il badge "T0" nel Tracciamento temporale SOLO sulla riga Mobile
//     (data-testid timeline-row-<itemId>);
//   - la card driver Mobile con "Attivo · attivante" (la SIM che apre la
//     journey non conta come cross-sell), mentre fisso e telefono contano.
//
// Gli item vengono seminati con fisso e telefono PRIMA della SIM, con la
// stessa data: se il T0 cadesse sul primo articolo per ordine/data anziché
// sulla SIM della vendita trigger, il test fallirebbe.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BASE,
  uniq,
  signup,
  newPool,
  launchBrowser,
  newAuthedContext,
  setCjTriggerDate,
  seedJourney,
  addJourneyItem,
  cleanupOrg,
} from './helpers/uiTest.mjs';

test('scheda cliente: T0 sulla riga Mobile di una vendita trigger multi-articolo', async () => {
  const pool = await newPool();
  const session = await signup({ prefix: 'cj_t0_ui', fullName: 'CJ T0 UI Test', organizationName: uniq('CJT0UI') });
  const browser = await launchBrowser();
  try {
    await setCjTriggerDate(pool, session.orgId, '2026-01-01');

    const saleId = uniq('SALE');
    const journeyId = await seedJourney(pool, session.orgId, {
      customerKey: uniq('CFT0').toUpperCase(),
      nome: 'Cliente T0 Multi',
      pdv: 'PDV Trigger Test',
      openedAt: '2026-03-10T10:00:00Z',
      triggerSaleId: saleId,
    });
    const when = '2026-03-10T10:00:00Z';
    const common = { pdv: 'PDV Trigger Test', dataInserimento: when, bisuiteSaleId: saleId };
    // Ordine volutamente "sbagliato": fisso e smartphone prima della SIM.
    const fissoId = await addJourneyItem(pool, session.orgId, journeyId, {
      ...common, driver: 'fisso', state: 'attivato', categoria: 'ADSL/FIBRA/FWA CF', descrizione: 'Super Fibra',
    });
    const telefonoId = await addJourneyItem(pool, session.orgId, journeyId, {
      ...common, driver: 'telefono', state: 'attivato', categoria: 'TELEFONI', descrizione: 'Smartphone X', importo: '499',
    });
    const mobileId = await addJourneyItem(pool, session.orgId, journeyId, {
      ...common, driver: 'mobile', state: 'attivato', categoria: 'TIED CF', descrizione: 'SIM Unlimited',
    });

    const context = await newAuthedContext(browser, session);
    const page = await context.newPage();
    await page.goto(`${BASE}/customer-journey`, { waitUntil: 'networkidle' });
    await page.getByTestId(`card-journey-${journeyId}`).waitFor({ state: 'visible', timeout: 20000 });
    await page.getByTestId(`card-journey-${journeyId}`).click();
    await page.getByTestId('card-timeline').waitFor({ state: 'visible', timeout: 20000 });

    // Tutte e tre le righe della timeline sono presenti.
    for (const id of [fissoId, telefonoId, mobileId]) {
      await page.getByTestId(`timeline-row-${id}`).waitFor({ state: 'visible', timeout: 10000 });
    }

    // Il badge T0 è SOLO sulla riga della SIM mobile.
    // (badge = <span> con testo esattamente "T0"; il nome PDV non lo contiene).
    const t0Badge = page.locator('[data-testid^="timeline-row-"] span', { hasText: /^T0$/ });
    assert.equal(await t0Badge.count(), 1, 'exactly one timeline row must carry the T0 badge');
    // `has` è relativo alla riga: qui il locator interno è il solo <span>.
    const t0Rows = page.locator('[data-testid^="timeline-row-"]', { has: page.locator('span', { hasText: /^T0$/ }) });
    assert.equal(await t0Rows.count(), 1, 'exactly one timeline row must carry the T0 badge');
    assert.equal(await t0Rows.first().getAttribute('data-testid'), `timeline-row-${mobileId}`, 'T0 badge must be on the Mobile (SIM) row');
    for (const [id, label] of [[fissoId, 'fisso'], [telefonoId, 'telefono']]) {
      const n = await page.getByTestId(`timeline-row-${id}`).locator('span', { hasText: /^T0$/ }).count();
      assert.equal(n, 0, `${label} row must not show T0`);
    }

    // Card driver: Mobile è "attivo · attivante" (non conta), fisso e telefono contano.
    const mobileCard = page.getByTestId('driver-mobile');
    await mobileCard.waitFor({ state: 'visible', timeout: 10000 });
    assert.equal(await mobileCard.getAttribute('data-status'), 'attivo', 'mobile driver card status must be "attivo"');
    assert.match(await mobileCard.innerText(), /Attivo · attivante/, 'mobile driver card must read "Attivo · attivante"');
    assert.equal(await page.getByTestId('driver-fisso').getAttribute('data-status'), 'valido', 'fisso must count as cross-sell');
    assert.equal(await page.getByTestId('driver-telefono').getAttribute('data-status'), 'valido', 'telefono must count as cross-sell');

    await page.close();
    await context.close();
  } finally {
    await browser.close().catch(() => {});
    await cleanupOrg(pool, session);
    await pool.end().catch(() => {});
  }
});
