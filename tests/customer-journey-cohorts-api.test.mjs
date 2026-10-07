import { test } from "node:test";
import assert from "node:assert/strict";
import { BASE, signup, newPool, seedJourney, setRole, cleanupOrg, jsonReq } from "./helpers/uiTest.mjs";
import { buildCjCohortModel } from "../shared/customerJourneyCohorts.ts";

test("cohort API: competence reconstruction, tenant/operator isolation and empty whitelist", async () => {
  const pool = await newPool();
  const sessions = [];
  try {
    const owner = await signup({ prefix: "cohort_api" });
    sessions.push(owner);
    const other = await signup({ prefix: "cohort_other" });
    sessions.push(other);
    const j = await seedJourney(pool, owner.orgId, {
      customerKey: "COHORT-TEST", nome: "Cliente coorte API",
      openedAt: "2026-07-01", pdv: "Store test", addetto: "Anna",
      items: [
        { driver: "mobile", dataInserimento: "2026-07-01", categoria: "MOBILE" },
        { driver: "fisso", dataInserimento: "2026-08-01", addetto: "Marco" },
      ],
    });
    await pool.query(`UPDATE customer_journey_items SET codice_contratto = 'COHORT-FIS'
      WHERE journey_id = $1 AND driver = 'fisso'`, [j]);
    await pool.query(`UPDATE customer_journey_items SET codice_contratto = 'COHORT-SIM',
      state_updated_at = '2026-09-01' WHERE journey_id = $1 AND driver = 'mobile'`, [j]);
    const drms = {
      SEQ_ID: "COHORT-SEQ", NATURA: "CONTRATTUALE", TIPO_FONIA: "FISSO",
      COMPETENZA: "2026-09", CODICE_CONTRATTO: "COHORT-FIS",
      FISCAL_CODE: "", P_IVA_CLIENTE: "", POD_PDR: "", CAUSALE_STORNO: "",
      IMPORTO_NUM: 999, IMPORTO: "999", DATA_EVENTO: "2026-09-01",
      TIPO_TRANSAZIONE: "Activation", DESCRIZIONE_EVENTO: "Attivazione Fisso",
    };
    await pool.query(`INSERT INTO drms_uploads
      (organization_id, month, year, file_name, period, rows, righe_count)
      VALUES ($1, 10, 2026, 'cohort-test.xlsx', 'Ottobre 2026', $2::jsonb, 1)`,
    [owner.orgId, JSON.stringify([drms])]);
    const get = session => jsonReq(`${BASE}/api/customer-journeys/report-cohorts`, {
      headers: { Cookie: session.cookieHeader },
    });
    const result = await get(owner);
    assert.equal(result.status, 200, JSON.stringify(result.body));
    assert.equal(result.body.rows.length, 2);
    assert.equal(result.body.operatorScoped, false);
    assert.match(result.headers.get("cache-control"), /no-store/);
    const fixed = result.body.rows.find(r => r.driver === "fisso");
    assert.deepEqual(fixed.economicHistory, [{ month: "2026-09", state: "pagato", source: "drms" }]);
    assert.equal("cf" in fixed, false);
    assert.equal("codiceContratto" in fixed, false);
    assert.equal("importo" in fixed.economicHistory[0], false);
    const mobile = result.body.rows.find(r => r.driver === "mobile");
    assert.equal(mobile.simContract, "COHORT-SIM");
    assert.equal(mobile.operativeDecisionAt, null, "automatic timestamps are not manual decision dates");
    assert.equal("simContract" in fixed, false);
    const m = buildCjCohortModel(result.body.rows);
    assert.equal(m.events.find(e => e.kind === "vendita").month, "2026-08");
    assert.equal(m.events.find(e => e.kind === "riconoscimento").confirmed, 20);
    await pool.query(`UPDATE customer_journey_items SET state='ko',state_manual=true,
      state_updated_at='2026-08-05' WHERE journey_id=$1 AND driver='mobile'`, [j]);
    const afterManual = await get(owner);
    assert.equal(afterManual.body.rows.find(r => r.driver === "mobile").operativeDecisionAt.slice(0, 10), "2026-08-05");
    assert.equal((await get(other)).body.rows.length, 0);
    await setRole(pool, owner.profileId, "operatore", ["Marco"]);
    const operator = await get(owner);
    assert.equal(operator.status, 200);
    assert.equal(operator.body.operatorScoped, true);
    assert.equal(operator.body.rows.length, 1);
    assert.equal(operator.body.rows[0].addetto, "Marco");
    await setRole(pool, owner.profileId, "operatore", []);
    assert.deepEqual((await get(owner)).body.rows, []);
    const anonymous = await jsonReq(`${BASE}/api/customer-journeys/report-cohorts`);
    assert.equal(anonymous.status, 401);
  } finally {
    for (const s of sessions) await cleanupOrg(pool, s);
    await pool.end();
  }
});
