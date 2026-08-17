// Task #405: controllo periodico di drift tra shared/schema.ts (versione
// deployata) e le colonne reali del DB di produzione. Il deploy verifica
// già lo schema (scripts/verify-prod-schema.ts), ma il drift può nascere
// anche TRA un deploy e l'altro (interventi manuali sul DB, restore da
// backup). Questo scheduler ripete lo stesso confronto:
//   - poco dopo il boot (così un restore notturno viene visto subito),
//   - poi una volta al giorno alle 07:00 ora di Roma.
// In caso di drift invia una notifica Telegram con l'elenco di tabelle e
// colonne mancanti, usando il bot di sistema (env TELEGRAM_BOT_TOKEN +
// TELEGRAM_CHAT_ID in ecosystem.config.cjs) — NON i bot per-organizzazione
// dei report: il drift è un allarme di piattaforma, non un report cliente.
//
// Dedup: la stessa lista di problemi viene notificata al massimo una volta
// al giorno (per non spammare la chat ad ogni run finché il fix non viene
// applicato); se la lista cambia, notifica subito. Al rientro (problemi
// risolti) manda un messaggio di "rientrato OK" una sola volta.

import { pool } from "./db";
import { sendTelegramMessage } from "./telegram";
import {
  buildDbColumnMap,
  collectExpectedTables,
  compareSchema,
  DB_COLUMNS_QUERY,
  type DbColumnRow,
} from "@shared/schemaDrift";

const TAG = "[schema-drift]";
// Primo check poco dopo il boot: lascia respirare l'avvio (pm2 restart,
// warm-up asset) prima di aprire una query in più.
const BOOT_DELAY_MS = 60_000;
// Orario del check giornaliero (ora di Roma).
const DAILY_HOUR_ROME = 7;

function romeNow(now: Date = new Date()): { ymd: string; hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Rome",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return {
    ymd: `${get("year")}-${get("month")}-${get("day")}`,
    hour: Number(get("hour")) % 24,
    minute: Number(get("minute")),
  };
}

/** Millisecondi fino alle prossime DAILY_HOUR_ROME:00 ora di Roma. */
export function msUntilNextDailyCheck(now: Date = new Date()): number {
  const { hour, minute } = romeNow(now);
  const minutesNow = hour * 60 + minute;
  const target = DAILY_HOUR_ROME * 60;
  let deltaMin = target - minutesNow;
  if (deltaMin <= 0) deltaMin += 24 * 60;
  // Precisione al minuto è più che sufficiente per un check giornaliero.
  return deltaMin * 60_000;
}

export interface DriftCheckResult {
  problems: string[];
  tableCount: number;
}

/** Esegue il confronto codice -> DB usando il pool del server. */
export async function runSchemaDriftCheck(): Promise<DriftCheckResult> {
  const expected = collectExpectedTables();
  if (expected.length === 0) {
    // Non deve succedere: se succede è un bug del bundle, non drift.
    throw new Error("no pgTable exports found in shared/schema.ts");
  }
  const res = await pool.query<DbColumnRow>(DB_COLUMNS_QUERY);
  const problems = compareSchema(expected, buildDbColumnMap(res.rows));
  return { problems, tableCount: expected.length };
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Limite hard di Telegram per il testo di un messaggio. Il formato deve
// restare SOTTO questo limite da solo: sendTelegramMessage tronca in modo
// grezzo e potrebbe spezzare un tag <code> aperto, facendo rifiutare il
// messaggio a Telegram (parse_mode HTML).
const TELEGRAM_MAX_LENGTH = 4096;

export function formatDriftMessage(problems: string[]): string {
  const header =
    `🚨 <b>MyStoreDesk — DRIFT SCHEMA DB PRODUZIONE</b>\n` +
    `Il DB non ha ${problems.length === 1 ? "un oggetto atteso" : `${problems.length} oggetti attesi`} dal codice deployato:\n`;
  const footer =
    `\n\nAzione: eseguire <code>drizzle-kit push</code> contro il DB prod e ` +
    `riverificare con <code>scripts/verify-prod-schema.ts</code> (vedi procedura di deploy).`;
  // Riga di riserva per "… e altri N problemi": stimata sul caso peggiore.
  const omittedLineBudget = 40;
  const budget = TELEGRAM_MAX_LENGTH - header.length - footer.length - omittedLineBudget;

  const lines: string[] = [];
  let used = 0;
  let shown = 0;
  for (const p of problems) {
    const line = `• <code>${escapeHtml(p)}</code>`;
    if (used + line.length + 1 > budget) break;
    lines.push(line);
    used += line.length + 1; // +1 per il newline
    shown++;
  }
  if (shown < problems.length) {
    lines.push(`… e altri ${problems.length - shown} problemi (vedi log pm2)`);
  }
  return header + lines.join("\n") + footer;
}

// Stato di dedup in-process: fingerprint dell'ultima notifica + giorno Roma.
let lastNotifiedFingerprint: string | null = null;
let lastNotifiedYmd: string | null = null;
let warnedMissingEnv = false;

function telegramEnv(): { botToken: string; chatId: string } | null {
  const botToken = (process.env.TELEGRAM_BOT_TOKEN ?? "").trim();
  const chatId = (process.env.TELEGRAM_CHAT_ID ?? "").trim();
  if (!botToken || !chatId) return null;
  return { botToken, chatId };
}

/**
 * Invia la notifica; ritorna true SOLO se Telegram ha accettato il
 * messaggio. Env mancante o invio fallito => false, così il chiamante NON
 * aggiorna lo stato di dedup e riprova al check successivo.
 */
async function notify(text: string): Promise<boolean> {
  const env = telegramEnv();
  if (!env) {
    if (!warnedMissingEnv) {
      warnedMissingEnv = true;
      console.warn(
        `${TAG} TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID non configurati: il drift ` +
          `viene solo loggato, nessuna notifica Telegram.`,
      );
    }
    return false;
  }
  const result = await (testOverrides?.send ?? sendTelegramMessage)(
    env.botToken,
    env.chatId,
    text,
  );
  if (!result.ok) {
    console.error(`${TAG} invio notifica Telegram fallito: ${result.error}`);
    return false;
  }
  return true;
}

// Hook di test (mai attivo in produzione): permette ai test tsx di
// sostituire l'invio Telegram e il check DB senza rete/DB reali.
interface TestOverrides {
  send?: typeof sendTelegramMessage;
  runCheck?: () => Promise<DriftCheckResult>;
}
let testOverrides: TestOverrides | null = null;
export function __setTestOverrides(overrides: TestOverrides | null): void {
  if (process.env.NODE_ENV === "production") {
    throw new Error("test overrides not allowed in production");
  }
  testOverrides = overrides;
  lastNotifiedFingerprint = null;
  lastNotifiedYmd = null;
}

export async function checkAndNotify(label: string): Promise<void> {
  let result: DriftCheckResult;
  try {
    result = await (testOverrides?.runCheck ?? runSchemaDriftCheck)();
  } catch (err) {
    // Un errore del check (DB giù, bug) NON è drift: logga e basta, il
    // resto del server sta già fallendo rumorosamente se il DB è giù.
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`${TAG} check fallito (${label}): ${msg}`);
    return;
  }

  const { ymd } = romeNow();
  if (result.problems.length === 0) {
    console.log(
      `${TAG} OK (${label}): ${result.tableCount} tabelle, tutte le colonne attese presenti.`,
    );
    if (lastNotifiedFingerprint) {
      // Rientro dopo un drift notificato: avvisa una volta che è risolto.
      // Lo stato si azzera solo a invio riuscito, così un invio fallito
      // viene ritentato al check successivo.
      const sent = await notify(
        `✅ <b>MyStoreDesk</b> — drift schema DB produzione rientrato: lo schema è di nuovo allineato al codice.`,
      );
      if (sent) {
        lastNotifiedFingerprint = null;
        lastNotifiedYmd = null;
      }
    }
    return;
  }

  console.error(`${TAG} DRIFT RILEVATO (${label}):`);
  for (const p of result.problems) console.error(`${TAG}   - ${p}`);

  const fingerprint = result.problems.slice().sort().join("|");
  const alreadyNotifiedToday =
    fingerprint === lastNotifiedFingerprint && ymd === lastNotifiedYmd;
  if (alreadyNotifiedToday) {
    console.log(`${TAG} drift identico già notificato oggi, nessun nuovo messaggio.`);
    return;
  }
  const sent = await notify(formatDriftMessage(result.problems));
  if (sent) {
    // Dedup SOLO a invio riuscito: se Telegram fallisce, il prossimo check
    // (boot o giornaliero) ritenta la notifica invece di tacere.
    lastNotifiedFingerprint = fingerprint;
    lastNotifiedYmd = ymd;
  }
}

let started = false;

/**
 * Avvia il controllo periodico: un check ~1 minuto dopo il boot, poi ogni
 * giorno alle 07:00 ora di Roma. Idempotente. I timer sono unref() così
 * non tengono vivo il processo in shutdown.
 */
export function startSchemaDriftScheduler(): void {
  if (started) return;
  started = true;

  const bootTimer = setTimeout(() => {
    void checkAndNotify("boot");
  }, BOOT_DELAY_MS);
  bootTimer.unref();

  const scheduleNext = () => {
    const delay = msUntilNextDailyCheck();
    const nextRun = new Date(Date.now() + delay);
    console.log(
      `${TAG} prossimo check giornaliero programmato per ${nextRun.toISOString()} ` +
        `(tra ~${Math.round(delay / 60000)} min)`,
    );
    const timer = setTimeout(async () => {
      try {
        await checkAndNotify("giornaliero");
      } finally {
        scheduleNext();
      }
    }, delay);
    timer.unref();
  };
  scheduleNext();
}
