import { cjT0Month, isCjItemActive, isCjMobileEligible, monthOfIso, pisteInWindow } from "./customerJourney";
import type { CjCohortCustomer, CjCohortRow } from "./customerJourneyCohorts";

export interface CjDroppedSim {
  itemId: string;
  journeyId: string;
  cliente: string;
  cohort: string;
  pdv: string;
  seller: string;
  contract: string;
  product: string;
  state: string;
  economicState: string | null;
  month: string | null;
  source: string;
  exited: boolean;
  currentlyDropped: boolean;
}
export interface CjProgressionMonth {
  month: string;
  clients: number;
  activeClients: number;
  inactiveClients: number;
  bins: number[];
  deltas: number[] | null;
  withProducts: number;
  percentage: number;
  firstProduct: number;
  fromOneToMore: number;
  advanced: number;
  droppedSims: number;
  isPartial: boolean;
}
export interface CjProgression {
  months: CjProgressionMonth[];
  dropped: CjDroppedSim[];
  falls: CjDroppedSim[];
  exitedCustomers: CjCohortCustomer[];
  undatedSales: number;
  undatedDrops: number;
}
const ym = (value: string | null | undefined) => {
  const m = monthOfIso(value);
  return m == null ? null : `${Math.floor(m / 12)}-${String(m % 12 + 1).padStart(2, "0")}`;
};
const inactiveEconomic = (state: string) => state === "annullato" || state === "stornato";

/** Fixed cohort, commercial stocks RESTATED with today's validity, not closing snapshots.
 * Drop months are only evidenced DRMS competences or explicit manual decisions.
 * A lost SIM is not a lost customer while another eligible SIM remains valid.
 */
export function buildCjProgression(
  rows: CjCohortRow[], customers: CjCohortCustomer[], asOf = new Date().toISOString(),
): CjProgression {
  const grouped = new Map<string, CjCohortRow[]>();
  for (const r of rows) {
    const list = grouped.get(r.journeyId) ?? [];
    list.push(r); grouped.set(r.journeyId, list);
  }
  const dropped: CjDroppedSim[] = [];
  const falls: CjDroppedSim[] = [];
  const exitedCustomers = customers.filter(c => !c.mobileActive);
  const exits = new Set(exitedCustomers.map(c => c.journeyId));
  const lossEvents: { itemId: string; month: string }[] = [];
  const candidates = new Map<string, CjCohortRow[]>();
  let undatedSales = 0;
  for (const c of customers) {
    const list = grouped.get(c.journeyId) ?? [];
    const t0 = cjT0Month(list.find(r => r.openedAt)?.openedAt ?? null, list);
    const within = list.filter(r => pisteInWindow(r.eventDate, t0));
    const sales = within.filter(r => r.driver !== "mobile" && isCjItemActive(r));
    candidates.set(c.journeyId, sales);
    undatedSales += sales.filter(r => !ym(r.insertedAt)).length;
    for (const r of within.filter(r => r.driver === "mobile" && isCjMobileEligible(r))) {
      const detail = (fallMonth: string | null, source: string): CjDroppedSim => ({
        itemId: r.itemId, journeyId: c.journeyId, cliente: c.cliente, cohort: c.cohort,
        pdv: r.pdv, seller: r.addetto, contract: r.simContract || "",
        product: r.descrizione || r.tipologia || "SIM mobile", state: r.state,
        economicState: r.economicState ?? null, month: fallMonth, source, exited: exits.has(c.journeyId),
        currentlyDropped: !isCjItemActive(r),
      });
      let active = true;
      let lastLoss: CjCohortRow["economicHistory"][number] | null = null;
      const history = [...r.economicHistory].sort((a, b) => a.month.localeCompare(b.month));
      for (const h of history) {
        const next = !inactiveEconomic(h.state);
        if (active && !next) {
          lossEvents.push({ itemId: r.itemId, month: h.month });
          falls.push(detail(h.month, h.source === "drms" ? "Competenza DRMS" : "Ultima decisione manuale"));
          lastLoss = h;
        }
        if (next) lastLoss = null;
        active = next;
      }
      if (isCjItemActive(r)) continue;
      const operativeKo = ["ko", "annullato", "stornato"].includes(r.state);
      const lastState = history[history.length - 1]?.state;
      const economicDrop = lastState === r.economicState && inactiveEconomic(lastState ?? "")
        ? lastLoss : null;
      const manualMonth = operativeKo ? ym(r.operativeDecisionAt) : null;
      const useManual = !!manualMonth && (!economicDrop || manualMonth < economicDrop.month);
      const fallMonth = useManual ? manualMonth : economicDrop?.month ?? null;
      const source = useManual ? "Ultima decisione manuale"
        : economicDrop ? economicDrop.source === "drms" ? "Competenza DRMS" : "Ultima decisione manuale" : "Mese non ricostruibile";
      if (useManual && manualMonth) {
        lossEvents.push({ itemId: r.itemId, month: manualMonth });
        falls.push(detail(manualMonth, source));
      }
      dropped.push(detail(fallMonth, source));
    }
  }
  const first = customers.map(c => monthOfIso(`${c.cohort}-01`)).filter((m): m is number => m != null);
  const last = monthOfIso(asOf);
  const months: CjProgressionMonth[] = [];
  let previous: Map<string, number> | null = null;
  if (first.length && last != null) {
    for (let n = Math.min(...first); n <= last; n++) {
      const month = `${Math.floor(n / 12)}-${String(n % 12 + 1).padStart(2, "0")}`;
      const clients = customers.filter(c => c.cohort <= month);
      const active = clients.filter(c => c.mobileActive);
      const counts = new Map<string, number>();
      for (const c of active) {
        const tracks = new Set((candidates.get(c.journeyId) ?? [])
          .filter(r => !!ym(r.insertedAt) && ym(r.insertedAt)! <= month && r.insertedAt! <= asOf)
          .map(r => r.driver));
        counts.set(c.journeyId, tracks.size);
      }
      const bins = Array.from({ length: 6 }, (_, i) => [...counts.values()].filter(v => v === i).length);
      const lastRow = months[months.length - 1];
      const changes = [...counts].filter(([id, v]) => v > (previous?.get(id) ?? 0));
      months.push({
        month, clients: clients.length, activeClients: active.length, inactiveClients: clients.length - active.length,
        bins, deltas: lastRow ? bins.map((v, i) => v - lastRow.bins[i]) : null,
        withProducts: active.length - bins[0],
        percentage: clients.length ? 100 * (active.length - bins[0]) / clients.length : 0,
        firstProduct: changes.filter(([id, v]) => v > 0 && (previous?.get(id) ?? 0) === 0).length,
        fromOneToMore: changes.filter(([id, v]) => v >= 2 && previous?.get(id) === 1).length,
        advanced: changes.length,
        droppedSims: new Set(lossEvents.filter(e => e.month === month).map(e => e.itemId)).size,
        isPartial: n === last,
      });
      previous = counts;
    }
  }
  const uniqueFalls = [...new Map(falls.map(d => [`${d.itemId}:${d.month}`, d])).values()];
  return { months, dropped, falls: uniqueFalls, exitedCustomers, undatedSales, undatedDrops: dropped.filter(d => !d.month).length };
}
