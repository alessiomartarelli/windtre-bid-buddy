import { test } from "node:test";
import assert from "node:assert/strict";
import { cjUnqualifiedInsertDates, isCjJourneyQualified } from "../shared/customerJourneyMembership.ts";

const item = (journeyId, extra = {}) => ({
  journeyId, customerKey: journeyId, customerType: "privato", cliente: journeyId,
  driver: "mobile", categoria: "UNTIED", tipologia: "RICARICABILE", pdv: "", addetto: "",
  state: "inserito", economicState: "annullato", valore: 0,
  openedAt: "2026-07-01T00:00:00Z", eventDate: "2026-07-02T00:00:00Z",
  insertedAt: "2026-07-10T00:00:00Z", ...extra,
});

test("separate memberships depend on eligible active mobile, not cross-sell", () => {
  assert.equal(isCjJourneyQualified({ drivers: [{ driver: "mobile", activated: true }] }), true);
  assert.equal(isCjJourneyQualified({ drivers: [
    { driver: "mobile", activated: false }, { driver: "fisso", activated: true },
  ] }), false);
  assert.equal(isCjJourneyQualified({ drivers: [] }), false);
  assert.equal(isCjJourneyQualified({}), false);
});

test("a customer's other valid mobile retains active membership", () => {
  const dates = cjUnqualifiedInsertDates([
    item("active"), item("active", { economicState: null }),
    item("exited"), item("exited", { economicState: "stornato", insertedAt: "2026-07-04T00:00:00Z" }),
  ]);
  assert.equal(dates.has("active"), false);
  assert.equal(dates.get("exited"), "2026-07-04T00:00:00Z");
});

test("inactive insertion dates never fall back to opening or activation", () => {
  assert.equal(cjUnqualifiedInsertDates([item("missing", { insertedAt: null })]).get("missing"), null);
  assert.equal(cjUnqualifiedInsertDates([item("invalid", { insertedAt: "not-a-date" })]).get("invalid"), null);
  assert.equal(cjUnqualifiedInsertDates([item("different")]).get("different"), "2026-07-10T00:00:00Z");
});

test("data SIM and mobile outside T0–T6 cannot supply a membership date", () => {
  const dates = cjUnqualifiedInsertDates([
    item("data", { tipologia: "SIM DATI" }),
    item("outside", { eventDate: "2027-02-01T00:00:00Z" }),
    item("fixed", { driver: "fisso" }),
  ]);
  assert.equal(dates.size, 0);
});

test("nonqualifying valid data SIM cannot hide loss of the eligible voice SIM", () => {
  const dates = cjUnqualifiedInsertDates([
    item("client"), item("client", { tipologia: "SIM DATI", economicState: null }),
  ]);
  assert.equal(dates.get("client"), "2026-07-10T00:00:00Z");
});
