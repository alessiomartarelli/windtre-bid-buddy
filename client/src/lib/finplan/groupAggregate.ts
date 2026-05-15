// Aggregazione di gruppo (Consolidato) per FinPlan — Task #147.
// Funzioni pure: nessuna dipendenza React/DOM. Riusano i totali mensili
// per Ragione Sociale (con la stessa formula cashflow di Overview.tsx —
// transazioni se presenti, altrimenti fallback su `co.m[]`) e li
// combinano per produrre KPI, serie temporali, pivot RS×mese.
//
// Vincolo architetturale: nessun nuovo endpoint backend; tutto il
// consolidato si calcola client-side dal payload `useFinplanData`.

import type { FinplanCompanySnapshot, FinplanPdvObiettivo } from "@shared/finplanSchema";

export const MO_LABELS = ["Gen","Feb","Mar","Apr","Mag","Giu","Lug","Ago","Set","Ott","Nov","Dic"];

export interface MonthAgg { e: number; u: number; cf: number }

/** Totali mensili per una società, con cashflow basato su `cfExclude`. */
export function companyMonthly(co: FinplanCompanySnapshot | undefined): MonthAgg[] {
  const out: MonthAgg[] = MO_LABELS.map(() => ({ e: 0, u: 0, cf: 0 }));
  if (!co) return out;
  const txs = co.transactions ?? [];
  const cfExE = new Set((co.cfExclude?.E ?? []) as string[]);
  const cfExU = new Set((co.cfExclude?.U ?? []) as string[]);
  if (txs.length > 0) {
    for (const t of txs) {
      const m = typeof t.month === "number" ? t.month : -1;
      if (m < 0 || m > 11) continue;
      const amt = typeof t.amount === "number" ? t.amount : 0;
      if (t.type === "E") {
        out[m].e += amt;
        if (!cfExE.has(String(t.catId ?? ""))) out[m].cf += amt;
      } else if (t.type === "U") {
        out[m].u += amt;
        if (!cfExU.has(String(t.catId ?? ""))) out[m].cf -= amt;
      }
    }
    return out;
  }
  const m = co.m ?? [];
  for (let i = 0; i < 12; i++) {
    const e = typeof m[i]?.e === "number" ? (m[i]!.e as number) : 0;
    const u = typeof m[i]?.u === "number" ? (m[i]!.u as number) : 0;
    out[i] = { e, u, cf: e - u };
  }
  return out;
}

export interface CompanyKpi {
  index: number;
  name: string;
  totE: number;
  totU: number;
  margine: number;
  cashflow: number;
  monthly: MonthAgg[];
}

export interface GroupAggregate {
  companies: CompanyKpi[];
  /** KPI di gruppo (somma RS). */
  totals: { totE: number; totU: number; margine: number; cashflow: number };
  /** Totali mensili di gruppo (somma RS, mese-per-mese). */
  monthly: MonthAgg[];
  /** Composizione di gruppo per categoria (entrate). */
  compE: { name: string; value: number; color: string }[];
  /** Composizione di gruppo per categoria (uscite). */
  compU: { name: string; value: number; color: string }[];
}

function aggregateComposition(companies: FinplanCompanySnapshot[], type: "E" | "U") {
  // Aggrega per nome categoria (chiave umana cross-RS): la stessa cat
  // può avere `id` diversi tra società ma nomi uguali.
  const map = new Map<string, { value: number; color: string }>();
  for (const co of companies) {
    const cats = co.cats ?? [];
    const byId = new Map(cats.filter(c => c.type === type).map(c => [c.id, c]));
    for (const tx of co.transactions ?? []) {
      if (tx.type !== type) continue;
      const cat = byId.get(String(tx.catId ?? ""));
      const name = cat?.name ?? cat?.id ?? "Altro";
      const color = cat?.color ?? "#64748B";
      const amt = typeof tx.amount === "number" ? tx.amount : 0;
      const cur = map.get(name);
      if (cur) cur.value += amt;
      else map.set(name, { value: amt, color });
    }
  }
  return Array.from(map.entries())
    .map(([name, v]) => ({ name, value: +v.value.toFixed(2), color: v.color }))
    .filter(d => d.value > 0)
    .sort((a, b) => b.value - a.value);
}

/** Aggregazione cross-RS — funzione pura. */
export function aggregateGroupData(
  allRs: FinplanCompanySnapshot[],
  defaultNames: string[] = [],
): GroupAggregate {
  const companies: CompanyKpi[] = allRs.map((co, i) => {
    const monthly = companyMonthly(co);
    const totE = monthly.reduce((s, m) => s + m.e, 0);
    const totU = monthly.reduce((s, m) => s + m.u, 0);
    const cashflow = monthly.reduce((s, m) => s + m.cf, 0);
    return {
      index: i,
      name: (co?.name && String(co.name)) || defaultNames[i] || `Società ${i + 1}`,
      totE: +totE.toFixed(2),
      totU: +totU.toFixed(2),
      margine: +(totE - totU).toFixed(2),
      cashflow: +cashflow.toFixed(2),
      monthly,
    };
  });
  const monthly: MonthAgg[] = MO_LABELS.map((_, i) => ({
    e: companies.reduce((s, c) => s + (c.monthly[i]?.e ?? 0), 0),
    u: companies.reduce((s, c) => s + (c.monthly[i]?.u ?? 0), 0),
    cf: companies.reduce((s, c) => s + (c.monthly[i]?.cf ?? 0), 0),
  }));
  const totals = {
    totE: +companies.reduce((s, c) => s + c.totE, 0).toFixed(2),
    totU: +companies.reduce((s, c) => s + c.totU, 0).toFixed(2),
    margine: +companies.reduce((s, c) => s + c.margine, 0).toFixed(2),
    cashflow: +companies.reduce((s, c) => s + c.cashflow, 0).toFixed(2),
  };
  return {
    companies,
    totals,
    monthly,
    compE: aggregateComposition(allRs, "E"),
    compU: aggregateComposition(allRs, "U"),
  };
}

/** Riga obiettivo PDV "appiattita" cross-RS per la tabella di gruppo. */
export interface PdvObiettivoFlat {
  rs: string;
  pdvName: string;
  targetAnnuo: number;
  consuntivo: number;
  delta: number;
  pct: number;
}

export function flattenPdvObiettivi(
  allRs: FinplanCompanySnapshot[],
  defaultNames: string[] = [],
): PdvObiettivoFlat[] {
  const out: PdvObiettivoFlat[] = [];
  allRs.forEach((co, i) => {
    const rs = (co?.name && String(co.name)) || defaultNames[i] || `Società ${i + 1}`;
    const list = (co?.pdvObiettivi ?? []) as FinplanPdvObiettivo[];
    for (const o of list) {
      const target = typeof o.targetAnnuo === "number"
        ? o.targetAnnuo
        : (o.mesi ?? []).reduce((s, n) => s + (typeof n === "number" ? n : 0), 0);
      const consuntivo = (o.actualMesi ?? []).reduce((s, n) => s + (typeof n === "number" ? n : 0), 0);
      out.push({
        rs,
        pdvName: o.pdvName ?? "(senza nome)",
        targetAnnuo: +target.toFixed(2),
        consuntivo: +consuntivo.toFixed(2),
        delta: +(consuntivo - target).toFixed(2),
        pct: target > 0 ? +((consuntivo / target) * 100).toFixed(1) : 0,
      });
    }
  });
  return out;
}

/** Applica scenario what-if (%) ai KPI di gruppo, senza mutare l'input. */
export function applyScenario(
  base: GroupAggregate,
  pctRicavi: number,
  pctCosti: number,
): GroupAggregate {
  const fE = 1 + (Number.isFinite(pctRicavi) ? pctRicavi : 0) / 100;
  const fU = 1 + (Number.isFinite(pctCosti) ? pctCosti : 0) / 100;
  const companies = base.companies.map(c => {
    const monthly = c.monthly.map(m => ({
      e: +(m.e * fE).toFixed(2),
      u: +(m.u * fU).toFixed(2),
      cf: +(m.e * fE - m.u * fU).toFixed(2),
    }));
    const totE = +(c.totE * fE).toFixed(2);
    const totU = +(c.totU * fU).toFixed(2);
    return {
      ...c,
      monthly,
      totE,
      totU,
      margine: +(totE - totU).toFixed(2),
      cashflow: +monthly.reduce((s, m) => s + m.cf, 0).toFixed(2),
    };
  });
  const monthly: MonthAgg[] = MO_LABELS.map((_, i) => ({
    e: companies.reduce((s, c) => s + (c.monthly[i]?.e ?? 0), 0),
    u: companies.reduce((s, c) => s + (c.monthly[i]?.u ?? 0), 0),
    cf: companies.reduce((s, c) => s + (c.monthly[i]?.cf ?? 0), 0),
  }));
  const totals = {
    totE: +companies.reduce((s, c) => s + c.totE, 0).toFixed(2),
    totU: +companies.reduce((s, c) => s + c.totU, 0).toFixed(2),
    margine: +companies.reduce((s, c) => s + c.margine, 0).toFixed(2),
    cashflow: +companies.reduce((s, c) => s + c.cashflow, 0).toFixed(2),
  };
  return { ...base, companies, monthly, totals };
}
