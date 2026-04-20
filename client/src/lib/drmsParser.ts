import * as XLSX from "xlsx";

export type RawXlsxRow = Record<string, unknown>;

/**
 * Legge un file Excel DRMS e restituisce le righe del foglio "Estratto conto"
 * (o del primo foglio disponibile se non presente).
 */
export async function parseExcelFile(file: File): Promise<RawXlsxRow[]> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  const sheetName = wb.SheetNames.includes("Estratto conto") ? "Estratto conto" : wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  return XLSX.utils.sheet_to_json<RawXlsxRow>(ws, { defval: null, raw: false });
}
