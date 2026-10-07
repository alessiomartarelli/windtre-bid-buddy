import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCjCohortModel } from "../shared/customerJourneyCohorts.ts";
import { buildCjProgression } from "../shared/customerJourneyProgression.ts";

const row = (journeyId, itemId, driver, date, extra = {}) => ({
  journeyId, itemId, customerKey: journeyId, customerType: "privato", cliente: `Cliente ${journeyId}`,
  pdv: "Negozio", addetto: "Anna", state: "inserito", driver, valore: 0,
  openedAt: "2026-07-01T00:00:00Z", eventDate: `${date}T00:00:00Z`, insertedAt: `${date}T00:00:00Z`,
  economicHistory: [], historyIncomplete: false, ...extra,
});
const sim = (j, id = `sim-${j}`, extra = {}) => row(j, id, "mobile", "2026-07-01", {
  categoria: "UNTIED", simContract: `CONTRACT-${id}`, ...extra,
});
const history = (month, state, source = "drms") => ({ month, state, source });
const model = (rows, asOf = "2026-10-07T12:00:00Z") =>
  buildCjProgression(rows, buildCjCohortModel(rows).customers, asOf);

test("fixed cohort cumulative stocks, changes and actual loss of CJ qualification", () => {
  const rows = [
    sim("1"), row("1", "f1", "fisso", "2026-07-02"), row("1", "e1", "energia", "2026-08-02"),
    row("1", "e2", "energia", "2026-08-03"),
    sim("2"), row("2", "f2", "fisso", "2026-09-03"),
    sim("3", "sim-3", { economicState: "stornato", economicHistory: [
      history("2026-07", "pagato"), history("2026-08", "stornato"),
    ] }),
    sim("4"), sim("4", "sim-4-lost", { economicState: "annullato", economicHistory: [
      history("2026-09", "annullato"),
    ] }), row("4", "f4", "fisso", "2026-07-04"),
    sim("5", "sim-5", { state: "ko" }), sim("tourist", "tourist", { descrizione: "Tourist" }),
  ];
  const p = model(rows);
  assert.deepEqual(p.months.map(m => m.clients), [5, 5, 5, 5]);
  assert.deepEqual(p.months.slice(0, 3).map(m => m.bins.slice(0, 3)), [[1, 2, 0], [1, 1, 1], [0, 2, 1]]);
  assert.deepEqual(p.months[1].deltas.slice(0, 3), [0, -1, 1]);
  assert.equal(p.months[1].fromOneToMore, 1);
  assert.equal(p.months[2].firstProduct, 1);
  assert.equal(p.months[1].droppedSims, 1);
  assert.equal(p.months[2].droppedSims, 1);
  assert.equal(p.dropped.length, 3);
  assert.deepEqual(p.exitedCustomers.map(c => c.journeyId), ["3", "5"]);
  assert.equal(p.dropped.find(d => d.itemId === "sim-4-lost").exited, false);
  assert.equal(p.undatedDrops, 1);
  for (const m of p.months) assert.equal(m.bins.reduce((s, n) => s + n, 0) + m.inactiveClients, m.clients);
  assert.equal(p.months.at(-1).isPartial, true);
  assert.equal(p.months[0].isPartial, false);
});

test("recovered SIM remains visible in documented monthly losses, not current losses", () => {
  const p = model([sim("1", "sim-1", { economicState: "riaccreditato", economicHistory: [
    history("2026-07", "pagato"), history("2026-08", "stornato"), history("2026-09", "riaccreditato"),
  ] })]);
  assert.equal(p.months[1].droppedSims, 1);
  assert.equal(p.dropped.length, 0);
  assert.equal(p.exitedCustomers.length, 0);
  assert.equal(p.falls.length, 1);
  assert.equal(p.falls[0].currentlyDropped, false);
});

test("only explicit manual decision dates allocate operative KO, no automatic update inference", () => {
  const p = model([sim("1", "a", { state: "ko", operativeDecisionAt: "2026-08-03T10:00:00Z" }),
    sim("2", "b", { state: "ko" })]);
  assert.equal(p.dropped.find(d => d.itemId === "a").month, "2026-08");
  assert.equal(p.dropped.find(d => d.itemId === "b").month, null);
  assert.equal(p.months[1].droppedSims, 1);
  assert.equal(p.undatedDrops, 1);
});

test("current unknown annulment never borrows an older storno followed by recovery", () => {
  const p = model([sim("1", "a", { economicState: "annullato", economicHistory: [
    history("2026-07", "stornato"), history("2026-08", "riaccreditato"),
  ] })]);
  assert.equal(p.dropped[0].month, null);
  assert.equal(p.undatedDrops, 1);
});

test("continuing inactive states count a single fall at start of inactive period", () => {
  const p = model([sim("1", "a", { economicState: "annullato", economicHistory: [
    history("2026-08", "stornato"), history("2026-09", "annullato"),
  ] })]);
  assert.equal(p.dropped[0].month, "2026-08");
  assert.equal(p.months[1].droppedSims, 1);
  assert.equal(p.months[2].droppedSims, 0);
});

test("manual KO after an already documented economic loss does not invent a second fall", () => {
  const p = model([sim("1", "a", { state: "ko", operativeDecisionAt: "2026-09-02T12:00:00Z",
    economicState: "annullato", economicHistory: [history("2026-08", "annullato")] })]);
  assert.equal(p.dropped[0].month, "2026-08");
  assert.equal(p.months[2].droppedSims, 0);
  assert.equal(p.falls.length, 1);
});

test("unqualified data SIM cannot retain customer after their eligible SIM falls", () => {
  const p = model([sim("1", "a", { economicState: "annullato" }), sim("1", "data", { tipologia: "SIM DATI" })]);
  assert.equal(p.exitedCustomers.length, 1);
  assert.equal(p.dropped.length, 1);
});

test("undated purchases and future insertion are not fabricated into historical month bins", () => {
  const p = model([sim("1"), row("1", "f", "fisso", "2026-07-02", { insertedAt: null }),
    row("1", "e", "energia", "2026-11-02")]);
  assert.equal(p.undatedSales, 1);
  assert.ok(p.months.every(m => m.bins[0] === 1));
});

test("empty cohort produces no monthly rows or drops", () => {
  assert.deepEqual(model([]), {
    months: [], dropped: [], falls: [], exitedCustomers: [], undatedSales: 0, undatedDrops: 0,
  });
});
