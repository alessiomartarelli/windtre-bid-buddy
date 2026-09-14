const ROME_TIME_ZONE = "Europe/Rome";
const ISO_INSTANT_SUFFIX = /(?:Z|[+-]\d{2}:?\d{2})$/i;

/**
 * Converte l'istante ISO restituito dalle API nell'ora italiana, includendo
 * automaticamente il passaggio CET/CEST. Accetta solo timestamp con fuso
 * esplicito, evitando interpretazioni dipendenti dal browser.
 */
export function formatBisuiteSyncTime(iso: string | null | undefined): string | null {
  if (!iso || !ISO_INSTANT_SUFFIX.test(iso)) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("it-IT", {
    timeZone: ROME_TIME_ZONE,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}