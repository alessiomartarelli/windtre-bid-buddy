import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BASE, signup, newPool, cleanupOrg, jsonReq, uniq } from './helpers/uiTest.mjs';
import { buildCjCohortModel } from '../shared/customerJourneyCohorts.ts';
import { buildCjProgression } from '../shared/customerJourneyProgression.ts';

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
