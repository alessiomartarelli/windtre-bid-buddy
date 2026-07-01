import type { CustomerJourney, CustomerJourneyItem } from "@shared/schema";
import { CJ_ACTIVE_STATES, monthOfIso, pisteInWindow } from "../../../shared/customerJourney";

// === Logica pura del tracciamento temporale Customer Journey (Task #185) ===
// Estratta dal componente React (`CustomerJourney.tsx`) per poterla testare a
// unità senza renderizzare la UI (Task #186). Gli unici import a runtime sono
// helper puri di `shared/customerJourney` (`CJ_ACTIVE_STATES`, `monthOfIso`,
// `pisteInWindow`) — nessuna dipendenza React/UI — importati per via relativa
// così il loader `tsx` li risolve nei test senza configurare gli alias. Riusare
// questi helper garantisce che la validità mostrata nella scheda usi ESATTAMENTE
// la stessa regola (e gli stessi mesi UTC) del conteggio gettone condiviso.

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

// === Validità degli item per la scheda cliente (Task #215) ===
// Indica, per ogni contratto mostrato nella timeline, se conta per la
// journey/gettone o meno, con la stessa regola del gettone condiviso:
//   - "attivante": la SIM mobile che ha aperto la journey (T0). È il trigger,
//     non una pista cross-sell.
//   - "valida": pista cross-sell che conta (driver non-mobile, stato attivo,
//     contratto dal mese di T0 in poi, primo del suo driver in finestra).
//   - "non_pista": SIM mobile aggiuntiva (non è una pista cross-sell).
//   - "stato_non_valido": stato ko/annullato/stornato.
//   - "fuori_periodo": contratto di un mese precedente a T0.
//   - "driver_duplicato": pista già conteggiata per quel driver (es. 2ª
//     fornitura energia o 2º contratto stesso driver in finestra).
export type CjItemValidityKind =
  | "attivante"
  | "valida"
  | "non_pista"
  | "stato_non_valido"
  | "fuori_periodo"
  | "driver_duplicato";

export interface CjItemValidity {
  kind: CjItemValidityKind;
  // true solo per le piste che aumentano il gettone (kind === "valida").
  counts: boolean;
}

// Calcola la validità di ogni item mostrato nella timeline (gli item con data).
// Usa ESATTAMENTE il criterio del gettone condiviso (`buildGettoneJourneys`):
// piste = driver non-mobile distinti attivi con data evento nel mese di T0 o
// successivo (`pisteInWindow`, mesi UTC via `monthOfIso`). Il mese di T0 segue la
// stessa precedenza del gettone: apertura journey, poi prima SIM mobile ATTIVA,
// poi primo evento in assoluto. La SIM mobile che apre la journey (trigger
// mostrato dalla timeline) è "attivante", non una pista cross-sell.
export function computeItemValidity(
  model: TimelineModel,
  journey: CustomerJourney,
): Map<string, CjItemValidity> {
  const out = new Map<string, CjItemValidity>();
  const isoOf = (d: Date | null): string | null => (d ? d.toISOString() : null);

  // Mesi (UTC) per il fallback di T0, raccolti come nel gettone: dalle SIM
  // mobile ATTIVE e da tutti gli eventi datati.
  const mobileMonths: number[] = [];
  const allMonths: number[] = [];
  for (const { it, date } of model.rows) {
    const m = monthOfIso(isoOf(date));
    if (m == null) continue;
    allMonths.push(m);
    if (it.driver === "mobile" && CJ_ACTIVE_STATES.has(it.state as never)) {
      mobileMonths.push(m);
    }
  }
  const t0Month =
    monthOfIso(isoOf(toDateOrNull(journey.openedAt))) ??
    (mobileMonths.length ? Math.min(...mobileMonths) : null) ??
    (allMonths.length ? Math.min(...allMonths) : null);

  // Driver già conteggiati come pista in finestra: il primo (per data, perché
  // `model.rows` è ordinato) vince, gli altri dello stesso driver sono
  // "driver_duplicato" (es. gas + luce = una pista sola).
  const counted = new Set<string>();
  for (const { it, date } of model.rows) {
    // "Attivante" SOLO se l'item T0 è la SIM mobile trigger. Se per dati sporchi
    // o fallback il T0 della timeline è un contratto non-mobile, NON va escluso:
    // deve cadere nella normale classificazione pista come nel gettone (che
    // esclude solo i driver mobile), così le label non possono divergere dal
    // conteggio.
    if (it.id === model.t0ItemId && it.driver === "mobile") {
      out.set(it.id, { kind: "attivante", counts: false });
      continue;
    }
    if (it.driver === "mobile") {
      out.set(it.id, { kind: "non_pista", counts: false });
      continue;
    }
    if (!CJ_ACTIVE_STATES.has(it.state as never)) {
      out.set(it.id, { kind: "stato_non_valido", counts: false });
      continue;
    }
    if (!pisteInWindow(isoOf(date), t0Month)) {
      out.set(it.id, { kind: "fuori_periodo", counts: false });
      continue;
    }
    if (counted.has(it.driver)) {
      out.set(it.id, { kind: "driver_duplicato", counts: false });
      continue;
    }
    counted.add(it.driver);
    out.set(it.id, { kind: "valida", counts: true });
  }
  return out;
}

// Etichetta breve della validità per la UI (e i test). Italiano.
export const CJ_VALIDITY_LABELS: Record<CjItemValidityKind, string> = {
  attivante: "Attivante",
  valida: "Conta",
  non_pista: "Non conta",
  stato_non_valido: "Non conta",
  fuori_periodo: "Non conta",
  driver_duplicato: "Non conta",
};

// Spiegazione estesa del perché un contratto conta o no (tooltip della scheda).
export const CJ_VALIDITY_REASONS: Record<CjItemValidityKind, string> = {
  attivante: "SIM mobile che ha aperto la journey (T0): è il trigger, non una pista cross-sell.",
  valida: "Pista cross-sell valida: conta per la journey e per il gettone.",
  non_pista: "SIM mobile aggiuntiva: non è una pista cross-sell.",
  stato_non_valido: "Stato ko/annullato/stornato: non conta per il gettone.",
  fuori_periodo: "Contratto di un mese precedente all'attivazione SIM: non conta per il gettone.",
  driver_duplicato: "Pista dello stesso tipo già conteggiata per questo cliente.",
};

// === Scadenza T6 della journey (Task #232) ===
// La finestra cross-sell di una journey va da T0 (mese di apertura/attivazione
// SIM) a T6 incluso (T0 + 6 mesi): un contratto nel mese di T6 conta ancora.
// La "scadenza" per chiudere il cross-sell è quindi l'ULTIMO giorno del mese
// di T6. Calcoli in UTC, coerenti con `monthOfIso`.

// Ultimo istante utile per chiudere il cross-sell: fine del mese di T6
// (T0 + 6 mesi). null se manca la data di apertura.
export function cjT6Deadline(openedAt: string | Date | null | undefined): Date | null {
  const t0 = toDateOrNull(openedAt);
  if (!t0) return null;
  const y = t0.getUTCFullYear();
  const m = t0.getUTCMonth();
  // Giorno 0 del mese (m+7) = ultimo giorno del mese (m+6) = mese di T6.
  return new Date(Date.UTC(y, m + 7, 0, 23, 59, 59, 999));
}

// Giorni residui (interi) fino alla scadenza T6.
// Positivo = mancano N giorni; 0 = scade oggi; negativo = scaduta da N giorni.
// null se manca la data di apertura.
//
// Si confrontano le DATE DI CALENDARIO in UTC (le stesse componenti usate per
// visualizzare la scadenza), così il conteggio resta coerente con la data
// mostrata e non guadagna un giorno extra per via dell'orario 23:59:59.999 UTC
// della scadenza né per lo sfasamento di fuso orario.
export function cjDaysToT6(
  openedAt: string | Date | null | undefined,
  now: Date = new Date(),
): number | null {
  const dl = cjT6Deadline(openedAt);
  if (!dl) return null;
  const deadlineDay = Date.UTC(dl.getUTCFullYear(), dl.getUTCMonth(), dl.getUTCDate());
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.round((deadlineDay - today) / 86_400_000);
}

// Tono grafico + etichetta della scadenza T6, derivati dai giorni residui.
// Unica sorgente di verità condivisa fra la card della lista e la scheda di
// dettaglio, così i due punti non divergono. `urgent` = da contattare
// (scaduta, scade oggi o entro 30 giorni); i casi non urgenti (>30 giorni)
// restano "emerald" e non urgenti.
export type CjScadenzaTone = "red" | "amber" | "emerald";
export interface CjScadenzaInfo {
  tone: CjScadenzaTone;
  label: string;
  urgent: boolean;
  days: number;
}
export function cjScadenzaInfo(
  daysToT6: number | null | undefined,
): CjScadenzaInfo | null {
  if (daysToT6 == null) return null;
  if (daysToT6 < 0) {
    const n = Math.abs(daysToT6);
    return {
      tone: "red",
      label: `Scaduta da ${n} ${n === 1 ? "giorno" : "giorni"}`,
      urgent: true,
      days: daysToT6,
    };
  }
  if (daysToT6 === 0) {
    return { tone: "amber", label: "Scade oggi", urgent: true, days: 0 };
  }
  if (daysToT6 <= 30) {
    return {
      tone: "amber",
      label: `Scade tra ${daysToT6} ${daysToT6 === 1 ? "giorno" : "giorni"}`,
      urgent: true,
      days: daysToT6,
    };
  }
  return {
    tone: "emerald",
    label: `Scade tra ${daysToT6} giorni`,
    urgent: false,
    days: daysToT6,
  };
}

// Vero se una journey va mostrata data la "Data di apertura journey" configurata:
// solo le journey aperte a partire da quella data (mezzanotte inclusa) passano,
// così le journey residue di mesi precedenti restano nascoste. Senza data
// configurata (o data non valida) non filtra nulla; una journey senza `openedAt`
// passa sempre (non abbiamo modo di escluderla).
export function cjOpenedFromTriggerDate(
  openedAt: string | Date | null | undefined,
  triggerDate: string | null | undefined,
): boolean {
  if (!triggerDate) return true;
  const floor = new Date(triggerDate).getTime();
  if (Number.isNaN(floor)) return true;
  if (openedAt == null) return true;
  const t = new Date(openedAt).getTime();
  return Number.isNaN(t) || t >= floor;
}

// Valore di ordinamento per il criterio "In scadenza" della lista schede.
// Priorità (valore più basso = più urgente) alle journey NON ancora chiuse
// (meno di `maxPiste` piste cross-sell) con meno giorni residui a T6. Le
// journey già sature, senza data o GIÀ scadute (non più chiudibili) finiscono
// in fondo (+Infinity), così la modalità ascendente mostra prima ciò su cui
// vale la pena lavorare.
export function cjScadenzaSortValue(opts: {
  openedAt: string | Date | null | undefined;
  pisteAttive: number;
  maxPiste: number;
  now?: Date;
}): number {
  if (opts.pisteAttive >= opts.maxPiste) return Number.POSITIVE_INFINITY;
  const days = cjDaysToT6(opts.openedAt, opts.now ?? new Date());
  if (days == null || days < 0) return Number.POSITIVE_INFINITY;
  return days;
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
