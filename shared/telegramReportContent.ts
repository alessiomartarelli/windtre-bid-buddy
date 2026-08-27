// Configurazione mensile dei CONTENUTI del report Telegram (Task #515):
// quali piste compaiono nel testo e nell'allegato HTML, e quali piste
// concorrono ai "migliori del giorno" TELCO e NEW CORE (classificati per
// numero totale di pezzi nelle piste selezionate del gruppo). Logica PURA,
// nessun import runtime oltre alla classificazione condivisa: caricabile
// via loader tsx nei test senza server né DB.
//
// La configurazione vive in gara_config.config.telegramReportContent
// (per-org/per-mese, insieme a venditeForecast e performanceWeights).
// Configurazioni mancanti o storiche ⇒ default compatibili col report
// attuale (tutte le piste visibili, TELCO = mobile+fisso, NEW CORE =
// assicurazioni+energia), salvo il gating brand Vodafone che rimuove
// SEMPRE la pista protecta (nessun "Protetti"/"Verisure" nel report VF).
import type { PistaCanvass } from "./bisuiteClassification";
import type {
  AddettoReportAggregate,
  DailyReportAggregates,
  PdvReportAggregate,
  ReportDrilldown,
} from "./venditeReport";

/** Piste selezionabili nel report Telegram (whitelist, ordine UI). */
export const TELEGRAM_REPORT_PISTE: readonly PistaCanvass[] = [
  "mobile",
  "fisso",
  "cb",
  "assicurazioni",
  "protecta",
  "energia",
] as const;

export interface TelegramReportContentConfig {
  /** Piste mostrate nel testo e nell'allegato HTML. */
  pisteVisibili: PistaCanvass[];
  /** Piste che concorrono al migliore TELCO del giorno. */
  telcoPiste: PistaCanvass[];
  /** Piste che concorrono al migliore NEW CORE del giorno. */
  newCorePiste: PistaCanvass[];
}

/**
 * Default legacy-compatibili: tutte le piste visibili; TELCO e NEW CORE
 * allineati ai KPI "TELCO"/"New Core" storici del report (fisso+mobile e
 * assicurazioni+energia).
 */
export const DEFAULT_TELEGRAM_REPORT_CONTENT: TelegramReportContentConfig = {
  pisteVisibili: [...TELEGRAM_REPORT_PISTE],
  telcoPiste: ["mobile", "fisso"],
  newCorePiste: ["assicurazioni", "energia"],
};

function normalizePiste(raw: unknown, fallback: PistaCanvass[]): PistaCanvass[] {
  if (!Array.isArray(raw)) return [...fallback];
  const seen = new Set<PistaCanvass>();
  for (const v of raw) {
    const p = String(v) as PistaCanvass;
    if ((TELEGRAM_REPORT_PISTE as readonly string[]).includes(p)) seen.add(p);
  }
  // Ordine stabile della whitelist, indipendente dall'ordine salvato.
  return TELEGRAM_REPORT_PISTE.filter((p) => seen.has(p));
}

/**
 * Normalizza il blocco salvato in gara_config. Blocco assente o non
 * oggetto ⇒ default legacy. Ogni campo non-array ricade sul suo default;
 * i valori fuori whitelist sono scartati. Un array PRESENTE ma vuoto è
 * rispettato (selezione esplicita "niente").
 */
export function parseTelegramReportContent(raw: unknown): TelegramReportContentConfig {
  if (raw === null || raw === undefined || typeof raw !== "object" || Array.isArray(raw)) {
    return {
      pisteVisibili: [...DEFAULT_TELEGRAM_REPORT_CONTENT.pisteVisibili],
      telcoPiste: [...DEFAULT_TELEGRAM_REPORT_CONTENT.telcoPiste],
      newCorePiste: [...DEFAULT_TELEGRAM_REPORT_CONTENT.newCorePiste],
    };
  }
  const o = raw as Record<string, unknown>;
  return {
    pisteVisibili: normalizePiste(o.pisteVisibili, DEFAULT_TELEGRAM_REPORT_CONTENT.pisteVisibili),
    telcoPiste: normalizePiste(o.telcoPiste, DEFAULT_TELEGRAM_REPORT_CONTENT.telcoPiste),
    newCorePiste: normalizePiste(o.newCorePiste, DEFAULT_TELEGRAM_REPORT_CONTENT.newCorePiste),
  };
}

/**
 * Gating brand Vodafone/Fastweb (Task #515): per le org VF il report non
 * deve contenere NESSUN riferimento a "Protetti" né "Verisure" ⇒ la pista
 * protecta è rimossa da visibili e da entrambi i gruppi, qualunque cosa
 * dica la configurazione salvata.
 */
export function applyBrandGating(
  cfg: TelegramReportContentConfig,
  isVfOrg: boolean,
): TelegramReportContentConfig {
  if (!isVfOrg) return cfg;
  const drop = (list: PistaCanvass[]) => list.filter((p) => p !== "protecta");
  return {
    pisteVisibili: drop(cfg.pisteVisibili),
    telcoPiste: drop(cfg.telcoPiste),
    newCorePiste: drop(cfg.newCorePiste),
  };
}

/** Vero se la pista va mostrata nel report. */
export function isPistaVisible(cfg: TelegramReportContentConfig, pista: PistaCanvass): boolean {
  return cfg.pisteVisibili.includes(pista);
}

/** Piste effettive di un gruppo: intersezione col set visibile. */
export function effectiveGroupPiste(
  cfg: TelegramReportContentConfig,
  group: "telco" | "newcore",
): PistaCanvass[] {
  const base = group === "telco" ? cfg.telcoPiste : cfg.newCorePiste;
  return base.filter((p) => cfg.pisteVisibili.includes(p));
}

/** Somma dei pezzi delle piste indicate in un drill-down. */
export function groupPezziOf(d: ReportDrilldown, piste: PistaCanvass[]): number {
  return piste.reduce((s, p) => s + (d.countByPista[p] ?? 0), 0);
}

export interface GroupWinner {
  nome: string;
  /** Pezzi totali nelle piste selezionate del gruppo. */
  pezzi: number;
}

/**
 * Miglior addetto e miglior negozio per SOMMA PEZZI nelle piste del gruppo.
 * Pareggio deterministico: a parità di pezzi vince chi viene prima
 * nell'ordinamento esistente degli aggregati (serve strettamente di più per
 * superare). Esclude "N/D"; nessuno sopra zero ⇒ null.
 */
export function buildGroupTopByPezzi(
  a: DailyReportAggregates,
  piste: PistaCanvass[],
): { addetto: GroupWinner | null; negozio: GroupWinner | null } {
  if (piste.length === 0) return { addetto: null, negozio: null };
  const best = <T,>(
    items: T[],
    getNome: (x: T) => string,
    getDrill: (x: T) => ReportDrilldown,
  ): GroupWinner | null => {
    let win: GroupWinner | null = null;
    for (const it of items) {
      const nome = getNome(it);
      if (!nome || nome === "N/D") continue;
      const pezzi = groupPezziOf(getDrill(it), piste);
      if (pezzi > 0 && (win === null || pezzi > win.pezzi)) win = { nome, pezzi };
    }
    return win;
  };
  return {
    addetto: best(
      a.perAddetto,
      (x: AddettoReportAggregate) => x.nomeAddetto,
      (x) => x.dettaglio,
    ),
    negozio: best(
      a.perPdv,
      (x: PdvReportAggregate) => (x.nomeNegozio ?? "").trim() || x.codicePos,
      (x) => x.dettaglio,
    ),
  };
}
