import { storage } from "./storage";
import { runBisuiteFetchForOrg } from "./bisuiteFetch";
import { sendTelegramMessage, sendTelegramDocument } from "./telegram";
import { decryptSecret, isEncrypted } from "./cryptoSecret";
import {
  addYmdDays,
  aggregateDailyReport,
  parsePerformanceWeights,
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
import { aggregateDtsReport, filterDtsLeads, type DtsReportAggregates } from "@shared/dtsReport";
import { fasciaFromTimeLabel, parseForecastConfig } from "@shared/venditeCommento";
import {
  DEFAULT_SEND_TIMES,
  fasciaForLabel,
  minutesOfLabel,
  parseSendTimes,
  type SendTimes,
} from "@shared/telegramSendTimes";

/**
 * Scheduler del report vendite giornaliero su Telegram (Task #239).
 * Due invii al giorno (default 13:30 e 22:15 ora italiana, configurabili
 * per organizzazione in telegramReport.send_times — Task #334), corretti
 * anche col cambio ora legale. Per ogni organizzazione con il bot
 * configurato e abilitato: sync BiSuite del giorno corrente e invio del
 * riepilogo nel gruppo. Errori loggati senza bloccare le altre org.
 */

const ROME_TZ = "Europe/Rome";

// Orari di invio di default (ora italiana), usati se un'org non ha
// send_times configurati e come fallback se la lettura config fallisce.
const SEND_TIMES: Array<{ label: string; minutes: number }> = [
  { label: DEFAULT_SEND_TIMES.parziale, minutes: minutesOfLabel(DEFAULT_SEND_TIMES.parziale) },
  { label: DEFAULT_SEND_TIMES.chiusura, minutes: minutesOfLabel(DEFAULT_SEND_TIMES.chiusura) },
];

// Config Telegram per-organizzazione salvata in organization_config.config.
export interface TelegramReportConfig {
  enabled?: boolean;
  bot_token?: string; // cifrato at-rest (enc:v1:...)
  chat_id?: string;
  // Orari di invio per-org (Task #334): { parziale, chiusura } "HH:MM".
  send_times?: Partial<SendTimes>;
  // Il forecast/obiettivi mensile vive ora in gara_config.config.venditeForecast
  // (per-mese), non più qui: questo blocco tiene solo il trasporto Telegram.
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
export function msUntilNextSend(
  now: Date = new Date(),
  sendTimes: Array<{ label: string; minutes: number }> = SEND_TIMES,
): { delayMs: number; label: string } {
  const times = sendTimes.length > 0 ? sendTimes : SEND_TIMES;
  const p = romeParts(now);
  const nowMs = now.getTime();
  const candidates: Array<{ epoch: number; label: string }> = [];
  for (const dayOffset of [0, 1]) {
    for (const t of times) {
      candidates.push({
        // Date.UTC normalizza l'overflow del giorno (es. 31+1 ⇒ 1 del mese dopo).
        epoch: romeWallTimeToEpoch(p.year, p.month, p.day + dayOffset, t.minutes),
        label: t.label,
      });
    }
  }
  // Con orari per-org diversi i candidati non sono più ordinati: si sceglie
  // il più vicino nel futuro.
  candidates.sort((a, b) => a.epoch - b.epoch);
  for (const c of candidates) {
    if (c.epoch > nowMs) {
      // +5s di margine per non arrivare un attimo prima dell'orario.
      return { delayMs: c.epoch - nowMs + 5_000, label: c.label };
    }
  }
  // Irraggiungibile (il primo orario di domani è sempre nel futuro), fallback difensivo.
  return { delayMs: 60_000, label: times[0].label };
}

/**
 * Slot recuperabile al boot (Task #332): se il processo riparte (es. restart
 * PM2 per memoria) poco dopo un orario di invio, la run interrotta va
 * recuperata. Ritorna lo slot più recente già scattato se:
 * - è passato da meno di `windowMinutes` (default 90);
 * - il suo giorno (ora italiana) è ancora il giorno corrente (mai
 *   recuperare il 22:30 di ieri dopo mezzanotte: il report è del giorno).
 * Altrimenti null (nessun recupero).
 */
export function recoverableSlot(
  now: Date = new Date(),
  windowMinutes = 90,
  sendTimes: Array<{ label: string; minutes: number }> = SEND_TIMES,
): { ymd: string; label: string } | null {
  const times = sendTimes.length > 0 ? sendTimes : SEND_TIMES;
  const p = romeParts(now);
  const nowMs = now.getTime();
  let best: { epoch: number; ymd: string; label: string } | null = null;
  for (const dayOffset of [-1, 0]) {
    for (const t of times) {
      const epoch = romeWallTimeToEpoch(p.year, p.month, p.day + dayOffset, t.minutes);
      if (epoch <= nowMs && (!best || epoch > best.epoch)) {
        const slotYmd = romeParts(new Date(epoch)).ymd;
        best = { epoch, ymd: slotYmd, label: t.label };
      }
    }
  }
  if (!best) return null;
  if (nowMs - best.epoch > windowMinutes * 60_000) return null;
  if (best.ymd !== p.ymd) return null;
  return { ymd: best.ymd, label: best.label };
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
  /** Fascia del commento; se assente si deduce dal timeLabel. */
  fascia?: "parziale" | "chiusura";
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
  let rows = await storage.getBisuiteSalesByItalianDateRange(params.orgId, fromYmd, ymd, false);
  let trendRows = rows.filter((r) => {
    const d = trendYmdOf(r.dataVendita);
    return d !== null && d >= trendFromYmd;
  });
  const monthRows = rows.filter((r) => {
    const d = trendYmdOf(r.dataVendita);
    return d !== null && d >= monthFromYmd;
  });
  const todayRows = rows.filter((r) => trendYmdOf(r.dataVendita) === ymd);
  // Pesi del punteggio performance (Task #283): per-org/per-mese dalla
  // Configurazione gara (gara_config.config.performanceWeights), con fallback
  // ai default di sistema. Caricati insieme al forecast (stesso record).
  const gm = /^(\d{4})-(\d{2})-\d{2}$/.exec(ymd);
  let garaCfgObj: Record<string, unknown> | undefined;
  if (gm) {
    const garaCfg = await storage.getGaraConfig(params.orgId, +gm[2], +gm[1]);
    garaCfgObj = garaCfg?.config as Record<string, unknown> | undefined;
  }
  const weights = parsePerformanceWeights(garaCfgObj?.performanceWeights);
  const aggregates = aggregateDailyReport(todayRows, weights);
  const trend = buildDailyTrend(trendRows, trendFromYmd, ymd);
  const history = buildDailyHistory(trendRows, trendFromYmd, ymd);
  // Le righe sono già senza ANNULLATA (includeAnnullate=false in query).
  const month = {
    label: monthLabelOf(ymd),
    aggregates: aggregateDailyReport(monthRows, weights),
  };
  // Riduzione del picco di memoria (Task #332): gli array derivati non
  // servono più (gli aggregati sono già calcolati); azzeriamo i riferimenti
  // così il GC può liberare le righe non più raggiungibili mentre si
  // costruisce l'HTML. `monthRows` resta viva solo per la sezione DTS.
  rows = [];
  trendRows = [];
  // Commento "direttore vendite" (Task #266): forecast/obiettivi per-org e
  // PER MESE dalla Configurazione gara (gara_config.config.venditeForecast),
  // dallo stesso record già caricato per i pesi (Task #283)
  // + fascia dedotta dall'orario (13:30 parziale / 22:30 chiusura).
  const forecast = parseForecastConfig(garaCfgObj?.venditeForecast);
  // Proiezione a fine mese: un KPI per riga (volumi per pista + Telefoni + Accessori/Servizi)
  // stimati sui giorni lavorativi trascorsi, dagli aggregati del mese. I giorni
  // lavorativi tengono conto della divisione CC/strada (conteggi negozi dal
  // forecast); senza conteggi ⇒ soli giorni feriali (lun–sab).
  const monthProjection = buildMonthEndProjection(ymd, month.aggregates, forecast) ?? undefined;
  const message = buildTelegramReportMessage({
    orgName: params.orgName,
    dateYMD: ymd,
    timeLabel: params.timeLabel,
    aggregates,
    monthAggregates: month.aggregates,
    forecast,
    fascia: params.fascia ?? fasciaFromTimeLabel(params.timeLabel),
  });
  const result = await sendTelegramMessage(params.botToken, params.chatId, message);
  if (!result.ok) {
    return { ok: false, error: result.error };
  }

  // Allegato HTML (Task #248): replica leggibile della pagina Vendite
  // BiSuite. Un fallimento dell'allegato NON blocca il report: il testo è
  // già arrivato, logghiamo e segnaliamo docError al chiamante.
  // Sezione DTS (Task #321): incidenza dei lead drive-to-store sulle
  // vendite del mese. Solo se l'org ha lead caricati; qualsiasi errore
  // non blocca il report (la sezione semplicemente non compare).
  let dts: DtsReportAggregates | undefined;
  try {
    const dtsLeadRows = await storage.getDtsLeads(params.orgId);
    if (dtsLeadRows.length > 0) {
      const monthKey = ymd.slice(0, 7);
      const leads = filterDtsLeads(
        dtsLeadRows.map((l) => ({
          leadKey: l.leadKey,
          consulente: l.consulente,
          campagna: l.campagna,
          nominativo: l.nominativo,
          email: l.email,
          codiceFiscale: l.codiceFiscale,
          telefono: l.telefono,
          inCarico: l.inCarico,
          stato: l.stato,
          data: l.data,
          idVendita: l.idVendita,
          addettoVendita: l.addettoVendita,
          origineLead: l.origineLead,
        })),
        { month: monthKey },
      );
      const agg = aggregateDtsReport(
        leads,
        monthRows.map((r) => ({
          bisuiteId: r.bisuiteId,
          stato: r.stato,
          codicePos: r.codicePos,
          nomeNegozio: r.nomeNegozio,
          rawData: r.rawData,
        })),
      );
      if (agg.totaleLead > 0 || agg.vendite.dts > 0) dts = agg;
    }
  } catch (e) {
    console.error(`[telegram-report] sezione DTS fallita per org ${params.orgId}:`, e);
  }

  const html = buildVenditeReportHtml({
    orgName: params.orgName,
    dateYMD: ymd,
    timeLabel: params.timeLabel,
    aggregates,
    trend,
    history,
    month,
    monthProjection,
    dts,
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

async function runScheduledSend(timeLabel: string, opts?: { recovery?: boolean }): Promise<void> {
  const orgs = await storage.getOrganizations();
  const { ymd } = romeNowParts();
  // Dedup (Task #332/#334): salta le org che hanno GIÀ ricevuto il report
  // della stessa FASCIA logica (parziale/chiusura) oggi. Confronto per
  // fascia e non per label: se un'org cambia orario a metà giornata, il
  // label registrato (es. "13:30") non coincide più con lo slot nuovo
  // (es. "12:00") ma la fascia sì — così niente doppioni né invii soppressi.
  let sentLabelsByOrg = new Map<string, string[]>();
  try {
    sentLabelsByOrg = await storage.getTelegramReportSendLabels(ymd);
  } catch (err) {
    console.warn(`[telegram-report] lettura invii registrati fallita, procedo senza dedup: ${err}`);
  }
  let sent = 0;
  let failed = 0;
  let skipped = 0;
  let deduped = 0;
  for (const org of orgs) {
    try {
      const orgConfig = await storage.getOrgConfig(org.id);
      const cfg = orgConfig?.config as Record<string, unknown> | undefined;
      const tg = resolveTelegramConfig(cfg?.telegramReport);
      if (!tg) {
        skipped++;
        continue;
      }
      // Orari per-org (Task #334): questa run riguarda solo le org il cui
      // orario configurato coincide con lo slot scattato.
      const times = parseSendTimes(
        (cfg?.telegramReport as TelegramReportConfig | undefined)?.send_times,
      );
      if (timeLabel !== times.parziale && timeLabel !== times.chiusura) {
        skipped++;
        continue;
      }
      const fascia = fasciaForLabel(timeLabel, times);
      const sentLabels = sentLabelsByOrg.get(org.id) ?? [];
      if (sentLabels.some((l) => fasciaForLabel(l, times) === fascia)) {
        deduped++;
        continue;
      }
      const r = await sendDailyReportForOrg({
        orgId: org.id,
        orgName: org.name,
        botToken: tg.botToken,
        chatId: tg.chatId,
        timeLabel,
        fascia,
        syncFirst: true,
      });
      if (r.ok) {
        sent++;
        console.log(`[telegram-report] inviato report ${timeLabel} org=${org.id} (${org.name})`);
        // Registra l'invio per il dedup/recovery (Task #332). Un errore di
        // scrittura non deve far ripartire l'org (il messaggio è già arrivato).
        try {
          await storage.recordTelegramReportSend(org.id, ymd, timeLabel);
        } catch (err) {
          console.warn(`[telegram-report] registrazione invio fallita org=${org.id}: ${err}`);
        }
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
    `[telegram-report] run ${timeLabel}${opts?.recovery ? " (RECOVERY)" : ""} completata — ` +
      `inviati: ${sent}, falliti: ${failed}, org senza bot: ${skipped}, già inviati: ${deduped}`,
  );
}

let started = false;
let currentTimer: ReturnType<typeof setTimeout> | null = null;
let scheduleGeneration = 0;
let scheduleNextFn: (() => Promise<void>) | null = null;

/**
 * Ri-arma il timer dello scheduler (Task #334): da chiamare dopo un
 * salvataggio della config Telegram, così un nuovo orario ancora futuro
 * di OGGI viene pianificato subito (senza aspettare il prossimo giro).
 * No-op se lo scheduler non è avviato (es. ambiente dev).
 */
export function rescheduleTelegramReports(): void {
  if (!started || !scheduleNextFn) return;
  if (currentTimer) clearTimeout(currentTimer);
  currentTimer = null;
  scheduleGeneration++;
  void scheduleNextFn();
}

/**
 * Unione degli orari di invio configurati da tutte le org (Task #334):
 * lo scheduler pianifica il prossimo timer sull'orario più vicino fra
 * quelli configurati; alla run ogni org riceve solo i propri slot.
 * Se la lettura config fallisce si ricade sui default.
 */
async function collectSendTimes(): Promise<Array<{ label: string; minutes: number }>> {
  try {
    const orgs = await storage.getOrganizations();
    const labels = new Set<string>();
    for (const org of orgs) {
      const orgConfig = await storage.getOrgConfig(org.id);
      const cfg = orgConfig?.config as Record<string, unknown> | undefined;
      const tg = cfg?.telegramReport as TelegramReportConfig | undefined;
      if (!tg?.enabled) continue;
      const times = parseSendTimes(tg.send_times);
      labels.add(times.parziale);
      labels.add(times.chiusura);
    }
    if (labels.size === 0) return SEND_TIMES;
    return Array.from(labels)
      .map((label) => ({ label, minutes: minutesOfLabel(label) }))
      .sort((a, b) => a.minutes - b.minutes);
  } catch (err) {
    console.warn(`[telegram-report] lettura orari configurati fallita, uso i default: ${err}`);
    return SEND_TIMES;
  }
}

/**
 * Avvia lo scheduler dei report Telegram. Idempotente: chiamandolo più
 * volte parte una sola volta. Come lo scheduler BiSuite usa setTimeout
 * ricalcolato dopo ogni run sul fuso Europe/Rome, così gli orari restano
 * corretti anche con il cambio ora legale.
 */
export function startTelegramReportScheduler(): void {
  if (started) return;
  started = true;

  // Recovery al boot (Task #332): se il processo è appena ripartito (es.
  // restart PM2 per --max-memory-restart) dentro la finestra di uno slot
  // già scattato, recupera la run interrotta per le sole org rimaste senza
  // report (dedup via telegram_report_sends). Async, non blocca l'avvio.
  // Gli slot considerati sono quelli configurati (Task #334).
  void collectSendTimes().then((times) => {
    const rec = recoverableSlot(new Date(), 90, times);
    if (rec) {
      console.log(
        `[telegram-report] recovery: slot ${rec.label} del ${rec.ymd} dentro la finestra, ` +
          `verifico le org senza report (Roma: ${formatRomeNow()})`,
      );
      void runScheduledSend(rec.label, { recovery: true }).catch((err) => {
        console.error(`[telegram-report] recovery ${rec.label} fallita: ${err}`);
      });
    }
  });

  const scheduleNext = async () => {
    // Orari riletti a ogni giro; inoltre rescheduleTelegramReports() ri-arma
    // subito il timer al salvataggio della config (la generazione invalida
    // un giro ormai superato, evitando doppi timer).
    const gen = ++scheduleGeneration;
    const times = await collectSendTimes();
    if (gen !== scheduleGeneration) return; // superato da un reschedule
    const { delayMs, label } = msUntilNextSend(new Date(), times);
    const nextRun = new Date(Date.now() + delayMs);
    console.log(
      `[telegram-report] prossimo report ${label} programmato per ` +
        `${nextRun.toISOString()} (tra ~${Math.round(delayMs / 60000)} min, ora attuale Roma: ${formatRomeNow()})`,
    );
    currentTimer = setTimeout(async () => {
      try {
        console.log(`[telegram-report] avvio run ${label} (Roma: ${formatRomeNow()})`);
        await runScheduledSend(label);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[telegram-report] errore fatale durante la run ${label}: ${msg}`);
      } finally {
        void scheduleNext();
      }
    }, delayMs);
    currentTimer.unref?.();
  };

  scheduleNextFn = scheduleNext;
  void scheduleNext();
}
