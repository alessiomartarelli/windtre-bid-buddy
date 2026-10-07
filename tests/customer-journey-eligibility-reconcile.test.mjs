import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BASE, signup, newPool, cleanupOrg, jsonReq, uniq } from './helpers/uiTest.mjs';

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
