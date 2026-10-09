import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { build } from "esbuild";
import { BASE, signup, newPool, launchBrowser, cleanupOrg, jsonReq, setCjTriggerDate } from "./helpers/uiTest.mjs";

const endpoint = "/api/customer-journeys/report-mobile-sources";
const rowIds = ["cj-sim-source-row", "cj-sim-outcome-row", "cj-sim-gettone-row"];
const defer = () => {
  let resolve;
  const promise = new Promise(r => { resolve = r; });
  return { promise, resolve };
};

async function seed(pool, orgId) {
  await setCjTriggerDate(pool, orgId, "2026-01-01");
  await pool.query(`INSERT INTO bisuite_sales
    (organization_id,bisuite_id,data_vendita,nome_cliente,nome_addetto,stato,raw_data)
    SELECT $1,n,'2026-07-02','Cliente SIM '||n,'MARIO','INSERITA',jsonb_build_object(
      'cliente',jsonb_build_object('codiceFiscale','CF'||n,'nome','Cliente SIM '||n),
      'addetto',jsonb_build_object('nominativo','MARIO'),
      'attivita',jsonb_build_object('nominativo','Negozio'),
      'articoli',jsonb_build_array(jsonb_build_object('id',1,
        'categoria',jsonb_build_object('nome','UNTIED'),
        'tipologia',jsonb_build_object('nome','VOCE'),'descrizione','SIM '||n)))
    FROM generate_series(1,101) n`, [orgId]);
  await pool.query(`INSERT INTO customer_journeys
    (id,organization_id,customer_key,customer_type,nome,opened_at,trigger_sale_id)
    SELECT id,$1::varchar,'CF'||bisuite_id,'privato',nome_cliente,'2026-07-02',id
    FROM bisuite_sales WHERE organization_id=$1`, [orgId]);
  await pool.query(`INSERT INTO customer_journey_items
    (organization_id,journey_id,driver,bisuite_sale_id,bisuite_id,bisuite_article_id,
     categoria,tipologia,descrizione,addetto,pdv_destinazione,state,
     data_inserimento,data_attivazione,economic_state,drms_outcome_state)
    SELECT $1::varchar,id,'mobile',id,bisuite_id,1,'UNTIED','VOCE','SIM '||bisuite_id,
      'MARIO','Negozio','inserito','2026-07-02','2026-07-02','pagato','pagato'
    FROM bisuite_sales WHERE organization_id=$1`, [orgId]);
}

// Real React Query lifecycle + real endpoint/version computation. The only
// interception forwards authenticated HTTP and can pause a response; it never
// fabricates diagnostics, snapshots, errors or reconciliation.
test("SIM diagnostics blocks DB changes on new and previously cached pages", { timeout: 120000 }, async t => {
  const bundle = await build({
    entryPoints: ["tests/fixtures/sim-diagnostics-version-ui.tsx"], bundle: true, write: false,
    platform: "browser", format: "esm", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"development"' },
  });
  const server = createServer((req, res) => {
    res.writeHead(200, { "Content-Type": req.url === "/harness.js" ? "text/javascript" : "text/html" });
    res.end(req.url === "/harness.js" ? bundle.outputFiles[0].text :
      '<!doctype html><html><body><div id="root"></div><script type="module" src="/harness.js"></script></body></html>');
  });
  let browser, pool;
  try {
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    pool = await newPool();
    browser = await launchBrowser();
    for (const mutation of ["insert", "delete"]) {
      for (const cached of [false, true]) {
        await t.test(`${mutation}: ${cached ? "return to cached page two" : "new page two"}`, async () => {
          let session, page, held, gate;
          const requests = [], errors = [], downloads = [];
          try {
            session = await signup({ prefix: "cj_sim_version_ui" });
            await seed(pool, session.orgId);
            page = await browser.newPage();
            page.on("pageerror", error => errors.push(error.message));
            page.on("download", download => downloads.push(download.suggestedFilename()));
            await page.route(`**${endpoint}?*`, async route => {
              const url = new URL(route.request().url());
              const record = { detail: url.searchParams.get("detail") === "1",
                page: Number(url.searchParams.get("page")), version: url.searchParams.get("version") };
              requests.push(record);
              const gate = record.detail ? held : null;
              if (gate) {
                held = null;
                gate.started.resolve(record);
                await gate.promise;
              }
              const result = await jsonReq(`${BASE}${url.pathname}${url.search}`, {
                headers: { Cookie: session.cookieHeader },
              });
              record.status = result.status;
              record.body = result.body;
              await route.fulfill({ status: result.status, json: result.body });
            });
            const card = page.getByTestId("cj-sim-diagnostics");
            const exportButton = card.getByTestId("cj-sim-diagnostics-export");
            const waitRows = async (count = 50) => {
              await page.waitForFunction(count => document.querySelectorAll(
                '[data-testid="cj-sim-source-row"]').length === count, count);
              for (const id of rowIds) assert.equal(await card.getByTestId(id).count(), 50, id);
            };
            const assertPageOne = async () => {
              await card.getByText("Pagina 1 di", { exact: false }).waitFor();
              assert.equal(await card.getByRole("button", { name: "Precedente", exact: true }).isDisabled(), true);
            };
            await page.goto(`http://127.0.0.1:${server.address().port}`, { waitUntil: "load" });
            await card.getByText("Articoli nel perimetro: 101", { exact: true }).waitFor();
            assert.equal(requests.length, 1, "summary only until detail is opened");
            const baseline = requests[0].body;
            assert.equal(baseline.diagnostics.period, 101);
            await card.getByRole("button", { name: "Mostra contratti e articoli", exact: true }).click();
            await waitRows();
            await assertPageOne();
            const firstPage = requests.at(-1).body;
            if (cached) {
              await card.getByRole("button", { name: "Successiva", exact: true }).click();
              await waitRows();
              await card.getByRole("button", { name: "Precedente", exact: true }).click();
              await waitRows();
              await assertPageOne();
              assert.ok(requests.some(r => r.detail && r.page === 1 && r.status === 200),
                "page two must have been populated in the same React Query cache");
            }
            if (mutation === "insert") {
              // Sort before all existing UUIDs so every offset shifts.
              const id = `00000000-0000-0000-0000-${session.orgId.replaceAll("-", "").slice(-12)}`;
              await pool.query(`INSERT INTO bisuite_sales
                (id,organization_id,bisuite_id,data_vendita,nome_cliente,nome_addetto,raw_data)
                VALUES ($1,$2,9999,'2026-07-02','Nuova SIM','MARIO',
                  '{"cliente":{"codiceFiscale":"CF9999","nome":"Nuova SIM"},
                    "articoli":[{"id":1,"categoria":{"nome":"UNTIED"},"tipologia":{"nome":"VOCE"}}]}')`,
              [id, session.orgId]);
            } else {
              await pool.query("DELETE FROM bisuite_sales WHERE organization_id=$1 AND id=$2",
                [session.orgId, firstPage.details[0].source.saleId]);
            }

            const before = requests.length;
            gate = { ...defer(), started: defer() };
            held = gate;
            const navigating = page.waitForRequest(req => {
              const url = new URL(req.url());
              return url.pathname === endpoint && url.searchParams.get("detail") === "1"
                && url.searchParams.get("page") === "1";
            });
            await card.getByRole("button", { name: "Successiva", exact: true }).click();
            await navigating;
            const request = await gate.started.promise;
            assert.equal(request.page, 1);
            assert.equal(request.version, baseline.version);
            // A cached page must be revalidated, with no source rows or usable
            // download while the request is still pending.
            assert.equal(await card.getByTestId("cj-sim-source-row").count(), 0);
            assert.equal(await exportButton.isDisabled(), true);
            gate.resolve();
            await card.getByRole("alert").getByText(
              "I dati vendite o CJ sono cambiati durante la consultazione.", { exact: false }).waitFor();
            const rejected = requests.slice(before);
            assert.equal(rejected.length, 1, "version mismatch is not retried or auto-reloaded");
            assert.equal(rejected[0].status, 409);
            assert.equal(rejected[0].body.code, "CJ_DIAGNOSTICS_CHANGED");
            assert.equal(await exportButton.count(), 0, "no stale download control");
            assert.equal(await card.locator("dl").count(), 0, "no stale totals");
            assert.equal(await card.getByText("Articoli nel perimetro:", { exact: false }).count(), 0);
            assert.equal(await card.getByText("Gettone calcolato", { exact: false }).count(), 0);
            assert.equal(await card.getByTestId("cj-sim-detail").count(), 0);
            for (const id of rowIds) assert.equal(await card.getByTestId(id).count(), 0, `no stale ${id}`);
            assert.deepEqual(downloads, []);

            const reloadStart = requests.length;
            await card.getByRole("button", { name: "Ricarica diagnostica", exact: true }).click();
            const total = mutation === "insert" ? 102 : 100;
            await card.getByText(`Articoli nel perimetro: ${total}`, { exact: true }).waitFor();
            await waitRows();
            await assertPageOne();
            assert.equal(await exportButton.isEnabled(), true);
            assert.equal(await card.getByRole("alert").count(), 0);
            const reloaded = requests.slice(reloadStart);
            assert.deepEqual(reloaded.map(r => [r.detail, r.page, r.status]), [[false, 0, 200], [true, 0, 200]],
              "reload fetches a fresh summary and page one, never the stale page two");
            assert.equal(reloaded[0].version, null);
            assert.notEqual(reloaded[0].body.version, baseline.version);
            assert.equal(reloaded[1].version, reloaded[0].body.version);
            assert.equal(reloaded[1].body.sourceTotal, total);
            const visibleSources = await card.getByTestId("cj-sim-source-row").allTextContents();
            assert.deepEqual(visibleSources.map(text => Number(text.match(/Vendita (\d+)/)[1])),
              reloaded[1].body.details.map(d => d.source.bisuiteId), "rendered rows match the new page-one snapshot");
            // Explicit reload remains read-only: insertion does not create a
            // journey; deletion does not prune any existing CJ rows.
            for (const table of ["customer_journeys", "customer_journey_items"]) {
              const result = await pool.query(`SELECT count(*)::int n FROM ${table} WHERE organization_id=$1`, [session.orgId]);
              assert.equal(result.rows[0].n, 101, `${table}: no implicit reconciliation`);
            }
            assert.deepEqual(errors, []);
          } finally {
            gate?.resolve();
            await page?.close();
            if (session) await cleanupOrg(pool, session);
          }
        });
      }
    }
  } finally {
    await browser?.close();
    await pool?.end();
    if (server.listening) await new Promise(resolve => server.close(resolve));
  }
});
