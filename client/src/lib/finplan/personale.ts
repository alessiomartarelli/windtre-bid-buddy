// Pure helpers per il modulo Personale/HR (Task #146).
// Sorgente storica: tool standalone HTML (rimosso in Task #148, vedi git) ~righe 5028-5866.
//
// Il modello `FinplanPersonaleRow` è passthrough (vedi shared/finplanSchema.ts):
// mantiene byte-compat con lo standalone, che scrive campi extra come
// `ragsoc`, `meseInizio/meseUscita`, `dataAssunzione`, `dataScadenza`,
// `attivo`, `costoAzienda`, `tfr`, `benefit`. Tutto è opzionale.

import type {
  FinplanCompanySnapshot,
  FinplanPersonaleRow,
  FinplanTransaction,
  FinplanCategory,
} from "@shared/finplanSchema";

export const HR_COLORS = [
  "#00D4AA", "#3B82F6", "#8B5CF6", "#F59E0B", "#F43F5E",
  "#06B6D4", "#84CC16", "#EC4899", "#F97316", "#A855F7",
];

type AnyRow = FinplanPersonaleRow & Record<string, unknown>;

function num(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v === "string") return parseFloat(v.replace(",", ".")) || 0;
  return 0;
}

/** Costo mese di una persona. Se `costoMensile` esplicito → usalo,
 *  altrimenti calcola da (costoAzienda||ral + tfr + benefit) / 12. */
export function hrCostoMensile(p: FinplanPersonaleRow): number {
  const a = p as AnyRow;
  const cm = num(a.costoMensile);
  if (cm > 0) return cm;
  const cAnnuo = num(a.costoAzienda || a.ral) + num(a.tfr) + num(a.benefit);
  return cAnnuo / 12;
}

/** Costo HR totale per il mese `mi` (0..11), considerando finestra di
 *  attività (meseInizio..meseUscita) e flag `attivo`. */
export function hrCostoMese(co: FinplanCompanySnapshot | undefined, mi: number): number {
  if (!co?.personale) return 0;
  return co.personale.reduce((s, p) => {
    const a = p as AnyRow;
    if (a.attivo === false) return s;
    const start = typeof a.meseInizio === "number" ? a.meseInizio : 0;
    const end = typeof a.meseUscita === "number" && a.meseUscita >= 0 ? a.meseUscita : 11;
    if (mi < start || mi > end) return s;
    return s + hrCostoMensile(p);
  }, 0);
}

export interface HrTotals {
  nDip: number;
  totRAL: number;
  totCosto: number;
  costoMese: number;
  totTfr: number;
  totBenefit: number;
}

export function computeHrTotals(personale: FinplanPersonaleRow[] | undefined): HrTotals {
  const list = personale ?? [];
  const totRAL = list.reduce((s, p) => s + num((p as AnyRow).ral), 0);
  const totTfr = list.reduce((s, p) => s + num((p as AnyRow).tfr), 0);
  const totBenefit = list.reduce((s, p) => s + num((p as AnyRow).benefit), 0);
  const totCosto = list.reduce(
    (s, p) => s + num((p as AnyRow).costoAzienda || (p as AnyRow).ral) + num((p as AnyRow).tfr) + num((p as AnyRow).benefit),
    0,
  );
  return {
    nDip: list.length,
    totRAL: +totRAL.toFixed(2),
    totCosto: +totCosto.toFixed(2),
    costoMese: +(totCosto / 12).toFixed(2),
    totTfr: +totTfr.toFixed(2),
    totBenefit: +totBenefit.toFixed(2),
  };
}

export interface PdvAggRow {
  pdv: string;
  dip: number;
  ral: number;
  costo: number;
  tfr: number;
  benefit: number;
  costoMese: number;
  persone: string[];
}

/** Aggrega i dipendenti per PDV (campo flessibile `pdv`). I dipendenti
 *  senza PDV finiscono in "Senza PDV". */
export function aggregateHrPerPdv(personale: FinplanPersonaleRow[] | undefined): PdvAggRow[] {
  const map = new Map<string, PdvAggRow>();
  for (const p of personale ?? []) {
    const a = p as AnyRow;
    const pdv = (typeof a.pdv === "string" && a.pdv.trim()) || "Senza PDV";
    const cur = map.get(pdv) ?? {
      pdv, dip: 0, ral: 0, costo: 0, tfr: 0, benefit: 0, costoMese: 0, persone: [],
    };
    cur.dip += 1;
    cur.ral += num(a.ral);
    cur.tfr += num(a.tfr);
    cur.benefit += num(a.benefit);
    cur.costo += num(a.costoAzienda || a.ral);
    cur.costoMese += hrCostoMensile(p);
    if (typeof a.nome === "string" && a.nome) cur.persone.push(a.nome);
    map.set(pdv, cur);
  }
  return Array.from(map.values()).sort((x, y) => y.costo - x.costo);
}

/**
 * Estrae ruolo + pdv da una stringa tipo "SS San Cesareo" o "AM Pomezia".
 * Sorgente: index.html ~5704 (extractRuoloPDV).
 */
export function extractRuoloPDV(pdvRaw: string | undefined | null): { ruolo: string; pdv: string } {
  if (!pdvRaw) return { ruolo: "", pdv: "" };
  const s = pdvRaw.trim();
  const sigle = ["SS", "SM", "AM", "BO", "TASK", "SPECIALIST"];
  for (const sg of sigle) {
    const re = new RegExp(`^${sg}\\b\\s*(.*)$`, "i");
    const m = s.match(re);
    if (m) return { ruolo: sg.toUpperCase(), pdv: (m[1] || "").trim() };
  }
  return { ruolo: "", pdv: s };
}

/**
 * Sincronizza le transazioni HR nella categoria Uscite "Personale" del
 * company snapshot. Aggiunge una transazione per mese (desc='__HR__').
 * Non muta `co` — restituisce un nuovo snapshot.
 *
 * Sorgente: index.html ~syncHRToUscite (~5050). Differenza importante:
 * qui NON ricalcoliamo `co.m` (i mensili sono gestiti altrove via
 * tx-driven aggregation), così evitiamo di sovrascrivere ENTRATE.
 */
export function syncHRToUscite(co: FinplanCompanySnapshot): FinplanCompanySnapshot {
  const cats = (co.cats ?? []) as FinplanCategory[];
  const cat = cats.find(
    (c) => c.type === "U" && (
      (c.name ?? "").toLowerCase().includes("personale") ||
      (c.name ?? "").toLowerCase().includes("stipend")
    ),
  );
  if (!cat) return co;
  const txs = (co.transactions ?? []) as FinplanTransaction[];
  const filtered = txs.filter((t) => !(t.catId === cat.id && t.desc === "__HR__"));
  const next: FinplanTransaction[] = filtered.slice();
  for (let mi = 0; mi < 12; mi++) {
    const costo = hrCostoMese(co, mi);
    if (costo > 0) {
      next.push({
        id: `hr_${mi}`,
        month: mi,
        type: "U",
        catId: cat.id,
        amount: +costo.toFixed(2),
        ivaRate: 0,
        desc: "__HR__",
      });
    }
  }
  return { ...co, transactions: next };
}

/** Auto-detect del nome colonna per il mapping import Excel/CSV. */
export function hrAutoDetect(headers: string[], key: string): number {
  const kw: Record<string, string[]> = {
    nome:      ["nome", "cognome", "nominativo", "dipendente", "employee", "name", "intestatario"],
    ruolo:     ["livello", "ruolo", "role", "mansione", "posizione", "job", "qualifica", "figura", "contratto"],
    pdv:       ["punto vendita", "pdv", "ufficio", "sede", "reparto", "store", "location", "centro", "filiale", "branch"],
    ragsoc:    ["ragione sociale", "ragione soc", "societa", "azienda", "company", "employer"],
    ral:       ["ral", "stipendio", "salario", "salary", "retribuzione", "lordo annuo"],
    costo:     ["costo azienda", "costo az", "total cost", "costo totale", "oneri", "costo annuo"],
    costoMese: ["costo mese", "costo tot/mese", "costo mensile", "costo tot mese", "monthly cost", "costo/mese"],
    tfr:       ["tfr", "trattamento fine rapporto", "liquidazione"],
    benefit:   ["benefit", "fringe", "rimborsi", "welfare", "buoni pasto"],
    inizio:    ["data assunzione", "data inizio", "assunzione", "inizio", "from", "start"],
    uscita:    ["scadenza", "data fine", "uscita", "fine", "licenziamento", "to", "end"],
  };
  const list = kw[key] ?? [];
  for (let i = 0; i < headers.length; i++) {
    const h = (headers[i] ?? "").toLowerCase().trim();
    if (list.some((k) => h.includes(k))) return i;
  }
  return -1;
}

export const HR_FIELDS: { k: string; l: string }[] = [
  { k: "nome",      l: "Nome (o Nome+Cognome)" },
  { k: "ruolo",     l: "Livello / Ruolo" },
  { k: "pdv",       l: "Punto Vendita / PDV" },
  { k: "ragsoc",    l: "Ragione Sociale" },
  { k: "ral",       l: "RAL €" },
  { k: "costo",     l: "Costo Azienda €" },
  { k: "costoMese", l: "Costo Mese € (★ priorità)" },
  { k: "tfr",       l: "TFR annuo €" },
  { k: "benefit",   l: "Benefit annui €" },
  { k: "inizio",    l: "Data Assunzione" },
  { k: "uscita",    l: "Data Fine / Scadenza" },
];

function parseExcelDate(v: unknown): string | undefined {
  if (v == null || v === "") return undefined;
  if (typeof v === "number") {
    // Excel serial date (1900-based)
    const d = new Date(Math.round((v - 25569) * 86400 * 1000));
    if (isNaN(d.getTime())) return undefined;
    return d.toISOString().slice(0, 10);
  }
  if (typeof v === "string") {
    const m1 = v.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/);
    if (m1) {
      const dd = m1[1].padStart(2, "0");
      const mm = m1[2].padStart(2, "0");
      const yy = m1[3].length === 2 ? `20${m1[3]}` : m1[3];
      return `${yy}-${mm}-${dd}`;
    }
    const m2 = v.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m2) return v.slice(0, 10);
  }
  return undefined;
}

function meseFromDate(iso: string | undefined, fallback: number): number {
  if (!iso) return fallback;
  const m = iso.match(/^(\d{4})-(\d{2})/);
  if (!m) return fallback;
  return Math.max(0, Math.min(11, parseInt(m[2], 10) - 1));
}

/**
 * Applica un mapping (kField → indice colonna) alle righe Excel/CSV
 * e produce N `FinplanPersonaleRow`. Non muta input.
 */
export function hrApplyMapping(
  headers: string[],
  rows: unknown[][],
  mapping: Record<string, number>,
  startId: number,
): FinplanPersonaleRow[] {
  const out: FinplanPersonaleRow[] = [];
  let id = startId;
  const get = (row: unknown[], k: string): unknown => {
    const idx = mapping[k];
    return typeof idx === "number" && idx >= 0 ? row[idx] : undefined;
  };
  for (const r of rows) {
    const nomeRaw = String(get(r, "nome") ?? "").trim();
    if (!nomeRaw) continue;
    const pdvRaw = String(get(r, "pdv") ?? "").trim();
    const auto = extractRuoloPDV(pdvRaw);
    const ruoloRaw = String(get(r, "ruolo") ?? "").trim() || auto.ruolo;
    const dataAssunzione = parseExcelDate(get(r, "inizio"));
    const dataScadenza = parseExcelDate(get(r, "uscita"));
    const meseInizio = meseFromDate(dataAssunzione, 0);
    const meseUscita = dataScadenza ? meseFromDate(dataScadenza, -1) : -1;
    out.push({
      id,
      nome: nomeRaw,
      ruolo: ruoloRaw,
      pdv: auto.pdv || pdvRaw || undefined,
      ragsoc: String(get(r, "ragsoc") ?? "").trim() || undefined,
      ral: num(get(r, "ral")),
      costoAzienda: num(get(r, "costo")),
      costoMensile: num(get(r, "costoMese")),
      tfr: num(get(r, "tfr")),
      benefit: num(get(r, "benefit")),
      meseInizio,
      meseUscita,
      attivo: meseUscita < 0,
      dataAssunzione,
      dataScadenza,
    } as unknown as FinplanPersonaleRow);
    id += 1;
  }
  return out;
}
