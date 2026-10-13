import {
  CJ_NO_DESTINATION_FILTER_VALUE, cjT0Month, gettoneForPiste, isCjItemActive, isCjMobileEligible,
  matchesCjFilters, pisteInWindow,
  type CjGettoneJourney, type CjListFilters, type CjReportRow,
} from "./customerJourney";

export interface CjMobileSource {
  saleId: string;
  bisuiteId: number;
  articleId: number | null;
  categoria: string;
  tipologia: string;
  descrizione: string;
  insertedAt: string | null;
  customerKey: string;
  customerType: string;
  cliente: string;
  pdv: string;
  addetto: string;
  cancelled: boolean;
  contract: string;
}

export const CJ_SIM_REASONS = {
  admitted: "Ammesse per i clienti selezionati",
  cancelled: "Vendita annullata",
  tourist: "Tourist",
  alarm: "Smart Security / SIM allarme",
  data: "SIM dati",
  commercial: "Altre offerte escluse dalle regole CJ",
  identity: "Identità mancante",
  unlinked: "Articolo non agganciato alla CJ",
  negative: "Esito economico annullato / stornato",
  ko: "Stato operativo KO",
  window: "Fuori finestra T0–T5",
  cohort: "Cliente fuori dal periodo di acquisizione selezionato",
} as const;
export type CjSimReason = keyof typeof CJ_SIM_REASONS;
export type CjSimDetail = { source: CjMobileSource; row?: CjReportRow; reason: CjSimReason };
export interface CjSimSourcePage {
  counts: Record<CjSimReason, number>;
  sourceTotal: number;
  details: CjSimDetail[];
  page: number;
  pageSize: number;
}

export interface CjSimDiagnosticPage extends CjSimSourcePage {
  version: string;
  diagnostics?: ReturnType<typeof reconcileCjMobile>;
}

export function inCjInsertPeriod(date: string | null, from: string, to: string): boolean {
  if (!date) return !from && !to;
  const day = date.slice(0, 10);
  return (!from || day >= from) && (!to || day <= to);
}

export function matchesDiagnosticFilters(
  r: Pick<CjReportRow,
    "customerType" | "pdv" | "pdvOrigine" | "pdvDestinazione" | "ragioneSociale" |
    "addetto" | "state" | "economicState" | "cliente" | "customerKey">,
  filters: CjListFilters,
) {
  const destination = (r.pdvDestinazione ?? "").trim();
  return matchesCjFilters({
    customerType: r.customerType, pdvs: r.pdv ? [r.pdv] : [],
    pdvOrigini: r.pdvOrigine ? [r.pdvOrigine] : [],
    pdvDestinazioni: [destination || CJ_NO_DESTINATION_FILTER_VALUE],
    ragioneSociale: r.ragioneSociale ?? null,
    addetti: r.addetto ? [r.addetto] : [],
    states: [r.state, r.economicState].filter((s): s is NonNullable<typeof s> => !!s),
    searchHay: [r.cliente, r.customerKey, r.addetto, r.pdv].filter(Boolean).join(" "),
  }, filters);
}

/** Read-only partition. One source article, one reason; linked rows use report facets. */
export function createCjMobileClassifier(
  rows: CjReportRow[], selected: CjGettoneJourney[], filters: CjListFilters, from: string, to: string,
) {
  const selectedIds = new Set(selected.map(j => j.journeyId));
  const linked = new Map(rows.filter(r => r.bisuiteSaleId && r.bisuiteArticleId != null)
    .map(r => [`${r.bisuiteSaleId}:${r.bisuiteArticleId}`, r]));
  const grouped = new Map<string, CjReportRow[]>();
  for (const r of rows) {
    if (!matchesDiagnosticFilters(r, filters)) continue;
    const list = grouped.get(r.journeyId) ?? [];
    list.push(r); grouped.set(r.journeyId, list);
  }
  const t0 = new Map(Array.from(grouped, ([id, list]) =>
    [id, cjT0Month(list.find(r => r.openedAt)?.openedAt ?? null, list)]));
  return (source: CjMobileSource): CjSimDetail | null => {
    if (!inCjInsertPeriod(source.insertedAt, from, to)) return null;
    const row = source.articleId == null ? undefined : linked.get(`${source.saleId}:${source.articleId}`);
    const facet = row ?? {
      ...source,
      // For unlinked BiSuite sales the source PDV is the sale's origin. There
      // is no Customer Journey destination, so never copy origin into it.
      pdvOrigine: source.pdv,
      pdvDestinazione: null,
      ragioneSociale: null,
      state: "inserito" as const,
      economicState: source.cancelled ? "annullato" as const : null,
    };
    if (!matchesDiagnosticFilters(facet, filters)) return null;
    let reason: CjSimReason;
    if (source.cancelled) reason = "cancelled";
    else if (!isCjMobileEligible(source)) {
      const text = `${source.tipologia} ${source.descrizione}`.toUpperCase().replace(/[_-]+/g, " ");
      reason = /ALLARM|SMART\s*SECURITY|ALTRE GA NON TURISTICHE/.test(text) ? "alarm"
        : /\bTOURIST|TURISTIC/.test(text) ? "tourist"
        : /\bDATI\b|\bDATA\b/.test(text) ? "data" : "commercial";
    } else if (!source.customerKey) reason = "identity";
    else if (!row) reason = "unlinked";
    else if (["annullato", "stornato"].includes(row.economicState ?? row.state)) reason = "negative";
    else if (!isCjItemActive(row)) reason = "ko";
    else if (!pisteInWindow(row.eventDate, t0.get(row.journeyId) ?? null)) reason = "window";
    else if (!selectedIds.has(row.journeyId)) reason = "cohort";
    else reason = "admitted";
    return { source, row, reason };
  };
}

/** Exact counts, bounded detail memory, and one classification context for all DB batches. */
export async function paginateCjMobileSources(
  batches: AsyncIterable<CjMobileSource[]>, rows: CjReportRow[], selected: CjGettoneJourney[],
  filters: CjListFilters, from: string, to: string, page: number, pageSize: number, includeDetail: boolean,
  collect?: (detail: CjSimDetail) => void,
): Promise<CjSimSourcePage> {
  const classify = createCjMobileClassifier(rows, selected, filters, from, to);
  const counts = Object.fromEntries(Object.keys(CJ_SIM_REASONS).map(k => [k, 0])) as Record<CjSimReason, number>;
  const details: CjSimDetail[] = [];
  let sourceTotal = 0;
  for await (const sources of batches) {
    for (const source of sources) {
      const detail = classify(source);
      if (!detail) continue;
      collect?.(detail);
      counts[detail.reason]++;
      if (includeDetail && sourceTotal >= page * pageSize && details.length < pageSize) details.push(detail);
      sourceTotal++;
    }
  }
  return { counts, sourceTotal, details, page, pageSize };
}

export function reconcileCjMobile(
  sources: CjMobileSource[], rows: CjReportRow[], selected: CjGettoneJourney[],
  filters: CjListFilters, from: string, to: string,
) {
  const selectedIds = new Set(selected.map(j => j.journeyId));
  const grouped = new Map<string, CjReportRow[]>();
  for (const r of rows) {
    if (!matchesDiagnosticFilters(r, filters)) continue;
    const list = grouped.get(r.journeyId) ?? [];
    list.push(r); grouped.set(r.journeyId, list);
  }
  const t0 = new Map(Array.from(grouped, ([id, list]) =>
    [id, cjT0Month(list.find(r => r.openedAt)?.openedAt ?? null, list)]));
  const valid = (r: CjReportRow) => isCjMobileEligible(r) && isCjItemActive(r)
    && pisteInWindow(r.eventDate, t0.get(r.journeyId) ?? null);
  const details: CjSimDetail[] = [];
  const classify = createCjMobileClassifier(rows, selected, filters, from, to);
  const counts = Object.fromEntries(Object.keys(CJ_SIM_REASONS).map(k => [k, 0])) as Record<CjSimReason, number>;
  for (const source of sources) {
    const detail = classify(source);
    if (!detail) continue;
    counts[detail.reason]++;
    details.push(detail);
  }
  const mobile = rows.filter(r => selectedIds.has(r.journeyId) && r.driver === "mobile"
    && matchesDiagnosticFilters(r, filters) && isCjMobileEligible(r)
    && pisteInWindow(r.eventDate, t0.get(r.journeyId) ?? null));
  const active = mobile.filter(valid);
  const period = active.filter(r => inCjInsertPeriod(r.insertedAt, from, to)).length;
  const later = active.filter(r => !!to && !!r.insertedAt && r.insertedAt.slice(0, 10) > to).length;
  const earlierOrUndated = active.length - period - later;
  const outcomes = { drmsPaid: 0, drmsRecredited: 0, drmsNegative: 0, drmsNone: 0, manualPositive: 0, manualNegative: 0, manualNone: 0, manualGettone: 0 };
  for (const r of mobile) {
    if (!isCjMobileEligible(r)) continue;
    if (r.gettoneConfirmed) outcomes.manualGettone++;
    if (r.drmsOutcomeState === "pagato") outcomes.drmsPaid++;
    else if (r.drmsOutcomeState === "riaccreditato") outcomes.drmsRecredited++;
    else if (r.drmsOutcomeState) outcomes.drmsNegative++;
    else outcomes.drmsNone++;
    if (r.economicStateManual) {
      if (["pagato", "riaccreditato"].includes(r.economicState ?? "")) outcomes.manualPositive++;
      else if (r.economicState) outcomes.manualNegative++;
      else outcomes.manualNone++;
    }
  }
  const confirmed = selected.map(j => ({
    journeyId: j.journeyId, cliente: j.cliente,
    real: j.gettoneBaseEsplicito + j.extraEsplicito,
    includingPresumed: j.fatturatoMaturato,
    base: j.gettoneBase, extra: j.extraStimato, extraCoppie: j.extraCoppie,
    baseExplicit: j.gettoneBaseEsplicito, extraExplicit: j.extraEsplicito,
    presumed: j.gettoneBasePresunto + j.extraPresunto,
    manualConfirmed: j.gettoneBaseConfermato + j.extraConfermato,
  }));
  return {
    details, counts, sourceTotal: details.length, period, later, earlierOrUndated,
    cumulative: active.length, clients: selected.length, outcomes, mobile,
    // Never force equality: stale/missing links remain a visible discrepancy.
    discrepancy: period - counts.admitted, confirmed,
    confirmedTotal: confirmed.reduce((sum, j) => sum + j.real, 0),
    includingPresumedTotal: confirmed.reduce((sum, j) => sum + j.includingPresumed, 0),
  };
}
