import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BASE, uniq, jsonReq, signup, cleanupOrg, newPool, launchBrowser, newAuthedContext,
  setCjTriggerDate, seedJourney,
} from './helpers/uiTest.mjs';

// UI: avviso upload DRMS "legacy" (righe senza campi di esito) nella pagina
// DRMS Commissioning e motivo "Nessun esito DRMS" nel popover della scheda CJ.
// Richiede dev server su :5000 + DATABASE_URL.

const CF = 'CNNFRZ70H24H501L';

function legacyRows() {
  return [{
    SEQ_ID: '62572570000001', NATURA: 'CONTRATTUALE', TIPO_FONIA: 'ENERGIA', COMPETENZA: '2026-07',
    DESCRIZIONE_EVENTO: 'Contrat Attiv Luce e Gas_New', CODICE_CONTRATTO: 'DRMS-EN-LEGACY',
    IMPORTO: '30', IMPORTO_NUM: 30, CAPITOLO: 'ENERGIA',
  }];
}

test('DRMS legacy: banner nella pagina DRMS e motivo nel popover CJ', async (t) => {
  const pool = await newPool();
  const session = await signup({ prefix: 'cj_drms_legacy_ui', fullName: 'CJ DRMS Legacy' });
  const { orgId, cookieHeader } = session;
  const browser = await launchBrowser();
  t.after(async () => {
    await browser.close().catch(() => {});
    await cleanupOrg(pool, orgId);
    await pool.end();
  });

  await setCjTriggerDate(pool, orgId, '2026-01-01');
  const journeyId = await seedJourney(pool, orgId, {
    customerKey: CF, nome: 'Fabrizio', openedAt: '2026-07-11T00:00:00.000Z', dataInserimento: '2026-07-11T10:00:00.000Z',
    items: [{ driver: 'mobile' }, { driver: 'energia', descrizione: 'Luce' }],
  });
  await pool.query(`UPDATE customer_journey_items SET cf = $1, pod = 'IT002E5386834A' WHERE journey_id = $2 AND driver = 'energia'`, [CF, journeyId]);

  const rows = legacyRows();
  const up = await jsonReq(`${BASE}/api/drms`, {
    method: 'POST', headers: { Cookie: cookieHeader },
    body: JSON.stringify({ fileName: `drms_lug_26_${uniq('x')}.xlsx`, month: 7, year: 2026, period: 'LUG-26', totaleImporto: 30, righeCount: rows.length, rows }),
  });
  assert.equal(up.status, 200, JSON.stringify(up.body));
  assert.equal(up.body.cjOutcomes.legacyUploads.length, 1);

  const ctx = await newAuthedContext(browser, session);
  const page = await ctx.newPage();

  // 1) Pagina DRMS: banner + badge sulla riga.
  await page.goto(`${BASE}/drms-commissioning`, { waitUntil: 'domcontentloaded' });
  const banner = page.getByTestId('banner-drms-legacy-uploads');
  await banner.waitFor({ state: 'visible', timeout: 30000 });
  const bannerText = await banner.innerText();
  assert.match(bannerText, /1 upload senza campi di esito: ricarica il file/);
  assert.match(bannerText, /LUG-26/);
  await page.getByTestId(`badge-drms-legacy-${up.body.id}`).waitFor({ state: 'visible', timeout: 10000 });

  // 2) Scheda CJ: item energia senza esito ⇒ popover con motivo "legacy".
  await page.goto(`${BASE}/customer-journey`, { waitUntil: 'domcontentloaded' });
  await page.getByTestId(`card-journey-${journeyId}`).waitFor({ state: 'visible', timeout: 30000 });
  await page.getByTestId(`card-journey-${journeyId}`).click();
  const energiaId = (await pool.query(`SELECT id FROM customer_journey_items WHERE journey_id = $1 AND driver = 'energia'`, [journeyId])).rows[0].id;
  const btn = page.getByTestId(`button-drms-no-outcome-${energiaId}`);
  await btn.waitFor({ state: 'visible', timeout: 30000 });
  await page.waitForFunction((id) => document.querySelector(`[data-testid="button-drms-no-outcome-${id}"]`)?.getAttribute('data-reason') === 'legacy_all', energiaId, { timeout: 15000 });
  await btn.click();
  const reason = page.getByTestId(`text-drms-no-outcome-reason-${energiaId}`);
  await reason.waitFor({ state: 'visible', timeout: 10000 });
  const reasonText = await reason.innerText();
  assert.match(reasonText, /Tutti gli upload DRMS .*LUG-26.* sono privi dei campi di esito/);

  // 3) Ricarico lo stesso periodo col parser nuovo (chiavi di esito presenti, POD
  //    agganciabile): l'item energia diventa pagato per pod_pdr.
  const fresh = rows.map((r) => ({ ...r, FISCAL_CODE: CF, P_IVA_CLIENTE: '', POD_PDR: 'it002e5386834a', CAUSALE_STORNO: '', DATA_EVENTO: '2026-07-20', TIPO_TRANSAZIONE: 'W3 Energy' }));
  const up2 = await jsonReq(`${BASE}/api/drms`, {
    method: 'POST', headers: { Cookie: cookieHeader },
    body: JSON.stringify({ fileName: 'drms_lug_26_new.xlsx', month: 7, year: 2026, period: 'LUG-26', totaleImporto: 30, righeCount: fresh.length, rows: fresh, overwrite: true }),
  });
  assert.equal(up2.status, 200, JSON.stringify(up2.body));
  assert.deepEqual(up2.body.cjOutcomes.legacyUploads, []);
  const it = (await pool.query(`SELECT economic_state, drms_outcome_match FROM customer_journey_items WHERE id = $1`, [energiaId])).rows[0];
  assert.equal(it.economic_state, 'pagato');
  assert.equal(it.drms_outcome_match, 'pod_pdr');
});
