import { storage } from "./storage";
import { runBisuiteFetchForOrg } from "./bisuiteFetch";
import { sendTelegramMessage, sendTelegramDocument } from "./telegram";
import { decryptSecret, isEncrypted } from "./cryptoSecret";
import {
  addYmdDays,
  aggregateDailyReport,
  buildDailyHistory,
  buildDailyTrend,
  buildMonthEndProjection,
  buildTelegramReportMessage,
  fmtReportDate,
  monthLabelOf,
  monthStartYmd,
  trendYmdOf,
} from "@shared/venditeReport";
import { buildVenditeReportHtml, reportHtmlFileName } from "@shared/venditeReportHtml";
import { fasciaFromTimeLabel, parseForecastConfig } from "@shared/venditeCommento";

/**
 * Scheduler del report vendite giornaliero su Telegram (Task #239).
 * Due invii al giorno alle 13:30 e alle 22:30 ora italiana (Europe/Rome,
 * corretto anche col cambio ora legale). Per ogni organizzazione con il
 * bot configurato e abilitato: sync BiSuite del giorno corrente e invio
 * del riepilogo nel gruppo. Errori loggati senza bloccare le altre org.
 */

const ROME_TZ = "Europe/Rome";

// Orari di invio (ora italiana), in minuti dalla mezzanotte.
const SEND_TIMES: Array<{ label: string; minutes: number }> = [
  { label: "13:30", minutes: 13 * 60 + 30 },
  { label: "22:30", minutes: 22 * 60 + 30 },
];

// Config Telegram per-organizzazione salvata in organization_config.config.
export interface TelegramReportConfig {
  enabled?: boolean;
  bot_token?: string; // cifrato at-rest (enc:v1:...)
  chat_id?: string;
  // Forecast/obiettivi mensili per il commento "da direttore vendite"
  // (Task #266). Numeri in chiaro (non segreti).
  forecast_canvass_pezzi?: number;
  forecast_telefoni_pezzi?: number;
  forecast_accessori_euro?: number;
  forecast_servizi_euro?: number;
  numero_negozi?: number;
  giorni_lavorativi?: number;
}

function romeParts(now: Date = new Date()): {
  ymd: string;
  year: number;
  month: number;
  day: number;
  secondsOfDay: number;
} {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: ROME_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "0";
  // en-CA con hour12:false può restituire "24" per mezzanotte: normalizziamo.
  const h = parseInt(get("hour"), 10) % 24;
  const m = parseInt(get("minute"), 10);
  const s = parseInt(get("second"), 10);
  return {
    ymd: `${get("year")}-${get("month")}-${get("day")}`,
    year: parseInt(get("year"), 10),
    month: parseInt(get("month"), 10),
    day: parseInt(get("day"), 10),
    secondsOfDay: h * 3600 + m * 60 + s,
  };
}

function romeNowParts(now: Date = new Date()): { ymd: string; secondsOfDay: number } {
  const { ymd, secondsOfDay } = romeParts(now);
  return { ymd, secondsOfDay };
}

// Offset UTC di Roma (in ms) all'istante dato: differenza fra il wall time
// di Roma reinterpretato come UTC e l'epoch reale.
function romeOffsetMs(at: Date): number {
  const p = romeParts(at);
  const h = Math.floor(p.secondsOfDay / 3600);
  const m = Math.floor((p.secondsOfDay % 3600) / 60);
  const s = p.secondsOfDay % 60;
  const asUTC = Date.UTC(p.year, p.month - 1, p.day, h, m, s);
  // Tronchiamo i ms dell'istante reale per confrontare a parità di secondi.
  const truncated = Math.floor(at.getTime() / 1000) * 1000;
  return asUTC - truncated;
}

/**
 * Converte un wall time di Roma (anno/mese/giorno/minuti dalla mezzanotte)
 * nell'epoch UTC reale, tenendo conto dell'offset vigente QUEL giorno
 * (CET +1 o CEST +2). Doppio passaggio per convergere a cavallo del cambio
 * ora; 13:30/22:30 non cadono mai nella finestra di transizione (02:00-03:00),
 * quindi il risultato è sempre univoco.
 */
function romeWallTimeToEpoch(year: number, month: number, day: number, minutes: number): number {
  const wallUTC = Date.UTC(year, month - 1, day, Math.floor(minutes / 60), minutes % 60, 0);
  let epoch = wallUTC - romeOffsetMs(new Date(wallUTC));
  epoch = wallUTC - romeOffsetMs(new Date(epoch));
  return epoch;
}

/**
 * Calcola il prossimo orario di invio: ms di attesa + label dell'orario.
 * Se entrambi gli orari di oggi sono già passati, punta al primo di domani.
 * DST-safe: ogni candidato (oggi 13:30, oggi 22:30, domani 13:30) è
 * convertito in epoch assoluto col SUO offset Europe/Rome, così l'attesa
 * resta corretta anche quando attraversa il cambio ora legale (giorni da
 * 23h/25h), senza assumere giornate da 24h fisse.
 */
export function msUntilNextSend(now: Date = new Date()): { delayMs: number; label: string } {
  const p = romeParts(now);
  const nowMs = now.getTime();
  const candidates: Array<{ epoch: number; label: string }> = [];
  for (const dayOffset of [0, 1]) {
    for (const t of SEND_TIMES) {
      candidates.push({
        // Date.UTC normalizza l'overflow del giorno (es. 31+1 ⇒ 1 del mese dopo).
        epoch: romeWallTimeToEpoch(p.year, p.month, p.day + dayOffset, t.minutes),
        label: t.label,
      });
    }
  }
  for (const c of candidates) {
    if (c.epoch > nowMs) {
      // +5s di margine per non arrivare un attimo prima dell'orario.
      return { delayMs: c.epoch - nowMs + 5_000, label: c.label };
    }
  }
  // Irraggiungibile (domani 13:30 è sempre nel futuro), fallback difensivo.
  return { delayMs: 60_000, label: SEND_TIMES[0].label };
}

function formatRomeNow(): string {
  return new Intl.DateTimeFormat("it-IT", {
    timeZone: ROME_TZ,
    dateStyle: "short",
    timeStyle: "medium",
  }).format(new Date());
}

/**
 * Risolve la config Telegram di un'org: token decifrato + chat id.
 * Ritorna null se assente, disabilitata o non decifrabile.
 */
export function resolveTelegramConfig(
  raw: unknown,
): { botToken: string; chatId: string } | null {
  const cfg = raw as TelegramReportConfig | undefined | null;
  if (!cfg || !cfg.enabled) return null;
  const chatId = (cfg.chat_id ?? "").trim();
  const stored = cfg.bot_token ?? "";
  if (!chatId || !stored) return null;
  let botToken: string;
  if (isEncrypted(stored)) {
    const dec = decryptSecret(stored);
    if (dec === null) return null;
    botToken = dec;
  } else {
    botToken = stored;
  }
  return botToken ? { botToken, chatId } : null;
}

/**
 * Costruisce e invia il report del giorno corrente per una singola org.
 * `syncFirst` esegue prima una sync BiSuite del giorno (se le credenziali
 * sono configurate); un errore di sync NON blocca l'invio: il report parte
 * comunque con i dati già presenti nel DB.
 */
export async function sendDailyReportForOrg(params: {
  orgId: string;
  orgName: string;
  botToken: string;
  chatId: string;
  timeLabel?: string;
  syncFirst?: boolean;
}): Promise<{ ok: boolean; error?: string; docError?: string }> {
  const { ymd } = romeNowParts();

  if (params.syncFirst !== false) {
    try {
      const orgConfig = await storage.getOrgConfig(params.orgId);
      const cfg = orgConfig?.config as Record<string, unknown> | undefined;
      const creds = cfg?.bisuiteCredentials as
        | { client_id?: string; client_secret?: string }
        | undefined;
      if (creds?.client_id && creds?.client_secret) {
        await runBisuiteFetchForOrg(params.orgId, { startDate: ymd, endDate: ymd });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(
        `[telegram-report] sync giorno corrente fallita org=${params.orgId} (${params.orgName}), ` +
          `invio comunque il report con i dati presenti: ${msg}`,
      );
    }
  }

  // Finestra dati per l'allegato HTML navigabile: 14 giorni di trend +
  // storico per-giorno (frecce ‹ ›) + totale del mese in corso (pagina
  // "Totale mese"). Un'unica query dal più lontano fra inizio mese e
  // inizio finestra trend. Il messaggio di testo usa SOLO le vendite di
  // oggi.
  const TREND_DAYS = 14;
  const trendFromYmd = addYmdDays(ymd, -(TREND_DAYS - 1));
  const monthFromYmd = monthStartYmd(ymd);
  const fromYmd = trendFromYmd < monthFromYmd ? trendFromYmd : monthFromYmd;
  const rows = await storage.getBisuiteSalesByItalianDateRange(params.orgId, fromYmd, ymd, false);
  const trendRows = rows.filter((r) => {
    const d = trendYmdOf(r.dataVendita);
    return d !== null && d >= trendFromYmd;
  });
  const monthRows = rows.filter((r) => {
    const d = trendYmdOf(r.dataVendita);
    return d !== null && d >= monthFromYmd;
  });
  const todayRows = rows.filter((r) => trendYmdOf(r.dataVendita) === ymd);
  const aggregates = aggregateDailyReport(todayRows);
  const trend = buildDailyTrend(trendRows, trendFromYmd, ymd);
  const history = buildDailyHistory(trendRows, trendFromYmd, ymd);
  // Le righe sono già senza ANNULLATA (includeAnnullate=false in query).
  const month = {
    label: monthLabelOf(ymd),
    aggregates: aggregateDailyReport(monthRows),
  };
  // Proiezione a fine mese (Task #263): pezzi Canvass totali e Telefoni
  // stimati sui giorni lavorativi trascorsi, dagli aggregati del mese.
  const monthProjection = buildMonthEndProjection(ymd, month.aggregates) ?? undefined;
  // Commento "direttore vendite" (Task #266): forecast per-org dalla config
  // + fascia dedotta dall'orario (13:30 parziale / 22:30 chiusura).
  const orgConfig = await storage.getOrgConfig(params.orgId);
  const cfg = orgConfig?.config as Record<string, unknown> | undefined;
  const tg = cfg?.telegramReport as Record<string, unknown> | undefined;
  const forecast = parseForecastConfig(tg?.forecast);
  const message = buildTelegramReportMessage({
    orgName: params.orgName,
    dateYMD: ymd,
    timeLabel: params.timeLabel,
    aggregates,
    monthAggregates: month.aggregates,
    forecast,
    fascia: fasciaFromTimeLabel(params.timeLabel),
  });
  const result = await sendTelegramMessage(params.botToken, params.chatId, message);
  if (!result.ok) {
    return { ok: false, error: result.error };
  }

  // Allegato HTML (Task #248): replica leggibile della pagina Vendite
  // BiSuite. Un fallimento dell'allegato NON blocca il report: il testo è
  // già arrivato, logghiamo e segnaliamo docError al chiamante.
  const html = buildVenditeReportHtml({
    orgName: params.orgName,
    dateYMD: ymd,
    timeLabel: params.timeLabel,
    aggregates,
    trend,
    history,
    month,
    monthProjection,
  });
  const fileName = reportHtmlFileName(params.orgName, ymd, params.timeLabel);
  const docResult = await sendTelegramDocument(params.botToken, params.chatId, fileName, html, {
    caption: `Report vendite ${fmtReportDate(ymd)} — versione leggibile`,
  });
  if (!docResult.ok) {
    console.warn(
      `[telegram-report] allegato HTML FALLITO org=${params.orgId} (${params.orgName}): ${docResult.error} — il messaggio di testo è stato comunque inviato`,
    );
    return { ok: true, docError: docResult.error };
  }
  return { ok: true };
}

async function runScheduledSend(timeLabel: string): Promise<void> {
  const orgs = await storage.getOrganizations();
  let sent = 0;
  let failed = 0;
  let skipped = 0;
  for (const org of orgs) {
    try {
      const orgConfig = await storage.getOrgConfig(org.id);
      const cfg = orgConfig?.config as Record<string, unknown> | undefined;
      const tg = resolveTelegramConfig(cfg?.telegramReport);
      if (!tg) {
        skipped++;
        continue;
      }
      const r = await sendDailyReportForOrg({
        orgId: org.id,
        orgName: org.name,
        botToken: tg.botToken,
        chatId: tg.chatId,
        timeLabel,
        syncFirst: true,
      });
      if (r.ok) {
        sent++;
        console.log(`[telegram-report] inviato report ${timeLabel} org=${org.id} (${org.name})`);
      } else {
        failed++;
        console.error(
          `[telegram-report] invio FALLITO ${timeLabel} org=${org.id} (${org.name}): ${r.error}`,
        );
      }
    } catch (err) {
      failed++;
      const msg = err instanceof Error ? err.message : String(err);
      console.error(
        `[telegram-report] errore report ${timeLabel} org=${org.id} (${org.name}): ${msg}`,
      );
    }
  }
  console.log(
    `[telegram-report] run ${timeLabel} completata — inviati: ${sent}, falliti: ${failed}, ` +
      `org senza bot: ${skipped}`,
  );
}

let started = false;

/**
 * Avvia lo scheduler dei report Telegram. Idempotente: chiamandolo più
 * volte parte una sola volta. Come lo scheduler BiSuite usa setTimeout
 * ricalcolato dopo ogni run sul fuso Europe/Rome, così gli orari restano
 * corretti anche con il cambio ora legale.
 */
export function startTelegramReportScheduler(): void {
  if (started) return;
  started = true;

  const scheduleNext = () => {
    const { delayMs, label } = msUntilNextSend();
    const nextRun = new Date(Date.now() + delayMs);
    console.log(
      `[telegram-report] prossimo report ${label} programmato per ` +
        `${nextRun.toISOString()} (tra ~${Math.round(delayMs / 60000)} min, ora attuale Roma: ${formatRomeNow()})`,
    );
    setTimeout(async () => {
      try {
        console.log(`[telegram-report] avvio run ${label} (Roma: ${formatRomeNow()})`);
        await runScheduledSend(label);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[telegram-report] errore fatale durante la run ${label}: ${msg}`);
      } finally {
        scheduleNext();
      }
    }, delayMs).unref?.();
  };

  scheduleNext();
}
