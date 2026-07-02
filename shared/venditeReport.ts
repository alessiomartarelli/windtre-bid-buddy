// Report vendite giornaliero (Task #239): logica PURA di aggregazione e
// formattazione del messaggio Telegram con il riepilogo delle vendite del
// giorno, coerente con la pagina "Vendite BiSuite". Nessun import runtime
// oltre alla classificazione condivisa: caricabile via loader tsx nei test
// senza dev server né DB.
import {
  classifySaleArticles,
  PISTA_CANVASS_LABELS,
  TYPE_LABELS,
  type ArticleType,
  type PistaCanvass,
} from "./bisuiteClassification";

// Shape minimale della vendita necessaria al report: sottoinsieme di
// `BisuiteSale` (shared/schema.ts) senza dipendere da Drizzle.
export interface VenditaReportRow {
  stato: string | null;
  totale: string | null;
  codicePos: string | null;
  nomeNegozio: string | null;
  /** Addetto vendita (opzionale: usato dal report HTML per addetto). */
  nomeAddetto?: string | null;
  rawData: unknown;
}

export interface PdvReportAggregate {
  codicePos: string;
  nomeNegozio: string;
  vendite: number;
  importo: number;
}

export interface AddettoReportAggregate {
  /** Grafia visualizzata (prima occorrenza incontrata). */
  nomeAddetto: string;
  vendite: number;
  importo: number;
}

export interface PistaCategoriaAggregate {
  /** Nome categoria BiSuite (es. "UNTIED", "TIED CF"). */
  categoria: string;
  pezzi: number;
}

export interface DailyReportAggregates {
  /** Vendite non annullate considerate nel report. */
  vendite: number;
  /** Somma dei totali vendita (campo `totale`). */
  importo: number;
  countByType: Record<ArticleType, number>;
  amountByType: Record<ArticleType, number>;
  countByPista: Partial<Record<PistaCanvass, number>>;
  amountByPista: Partial<Record<PistaCanvass, number>>;
  /**
   * Breakdown per categoria dentro ogni pista (es. mobile ⇒ UNTIED/TIED CF),
   * ordinato per pezzi decrescenti. Usato dalle card pista del report HTML.
   */
  categorieByPista: Partial<Record<PistaCanvass, PistaCategoriaAggregate[]>>;
  /** Aggregato per punto vendita, ordinato per importo decrescente. */
  perPdv: PdvReportAggregate[];
  /**
   * Aggregato per addetto (grouping case-insensitive sul nominativo),
   * ordinato per importo decrescente. Usato dal report HTML allegato.
   */
  perAddetto: AddettoReportAggregate[];
}

function isAnnullata(stato: string | null | undefined): boolean {
  return (stato ?? "").trim().toUpperCase() === "ANNULLATA";
}

function parseTotale(totale: string | null | undefined): number {
  const n = parseFloat(totale ?? "0");
  return Number.isFinite(n) ? n : 0;
}

/**
 * Aggrega le vendite del giorno come la pagina Vendite BiSuite:
 * - le vendite ANNULLATA sono ESCLUSE da tutti i conteggi;
 * - pezzi/importi per Tipo e Pista sono a livello articolo
 *   (classifySaleArticles su rawData);
 * - l'importo totale e quello per PDV usano il campo `totale` della vendita.
 */
export function aggregateDailyReport(rows: VenditaReportRow[]): DailyReportAggregates {
  const countByType: Record<ArticleType, number> = { canvass: 0, prodotti: 0, servizi: 0 };
  const amountByType: Record<ArticleType, number> = { canvass: 0, prodotti: 0, servizi: 0 };
  const countByPista: Partial<Record<PistaCanvass, number>> = {};
  const amountByPista: Partial<Record<PistaCanvass, number>> = {};
  const catByPista: Partial<Record<PistaCanvass, Map<string, number>>> = {};
  const pdvMap = new Map<string, PdvReportAggregate>();
  const addettoMap = new Map<string, AddettoReportAggregate>();
  let vendite = 0;
  let importo = 0;

  for (const row of rows) {
    if (isAnnullata(row.stato)) continue;
    vendite++;
    const tot = parseTotale(row.totale);
    importo += tot;

    const sc = classifySaleArticles(row.rawData);
    for (const t of Object.keys(sc.countByType) as ArticleType[]) {
      countByType[t] += sc.countByType[t];
      amountByType[t] += sc.amountByType[t];
    }
    for (const [pista, count] of Object.entries(sc.countByPista) as [PistaCanvass, number][]) {
      countByPista[pista] = (countByPista[pista] ?? 0) + count;
      amountByPista[pista] = (amountByPista[pista] ?? 0) + (sc.amountByPista[pista] ?? 0);
    }
    for (const article of sc.articles) {
      if (!article.pista) continue;
      const catLabel = article.categoriaNome.trim() || "Altro";
      const map = catByPista[article.pista] ?? new Map<string, number>();
      map.set(catLabel, (map.get(catLabel) ?? 0) + 1);
      catByPista[article.pista] = map;
    }

    const key = (row.codicePos ?? "").trim() || "N/D";
    const existing = pdvMap.get(key);
    if (existing) {
      existing.vendite++;
      existing.importo += tot;
      if (!existing.nomeNegozio && row.nomeNegozio) existing.nomeNegozio = row.nomeNegozio.trim();
    } else {
      pdvMap.set(key, {
        codicePos: key,
        nomeNegozio: (row.nomeNegozio ?? "").trim(),
        vendite: 1,
        importo: tot,
      });
    }

    // Per addetto: grouping case-insensitive (le grafie diverse dello
    // stesso nominativo si fondono, come nelle gare addetto).
    const addettoName = (row.nomeAddetto ?? "").trim() || "N/D";
    const addettoKey = addettoName.toLowerCase();
    const existingAdd = addettoMap.get(addettoKey);
    if (existingAdd) {
      existingAdd.vendite++;
      existingAdd.importo += tot;
    } else {
      addettoMap.set(addettoKey, { nomeAddetto: addettoName, vendite: 1, importo: tot });
    }
  }

  const perPdv = Array.from(pdvMap.values()).sort(
    (a, b) => b.importo - a.importo || b.vendite - a.vendite || a.codicePos.localeCompare(b.codicePos, "it"),
  );
  const perAddetto = Array.from(addettoMap.values()).sort(
    (a, b) => b.importo - a.importo || b.vendite - a.vendite || a.nomeAddetto.localeCompare(b.nomeAddetto, "it"),
  );

  const categorieByPista: Partial<Record<PistaCanvass, PistaCategoriaAggregate[]>> = {};
  for (const [pista, map] of Object.entries(catByPista) as [PistaCanvass, Map<string, number>][]) {
    categorieByPista[pista] = Array.from(map.entries())
      .map(([categoria, pezzi]) => ({ categoria, pezzi }))
      .sort((a, b) => b.pezzi - a.pezzi || a.categoria.localeCompare(b.categoria, "it"));
  }

  return {
    vendite,
    importo,
    countByType,
    amountByType,
    countByPista,
    amountByPista,
    categorieByPista,
    perPdv,
    perAddetto,
  };
}

// ---------------------------------------------------------------------------
// Trend giornaliero (Task #250): serie per-giorno usata dal report HTML per
// grafici di andamento, sparkline per pista e confronti oggi/ieri/media.
// ---------------------------------------------------------------------------

/** Riga vendita con la data: serve solo al bucketing per giorno. */
export interface VenditaTrendRow extends VenditaReportRow {
  dataVendita?: Date | string | null;
}

export interface TrendDay {
  /** Giorno YYYY-MM-DD (data italiana della vendita). */
  ymd: string;
  vendite: number;
  importo: number;
  countByPista: Partial<Record<PistaCanvass, number>>;
}

/**
 * Estrae il giorno YYYY-MM-DD da `dataVendita`. La colonna è un timestamp
 * senza timezone che contiene già il wall time italiano: per i Date usiamo
 * i getter locali (pg li parse-a come ora locale), per le stringhe il
 * prefisso YYYY-MM-DD. Valore assente o non riconoscibile ⇒ null.
 */
export function trendYmdOf(v: Date | string | null | undefined): string | null {
  if (v == null) return null;
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return null;
    const mm = String(v.getMonth() + 1).padStart(2, "0");
    const dd = String(v.getDate()).padStart(2, "0");
    return `${v.getFullYear()}-${mm}-${dd}`;
  }
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(String(v).trim());
  return m ? m[1] : null;
}

/** Somma `days` giorni (anche negativi) a un YYYY-MM-DD, in aritmetica UTC. */
export function addYmdDays(ymd: string, days: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd.trim());
  if (!m) return ymd;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3] + days));
  return d.toISOString().slice(0, 10);
}

/**
 * Costruisce la serie per-giorno nell'intervallo [fromYMD..toYMD] (estremi
 * inclusi, giorni mancanti riempiti a zero, ordine crescente). Le vendite
 * ANNULLATA e le righe senza data riconoscibile o fuori intervallo sono
 * escluse. Intervallo non valido o rovesciato ⇒ [].
 */
export function buildDailyTrend(rows: VenditaTrendRow[], fromYMD: string, toYMD: string): TrendDay[] {
  const re = /^\d{4}-\d{2}-\d{2}$/;
  if (!re.test(fromYMD.trim()) || !re.test(toYMD.trim()) || fromYMD > toYMD) return [];

  const byDay = new Map<string, TrendDay>();
  for (let ymd = fromYMD; ymd <= toYMD; ymd = addYmdDays(ymd, 1)) {
    byDay.set(ymd, { ymd, vendite: 0, importo: 0, countByPista: {} });
  }

  for (const row of rows) {
    if (isAnnullata(row.stato)) continue;
    const ymd = trendYmdOf(row.dataVendita);
    if (!ymd) continue;
    const day = byDay.get(ymd);
    if (!day) continue;
    day.vendite++;
    day.importo += parseTotale(row.totale);
    const sc = classifySaleArticles(row.rawData);
    for (const [pista, count] of Object.entries(sc.countByPista) as [PistaCanvass, number][]) {
      day.countByPista[pista] = (day.countByPista[pista] ?? 0) + count;
    }
  }

  return Array.from(byDay.values());
}

/** Primo giorno del mese di un YYYY-MM-DD (es. "2026-07-15" ⇒ "2026-07-01"). */
export function monthStartYmd(ymd: string): string {
  const m = /^(\d{4})-(\d{2})-\d{2}$/.exec(ymd.trim());
  return m ? `${m[1]}-${m[2]}-01` : ymd;
}

/** Etichetta italiana del mese di un YYYY-MM-DD (es. "luglio 2026"). */
export function monthLabelOf(ymd: string): string {
  const m = /^(\d{4})-(\d{2})-\d{2}$/.exec(ymd.trim());
  if (!m) return ymd;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, 1));
  return d.toLocaleDateString("it-IT", { month: "long", year: "numeric", timeZone: "UTC" });
}

export interface DayHistoryEntry {
  ymd: string;
  aggregates: DailyReportAggregates;
}

/**
 * Storico per-giorno con aggregati COMPLETI (stessa shape del report
 * giornaliero) nell'intervallo [fromYMD..toYMD]: estremi inclusi, giorni
 * senza vendite presenti con aggregati a zero, ordine crescente. Serve
 * alle pagine navigabili dell'allegato HTML. Intervallo non valido o
 * rovesciato ⇒ [].
 */
export function buildDailyHistory(
  rows: VenditaTrendRow[],
  fromYMD: string,
  toYMD: string,
): DayHistoryEntry[] {
  const re = /^\d{4}-\d{2}-\d{2}$/;
  if (!re.test(fromYMD.trim()) || !re.test(toYMD.trim()) || fromYMD > toYMD) return [];

  const byDay = new Map<string, VenditaTrendRow[]>();
  for (let ymd = fromYMD; ymd <= toYMD; ymd = addYmdDays(ymd, 1)) {
    byDay.set(ymd, []);
  }
  for (const row of rows) {
    const ymd = trendYmdOf(row.dataVendita);
    if (!ymd) continue;
    byDay.get(ymd)?.push(row);
  }
  return Array.from(byDay.entries()).map(([ymd, dayRows]) => ({
    ymd,
    aggregates: aggregateDailyReport(dayRows),
  }));
}

/**
 * Variazione percentuale arrotondata di `current` rispetto a `previous`.
 * `previous` non positivo o non finito ⇒ null (delta non calcolabile).
 */
export function pctDelta(current: number, previous: number): number | null {
  if (!Number.isFinite(previous) || previous <= 0 || !Number.isFinite(current)) return null;
  return Math.round(((current - previous) / previous) * 100);
}

// Ordine fisso delle piste nel messaggio (stesso ordine della UI).
export const REPORT_PISTA_ORDER: PistaCanvass[] = [
  "mobile",
  "fisso",
  "cb",
  "assicurazioni",
  "protecta",
  "energia",
];

export const REPORT_TYPE_ORDER: ArticleType[] = ["canvass", "prodotti", "servizi"];

/** Formatta un importo in euro stile it-IT (1.234,56 €), stabile cross-locale. */
export function fmtEuro(v: number): string {
  const sign = v < 0 ? "-" : "";
  const abs = Math.abs(v);
  const [intPart, decPart] = abs.toFixed(2).split(".");
  const withThousands = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${sign}${withThousands},${decPart} €`;
}

function escapeTelegramHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Formatta una data YYYY-MM-DD come DD/MM/YYYY per l'intestazione.
 * Input non valido → restituito com'è (già escapato a valle).
 */
export function fmtReportDate(ymd: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd.trim());
  if (!m) return ymd;
  return `${m[3]}/${m[2]}/${m[1]}`;
}

export interface TelegramReportParams {
  orgName: string;
  /** Data italiana del report in formato YYYY-MM-DD. */
  dateYMD: string;
  /** Etichetta oraria (es. "13:30") mostrata nell'intestazione. */
  timeLabel?: string;
  aggregates: DailyReportAggregates;
}

/**
 * Costruisce il messaggio Telegram (parse_mode HTML) con il riepilogo del
 * giorno. Compatto e leggibile su mobile; mostra solo le voci con almeno
 * un pezzo. Le vendite ANNULLATA sono già escluse dagli aggregati.
 */
export function buildTelegramReportMessage(p: TelegramReportParams): string {
  const a = p.aggregates;
  const lines: string[] = [];
  const header = `📊 <b>Report vendite ${escapeTelegramHtml(fmtReportDate(p.dateYMD))}</b>` +
    (p.timeLabel ? ` — ${escapeTelegramHtml(p.timeLabel)}` : "");
  lines.push(header);
  lines.push(`🏢 ${escapeTelegramHtml(p.orgName)}`);
  lines.push("");

  if (a.vendite === 0) {
    lines.push("Nessuna vendita registrata oggi.");
    return lines.join("\n");
  }

  lines.push(`🧾 Vendite: <b>${a.vendite}</b>`);
  lines.push(`💶 Importo totale: <b>${fmtEuro(a.importo)}</b>`);

  const typeLines = REPORT_TYPE_ORDER
    .filter((t) => a.countByType[t] > 0)
    .map((t) => `• ${TYPE_LABELS[t]}: ${a.countByType[t]} pz — ${fmtEuro(a.amountByType[t])}`);
  if (typeLines.length > 0) {
    lines.push("");
    lines.push("<b>Per tipo</b>");
    lines.push(...typeLines);
  }

  const pistaLines = REPORT_PISTA_ORDER
    .filter((pista) => (a.countByPista[pista] ?? 0) > 0)
    .map((pista) =>
      `• ${PISTA_CANVASS_LABELS[pista]}: ${a.countByPista[pista]} pz — ${fmtEuro(a.amountByPista[pista] ?? 0)}`,
    );
  if (pistaLines.length > 0) {
    lines.push("");
    lines.push("<b>Per pista</b>");
    lines.push(...pistaLines);
  }

  if (a.perPdv.length > 0) {
    lines.push("");
    lines.push("<b>Per punto vendita</b>");
    for (const pdv of a.perPdv) {
      const label = pdv.nomeNegozio ? `${pdv.nomeNegozio} (${pdv.codicePos})` : pdv.codicePos;
      lines.push(`• ${escapeTelegramHtml(label)}: ${pdv.vendite} vendite — ${fmtEuro(pdv.importo)}`);
    }
  }

  return lines.join("\n");
}
