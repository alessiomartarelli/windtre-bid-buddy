import { test } from "node:test";
import assert from "node:assert/strict";
import { BASE, signup, newPool, cleanupOrg, jsonReq, setRole } from "./helpers/uiTest.mjs";

test("mobile diagnostic endpoint is org/operator isolated and does not reconcile stale sales", async () => {
  const pool = await newPool();
  const a = await signup({ prefix: "cj_sim_diagnostic_a" });
  const b = await signup({ prefix: "cj_sim_diagnostic_b" });
  try {
    for (const [org, id, addetto] of [[a.orgId, 1, "MARIO"], [a.orgId, 2, "LUIGI"], [b.orgId, 3, "MARIO"]]) {
      await pool.query(`INSERT INTO bisuite_sales (organization_id, bisuite_id, data_vendita, nome_addetto, stato, raw_data)
        VALUES ($1,$2,'2026-07-02',$3,'ANNULLATA',$4::jsonb)`, [org, id, addetto, JSON.stringify({
        addetto: { nominativo: addetto }, attivita: { nominativo: "Negozio" },
        cliente: { codiceFiscale: `CF${id}`, nome: "Cliente" },
        articoli: [{ id, categoria: { nome: "UNTIED" }, tipologia: { nome: "VOCE" }, descrizione: "SIM" },
          { id: 100 + id, categoria: { nome: "ACCESSORI" } }],
      })]);
    }
    const read = () => jsonReq(`${BASE}/api/customer-journeys/report-mobile-sources?detail=1`, { headers: { Cookie: a.cookieHeader } });
    const admin = await read();
    assert.equal(admin.status, 200);
    assert.deepEqual(admin.body.details.map(d => d.source.bisuiteId).sort(), [1, 2]);
    assert.ok(admin.body.details.every(d => d.source.cancelled && !("rawData" in d.source)));
    assert.equal(admin.body.counts.cancelled, 2);
    await setRole(pool, a.profileId, "operatore", []);
    assert.equal((await read()).body.sourceTotal, 0);
    assert.deepEqual((await read()).body.details, []);
    await setRole(pool, a.profileId, "operatore", [" mario "]);
    assert.deepEqual((await read()).body.details.map(d => d.source.bisuiteId), [1]);
    await pool.query("UPDATE profiles SET moduli_consentiti=ARRAY[]::text[] WHERE id=$1", [a.profileId]);
    assert.equal((await read()).status, 403, "diagnostics must respect per-user module permissions");
    assert.equal((await pool.query("SELECT count(*)::int n FROM customer_journeys WHERE organization_id=$1", [a.orgId])).rows[0].n, 0);
    assert.equal((await pool.query("SELECT count(*)::int n FROM organization_config WHERE organization_id=$1", [a.orgId])).rows[0].n, 0);
    const unauth = await jsonReq(`${BASE}/api/customer-journeys/report-mobile-sources`);
    assert.equal(unauth.status, 401);
  } finally {
    await cleanupOrg(pool, a); await cleanupOrg(pool, b); await pool.end();
  }
});

test("historical dataset: bounded period reads, exact summaries and stable pages without reconciliation", async () => {
  const pool = await newPool();
  const a = await signup({ prefix: "cj_sim_history" });
  const { storage } = await import("../server/storage.ts");
  const { pool: storagePool } = await import("../server/db.ts");
  try {
    // Twenty thousand historical sales, including large non-mobile payloads.
    await pool.query(`INSERT INTO bisuite_sales (organization_id,bisuite_id,data_vendita,raw_data)
      SELECT $1,n,'2020-01-01'::timestamp + (n % 1800) * interval '1 day',
        jsonb_build_object('articoli',jsonb_build_array(
          jsonb_build_object('id',n,'categoria',jsonb_build_object('nome','UNTIED'),'descrizione',repeat('x',1000))))
      FROM generate_series(1,20000) n`, [a.orgId]);
    // 605 sales × 2 mobile articles exercise >1 DB batch and duplicate article IDs across sales.
    await pool.query(`INSERT INTO bisuite_sales (organization_id,bisuite_id,data_vendita,nome_cliente,nome_addetto,stato,raw_data)
      SELECT $1,20000+n,CASE WHEN n=605 THEN '2026-07-31 23:59:59.999'::timestamp ELSE '2026-07-01' END,
        'Cliente','MARIO','INSERITA',jsonb_build_object(
          'cliente',jsonb_build_object('codiceFiscale','CF'||n),
          'articoli',jsonb_build_array(
            jsonb_build_object('id',1,'categoria',jsonb_build_object('nome',' untied '),'tipologia',jsonb_build_object('nome','VOCE')),
            jsonb_build_object('id',2,'categoria',jsonb_build_object('nome','TIED IVA'),'tipologia',jsonb_build_object('nome','DATI')),
            jsonb_build_object('id',3,'categoria',jsonb_build_object('nome','ACCESSORI'),'descrizione',repeat('y',1000))))
      FROM generate_series(1,605) n`, [a.orgId]);
    await pool.query(`INSERT INTO bisuite_sales (organization_id,bisuite_id,data_vendita,raw_data)
      VALUES ($1,30001,'2026-08-01','{"articoli":[{"id":1,"categoria":{"nome":"UNTIED"}}]}'),
        ($1,30002,NULL,'{"articoli":[{"id":1,"categoria":{"nome":"UNTIED"}}]}'),
        ($1,30003,'2026-07-02','{"articoli":[{"id":1,"categoria":{"nome":"ACCESSORI"}}]}')`, [a.orgId]);
    // One linked CJ SIM: insertion is July, activation June (must not replace insertion date).
    const { rows: [sale] } = await pool.query("SELECT id FROM bisuite_sales WHERE organization_id=$1 AND bisuite_id=20001", [a.orgId]);
    const { rows: [journey] } = await pool.query(`INSERT INTO customer_journeys
      (organization_id,customer_key,nome,opened_at) VALUES ($1,'CF1','Cliente','2026-06-01') RETURNING id`, [a.orgId]);
    await pool.query(`INSERT INTO customer_journey_items
      (organization_id,journey_id,driver,bisuite_sale_id,bisuite_article_id,categoria,tipologia,addetto,state,data_inserimento,data_attivazione)
      VALUES ($1,$2,'mobile',$3,1,'UNTIED','VOCE','MARIO','inserito','2026-07-01','2026-06-01')`, [a.orgId, journey.id, sale.id]);
    await pool.query(`INSERT INTO organization_config (organization_id,config)
      VALUES ($1,'{"customerJourneyTriggerDate":"2026-01-01"}')`, [a.orgId]);

    // Observe actual storage query results, not only the HTTP payload filtered afterwards.
    const originalQuery = storagePool.query;
    const sizes = [];
    storagePool.query = function (...args) {
      const result = originalQuery.apply(this, args);
      return result.then(r => { sizes.push(r.rows.length); return r; });
    };
    const batches = [];
    try {
      for await (const batch of storage.getCustomerJourneyMobileSourceBatches(a.orgId, null, "2026-07-01", "2026-07-31")) batches.push(batch);
    } finally {
      storagePool.query = originalQuery;
    }
    assert.deepEqual(sizes, [500, 105], "DB must materialize period/mobile sales only, in bounded batches");
    assert.equal(batches.flat().length, 1210);
    assert.ok(batches.flat().every(s => s.insertedAt.startsWith("2026-07") && s.articleId !== 3));
    const reconcile = storage.reconcileCustomerJourneysIfStale;
    storage.reconcileCustomerJourneysIfStale = () => { throw new Error("Unexpected diagnostic reconciliation"); };
    try {
      assert.equal((await storage.getCustomerJourneyReportRows(a.orgId, null, true)).length, 1);
    } finally { storage.reconcileCustomerJourneysIfStale = reconcile; }

    const read = (params = {}) => jsonReq(`${BASE}/api/customer-journeys/report-mobile-sources?${new URLSearchParams({
      from: "2026-07-01", to: "2026-07-31", ...params,
    })}`, { headers: { Cookie: a.cookieHeader } });
    const summary = await read();
    assert.equal(summary.status, 200);
    assert.equal(summary.body.sourceTotal, 1210);
    assert.equal(summary.body.counts.admitted, 1);
    assert.equal(summary.body.counts.data, 605);
    assert.equal(summary.body.counts.unlinked, 604);
    assert.deepEqual(summary.body.details, [], "summary must not download source articles");
    const details = [];
    const started = performance.now();
    for (let page = 0; page < Math.ceil(1210 / 50); page++) {
      const result = await read({ detail: "1", page: String(page) });
      assert.equal(result.status, 200);
      assert.deepEqual(result.body.counts, summary.body.counts);
      assert.equal(result.body.sourceTotal, summary.body.sourceTotal);
      assert.ok(result.body.details.length <= 50);
      details.push(...result.body.details);
    }
    console.log(`Historical diagnostic: 20,608 sales; 1,210 period articles; 25 pages in ${Math.round(performance.now() - started)}ms`);
    assert.equal(new Set(details.map(d => `${d.source.saleId}:${d.source.articleId}`)).size, 1210);
    const counted = { ...summary.body.counts };
    Object.keys(counted).forEach(k => counted[k] = 0);
    details.forEach(d => counted[d.reason]++);
    assert.deepEqual(counted, summary.body.counts);
    assert.deepEqual((await read({ detail: "1", page: "0" })).body.details, details.slice(0, 50));
    for (const filters of [
      { typeFilter: "azienda" }, { pdvFilter: ["Altro"] }, { addettoFilter: "LUIGI" },
      { stateFilter: "pagato" }, { search: "inesistente" },
    ]) {
      const result = await read({ filters: JSON.stringify({
        typeFilter: "tutti", pdvFilter: [], addettoFilter: "tutti", stateFilter: "tutti", search: "", ...filters,
      }) });
      assert.equal(result.body.sourceTotal, 0);
    }
    for (const params of [{ from: "2026-02-30" }, { to: "2026-06-30" }, { page: "-1" }, { page: "1.5" }, { filters: "null" }])
      assert.equal((await read(params)).status, 400);
    await setRole(pool, a.profileId, "operatore", []);
    assert.equal((await read({ detail: "1" })).body.sourceTotal, 0);
    await setRole(pool, a.profileId, "operatore", [" mario "]);
    assert.equal((await read()).body.sourceTotal, 1210);
    assert.equal((await pool.query("SELECT count(*)::int n FROM customer_journeys WHERE organization_id=$1", [a.orgId])).rows[0].n, 1);
    assert.equal((await pool.query("SELECT count(*)::int n FROM customer_journey_items WHERE organization_id=$1", [a.orgId])).rows[0].n, 1);
  } finally {
    await cleanupOrg(pool, a);
    await pool.end();
    await storagePool.end();
  }
});
