// Helper PURO condiviso per l'export dell'Incentivazione interna.
import type { Section } from "./incentivazione";

/** Base del nome file (senza estensione), sanificata. */
export function incExportFileBase(section: Section, month: number, year: number): string {
  const safe = `${section.op}_${section.label}`
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "") || "sezione";
  return `incentivazione_${safe}_${String(month).padStart(2, "0")}_${year}`;
}
