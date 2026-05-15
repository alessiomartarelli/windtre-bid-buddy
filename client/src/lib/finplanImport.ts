// Helpers di import bancario per FinPlan Studio (estratto da
// `FinPlanSetupWizard.tsx` durante Task #144 per essere riusato anche
// dal flusso "Importa CC" nella sezione Transazioni della shell React).
//
// Tutte le funzioni qui sono pure: parsing CSV/XLSX, classificazione
// descrizione, conversione righe → transazioni FinPlan. Niente UI,
// niente state. Sorgente storica: tool standalone HTML rimosso in Task #148
// (funzioni `autoRiclassifica`/`parseFile`); resta in git per riferimento.

import * as XLSX from "xlsx";

// Mese in lingua italiana, allineato al tool standalone (MO).
export const MO = ["Gen","Feb","Mar","Apr","Mag","Giu","Lug","Ago","Set","Ott","Nov","Dic"] as const;

// Categorie speciali: stessi id del tool standalone così l'auto-classificazione
// produce transazioni già riconoscibili dopo l'import.
export const CAT_INFRAGRUPPO_E = "ig_e";
export const CAT_INFRAGRUPPO_U = "ig_u";
export const CAT_GIROCONTO_E = "gc_e";
export const CAT_GIROCONTO_U = "gc_u";
export const CAT_ESTERO_E = "est_e";
export const CAT_ESTERO_U = "est_u";
export const CAT_PERSONALE_U = "u1";

export interface DefaultCat {
  id: string;
  name: string;
  color: string;
  type: "E" | "U";
  infragruppo?: boolean;
  giroconto?: boolean;
  estero?: boolean;
}

export const DEFAULT_CATS_E: DefaultCat[] = [
  { id: "e1", name: "Vendite Prodotti",   color: "#00D4AA", type: "E" },
  { id: "e2", name: "Servizi/Consulenze", color: "#3B82F6", type: "E" },
  { id: "e3", name: "Abbonamenti",        color: "#8B5CF6", type: "E" },
  { id: "e4", name: "Affitti Attivi",     color: "#F59E0B", type: "E" },
  { id: "e5", name: "Altro Entrate",      color: "#06B6D4", type: "E" },
  { id: CAT_INFRAGRUPPO_E, name: "Infragruppo", color: "#A78BFA", type: "E", infragruppo: true },
  { id: CAT_GIROCONTO_E,   name: "Giroconto",   color: "#64748B", type: "E", giroconto: true },
  { id: CAT_ESTERO_E,      name: "Estero",      color: "#06B6D4", type: "E", estero: true },
];

export const DEFAULT_CATS_U: DefaultCat[] = [
  { id: "u1", name: "Personale/Stipendi", color: "#F43F5E", type: "U" },
  { id: "u2", name: "Fornitori",          color: "#F97316", type: "U" },
  { id: "u3", name: "Affitti Passivi",    color: "#EAB308", type: "U" },
  { id: "u4", name: "Marketing/Adv",      color: "#EC4899", type: "U" },
  { id: "u5", name: "Utenze/Servizi",     color: "#84CC16", type: "U" },
  { id: "u6", name: "Altro Uscite",       color: "#94A3B8", type: "U" },
  { id: CAT_INFRAGRUPPO_U, name: "Infragruppo", color: "#7C3AED", type: "U", infragruppo: true },
  { id: CAT_GIROCONTO_U,   name: "Giroconto",   color: "#475569", type: "U", giroconto: true },
  { id: CAT_ESTERO_U,      name: "Estero",      color: "#0891B2", type: "U", estero: true },
];

export const ALL_DEFAULT_CATS: DefaultCat[] = [...DEFAULT_CATS_E, ...DEFAULT_CATS_U];

// ───────────────────────── Keyword set auto-classify ─────────────────────────

const GIROCONTO_KW = [
  "girocont", "giro conto", "giro-conto",
  "bonifico interno", "trasferimento interno",
  "storno", "partite interne", "movimento interno",
];
const INFRAGRUPPO_KW = [
  "infragruppo", "intra gruppo", "intra-gruppo", "intercompany", "inter company",
  "aziende gruppo", "azienda gruppo", "gruppo aziendale",
  "fatture interne", "fattura interna", "fatt. interne", "fatt interne",
  "cms evo", "cms evolution", "phone & phone", "phone and phone",
  "easy digital", "sc technology", "nuova ristorazione",
];
const ESTERO_KW = [
  "estero", "foreign", "international", "internazionale", "overseas",
  "bonifico estero", "bonifico internazionale", "wire transfer", "swift",
  "sepa estero", "pagamento estero", "rimessa estera",
  "reverse charge", "inversione contabile", "autofattura",
];
const PERSONALE_KW = [
  "stipend", "salari", "salario", "personale dipendente",
  "buste paga", "busta paga", "compenso amministratore",
  "compensi amministratori", "tfr",
];
const FORNITORI_KW = [
  "fornitor", "fattura n", "ft.", "fatt.", "pagamento fattura",
  "pag. fattura", "pag.fattura", "pagam. fornitor",
];

export function classifyDesc(
  desc: string,
  type: "E" | "U",
  defE: string,
  defU: string,
): { catId: string; tag: string } {
  const dv = (desc || "").toLowerCase().trim();
  if (dv) {
    if (GIROCONTO_KW.some(k => dv.includes(k))) {
      return { catId: type === "E" ? CAT_GIROCONTO_E : CAT_GIROCONTO_U, tag: "Giroconto" };
    }
    if (INFRAGRUPPO_KW.some(k => dv.includes(k))) {
      return { catId: type === "E" ? CAT_INFRAGRUPPO_E : CAT_INFRAGRUPPO_U, tag: "Infragruppo" };
    }
    if (ESTERO_KW.some(k => dv.includes(k))) {
      return { catId: type === "E" ? CAT_ESTERO_E : CAT_ESTERO_U, tag: "Estero" };
    }
    if (type === "U" && PERSONALE_KW.some(k => dv.includes(k))) {
      return { catId: CAT_PERSONALE_U, tag: "Personale" };
    }
    if (type === "U" && FORNITORI_KW.some(k => dv.includes(k))) {
      return { catId: "u2", tag: "Fornitori" };
    }
  }
  return { catId: type === "E" ? defE : defU, tag: "" };
}

// ───────────────────────── Parser numerico/data ─────────────────────────

export function parseAmount(v: unknown): number {
  if (v === null || v === undefined || v === "") return 0;
  if (typeof v === "number") return v;
  let s = String(v).trim();
  s = s.replace(/[€$£\s]/g, "");
  if (!s) return 0;
  if (s.includes(".") && s.includes(",")) {
    s = s.replace(/\./g, "").replace(",", ".");
  } else if (s.includes(",")) {
    s = s.replace(",", ".");
  }
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}

export function parseMonth(v: unknown): number {
  if (v === null || v === undefined || v === "") return 0;
  if (typeof v === "number" && v > 10000 && v < 80000) {
    const d = XLSX.SSF.parse_date_code(v);
    if (d && d.m) return Math.max(0, Math.min(11, d.m - 1));
  }
  const s = String(v).trim();
  const m1 = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/);
  if (m1) return Math.max(0, Math.min(11, parseInt(m1[2], 10) - 1));
  const m2 = s.match(/^(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})/);
  if (m2) return Math.max(0, Math.min(11, parseInt(m2[2], 10) - 1));
  const d = new Date(s);
  if (!isNaN(d.getTime())) return d.getMonth();
  return 0;
}

export function autoDetectColumn(headers: string[], keywords: string[]): number {
  const norm = (h: string) => h.toLowerCase().trim();
  for (let i = 0; i < headers.length; i++) {
    if (keywords.some(k => norm(headers[i]) === k)) return i;
  }
  for (let i = 0; i < headers.length; i++) {
    if (keywords.some(k => norm(headers[i]).includes(k))) return i;
  }
  return -1;
}

// Mappa di default heuristics per (data/desc/entrate/uscite/importo/RS):
// estratta da `applyAutoDetect`/`onSlotFile` del wizard così sia il setup
// iniziale che il flusso re-import in pagina Transazioni usano lo stesso
// dizionario.
export const HEADER_KEYWORDS = {
  date:         ["data","date","mese","periodo","data contabile","data valuta"],
  amountIn:     ["accredit","entrate","ricavi","incassi","avere","credit","entrata"],
  amountOut:    ["addebit","uscite","spese","dare","debit","uscita"],
  amountSigned: ["importo","amount","valore"],
  desc:         ["descrizione","description","causale","nota","operazione","dettaglio"],
  rs:           ["ragione sociale","ragionesociale","rs","società","societa","azienda","company"],
} as const;

// ───────────────────────── Tipi import ─────────────────────────

export type ParsedRow = (string | number)[];

export interface ParsedFile {
  headers: string[];
  rows: ParsedRow[];
  fileName: string;
}

export interface ColumnMapping {
  date: number;
  amountIn: number;
  amountOut: number;
  amountSigned: number;
  desc: number;
  rs: number;
}

export const EMPTY_MAPPING: ColumnMapping = {
  date: -1, amountIn: -1, amountOut: -1, amountSigned: -1, desc: -1, rs: -1,
};

export interface BuiltTransaction {
  id: number;
  month: number;
  type: "E" | "U";
  amount: number;
  catId: string;
  ivaRate: number;
  desc: string;
  autoTag: string;
  _rowIdx: number;
  _rsIdx: number;
}

// ───────────────────────── Parser file ─────────────────────────

export async function parseFile(file: File): Promise<ParsedFile> {
  const ext = file.name.split(".").pop()?.toLowerCase() || "";
  if (ext === "csv") {
    const text = await file.text();
    const firstLine = text.split("\n")[0] || "";
    const delim = firstLine.includes("\t") ? "\t"
      : firstLine.split(";").length > firstLine.split(",").length ? ";" : ",";
    const lines = text.trim().split("\n").map(l =>
      l.split(delim).map(c => c.trim().replace(/^"|"$/g, ""))
    );
    if (lines.length < 2) throw new Error("CSV con dati insufficienti");
    return {
      headers: lines[0].map(h => h || ""),
      rows: lines.slice(1).filter(r => r.some(c => c !== "")),
      fileName: file.name,
    };
  }
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  let chosenRaw: ParsedRow[] | null = null;
  for (const sn of wb.SheetNames) {
    const r = XLSX.utils.sheet_to_json<ParsedRow>(wb.Sheets[sn], { header: 1, defval: "" });
    const dr = r.filter(row => row.some(c => c !== ""));
    if (dr.length >= 2) { chosenRaw = dr; break; }
  }
  if (!chosenRaw) throw new Error("Nessun foglio con dati sufficienti");
  let hi = 0;
  for (let i = 0; i < Math.min(10, chosenRaw.length); i++) {
    const nonNum = chosenRaw[i].filter(c =>
      c !== "" && isNaN(parseFloat(String(c).replace(",", ".")))
    ).length;
    if (nonNum >= 1) { hi = i; break; }
  }
  const headers = chosenRaw[hi].map((h, i) => String(h ?? "").trim() || `Col${i+1}`);
  const rows = chosenRaw.slice(hi + 1).filter(r => r.some(c => c !== ""));
  return { headers, rows, fileName: file.name };
}

export function rowsToTransactions(
  rows: ParsedRow[],
  rowOriginalIndices: number[],
  rsIdx: number,
  mapping: ColumnMapping,
  defaultCatE: string,
  defaultCatU: string,
  ivaMode: "netti" | "lordi",
  startId: number,
  autoClassifyOn: boolean,
  overrides: Record<string, string>,
): BuiltTransaction[] {
  const out: BuiltTransaction[] = [];
  let nextId = startId;
  const usesSigned = mapping.amountIn < 0 && mapping.amountOut < 0 && mapping.amountSigned >= 0;
  const factor = ivaMode === "lordi" ? 1 / 1.22 : 1;
  const baseIva = ivaMode === "lordi" ? 22 : 0;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const origIdx = rowOriginalIndices[i] ?? i;
    const month = mapping.date >= 0 ? parseMonth(row[mapping.date]) : 0;
    const desc = mapping.desc >= 0 ? String(row[mapping.desc] ?? "").trim() : "";
    let amountE = 0, amountU = 0;
    if (usesSigned) {
      const a = parseAmount(row[mapping.amountSigned]);
      if (a >= 0) amountE = a; else amountU = -a;
    } else {
      if (mapping.amountIn >= 0) amountE = parseAmount(row[mapping.amountIn]);
      if (mapping.amountOut >= 0) amountU = parseAmount(row[mapping.amountOut]);
    }
    const pushTx = (type: "E" | "U", amount: number) => {
      const auto = autoClassifyOn
        ? classifyDesc(desc, type, defaultCatE, defaultCatU)
        : { catId: type === "E" ? defaultCatE : defaultCatU, tag: "" };
      const ovKey = `${rsIdx}:${origIdx}:${type}`;
      const finalCat = overrides[ovKey] ?? auto.catId;
      const noIva = finalCat === CAT_GIROCONTO_E || finalCat === CAT_GIROCONTO_U
        || finalCat === CAT_ESTERO_E || finalCat === CAT_ESTERO_U
        || finalCat === CAT_PERSONALE_U;
      const ivaRate = noIva ? 0 : baseIva;
      const fact = noIva ? 1 : factor;
      out.push({
        id: nextId++, month, type,
        amount: +(amount * fact).toFixed(2),
        catId: finalCat,
        ivaRate,
        desc,
        autoTag: overrides[ovKey] ? "Override" : auto.tag,
        _rowIdx: origIdx,
        _rsIdx: rsIdx,
      });
    };
    if (amountE > 0) pushTx("E", amountE);
    if (amountU > 0) pushTx("U", amountU);
  }
  return out;
}

export function autoDetectMapping(headers: string[], wantRs: boolean): ColumnMapping {
  return {
    date: autoDetectColumn(headers, [...HEADER_KEYWORDS.date]),
    amountIn: autoDetectColumn(headers, [...HEADER_KEYWORDS.amountIn]),
    amountOut: autoDetectColumn(headers, [...HEADER_KEYWORDS.amountOut]),
    amountSigned: autoDetectColumn(headers, [...HEADER_KEYWORDS.amountSigned]),
    desc: autoDetectColumn(headers, [...HEADER_KEYWORDS.desc]),
    rs: wantRs ? autoDetectColumn(headers, [...HEADER_KEYWORDS.rs]) : -1,
  };
}

export function isMappingValid(mapping: ColumnMapping, requireRs: boolean): boolean {
  const amountsOk = (mapping.amountIn >= 0 && mapping.amountOut >= 0) || mapping.amountSigned >= 0;
  if (!amountsOk) return false;
  if (requireRs && mapping.rs < 0) return false;
  return true;
}
