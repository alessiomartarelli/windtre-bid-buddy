import { StoreCalendar, Weekday, WorkdayInfo } from "@/types/preventivatore";

const formatDateISO = (d: Date): string => d.toISOString().slice(0, 10);

export function isStoreOpenOnDate(
  date: Date,
  calendar: StoreCalendar
): boolean {
  const weekday = date.getDay() as Weekday;
  const baseOpen = calendar.weeklySchedule.workingDays.includes(weekday);

  const dateStr = formatDateISO(date);
  const special = calendar.specialDays?.find((s) => s.date === dateStr);
  if (special) return special.isOpen;

  return baseOpen;
}

export function getWorkdayInfoForMonth(
  year: number,
  month: number,
  calendar: StoreCalendar,
  today: Date = new Date()
): WorkdayInfo {
  const firstDay = new Date(year, month, 1);
  const nextMonth = new Date(year, month + 1, 1);
  const lastDay = new Date(nextMonth.getTime() - 1);

  let totalWorkingDays = 0;
  let elapsedWorkingDays = 0;

  for (
    let d = new Date(firstDay);
    d <= lastDay;
    d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)
  ) {
    if (!isStoreOpenOnDate(d, calendar)) continue;
    totalWorkingDays++;
    if (
      d.getFullYear() < today.getFullYear() ||
      (d.getFullYear() === today.getFullYear() &&
        (d.getMonth() < today.getMonth() ||
          (d.getMonth() === today.getMonth() && d.getDate() <= today.getDate())))
    ) {
      elapsedWorkingDays++;
    }
  }

  return {
    totalWorkingDays,
    elapsedWorkingDays,
    remainingWorkingDays: Math.max(totalWorkingDays - elapsedWorkingDays, 0),
  };
}

export function calcolaProiezionePezzi(
  pezziAttuali: number,
  workdayInfo: WorkdayInfo
): {
  pezziAttuali: number;
  pezziPrevistiFineMese: number;
  fattoreProiezione: number;
} {
  const { totalWorkingDays, elapsedWorkingDays } = workdayInfo;
  if (elapsedWorkingDays === 0 || totalWorkingDays === 0) {
    return {
      pezziAttuali,
      pezziPrevistiFineMese: pezziAttuali,
      fattoreProiezione: 1,
    };
  }
  const fattore = totalWorkingDays / elapsedWorkingDays;
  return {
    pezziAttuali,
    pezziPrevistiFineMese: pezziAttuali * fattore,
    fattoreProiezione: fattore,
  };
}

// Tipo per lo stato del giorno (importato da StepCalendarioMese)
export type DayStatus = "worked" | "remaining" | "closed";

export interface CalendarioMeseOverride {
  dayStatuses: Record<string, DayStatus>; // chiave = "YYYY-MM-DD"
}

/**
 * Calcola WorkdayInfo usando gli override del calendario mese.
 * Se non ci sono override, usa il calendario base.
 */
export function getWorkdayInfoFromOverrides(
  year: number,
  month: number, // 0-indexed
  calendar: StoreCalendar,
  override: CalendarioMeseOverride | undefined,
  today: Date = new Date()
): WorkdayInfo {
  // Se non ci sono override, usa il metodo standard
  if (!override || Object.keys(override.dayStatuses).length === 0) {
    return getWorkdayInfoForMonth(year, month, calendar, today);
  }

  const firstDay = new Date(year, month, 1);
  const lastDayOfMonth = new Date(year, month + 1, 0);
  const daysInMonth = lastDayOfMonth.getDate();

  let totalWorkingDays = 0;
  let elapsedWorkingDays = 0;

  for (let day = 1; day <= daysInMonth; day++) {
    const date = new Date(year, month, day);
    const dateKey = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    
    // Controlla se c'è un override per questo giorno
    const overrideStatus = override.dayStatuses[dateKey];
    
    let status: DayStatus;
    if (overrideStatus) {
      status = overrideStatus;
    } else {
      // Usa il calcolo di default
      const isOpen = isStoreOpenOnDate(date, calendar);
      if (!isOpen) {
        status = "closed";
      } else if (date <= today) {
        status = "worked";
      } else {
        status = "remaining";
      }
    }

    // Conteggia in base allo stato
    if (status === "worked") {
      totalWorkingDays++;
      elapsedWorkingDays++;
    } else if (status === "remaining") {
      totalWorkingDays++;
      // remaining non conta come elapsed
    }
    // "closed" non conta in nessuno dei due
  }

  return {
    totalWorkingDays,
    elapsedWorkingDays,
    remainingWorkingDays: Math.max(totalWorkingDays - elapsedWorkingDays, 0),
  };
}
