import test from "node:test";
import assert from "node:assert/strict";
import * as XLSX from "xlsx";
import {
  BASE, jsonReq, signup, newPool, setRole, cleanupOrg, launchBrowser, newAuthedContext,
} from "./helpers/uiTest.mjs";

function workbookBase64(amount = "€10.00", transactionId = "AUTHZ-TX-1") {
  const rows = [
    ["Ora di  Ricarica", "Numero Telefono", "Numero Telefono Temporaneo", "Importo Ricarica", "ID Transazione", "Canale di Vendite SAP"],
    ["12/09/26 15:10:00", "3471234567", "", amount, transactionId, "Vodafone Store"],
  ];
  const worksheet = XLSX.utils.aoa_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "IC REPORT 1 - RECHARGES");
  return XLSX.write(workbook, { type: "base64", bookType: "xlsx" });
}

test("Analisi Ricariche: modulo, persistenza report e isolamento organizzazione", async () => {
  const pool = await newPool();
  const orgA = await signup({ prefix: "ricariche_authz_a", fullName: "Analisi Ricariche A" });
  const orgB = await signup({ prefix: "ricariche_authz_b", fullName: "Analisi Ricariche B" });
  let reportId;
  try {
    await setRole(pool, orgA.profileId, "operatore");
    const bisuiteId = Math.floor(Math.random() * 1_000_000_000);
    await pool.query(
      `INSERT INTO bisuite_sales
         (organization_id,bisuite_id,data_vendita,codice_pos,nome_negozio,nome_cliente,
          stato,totale,raw_data)
       VALUES ($1,$2,'2026-09-12 15:10:00','POS-RIC','Roma Test','Cliente Test',
          'Completata','10.00',$3::jsonb)`,
      [orgA.orgId, bisuiteId, JSON.stringify({
        articoli: [{
          categoria: { nome: "RICARICHE" },
          dettaglio: { prezzo: "10.00" },
          telefono: "3471234567",
        }],
      })],
    );
    const path = "/api/ricariche-analysis";
    const headersA = { Cookie: orgA.cookieHeader };
    const deniedByWhitelist = await jsonReq(`${BASE}${path}`, { headers: headersA });
    assert.equal(deniedByWhitelist.status, 200, `default module access failed: ${JSON.stringify(deniedByWhitelist.body)}`);

    await pool.query(`UPDATE profiles SET moduli_consentiti = $2 WHERE id = $1`, [orgA.profileId, []]);
    assert.equal((await jsonReq(`${BASE}${path}`, { headers: headersA })).status, 403);
    await pool.query(`UPDATE profiles SET moduli_consentiti = $2 WHERE id = $1`, [orgA.profileId, ["analisi_ricariche"]]);

    await pool.query(
      `UPDATE organizations SET enabled_modules = $2 WHERE id = $1`,
      [orgA.orgId, JSON.stringify({ analisi_ricariche: false })],
    );
    assert.equal((await jsonReq(`${BASE}${path}`, { headers: headersA })).status, 403);
    await pool.query(
      `UPDATE organizations SET enabled_modules = $2 WHERE id = $1`,
      [orgA.orgId, JSON.stringify({ analisi_ricariche: true, amministrazione: false })],
    );

    const upload = await jsonReq(`${BASE}${path}/upload`, {
      method: "POST",
      headers: headersA,
      body: JSON.stringify({
        provider: "vodafone_fastweb",
        fileName: "report-vf.xlsx",
        workbookBase64: workbookBase64(),
      }),
    });
    assert.equal(upload.status, 201, JSON.stringify(upload.body));
    reportId = upload.body.reportId;

    const result = await jsonReq(`${BASE}${path}?provider=vodafone_fastweb`, { headers: headersA });
    assert.equal(result.status, 200, JSON.stringify(result.body));
    assert.equal(result.body.rows.length, 1);
    assert.equal(result.body.rows[0].status, "VERIFICATO");
    assert.equal(result.body.rows[0].saleId, String(bisuiteId));
    assert.equal(result.body.reports[0].fileName, "report-vf.xlsx");

    const secondUpload = await jsonReq(`${BASE}${path}/upload`, {
      method: "POST",
      headers: headersA,
      body: JSON.stringify({
        provider: "vodafone_fastweb",
        fileName: "report-vf-successivo.xlsx",
        workbookBase64: workbookBase64("€12.00", "AUTHZ-TX-2"),
      }),
    });
    assert.equal(secondUpload.status, 201, JSON.stringify(secondUpload.body));
    const latest = await jsonReq(`${BASE}${path}?provider=vodafone_fastweb`, { headers: headersA });
    assert.equal(latest.body.reports.length, 2);
    assert.equal(latest.body.rows[0].status, "INCONGRUENZA IMPORTO");
    assert.equal(latest.body.rows[0].difference, -2);
    const previous = await jsonReq(`${BASE}${path}?provider=vodafone_fastweb&reportId=${encodeURIComponent(reportId)}`, { headers: headersA });
    assert.equal(previous.body.rows[0].status, "VERIFICATO", "older reports remain selectable after a later upload");

    const otherTenant = await jsonReq(
      `${BASE}${path}?provider=vodafone_fastweb&reportId=${encodeURIComponent(reportId)}&organization_id=${encodeURIComponent(orgA.orgId)}`,
      { headers: { Cookie: orgB.cookieHeader } },
    );
    assert.equal(otherTenant.status, 404, `foreign report must be hidden: ${JSON.stringify(otherTenant.body)}`);

    const noAdminModuleNeeded = await jsonReq(`${BASE}${path}`, { headers: headersA });
    assert.equal(noAdminModuleNeeded.status, 200, "operatore with module grant can use the separate API");

    const browser = await launchBrowser();
    try {
      const context = await newAuthedContext(browser, orgA);
      const page = await context.newPage();
      await page.goto(`${BASE}/analisi-ricariche`, { waitUntil: "networkidle" });
      await page.getByRole("heading", { name: "Analisi ricariche" }).waitFor({ state: "visible", timeout: 20000 });
      await page.getByText("INCONGRUENZA IMPORTO", { exact: true }).waitFor({ state: "visible", timeout: 10000 });
      assert.equal(await page.getByTestId("nav-gara-analisi-ricariche").count(), 1);
      assert.equal(await page.getByTestId("nav-amministrazione").count(), 0);
      await page.getByRole("button", { name: /report-vf\.xlsx/ }).click();
      await page.getByText("VERIFICATO", { exact: true }).waitFor({ state: "visible", timeout: 10000 });
      const csvDownload = page.waitForEvent("download");
      await page.getByRole("button", { name: "CSV" }).click();
      assert.equal((await csvDownload).suggestedFilename(), "analisi-ricariche.csv");
      await context.close();
    } finally {
      await browser.close().catch(() => {});
    }
  } finally {
    await cleanupOrg(pool, orgA);
    await cleanupOrg(pool, orgB);
    await pool.end().catch(() => {});
  }
});
