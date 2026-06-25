import type { CustomerJourney, CustomerJourneyItem } from "@shared/schema";

// === Logica pura del tracciamento temporale Customer Journey (Task #185) ===
// Estratta dal componente React (`CustomerJourney.tsx`) per poterla testare a
// unità senza renderizzare la UI (Task #186). NON deve avere import a runtime
// (solo `import type`), così il loader `tsx` può caricarla nei test senza
// trascinare lucide-react / componenti React.

// Stati di un item "non più validi": vengono mostrati attenuati nella timeline.
export const CJ_FADED_STATES: Set<string> = new Set([
  "ko",
  "stornato",
  "annullato",
]);

// Colore di fallback per driver sconosciuti (grigio leggibile light/dark).
export const CJ_DEFAULT_DRIVER_COLOR = "#6B7280";

export const MESI_IT_SHORT = [
  "Gen", "Feb", "Mar", "Apr", "Mag", "Giu",
  "Lug", "Ago", "Set", "Ott", "Nov", "Dic",
];

export function toDateOrNull(d: string | Date | null | undefined): Date | null {
  if (!d) return null;
  const date = typeof d === "string" ? new Date(d) : d;
  return Number.isNaN(date.getTime()) ? null : date;
}

// Data dell'evento di un item: data attivazione, fallback data inserimento.
export function itemEventDate(it: CustomerJourneyItem): Date | null {
  return toDateOrNull(it.dataAttivazione) ?? toDateOrNull(it.dataInserimento);
}

// Indice mese assoluto (anno*12 + mese) per ordinare/diffare i mesi.
export function monthIndex(d: Date): number {
  return d.getFullYear() * 12 + d.getMonth();
}

export function monthIndexLabel(mi: number): string {
  const y = Math.floor(mi / 12);
  const m = ((mi % 12) + 12) % 12;
  return `${MESI_IT_SHORT[m]} ${y}`;
}

// Negozio (PDV) di un item: destinazione, fallback origine, fallback "N/D".
export function itemNegozio(it: CustomerJourneyItem): string {
  return it.pdvDestinazione || it.pdvOrigine || "N/D";
}

// Colore brand del driver, con fallback grigio per driver sconosciuti.
export function cjDriverColor(
  driver: string,
  colorMap: Record<string, string>,
): string {
  return colorMap[driver] ?? CJ_DEFAULT_DRIVER_COLOR;
}

// Stato attenuato (ko/stornato/annullato)?
export function isFadedState(state: string): boolean {
  return CJ_FADED_STATES.has(state);
}

export interface TimelineRow {
  it: CustomerJourneyItem;
  date: Date;
}

export interface TimelineModel {
  // Se true: nessun contratto con data ⇒ la timeline mostra lo stato vuoto.
  empty: boolean;
  t0Date: Date | null;
  t0mi: number;
  t6mi: number;
  startMi: number;
  endMi: number;
  months: number[];
  t0ItemId: string | undefined;
  rows: TimelineRow[];
}

// Costruisce il modello della timeline (asse mesi T0–T6 esteso, riga T0, righe
// per contratto). È il cuore testabile del componente CustomerJourneyTimeline.
export function computeTimeline(
  journey: CustomerJourney,
  items: CustomerJourneyItem[],
): TimelineModel {
  const withDate = items
    .map((it) => ({ it, date: itemEventDate(it) }))
    .filter((d): d is TimelineRow => d.date !== null);

  // T0 = mese di apertura journey; fallback alla prima attivazione mobile, poi
  // al primo evento in assoluto.
  const t0Date =
    toDateOrNull(journey.openedAt) ??
    withDate
      .filter((d) => d.it.driver === "mobile")
      .sort((a, b) => a.date.getTime() - b.date.getTime())[0]?.date ??
    [...withDate].sort((a, b) => a.date.getTime() - b.date.getTime())[0]?.date ??
    null;

  if (!t0Date || withDate.length === 0) {
    return {
      empty: true,
      t0Date: null,
      t0mi: 0,
      t6mi: 0,
      startMi: 0,
      endMi: 0,
      months: [],
      t0ItemId: undefined,
      rows: [],
    };
  }

  const t0mi = monthIndex(t0Date);
  const t6mi = t0mi + 6;
  const eventMis = withDate.map((d) => monthIndex(d.date));
  const startMi = Math.min(t0mi, ...eventMis);
  const endMi = Math.max(t6mi, ...eventMis);
  const months: number[] = [];
  for (let mi = startMi; mi <= endMi; mi++) months.push(mi);

  // Item che ha aperto la journey (T0): match sui riferimenti BiSuite del
  // trigger, fallback alla prima attivazione mobile per data, poi al primo
  // evento in assoluto.
  const t0ItemId = (() => {
    const byTrigger = items.find(
      (it) =>
        (journey.triggerSaleId && it.bisuiteSaleId === journey.triggerSaleId) ||
        (journey.triggerBisuiteId != null && it.bisuiteId === journey.triggerBisuiteId),
    );
    if (byTrigger) return byTrigger.id;
    const firstMobile = withDate
      .filter((d) => d.it.driver === "mobile")
      .sort((a, b) => a.date.getTime() - b.date.getTime())[0];
    if (firstMobile) return firstMobile.it.id;
    const firstEvent = [...withDate].sort(
      (a, b) => a.date.getTime() - b.date.getTime(),
    )[0];
    return firstEvent?.it.id;
  })();

  // Una riga per contratto, ordinata per data evento.
  const rows = [...withDate].sort((a, b) => a.date.getTime() - b.date.getTime());

  return {
    empty: false,
    t0Date,
    t0mi,
    t6mi,
    startMi,
    endMi,
    months,
    t0ItemId,
    rows,
  };
}

// Raggruppa gli item per negozio (PDV), ordinati per numero di contratti
// decrescente. Usato dalla sezione "Dettaglio per negozio".
export function groupByNegozio(
  items: CustomerJourneyItem[],
): Array<[string, CustomerJourneyItem[]]> {
  const negozioMap = new Map<string, CustomerJourneyItem[]>();
  for (const it of items) {
    const key = itemNegozio(it);
    const arr = negozioMap.get(key);
    if (arr) arr.push(it);
    else negozioMap.set(key, [it]);
  }
  return Array.from(negozioMap.entries()).sort(
    (a, b) => b[1].length - a[1].length,
  );
}
