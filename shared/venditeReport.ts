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
  rawData: unknown;
}

export interface PdvReportAggregate {
  codicePos: string;
  nomeNegozio: string;
  vendite: number;
  importo: number;
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
  /** Aggregato per punto vendita, ordinato per importo decrescente. */
  perPdv: PdvReportAggregate[];
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
  const pdvMap = new Map<string, PdvReportAggregate>();
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
  }

  const perPdv = Array.from(pdvMap.values()).sort(
    (a, b) => b.importo - a.importo || b.vendite - a.vendite || a.codicePos.localeCompare(b.codicePos, "it"),
  );

  return { vendite, importo, countByType, amountByType, countByPista, amountByPista, perPdv };
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
