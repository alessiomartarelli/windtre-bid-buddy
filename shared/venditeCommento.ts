// Report vendite Telegram (Task #266): generatore PURO del commento in
// stile "direttore vendite". Dati gli aggregati del giorno e del mese, il
// forecast configurato e la fascia (parziale 13:30 / chiusura 22:30),
// produce un testo discorsivo con delta % e proiezioni, standout
// negozio/addetto e uno spunto strategico. Nessuna AI: frasi predefinite a
// fasce, selezione deterministica legata alla data (varietà giorno-per-
// giorno ma test stabili). Caricabile via loader tsx senza server/DB.
import {
  type DailyReportAggregates,
  buildTopPerKpi,
  telefoniPezziOf,
  businessPezziOf,
  accessoriImportoOf,
  projectMonthEnd,
  pctDelta,
  fmtEuro,
} from "./venditeReport";

export type Fascia = "parziale" | "chiusura";

export type PerformanceBand = "moltoSopra" | "sopra" | "inLinea" | "sotto" | "moltoSotto";

/**
 * Forecast mensile per organizzazione. Ogni campo è opzionale: se una
 * dimensione è null/assente il commento semplicemente non la valuta.
 */
export interface ForecastConfig {
  /** Volumi Mobile (pista mobile) attesi nel mese. */
  mobileVolumi: number | null;
  /** Di cui SIM Mobile a P.IVA (clienti business) attese nel mese. */
  mobileIvaVolumi: number | null;
  /** Volumi Fisso (pista fisso) attesi nel mese. */
  fissoVolumi: number | null;
  /** Di cui Fisso a P.IVA (clienti business) attesi nel mese. */
  fissoIvaVolumi: number | null;
  /** Volumi Energia attesi nel mese. */
  energiaVolumi: number | null;
  /** Volumi Assicurazioni attesi nel mese. */
  assicurazioniVolumi: number | null;
  /** Volumi Protetti (pista protecta) attesi nel mese. */
  protettiVolumi: number | null;
  /** Volumi Cb (pista cb) attesi nel mese. */
  cbVolumi: number | null;
  /** Pezzi Telefoni (categoria TELEFONIA) attesi nel mese. */
  telefoniPezzi: number | null;
  /** Fatturato Accessori atteso nel mese (€). */
  accessoriFatturato: number | null;
  /** Fatturato Servizi atteso nel mese (€). */
  serviziFatturato: number | null;
  /** Numero negozi Corner/CC (giorni lavorativi incl. domeniche, no festivi). */
  numeroNegoziCc: number | null;
  /** Numero negozi Strada (giorni lavorativi no domeniche, no festivi). */
  numeroNegoziStrada: number | null;
}

export const EMPTY_FORECAST: ForecastConfig = {
  mobileVolumi: null,
  mobileIvaVolumi: null,
  fissoVolumi: null,
  fissoIvaVolumi: null,
  energiaVolumi: null,
  assicurazioniVolumi: null,
  protettiVolumi: null,
  cbVolumi: null,
  telefoniPezzi: null,
  accessoriFatturato: null,
  serviziFatturato: null,
  numeroNegoziCc: null,
  numeroNegoziStrada: null,
};

/**
 * Normalizza il blocco forecast salvato in config (i campi possono arrivare
 * come stringhe dal form). Valori non numerici o <= 0 ⇒ null (dimensione
 * non valutata).
 */
export function parseForecastConfig(raw: unknown): ForecastConfig {
  const o = (raw ?? {}) as Record<string, unknown>;
  const num = (v: unknown): number | null => {
    if (v === null || v === undefined || v === "") return null;
    const n = typeof v === "number" ? v : parseFloat(String(v).replace(",", "."));
    return Number.isFinite(n) && n > 0 ? n : null;
  };
  return {
    mobileVolumi: num(o.mobileVolumi),
    mobileIvaVolumi: num(o.mobileIvaVolumi),
    fissoVolumi: num(o.fissoVolumi),
    fissoIvaVolumi: num(o.fissoIvaVolumi),
    energiaVolumi: num(o.energiaVolumi),
    assicurazioniVolumi: num(o.assicurazioniVolumi),
    protettiVolumi: num(o.protettiVolumi),
    cbVolumi: num(o.cbVolumi),
    telefoniPezzi: num(o.telefoniPezzi),
    accessoriFatturato: num(o.accessoriFatturato),
    serviziFatturato: num(o.serviziFatturato),
    numeroNegoziCc: num(o.numeroNegoziCc),
    numeroNegoziStrada: num(o.numeroNegoziStrada),
  };
}

/** Vero se almeno una dimensione forecast è impostata. */
export function hasForecast(fc: ForecastConfig): boolean {
  return (
    fc.mobileVolumi !== null ||
    fc.mobileIvaVolumi !== null ||
    fc.fissoVolumi !== null ||
    fc.fissoIvaVolumi !== null ||
    fc.energiaVolumi !== null ||
    fc.assicurazioniVolumi !== null ||
    fc.protettiVolumi !== null ||
    fc.cbVolumi !== null ||
    fc.telefoniPezzi !== null ||
    fc.accessoriFatturato !== null ||
    fc.serviziFatturato !== null
  );
}

/** Fascia dall'etichetta oraria: 22:xx ⇒ chiusura, tutto il resto ⇒ parziale. */
export function fasciaFromTimeLabel(label?: string | null): Fascia {
  return (label ?? "").trim().startsWith("22") ? "chiusura" : "parziale";
}

function escTg(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function bandOf(deltaPct: number | null): PerformanceBand {
  if (deltaPct === null) return "inLinea";
  if (deltaPct >= 15) return "moltoSopra";
  if (deltaPct >= 5) return "sopra";
  if (deltaPct <= -15) return "moltoSotto";
  if (deltaPct <= -5) return "sotto";
  return "inLinea";
}

// Hash FNV-1a della data ⇒ seme intero stabile per la selezione delle frasi.
function seedFromYMD(ymd: string): number {
  let h = 2166136261;
  for (let i = 0; i < ymd.length; i++) {
    h ^= ymd.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function pick<T>(pool: T[], seed: number): T {
  return pool[seed % pool.length];
}

// Segnato per delta % (+ esplicito sui positivi, minus nativo sui negativi).
function signedPct(v: number): string {
  return `${v >= 0 ? "+" : ""}${v}%`;
}

// Chiude una frase con il punto, salvo che termini già con . ! ? (le frasi
// di apertura "col botto!" / "che giornata!" non devono diventare "!.").
function withPeriod(s: string): string {
  return /[.!?]$/.test(s.trim()) ? s : s + ".";
}

interface DimInput {
  label: string;
  unit: "pz" | "€";
  forecast: number | null;
  today: number;
  month: number;
}

interface DimEval {
  label: string;
  unit: "pz" | "€";
  forecast: number;
  today: number;
  month: number;
  /** Delta % del mese vs passo atteso a oggi (null se passo non calcolabile). */
  monthDeltaPct: number | null;
  /** Delta % di oggi vs obiettivo giornaliero (null se non calcolabile). */
  todayDeltaPct: number | null;
  /** Proiezione a fine mese arrotondata (null se non calcolabile). */
  projection: number | null;
}

function fmtVal(unit: "pz" | "€", v: number): string {
  return unit === "€" ? fmtEuro(v) : String(Math.round(v));
}

function evalDim(d: DimInput, elapsed: number, total: number): DimEval | null {
  if (d.forecast === null || d.forecast <= 0) return null;
  const dailyTarget = total > 0 ? d.forecast / total : null;
  const expectedToDate = total > 0 ? (d.forecast * Math.min(elapsed, total)) / total : null;
  const projection = projectMonthEnd(d.month, elapsed, total);
  return {
    label: d.label,
    unit: d.unit,
    forecast: d.forecast,
    today: d.today,
    month: d.month,
    monthDeltaPct: expectedToDate !== null ? pctDelta(d.month, expectedToDate) : null,
    todayDeltaPct: dailyTarget !== null ? pctDelta(d.today, dailyTarget) : null,
    projection: projection === null ? null : Math.round(projection),
  };
}

function nomePdv(p: { nomeNegozio: string; codicePos: string }): string {
  return p.nomeNegozio?.trim() ? p.nomeNegozio.trim() : p.codicePos;
}

// ── Pool di frasi per fascia e banda di performance ──────────────────────

const APERTURA: Record<Fascia, Record<PerformanceBand, string[]>> = {
  parziale: {
    moltoSopra: [
      "☀️ Buongiorno team! A metà giornata la macchina gira alla grande",
      "☀️ Che partenza, squadra: siamo lanciati",
      "☀️ Mattinata da incorniciare, team",
    ],
    sopra: [
      "☀️ Buongiorno team! A metà giornata siamo in bella spinta",
      "☀️ Si parte con il piede giusto, squadra",
      "☀️ Buongiorno! La mattinata ci sorride",
    ],
    inLinea: [
      "☀️ Buongiorno team! A metà giornata siamo in linea col passo",
      "☀️ Squadra, mattinata regolare, sui binari giusti",
      "☀️ Buongiorno! Andiamo di conserva, senza strappi",
    ],
    sotto: [
      "☀️ Buongiorno team! A metà giornata siamo un filo sotto ritmo",
      "☀️ Squadra, la mattinata parte in leggera salita",
      "☀️ Buongiorno! Serve una marcia in più",
    ],
    moltoSotto: [
      "☀️ Buongiorno team! A metà giornata siamo indietro, testa alta",
      "☀️ Squadra, mattinata in affanno: rimbocchiamoci le maniche",
      "☀️ Buongiorno! Giornata da raddrizzare, ci crediamo",
    ],
  },
  chiusura: {
    moltoSopra: [
      "🌙 Giornata in archivio, e che giornata!",
      "🌙 Chiusura col botto, squadra!",
      "🌙 Serata di grande soddisfazione, team",
    ],
    sopra: [
      "🌙 Giornata in archivio con il segno più",
      "🌙 Chiusura positiva, squadra",
      "🌙 Buona giornata, team: portiamo a casa il risultato",
    ],
    inLinea: [
      "🌙 Giornata in archivio, in linea col passo previsto",
      "🌙 Chiusura regolare, squadra",
      "🌙 Giornata solida, senza sorprese",
    ],
    sotto: [
      "🌙 Giornata in archivio un po' sotto il passo",
      "🌙 Chiusura in leggera ombra, squadra",
      "🌙 Giornata sotto le attese, ne parliamo domani",
    ],
    moltoSotto: [
      "🌙 Giornata in archivio in salita",
      "🌙 Chiusura difficile, squadra: da qui si riparte",
      "🌙 Giornata storta, la lasciamo alle spalle",
    ],
  },
};

const CHIUSURA_MOTIVAZIONALE: Record<Fascia, Record<PerformanceBand, string[]>> = {
  parziale: {
    moltoSopra: ["Teniamo questo ritmo nel pomeriggio! 🚀", "Pomeriggio a tutto gas, non molliamo. 🚀"],
    sopra: ["Spingiamo nel pomeriggio per allungare. 💪", "Seconda parte di giornata di slancio. 💪"],
    inLinea: ["Nel pomeriggio possiamo alzare l'asticella. 💪", "Ora diamo la spinta in più. 💪"],
    sotto: ["C'è tutto il pomeriggio per recuperare. 💪", "Rimettiamoci in scia nel pomeriggio. 💪"],
    moltoSotto: ["Il pomeriggio è tutto da giocare, sotto! 💪", "Testa bassa e recuperiamo, si può. 💪"],
  },
  chiusura: {
    moltoSopra: ["Portiamo questa energia anche domani. 👏", "Grande squadra, continuiamo così! 👏"],
    sopra: ["Bel lavoro, domani si replica. 👏", "Continuiamo su questa strada. 👏"],
    inLinea: ["Domani proviamo a spingere ancora. 💪", "Passo costante, domani un guizzo in più. 💪"],
    sotto: ["Domani ripartiamo più forti. 💪", "Ci rifacciamo domani, testa alta. 💪"],
    moltoSotto: ["Reset e domani si riparte con un'altra energia. 💪", "Ne usciamo insieme, domani nuova pagina. 💪"],
  },
};

const VUOTO_PARZIALE: string[] = [
  "Mattinata ancora al palo: nessuna vendita a referto, ma c'è tutto il tempo per carburare.",
  "Si parte piano: per ora tabellone fermo, la prima vendita rompe il ghiaccio.",
  "Ancora zero sul tabellone stamattina: prepariamo la rimonta.",
];

const VUOTO_CHIUSURA: string[] = [
  "Giornata al palo: oggi niente vendite a referto. Capita, resettiamo e domani si riparte.",
  "Tabellone fermo per oggi: archiviamo e ripartiamo domani con più cattiveria agonistica.",
  "Nessuna vendita oggi: giornata da dimenticare, la testa è già a domani.",
];

export interface CommentoParams {
  fascia: Fascia;
  /** Data italiana YYYY-MM-DD: seme della selezione frasi. */
  dateYMD: string;
  forecast: ForecastConfig;
  /** Aggregati del giorno (parziale o pieno). */
  today: DailyReportAggregates;
  /** Aggregati mese-a-oggi. */
  month: DailyReportAggregates;
  elapsedWorkingDays: number;
  totalWorkingDays: number;
}

/**
 * Genera il commento discorsivo del report. Ritorna testo con markup
 * Telegram (parse_mode HTML): i valori dinamici (negozio/addetto) sono già
 * escapati.
 */
export function buildDirettoreCommento(p: CommentoParams): string {
  const { fascia, today, month, forecast: fc } = p;
  const elapsed = Math.max(0, p.elapsedWorkingDays);
  const total = Math.max(0, p.totalWorkingDays);
  const seed = seedFromYMD(p.dateYMD);

  const dims: DimInput[] = [
    { label: "mobile", unit: "pz", forecast: fc.mobileVolumi, today: today.countByPista.mobile ?? 0, month: month.countByPista.mobile ?? 0 },
    { label: "mobile P.IVA", unit: "pz", forecast: fc.mobileIvaVolumi, today: businessPezziOf(today, "mobile"), month: businessPezziOf(month, "mobile") },
    { label: "fisso", unit: "pz", forecast: fc.fissoVolumi, today: today.countByPista.fisso ?? 0, month: month.countByPista.fisso ?? 0 },
    { label: "fisso P.IVA", unit: "pz", forecast: fc.fissoIvaVolumi, today: businessPezziOf(today, "fisso"), month: businessPezziOf(month, "fisso") },
    { label: "energia", unit: "pz", forecast: fc.energiaVolumi, today: today.countByPista.energia ?? 0, month: month.countByPista.energia ?? 0 },
    { label: "assicurazioni", unit: "pz", forecast: fc.assicurazioniVolumi, today: today.countByPista.assicurazioni ?? 0, month: month.countByPista.assicurazioni ?? 0 },
    { label: "protetti", unit: "pz", forecast: fc.protettiVolumi, today: today.countByPista.protecta ?? 0, month: month.countByPista.protecta ?? 0 },
    { label: "cb", unit: "pz", forecast: fc.cbVolumi, today: today.countByPista.cb ?? 0, month: month.countByPista.cb ?? 0 },
    { label: "telefonia", unit: "pz", forecast: fc.telefoniPezzi, today: telefoniPezziOf(today), month: telefoniPezziOf(month) },
    { label: "accessori", unit: "€", forecast: fc.accessoriFatturato, today: accessoriImportoOf(today), month: accessoriImportoOf(month) },
    { label: "servizi", unit: "€", forecast: fc.serviziFatturato, today: today.amountByType.servizi, month: month.amountByType.servizi },
  ];
  const tracked = dims
    .map((d) => evalDim(d, elapsed, total))
    .filter((d): d is DimEval => d !== null);

  const monthDeltas = tracked.map((d) => d.monthDeltaPct).filter((x): x is number => x !== null);
  const overallMonthDelta = monthDeltas.length
    ? Math.round(monthDeltas.reduce((s, v) => s + v, 0) / monthDeltas.length)
    : null;
  const dayDeltas = tracked.map((d) => d.todayDeltaPct).filter((x): x is number => x !== null);
  const overallDayDelta = dayDeltas.length
    ? Math.round(dayDeltas.reduce((s, v) => s + v, 0) / dayDeltas.length)
    : null;
  const band = bandOf(overallMonthDelta);

  const out: string[] = [];
  out.push(withPeriod(pick(APERTURA[fascia][band], seed)));

  // ── Giornata al palo ───────────────────────────────────────────────
  if (today.vendite === 0) {
    const vuoto = fascia === "parziale" ? VUOTO_PARZIALE : VUOTO_CHIUSURA;
    out.push(pick(vuoto, seed >>> 3));
    if (tracked.length > 0 && month.vendite > 0) {
      out.push(meseFraming(tracked, overallMonthDelta));
    }
    out.push(pick(CHIUSURA_MOTIVAZIONALE[fascia][band], (seed * 2654435761) >>> 0));
    return out.join(" ");
  }

  // ── Giornata ───────────────────────────────────────────────────────
  out.push(giornataFraming(fascia, today, tracked, overallDayDelta));

  // ── Mese: passo e proiezioni ───────────────────────────────────────
  if (tracked.length > 0) {
    out.push(meseFraming(tracked, overallMonthDelta));
  }

  // ── Standout negozio/addetto ───────────────────────────────────────
  const standout = standoutFraming(today, fc);
  if (standout) out.push(standout);

  // ── Spunto strategico ──────────────────────────────────────────────
  const spunto = spuntoStrategico(tracked);
  if (spunto) out.push(spunto);

  // ── Chiusura motivazionale ─────────────────────────────────────────
  out.push(pick(CHIUSURA_MOTIVAZIONALE[fascia][band], (seed * 2654435761) >>> 0));

  return out.join(" ");
}

function giornataFraming(
  fascia: Fascia,
  today: DailyReportAggregates,
  tracked: DimEval[],
  overallDayDelta: number | null,
): string {
  const bits: string[] = [];
  bits.push(`<b>${today.vendite} vendite</b> per <b>${fmtEuro(today.importo)}</b>`);
  const dimBits = tracked
    .filter((d) => d.today > 0)
    .map((d) => `${fmtVal(d.unit, d.today)} ${d.label}`);
  const lead = fascia === "parziale" ? "Finora" : "In chiusura";
  let s = `${lead}: ${bits.join(", ")}`;
  if (dimBits.length > 0) s += ` (${dimBits.join(", ")})`;
  s += ".";
  if (overallDayDelta !== null) {
    s +=
      overallDayDelta >= 0
        ? ` Siamo sopra l'obiettivo di giornata del <b>${signedPct(overallDayDelta)}</b>.`
        : ` Siamo sotto l'obiettivo di giornata del <b>${Math.abs(overallDayDelta)}%</b>.`;
  }
  return s;
}

function meseFraming(tracked: DimEval[], overallMonthDelta: number | null): string {
  const clauses = tracked.map((d) => {
    const dir =
      d.monthDeltaPct === null
        ? "in avvio"
        : d.monthDeltaPct >= 0
          ? `avanti del ${signedPct(d.monthDeltaPct)}`
          : `indietro del ${Math.abs(d.monthDeltaPct)}%`;
    const proj = d.projection === null ? "—" : fmtVal(d.unit, d.projection);
    return `<b>${d.label}</b> ${dir} sul passo (proiezione ${proj} su obiettivo ${fmtVal(d.unit, d.forecast)})`;
  });
  let lead = "Sul mese";
  if (overallMonthDelta !== null) {
    lead =
      overallMonthDelta >= 0
        ? `Sul mese siamo davanti al passo di circa il ${signedPct(overallMonthDelta)}`
        : `Sul mese siamo dietro al passo di circa il ${Math.abs(overallMonthDelta)}%`;
  }
  return `${lead}: ${clauses.join("; ")}.`;
}

function standoutFraming(today: DailyReportAggregates, fc: ForecastConfig): string | null {
  const parts: string[] = [];
  // Migliori per KPI (Task #272): stesso criterio della sezione "I migliori"
  // dell'allegato HTML. Il KPI più rilevante è il primo con un vincitore
  // (ordine TELCO → New Core → Telefoni → Accessori → Servizi).
  const kpis = buildTopPerKpi(today);
  const top = kpis[0];
  const fmtKpiVal = (unit: "pz" | "€", v: number) => (unit === "€" ? fmtEuro(v) : `${v} pz`);
  const topPdv = top?.negozio ?? null;
  if (top && topPdv) {
    parts.push(
      `In evidenza <b>${escTg(topPdv.nome)}</b> su ${top.label} (${fmtKpiVal(top.unit, topPdv.valore)})`,
    );
  }
  const topAddetto = top?.addetto ?? null;
  if (top && topAddetto) {
    const frase = `l'addetto <b>${escTg(topAddetto.nome)}</b> con ${fmtKpiVal(top.unit, topAddetto.valore)} su ${top.label}`;
    parts.push(parts.length > 0 ? `bene ${frase}` : `Bene ${frase}`);
  }
  if (parts.length === 0) return null;
  let s = parts.join(", ");
  // Sotto tono: negozio marcatamente sotto la quota media (caso evidente).
  const negozi = today.perPdv.filter((p) => p.vendite > 0);
  if (negozi.length >= 3) {
    const numNegozi = (fc.numeroNegoziCc ?? 0) + (fc.numeroNegoziStrada ?? 0);
    const divisore = numNegozi > 0 ? numNegozi : negozi.length;
    const attesa = divisore > 0 ? today.importo / divisore : 0;
    const laggard = [...negozi].reverse().find((p) => attesa > 0 && p.importo < attesa * 0.5);
    if (laggard && nomePdv(laggard) !== topPdv?.nome) {
      s += `; occhio a <b>${escTg(nomePdv(laggard))}</b>, sotto la sua media`;
    }
  }
  return s + ".";
}

function spuntoStrategico(tracked: DimEval[]): string | null {
  const withDelta = tracked.filter((d) => d.monthDeltaPct !== null);
  if (withDelta.length === 0) return null;
  const sorted = [...withDelta].sort((a, b) => (a.monthDeltaPct as number) - (b.monthDeltaPct as number));
  const lagging = sorted[0];
  const leading = sorted[sorted.length - 1];
  if (lagging !== leading) {
    return `Spingiamo su <b>${lagging.label}</b> per recuperare terreno, consolidando <b>${leading.label}</b>.`;
  }
  return (lagging.monthDeltaPct as number) >= 0
    ? `Teniamo il ritmo su <b>${lagging.label}</b>.`
    : `Diamo una spinta a <b>${lagging.label}</b>.`;
}
