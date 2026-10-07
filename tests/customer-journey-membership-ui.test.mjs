import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import XLSX from "xlsx";
import {
  BASE, signup, newPool, launchBrowser, newAuthedContext, setCjTriggerDate,
  seedJourney, addJourneyItem, cleanupOrg,
} from "./helpers/uiTest.mjs";

test("CJ membership panels separate cards, date filters, navigation and Excel", async () => {
  const pool = await newPool();
  const session = await signup({ prefix: "cj_membership" });
  const browser = await launchBrowser();
  try {
    await setCjTriggerDate(pool, session.orgId, "2026-07-01");
    const active = await seedJourney(pool, session.orgId, {
      customerKey: "MEMBER-ACTIVE", nome: "Cliente attivo",
      openedAt: "2026-07-01", items: [
        { driver: "mobile", categoria: "UNTIED", dataInserimento: "2026-07-05" },
      ],
    });
    const exited = await seedJourney(pool, session.orgId, {
      customerKey: "MEMBER-EXITED", nome: "Cliente uscito",
      openedAt: "2026-07-01", items: [
        { driver: "mobile", categoria: "UNTIED", dataInserimento: "2026-07-15" },
        { driver: "fisso", dataInserimento: "2026-07-20" },
      ],
    });
    await pool.query(`UPDATE customer_journey_items SET economic_state='stornato'
      WHERE journey_id=$1 AND driver='mobile'`, [exited]);
    const lost = await addJourneyItem(pool, session.orgId, active, {
      driver: "mobile", categoria: "UNTIED", dataInserimento: "2026-07-07",
    });
    await pool.query(`UPDATE customer_journey_items SET economic_state='annullato' WHERE id=$1`, [lost]);
    const context = await newAuthedContext(browser, session);
    const page = await context.newPage();
    await page.goto(`${BASE}/customer-journey`, { waitUntil: "networkidle" });
    const card = id => page.getByTestId(`card-journey-${id}`);
    await card(active).waitFor({ state: "visible" });
    assert.equal(await card(exited).count(), 0, "nonqualified must not appear among active cards");
    await page.getByTestId("cj-membership-inactive").click();
    await card(exited).waitFor({ state: "visible" });
    assert.equal(await card(active).count(), 0, "other valid SIM keeps active client out of inactive panel");
    const downloadPending = page.waitForEvent("download");
    await page.getByTestId("button-export-list-excel").click();
    const download = await downloadPending;
    const workbook = XLSX.read(fs.readFileSync(await download.path()), { type: "buffer" });
    const exported = JSON.stringify(workbook.SheetNames.map(name => XLSX.utils.sheet_to_json(workbook.Sheets[name])));
    assert.match(exported, /Cliente uscito/);
    assert.doesNotMatch(exported, /Cliente attivo/);
    await page.getByTestId("input-schede-date-from").fill("2026-07-11");
    await page.getByTestId("input-schede-date-to").fill("2026-07-31");
    await card(exited).waitFor({ state: "visible" });
    await page.getByTestId("cj-membership-active").click();
    await card(active).waitFor({ state: "hidden" });
    await page.getByTestId("input-schede-date-from").fill("");
    await page.getByTestId("input-schede-date-to").fill("");
    await card(active).waitFor({ state: "visible" });
    await page.getByTestId("cj-membership-inactive").click();
    await card(exited).click();
    await page.getByTestId("button-back").click();
    await card(exited).waitFor({ state: "visible" });
    await page.getByRole("button", { name: "Reportistica", exact: true }).click();
    await page.getByRole("button", { name: "Coorti mensili", exact: true }).click();
    const panel = page.getByTestId("cohort-clients-panel");
    await page.getByTestId("cohort-clients-active").click();
    await panel.getByText("Cliente attivo", { exact: true }).waitFor();
    assert.equal(await panel.getByText("Cliente uscito", { exact: true }).count(), 0);
    await page.getByTestId("cohort-clients-inactive").click();
    await panel.getByText("Cliente uscito", { exact: true }).waitFor();
    assert.equal(await panel.getByText("Cliente attivo", { exact: true }).count(), 0);
    const cohortDownloadPending = page.waitForEvent("download");
    await page.getByTestId("cohort-report").getByTestId("export").click();
    const cohortBook = XLSX.read(fs.readFileSync(await (await cohortDownloadPending).path()), { type: "buffer" });
    assert.match(JSON.stringify(XLSX.utils.sheet_to_json(cohortBook.Sheets["Clienti attivi"])), /Cliente attivo/);
    assert.doesNotMatch(JSON.stringify(XLSX.utils.sheet_to_json(cohortBook.Sheets["Clienti attivi"])), /Cliente uscito/);
    assert.match(JSON.stringify(XLSX.utils.sheet_to_json(cohortBook.Sheets["Non più qualificati"])), /Cliente uscito/);
    await page.setViewportSize({ width: 375, height: 812 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    await page.screenshot({ path: "/tmp/cj-membership-mobile.png" });
    await context.close();
  } finally {
    await browser.close();
    await cleanupOrg(pool, session);
    await pool.end();
  }
});
