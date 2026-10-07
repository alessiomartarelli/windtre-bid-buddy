import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCjCohortModel, summarizeCjCohort } from "../shared/customerJourneyCohorts.ts";

const row = (id, driver, date, extra = {}) => ({
  itemId: id, journeyId: "j1", customerKey: "c1", customerType: "privato", cliente: "Cliente",
  pdv: "Negozio", addetto: "Anna", state: "attivato", driver, valore: 999,
  openedAt: "2026-07-01T00:00:00Z", eventDate: `${date}T00:00:00Z`,
  insertedAt: `${date}T00:00:00Z`, economicHistory: [], historyIncomplete: false, ...extra,
});
const mobile = row("m", "mobile", "2026-07-01", { categoria: "MOBILE" });
const history = (month, state = "pagato", source = "drms") => ({ month, state, source });
const model = (...rows) => buildCjCohortModel([mobile, ...rows]);

test("cohort July, August commercial insertion, September competence and opener/seller distinct", () => {
  const m = model(row("f", "fisso", "2026-08-03", {
    addetto: "Marco", eventDate: "2026-09-01T00:00:00Z",
    economicHistory: [history("2026-09")],
  }));
  assert.equal(m.customers[0].cohort, "2026-07");
  assert.equal(m.customers[0].opener, "Anna");
  const sale = m.events.find(e => e.kind === "vendita");
  assert.equal(sale.month, "2026-08");
  assert.equal(sale.seller, "Marco");
  assert.equal(sale.generated, 20);
  assert.equal(m.events.find(e => e.kind === "riconoscimento").month, "2026-09");
  const aug = summarizeCjCohort(m.customers, m.events.filter(e => e.month === "2026-08"));
  assert.equal(aug.generated, 20);
  assert.equal(aug.confirmed, 0);
  assert.equal(aug.percentage, 100);
  assert.equal(aug.pending, 0); // current portfolio stock, already paid in Sep
});
test("tiers reconcile without re-counting totals, repeated pista and energy are distinct only once", () => {
  const m = model(
    row("f", "fisso", "2026-07-02"),
    row("e", "energia", "2026-08-02"),
    row("g", "energia", "2026-08-03"),
    row("a", "assicurazioni", "2026-09-02"),
    row("p", "protetti", "2026-10-02"),
  );
  assert.deepEqual(m.events.map(e => e.generated), [20, 10, 0, 10, 60]);
  assert.equal(m.customers[0].generated, 100);
  const aug = summarizeCjCohort(m.customers, m.events.filter(e => e.month === "2026-08"));
  assert.equal(aug.repurchased, 1);
  assert.equal(aug.sales, 2);
  assert.equal(aug.newPiste, 1);
});
test("storno and reaccredit produce signed economic deltas, never DRMS commission amounts", () => {
  const m = model(row("f", "fisso", "2026-07-02", {
    economicState: "riaccreditato",
    economicHistory: [history("2026-07"), history("2026-08", "stornato"), history("2026-09", "riaccreditato")],
  }));
  assert.deepEqual(m.events.filter(e => e.kind === "riconoscimento").map(e => e.confirmed), [20, -20, 20]);
  assert.equal(m.customers[0].confirmed, 20);
});
test("duplicate paid contracts on a pista: cancelling one does not cancel the other", () => {
  const m = model(
    row("f1", "fisso", "2026-07-02", { economicHistory: [history("2026-07"), history("2026-09", "stornato")] }),
    row("f2", "fisso", "2026-08-02", { economicHistory: [history("2026-08")] }),
  );
  assert.equal(m.customers[0].confirmed, 20);
  assert.equal(m.events.filter(e => e.kind === "riconoscimento").length, 1);
});
test("inactive mobile remains in denominator, ineligible data/Tourist SIM cannot open a cohort", () => {
  const m = buildCjCohortModel([mobile, row("m2", "mobile", "2026-07-02", {
    journeyId: "j2", customerKey: "c2", economicState: "annullato",
  }), row("f", "fisso", "2026-08-02")]);
  assert.equal(m.customers.length, 2);
  assert.equal(summarizeCjCohort(m.customers, m.events).percentage, 50);
  assert.equal(buildCjCohortModel([{ ...mobile, tipologia: "SIM DATI" }]).customers.length, 0);
  assert.equal(buildCjCohortModel([{ ...mobile, descrizione: "Tourist" }]).customers.length, 0);
});
test("solar T6 inclusive; sales beyond it excluded and opening trigger applied", () => {
  const m = model(row("f", "fisso", "2027-01-31"), row("e", "energia", "2027-02-01"));
  assert.equal(m.events.length, 1);
  assert.equal(m.events[0].generated, 20);
  assert.equal(buildCjCohortModel([mobile], "2026-08-01").customers.length, 0);
});
test("presumed recognition separated and incomplete manual history signaled", () => {
  const m = model(row("t", "telefono", "2026-08-03", {
    economicHistory: [history("2026-08", "pagato", "presunto")], historyIncomplete: true,
  }));
  const s = summarizeCjCohort(m.customers, m.events);
  assert.equal(s.presumed, 20);
  assert.equal(s.confirmed, 0);
  assert.equal(m.incompleteHistories, 1);
});
test("attribution stable when source rows reverse, earliest opening SIM not lexical seller", () => {
  const rows = [mobile, row("m2", "mobile", "2026-08-01", { addetto: "Aaa" }),
    row("f", "fisso", "2026-08-03", { addetto: "Marco" })];
  assert.deepEqual(buildCjCohortModel(rows), buildCjCohortModel([...rows].reverse()));
  assert.equal(buildCjCohortModel(rows).customers[0].opener, "Anna");
});
test("missing insertion never fabricates chronological marginal attribution", () => {
  const m = model(row("f", "fisso", "2026-07-02", { insertedAt: null }), row("e", "energia", "2026-08-02"));
  assert.equal(m.undatedSales, 1);
  assert.equal(m.unallocatedGenerated, 30);
  assert.equal(m.customers[0].generated, 30);
  assert.equal(m.events.reduce((s, e) => s + e.generated, 0), 0);
});
test("SIM cancellation and reaccredit adjust economic bonus without losing cohort denominator", () => {
  const m = buildCjCohortModel([
    { ...mobile, economicHistory: [history("2026-07"), history("2026-08", "stornato"), history("2026-09", "riaccreditato")] },
    row("f", "fisso", "2026-07-02", { economicHistory: [history("2026-07")] }),
  ]);
  assert.equal(m.customers.length, 1);
  assert.deepEqual(m.events.filter(e => e.kind === "riconoscimento").map(e => e.confirmed), [20, -20, 20]);
  assert.equal(m.customers[0].confirmed, 20);
  assert.equal(m.unallocatedConfirmed, 0);
});
test("known current credit without economic history stays unallocated, not silently pending", () => {
  const m = model(row("f", "fisso", "2026-08-02", { economicState: "pagato", historyIncomplete: true }));
  assert.equal(m.events.filter(e => e.kind === "riconoscimento").length, 0);
  assert.equal(m.customers[0].confirmed, 20);
  assert.equal(m.unallocatedConfirmed, 20);
  assert.equal(summarizeCjCohort(m.customers, m.events).pending, 0);
});
