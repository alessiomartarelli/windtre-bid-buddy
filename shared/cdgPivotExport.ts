// Shaping puro dell'export Excel della pivot voci di costo (Controllo di
// Gestione). Estratto da client/src/pages/ControlloGestione.tsx per essere
// testabile con tsx (Task #357): nessuna dipendenza da xlsx/react, produce
// solo la struttura {nome foglio, righe} che il client passa a SheetJS.

export type PivotRiga = {
  label: string;
  rs: string;
  values: Map<string, number>;
  totale: number;
};

export type PivotExportInput = {
  colonne: string[];
  righe: PivotRiga[];
  colTot: Map<string, number>;
  totaleGenerale: number;
  pivotRaggr: "rs" | "pdv";
};

export type PivotExportSheet = {
  name: string;
  rows: Record<string, string | number>[];
};

// Nomi foglio Excel: max 31 caratteri, senza caratteri vietati, univoci
// (dedup case-insensitive con suffisso " (n)").
export function sanitizeSheetName(name: string, used: Set<string>): string {
  let base = name.replace(/[\\/?*[\]:]/g, " ").replace(/\s+/g, " ").trim() || "Foglio";
  base = base.slice(0, 31).trim();
  let candidate = base;
  let n = 2;
  while (used.has(candidate.toLowerCase())) {
    const suffix = ` (${n})`;
    candidate = base.slice(0, 31 - suffix.length).trim() + suffix;
    n += 1;
  }
  used.add(candidate.toLowerCase());
  return candidate;
}

// Costruisce i fogli dell'export: foglio "Totale" (replica della tabella a
// schermo, riga Totale inclusa) + un foglio per Ragione Sociale, in ordine
// di prima apparizione nelle righe già ordinate per totale decrescente.
export function buildPivotExportSheets(input: PivotExportInput): PivotExportSheet[] {
  const { colonne, righe, colTot, totaleGenerale, pivotRaggr } = input;
  if (righe.length === 0) return [];
  const usedNames = new Set<string>();
  const sheets: PivotExportSheet[] = [];

  const rsOrder: string[] = [];
  const byRs = new Map<string, PivotRiga[]>();
  for (const r of righe) {
    if (!byRs.has(r.rs)) { byRs.set(r.rs, []); rsOrder.push(r.rs); }
    byRs.get(r.rs)!.push(r);
  }

  const rowLabelHeader = pivotRaggr === "rs" ? "Ragione Sociale" : "Punto Vendita";

  // Foglio riepilogativo "Totale".
  {
    const rows: Record<string, string | number>[] = righe.map(r => {
      const o: Record<string, string | number> = { [rowLabelHeader]: r.label };
      for (const c of colonne) o[c] = r.values.get(c) || 0;
      o["Totale"] = r.totale;
      return o;
    });
    const totRow: Record<string, string | number> = { [rowLabelHeader]: "Totale" };
    for (const c of colonne) totRow[c] = colTot.get(c) || 0;
    totRow["Totale"] = totaleGenerale;
    rows.push(totRow);
    sheets.push({ name: sanitizeSheetName("Totale", usedNames), rows });
  }

  // Un foglio per ogni RS.
  for (const rs of rsOrder) {
    const rsRows = byRs.get(rs)!;
    let rows: Record<string, string | number>[];
    if (pivotRaggr === "rs") {
      // Voci di costo come righe con importo + riga Totale RS.
      const r = rsRows[0];
      rows = colonne
        .filter(c => (r.values.get(c) || 0) !== 0)
        .map(c => ({ "Voce di costo": c, "Importo": r.values.get(c) || 0 }));
      rows.push({ "Voce di costo": "Totale", "Importo": r.totale });
    } else {
      // PDV come righe × categorie in colonna + colonna e riga Totale.
      const rsCols = colonne.filter(c => rsRows.some(r => (r.values.get(c) || 0) !== 0));
      rows = rsRows.map(r => {
        const o: Record<string, string | number> = { "Punto Vendita": r.label };
        for (const c of rsCols) o[c] = r.values.get(c) || 0;
        o["Totale"] = r.totale;
        return o;
      });
      const totRow: Record<string, string | number> = { "Punto Vendita": "Totale" };
      for (const c of rsCols) {
        totRow[c] = rsRows.reduce((s, r) => s + (r.values.get(c) || 0), 0);
      }
      totRow["Totale"] = rsRows.reduce((s, r) => s + r.totale, 0);
      rows.push(totRow);
    }
    sheets.push({ name: sanitizeSheetName(rs, usedNames), rows });
  }

  return sheets;
}
