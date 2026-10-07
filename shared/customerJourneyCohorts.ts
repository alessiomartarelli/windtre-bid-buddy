import {
  CJ_DRIVER_LABELS, cjT0Month, gettoneForPiste, isCjItemActive,
  isCjMobileEligible, monthOfIso, pisteInWindow, effectiveEconomicState,
} from "./customerJourney";
import type { CjReportRow } from "./customerJourney";
import type { CjEconomicState } from "./schema";

export interface CjCohortRow extends CjReportRow {
  itemId: string;
  simContract?: string | null;
  operativeDecisionAt?: string | null;
  economicHistory: { month: string; state: CjEconomicState; source: "drms" | "manuale" | "presunto" }[];
  historyIncomplete: boolean;
}
export interface CjCohortData {
  rows: CjCohortRow[];
  legacyUploads: number;
  ambiguousItems: number;
  operatorScoped: boolean;
}
export interface CjCohortEvent {
  itemId: string;
  journeyId: string;
  cliente: string;
  cohort: string;
  month: string;
  opener: string;
  seller: string;
  pdv: string;
  driver: string;
  product: string;
  active: boolean;
  newPista: boolean;
  generated: number;
  confirmed: number;
  source: string;
  kind: "vendita" | "riconoscimento";
}
export interface CjCohortCustomer {
  journeyId: string;
  cliente: string;
  cohort: string;
  opener: string;
  pdv: string;
  mobileActive: boolean;
  generated: number;
  confirmed: number;
  unallocatedGenerated: number;
  unallocatedConfirmed: number;
}
export interface CjCohortModel {
  customers: CjCohortCustomer[];
  events: CjCohortEvent[];
  undatedSales: number;
  incompleteHistories: number;
  unallocatedGenerated: number;
  unallocatedConfirmed: number;
}
const month = (value: string | null) => {
  const n = monthOfIso(value);
  return n == null ? null : `${Math.floor(n / 12)}-${String(n % 12 + 1).padStart(2, "0")}`;
};
const paid = (state: string | null | undefined) => state === "pagato" || state === "riaccreditato";
const order = (a: CjCohortRow, b: CjCohortRow) =>
  (a.insertedAt ?? "").localeCompare(b.insertedAt ?? "") || a.itemId.localeCompare(b.itemId);

/**
 * Restated commercial history: today's valid contracts, ordered by insertion.
 * Economic history follows DRMS competence, NEVER upload/update timestamps.
 * Cohort membership stays independent of today's economic cancellation.
 */
export function buildCjCohortModel(rows: CjCohortRow[], triggerDate?: string | null): CjCohortModel {
  const model: CjCohortModel = { customers: [], events: [], undatedSales: 0, incompleteHistories: 0, unallocatedGenerated: 0, unallocatedConfirmed: 0 };
  const grouped = new Map<string, CjCohortRow[]>();
  for (const row of rows) {
    const list = grouped.get(row.journeyId) ?? [];
    list.push(row);
    grouped.set(row.journeyId, list);
  }
  for (const [journeyId, list] of grouped) {
    const openedAt = list.find(r => r.openedAt)?.openedAt ?? null;
    const cohort = month(openedAt);
    if (!cohort || (triggerDate && cohort < triggerDate.slice(0, 7))) continue;
    const t0 = cjT0Month(openedAt, list);
    const mobiles = list.filter(r => r.driver === "mobile" && isCjMobileEligible(r) && pisteInWindow(r.eventDate, t0))
      .sort((a, b) => (a.eventDate ?? "").localeCompare(b.eventDate ?? "") || order(a, b));
    if (!mobiles.length) continue;
    const opener = mobiles[0].addetto || "Non attribuito";
    const base = { journeyId, cliente: list[0].cliente, cohort, opener };
    const customer: CjCohortCustomer = {
      ...base, pdv: mobiles[0].pdv, mobileActive: mobiles.some(isCjItemActive), generated: 0, confirmed: 0, unallocatedGenerated: 0, unallocatedConfirmed: 0,
    };
    model.customers.push(customer);
    const candidates = list.filter(r => r.driver !== "mobile" && pisteInWindow(r.eventDate, t0)).sort(order);
    const hasUndatedQualifying = customer.mobileActive &&
      candidates.some(r => isCjItemActive(r) && !month(r.insertedAt));
    const seen = new Set<string>();
    const makeEvent = (r: CjCohortRow, eventMonth: string, kind: CjCohortEvent["kind"]): CjCohortEvent => ({
      ...base, itemId: r.itemId, month: eventMonth, seller: r.addetto || "Non attribuito",
      pdv: r.pdv, driver: r.driver, product: r.descrizione || CJ_DRIVER_LABELS[r.driver],
      active: isCjItemActive(r), newPista: false, generated: 0, confirmed: 0, source: "", kind,
    });
    for (const r of candidates) {
      const salesMonth = month(r.insertedAt);
      if (!salesMonth) { model.undatedSales++; continue; }
      const ev = makeEvent(r, salesMonth, "vendita");
      if (customer.mobileActive && isCjItemActive(r) && !seen.has(r.driver)) {
        ev.newPista = true;
        const before = gettoneForPiste(seen.size);
        seen.add(r.driver);
        // An undated qualifying pista could precede any dated sale. Its
        // chronology and marginal employee allocation cannot be invented.
        ev.generated = hasUndatedQualifying ? 0 : gettoneForPiste(seen.size) - before;
      }
      customer.generated += ev.generated;
      model.events.push(ev);
    }
    if (hasUndatedQualifying) {
      customer.generated = gettoneForPiste(new Set(candidates.filter(isCjItemActive).map(r => r.driver)).size);
      customer.unallocatedGenerated = customer.generated;
      model.unallocatedGenerated += customer.unallocatedGenerated;
    }
    const transitions = [...mobiles, ...candidates].flatMap(r => {
      if (r.historyIncomplete) model.incompleteHistories++;
      // Operational KO is not a valid qualifying contract. Economic storni
      // must instead stay in the history, to retain the original credit.
      if (String(r.state) === "ko" || String(r.state) === "annullato") return [];
      return r.economicHistory.map(h => ({ r, h }));
    }).sort((a, b) => a.h.month.localeCompare(b.h.month) || order(a.r, b.r));
    const states = new Map<string, boolean>();
    const drivers = new Map<string, string>();
    const mobileStates = new Map(mobiles.map(r => [r.itemId, String(r.state) !== "ko"]));
    const driverCount = () => [...mobileStates.values()].some(Boolean)
      ? new Set([...states].filter(([, p]) => p).map(([id]) => drivers.get(id)!)).size : 0;
    for (const { r, h } of transitions) {
      const before = driverCount();
      if (r.driver === "mobile") mobileStates.set(r.itemId, paid(h.state));
      else {
        drivers.set(r.itemId, r.driver);
        states.set(r.itemId, paid(h.state));
      }
      const delta = gettoneForPiste(driverCount()) - gettoneForPiste(before);
      if (!delta) continue;
      const ev = makeEvent(r, h.month, "riconoscimento");
      ev.confirmed = delta;
      ev.source = h.source;
      customer.confirmed += delta;
      model.events.push(ev);
    }
    // A known current state without historical evidence must not be given
    // a fabricated recognition month. Reconcile portfolio stock separately.
    const latest = (r: CjCohortRow) => ({
      ...r, economicState: r.economicHistory[r.economicHistory.length - 1]?.state ?? r.economicState,
    });
    const currentDrivers = new Set(candidates.filter(r => {
      const current = latest(r);
      return isCjItemActive(current) && paid(effectiveEconomicState(current));
    }).map(r => r.driver));
    const current = mobiles.some(r => isCjItemActive(latest(r))) ? gettoneForPiste(currentDrivers.size) : 0;
    customer.unallocatedConfirmed = current - customer.confirmed;
    model.unallocatedConfirmed += customer.unallocatedConfirmed;
    customer.confirmed = current;
  }
  model.customers.sort((a, b) => a.cohort.localeCompare(b.cohort) || a.cliente.localeCompare(b.cliente, "it"));
  model.events.sort((a, b) => a.month.localeCompare(b.month) || a.itemId.localeCompare(b.itemId));
  return model;
}

export interface CjCohortSummary {
  clients: number;
  repurchased: number;
  advanced: number;
  percentage: number;
  sales: number;
  newPiste: number;
  generated: number;
  confirmed: number;
  presumed: number;
  pending: number;
}
export function summarizeCjCohort(customers: CjCohortCustomer[], events: CjCohortEvent[]): CjCohortSummary {
  const ids = new Set(customers.map(c => c.journeyId));
  const selected = events.filter(e => ids.has(e.journeyId));
  const sales = selected.filter(e => e.kind === "vendita" && e.active);
  const repurchased = new Set(sales.map(e => e.journeyId)).size;
  const advanced = new Set(sales.filter(e => e.newPista).map(e => e.journeyId)).size;
  return {
    clients: ids.size, repurchased, advanced, percentage: ids.size ? repurchased / ids.size * 100 : 0,
    sales: sales.length, newPiste: sales.filter(e => e.newPista).length,
    generated: selected.reduce((s, e) => s + e.generated, 0),
    confirmed: selected.reduce((s, e) => s + (e.source === "presunto" ? 0 : e.confirmed), 0),
    presumed: selected.reduce((s, e) => s + (e.source === "presunto" ? e.confirmed : 0), 0),
    // Portfolio pending is a stock, NOT generated(month) - confirmed(month).
    pending: customers.reduce((s, c) => s + Math.max(0, c.generated - c.confirmed), 0),
  };
}
