import test from "node:test";
import assert from "node:assert/strict";
import * as XLSX from "xlsx";
import {
  BASE, jsonReq, signup, newPool, setRole, cleanupOrg, launchBrowser, newAuthedContext,
} from "./helpers/uiTest.mjs";

function workbookBase64Rows(rows) {
  const source = [
    ["Ora di  Ricarica", "Numero Telefono", "Numero Telefono Temporaneo", "Importo Ricarica", "ID Transazione", "Canale di Vendite SAP"],
    ...rows,
  ];
  const worksheet = XLSX.utils.aoa_to_sheet(source);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "IC REPORT 1 - RECHARGES");
  return XLSX.write(workbook, { type: "base64", bookType: "xlsx" });
}

function workbookBase64(amount = "€10.00", transactionId = "AUTHZ-TX-1", supplier = "Vodafone Store") {
  return workbookBase64Rows([["12/09/26 15:10:00", "3471234567", "", amount, transactionId, supplier]]);
}

function windTreWorkbookBase64(transactionId = "AUTHZ-W3-KEY") {
  const rows = [
    ["Codice Ordine", "Keycode", "MSISDN", "ICCID", "Taglio ricarica", "Tipo ricarica", "Stato", "Data utilizzo", "PDV", "alias"],
    ["AUTHZ-W3-ORDER", transactionId, "3471234567", "8939880846057080279", 15, "VSC", "BURNED", "2026-10-09", "POS-W3", "Test"],
  ];
  const worksheet = XLSX.utils.aoa_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Report");
  return XLSX.write(workbook, { type: "base64", bookType: "xlsx" });
}

test("Analisi Ricariche: upload simultanei deduplicano solo per organizzazione e provider", async () => {
  const pool = await newPool();
  const orgA = await signup({ prefix: "ricariche_concurrent_a", fullName: "Ricariche concorrenti A" });
  const orgB = await signup({ prefix: "ricariche_concurrent_b", fullName: "Ricariche concorrenti B" });
  const brandIds = [];
  const transactionId = `CONCURRENT-${Date.now()}-${Math.random()}`;
  try {
    for (const [orgId, name] of [
      [orgA.orgId, `Vodafone concurrent ${Date.now()} ${Math.random()}`],
      [orgA.orgId, `WindTre concurrent ${Date.now()} ${Math.random()}`],
      [orgB.orgId, `Vodafone concurrent ${Date.now()} ${Math.random()}`],
    ]) {
      const brand = await pool.query("INSERT INTO brands (name) VALUES ($1) RETURNING id", [name]);
      const brandId = brand.rows[0].id;
      brandIds.push(brandId);
      await pool.query(
        "INSERT INTO organization_brands (organization_id,brand_id) VALUES ($1,$2)",
        [orgId, brandId],
      );
    }

    const upload = (user, provider, fileName, workbook) => jsonReq(`${BASE}/api/ricariche-analysis/upload`, {
      method: "POST",
      headers: { Cookie: user.cookieHeader },
      body: JSON.stringify({ provider, fileName, workbookBase64: workbook }),
    });
    const [sameScopeA, sameScopeB, otherOrganization, otherProvider] = await Promise.all([
      upload(orgA, "vodafone_fastweb", "concurrent-a.xlsx", workbookBase64("€10.00", transactionId)),
      upload(orgA, "vodafone_fastweb", "concurrent-b.xlsx", workbookBase64("€10.00", transactionId)),
      upload(orgB, "vodafone_fastweb", "concurrent-other-org.xlsx", workbookBase64("€10.00", transactionId)),
      upload(orgA, "windtre", "concurrent-other-provider.xlsx", windTreWorkbookBase64(transactionId)),
    ]);

    const sameScopeResults = [sameScopeA, sameScopeB];
    assert.deepEqual(
      sameScopeResults.map(result => result.status).sort(),
      [201, 409],
      `parallel uploads for the same organization/provider should save exactly one report: ${JSON.stringify(sameScopeResults)}`,
    );
    const duplicate = sameScopeResults.find(result => result.status === 409);
    assert.match(duplicate.body.message, /già caricate/i);
    assert.equal(duplicate.body.duplicatesSkipped, 1);
    for (const result of [otherOrganization, otherProvider]) {
      assert.equal(result.status, 201, JSON.stringify(result.body));
      assert.equal(result.body.rowCount, 1);
      assert.equal(result.body.duplicatesSkipped, 0);
    }

    const vodafoneA = await jsonReq(`${BASE}/api/ricariche-analysis?provider=vodafone_fastweb`, {
      headers: { Cookie: orgA.cookieHeader },
    });
    const vodafoneB = await jsonReq(`${BASE}/api/ricariche-analysis?provider=vodafone_fastweb`, {
      headers: { Cookie: orgB.cookieHeader },
    });
    const windTreA = await jsonReq(`${BASE}/api/ricariche-analysis?provider=windtre`, {
      headers: { Cookie: orgA.cookieHeader },
    });
    assert.equal(vodafoneA.body.reports.length, 1, "the concurrent duplicate must not create a second report");
    assert.equal(vodafoneB.body.reports.length, 1);
    assert.equal(windTreA.body.reports.length, 1);
    for (const [user, provider, reportId] of [
      [orgA, "vodafone_fastweb", vodafoneA.body.reports[0].id],
      [orgB, "vodafone_fastweb", vodafoneB.body.reports[0].id],
      [orgA, "windtre", windTreA.body.reports[0].id],
    ]) {
      const report = await jsonReq(
        `${BASE}/api/ricariche-analysis?provider=${provider}&reportId=${encodeURIComponent(reportId)}`,
        { headers: { Cookie: user.cookieHeader } },
      );
      assert.equal(report.status, 200, JSON.stringify(report.body));
      assert.deepEqual(report.body.rows.map(row => row.transactionId), [transactionId]);
    }
  } finally {
    await cleanupOrg(pool, orgA.orgId);
    await cleanupOrg(pool, orgB.orgId);
    if (brandIds.length) await pool.query("DELETE FROM brands WHERE id = ANY($1::uuid[])", [brandIds]).catch(() => {});
    await pool.end();
  }
});

test("WindTre API riconcilia ogni ricarica dello stesso scontrino senza duplicare gli importi", async () => {
  const pool = await newPool();
  const user = await signup({ prefix: "ricariche_w3_items", fullName: "Test WindTre Items" });
  let brandId;
  try {
    const brand = await pool.query("INSERT INTO brands (name) VALUES ($1) RETURNING id",
      [`WindTre items ${Date.now()} ${Math.random()}`]);
    brandId = brand.rows[0].id;
    await pool.query("INSERT INTO organization_brands (organization_id,brand_id) VALUES ($1,$2)", [user.orgId, brandId]);
    await pool.query(`INSERT INTO bisuite_sales
      (organization_id,bisuite_id,data_vendita,codice_pos,stato,totale,raw_data)
      VALUES ($1,901,'2026-10-09 23:59:00','POS-ANON','FINALIZZATA IN CASSA','46.00',$2::jsonb)`,
    [user.orgId, JSON.stringify({ articoli: [20, 15, 11].map((prezzo, i) => ({
      categoria: { nome: "RICARICHE" }, dettaglio: {
        prezzo: String(prezzo), domandeRisposte: [],
        venditaInfo1: `NUMERO TELEFONO: ${i < 2 ? "7000000001" : "7000000002"}`,
      },
    })) })]);
    const w = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(w, XLSX.utils.aoa_to_sheet([
      ["Codice Ordine", "Keycode", "MSISDN", "Taglio ricarica", "Tipo ricarica", "Stato", "Data utilizzo", "PDV"],
      ["ORDER", "KEY-1", "7000000001", 20, "VSC", "BURNED", "2026-10-09", "POS-ANON"],
      ["ORDER", "KEY-2", "7000000001", 15, "SIM ATTIVA", "BURNED", "2026-10-09", "POS-ANON"],
    ]), "Report");
    const headers = { Cookie: user.cookieHeader };
    const upload = await jsonReq(`${BASE}/api/ricariche-analysis/upload`, {
      method: "POST", headers, body: JSON.stringify({
        provider: "windtre", fileName: "anonymous-w3.xlsx",
        workbookBase64: XLSX.write(w, { type: "base64", bookType: "xlsx" }),
      }),
    });
    assert.equal(upload.status, 201, JSON.stringify(upload.body));
    const result = await jsonReq(`${BASE}/api/ricariche-analysis?provider=windtre&reportId=${upload.body.reportId}`, { headers });
    assert.equal(result.status, 200, JSON.stringify(result.body));
    assert.equal(result.body.rows.length, 2, "without a confirmed full period the API does not infer missing BiSuite sales");
    assert.equal(result.body.rows.filter(r => r.status === "NON PRESENTE SU FILE").length, 0);
    const confirm = await jsonReq(`${BASE}/api/ricariche-analysis/${upload.body.reportId}/period`, {
      method: "PUT",
      headers,
      body: JSON.stringify({
        provider: "windtre",
        declaredPeriodFrom: "2026-10-09",
        declaredPeriodTo: "2026-10-09",
      }),
    });
    assert.equal(confirm.status, 200, JSON.stringify(confirm.body));
    const confirmed = await jsonReq(`${BASE}/api/ricariche-analysis?provider=windtre&reportId=${upload.body.reportId}`, { headers });
    const rows = confirmed.body.rows;
    assert.equal(rows.length, 3);
    assert.equal(rows.filter(r => r.status === "VERIFICATO").length, 2);
    assert.equal(rows.filter(r => r.status === "NON PRESENTE SU FILE").length, 1);
    assert.ok(rows.every(r => r.saleId === "901"));
    assert.equal(new Set(rows.map(r => r.id)).size, 3);
    assert.equal(rows.reduce((n, r) => n + (r.bisuiteAmount ?? 0), 0), 46);
    assert.equal(rows.reduce((n, r) => n + (r.amount ?? 0), 0), 35);
  } finally {
    await cleanupOrg(pool, user.orgId);
    if (brandId) await pool.query("DELETE FROM brands WHERE id=$1", [brandId]);
    await pool.end();
  }
});

test("Analisi Ricariche API pagina le vendite per periodo mantenendo l'isolamento tra organizzazioni", async () => {
  const pool = await newPool();
  const orgA = await signup({ prefix: "ricariche_page_a", fullName: "Ricariche pagina A" });
  const orgB = await signup({ prefix: "ricariche_page_b", fullName: "Ricariche pagina B" });
  try {
    await pool.query(
      `INSERT INTO bisuite_sales
         (organization_id,bisuite_id,data_vendita,codice_pos,nome_cliente,stato,totale,raw_data)
       SELECT $1, 900000000 + n, '2026-09-12 12:00:00'::timestamp + (n || ' minutes')::interval,
         'POS-PAGE', 'Cliente ' || n, 'Completata', '1.00',
         jsonb_build_object('articoli', jsonb_build_array(jsonb_build_object(
           'categoria', jsonb_build_object('nome', 'RICARICHE'),
           'dettaglio', jsonb_build_object('prezzo', '1.00', 'telefono', '3471234' || lpad(n::text, 3, '0'))
         )))
       FROM generate_series(1, 101) AS n`,
      [orgA.orgId],
    );
    await pool.query(
      `INSERT INTO bisuite_sales
         (organization_id,bisuite_id,data_vendita,codice_pos,nome_cliente,stato,totale,raw_data)
       VALUES ($1,899999999,'2026-08-12 12:00:00','POS-OLDER','Fuori periodo','Completata','3.00',
         jsonb_build_object('articoli', jsonb_build_array(jsonb_build_object(
           'categoria', jsonb_build_object('nome', 'RICARICHE'),
           'dettaglio', jsonb_build_object('prezzo', '3.00', 'telefono', '3477000000')
         ))))`,
      [orgA.orgId],
    );
    await pool.query(
      `INSERT INTO bisuite_sales
         (organization_id,bisuite_id,data_vendita,codice_pos,nome_cliente,stato,totale,raw_data)
       VALUES ($1,901000001,'2026-09-12 13:00:00','POS-FOREIGN','Altro tenant','Completata','5.00',
         jsonb_build_object('articoli', jsonb_build_array(jsonb_build_object(
           'categoria', jsonb_build_object('nome', 'RICARICHE'),
           'dettaglio', jsonb_build_object('prezzo', '5.00', 'telefono', '3477654321')
         ))))`,
      [orgB.orgId],
    );
    const period = "from=2026-09-12&to=2026-09-12";
    const headersA = { Cookie: orgA.cookieHeader };
    const firstPage = await jsonReq(`${BASE}/api/ricariche-analysis?${period}&page=0`, { headers: headersA });
    assert.equal(firstPage.status, 200, JSON.stringify(firstPage.body));
    assert.equal(firstPage.body.rows.length, 100);
    assert.equal(firstPage.body.apiHasMore, true);
    assert.equal(firstPage.body.apiPage, 0);
    assert.equal(firstPage.body.apiRechargeCount, 101);
    assert.equal(firstPage.body.apiRechargeAmount, 101);

    const secondPage = await jsonReq(`${BASE}/api/ricariche-analysis?${period}&page=1`, { headers: headersA });
    assert.equal(secondPage.status, 200, JSON.stringify(secondPage.body));
    assert.equal(secondPage.body.rows.length, 1);
    assert.equal(secondPage.body.apiHasMore, false);
    assert.equal(secondPage.body.apiPage, 1);
    assert.equal(secondPage.body.apiRechargeCount, 101);
    assert.equal(secondPage.body.apiRechargeAmount, 101);
    assert.equal(new Set([...firstPage.body.rows, ...secondPage.body.rows].map(row => row.saleId)).size, 101);

    const otherOrganizationPage = await jsonReq(`${BASE}/api/ricariche-analysis?${period}`, {
      headers: { Cookie: orgB.cookieHeader },
    });
    assert.equal(otherOrganizationPage.status, 200, JSON.stringify(otherOrganizationPage.body));
    assert.deepEqual(otherOrganizationPage.body.rows.map(row => row.saleId), ["901000001"]);
    assert.equal(otherOrganizationPage.body.apiHasMore, false);
    assert.equal(otherOrganizationPage.body.apiRechargeCount, 1);
    assert.equal(otherOrganizationPage.body.apiRechargeAmount, 5);
    assert.equal((await jsonReq(`${BASE}/api/ricariche-analysis?from=2026-09-13&page=0`, { headers: headersA })).status, 400,
      "the API requires a complete date range");
  } finally {
    await cleanupOrg(pool, orgA.orgId);
    await cleanupOrg(pool, orgB.orgId);
    await pool.end();
  }
});

test("periodo report ricariche: conserva le righe esterne e applica i confini inclusivi", async () => {
  const pool = await newPool();
  const user = await signup({ prefix: "ricariche_period_boundary", fullName: "Test periodo ricariche" });
  let brandId;
  try {
    const brand = await pool.query("INSERT INTO brands (name) VALUES ($1) RETURNING id",
      [`WindTre periodo ${Date.now()} ${Math.random()}`]);
    brandId = brand.rows[0].id;
    await pool.query("INSERT INTO organization_brands (organization_id,brand_id) VALUES ($1,$2)", [user.orgId, brandId]);
    const sales = [
      ["2026-10-08 12:00:00", 901008, "7000000008", 8],
      ["2026-10-09 12:00:00", 901009, "7000000009", 9],
      ["2026-10-10 12:00:00", 901010, "7000000010", 10],
      ["2026-10-11 12:00:00", 901011, "7000000011", 11],
      ["2026-10-09 13:00:00", 901012, "7000000012", 12],
    ];
    for (const [date, bisuiteId, phone, amount] of sales) {
      await pool.query(
        `INSERT INTO bisuite_sales
          (organization_id,bisuite_id,data_vendita,codice_pos,stato,totale,raw_data)
         VALUES ($1,$2,$3,'POS-PERIOD','Completata',$4,$5::jsonb)`,
        [user.orgId, bisuiteId, date, String(amount), JSON.stringify({
          articoli: [{
            categoria: { nome: "RICARICHE" },
            dettaglio: { prezzo: String(amount) },
            telefono: phone,
          }],
        })],
      );
    }
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
      ["Codice Ordine", "Keycode", "MSISDN", "Taglio ricarica", "Tipo ricarica", "Stato", "Data utilizzo", "PDV"],
      ["ORDER", "PERIOD-08", "7000000008", 8, "VSC", "BURNED", "2026-10-08", "POS-PERIOD"],
      ["ORDER", "PERIOD-09", "7000000009", 9, "VSC", "BURNED", "2026-10-09", "POS-PERIOD"],
      ["ORDER", "PERIOD-10", "7000000010", 10, "VSC", "BURNED", "2026-10-10", "POS-PERIOD"],
      ["ORDER", "PERIOD-11", "7000000011", 11, "VSC", "BURNED", "2026-10-11", "POS-PERIOD"],
    ]), "Report");
    const headers = { Cookie: user.cookieHeader };
    const upload = await jsonReq(`${BASE}/api/ricariche-analysis/upload`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        provider: "windtre",
        fileName: "report-periodo.xlsx",
        workbookBase64: XLSX.write(workbook, { type: "base64", bookType: "xlsx" }),
      }),
    });
    assert.equal(upload.status, 201, JSON.stringify(upload.body));
    const confirm = await jsonReq(`${BASE}/api/ricariche-analysis/${upload.body.reportId}/period`, {
      method: "PUT",
      headers,
      body: JSON.stringify({
        provider: "windtre",
        declaredPeriodFrom: "2026-10-09",
        declaredPeriodTo: "2026-10-10",
      }),
    });
    assert.equal(confirm.status, 200, JSON.stringify(confirm.body));
    const result = await jsonReq(`${BASE}/api/ricariche-analysis?provider=windtre&reportId=${upload.body.reportId}`, { headers });
    assert.equal(result.status, 200, JSON.stringify(result.body));
    const rows = result.body.rows;
    assert.equal(rows.length, 5, "four original provider rows remain and one in-period BiSuite-only sale is included");
    assert.equal(rows.filter(row => row.status === "VERIFICATO").length, 2);
    assert.equal(rows.filter(row => row.status === "FUORI PERIODO").length, 2);
    assert.deepEqual(
      rows.filter(row => row.status === "FUORI PERIODO").map(row => row.transactionId).sort(),
      ["PERIOD-08", "PERIOD-11"],
    );
    assert.equal(rows.filter(row => row.status === "NON PRESENTE SU FILE").length, 1);
    assert.equal(rows.find(row => row.status === "NON PRESENTE SU FILE").date, "2026-10-09");
    assert.deepEqual(
      rows.filter(row => row.transactionId).map(row => row.transactionId).sort(),
      ["PERIOD-08", "PERIOD-09", "PERIOD-10", "PERIOD-11"],
      "all report rows are retained across the declared boundaries",
    );
  } finally {
    await cleanupOrg(pool, user.orgId);
    if (brandId) await pool.query("DELETE FROM brands WHERE id=$1", [brandId]).catch(() => {});
    await pool.end();
  }
});

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
          dettaglio: {
            prezzo: "10.00",
            venditaInfo1: "Numero Telefono: 3471234567",
          },
        }],
      })],
    );
    const otherTenantBisuiteId = bisuiteId + 1;
    await pool.query(
      `INSERT INTO bisuite_sales
         (organization_id,bisuite_id,data_vendita,codice_pos,nome_negozio,nome_cliente,
          stato,totale,raw_data)
       VALUES ($1,$2,'2026-09-12 16:10:00','POS-OTHER','Altro negozio','Altro cliente',
          'Completata','15.00',$3::jsonb)`,
      [orgB.orgId, otherTenantBisuiteId, JSON.stringify({
        articoli: [{
          categoria: { nome: "RICARICHE" },
          dettaglio: { prezzo: "15.00", venditaInfo1: "Numero Telefono: 3477654321" },
        }],
      })],
    );
    const windTreBisuiteId = otherTenantBisuiteId + 1;
    await pool.query(
      `INSERT INTO bisuite_sales
         (organization_id,bisuite_id,data_vendita,codice_pos,nome_negozio,nome_cliente,
           stato,totale,raw_data)
       VALUES ($1,$2,'2026-09-12 17:10:00','POS-W3','Negozio WindTre','Cliente WindTre',
           'Completata','6.25',$3::jsonb)`,
      [orgWindTre.orgId, windTreBisuiteId, JSON.stringify({
        articoli: [
          { categoria: { nome: "RICARICHE" }, dettaglio: { prezzo: "2,50", telefono: "3471111111" } },
          { categoria: { nome: "RICARICHE" }, dettaglio: { importo: "3.75", telefono: "3472222222" } },
          { categoria: { nome: "ACCESSORI" }, dettaglio: { prezzo: "99.00" } },
        ],
      })],
    );
    const syncedSales = await jsonReq(
      `${BASE}/api/bisuite-sales?from=2026-09-12&to=2026-09-12&includeAnnullate=true`,
      { headers: { Cookie: orgA.cookieHeader } },
    );
    assert.equal(syncedSales.status, 200, JSON.stringify(syncedSales.body));
    assert.ok(
      syncedSales.body.sales.some((sale) =>
        sale.bisuiteId === bisuiteId &&
        sale.rawData?.articoli?.[0]?.dettaglio?.venditaInfo1 === "Numero Telefono: 3471234567",
      ),
      "the synchronized-sale API must expose the RICARICHE rawData consumed by analysis",
    );
    await setRole(pool, orgA.profileId, "operatore");

    const path = "/api/ricariche-analysis";
    const headersA = { Cookie: orgA.cookieHeader };
    const deniedByWhitelist = await jsonReq(`${BASE}${path}`, { headers: headersA });
    assert.equal(deniedByWhitelist.status, 200, `default module access failed: ${JSON.stringify(deniedByWhitelist.body)}`);
    assert.deepEqual(deniedByWhitelist.body.allowedProviders, ["vodafone_fastweb"]);
    assert.equal((await jsonReq(`${BASE}${path}?provider=windtre`, { headers: headersA })).status, 403);
    const apiOnlyA = await jsonReq(`${BASE}${path}?provider=vodafone_fastweb&from=2026-09-12&to=2026-09-12`, { headers: headersA });
    assert.equal(apiOnlyA.status, 200, JSON.stringify(apiOnlyA.body));
    assert.equal(apiOnlyA.body.activeReportId, null);
    assert.equal(apiOnlyA.body.rows.length, 1);
    assert.equal(apiOnlyA.body.apiPage, 0);
    assert.equal(apiOnlyA.body.apiPageSize, 100);
    assert.equal(apiOnlyA.body.apiHasMore, false);
    assert.equal(apiOnlyA.body.apiRechargeCount, 1);
    assert.equal(apiOnlyA.body.apiRechargeAmount, 10);
    assert.deepEqual(apiOnlyA.body.apiPeriod, { from: "2026-09-12", to: "2026-09-12" });
    assert.equal(apiOnlyA.body.rows[0].status, "RICEVUTA VIA API");
    assert.equal(apiOnlyA.body.rows[0].saleId, String(bisuiteId));
    assert.equal(apiOnlyA.body.rows[0].bisuiteAmount, 10);
    const apiOnlyB = await jsonReq(`${BASE}${path}?from=2026-09-12&to=2026-09-12`, { headers: { Cookie: orgB.cookieHeader } });
    assert.equal(apiOnlyB.status, 200, JSON.stringify(apiOnlyB.body));
    assert.deepEqual(apiOnlyB.body.rows.map((row) => row.saleId), [String(otherTenantBisuiteId)]);
    assert.equal(apiOnlyB.body.apiRechargeCount, 1);
    assert.equal(apiOnlyB.body.apiRechargeAmount, 15);
    const windTreApi = await jsonReq(
      `${BASE}${path}?provider=windtre&from=2026-09-12&to=2026-09-12`,
      { headers: { Cookie: orgWindTre.cookieHeader } },
    );
    assert.equal(windTreApi.status, 200, JSON.stringify(windTreApi.body));
    assert.equal(windTreApi.body.rows.length, 2);
    assert.equal(windTreApi.body.apiRechargeCount, 2);
    assert.equal(windTreApi.body.apiRechargeAmount, 6.25);

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
    assert.equal(upload.body.rowCount, 1);

    const duplicateUpload = await jsonReq(`${BASE}${path}/upload`, {
      method: "POST",
      headers: headersA,
      body: JSON.stringify({
        provider: "vodafone_fastweb",
        fileName: "report-vf-duplicato.xlsx",
        workbookBase64: workbookBase64("€99.00", "AUTHZ-TX-1"),
      }),
    });
    assert.equal(duplicateUpload.status, 409);
    assert.match(duplicateUpload.body.message, /già caricate/i);
    assert.equal(duplicateUpload.body.duplicatesSkipped, 1);
    assert.equal((await jsonReq(`${BASE}${path}?provider=vodafone_fastweb`, { headers: headersA })).body.reports.length, 1,
      "an upload with only existing transaction IDs must not create a report");
    assert.equal((await jsonReq(`${BASE}${path}/${encodeURIComponent(reportId)}`, {
      method: "DELETE",
      headers: headersA,
    })).status, 403, "operators with module access cannot delete uploaded reports");

    const mixedUpload = await jsonReq(`${BASE}${path}/upload`, {
      method: "POST",
      headers: headersA,
      body: JSON.stringify({
        provider: "vodafone_fastweb",
        fileName: "report-vf-misto.xlsx",
        workbookBase64: workbookBase64Rows([
          ["12/09/26 15:10:00", "3471234567", "", "€99.00", "AUTHZ-TX-1", "Vodafone Store"],
          ["12/09/26 16:10:00", "3479999999", "", "€2.00", "AUTHZ-TX-3", "Vodafone Store"],
        ]),
      }),
    });
    assert.equal(mixedUpload.status, 201, JSON.stringify(mixedUpload.body));
    assert.equal(mixedUpload.body.rowCount, 1);
    assert.equal(mixedUpload.body.duplicatesSkipped, 1);
    const mixedReport = await jsonReq(
      `${BASE}${path}?provider=vodafone_fastweb&reportId=${encodeURIComponent(mixedUpload.body.reportId)}`,
      { headers: headersA },
    );
    assert.equal(mixedReport.status, 200, JSON.stringify(mixedReport.body));
    assert.deepEqual(mixedReport.body.rows.map(row => row.transactionId), ["AUTHZ-TX-3"]);

    const result = await jsonReq(
      `${BASE}${path}?provider=vodafone_fastweb&reportId=${encodeURIComponent(reportId)}`,
      { headers: headersA },
    );
    assert.equal(result.status, 200, JSON.stringify(result.body));
    assert.equal(result.body.rows.length, 1);
    assert.equal(result.body.rows[0].status, "VERIFICATO");
    assert.equal(result.body.rows[0].saleId, String(bisuiteId));
    assert.equal(result.body.rows[0].customer, "Cliente Test");
    assert.equal(result.body.rows[0].amount, 10);
    assert.equal(result.body.rows[0].supplier, "Vodafone");
    assert.equal(result.body.rows[0].bisuiteAmount, 10);
    assert.equal(result.body.rows[0].difference, 0);
    assert.equal(result.body.reports.some(report => report.id === reportId && report.fileName === "report-vf.xlsx"), true);

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
    assert.equal(latest.body.reports.length, 3);
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

    await setRole(pool, orgA.profileId, "admin");

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
      // Extra API-only rows make period, PDV and text filters change the totals independently.
      for (const [id, date, amount] of [
        [901100001, "2026-09-01 12:00:00", 7],
        [901100002, "2026-09-10 12:00:00", 8],
      ]) {
        await pool.query(`INSERT INTO bisuite_sales
          (organization_id,bisuite_id,data_vendita,codice_pos,nome_cliente,stato,totale,raw_data)
          VALUES ($1,$2,$3,'POS-EXTRA','Cliente extra','Completata',$4,$5::jsonb)`,
        [orgB.orgId, id, date, String(amount), JSON.stringify({
          articoli: [{ categoria: { nome: "RICARICHE" }, dettaglio: { prezzo: String(amount), telefono: "7000000099" } }],
        })]);
      }
      const apiContext = await newAuthedContext(browser, orgB);
      const apiPage = await apiContext.newPage();
      await apiPage.clock.setFixedTime(new Date("2026-09-12T18:00:00Z"));
      const initialRequest = apiPage.waitForRequest(req => req.url().includes("/api/ricariche-analysis?"));
      await apiPage.goto(`${BASE}/analisi-ricariche`, { waitUntil: "networkidle" });
      const initialUrl = new URL((await initialRequest).url());
      assert.equal(initialUrl.searchParams.get("from"), "2026-09-01");
      assert.equal(initialUrl.searchParams.get("to"), "2026-09-12");
      await apiPage.getByRole("heading", { name: "Ricariche da vendite BiSuite" }).waitFor({ state: "visible", timeout: 20000 });
      await apiPage.getByText(String(otherTenantBisuiteId), { exact: true }).waitFor({ state: "visible", timeout: 10000 });
      await apiPage.getByText("RICEVUTA VIA API", { exact: true }).first().waitFor({ state: "visible", timeout: 10000 });
      await apiPage.getByText("Importo ricarica", { exact: true }).waitFor({ state: "visible", timeout: 10000 });
      const fromFilter = apiPage.getByTestId("recharge-filter-from");
      const toFilter = apiPage.getByTestId("recharge-filter-to");
      const summary = apiPage.getByTestId("recharge-summaries");
      const count = apiPage.getByTestId("recharge-count").locator(".tabular-nums");
      const periodCount = apiPage.getByTestId("recharge-period-count");
      const periodAmount = apiPage.getByTestId("recharge-period-amount");
      const visibleAmount = apiPage.getByTestId("recharge-visible-amount");
      const checkSummary = async (rows, amount, periodRows, periodTotal) => {
        await apiPage.waitForFunction(({ rows, amount, periodRows, periodTotal }) => {
          const normalize = value => value?.replace(/\s/g, "");
          const cards = document.querySelector('[data-testid="recharge-summaries"]');
          return cards?.querySelector('[data-testid="recharge-period-count"]')?.textContent === periodRows
            && normalize(cards?.querySelector('[data-testid="recharge-period-amount"]')?.textContent) === `${periodTotal},00€`
            && cards?.querySelector('[data-testid="recharge-count"] .tabular-nums')?.textContent === rows
            && normalize(cards?.querySelector('[data-testid="recharge-visible-amount"]')?.textContent) === `${amount},00€`;
        }, { rows: String(rows), amount, periodRows: String(periodRows), periodTotal });
        assert.equal(await count.textContent(), String(rows));
        assert.equal((await visibleAmount.textContent()).replace(/\s/g, ""), `${amount},00€`);
        assert.equal(await periodCount.textContent(), String(periodRows));
        assert.equal((await periodAmount.textContent()).replace(/\s/g, ""), `${periodTotal},00€`);
        assert.equal(await apiPage.locator("tbody tr").count(), rows);
      };
      assert.equal(await fromFilter.inputValue(), "2026-09-01");
      assert.equal(await toFilter.inputValue(), "2026-09-12");
      assert.equal(await summary.getByText("Fonte dati", { exact: true }).count(), 0);
      assert.equal(await summary.getByText(/di \d+ operazioni/).count(), 0);
      await checkSummary(3, "30", 3, "30");
      await fromFilter.fill("2026-09-10");
      await checkSummary(2, "23", 3, "30");
      const applyResponse = apiPage.waitForResponse(res => res.url().includes("/api/ricariche-analysis?") && res.status() === 200);
      await apiPage.getByRole("button", { name: "Applica periodo" }).click();
      await applyResponse;
      await checkSummary(2, "23", 2, "23");
      // PDV, source, status and free text all feed the same visible rows and summaries.
      await apiPage.getByRole("combobox").nth(0).click();
      await apiPage.getByRole("option", { name: "POS-OTHER", exact: true }).click();
      await checkSummary(1, "15", 2, "23");
      await apiPage.getByRole("combobox").nth(1).click();
      await apiPage.getByRole("option", { name: "BiSuite API", exact: true }).click();
      await checkSummary(1, "15", 2, "23");
      await apiPage.getByPlaceholder("Cerca…").fill("nessuna corrispondenza");
      await checkSummary(0, "0", 2, "23");
      await apiPage.getByPlaceholder("Cerca…").fill("Altro cliente");
      await checkSummary(1, "15", 2, "23");
      await apiPage.getByRole("combobox").nth(2).click();
      await apiPage.getByRole("option", { name: "VERIFICATO", exact: true }).click();
      await checkSummary(0, "0", 2, "23");
      const resetResponse = apiPage.waitForResponse(res => res.url().includes("/api/ricariche-analysis?") && res.status() === 200);
      await apiPage.getByRole("button", { name: "Azzera filtri", exact: true }).first().click();
      await resetResponse;
      await checkSummary(3, "30", 3, "30");
      assert.equal(await fromFilter.inputValue(), "2026-09-01");
      assert.equal(await toFilter.inputValue(), "2026-09-12");
      assert.equal(await apiPage.getByPlaceholder("Cerca…").inputValue(), "");
      assert.equal(await apiPage.getByRole("button", { name: "Azzera filtri", exact: true }).count(), 0);
      await toFilter.fill("2026-09-10");
      await checkSummary(2, "15", 3, "30");
      await apiPage.getByRole("button", { name: "Azzera filtri", exact: true }).click();
      await checkSummary(3, "30", 3, "30");
      await apiContext.close();

      const context = await newAuthedContext(browser, orgA);
      const page = await context.newPage();
      await page.goto(`${BASE}/analisi-ricariche`, { waitUntil: "networkidle" });
      await page.getByRole("heading", { name: "Analisi ricariche" }).waitFor({ state: "visible", timeout: 20000 });
      await page.getByText("INCONGRUENZA IMPORTO", { exact: true }).waitFor({ state: "visible", timeout: 10000 });
      assert.equal(await page.getByTestId("recharge-filter-from").inputValue(), "");
      assert.equal(await page.getByTestId("recharge-filter-to").inputValue(), "");
      assert.equal(await page.getByTestId("recharge-summaries").getByText("Totale BiSuite", { exact: true }).count(), 1);
      const periodEditor = page.getByTestId("declared-period-editor");
      await page.getByText(/Periodo non confermato/).waitFor({ state: "visible", timeout: 10000 });
      await page.getByTestId("report-period-from").fill("2026-09-12");
      await page.getByTestId("report-period-to").fill("2026-09-12");
      await periodEditor.getByRole("button", { name: "Conferma periodo" }).click();
      await page.getByText(/Periodo dichiarato:/).waitFor({ state: "visible", timeout: 10000 });
      assert.equal(await page.getByTestId("nav-gara-analisi-ricariche").count(), 1);
      assert.equal(await page.getByTestId("nav-amministrazione").count(), 0);
      await page.getByTestId("recharge-filter-from").fill("2026-09-13");
      await page.getByTestId("recharge-filter-to").fill("2026-09-15");
      await page.getByText("Nessun report caricato nel periodo selezionato.").waitFor({ state: "visible", timeout: 10000 });
      await page.getByRole("button", { name: "Azzera filtri", exact: true }).first().click();
      await page.getByRole("button", { name: /report-vf-successivo\.xlsx/ }).first().waitFor({ state: "visible", timeout: 10000 });
      const deleteDialog = new Promise((resolve, reject) => {
        page.once("dialog", async dialog => {
          try {
            assert.equal(dialog.type(), "confirm");
            resolve(dialog.message());
            await dialog.accept();
          } catch (error) {
            reject(error);
          }
        });
      });
      const deleteResponse = page.waitForResponse(res =>
        res.url().includes(`/api/ricariche-analysis/${encodeURIComponent(secondUpload.body.reportId)}`) &&
        res.request().method() === "DELETE",
      );
      await page.getByRole("button", { name: "Elimina report report-vf-successivo.xlsx" }).click();
      assert.match(await deleteDialog, /report-vf-successivo\.xlsx/);
      assert.equal((await deleteResponse).status(), 200);
      await page.getByRole("button", { name: /report-vf-successivo\.xlsx/ }).first().waitFor({ state: "detached", timeout: 10000 });
      await page.getByRole("button", { name: /report-vf\.xlsx/ }).first().click();
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

      const sameIdOtherTenant = await jsonReq(`${BASE}${path}/upload`, {
        method: "POST",
        headers: { Cookie: orgB.cookieHeader },
        body: JSON.stringify({
          provider: "vodafone_fastweb",
          fileName: "stesso-id-altro-tenant.xlsx",
          workbookBase64: workbookBase64("€10.00", "AUTHZ-TX-1"),
        }),
      });
      assert.equal(sameIdOtherTenant.status, 201, "transaction IDs are unique only inside an organization and provider");
      assert.equal((await jsonReq(`${BASE}${path}/${encodeURIComponent(reportId)}`, {
        method: "DELETE",
        headers: { Cookie: orgB.cookieHeader },
      })).status, 404, "an admin cannot delete another organization's report");
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
