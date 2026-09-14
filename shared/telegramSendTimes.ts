/**
 * Orari di invio del report Telegram (Task #239/#334): logica pura,
 * condivisa fra scheduler, route admin e form React. Quattro slot al giorno,
 * tre "parziale" e una "chiusura", configurabili per
 * organizzazione in organization_config.config.telegramReport.send_times.
 * I nuovi config hanno tre slot "parziale" e uno di "chiusura"; i config
 * storici { parziale, chiusura } restano validi e continuano ad avere due
 * invii finché l'amministratore non li salva nella nuova forma.
 */

export interface SendTimes {
  /** Orari dei tre report parziali, formato "HH:MM" (ora italiana). */
  parziale1: string;
  parziale2: string;
  parziale3: string;
  /** Orario del report di chiusura, formato "HH:MM" (ora italiana). */
  chiusura: string;
}

/** Default della nuova configurazione (tre parziali + chiusura). */
export const DEFAULT_SEND_TIMES: SendTimes = {
  parziale1: "13:30",
  parziale2: "16:00",
  parziale3: "19:00",
  chiusura: "22:15",
};

/** Forma precedente, mantenuta in lettura senza migrazione del DB. */
export interface LegacySendTimes {
  parziale?: unknown;
  chiusura?: unknown;
}

export interface SendTimeSlot {
  key: "parziale1" | "parziale2" | "parziale3" | "chiusura";
  label: string;
  fascia: "parziale" | "chiusura";
  minutes: number;
}

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
 * oggetto { parziale1, parziale2, parziale3, chiusura }; ogni campo non
 * valido ricade sul default. La forma storica { parziale, chiusura } viene
 * letta come due soli slot, senza migrazione DB. Se dopo la normalizzazione
 * gli orari coincidono si torna ai default (due invii allo stesso orario non
 * hanno senso e romperebbero il dedup).
 */
export function parseSendTimes(raw: unknown): SendTimes | (Pick<SendTimes, "parziale1" | "chiusura"> & {
  parziale2: null;
  parziale3: null;
}) {
  const obj = (raw ?? undefined) as Record<string, unknown> | undefined;
  if (!obj || typeof obj !== "object") return { ...DEFAULT_SEND_TIMES };

  // Legacy configs deliberately remain two-slot configs. This avoids adding
  // two unsolicited reports to an organization that has not opted in to the
  // new four-slot setup. The admin form presents defaults for the two missing
  // fields and writes the new shape on save.
  const hasNewShape = ["parziale1", "parziale2", "parziale3"].some((key) =>
    Object.prototype.hasOwnProperty.call(obj, key),
  );
  if (!hasNewShape && (Object.prototype.hasOwnProperty.call(obj, "parziale") ||
    Object.prototype.hasOwnProperty.call(obj, "chiusura"))) {
    const parziale = normalizeTimeLabel(obj.parziale) ?? "13:30";
    const chiusura = normalizeTimeLabel(obj.chiusura) ?? "22:15";
    if (parziale === chiusura) {
      return { parziale1: DEFAULT_SEND_TIMES.parziale1, parziale2: null, parziale3: null, chiusura: DEFAULT_SEND_TIMES.chiusura };
    }
    return { parziale1: parziale, parziale2: null, parziale3: null, chiusura };
  }

  const labels = (["parziale1", "parziale2", "parziale3", "chiusura"] as const).map((key) =>
    normalizeTimeLabel(obj[key]) ?? DEFAULT_SEND_TIMES[key],
  );
  // A malformed/duplicate new config must never produce ambiguous slots.
  // Falling back to all defaults is deterministic and keeps scheduler,
  // recovery and admin GET consistent.
  if (new Set(labels).size !== labels.length) return { ...DEFAULT_SEND_TIMES };
  return {
    parziale1: labels[0],
    parziale2: labels[1],
    parziale3: labels[2],
    chiusura: labels[3],
  };
}

/** Ritorna gli slot attivi in ordine di configurazione (legacy: due slot). */
export function sendTimeSlots(times: SendTimes | {
  parziale1: string;
  parziale2: string | null;
  parziale3: string | null;
  chiusura: string;
}): SendTimeSlot[] {
  const keys = ["parziale1", "parziale2", "parziale3", "chiusura"] as const;
  return keys.flatMap((key) => {
    const label = times[key];
    if (typeof label !== "string") return [];
    return [{
      key,
      label,
      fascia: key === "chiusura" ? "chiusura" : "parziale",
      minutes: minutesOfLabel(label),
    }];
  });
}

/**
 * Fascia del commento per uno slot: "chiusura" se il label coincide con
 * l'orario di chiusura configurato (o, in fallback, se è dalle 18 in poi),
 * altrimenti "parziale".
 */
export function fasciaForLabel(label: string, times: SendTimes | {
  parziale1: string;
  parziale2: string | null;
  parziale3: string | null;
  chiusura: string;
} | { parziale?: string; chiusura: string }): "parziale" | "chiusura" {
  const norm = normalizeTimeLabel(label);
  if (norm === null) return "parziale";
  if (norm === times.chiusura) return "chiusura";
  if ("parziale1" in times &&
    (norm === times.parziale1 || norm === times.parziale2 || norm === times.parziale3)) return "parziale";
  if ("parziale" in times && norm === times.parziale) return "parziale";
  return minutesOfLabel(norm) >= 18 * 60 ? "chiusura" : "parziale";
}
