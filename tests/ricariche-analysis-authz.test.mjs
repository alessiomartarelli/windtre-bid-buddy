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

function windTreWorkbookBase64() {
  const rows = [
    ["Codice Ordine", "Keycode", "MSISDN", "ICCID", "Taglio ricarica", "Tipo ricarica", "Stato", "Data utilizzo", "PDV", "alias"],
    ["AUTHZ-W3-ORDER", "AUTHZ-W3-KEY", "3471234567", "8939880846057080279", 15, "VSC", "BURNED", "2026-10-09", "POS-W3", "Test"],
  ];
  const worksheet = XLSX.utils.aoa_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Report");
  return XLSX.write(workbook, { type: "base64", bookType: "xlsx" });
}

test("Analisi Ricariche: modulo, persistenza report e isolamento organizzazione", async () => {
  const pool = await newPool();
  const orgA = await signup({ prefix: "ricariche_authz_a", fullName: "Analisi Ricariche A" });
  const orgB = await signup({ prefix: "ricariche_authz_b", fullName: "Analisi Ricariche B" });
  const orgWindTre = await signup({ prefix: "ricariche_authz_w3", fullName: "Analisi Ricariche WindTre" });
  let reportId;
  const brandIds = [];
  try {
    for (const [orgId, name] of [
      [orgA.orgId, `Vodafone ricariche ${Date.now()} ${Math.random()}`],
      [orgWindTre.orgId, `WindTre ricariche ${Date.now()} ${Math.random()}`],
    ]) {
      const brand = await pool.query(`INSERT INTO brands (name) VALUES ($1) RETURNING id`, [name]);
      const brandId = brand.rows[0].id;
      brandIds.push(brandId);
      await pool.query(`INSERT INTO organization_brands (organization_id, brand_id) VALUES ($1, $2)`, [orgId, brandId]);
    }
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
    assert.deepEqual(deniedByWhitelist.body.allowedProviders, ["vodafone_fastweb"]);
    assert.equal((await jsonReq(`${BASE}${path}?provider=windtre`, { headers: headersA })).status, 403);

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
    const wrongProviderUpload = await jsonReq(`${BASE}${path}/upload`, {
      method: "POST",
      headers: headersA,
      body: JSON.stringify({
        provider: "windtre",
        fileName: "report-w3.xlsx",
        workbookBase64: windTreWorkbookBase64(),
      }),
    });
    assert.equal(wrongProviderUpload.status, 403, "Vodafone tenants cannot upload WindTre reports");
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

    await pool.query(
      `INSERT INTO bisuite_sales
         (organization_id,bisuite_id,data_vendita,codice_pos,nome_negozio,nome_cliente,
          stato,totale,raw_data)
       VALUES ($1,900123456,'2026-10-09 15:10:00','POS-W3','Negozio WindTre','Cliente WindTre',
          'Completata','15.00',$2::jsonb)`,
      [orgWindTre.orgId, JSON.stringify({
        articoli: [{
          categoria: { nome: "RICARICHE" },
          dettaglio: { prezzo: "15.00" },
          telefono: "3471234567",
        }],
      })],
    );
    const windHeaders = { Cookie: orgWindTre.cookieHeader };
    const windDefault = await jsonReq(`${BASE}${path}`, { headers: windHeaders });
    assert.equal(windDefault.status, 200, JSON.stringify(windDefault.body));
    assert.equal(windDefault.body.provider, "windtre", "initial load should select the tenant's provider");
    assert.deepEqual(windDefault.body.allowedProviders, ["windtre"]);
    const windWrongProvider = await jsonReq(`${BASE}${path}?provider=vodafone_fastweb`, { headers: windHeaders });
    assert.equal(windWrongProvider.status, 403);
    const windWrongUpload = await jsonReq(`${BASE}${path}/upload`, {
      method: "POST",
      headers: windHeaders,
      body: JSON.stringify({
        provider: "vodafone_fastweb",
        fileName: "report-vf.xlsx",
        workbookBase64: workbookBase64(),
      }),
    });
    assert.equal(windWrongUpload.status, 403, "WindTre tenants cannot upload Vodafone/Fastweb reports");
    const windUpload = await jsonReq(`${BASE}${path}/upload`, {
      method: "POST",
      headers: windHeaders,
      body: JSON.stringify({
        provider: "windtre",
        fileName: "report-w3.xlsx",
        workbookBase64: windTreWorkbookBase64(),
      }),
    });
    assert.equal(windUpload.status, 201, JSON.stringify(windUpload.body));
    const windReport = await jsonReq(`${BASE}${path}?reportId=${encodeURIComponent(windUpload.body.reportId)}`, { headers: windHeaders });
    assert.equal(windReport.status, 200, JSON.stringify(windReport.body));
    assert.equal(windReport.body.rows.length, 1);
    assert.equal(windReport.body.rows[0].supplier, "WindTre");
    assert.equal(windReport.body.rows[0].transactionId, "AUTHZ-W3-KEY");
    assert.equal(windReport.body.rows[0].status, "VERIFICATO");
    assert.equal(windReport.body.reports[0].fileName, "report-w3.xlsx");

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

      const windContext = await newAuthedContext(browser, orgWindTre);
      const windPage = await windContext.newPage();
      await windPage.goto(`${BASE}/analisi-ricariche`, { waitUntil: "networkidle" });
      await windPage.getByRole("heading", { name: "Analisi ricariche" }).waitFor({ state: "visible", timeout: 20000 });
      await windPage.getByText("Nuovo report WindTre", { exact: true }).waitFor({ state: "visible", timeout: 10000 });
      assert.equal(await windPage.getByText("Nuovo report Vodafone / Fastweb", { exact: true }).count(), 0);
      await windContext.close();
    } finally {
      await browser.close().catch(() => {});
    }
  } finally {
    await cleanupOrg(pool, orgWindTre);
    await cleanupOrg(pool, orgA);
    await cleanupOrg(pool, orgB);
    for (const brandId of brandIds) {
      await pool.query(`DELETE FROM brands WHERE id = $1`, [brandId]).catch(() => {});
    }
    await pool.end().catch(() => {});
  }
});
