// Budget annuale per categoria (Task #145).
// Sorgente storica: `index.html` ~righe 4670-4805.
//
// `bgt = { e, u, catBudget:[{catId, annual}], ripartizione: 'uniforme'|'ponderata' }`
//
// - getCatBudget(catId) → annual budget per categoria (0 se non impostato).
// - getCatActual(co, catId) → totale actual da transactions per categoria.
// - getBudgetMonthly(catId, monthlyActuals) → ripartizione mensile:
//     - uniforme: annual / 12
//     - ponderata: annual * (actual_mese / actual_anno)
// - ragColor(actual, budget, kind):
//     - E (entrate, kind='E'): ≥90% green, ≥70% amber, else red
//     - U (uscite,  kind='U'): ≤100% green, ≤120% amber, else red

import type { FinplanBudget, FinplanCompanySnapshot, TxType } from "@shared/finplanSchema";

export type RagLevel = "green" | "amber" | "red";

export function getCatBudget(bgt: FinplanBudget | undefined, catId: string): number {
  const list = bgt?.catBudget ?? [];
  const row = list.find(r => r.catId === catId);
  return row?.annual ?? 0;
}

export function getCatActual(co: FinplanCompanySnapshot | undefined, catId: string): number {
  if (!co?.transactions) return 0;
  let s = 0;
  for (const tx of co.transactions) {
    if (tx.catId === catId && typeof tx.amount === "number") s += tx.amount;
  }
  return +s.toFixed(2);
}

/** Actuals mensili per categoria (12 valori). */
export function getCatActualMonthly(co: FinplanCompanySnapshot | undefined, catId: string): number[] {
  const out = Array(12).fill(0);
  if (!co?.transactions) return out;
  for (const tx of co.transactions) {
    if (tx.catId !== catId) continue;
    const m = typeof tx.month === "number" ? Math.max(0, Math.min(11, tx.month)) : 0;
    out[m] += typeof tx.amount === "number" ? tx.amount : 0;
  }
  return out.map(n => +n.toFixed(2));
}

export function getBudgetMonthly(annual: number, ripartizione: string | undefined, monthlyActuals: number[]): number[] {
  if (!annual || annual <= 0) return Array(12).fill(0);
  if ((ripartizione ?? "uniforme") === "ponderata") {
    const totA = monthlyActuals.reduce((s, n) => s + n, 0);
    if (totA > 0) {
      return monthlyActuals.map(a => +(annual * a / totA).toFixed(2));
    }
  }
  const u = +(annual / 12).toFixed(2);
  return Array(12).fill(u);
}

export function ragColor(actual: number, budget: number, kind: TxType): RagLevel {
  if (!budget || budget <= 0) return "red";
  const pct = (actual / budget) * 100;
  if (kind === "E") {
    if (pct >= 90) return "green";
    if (pct >= 70) return "amber";
    return "red";
  }
  // U: less is better
  if (pct <= 100) return "green";
  if (pct <= 120) return "amber";
  return "red";
}

/** Mappa RagLevel → tailwind text colour. */
export function ragTextClass(r: RagLevel): string {
  return r === "green" ? "text-emerald-600" : r === "amber" ? "text-amber-600" : "text-rose-600";
}

/** Mappa RagLevel → tailwind bg colour (badge). */
export function ragBgClass(r: RagLevel): string {
  return r === "green"
    ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
    : r === "amber"
      ? "bg-amber-500/15 text-amber-700 dark:text-amber-400"
      : "bg-rose-500/15 text-rose-700 dark:text-rose-400";
}
