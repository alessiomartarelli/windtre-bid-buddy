// Pure utilities per i calcoli IVA e l'aggregazione mensile delle
// transazioni FinPlan. Estratte come libreria standalone per essere
// riusabili dalle sezioni Transazioni/Mensile/IVA della shell React
// (Task #144) e per essere coperte da test mirati.
//
// Sorgente storica: `client/public/finplan/index.html` funzioni
// `calcIVA`, `syncMonthlyFromTx`, `calcAutofattura`, `setTxIva`.

import type { FinplanCompanySnapshot, FinplanTransaction, IvaPeriod } from "@shared/finplanSchema";
import {
  CAT_ESTERO_E, CAT_ESTERO_U,
  CAT_GIROCONTO_E, CAT_GIROCONTO_U,
  CAT_PERSONALE_U,
  MO,
} from "./finplanImport";

export const MONTH_LABELS = MO;

// Categorie senza IVA scorporabile (allineato a `noIva` di rowsToTransactions).
const NO_IVA_CATS = new Set<string>([
  CAT_GIROCONTO_E, CAT_GIROCONTO_U,
  CAT_ESTERO_E, CAT_ESTERO_U,
  CAT_PERSONALE_U,
]);

export function isNoIvaCat(catId: string | undefined): boolean {
  if (!catId) return false;
  return NO_IVA_CATS.has(catId);
}

// Scorporo IVA: dato un netto + aliquota in %, ritorna (netto/iva/lordo).
// `amount` è considerato netto (convenzione FinPlan: tutte le transazioni
// memorizzano l'imponibile netto dopo l'import lordo→netto al fattore 1/1.22).
export function scorporaIva(amount: number, ratePct: number): {
  netto: number; iva: number; lordo: number;
} {
  const safeAmount = Number.isFinite(amount) ? amount : 0;
  const safeRate = Number.isFinite(ratePct) ? Math.max(0, ratePct) : 0;
  const netto = +safeAmount.toFixed(2);
  const iva = +(safeAmount * safeRate / 100).toFixed(2);
  const lordo = +(netto + iva).toFixed(2);
  return { netto, iva, lordo };
}

// Aggregazione transazioni → totali mensili [12]. Usato per la sezione
// Mensile come "valore atteso" rispetto ai totali editati a mano.
export function aggregateMonthlyFromTx(transactions: FinplanTransaction[] | undefined): {
  e: number[]; u: number[];
} {
  const e = Array(12).fill(0);
  const u = Array(12).fill(0);
  if (!transactions) return { e, u };
  for (const tx of transactions) {
    const m = typeof tx.month === "number" ? Math.max(0, Math.min(11, tx.month)) : 0;
    const amt = typeof tx.amount === "number" ? tx.amount : 0;
    if (tx.type === "E") e[m] += amt;
    else if (tx.type === "U") u[m] += amt;
  }
  return {
    e: e.map(n => +n.toFixed(2)),
    u: u.map(n => +n.toFixed(2)),
  };
}

// ───────────────────── Liquidazione IVA ─────────────────────

export interface IvaPeriodRow {
  label: string;
  ivaCollettata: number;   // IVA su entrate (debito)
  ivaDetraibile: number;   // IVA su uscite (credito)
  saldo: number;           // collettata - detraibile (>0 = a debito)
}

const TRIMESTRE_LABELS = ["1° Trimestre (Gen-Mar)", "2° Trimestre (Apr-Giu)", "3° Trimestre (Lug-Set)", "4° Trimestre (Ott-Dic)"];

export function calcIvaPeriods(
  transactions: FinplanTransaction[] | undefined,
  period: IvaPeriod,
): IvaPeriodRow[] {
  const buckets = period === "trimestrale" ? 4 : 12;
  const collettata = Array(buckets).fill(0);
  const detraibile = Array(buckets).fill(0);
  const labels = period === "trimestrale" ? TRIMESTRE_LABELS : MONTH_LABELS.slice();
  if (transactions) {
    for (const tx of transactions) {
      const month = typeof tx.month === "number" ? Math.max(0, Math.min(11, tx.month)) : 0;
      const bucket = period === "trimestrale" ? Math.floor(month / 3) : month;
      const rate = typeof tx.ivaRate === "number" ? tx.ivaRate : 0;
      const amount = typeof tx.amount === "number" ? tx.amount : 0;
      if (rate <= 0 || amount <= 0) continue;
      if (isNoIvaCat(tx.catId)) continue;
      const iva = amount * rate / 100;
      if (tx.type === "E") collettata[bucket] += iva;
      else if (tx.type === "U") detraibile[bucket] += iva;
    }
  }
  return labels.slice(0, buckets).map((label, i) => ({
    label,
    ivaCollettata: +collettata[i].toFixed(2),
    ivaDetraibile: +detraibile[i].toFixed(2),
    saldo: +(collettata[i] - detraibile[i]).toFixed(2),
  }));
}

export function totalsIvaPeriods(rows: IvaPeriodRow[]): IvaPeriodRow {
  const c = rows.reduce((s, r) => s + r.ivaCollettata, 0);
  const d = rows.reduce((s, r) => s + r.ivaDetraibile, 0);
  return {
    label: "Totale anno",
    ivaCollettata: +c.toFixed(2),
    ivaDetraibile: +d.toFixed(2),
    saldo: +(c - d).toFixed(2),
  };
}

// Autofatturazione estera (reverse charge): per le transazioni "estero"
// di tipo U, calcoliamo l'IVA da versare al 22% e l'IVA recuperabile in
// detrazione (parità → impatto netto 0 se 100% detraibile). Lasciamo il
// risultato grezzo: la UI può mostrare versare/recuperare/saldo.
export interface AutofatturaSummary {
  imponibileTotale: number;
  ivaVersare: number;
  ivaRecuperabile: number;
  saldoNetto: number;
  righe: { id: string | number | undefined; desc: string; month: number; imponibile: number; iva: number }[];
}

const ESTERO_CATS = new Set<string>([CAT_ESTERO_E, CAT_ESTERO_U]);
const REVERSE_CHARGE_RATE = 22;

export function calcAutofattura(
  transactions: FinplanTransaction[] | undefined,
): AutofatturaSummary {
  const out: AutofatturaSummary = {
    imponibileTotale: 0, ivaVersare: 0, ivaRecuperabile: 0, saldoNetto: 0,
    righe: [],
  };
  if (!transactions) return out;
  for (const tx of transactions) {
    if (tx.type !== "U") continue;
    if (!tx.catId || !ESTERO_CATS.has(tx.catId)) continue;
    const amount = typeof tx.amount === "number" ? tx.amount : 0;
    if (amount <= 0) continue;
    const iva = +(amount * REVERSE_CHARGE_RATE / 100).toFixed(2);
    out.imponibileTotale += amount;
    out.ivaVersare += iva;
    out.ivaRecuperabile += iva;
    out.righe.push({
      id: tx.id,
      desc: tx.desc ?? "",
      month: typeof tx.month === "number" ? tx.month : 0,
      imponibile: +amount.toFixed(2),
      iva,
    });
  }
  out.imponibileTotale = +out.imponibileTotale.toFixed(2);
  out.ivaVersare = +out.ivaVersare.toFixed(2);
  out.ivaRecuperabile = +out.ivaRecuperabile.toFixed(2);
  out.saldoNetto = +(out.ivaVersare - out.ivaRecuperabile).toFixed(2);
  return out;
}

// Helper: ricostruisce i totali mensili `m[]` di una company a partire
// dalle sue transazioni. Usato per mantenere coerenza dopo CRUD su
// Transazioni (mantenendo la chiave `month` come label IT).
export function rebuildMonthly(company: FinplanCompanySnapshot): { month: string; e: number; u: number }[] {
  const { e, u } = aggregateMonthlyFromTx(company.transactions);
  return MONTH_LABELS.map((mo, i) => ({ month: mo, e: e[i], u: u[i] }));
}
