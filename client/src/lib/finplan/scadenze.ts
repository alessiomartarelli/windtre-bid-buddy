// Scadenziario unificato finanziamenti + AdE (Task #145).
//
// Restituisce una lista ordinata per data ASC che combina:
//   1. `debtScadenze` — scadenze libere o legate a finanziamenti
//      (kind="debt", payload originale in `source`).
//   2. `ade[]` non rateizzati — singola scadenza globale (`scadenza`)
//      (kind="ade").
//   3. `ade[].rateScadenze[]` — singole rate del piano AdE
//      (kind="ade-rata").
//
// I campi normalizzati (`data`, `importo`, `pagata`, `note`, `label`)
// sono letti dai campi canonici legacy con fallback sui nomi più
// vecchi (`date/amount`).
//
// Pure function: nessuna dipendenza React/DOM.

import type { FinplanAde, FinplanDebtScadenza } from "@shared/finplanSchema";

export type UnifiedScadenza =
  | {
      kind: "debt";
      key: string;
      data: string;
      importo: number;
      pagata: boolean;
      note?: string;
      label: string;
      source: FinplanDebtScadenza;
    }
  | {
      kind: "ade";
      key: string;
      data: string;
      importo: number;
      pagata: boolean;
      note?: string;
      label: string;
      adeId: FinplanAde["id"];
    }
  | {
      kind: "ade-rata";
      key: string;
      data: string;
      importo: number;
      pagata: boolean;
      note?: string;
      label: string;
      adeId: FinplanAde["id"];
      rataId: number | string | undefined;
    };

export function buildUnifiedScadenze(
  scadenze: FinplanDebtScadenza[],
  ade: FinplanAde[],
): UnifiedScadenza[] {
  const out: UnifiedScadenza[] = [];

  for (const s of scadenze ?? []) {
    out.push({
      kind: "debt",
      key: `d-${s.id ?? Math.random()}`,
      data: String(s.data ?? s.date ?? ""),
      importo: Number(s.importo ?? s.amount ?? 0) || 0,
      pagata: !!s.pagata,
      note: s.note,
      label: s.debtName ? s.debtName : "— libera —",
      source: s,
    });
  }

  for (const a of ade ?? []) {
    const ref = `${a.tipo ?? "ade"}${a.numero ? ` n. ${a.numero}` : ""}${a.anno ? `/${a.anno}` : ""}${a.tributo ? ` — ${a.tributo}` : ""}`;
    const rate = a.rateScadenze ?? [];
    if (a.rateazione && rate.length > 0) {
      // Esplodi le singole rate (eredita `pagata` dalla rata).
      for (const r of rate) {
        out.push({
          kind: "ade-rata",
          key: `ar-${a.id}-${r.id ?? Math.random()}`,
          data: String(r.data ?? ""),
          importo: Number(r.importo ?? a.importoRata ?? 0) || 0,
          pagata: !!r.pagata,
          note: r.n != null ? `Rata ${r.n}/${a.nRate ?? rate.length}` : undefined,
          label: ref,
          adeId: a.id,
          rataId: r.id,
        });
      }
    } else if (a.scadenza) {
      // Singola scadenza globale dell'AdE.
      out.push({
        kind: "ade",
        key: `a-${a.id}`,
        data: String(a.scadenza),
        importo: Number(a.importo ?? 0) || 0,
        pagata: a.stato === "pagato",
        note: a.note,
        label: ref,
        adeId: a.id,
      });
    }
  }

  out.sort((x, y) => {
    const da = x.data || "9999-12-31";
    const db = y.data || "9999-12-31";
    return da.localeCompare(db);
  });
  return out;
}
