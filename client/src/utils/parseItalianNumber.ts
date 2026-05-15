// Parser robusto per numeri in formato italiano ("1.234,56") + fallback
// inglese ("1234.56" / "1,234.56"). Usato dagli input numerici delle
// sezioni FinPlan per evitare interpretazioni silenti errate.

export function parseItalianNumber(input: string | number | null | undefined): number {
  if (typeof input === "number") return isFinite(input) ? input : 0;
  if (input == null) return 0;
  let s = String(input).trim();
  if (!s) return 0;
  s = s.replace(/[€\s\u00A0]/g, "");
  const hasDot = s.includes(".");
  const hasComma = s.includes(",");
  if (hasDot && hasComma) {
    // L'ultimo separatore presente è quello decimale.
    if (s.lastIndexOf(",") > s.lastIndexOf(".")) {
      s = s.replace(/\./g, "").replace(",", ".");
    } else {
      s = s.replace(/,/g, "");
    }
  } else if (hasComma) {
    s = s.replace(",", ".");
  } else if (hasDot) {
    // Più punti → trattali come migliaia (es. "1.234.567").
    if ((s.match(/\./g) ?? []).length > 1) {
      s = s.replace(/\./g, "");
    }
  }
  const n = parseFloat(s);
  return isFinite(n) ? n : 0;
}
