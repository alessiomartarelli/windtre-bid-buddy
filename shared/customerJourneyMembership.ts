import { cjT0Month, isCjItemActive, isCjMobileEligible, pisteInWindow } from "./customerJourney";
import type { CjReportRow } from "./customerJourney";

/** Membership is independent of displayed cross-sell drivers and operator ownership. */
export function isCjJourneyQualified(journey: {
  drivers?: readonly { driver: string; activated: boolean }[];
}): boolean {
  return journey.drivers?.some(d => d.driver === "mobile" && d.activated) ?? false;
}

/**
 * Date-filter fallback for exited clients only. Active clients keep the existing
 * gettone insertion-date derivation; inactive clients use their oldest eligible
 * SIM insertion date in the original T0–T6 window, never openedAt as a date.
 */
export function cjUnqualifiedInsertDates(rows: readonly CjReportRow[]): Map<string, string | null> {
  const grouped = new Map<string, CjReportRow[]>();
  for (const row of rows) {
    const list = grouped.get(row.journeyId) ?? [];
    list.push(row);
    grouped.set(row.journeyId, list);
  }
  const dates = new Map<string, string | null>();
  for (const [id, list] of grouped) {
    const t0 = cjT0Month(list.find(r => r.openedAt)?.openedAt ?? null, list);
    const mobiles = list.filter(r => r.driver === "mobile" && isCjMobileEligible(r)
      && pisteInWindow(r.eventDate, t0));
    if (!mobiles.length || mobiles.some(isCjItemActive)) continue;
    const inserted = mobiles.map(r => r.insertedAt).filter((date): date is string =>
      !!date && Number.isFinite(Date.parse(date)));
    inserted.sort((a, b) => Date.parse(a) - Date.parse(b));
    dates.set(id, inserted[0] ?? null);
  }
  return dates;
}
