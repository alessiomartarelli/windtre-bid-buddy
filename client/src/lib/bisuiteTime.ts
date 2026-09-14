// I campi legacy di sync BiSuite sono `timestamp without time zone`: il
// driver PostgreSQL li serializza con `Z`, ma le cifre rappresentano già
// l'ora locale registrata. Formattarli in Europe/Rome aggiungerebbe quindi
// una seconda volta l'offset CET/CEST.
const BISUITE_WALL_TIME_ZONE = "UTC";
const ISO_INSTANT_SUFFIX = /(?:Z|[+-]\d{2}:?\d{2})$/i;

/**
 * Mantiene le cifre dell'ora registrata nei campi legacy BiSuite, evitando
 * una seconda conversione di fuso. Accetta solo il formato esplicito prodotto
 * dalle API, non timestamp ambigui senza suffisso.
 */
export function formatBisuiteSyncTime(iso: string | null | undefined): string | null {
  if (!iso || !ISO_INSTANT_SUFFIX.test(iso)) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("it-IT", {
    timeZone: BISUITE_WALL_TIME_ZONE,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}