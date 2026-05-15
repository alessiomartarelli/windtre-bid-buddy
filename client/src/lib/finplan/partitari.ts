// Pure helpers per il modulo Partitari (Task #146).
// Sorgente storica: `client/public/finplan/index.html` ~righe 6029-6310.

import type { FinplanPartitarioRow } from "@shared/finplanSchema";

export type PtStato = "pagato" | "parziale" | "scaduto" | "aperto";

const TODAY = (() => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
})();

function diffDays(dateStr: string | undefined): number | null {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return null;
  d.setHours(0, 0, 0, 0);
  return Math.round((TODAY.getTime() - d.getTime()) / 86400000);
}

export function ptTotale(row: FinplanPartitarioRow): number {
  const imp = row.imp ?? 0;
  const iva = row.iva ?? 0;
  return +(imp * (1 + iva / 100)).toFixed(2);
}

export function ptResiduo(row: FinplanPartitarioRow): number {
  return Math.max(0, +(ptTotale(row) - (row.pagato ?? 0)).toFixed(2));
}

export function ptStato(row: FinplanPartitarioRow): PtStato {
  const totale = ptTotale(row);
  const residuo = totale - (row.pagato ?? 0);
  if (residuo <= 0.01) return "pagato";
  if ((row.pagato ?? 0) > 0) return "parziale";
  const dd = diffDays(row.scad);
  if (dd != null && dd > 0) return "scaduto";
  return "aperto";
}

/** Giorni a scadenza (positivo = già scaduto, negativo = mancano N giorni). */
export function ptGiorniScaduto(row: FinplanPartitarioRow): number | null {
  return diffDays(row.scad);
}

export interface PtTotals {
  count: number;
  totale: number;
  pagato: number;
  residuo: number;
  scaduto: number;
  aScadere: number;
}

export function ptComputeTotals(rows: FinplanPartitarioRow[]): PtTotals {
  let totale = 0, pagato = 0, residuo = 0, scaduto = 0, aScadere = 0;
  for (const r of rows) {
    const t = ptTotale(r);
    const res = ptResiduo(r);
    totale += t;
    pagato += r.pagato ?? 0;
    residuo += res;
    const stato = ptStato(r);
    if (stato === "scaduto") scaduto += res;
    else if (stato === "aperto" || stato === "parziale") aScadere += res;
  }
  return {
    count: rows.length,
    totale: +totale.toFixed(2),
    pagato: +pagato.toFixed(2),
    residuo: +residuo.toFixed(2),
    scaduto: +scaduto.toFixed(2),
    aScadere: +aScadere.toFixed(2),
  };
}

// ─── Excel/CSV import ────────────────────────────────────────────────

const PT_KW: Record<string, string[]> = {
  ragsoc: ["ragione sociale", "ragsoc", "cliente", "fornitore", "denominaz", "anagraf"],
  nfatt:  ["n. fatt", "nfatt", "numero", "n.doc", "n doc", "fattura n"],
  emiss:  ["emiss", "data fat", "data doc", "data emi"],
  scad:   ["scad", "scadenza", "data scad"],
  imp:    ["imponibile", "importo", "imp."],
  iva:    ["iva", "aliq"],
  pagato: ["pagato", "incassat", "saldat"],
};

export const PT_FIELDS: { k: string; l: string }[] = [
  { k: "ragsoc", l: "Ragione Sociale" },
  { k: "nfatt",  l: "N. Fattura" },
  { k: "emiss",  l: "Data Emissione" },
  { k: "scad",   l: "Data Scadenza" },
  { k: "imp",    l: "Imponibile €" },
  { k: "iva",    l: "Aliquota IVA %" },
  { k: "pagato", l: "Pagato €" },
];

export function ptAutoDetect(headers: string[], key: string): number {
  const list = PT_KW[key] ?? [];
  for (let i = 0; i < headers.length; i++) {
    const h = (headers[i] ?? "").toLowerCase().trim();
    if (list.some((k) => h.includes(k))) return i;
  }
  return -1;
}

function num(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v === "string") return parseFloat(v.replace(/\./g, "").replace(",", ".")) || 0;
  return 0;
}

function parseDate(v: unknown): string | undefined {
  if (v == null || v === "") return undefined;
  if (typeof v === "number") {
    const d = new Date(Math.round((v - 25569) * 86400 * 1000));
    if (isNaN(d.getTime())) return undefined;
    return d.toISOString().slice(0, 10);
  }
  const s = String(v).trim();
  const m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/);
  if (m) {
    const yy = m[3].length === 2 ? `20${m[3]}` : m[3];
    return `${yy}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  }
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  return undefined;
}

export function ptApplyMapping(
  rows: unknown[][],
  mapping: Record<string, number>,
  startId: number,
): FinplanPartitarioRow[] {
  const out: FinplanPartitarioRow[] = [];
  let id = startId;
  const get = (row: unknown[], k: string): unknown => {
    const idx = mapping[k];
    return typeof idx === "number" && idx >= 0 ? row[idx] : undefined;
  };
  for (const r of rows) {
    const ragsoc = String(get(r, "ragsoc") ?? "").trim();
    const imp = num(get(r, "imp"));
    if (!ragsoc || imp <= 0) continue;
    const row: FinplanPartitarioRow = {
      id,
      ragsoc,
      nfatt: String(get(r, "nfatt") ?? "").trim() || undefined,
      emiss: parseDate(get(r, "emiss")),
      scad: parseDate(get(r, "scad")),
      imp,
      iva: num(get(r, "iva")) || 22,
      pagato: num(get(r, "pagato")),
    };
    row.stato = ptStato(row);
    out.push(row);
    id += 1;
  }
  return out;
}

// ─── PDF mastrino import ─────────────────────────────────────────────
//
// Parser semplice di un mastrino PDF (estratto conto fornitori/clienti):
// estrae righe con data + numero + causale + importo. Ogni riga
// "fattura" produce un partitario con stato derivato da `pagato`.
// Sorgente legacy: index.html ~ptImportPdf (~6200).

interface PdfRow {
  data: string;
  num: string;
  causale: string;
  importo: number;
  isFattura: boolean;
  isIncasso: boolean;
}

const FATT_RE = /fattur|^ft\b/i;
const INC_RE = /incasso|pagamento|versamento|bonifico/i;

function pNum(s: string | undefined): number {
  if (!s) return 0;
  return parseFloat(s.replace(/\./g, "").replace(",", ".")) || 0;
}

export function ptParsePdfText(text: string): FinplanPartitarioRow[] {
  const lines = text.split(/\r?\n/);
  const parsed: PdfRow[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const m = line.match(/^(\d{1,2}\/\d{2}\/\d{2,4})\s+(\S+)\s+(.+?)\s+([\d.]+,\d{2})/);
    if (!m) continue;
    const causale = m[3].trim();
    parsed.push({
      data: m[1],
      num: m[2],
      causale,
      importo: pNum(m[4]),
      isFattura: FATT_RE.test(causale) || /^[A-Z]\d/.test(m[2]),
      isIncasso: INC_RE.test(causale),
    });
  }
  // Reduce: fatture e applica incassi FIFO sulle aperte
  const byNum = new Map<string, FinplanPartitarioRow>();
  let id = 1;
  for (const r of parsed) {
    if (r.isFattura && r.importo > 0) {
      const ftRef = (r.causale.match(/Ft\s+(\S+)/i)?.[1]) || r.num;
      if (byNum.has(ftRef)) continue;
      const row: FinplanPartitarioRow = {
        id: id++,
        ragsoc: undefined,
        nfatt: ftRef,
        emiss: parseDate(r.data),
        scad: undefined,
        imp: r.importo,
        iva: 0,
        pagato: 0,
      };
      row.stato = ptStato(row);
      byNum.set(ftRef, row);
    } else if (r.isIncasso && r.importo > 0) {
      // Imputa al primo aperto (FIFO inverso = ultimo aggiunto ancora aperto)
      const open = Array.from(byNum.values()).reverse().find((f) => ptResiduo(f) > 0);
      if (open) {
        const pg = Math.min(r.importo, ptResiduo(open));
        open.pagato = (open.pagato ?? 0) + pg;
        open.stato = ptStato(open);
      }
    }
  }
  return Array.from(byNum.values());
}
