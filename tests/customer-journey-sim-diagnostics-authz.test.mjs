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
    const read = () => jsonReq(`${BASE}/api/customer-journeys/report-mobile-sources`, { headers: { Cookie: a.cookieHeader } });
    const admin = await read();
    assert.equal(admin.status, 200);
    assert.deepEqual(admin.body.map(s => s.bisuiteId).sort(), [1, 2]);
    assert.ok(admin.body.every(s => s.cancelled && !("rawData" in s)));
    await setRole(pool, a.profileId, "operatore", []);
    assert.deepEqual((await read()).body, []);
    await setRole(pool, a.profileId, "operatore", [" mario "]);
    assert.deepEqual((await read()).body.map(s => s.bisuiteId), [1]);
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
