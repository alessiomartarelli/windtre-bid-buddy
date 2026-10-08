import { test } from "node:test";
import assert from "node:assert/strict";
import { buildGettoneJourneys, filterGettoneByInsertDate } from "../shared/customerJourney.ts";
import { reconcileCjMobile, paginateCjMobileSources, CJ_SIM_REASONS } from "../shared/customerJourneyDiagnostics.ts";

const filters = { typeFilter: "tutti", pdvFilter: [], addettoFilter: "tutti", stateFilter: "tutti", search: "" };
const from = "2026-07-01", to = "2026-07-31";
const row = (id, changes = {}) => ({
  itemId: String(id), journeyId: "j", customerKey: "CF", cliente: "Cliente",
  customerType: "privato", pdv: "Roma", addetto: "Mario", driver: "mobile", state: "inserito",
  economicState: null, categoria: "UNTIED", tipologia: "VOCE", descrizione: "SIM voce",
  bisuiteSaleId: `s${id}`, bisuiteArticleId: id,
  openedAt: "2026-07-02", insertedAt: "2026-07-02", eventDate: "2026-07-02", valore: 0,
  ...changes,
});
const source = (id, changes = {}) => ({
  saleId: `s${id}`, bisuiteId: id, articleId: id, categoria: "UNTIED",
  tipologia: "VOCE", descrizione: "SIM voce", insertedAt: "2026-07-02",
  customerKey: "CF", customerType: "privato", cliente: "Cliente", pdv: "Roma", addetto: "Mario",
  cancelled: false, contract: `C${id}`, ...changes,
});
const run = (sources, rows, f = filters) => {
  // Match the page's item filters before selecting the acquisition cohort.
  const filtered = rows.filter(r => f.addettoFilter === "tutti" || r.addetto === f.addettoFilter);
  const selected = filterGettoneByInsertDate(buildGettoneJourneys(filtered), from, to);
  return reconcileCjMobile(sources, rows, selected, f, from, to);
};

test("one customer, two months, T6 boundary and visible unlinked discrepancy", () => {
  const rows = [row(1), row(2, { insertedAt: "2026-08-01", eventDate: "2026-08-01" }),
    row(3, { insertedAt: "2027-02-01", eventDate: "2027-02-01" })];
  const d = run([source(1), source(2, { insertedAt: "2026-08-01" })], rows);
  assert.deepEqual([d.clients, d.period, d.later, d.cumulative], [1, 1, 1, 2]);
  assert.equal(d.discrepancy, 0);
  const missingSource = run([], rows);
  assert.equal(missingSource.discrepancy, 1, "missing source must not be concealed");
});

test("mutually exclusive commercial, cancelled, negative, identity and unlinked reasons", () => {
  const sources = [
    source(1), source(2, { tipologia: "DATI" }), source(3, { descrizione: "TOURIST" }),
    source(4, { tipologia: "ALTRE GA NON TURISTICHE" }),
    source(5, { cancelled: true, descrizione: "TOURIST" }),
    source(6), source(7, { customerKey: "" }), source(8), source(9),
  ];
  const rows = [row(1), row(6, { economicState: "stornato" }), row(9, { state: "ko" })];
  const d = run(sources, rows);
  for (const reason of ["admitted", "data", "tourist", "alarm", "cancelled", "negative", "identity", "unlinked", "ko"])
    assert.equal(d.counts[reason], 1, reason);
  assert.equal(Object.values(d.counts).reduce((a, b) => a + b, 0), 9);
  assert.equal(d.sourceTotal, 9);
});

test("DRMS facts and manual overrides remain separate; positive-only gettone excludes presumed smartphone", () => {
  const rows = [
    row(1, { drmsOutcomeState: "pagato", economicState: "pagato" }),
    row(2, { drmsOutcomeState: "riaccreditato", economicState: "riaccreditato" }),
    row(3, { drmsOutcomeState: "stornato", economicState: "pagato", economicStateManual: true }),
    row(4, { drmsOutcomeState: "pagato", economicState: "annullato", economicStateManual: true }),
    row(5, { gettoneConfirmed: true }), row(6, { driver: "fisso", economicState: "pagato" }),
    row(7, { driver: "telefono" }),
    row(8, { driver: "energia", economicState: "pagato", eventDate: "2027-02-01" }),
  ];
  const d = run([source(1), source(2), source(3), source(4), source(5)], rows);
  assert.deepEqual(d.outcomes, { drmsPaid: 2, drmsRecredited: 1, drmsNegative: 1, drmsNone: 1,
    manualPositive: 1, manualNegative: 1, manualNone: 0, manualGettone: 1 });
  assert.equal(d.confirmedTotal, 20);
  assert.equal(d.includingPresumedTotal, 30);
  assert.equal(d.cumulative, 4);
});

test("explicit smartphone positive counts, multiple contracts of one driver do not duplicate gettone", () => {
  const rows = [row(1), row(2, { driver: "telefono", economicState: "riaccreditato", economicStateManual: true }),
    row(3, { driver: "telefono", economicState: "pagato" })];
  const d = run([source(1)], rows);
  assert.equal(d.confirmedTotal, 20);
  assert.equal(d.includingPresumedTotal, 20);
});

test("same addetto filter applies to source, SIM counts, economic counts and confirmed piste", () => {
  const rows = [row(1), row(2, { addetto: "Luigi", economicState: "pagato", drmsOutcomeState: "pagato" }),
    row(3, { driver: "fisso", addetto: "Luigi", economicState: "pagato" })];
  const d = run([source(1), source(2, { addetto: "Luigi" })], rows, { ...filters, addettoFilter: "Mario" });
  assert.equal(d.sourceTotal, 1);
  assert.equal(d.cumulative, 1);
  assert.equal(d.outcomes.drmsPaid, 0);
  assert.equal(d.confirmedTotal, 0);
});

test("existing-customer monthly sales are visible but outside selected acquisition cohort", () => {
  const rows = [row(1, { insertedAt: "2026-06-01", eventDate: "2026-06-01", openedAt: "2026-06-01" }),
    row(2, { openedAt: "2026-06-01" })];
  const d = run([source(2)], rows);
  assert.equal(d.clients, 0);
  assert.equal(d.counts.cohort, 1);
});

test("PDV, customer type, state and search filters apply without creating overlapping exclusions", () => {
  const rows = [row(1)];
  for (const change of [
    { pdvFilter: ["Milano"] }, { typeFilter: "azienda" }, { stateFilter: "pagato" }, { search: "nessun match" },
  ]) {
    const d = reconcileCjMobile([source(1)], rows, buildGettoneJourneys(rows), { ...filters, ...change }, from, to);
    assert.equal(d.sourceTotal, 0);
    assert.equal(d.cumulative, 0);
  }
  assert.equal(Object.keys(CJ_SIM_REASONS).length, 12);
});

test("streamed pages match the complete partition with late, undated and filtered sources", async () => {
  const sources = Array.from({ length: 177 }, (_, i) => source(i + 1, {
    ...(i % 7 === 0 ? { cancelled: true } : {}),
    ...(i % 11 === 0 ? { tipologia: "DATI" } : {}),
  })).concat([source(500, { insertedAt: null }), source(501, { insertedAt: "2026-08-01" })]);
  const rows = [row(1), row(2, { economicState: "stornato" }), row(3, { addetto: "Luigi" })];
  for (const f of [filters, { ...filters, addettoFilter: "Mario" }, { ...filters, stateFilter: "stornato" }]) {
    const selected = filterGettoneByInsertDate(buildGettoneJourneys(rows), from, to);
    const all = reconcileCjMobile(sources, rows, selected, f, from, to);
    async function* batches() {
      for (let i = 0; i < sources.length; i += 23) yield sources.slice(i, i + 23);
    }
    const summary = await paginateCjMobileSources(batches(), rows, selected, f, from, to, 0, 50, false);
    assert.deepEqual(summary.counts, all.counts);
    assert.equal(summary.sourceTotal, all.sourceTotal);
    assert.deepEqual(summary.details, []);
    const details = [];
    for (let page = 0; page < Math.ceil(all.sourceTotal / 50); page++) {
      const result = await paginateCjMobileSources(batches(), rows, selected, f, from, to, page, 50, true);
      assert.deepEqual(result.counts, all.counts);
      assert.deepEqual(result.details, all.details.slice(page * 50, (page + 1) * 50));
      details.push(...result.details);
    }
    assert.deepEqual(details, all.details);
    assert.deepEqual((await paginateCjMobileSources(batches(), rows, selected, f, from, to, 100, 50, true)).details, []);
  }
});
