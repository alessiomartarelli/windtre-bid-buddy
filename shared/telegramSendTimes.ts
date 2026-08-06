/**
 * Orari di invio del report Telegram (Task #239/#334): logica pura,
 * condivisa fra scheduler, route admin e form React. Due slot al giorno,
 * "parziale" (metà giornata) e "chiusura" (sera), configurabili per
 * organizzazione in organization_config.config.telegramReport.send_times;
 * senza configurazione valgono i default (13:30 / 22:15 ora italiana).
 */

export interface SendTimes {
  /** Orario del report parziale, formato "HH:MM" (ora italiana). */
  parziale: string;
  /** Orario del report di chiusura, formato "HH:MM" (ora italiana). */
  chiusura: string;
}

export const DEFAULT_SEND_TIMES: SendTimes = { parziale: "13:30", chiusura: "22:15" };

/**
 * Normalizza un orario "H:MM"/"HH:MM" in "HH:MM". Ritorna null se non è
 * un orario valido (00:00–23:59) o se cade nella finestra di transizione
 * del cambio ora legale (02:00–02:59, ora italiana): quell'ora può non
 * esistere o esistere due volte, quindi non è ammessa come orario di invio.
 */
export function normalizeTimeLabel(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(raw.trim());
  if (!m) return null;
  const h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  if (h === 2) return null; // finestra DST 02:00–02:59
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

/** Minuti dalla mezzanotte di un label "HH:MM" già normalizzato. */
export function minutesOfLabel(label: string): number {
  const [h, m] = label.split(":").map((x) => parseInt(x, 10));
  return h * 60 + m;
}

/**
 * Interpreta il blocco `send_times` salvato in config. Accetta la forma
 * oggetto { parziale, chiusura }; ogni campo non valido ricade sul default.
 * Se dopo la normalizzazione i due orari coincidono si torna ai default
 * (due invii allo stesso orario non hanno senso e romperebbero il dedup).
 */
export function parseSendTimes(raw: unknown): SendTimes {
  const obj = (raw ?? undefined) as Partial<Record<keyof SendTimes, unknown>> | undefined;
  const parziale = normalizeTimeLabel(obj?.parziale) ?? DEFAULT_SEND_TIMES.parziale;
  const chiusura = normalizeTimeLabel(obj?.chiusura) ?? DEFAULT_SEND_TIMES.chiusura;
  if (parziale === chiusura) return { ...DEFAULT_SEND_TIMES };
  return { parziale, chiusura };
}

/**
 * Fascia del commento per uno slot: "chiusura" se il label coincide con
 * l'orario di chiusura configurato (o, in fallback, se è dalle 18 in poi),
 * altrimenti "parziale".
 */
export function fasciaForLabel(label: string, times: SendTimes): "parziale" | "chiusura" {
  const norm = normalizeTimeLabel(label);
  if (norm === null) return "parziale";
  if (norm === times.chiusura) return "chiusura";
  if (norm === times.parziale) return "parziale";
  return minutesOfLabel(norm) >= 18 * 60 ? "chiusura" : "parziale";
}
