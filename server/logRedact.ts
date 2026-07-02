/**
 * Redazione dei campi sensibili nel log delle risposte API (Task #239).
 * Il logger in server/index.ts serializza il body JSON delle risposte
 * /api/*: senza redazione, endpoint che restituiscono segreti in chiaro
 * (bot token Telegram, client secret BiSuite, password SMTP) li
 * scriverebbero nei log runtime. Helper puro, testabile senza server.
 */

// Chiavi (case-insensitive, match anche su suffisso _key/-token ecc.)
// il cui valore stringa NON deve mai finire nei log.
const SENSITIVE_KEY_RE =
  /(pass(word)?|secret|token|api[-_]?key|authorization|cookie|credential)/i;

export function isSensitiveLogKey(key: string): boolean {
  return SENSITIVE_KEY_RE.test(key);
}

/**
 * Replacer per JSON.stringify: maschera i valori stringa di chiavi
 * sensibili e tronca i data URL immagine molto lunghi.
 */
export function logJsonReplacer(key: string, value: unknown): unknown {
  if (typeof value === "string") {
    if (key && isSensitiveLogKey(key) && value.length > 0) {
      return "[redacted]";
    }
    if (value.length > 200 && /^data:image\//i.test(value)) {
      return `[dataURL ${value.length} bytes redacted]`;
    }
  }
  return value;
}
