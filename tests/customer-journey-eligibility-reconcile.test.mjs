import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BASE, signup, newPool, cleanupOrg, jsonReq, uniq, setCjTriggerDate, seedJourney, addJourneyItem } from './helpers/uiTest.mjs';
import { buildCjCohortModel } from '../shared/customerJourneyCohorts.ts';
import { buildCjProgression } from '../shared/customerJourneyProgression.ts';
import { buildGettoneJourneys, cjJourneyReportRows } from '../shared/customerJourney.ts';
import { journeyGettoneRows } from '../shared/customerJourneyExport.ts';

test('actual list/report/detail/export agree for same-instant successive receipts and later phones reusing the initial ICCID', async () => {
  const pool = await newPool(), session = await signup({ prefix: 'cj_receipt_parity' });
  const when = '2026-07-09T10:00:00.000Z', A = '89000000000000000001', B = '89000000000000000002';
  const firstSale = uniq('receipt-a'), secondSale = uniq('receipt-b');
  const get = path => jsonReq(`${BASE}${path}`, { headers: { Cookie: session.cookieHeader } });
  try {
    await setCjTriggerDate(pool, session.orgId, '2026-07-01');
    const id = await seedJourney(pool, session.orgId, {
      customerKey: uniq('SYNTHETIC'), nome: 'Cliente sintetico', openedAt: when,
      triggerSaleId: firstSale, triggerBisuiteId: 101,
    });
    const add = (driver, sale, bid, iccid, flags = {}) => addJourneyItem(pool, session.orgId, id, {
      driver, bisuiteSaleId: sale, bisuiteId: bid, iccid, dataInserimento: when, state: 'inserito',
      categoria: driver === 'mobile' ? 'TIED CF' : 'TELEFONIA',
      tipologia: driver === 'mobile' ? 'VOCE EASYPAY' : 'SMARTPHONE', ...flags,
    });
    await add('mobile', firstSale, 101, A, { cjTriggerMobile: true });
    await add('mobile', secondSale, 102, B);
    await add('telefono', secondSale, 102, B);
    const excluded = await add('telefono', uniq('receipt-later'), 103, A, { dataInserimento: '2026-08-09' });
    for (const expectedBase of [0, 20]) {
      if (expectedBase === 20) await add('telefono', firstSale, 101, A);
      const listResponse = await get('/api/customer-journeys'), reportResponse = await get('/api/customer-journeys/report');
      const detailResponse = await get(`/api/customer-journeys/${id}`);
      assert.equal(listResponse.status, 200); assert.equal(reportResponse.status, 200); assert.equal(detailResponse.status, 200);
      const detail = detailResponse.body;
      assert.equal(reportResponse.body.find(r => r.bisuiteSaleId === secondSale).bisuiteId, 102);
      const fromReport = buildGettoneJourneys(reportResponse.body)[0];
      const fromDetail = buildGettoneJourneys(cjJourneyReportRows(detail, detail.items))[0];
      const fromList = listResponse.body.find(j => j.id === id).gettone;
      for (const g of [fromReport, fromDetail, fromList]) {
        assert.equal(g.gettoneBase, expectedBase); assert.equal(g.extraStimato, 20);
        assert.equal(g.extraCoppie, 1); assert.equal(g.fatturato, expectedBase + 20);
      }
      const exported = new Map(journeyGettoneRows(detail, detail.items));
      assert.equal(exported.get('Totale stimato'), expectedBase + 20);
      assert.equal(exported.get('Extra coppie SIM–smartphone'), 20);
      assert.equal(detail.items.filter(it => it.id === excluded).length, 1, 'unmatched history retained');
    }
  } finally {
    await cleanupOrg(pool, session); await pool.end();
  }
});

test('smartphone ICCID backfill, physical SIM dedup and reimport preserve manual states/details; reads never write', async () => {
  const pool = await newPool();
  const session = await signup({ prefix: 'cj_phone_link' });
  const other = await signup({ prefix: 'cj_phone_other' });
  const key = uniq('SYNTHETIC').toUpperCase();
  const A = '89000000000000000001', B = '89000000000000000002';
  const art = (id, categoria, tipologia, over = {}) => ({ id, categoria: { nome: categoria }, tipologia: { nome: tipologia }, dettaglio: over });
  const articles = (iccid, id) => [
    art(id, 'SIM', 'SIM FISICA', { codiceUnivoco: iccid }),
    art(id + 1, 'TELEFONIA', 'SMARTPHONE', { venditaInfo1: `ICCID SIM ALLEGATA: ${iccid}` }),
    art(id + 2, 'TIED CF', 'VOCE EASYPAY', { venditaInfo2: `ICCID SIM ALLEGATA: ${iccid}` }),
  ];
  const insert = async (org, bid, date, arts) => {
    const r = await pool.query(`INSERT INTO bisuite_sales (organization_id,bisuite_id,data_vendita,stato,raw_data)
      VALUES ($1,$2,$3,'ATTIVO',$4::jsonb) RETURNING id`, [org, bid, date,
      JSON.stringify({ cliente: { codiceFiscale: key, nome: 'Cliente sintetico' }, articoli: arts })]);
    return r.rows[0].id;
  };
  const post = () => jsonReq(`${BASE}/api/customer-journeys/reconcile`, { method: 'POST', headers: { Cookie: session.cookieHeader } });
  const get = path => jsonReq(`${BASE}${path}`, { headers: { Cookie: session.cookieHeader } });
  try {
    await setCjTriggerDate(pool, session.orgId, '2026-07-01');
    await insert(session.orgId, 101, '2026-07-09', articles(A, 1));
    const laterArts = articles(B, 10);
    laterArts.push({ ...laterArts[1] }); // same article repeated in the CMS payload
    await insert(session.orgId, 102, '2026-08-09', laterArts);
    await insert(other.orgId, 101, '2026-07-09', articles(A, 1));
    assert.equal((await post()).status, 200);
    const original = (await get('/api/customer-journeys')).body;
    assert.equal(original.length, 1);
    assert.equal(original[0].gettone.gettoneBase, 20);
    assert.equal(original[0].gettone.extraStimato, 20);
    const journeyId = original[0].id;
    const details = (await get(`/api/customer-journeys/${journeyId}`)).body;
    assert.equal(details.items.length, 4, 'physical SIM is not a second activation and repeated raw item is deduped');
    assert.equal(details.items.filter(i => i.cjTriggerMobile).length, 1);
    const initialPhone = details.items.find(i => i.driver === 'telefono' && i.bisuiteArticleId === 2);
    // Simulate historic rows and edits before the eligibility upgrade.
    await pool.query(`UPDATE customer_journey_items SET iccid=NULL,cj_trigger_mobile=false WHERE organization_id=$1`, [session.orgId]);
    await pool.query(`UPDATE customer_journey_items SET state='in_lavorazione',state_manual=true,
      economic_state='pagato',economic_state_manual=true,details_manual=true,imei='synthetic-manual-imei',
      rata='12',pdv_destinazione='PDV manuale',gettone_confirmed=true WHERE id=$1`, [initialPhone.id]);
    await pool.query(`UPDATE organization_config SET config=config ||
      '{"customerJourneyEligibilityVersion":2,"customerJourneyReconciledAt":"2099-01-01T00:00:00Z"}'::jsonb
      WHERE organization_id=$1`, [session.orgId]);
    const snapshot = async () => (await pool.query(`SELECT row_to_json(i) AS row FROM customer_journey_items i
      WHERE organization_id=$1 ORDER BY id`, [session.orgId])).rows;
    const beforeReads = await snapshot();
    await get('/api/customer-journeys');
    assert.equal((await get('/api/customer-journeys/report')).status, 200);
    await get('/api/customer-journeys/report-cohorts');
    assert.deepEqual(await snapshot(), beforeReads, 'consultation never backfills');
    assert.equal((await post()).status, 200);
    const current = (await get(`/api/customer-journeys/${journeyId}`)).body;
    const kept = current.items.find(i => i.id === initialPhone.id);
    assert.equal(kept.iccid, A);
    assert.equal(kept.state, 'in_lavorazione'); assert.equal(kept.stateManual, true);
    assert.equal(kept.economicState, 'pagato'); assert.equal(kept.economicStateManual, true);
    assert.equal(kept.imei, 'synthetic-manual-imei'); assert.equal(kept.rata, '12');
    assert.equal(kept.pdvDestinazione, 'PDV manuale'); assert.equal(kept.gettoneConfirmed, true);
    const report = (await get('/api/customer-journeys/report')).body;
    assert.equal(buildGettoneJourneys(report)[0].extraStimato, 20);
    const n1 = current.items.map(i => [i.id, i.iccid, i.cjTriggerMobile, i.state, i.economicState, i.imei]).sort();
    assert.equal((await post()).status, 200);
    const again = (await get(`/api/customer-journeys/${journeyId}`)).body;
    assert.deepEqual(again.items.map(i => [i.id, i.iccid, i.cjTriggerMobile, i.state, i.economicState, i.imei]).sort(), n1);
    const cfg = await pool.query(`SELECT config->>'customerJourneyEligibilityVersion' AS v FROM organization_config WHERE organization_id=$1`, [session.orgId]);
    assert.equal(cfg.rows[0].v, '3');
    assert.equal((await pool.query(`SELECT count(*)::int AS n FROM customer_journey_items WHERE organization_id=$1`, [other.orgId])).rows[0].n, 0);
  } finally {
    await cleanupOrg(pool, session); await cleanupOrg(pool, other); await pool.end();
  }
});

test('sales-annulled SIMs disappear from CJ, while economic DRMS annulments remain reportable', async () => {
  const pool = await newPool();
  const session = await signup({ prefix: 'cj_sales_annul' });
  const other = await signup({ prefix: 'cj_sales_annul_other' });
  const key = uniq('CJANN').toUpperCase();
  const mobile = { id: 1, categoria: { nome: 'UNTIED' }, tipologia: { nome: 'RICARICABILE' }, descrizione: 'SIM voce' };
  const fixed = { id: 2, categoria: { nome: 'ADSL/FIBRA/FWA CF' }, tipologia: { nome: 'FIBRA' }, descrizione: 'Fibra' };
  const raw = articles => JSON.stringify({ cliente: { codiceFiscale: key, nome: 'Cliente test' }, articoli: articles });
  const get = path => jsonReq(`${BASE}${path}`, { headers: { Cookie: session.cookieHeader } });
  const sale = async (orgId, bid, articles) => {
    const result = await pool.query(`INSERT INTO bisuite_sales
      (organization_id,bisuite_id,data_vendita,stato,raw_data)
      VALUES ($1,$2,'2026-07-01','ATTIVO',$3::jsonb) RETURNING id`,
    [orgId, bid, raw(articles)]);
    return result.rows[0].id;
  };
  try {
    const first = await sale(session.orgId, 11, [mobile]);
    const second = await sale(session.orgId, 12, [mobile, fixed]);
    await sale(other.orgId, 12, [mobile]);
    const post = await jsonReq(`${BASE}/api/customer-journeys/reconcile`, {
      method: 'POST', headers: { Cookie: session.cookieHeader },
    });
    assert.equal(post.status, 200);
    const original = await get('/api/customer-journeys/report-cohorts');
    assert.equal(original.body.rows.length, 3);
    const journeyId = original.body.rows[0].journeyId;
    // Simulate an old-version CJ: unchanged watermark must not prevent cleanup.
    await pool.query(`UPDATE bisuite_sales SET stato=' ANNULLATA ' WHERE id=$1`, [second]);
    await pool.query(`UPDATE organization_config SET config=config ||
      '{"customerJourneyEligibilityVersion":1,"customerJourneyReconciledAt":"2099-01-01T00:00:00Z"}'::jsonb
      WHERE organization_id=$1`, [session.orgId]);
    await jsonReq(`${BASE}/api/customer-journeys/reconcile`, {
      method: 'POST', headers: { Cookie: session.cookieHeader },
    });
    const current = await get('/api/customer-journeys/report-cohorts');
    assert.equal(current.status, 200);
    assert.equal(current.body.rows.filter(r => r.driver === 'mobile').length, 1);
    const cancelledItems = await pool.query(`SELECT id FROM customer_journey_items
      WHERE organization_id=$1 AND bisuite_sale_id=$2 AND driver='mobile'`, [session.orgId, second]);
    assert.equal(cancelledItems.rowCount, 0);
    const p = buildCjProgression(current.body.rows, buildCjCohortModel(current.body.rows).customers);
    assert.equal(p.dropped.length, 0);
    assert.equal(p.falls.length, 0);
    assert.equal(p.exitedCustomers.length, 0);
    const detail = await get(`/api/customer-journeys/${journeyId}`);
    assert.equal(detail.status, 200);
    assert.equal(detail.body.items.filter(i => i.driver === 'mobile').length, 1);
    assert.equal(detail.body.items.find(i => i.driver === 'mobile').bisuiteSaleId, first);
    // Same economic label, different source: active sale + DRMS annulment stays.
    await pool.query(`UPDATE customer_journey_items SET economic_state='annullato',
      drms_outcome_state='annullato' WHERE journey_id=$1 AND driver='mobile'`, [journeyId]);
    const drms = await get('/api/customer-journeys/report-cohorts');
    const drmsProgress = buildCjProgression(drms.body.rows, buildCjCohortModel(drms.body.rows).customers);
    assert.equal(drmsProgress.dropped.length, 1);
    assert.equal(drmsProgress.exitedCustomers.length, 1);
    // Cancel the last remaining source SIM: no CJ or cohort, even with fixed.
    await pool.query(`UPDATE bisuite_sales SET stato='ANNULLATA',
      last_seen_at=now()+interval '2 seconds' WHERE id=$1`, [first]);
    await jsonReq(`${BASE}/api/customer-journeys/reconcile`, {
      method: 'POST', headers: { Cookie: session.cookieHeader },
    });
    const empty = await get('/api/customer-journeys/report-cohorts');
    assert.deepEqual(empty.body.rows, []);
    assert.equal((await get(`/api/customer-journeys/${journeyId}`)).status, 404);
    assert.deepEqual((await get('/api/customer-journeys')).body, []);
    const preserved = await pool.query(`SELECT organization_id,stato FROM bisuite_sales
      WHERE organization_id=ANY($1::varchar[])`, [[session.orgId, other.orgId]]);
    assert.equal(preserved.rows.filter(r => r.organization_id === session.orgId).length, 2);
    assert.equal(preserved.rows.find(r => r.organization_id === other.orgId).stato, 'ATTIVO');
  } finally {
    await cleanupOrg(pool, session);
    await cleanupOrg(pool, other);
    await pool.end();
  }
});

test('eligibility upgrade moves legacy T0, prunes unqualified journeys, preserves contracts and is tenant-scoped/idempotent', async () => {
  const pool = await newPool();
  const session = await signup({ prefix: 'cj_eligibility', fullName: 'CJ Eligibility' });
  const other = await signup({ prefix: 'cj_eligibility_other', fullName: 'Other Tenant' });
  const cf = uniq('CJEL').toUpperCase();
  const onlyExcluded = uniq('CJNO').toUpperCase();
  const art = (id, categoria, tipologia, descrizione) => ({ id, categoria: { nome: categoria }, tipologia: { nome: tipologia }, descrizione });
  const voice = art(1, 'TIED CF', 'VOCE EASYPAY', 'Voce 100GB');
  const data = art(2, 'TIED IVA', 'VOCE IVA', 'Professional Data 100');
  const phone = art(3, 'TELEFONIA', 'SMARTPHONE', 'Smartphone');
  async function sale(orgId, key, date, arts, bid) {
    const raw = { cliente: { codiceFiscale: key, clienteTipo: 'FISICA', nome: 'Test' }, articoli: arts };
    const r = await pool.query(`INSERT INTO bisuite_sales (organization_id,bisuite_id,data_vendita,stato,raw_data)
      VALUES ($1,$2,$3,'ATTIVO',$4::jsonb) RETURNING id`, [orgId, bid, date, JSON.stringify(raw)]);
    return r.rows[0].id;
  }
  const post = async () => {
    const r = await jsonReq(`${BASE}/api/customer-journeys/reconcile`, { method: 'POST', headers: { Cookie: session.cookieHeader } });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    return r.body;
  };
  try {
    // Start with voice so we can construct the state of the old category-only engine.
    const first = await sale(session.orgId, cf, '2026-07-01', [voice, phone], 10);
    const second = await sale(session.orgId, cf, '2026-07-20', [data, voice], 20);
    const disqualified = await sale(session.orgId, onlyExcluded, '2026-07-01', [voice], 30);
    await sale(session.orgId, uniq('EARLY'), '2026-06-30', [voice], 40);
    await sale(session.orgId, uniq('DATAONLY'), '2026-07-10', [data], 50);
    await sale(session.orgId, uniq('ALARMONLY'), '2026-07-11', [art(1, 'ALTRE GA', 'ALTRE GA NON TURISTICHE', 'SIM Allarme')], 60);
    await sale(other.orgId, cf, '2026-07-01', [voice], 10);
    const otherReconcile = await jsonReq(`${BASE}/api/customer-journeys/reconcile`, { method: 'POST', headers: { Cookie: other.cookieHeader } });
    assert.equal(otherReconcile.status, 200);
    const otherBefore = await pool.query(`SELECT id,opened_at FROM customer_journeys WHERE organization_id=$1`, [other.orgId]);
    await post();
    const before = await pool.query(`SELECT * FROM customer_journeys WHERE organization_id=$1 AND customer_key=$2`, [session.orgId, cf]);
    const journeyId = before.rows[0].id;
    const saved = await pool.query(`UPDATE customer_journey_items SET state='in_lavorazione', state_manual=true,
      economic_state='pagato', economic_state_manual=true, details_manual=true, imei='manual-imei', rata='12',
      data_attivazione='2026-07-05', pdv_destinazione='Manual PDV', gettone_confirmed=true
      WHERE organization_id=$1 AND bisuite_article_id=3 RETURNING id`, [session.orgId]);
    // Same article IDs/sales, now the formerly triggering voice is data/Tourist.
    await pool.query(`UPDATE bisuite_sales SET raw_data=jsonb_set(raw_data,'{articoli}',$2::jsonb) WHERE id=$1`, [first, JSON.stringify([data, phone].map(a => a.id === 2 ? { ...a, id: 1 } : a))]);
    await pool.query(`UPDATE bisuite_sales SET raw_data=jsonb_set(raw_data,'{articoli}',$2::jsonb) WHERE id=$1`, [disqualified, JSON.stringify([art(1, 'ALTRE GA', 'GA TURISTICHE', 'Tourist')])]);
    // A current sales watermark with no version must still force exactly one upgrade.
    await pool.query(`UPDATE organization_config SET config=(config - 'customerJourneyEligibilityVersion') ||
      jsonb_build_object('customerJourneyReconciledAt','2099-01-01T00:00:00Z') WHERE organization_id=$1`, [session.orgId]);
    await post();
    const list = await jsonReq(`${BASE}/api/customer-journeys`, { headers: { Cookie: session.cookieHeader } });
    assert.equal(list.status, 200);
    assert.equal(list.body.length, 1);
    assert.equal(list.body[0].id, journeyId);
    assert.equal(new Date(list.body[0].openedAt).toISOString().slice(0,10), '2026-07-20');
    const current = await pool.query(`SELECT * FROM customer_journeys WHERE id=$1`, [journeyId]);
    assert.equal(current.rows[0].trigger_sale_id, second);
    const kept = await pool.query(`SELECT * FROM customer_journey_items WHERE id=$1`, [saved.rows[0].id]);
    assert.equal(kept.rows[0].state, 'in_lavorazione');
    assert.equal(kept.rows[0].state_manual, true);
    assert.equal(kept.rows[0].economic_state, 'pagato');
    assert.equal(kept.rows[0].economic_state_manual, true);
    assert.equal(kept.rows[0].imei, 'manual-imei');
    assert.equal(kept.rows[0].rata, '12');
    assert.equal(kept.rows[0].pdv_destinazione, 'Manual PDV');
    assert.equal(kept.rows[0].gettone_confirmed, true);
    assert.equal(new Date(kept.rows[0].data_attivazione).toISOString().slice(0,10), '2026-07-05');
    const r = await post();
    assert.equal(r.journeys, 1);
    assert.equal(r.t0MovedForward, 0);
    assert.equal(r.removedJourneys, 0);
    const count = await pool.query(`SELECT count(*)::int AS n FROM customer_journey_items WHERE journey_id=$1`, [journeyId]);
    assert.equal(count.rows[0].n, 4, 'excluded SIM remains historical; no duplicate items');
    const outside = await pool.query(`SELECT count(*)::int AS n FROM bisuite_sales WHERE organization_id=$1`, [other.orgId]);
    assert.equal(outside.rows[0].n, 1);
    const otherAfter = await pool.query(`SELECT id,opened_at FROM customer_journeys WHERE organization_id=$1`, [other.orgId]);
    assert.deepEqual(otherAfter.rows, otherBefore.rows, 'upgrade must not prune or move the other tenant');
    const wm = await pool.query(`SELECT config->>'customerJourneyReconciledAt' AS at FROM organization_config WHERE organization_id=$1`, [session.orgId]);
    await jsonReq(`${BASE}/api/customer-journeys`, { headers: { Cookie: session.cookieHeader } });
    const after = await pool.query(`SELECT config->>'customerJourneyReconciledAt' AS at FROM organization_config WHERE organization_id=$1`, [session.orgId]);
    assert.equal(wm.rows[0].at, after.rows[0].at);
  } finally {
    for (const s of [session, other]) {
      await pool.query(`DELETE FROM bisuite_sales WHERE organization_id=$1`, [s.orgId]);
      await cleanupOrg(pool, s);
    }
    await pool.end();
  }
});
