import {
  CJ_DRIVER_LABELS, CJ_DRIVER_ORDER, CJ_ITEM_STATE_LABELS,
} from "./customerJourney";
import type { CustomerJourney, CustomerJourneyItem, CjDriver } from "./schema";

// === Logica pura di costruzione righe/colonne degli export Customer Journey ===
// Estratta da `client/src/lib/customerJourneyExport.ts` (Task #190) per poter
// testare a unità la formattazione/serializzazione (intestazioni, mapping
// campi, valori driver/stato, filterLabel) senza renderizzare il PDF/Excel.
// Vive in `shared/` con import RELATIVI (`./customerJourney`, `./schema` type)
// così il loader `tsx` la carica nei test senza trascinare jsPDF / xlsx /
// react-dom: lo stesso pattern di `shared/customerJourney.ts`.

// Equivalente testuale dell'icona driver, usato come indicatore visivo negli
// export Excel (le celle XLSX non possono contenere immagini con SheetJS) e
// come col 0 delle righe Excel. Tenuto qui (non in `customerJourneyIcons.ts`,
// che importa lucide-react) per restare caricabile senza runtime React.
export const CJ_DRIVER_EMOJI: Record<CjDriver, string> = {
  mobile: "📱",
  fisso: "📡",
  energia: "⚡",
  assicurazioni: "🛡️",
  telefono: "☎️",
  protetti: "🚨",
};

export interface CjExportDriverSummary {
  driver: string;
  activated: boolean;
  count: number;
}

export type CjListJourney = CustomerJourney & { drivers: CjExportDriverSummary[] };

// Numero di colonne fisse (non-driver) prima delle colonne per-driver nella
// tabella PDF dell'elenco, usato per mappare l'indice colonna ↔ driver nei
// callback di disegno delle icone.
export const LIST_FIXED_COLS = 5;

/** Data localizzata it-IT, "—" se nulla/non valida. */
export function fmtDate(d: string | Date | null | undefined): string {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("it-IT");
}

/**
 * Titolo della scheda: per le aziende ragione sociale (fallback nominativo →
 * customerKey); per i privati Nome+Cognome (fallback nominativo → customerKey).
 */
export function journeyTitle(j: CustomerJourney): string {
  if (j.customerType === "azienda") return j.ragioneSociale || j.nominativo || j.customerKey;
  const full = [j.nome, j.cognome].filter(Boolean).join(" ").trim();
  return full || j.nominativo || j.customerKey;
}

/** Nome file safe (solo word chars, `.` e `-`), fallback "journey". */
export function safeFileName(s: string): string {
  return s.replace(/[^\w.-]+/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "") || "journey";
}

/** Etichetta driver, fallback alla stringa grezza se sconosciuto. */
export function driverLabel(driver: string): string {
  return CJ_DRIVER_LABELS[driver as CjDriver] || driver;
}

/** Descrizione item: descrizione → tipologia → categoria → "—". */
export function itemDescription(it: CustomerJourneyItem): string {
  return it.descrizione || it.tipologia || it.categoria || "—";
}

/** Etichetta stato item, fallback al valore grezzo se sconosciuto. */
export function itemStateLabel(state: string): string {
  return CJ_ITEM_STATE_LABELS[state as keyof typeof CJ_ITEM_STATE_LABELS] || state;
}

/**
 * Cella RATA/CANONE: la rata se presente, altrimenti il canone (solo per i
 * driver diversi da "telefono"), altrimenti "—". Entrambi prefissati con "€".
 */
export function rataCanone(it: CustomerJourneyItem): string {
  if (it.rata) return `€ ${it.rata}`;
  if (it.canone && it.driver !== "telefono") return `€ ${it.canone}`;
  return "—";
}

function driverSummaryMap(drivers: CjExportDriverSummary[]): Map<string, CjExportDriverSummary> {
  return new Map((drivers ?? []).map((d) => [d.driver, d]));
}

export function journeyDriverMap(j: CjListJourney): Map<string, CjExportDriverSummary> {
  return driverSummaryMap(j.drivers ?? []);
}

/** Numero di driver attivati per una scheda dell'elenco. */
export function activeDriverCount(j: CjListJourney): number {
  const m = journeyDriverMap(j);
  return CJ_DRIVER_ORDER.filter((d) => m.get(d)?.activated).length;
}

// === DETTAGLIO scheda — header/sezioni comuni ===

/** Riga meta del dettaglio (CF/P.IVA, telefono, cod. cliente, data apertura). */
export function detailMeta(j: CustomerJourney): string {
  return [
    `${j.customerType === "azienda" ? "P.IVA" : "CF"}: ${j.customerKey}`,
    j.telefono ? `Tel: ${j.telefono}` : "",
    j.codiceCliente ? `Cod. cliente: ${j.codiceCliente}` : "",
    `Aperta il ${fmtDate(j.openedAt)}`,
  ].filter(Boolean).join("  ·  ");
}

export function driverTableHead(): string[] {
  return ["", "Driver", "Stato", "Contratti"];
}

/**
 * Corpo della tabella Driver del dettaglio. `withEmoji` controlla la col 0:
 * emoji per l'Excel, "" per il PDF (dove l'icona è disegnata come immagine).
 */
export function driverTableBody(
  drivers: CjExportDriverSummary[],
  withEmoji: boolean,
): (string | number)[][] {
  const m = driverSummaryMap(drivers);
  return CJ_DRIVER_ORDER.map((driver) => {
    const s = m.get(driver);
    return [
      withEmoji ? CJ_DRIVER_EMOJI[driver] || "" : "",
      driverLabel(driver),
      s?.activated ? "Attivato" : "Attivabile",
      s?.count ?? 0,
    ];
  });
}

export function contractsHead(): string[] {
  return [
    "", "Driver", "Descrizione", "Contratto", "Addetto", "PDV",
    "IMEI", "RATA/CANONE", "Inserito", "Attivato", "Stato", "Gettone",
  ];
}

/** Corpo della tabella Contratti del dettaglio (PDV destinazione → origine). */
export function contractsBody(
  items: CustomerJourneyItem[],
  withEmoji: boolean,
): (string | number)[][] {
  return items.map((it) => [
    withEmoji ? CJ_DRIVER_EMOJI[it.driver as CjDriver] || "" : "",
    driverLabel(it.driver),
    itemDescription(it),
    it.codiceContratto || "—",
    it.addetto || "—",
    it.pdvDestinazione || it.pdvOrigine || "—",
    it.imei || "—",
    rataCanone(it),
    fmtDate(it.dataInserimento),
    fmtDate(it.dataAttivazione),
    itemStateLabel(it.state),
    it.gettoneConfirmed ? "Sì" : "No",
  ]);
}

/** Righe di intestazione del foglio Excel del dettaglio. */
export function detailExcelHeaderRows(j: CustomerJourney): (string | number)[][] {
  return [
    ["Customer Journey"],
    [journeyTitle(j)],
    [`${j.customerType === "azienda" ? "P.IVA" : "CF"}`, j.customerKey],
    ["Telefono", j.telefono || "—"],
    ["Cod. cliente", j.codiceCliente || "—"],
    ["Aperta il", fmtDate(j.openedAt)],
    [],
  ];
}

/** Nome file del dettaglio (senza estensione). */
export function detailFileBase(j: CustomerJourney): string {
  return `customer_journey_${safeFileName(journeyTitle(j))}`;
}

// === ELENCO schede ===

/** Sottotitolo dell'elenco PDF (conteggio · filtro · data export). */
export function listSubtitle(
  journeys: CjListJourney[],
  filterLabel: string | undefined,
  exportedAt: Date,
): string {
  return [
    `${journeys.length} journey`,
    filterLabel,
    `Esportato il ${fmtDate(exportedAt)}`,
  ].filter(Boolean).join("  ·  ");
}

/** Intestazione tabella elenco PDF: 5 colonne fisse + 1 vuota per driver. */
export function listPdfHead(): string[] {
  return [
    "Cliente", "Tipo", "CF/P.IVA", "Stato", "Driver",
    ...CJ_DRIVER_ORDER.map(() => ""),
  ];
}

/** Corpo tabella elenco PDF: 1 riga per scheda, "Si"/"" per driver. */
export function listPdfBody(journeys: CjListJourney[]): (string | number)[][] {
  const total = CJ_DRIVER_ORDER.length;
  return journeys.map((j) => {
    const m = journeyDriverMap(j);
    return [
      journeyTitle(j),
      j.customerType === "azienda" ? "Business" : "Privato",
      j.customerKey,
      j.status === "aperta" ? "Aperta" : "Chiusa",
      `${activeDriverCount(j)}/${total}`,
      ...CJ_DRIVER_ORDER.map((d) => (m.get(d)?.activated ? "Si" : "")),
    ];
  });
}

/** Righe di intestazione del foglio Excel dell'elenco (titolo/meta + vuota). */
export function listExcelHeaderRows(
  journeys: CjListJourney[],
  filterLabel: string | undefined,
  exportedAt: Date,
): (string | number)[][] {
  const rows: (string | number)[][] = [
    ["Customer Journey — Elenco"],
    [`${journeys.length} journey`],
  ];
  if (filterLabel) rows.push([filterLabel]);
  rows.push([`Esportato il ${fmtDate(exportedAt)}`]);
  rows.push([]);
  return rows;
}

/** Intestazione tabella elenco Excel: include Telefono + emoji per driver. */
export function listExcelHead(): string[] {
  return [
    "Cliente", "Tipo", "CF/P.IVA", "Telefono", "Stato", "Driver attivati",
    ...CJ_DRIVER_ORDER.map((d) => CJ_DRIVER_EMOJI[d] || driverLabel(d)),
  ];
}

/** Corpo tabella elenco Excel: 1 riga per scheda, "Sì"/"" per driver. */
export function listExcelBody(journeys: CjListJourney[]): (string | number)[][] {
  const total = CJ_DRIVER_ORDER.length;
  return journeys.map((j) => {
    const m = journeyDriverMap(j);
    return [
      journeyTitle(j),
      j.customerType === "azienda" ? "Business" : "Privato",
      j.customerKey,
      j.telefono || "—",
      j.status === "aperta" ? "Aperta" : "Chiusa",
      `${activeDriverCount(j)}/${total}`,
      ...CJ_DRIVER_ORDER.map((d) => (m.get(d)?.activated ? "Sì" : "")),
    ];
  });
}
