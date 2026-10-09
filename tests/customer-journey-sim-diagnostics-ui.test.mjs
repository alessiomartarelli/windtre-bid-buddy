import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { build } from "esbuild";
import { launchBrowser } from "./helpers/uiTest.mjs";
import { buildGettoneJourneys, filterGettoneByInsertDate } from "../shared/customerJourney.ts";
import { matchesDiagnosticFilters, paginateCjMobileSources, reconcileCjMobile } from "../shared/customerJourneyDiagnostics.ts";
import { createHash } from "node:crypto";
import { rows, sources } from "./fixtures/sim-diagnostics-data.mjs";

const rowIds = ["cj-sim-source-row", "cj-sim-outcome-row", "cj-sim-gettone-row"];
const defer = () => {
  let resolve;
  const promise = new Promise(r => { resolve = r; });
  return { promise, resolve };
};

// Test the actual component in a real browser without login/DB/reconcile side effects.
// The API fixture uses the production classifier/paginator, not pre-sliced canned rows.
test("SIM diagnostics: React pagination, context changes and retry", { timeout: 90000 }, async t => {
  const bundle = await build({
    entryPoints: ["tests/fixtures/sim-diagnostics-ui.tsx"], bundle: true, write: false,
    platform: "browser", format: "esm", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"development"' },
  });
  const server = createServer((req, res) => {
    if (req.url === "/harness.js") {
      res.writeHead(200, { "Content-Type": "text/javascript" });
      res.end(bundle.outputFiles[0].text);
    } else {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end('<!doctype html><html><body><div id="root"></div><script type="module" src="/harness.js"></script></body></html>');
    }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  let browser;
  try {
    browser = await launchBrowser();
    const base = `http://127.0.0.1:${server.address().port}`;
    async function fixture(st, { failSummary = false } = {}) {
      const page = await browser.newPage();
      const requests = [], errors = [], gates = [];
      const control = { failSummary, failDetail: false, holdNextDetail: null };
      page.on("pageerror", error => errors.push(error.message));
      await page.route("**/api/customer-journeys/report-mobile-sources?*", async route => {
        const url = new URL(route.request().url());
        const f = JSON.parse(url.searchParams.get("filters"));
        const from = url.searchParams.get("from"), to = url.searchParams.get("to");
        const detail = url.searchParams.get("detail") === "1";
        const index = Number(url.searchParams.get("page"));
        const record = { detail, page: index, from, to, filters: f };
        requests.push(record);
        const gate = detail ? control.holdNextDetail : null;
        if (gate) {
          control.holdNextDetail = null;
          gate.request = record;
          gate.started.resolve();
          await gate.promise;
        }
        const fail = detail ? control.failDetail : control.failSummary;
        if (detail) control.failDetail = false;
        else control.failSummary = false;
        if (fail) {
          await route.fulfill({ status: 503, json: { message: "Injected test failure" } });
          return;
        }
        const filteredRows = rows.filter(r => matchesDiagnosticFilters(r, f));
        const selected = filterGettoneByInsertDate(buildGettoneJourneys(filteredRows), from, to);
        async function* batches() { yield sources; }
        const body = await paginateCjMobileSources(batches(), filteredRows, selected, f, from, to, index, 50, detail);
        body.version = createHash("sha256").update(JSON.stringify({ f, from, to, rows, sources })).digest("hex");
        if (!detail) {
          body.diagnostics = reconcileCjMobile([], rows, selected, f, from, to);
          body.diagnostics.counts = body.counts;
          body.diagnostics.sourceTotal = body.sourceTotal;
          body.diagnostics.discrepancy = body.diagnostics.period - body.counts.admitted;
        } else {
          assert.equal(url.searchParams.get("version"), body.version, "detail must validate its summary version");
        }
        record.body = body;
        await route.fulfill({ json: body }).catch(() => {}); // A changed context can abort a held request.
        gate?.finished.resolve();
      });
      await page.goto(base, { waitUntil: "load" });
      await page.getByTestId("cj-sim-diagnostics").waitFor();
      // Record the largest rendered section, including transient renders.
      await page.evaluate(ids => {
        window.sectionMax = Object.fromEntries(ids.map(id => [id, 0]));
        const observe = () => ids.forEach(id => {
          window.sectionMax[id] = Math.max(window.sectionMax[id], document.querySelectorAll(`[data-testid="${id}"]`).length);
        });
        new MutationObserver(observe).observe(document.getElementById("root"), { subtree: true, childList: true });
        observe();
      }, rowIds);
      const card = page.getByTestId("cj-sim-diagnostics");
      const section = id => page.getByTestId(id);
      const hold = () => {
        const gate = { ...defer(), started: defer(), finished: defer() };
        gates.push(gate);
        control.holdNextDetail = gate;
        return gate;
      };
      const waitRows = async (count, first) => {
        await page.waitForFunction(({ count, first }) => {
          const els = document.querySelectorAll('[data-testid="cj-sim-source-row"]');
          return els.length === count && (!first || els[0]?.textContent.includes(first));
        }, { count, first });
        for (const id of rowIds) assert.equal(await section(id).count(), count, `${id}: exactly one bounded page`);
      };
      const pageNumber = async n => {
        await card.getByText(`Pagina ${n} di`, { exact: false }).waitFor();
        if (n === 1) assert.equal(await card.getByRole("button", { name: "Precedente", exact: true }).isDisabled(), true);
      };
      const open = async () => {
        await card.getByRole("button", { name: "Mostra contratti e articoli", exact: true }).click();
        await pageNumber(1);
      };
      const next = async () => {
        await card.getByRole("button", { name: "Successiva", exact: true }).click();
        await pageNumber(2);
      };
      const close = async () => {
        gates.forEach(gate => gate.resolve());
        assert.deepEqual(errors, [], "no React/browser runtime errors");
        const max = await page.evaluate(() => window.sectionMax);
        for (const id of rowIds) assert.ok(max[id] <= 50, `${id}: never render over 50 rows`);
        for (const req of requests) {
          if (!req.detail) {
            assert.equal(req.page, 0, "summary must always request page zero");
            if (req.body) assert.deepEqual(req.body.details, [], "summary must never download details");
          } else if (req.body) assert.ok(req.body.details.length <= 50);
        }
        await page.close();
      };
      st.after(close);
      return { page, card, control, requests, section, hold, waitRows, pageNumber, open, next };
    }

    await t.test("summary is lazy; every section is bounded; close/reopen resets to page one", async st => {
      const f = await fixture(st);
      await f.card.getByText("Articoli nel perimetro: 123", { exact: true }).waitFor();
      assert.equal(f.requests.length, 1);
      assert.equal(f.requests[0].detail, false);
      assert.equal(await f.page.getByTestId("cj-sim-detail").count(), 0);
      await f.open();
      await f.waitRows(50, "LUGLIO-001");
      await f.next();
      await f.waitRows(50, "LUGLIO-051");
      await f.card.getByRole("button", { name: "Successiva", exact: true }).click();
      await f.pageNumber(3);
      await f.waitRows(23, "LUGLIO-101");
      assert.equal(await f.card.getByRole("button", { name: "Successiva", exact: true }).isDisabled(), true);
      await f.card.getByRole("button", { name: "Precedente", exact: true }).click();
      await f.pageNumber(2);
      await f.waitRows(50, "LUGLIO-051");
      await f.card.getByRole("button", { name: "Nascondi contratti e articoli", exact: true }).click();
      assert.equal(await f.page.getByTestId("cj-sim-detail").count(), 0);
      await f.open();
      await f.waitRows(50, "LUGLIO-001");
      await f.card.getByRole("button", { name: "Nascondi contratti e articoli", exact: true }).click();
      const detailRequests = f.requests.filter(r => r.detail).length;
      await f.page.getByLabel("Cerca", { exact: true }).fill("LUGLIO");
      await f.card.getByText("Articoli nel perimetro: 123", { exact: true }).waitFor();
      assert.equal(f.requests.filter(r => r.detail).length, detailRequests, "changing filters while closed must not fetch details");
      await f.open();
      await f.waitRows(50, "LUGLIO-001");
    });

    await t.test("dates, PDV, addetto, search and returning to an old context immediately reset page", async st => {
      const f = await fixture(st);
      await f.card.getByText("Articoli nel perimetro: 123", { exact: true }).waitFor();
      await f.open();
      await f.waitRows(50, "LUGLIO-001");
      const changes = [
        [() => f.page.getByLabel("Al", { exact: true }).fill("2026-08-31"), "LUGLIO-001", 369],
        [() => f.page.getByLabel("Dal", { exact: true }).fill("2026-08-01"), "AGOSTO-001", 246],
        [() => f.page.getByLabel("PDV", { exact: true }).selectOption("Milano"), "MILANO-001", 123],
        [() => f.page.getByLabel("Addetto", { exact: true }).selectOption("Luigi"), "MILANO-001", 123],
        [() => f.page.getByLabel("Cerca", { exact: true }).fill("MILANO"), "MILANO-001", 123],
        [() => f.page.getByRole("button", { name: "Ripristina contesto", exact: true }).click(), "LUGLIO-001", 123],
      ];
      for (const [change, first, total] of changes) {
        await f.next();
        await f.waitRows(50);
        const oldFirst = await f.section("cj-sim-source-row").first().textContent();
        const gate = f.hold();
        await change();
        await gate.started.promise;
        await f.pageNumber(1);
        assert.equal(gate.request.page, 0, "new context must request page zero before the response arrives");
        // Returning to the initial context may display cached page-one data, but never page two.
        const sourceCount = await f.section("cj-sim-source-row").count();
        if (sourceCount) assert.ok((await f.section("cj-sim-source-row").first().textContent()).includes(first));
        else assert.equal(sourceCount, 0, "no source rows from previous context while loading");
        assert.equal(await f.card.getByText(oldFirst, { exact: true }).count(), 0);
        assert.ok((await f.section("cj-sim-outcome-row").first().textContent()).includes(first), "local outcomes also immediately reset");
        assert.ok((await f.section("cj-sim-gettone-row").first().textContent()).includes(first), "local gettoni also immediately reset");
        gate.resolve();
        await f.waitRows(50, first);
        await f.card.getByText(`Articoli nel perimetro: ${total}`, { exact: true }).waitFor();
      }
    });

    await t.test("summary and detail errors have a working Riprova; late old response cannot overwrite new context", async st => {
      const f = await fixture(st, { failSummary: true });
      const summaryAlert = f.card.getByRole("alert");
      await summaryAlert.getByText("Dettaglio SIM non disponibile", { exact: false }).waitFor();
      assert.equal(await f.card.getByTestId("cj-sim-diagnostics-export").isDisabled(), true);
      assert.equal(f.requests.some(r => r.detail), false);
      await summaryAlert.getByRole("button", { name: "Riprova" }).click();
      await f.card.getByText("Articoli nel perimetro: 123", { exact: true }).waitFor();
      assert.equal(await f.card.getByTestId("cj-sim-diagnostics-export").isDisabled(), false);
      f.control.failDetail = true;
      await f.open();
      const detailAlert = f.card.getByRole("alert");
      await detailAlert.getByText("Pagina non disponibile.", { exact: false }).waitFor();
      assert.equal(await f.section("cj-sim-source-row").count(), 0);
      const retryGate = f.hold();
      await detailAlert.getByRole("button", { name: "Riprova" }).click();
      await retryGate.started.promise;
      await f.pageNumber(1);
      retryGate.resolve();
      await f.waitRows(50, "LUGLIO-001");
      // Hold page two, then change the filter before that response completes.
      const staleGate = f.hold();
      await f.next();
      await staleGate.started.promise;
      await f.page.getByLabel("Cerca", { exact: true }).fill("LUGLIO-0");
      await f.pageNumber(1);
      await f.waitRows(50, "LUGLIO-001");
      staleGate.resolve();
      await staleGate.finished.promise;
      await f.page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      await f.page.waitForFunction(() => !document.body.textContent.includes("Caricamento pagina"));
      await f.pageNumber(1);
      await f.waitRows(50, "LUGLIO-001");
      // A page-two failure must not display the previous source page; retry stays on page two.
      f.control.failDetail = true;
      await f.next();
      await f.card.getByRole("alert").getByText("Pagina non disponibile.", { exact: false }).waitFor();
      assert.equal(await f.section("cj-sim-source-row").count(), 0);
      await f.card.getByRole("alert").getByRole("button", { name: "Riprova" }).click();
      await f.waitRows(49, "LUGLIO-051");
      await f.pageNumber(2);
    });
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
});
