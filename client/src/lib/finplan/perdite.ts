// Recupero perdite (Task #145).
// Riproduce la logica di `index.html` ~righe 3010-3110 (`renderPerdite`).
//
// Formula esatta dal legacy:
//   - co.m[]   → totali mensili LORDO (E/U)
//   - ivaTot_E = somma su tutte le tx (escluse NO_IVA) di tx.amount * tx.ivaRate/100 per type='E'
//   - ivaPerMese[mi].ivaE = ivaTot_E / 12 (distribuzione uniforme)
//   - eNetto[mi] = m.e[mi] - ivaPerMese[mi].ivaE
//   - cfNetto[mi] = eNetto[mi] - uNetto[mi]
//   - quota[mi]:
//       usaCashFlow=true  → mi >= mesePart ? max(0, cfNetto[mi]) : 0
//       usaCashFlow=false → manuale[mi] || 0  (NESSUN gating per mesePart)
//   - recuperoTotale = min(importo, sum(quota))   ← cap legacy
//   - cumulato per mese = min(sum_fino_a_mi, importo)
//
// Anti-deriva: l'iframe legacy usa Math.round per le componenti IVA;
// qui manteniamo la stessa interpretazione (round a intero) per
// risultati cross-engine identici quando lo stesso snapshot viene
// alternativamente letto dall'iframe e dalla shell React.

import type { FinplanCompanySnapshot, FinplanPerdite } from "@shared/finplanSchema";
import {
  CAT_INFRAGRUPPO_E, CAT_INFRAGRUPPO_U,
  CAT_GIROCONTO_E, CAT_GIROCONTO_U,
  CAT_ESTERO_E, CAT_ESTERO_U,
  MO,
} from "@/lib/finplanImport";

const NO_IVA = new Set<string>([
  CAT_INFRAGRUPPO_E, CAT_INFRAGRUPPO_U,
  CAT_GIROCONTO_E, CAT_GIROCONTO_U,
  CAT_ESTERO_E, CAT_ESTERO_U,
]);

export interface RecuperoMese {
  i: number;
  eNetto: number;
  uNetto: number;
  cfNetto: number;
  quota: number;
  cumulato: number;
}

export interface RecuperoResult {
  importo: number;
  recuperato: number;       // cappato a importo (legacy: Math.min)
  recuperoCumulatoRaw: number; // somma quote senza cap (informativo)
  residuo: number;
  pct: number;
  cfTotale: number;
  mesi: RecuperoMese[];
}

function getMonthly(co: FinplanCompanySnapshot | undefined): { e: number[]; u: number[] } {
  const e = Array(12).fill(0);
  const u = Array(12).fill(0);
  const m = co?.m;
  if (Array.isArray(m)) {
    for (let i = 0; i < 12 && i < m.length; i++) {
      e[i] = m[i]?.e ?? 0;
      u[i] = m[i]?.u ?? 0;
    }
  }
  return { e, u };
}

function distributedIva(co: FinplanCompanySnapshot | undefined): { ivaE: number; ivaU: number } {
  let ivaE = 0, ivaU = 0;
  for (const tx of co?.transactions ?? []) {
    if (tx.catId && NO_IVA.has(tx.catId)) continue;
    const amount = typeof tx.amount === "number" ? tx.amount : 0;
    const rate = typeof tx.ivaRate === "number" ? tx.ivaRate : 0;
    const iva = Math.round(amount * rate / 100);
    if (tx.type === "E") ivaE += iva / 12;
    else if (tx.type === "U") ivaU += iva / 12;
  }
  return { ivaE, ivaU };
}

export function computeRecupero(
  co: FinplanCompanySnapshot | undefined,
  perdite: FinplanPerdite | undefined,
): RecuperoResult {
  const importo = perdite?.importo ?? 0;
  const mesePart = Math.max(0, Math.min(11, perdite?.mesePart ?? 0));
  const usaCashFlow = perdite?.usaCashFlow !== false;
  const manuale = perdite?.manuale ?? [];
  const monthly = getMonthly(co);
  const iva = distributedIva(co);

  let recuperoCumulatoRaw = 0;
  let cfTotale = 0;
  const mesi: RecuperoMese[] = [];
  for (let mi = 0; mi < 12; mi++) {
    const eNetto = monthly.e[mi] - iva.ivaE;
    const uNetto = monthly.u[mi] - iva.ivaU;
    const cfNetto = eNetto - uNetto;
    cfTotale += monthly.e[mi] - monthly.u[mi];
    let quota = 0;
    if (usaCashFlow) {
      if (mi >= mesePart) quota = Math.max(0, cfNetto);
    } else {
      // Legacy: nessun gating per mesePart in modalità manuale.
      const m = manuale[mi];
      quota = typeof m === "number" && m > 0 ? m : 0;
    }
    recuperoCumulatoRaw += quota;
    mesi.push({
      i: mi,
      eNetto: +eNetto.toFixed(2),
      uNetto: +uNetto.toFixed(2),
      cfNetto: +cfNetto.toFixed(2),
      quota: +quota.toFixed(2),
      cumulato: +Math.min(recuperoCumulatoRaw, importo).toFixed(2),
    });
  }
  const recuperato = +Math.min(importo, recuperoCumulatoRaw).toFixed(2);
  const residuo = +Math.max(0, importo - recuperato).toFixed(2);
  const pct = importo > 0 ? Math.min(100, recuperato / importo * 100) : 0;
  return {
    importo,
    recuperato,
    recuperoCumulatoRaw: +recuperoCumulatoRaw.toFixed(2),
    residuo,
    pct: +pct.toFixed(1),
    cfTotale: +cfTotale.toFixed(2),
    mesi,
  };
}

// Riesposto per consumer (non strettamente necessario, ma comodo per UI).
export const PERDITE_MONTHS = MO;
