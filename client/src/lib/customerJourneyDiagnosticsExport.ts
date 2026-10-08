import * as XLSX from "xlsx";
import {
  buildCjDiagnosticsSheets, type CjSimDiagnostics,
} from "../../../shared/customerJourneyDiagnosticsExport";
import type { CjListFilters } from "../../../shared/customerJourney";

/** Kept free of DOM APIs so tests can serialize and read back the actual XLSX. */
export function buildCjDiagnosticsWorkbook(
  diagnostics: CjSimDiagnostics, filters: CjListFilters, from: string, to: string,
): XLSX.WorkBook {
  const workbook = XLSX.utils.book_new();
  for (const { name, rows } of buildCjDiagnosticsSheets(diagnostics, filters, from, to)) {
    const sheet = XLSX.utils.aoa_to_sheet(rows);
    sheet["!cols"] = rows[0].map((label, i) => ({ wch: name === "Riepilogo" ? (i === 0 ? 55 : 100) : Math.min(45, Math.max(18, String(label).length)) }));
    sheet["!autofilter"] = { ref: sheet["!ref"]! };
    XLSX.utils.book_append_sheet(workbook, sheet, name);
  }
  return workbook;
}

export function exportCjDiagnosticsExcel(
  diagnostics: CjSimDiagnostics, filters: CjListFilters, from: string, to: string,
) {
  XLSX.writeFile(buildCjDiagnosticsWorkbook(diagnostics, filters, from, to),
    `diagnostica_sim_cj_${from || "inizio"}_${to || "oggi"}.xlsx`);
}
