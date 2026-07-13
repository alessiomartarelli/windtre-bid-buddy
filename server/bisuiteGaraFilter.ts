// Filtro "in gara" delle vendite BiSuite, estratto dalla route
// GET /api/admin/bisuite-mapped-sales così da essere richiamabile e testabile
// (DB-backed) senza passare dall'HTTP. Decide QUALI righe `bisuite_sales`
// (già filtrate per mese italiano dallo storage) vengono passate
// all'aggregatore: quando `inGaraOnly` è attivo e almeno un PDV ha un
// calendario configurato, tiene solo le vendite che cadono in un giorno di
// apertura del PDV (calendario italiano, fuso Europe/Rome, con override
// specialDays). Se non ci sono calendari, o il flag è spento, passa tutto.

export type CalendarShape = {
  weeklySchedule: { workingDays: number[] };
  specialDays?: { date: string; isOpen: boolean }[];
};

// Forma minima di una vendita per il filtro: data e PDV.
export type FilterableSale = {
  dataVendita?: Date | string | null;
  codicePos?: string | null;
};

// Forma minima della gara config usata per costruire i calendari per PDV.
// `config` è tipizzato `unknown` a monte (colonna JSONB), quindi lo accettiamo
// tale e ne estraiamo `pdvList` con un cast controllato.
export type GaraConfigForFilter = {
  config?: unknown;
} | null | undefined;

type ConfigPdvList = { pdvList?: Array<{ codicePos?: string; calendar?: CalendarShape }> };

// Costruisce la mappa codicePos -> calendario dai PDV della gara config.
// `calendarsAvailable` è true se almeno un PDV ha un calendario valido.
export function buildCalendarByPos(garaCfg: GaraConfigForFilter): {
  calendarByPos: Map<string, CalendarShape>;
  calendarsAvailable: boolean;
} {
  const calendarByPos = new Map<string, CalendarShape>();
  let calendarsAvailable = false;
  const pdvList = (garaCfg?.config as ConfigPdvList | null | undefined)?.pdvList || [];
  for (const p of pdvList) {
    if (p.codicePos && p.calendar?.weeklySchedule?.workingDays) {
      calendarByPos.set(p.codicePos, p.calendar);
      calendarsAvailable = true;
    }
  }
  return { calendarByPos, calendarsAvailable };
}

// Normalizza la data della vendita al fuso Europe/Rome per evitare
// disallineamenti rispetto al calendario italiano (DST e mezzanotte).
const romeDateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Rome',
  year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short',
});
const WEEKDAY_MAP: Record<string, number> = {
  Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
};

export function romeDateInfo(d: Date): { iso: string; weekday: number } {
  const parts = romeDateFormatter.formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value || '';
  const iso = `${get('year')}-${get('month')}-${get('day')}`;
  const weekday = WEEKDAY_MAP[get('weekday')] ?? d.getDay();
  return { iso, weekday };
}

// Una vendita è "in gara" se il suo PDV è aperto nel giorno della vendita
// (secondo il calendario italiano). Fallback: se la vendita non ha data, o il
// PDV non ha calendario, è considerata in gara.
export function isSaleInGara(
  sale: FilterableSale,
  calendarByPos: Map<string, CalendarShape>,
): boolean {
  if (!sale.dataVendita) return true;
  const cal = sale.codicePos ? calendarByPos.get(sale.codicePos) : undefined;
  if (!cal) return true; // Fallback: PDV senza calendario configurato
  const { iso, weekday } = romeDateInfo(new Date(sale.dataVendita));
  const special = cal.specialDays?.find((s) => s.date === iso);
  if (special) return special.isOpen;
  return cal.weeklySchedule.workingDays.includes(weekday);
}

// Seleziona le vendite da passare all'aggregatore, applicando il filtro in-gara
// solo quando `inGaraOnly` è attivo E ci sono calendari configurati. Restituisce
// anche i conteggi usati dalle card della dashboard.
export function selectInGaraSales<T extends FilterableSale>(
  allSales: T[],
  inGaraOnly: boolean,
  garaCfg: GaraConfigForFilter,
): {
  sales: T[];
  calendarsAvailable: boolean;
  totalSalesUnfiltered: number;
  salesExcludedOutOfGara: number;
} {
  const { calendarByPos, calendarsAvailable } = inGaraOnly
    ? buildCalendarByPos(garaCfg)
    : { calendarByPos: new Map<string, CalendarShape>(), calendarsAvailable: false };

  const sales = inGaraOnly && calendarsAvailable
    ? allSales.filter((s) => isSaleInGara(s, calendarByPos))
    : allSales;
  const totalSalesUnfiltered = allSales.length;
  const salesExcludedOutOfGara = inGaraOnly ? totalSalesUnfiltered - sales.length : 0;
  return { sales, calendarsAvailable, totalSalesUnfiltered, salesExcludedOutOfGara };
}
