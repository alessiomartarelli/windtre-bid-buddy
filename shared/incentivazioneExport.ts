// Logica PURA per la costruzione delle righe/colonne dell'export PDF
// dell'Incentivazione interna (gare addetto). Import RELATIVI (niente
// jsPDF/react) così è caricabile via loader `tsx` senza browser e
// testabile in isolamento, come per customerJourneyExport.
import { fmtV } from "./incentivazione";
import type {
  Employee, Section, Track, Semaforo,
} from "./incentivazione";

export const INC_STATUS_LABEL: Record<Semaforo, string> = {
  g: "Premio",
  a: "In proiezione",
  r: "A rischio",
  u: "—",
};

/** Piste mostrate nell'export: come nelle card, le sub-piste sono escluse. */
export function incExportTracks(section: Section): Track[] {
  return section.tracks.filter((t) => !t.sub);
}

/** Intestazione colonna pista (suffisso "(live)" per le piste BiSuite). */
export function incTrackHeader(t: Track): string {
  return t.live ? `${t.name} (live)` : t.name;
}

/** Cella valore pista: "attuale → proiezione / target" oppure "—". */
export function incTrackCell(emp: Employee, t: Track): string {
  const td = emp.tds[t.id];
  if (!td || td.actual === null) return "—";
  return `${fmtV(td.actual, t.unit)} → ${fmtV(td.proj, t.unit)} / ${fmtV(td.target, t.unit)}`;
}

/** Intestazioni tabella: colonne fisse + una per pista. */
export function incExportHead(section: Section): string[] {
  return ["Addetto", "Stato", "Sblocco", ...incExportTracks(section).map(incTrackHeader)];
}

/** Righe tabella: una per addetto, allineate a `incExportHead`. */
export function incExportBody(section: Section, emps: Employee[]): string[][] {
  const tracks = incExportTracks(section);
  return emps.map((e) => [
    e.name,
    INC_STATUS_LABEL[e.status],
    e.unlockProjected ? "Sì" : "No",
    ...tracks.map((t) => incTrackCell(e, t)),
  ]);
}

/** Base del nome file (senza estensione), sanificata. */
export function incExportFileBase(section: Section, month: number, year: number): string {
  const safe = `${section.op}_${section.label}`
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "") || "sezione";
  return `incentivazione_${safe}_${String(month).padStart(2, "0")}_${year}`;
}
