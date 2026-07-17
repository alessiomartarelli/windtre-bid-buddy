// Gara SOS Caring (Task #327): logica PURA per il parsing dell'Excel caring
// PDV (template WindTre "caring_pdv_cms"), l'aggregazione dei KPI per
// Ragione Sociale / totale rete e il calcolo del premio/malus basato sulla
// % Balance RS. Nessun import runtime: caricabile via loader tsx nei test
// senza dev server né DB.

// ---------------------------------------------------------------------------
// Parsing Excel
// ---------------------------------------------------------------------------

/** Intestazioni richieste nel file Excel SOS Caring (ordine libero). */
export const SOS_CARING_REQUIRED_HEADERS = [
  "AnnoMese",
  "Cod_PdV_Panel",
  "RagioneSociale",
  "AllarmiActual",
  "MNP_Out_su_LineeAllarmate",
  "MNP_Out_Micro_su_LineeAllarmate___Di_cui",
  "GA_Gara",
  "CambiPiano_TIED",
  "CambiPiano_TIED_Di_cui_Micro",
  "%_Balance_Actual",
  "%_Balance_Forecast",
  "LeveMax",
  "%_Leve_Utilizzate",
  "Leve_SOS_Caring_Actual",
] as const;

/** Riga normalizzata del file caring (un PDV). Le percentuali sono in PUNTI
 * percentuali (9.68 = 9,68%), non frazioni. */
export interface SosCaringRow {
  annoMese: string;
  codicePos: string;
  ragioneSociale: string;
  canale: string;
  allarmiActual: number;
  mnpOut: number;
  mnpOutMicro: number;
  gaGara: number;
  cambiPianoTied: number;
  cambiPianoTiedMicro: number;
  /** % Balance Actual del PDV (punti percentuali). */
  balanceActualPct: number;
  /** % Balance Forecast del PDV (punti percentuali). */
  balanceForecastPct: number;
  leveMax: number;
  /** % Leve utilizzate (punti percentuali). */
  leveUtilizzatePct: number;
  leveSosActual: number;
}

/**
 * Normalizzazione condivisa dei codici POS per il match Excel ↔ config gara:
 * trim + rimozione degli zeri iniziali sui codici interamente numerici
 * ("01234 " e "1234" ⇒ "1234"). I codici non numerici vengono solo trimmati
 * e uppercasati per un confronto case-insensitive. Vuoto ⇒ "".
 */
export function normalizeSosPosCode(v: unknown): string {
  const s = String(v ?? "").trim();
  if (!s) return "";
  if (/^\d+$/.test(s)) {
    const stripped = s.replace(/^0+/, "");
    return stripped === "" ? "0" : stripped;
  }
  return s.toUpperCase();
}

/** Numero tollerante: "1.204", "1204", 1204 ⇒ 1204; vuoto/non numerico ⇒ 0. */
export function parseSosNumber(v: unknown): number {
  if (v === null || v === undefined || v === "") return 0;
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  const s = String(v).trim().replace(/\./g, "").replace(",", ".");
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Percentuale del file ⇒ punti percentuali. Nel template le percentuali sono
 * FRAZIONI (0.0967 ⇒ 9,67%): valori |x| ≤ 1 vengono moltiplicati per 100.
 * Se il file arrivasse già in punti percentuali (es. 9.67) il valore resta
 * invariato. Stringhe con "%" vengono lette come punti percentuali.
 */
export function parseSosPercent(v: unknown): number {
  if (v === null || v === undefined || v === "") return 0;
  if (typeof v === "string" && v.includes("%")) {
    const n = parseFloat(v.replace("%", "").trim().replace(",", "."));
    return Number.isFinite(n) ? n : 0;
  }
  const n = typeof v === "number" ? v : parseFloat(String(v).trim().replace(",", "."));
  if (!Number.isFinite(n)) return 0;
  return Math.abs(n) <= 1 ? n * 100 : n;
}

/** Verifica che la riga di intestazione contenga tutte le colonne richieste. */
export function validateSosCaringHeaders(headerRow: unknown[]): { ok: boolean; missing: string[] } {
  const present = new Set(headerRow.map((h) => String(h ?? "").trim()));
  const missing = SOS_CARING_REQUIRED_HEADERS.filter((h) => !present.has(h));
  return { ok: missing.length === 0, missing: [...missing] };
}

/**
 * Parsa la matrice Excel (riga 0 = header). Scarta le righe senza codice PDV
 * o senza Ragione Sociale. Ritorna anche il periodo (AnnoMese più frequente).
 */
export function parseSosCaringRows(matrix: unknown[][]): {
  rows: SosCaringRow[];
  skipped: number;
  annoMese: string | null;
} {
  const header = (matrix[0] || []).map((h) => String(h ?? "").trim());
  const idx = (name: string) => header.indexOf(name);
  const col = {
    annoMese: idx("AnnoMese"),
    codicePos: idx("Cod_PdV_Panel"),
    rs: idx("RagioneSociale"),
    canale: idx("Canale"),
    allarmi: idx("AllarmiActual"),
    mnpOut: idx("MNP_Out_su_LineeAllarmate"),
    mnpOutMicro: idx("MNP_Out_Micro_su_LineeAllarmate___Di_cui"),
    gaGara: idx("GA_Gara"),
    cpTied: idx("CambiPiano_TIED"),
    cpTiedMicro: idx("CambiPiano_TIED_Di_cui_Micro"),
    balanceActual: idx("%_Balance_Actual"),
    balanceForecast: idx("%_Balance_Forecast"),
    leveMax: idx("LeveMax"),
    levePct: idx("%_Leve_Utilizzate"),
    leveSos: idx("Leve_SOS_Caring_Actual"),
  };

  const rows: SosCaringRow[] = [];
  let skipped = 0;
  const meseCount = new Map<string, number>();

  for (let i = 1; i < matrix.length; i++) {
    const r = matrix[i] || [];
    const cell = (j: number): unknown => (j >= 0 ? r[j] : "");
    const codicePos = normalizeSosPosCode(cell(col.codicePos));
    const ragioneSociale = String(cell(col.rs) ?? "").trim();
    if (!codicePos || !ragioneSociale) {
      // Riga vuota o di servizio: scarta ma non è un errore.
      if (r.some((c) => String(c ?? "").trim() !== "")) skipped++;
      continue;
    }
    const annoMese = String(cell(col.annoMese) ?? "").trim();
    if (annoMese) meseCount.set(annoMese, (meseCount.get(annoMese) || 0) + 1);
    rows.push({
      annoMese,
      codicePos,
      ragioneSociale,
      canale: String(cell(col.canale) ?? "").trim(),
      allarmiActual: parseSosNumber(cell(col.allarmi)),
      mnpOut: parseSosNumber(cell(col.mnpOut)),
      mnpOutMicro: parseSosNumber(cell(col.mnpOutMicro)),
      gaGara: parseSosNumber(cell(col.gaGara)),
      cambiPianoTied: parseSosNumber(cell(col.cpTied)),
      cambiPianoTiedMicro: parseSosNumber(cell(col.cpTiedMicro)),
      balanceActualPct: parseSosPercent(cell(col.balanceActual)),
      balanceForecastPct: parseSosPercent(cell(col.balanceForecast)),
      leveMax: parseSosNumber(cell(col.leveMax)),
      leveUtilizzatePct: parseSosPercent(cell(col.levePct)),
      leveSosActual: parseSosNumber(cell(col.leveSos)),
    });
  }

  let annoMese: string | null = null;
  let best = 0;
  meseCount.forEach((n, k) => {
    if (n > best) { best = n; annoMese = k; }
  });

  return { rows, skipped, annoMese };
}

// ---------------------------------------------------------------------------
// Aggregazione per Ragione Sociale / totale rete
// ---------------------------------------------------------------------------

export interface SosCaringTotals {
  pdvCount: number;
  allarmiActual: number;
  mnpOut: number;
  mnpOutMicro: number;
  gaGara: number;
  cambiPianoTied: number;
  cambiPianoTiedMicro: number;
  leveMax: number;
  leveSosActual: number;
  /** % Balance sui valori aggregati: Σ MNP Out / (Σ GA Gara + Σ CP TIED),
   * in punti percentuali. 0 se il denominatore è 0. */
  balancePct: number;
}

export interface SosCaringRsAggregate {
  ragioneSociale: string;
  rows: SosCaringRow[];
  totals: SosCaringTotals;
}

export interface SosCaringAggregation {
  perRS: SosCaringRsAggregate[];
  totaleRete: SosCaringTotals;
}

/** % Balance su valori aggregati (punti percentuali). */
export function computeBalancePct(mnpOut: number, gaGara: number, cambiPianoTied: number): number {
  const den = gaGara + cambiPianoTied;
  if (den <= 0) return 0;
  return (mnpOut / den) * 100;
}

function sumTotals(rows: SosCaringRow[]): SosCaringTotals {
  const t: SosCaringTotals = {
    pdvCount: rows.length,
    allarmiActual: 0, mnpOut: 0, mnpOutMicro: 0, gaGara: 0,
    cambiPianoTied: 0, cambiPianoTiedMicro: 0, leveMax: 0, leveSosActual: 0,
    balancePct: 0,
  };
  for (const r of rows) {
    t.allarmiActual += r.allarmiActual;
    t.mnpOut += r.mnpOut;
    t.mnpOutMicro += r.mnpOutMicro;
    t.gaGara += r.gaGara;
    t.cambiPianoTied += r.cambiPianoTied;
    t.cambiPianoTiedMicro += r.cambiPianoTiedMicro;
    t.leveMax += r.leveMax;
    t.leveSosActual += r.leveSosActual;
  }
  t.balancePct = computeBalancePct(t.mnpOut, t.gaGara, t.cambiPianoTied);
  return t;
}

/** Aggrega le righe per Ragione Sociale (ordine di prima apparizione) e
 * calcola i subtotali RS + totale rete, con % Balance su valori aggregati. */
export function aggregateSosCaring(rows: SosCaringRow[]): SosCaringAggregation {
  const byRS = new Map<string, SosCaringRow[]>();
  for (const r of rows) {
    const key = r.ragioneSociale.trim().toUpperCase();
    if (!byRS.has(key)) byRS.set(key, []);
    byRS.get(key)!.push(r);
  }
  const perRS: SosCaringRsAggregate[] = [];
  byRS.forEach((rsRows) => {
    perRS.push({
      ragioneSociale: rsRows[0].ragioneSociale,
      rows: rsRows,
      totals: sumTotals(rsRows),
    });
  });
  return { perRS, totaleRete: sumTotals(rows) };
}

// ---------------------------------------------------------------------------
// Premio / malus (cluster TOP LEVEL)
// ---------------------------------------------------------------------------

/** Config fasce premio SOS Caring. Soglie in punti percentuali, bonus in %
 * del premio Partnership Reward, malus in € per negozio in gara. */
export interface SosCaringPremioConfig {
  /** Sotto questa soglia: bonus massimo. Default 10 (%). */
  soglia1: number;
  /** Sotto questa soglia (e ≥ soglia1): bonus medio. Default 20 (%). */
  soglia2: number;
  /** Fino a questa soglia inclusa (e ≥ soglia2): bonus minimo. Default 30 (%).
   * OLTRE questa soglia scatta il malus. */
  soglia3: number;
  /** Bonus % del premio partnership per la fascia < soglia1. Default 30. */
  bonus1Pct: number;
  /** Bonus % per la fascia soglia1 ≤ x < soglia2. Default 20. */
  bonus2Pct: number;
  /** Bonus % per la fascia soglia2 ≤ x ≤ soglia3. Default 10. */
  bonus3Pct: number;
  /** Malus in € per negozio in gara per % Balance > soglia3. Default 500. */
  malusPerNegozio: number;
}

export const DEFAULT_SOS_CARING_PREMIO_CONFIG: SosCaringPremioConfig = {
  soglia1: 10,
  soglia2: 20,
  soglia3: 30,
  bonus1Pct: 30,
  bonus2Pct: 20,
  bonus3Pct: 10,
  malusPerNegozio: 500,
};

export type SosCaringFascia = "bonus1" | "bonus2" | "bonus3" | "malus";

export interface SosCaringPremioResult {
  fascia: SosCaringFascia;
  /** Etichetta della fascia, es. "< 10%" o "> 30%". */
  fasciaLabel: string;
  /** Bonus % applicato al premio partnership (0 per il malus). */
  bonusPct: number;
  /** Importo: positivo per il bonus, NEGATIVO per il malus. */
  importo: number;
  /** % Balance usata per la classificazione. */
  balancePct: number;
}

const fmtSoglia = (v: number): string =>
  Number.isInteger(v) ? String(v) : String(v).replace(".", ",");

/**
 * Calcola il premio/malus SOS Caring per una Ragione Sociale.
 * - balancePct < soglia1            ⇒ + bonus1Pct% del premio partnership
 * - soglia1 ≤ balancePct < soglia2  ⇒ + bonus2Pct%
 * - soglia2 ≤ balancePct ≤ soglia3  ⇒ + bonus3Pct%
 * - balancePct > soglia3            ⇒ − malusPerNegozio × negoziInGara
 * `premioPartnership` è l'importo Partnership Reward configurato per la RS
 * (premio 100%); `negoziInGara` è il numero di negozi in gara della RS.
 */
export function computeSosCaringPremio(params: {
  balancePct: number;
  premioPartnership: number;
  negoziInGara: number;
  config?: Partial<SosCaringPremioConfig> | null;
}): SosCaringPremioResult {
  const cfg: SosCaringPremioConfig = {
    ...DEFAULT_SOS_CARING_PREMIO_CONFIG,
    ...(params.config || {}),
  };
  const b = params.balancePct;
  if (b > cfg.soglia3) {
    return {
      fascia: "malus",
      fasciaLabel: `> ${fmtSoglia(cfg.soglia3)}%`,
      bonusPct: 0,
      importo: -(cfg.malusPerNegozio * Math.max(0, params.negoziInGara)),
      balancePct: b,
    };
  }
  if (b >= cfg.soglia2) {
    return {
      fascia: "bonus3",
      fasciaLabel: `${fmtSoglia(cfg.soglia2)}–${fmtSoglia(cfg.soglia3)}%`,
      bonusPct: cfg.bonus3Pct,
      importo: (params.premioPartnership * cfg.bonus3Pct) / 100,
      balancePct: b,
    };
  }
  if (b >= cfg.soglia1) {
    return {
      fascia: "bonus2",
      fasciaLabel: `${fmtSoglia(cfg.soglia1)}–${fmtSoglia(cfg.soglia2)}%`,
      bonusPct: cfg.bonus2Pct,
      importo: (params.premioPartnership * cfg.bonus2Pct) / 100,
      balancePct: b,
    };
  }
  return {
    fascia: "bonus1",
    fasciaLabel: `< ${fmtSoglia(cfg.soglia1)}%`,
    bonusPct: cfg.bonus1Pct,
    importo: (params.premioPartnership * cfg.bonus1Pct) / 100,
    balancePct: b,
  };
}

// ---------------------------------------------------------------------------
// Dataset persistito in gara_config.config.sosCaring
// ---------------------------------------------------------------------------

export interface SosCaringData {
  fileName: string;
  /** ISO datetime di upload ("Dati aggiornati al"). */
  uploadedAt: string;
  /** Periodo AnnoMese dal file, es. "202607". */
  annoMese: string | null;
  rows: SosCaringRow[];
  /** Override delle fasce premio; assente = default. */
  premioConfig?: Partial<SosCaringPremioConfig> | null;
}

/** "202607" ⇒ "Luglio 2026" (null/invalid ⇒ ""). */
export function formatAnnoMese(annoMese: string | null | undefined): string {
  if (!annoMese || !/^\d{6}$/.test(annoMese)) return "";
  const mesi = [
    "Gennaio", "Febbraio", "Marzo", "Aprile", "Maggio", "Giugno",
    "Luglio", "Agosto", "Settembre", "Ottobre", "Novembre", "Dicembre",
  ];
  const y = annoMese.slice(0, 4);
  const m = parseInt(annoMese.slice(4, 6), 10);
  if (m < 1 || m > 12) return "";
  return `${mesi[m - 1]} ${y}`;
}
