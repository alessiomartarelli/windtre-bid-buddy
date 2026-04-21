export type CapitoloKey =
  | "ENERGIA" | "MOBILE" | "FISSO" | "PARTNERSHIP_REWARD" | "CB"
  | "PR_ASSICURAZIONI" | "EXTRA_PR_ENERGIA" | "ASSICURAZIONI" | "RELOAD"
  | "SOS_CARING" | "PR_RELOAD" | "PINPAD" | "ASSISTENZA_TECNICA" | "ALTRO";

export interface CapitoloMeta {
  label: string;
  color: string;
  order: number;
}

export const CAPITOLI_CONFIG: Record<CapitoloKey, CapitoloMeta> = {
  ENERGIA: { label: "Energia", color: "#10b981", order: 1 },
  MOBILE: { label: "Mobile", color: "#f97316", order: 2 },
  FISSO: { label: "Fisso", color: "#3b82f6", order: 3 },
  PARTNERSHIP_REWARD: { label: "Partnership Reward", color: "#8b5cf6", order: 4 },
  CB: { label: "Customer Base", color: "#ec4899", order: 5 },
  PR_ASSICURAZIONI: { label: "PR Assicurazioni", color: "#a855f7", order: 6 },
  EXTRA_PR_ENERGIA: { label: "Extra PR Energia", color: "#06b6d4", order: 7 },
  ASSICURAZIONI: { label: "Assicurazioni", color: "#eab308", order: 8 },
  RELOAD: { label: "Reload", color: "#ef4444", order: 9 },
  SOS_CARING: { label: "SOS Caring", color: "#f59e0b", order: 10 },
  PR_RELOAD: { label: "PR Reload", color: "#dc2626", order: 11 },
  PINPAD: { label: "Pinpad", color: "#64748b", order: 12 },
  ASSISTENZA_TECNICA: { label: "Ass. Tecnica", color: "#94a3b8", order: 13 },
  ALTRO: { label: "Altro (non classificato)", color: "#fde047", order: 99 },
};

const REGOLE_RELOAD = new Set([
  "Gara Reload", "Gara Reload Furto", "Gara Reload Forever",
  "Gara Reload Plus", "Gara Reload Plus Furto", "Gara Reload Exchange",
  "Gara Customer Base per Reload Plus",
  "Gara Customer Base per Reload Plus Furto",
  "Gara Customer Base per Reload Exchange",
]);
const REGOLE_PR_CB = new Set([
  "Gara Partnership Reward Customer Base Mobile Tied",
  "Gara Partnership Reward Customer Base Mobile Untied",
  "Gara Partnership Reward Customer Base Fisso",
]);
const REGOLE_PR_RELOAD = new Set([
  "Gara Partnership Reward Reload Forever",
  "Gara Partnership Reward Reload Furto",
  "Gara Partnership Reward Reload Plus Furto",
]);
const REGOLE_SOS = new Set(["Partnership Reward CB SOS Tied", "Partnership Reward CB SOS Unt"]);
const REGOLA_PC_ADJ = "PC ADJUSTMENT MANUALI  26";

export interface DrmsRow {
  CAPITOLO: CapitoloKey;
  /** Identificatore univoco di riga proveniente dal DRMS — chiave per merge tra upload dello stesso periodo */
  SEQ_ID: string;
  CODICE_NEGOZIO_COSY: string;
  CODICE_CONTRATTO: string;
  COMPETENZA: string;
  TIPO_FONIA: string;
  TIPO_ATTIVAZIONE: string;
  REGOLA_DI_CALCOLO: string;
  DESCRIZIONE_ITEM: string;
  DESCRIZIONE_PIANO_TARIFFARIO: string;
  DESCRIZIONE_EVENTO: string;
  NATURA: string;
  MNP: string;
  SEGMENTO_CLIENT: string;
  TIPO_ACCESSO: string;
  TIPO_LINEA: string;
  FLAG_CONVERGENZA: string;
  FLAG_SOGLIA_MOBILE: string;
  FLAG_SOGLIA_FISSA: string;
  IMPORTO_NUM: number;
  /** PERIOD del file DRMS di provenienza (assegnato dopo classificazione, in caso di consolidato multi-file) */
  __PERIOD?: string;
  /** ID dell'upload DRMS di provenienza (debug / source tracking) */
  __UPLOAD_ID?: string;
}

type RawRow = Record<string, unknown>;

const str = (v: unknown): string => (v === null || v === undefined ? "" : String(v));

export function classificaRiga(row: RawRow, periodComp: string): CapitoloKey | null {
  const regola = str(row.REGOLA_DI_CALCOLO);
  const desc = str(row.DESCRIZIONE_ITEM);
  const fonia = str(row.TIPO_FONIA);
  const attivazione = str(row.TIPO_ATTIVAZIONE);
  const comp = str(row.COMPETENZA);
  const isPR = /Partnership Reward/i.test(regola);

  if (attivazione === "ASSTTCN") return "ASSISTENZA_TECNICA";

  if (REGOLE_PR_RELOAD.has(regola)) return "PR_RELOAD";
  if (regola === "Gara Partnership Reward Insurance") return "PR_ASSICURAZIONI";
  if (REGOLE_SOS.has(regola)) return "SOS_CARING";

  if (regola === REGOLA_PC_ADJ) {
    if (/Convergenza Fisso Energy/i.test(desc)) return "ENERGIA";
    if (/Attivato\s+(Luce|Gas)\s*\d{6}/i.test(desc)) return "ENERGIA";
    if (/Extra\s*Cluster\s*3/i.test(desc)) {
      if (fonia === "MOBILE" || fonia === "FISSO" || fonia === "ENERGIA" || fonia === "ASSICURAZIONI") {
        return fonia as CapitoloKey;
      }
      return null;
    }
    if (/Gara\s*CB\s*Per\s*Evento\s*Mobile\s*Tied/i.test(desc)) return "CB";
    if (/Cliente\s+gia\s+contrattualizzato\s*\d{6}/i.test(desc)) return "FISSO";
    if (/Reload\s+(Extra|PLUS)\s+Promo/i.test(desc)) return "RELOAD";
    if (/Pinpad\s*\d{0,6}/i.test(desc)) return "PINPAD";
    return null;
  }

  if (isPR && REGOLE_PR_CB.has(regola)) {
    return comp === periodComp ? "PARTNERSHIP_REWARD" : "EXTRA_PR_ENERGIA";
  }
  if (regola === "Gara Top Partnership Reward Mobile Tied" ||
      regola === "Gara Top Partnership Reward Mobile Untied") return "PARTNERSHIP_REWARD";

  if (REGOLE_RELOAD.has(regola)) return "RELOAD";

  if (attivazione === "CB" && (fonia === "MOBILE" || fonia === "FISSO") && !isPR) return "CB";

  if (fonia === "ENERGIA") return "ENERGIA";
  if (fonia === "ASSICURAZIONI") return "ASSICURAZIONI";
  if (fonia === "FISSO" && attivazione === "FISSA") return "FISSO";
  if (fonia === "MOBILE" && (attivazione === "TIED" || attivazione === "UNTIED")) return "MOBILE";

  return null;
}

function toNum(v: unknown): number {
  if (v === null || v === undefined) return 0;
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  let s = String(v).trim();
  if (!s) return 0;
  const hasComma = s.includes(",");
  const hasDot = s.includes(".");
  if (hasComma && hasDot) {
    // Formato italiano "1.234,56" → punto = migliaia, virgola = decimale
    s = s.replace(/\./g, "").replace(",", ".");
  } else if (hasComma) {
    // Solo virgola → decimale italiano
    s = s.replace(",", ".");
  }
  // Solo punto (o nessuno) → punto = decimale (formato US/SheetJS)
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Detect period (es. "MAR-26") dal valore COMPETENZA più frequente nelle righe.
 * Le righe con competenza "passata" sono storni/extra.
 */
export function detectPeriod(rows: RawRow[]): string {
  const counts = new Map<string, number>();
  for (const r of rows) {
    const c = str(r.COMPETENZA).trim();
    if (!c) continue;
    counts.set(c, (counts.get(c) || 0) + 1);
  }
  let best = ""; let max = 0;
  counts.forEach((v, k) => {
    if (v > max) { max = v; best = k; }
  });
  return best;
}

export function classifyAndNormalize(rawRows: RawRow[], period: string): DrmsRow[] {
  const out: DrmsRow[] = [];
  for (const r of rawRows) {
    const cap = classificaRiga(r, period) ?? "ALTRO";
    out.push({
      CAPITOLO: cap,
      SEQ_ID: str(r.SEQ_ID).trim(),
      CODICE_NEGOZIO_COSY: str(r.CODICE_NEGOZIO_COSY).trim(),
      CODICE_CONTRATTO: str(r.CODICE_CONTRATTO).trim(),
      COMPETENZA: str(r.COMPETENZA),
      TIPO_FONIA: str(r.TIPO_FONIA),
      TIPO_ATTIVAZIONE: str(r.TIPO_ATTIVAZIONE),
      REGOLA_DI_CALCOLO: str(r.REGOLA_DI_CALCOLO),
      DESCRIZIONE_ITEM: str(r.DESCRIZIONE_ITEM),
      DESCRIZIONE_PIANO_TARIFFARIO: str(r.DESCRIZIONE_PIANO_TARIFFARIO),
      DESCRIZIONE_EVENTO: str(r.DESCRIZIONE_EVENTO),
      NATURA: str(r.NATURA),
      MNP: str(r.MNP),
      SEGMENTO_CLIENT: str(r.SEGMENTO_CLIENT),
      TIPO_ACCESSO: str(r.TIPO_ACCESSO),
      TIPO_LINEA: str(r.TIPO_LINEA),
      FLAG_CONVERGENZA: str(r.FLAG_CONVERGENZA),
      FLAG_SOGLIA_MOBILE: str(r.FLAG_SOGLIA_MOBILE),
      FLAG_SOGLIA_FISSA: str(r.FLAG_SOGLIA_FISSA),
      IMPORTO_NUM: toNum(r.IMPORTO),
    });
  }
  return out;
}

const MONTH_MAP: Record<string, number> = {
  GEN: 1, FEB: 2, MAR: 3, APR: 4, MAG: 5, GIU: 6,
  LUG: 7, AGO: 8, SET: 9, OTT: 10, NOV: 11, DIC: 12,
};

/** Estrae mese/anno da period stile "MAR-26", "Mar 26", "2026-02" o "02/2026". */
export function parsePeriodToMonthYear(period: string): { month: number; year: number } | null {
  const p = period.trim().toUpperCase();
  const mAlpha = p.match(/([A-Z]{3})[-\s/.]?(\d{2,4})/);
  if (mAlpha && MONTH_MAP[mAlpha[1]]) {
    let year = parseInt(mAlpha[2], 10);
    if (year < 100) year = 2000 + year;
    return { month: MONTH_MAP[mAlpha[1]], year };
  }
  const mYM = p.match(/^(\d{4})[-/.](\d{1,2})$/);
  if (mYM) {
    const year = parseInt(mYM[1], 10);
    const month = parseInt(mYM[2], 10);
    if (month >= 1 && month <= 12) return { month, year };
  }
  const mMY = p.match(/^(\d{1,2})[-/.](\d{4})$/);
  if (mMY) {
    const month = parseInt(mMY[1], 10);
    const year = parseInt(mMY[2], 10);
    if (month >= 1 && month <= 12) return { month, year };
  }
  const mMYshort = p.match(/^(\d{1,2})[-/.](\d{2})$/);
  if (mMYshort) {
    const month = parseInt(mMYshort[1], 10);
    const year = 2000 + parseInt(mMYshort[2], 10);
    if (month >= 1 && month <= 12) return { month, year };
  }
  return null;
}
