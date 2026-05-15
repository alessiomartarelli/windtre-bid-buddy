// Proiezioni a 12 mesi (Task #145).
// Riproduce la formula del tool standalone HTML (rimosso in Task #148, vedi git;
// ~righe 3148-3163): media degli E/U mensili attuali, applica una crescita
// composta `g` per le entrate e `g*0.4` per le uscite (le uscite seguono
// con minor elasticità: assume costi semi-fissi).
//
// Pure function: nessuna dipendenza React/DOM. Riusabile in Consolidato (#147).

import type { FinplanCompanySnapshot } from "@shared/finplanSchema";

export interface ProiezioneMese {
  /** Indice 0..11 (offset dal mese corrente). */
  i: number;
  /** Entrate proiettate. */
  e: number;
  /** Uscite proiettate. */
  u: number;
  /** Cashflow proiettato (e - u). */
  cf: number;
}

export interface ProiezioneResult {
  /** Media mensile entrate attuali. */
  avgE: number;
  /** Media mensile uscite attuali. */
  avgU: number;
  /** Tasso di crescita applicato (frazione, es 0.05 = +5%). */
  g: number;
  /** 12 mesi proiettati. */
  proj: ProiezioneMese[];
  /** Totali proiettati su 12 mesi. */
  totals: { e: number; u: number; cf: number };
}

export function computeProiezioni(co: FinplanCompanySnapshot | undefined, growthPct: number): ProiezioneResult {
  // Legacy `renderProj` (index.html ~3148): media su 12 mesi FISSI a
  // partire da `co.m[]` (totali lordo). Manteniamo la stessa formula
  // per byte-compat con i risultati prodotti dall'iframe.
  let sumE = 0, sumU = 0;
  const m = co?.m;
  if (Array.isArray(m)) {
    for (const r of m) {
      sumE += r?.e ?? 0;
      sumU += r?.u ?? 0;
    }
  }
  const avgE = sumE / 12;
  const avgU = sumU / 12;
  const g = (Number.isFinite(growthPct) ? growthPct : 0) / 100;
  const gU = g * 0.4;
  const proj: ProiezioneMese[] = [];
  let totE = 0, totU = 0;
  for (let i = 0; i < 12; i++) {
    const eM = +(avgE * Math.pow(1 + g, i + 1)).toFixed(2);
    const uM = +(avgU * Math.pow(1 + gU, i + 1)).toFixed(2);
    proj.push({ i, e: eM, u: uM, cf: +(eM - uM).toFixed(2) });
    totE += eM;
    totU += uM;
  }
  return {
    avgE: +avgE.toFixed(2),
    avgU: +avgU.toFixed(2),
    g,
    proj,
    totals: { e: +totE.toFixed(2), u: +totU.toFixed(2), cf: +(totE - totU).toFixed(2) },
  };
}
