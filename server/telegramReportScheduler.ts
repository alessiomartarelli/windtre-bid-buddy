import { storage } from "./storage";
import { runBisuiteFetchForOrg } from "./bisuiteFetch";
import { cdgStorage } from "./cdgStorage";
import { sendTelegramMessage, sendTelegramDocument } from "./telegram";
import { decryptSecret, isEncrypted } from "./cryptoSecret";
import {
  addYmdDays,
  aggregateDailyReport,
  applyNettoIvaAccessoriServizi,
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
import type { VfPistaConf } from "@shared/vfPisteCalc";
import { aggregateDtsReport, dtsSaleCodiceEsterno, filterDtsLeads, type DtsReportAggregates } from "@shared/dtsReport";
import { fasciaFromTimeLabel, parseForecastConfig } from "@shared/venditeCommento";
import {
  applyBrandGating,
  applyBrandKindGating,
  buildTelegramBrandTargets,
  parseTelegramReportContent,
  parseTelegramReportContentForBrand,
  telegramBrandKindOf,
  unassignedPosCodes,
  type TelegramBrandTarget,
} from "@shared/telegramReportContent";
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
  const all = recoverableSlots(now, windowMinutes, sendTimes);
  return all.length > 0 ? all[all.length - 1] : null;
}

/**
 * TUTTI gli slot recuperabili adesso (Task #333): con orari per-org diversi
 * l'unione può contenere più slot dentro la finestra (es. org A ha spostato
 * il parziale a un orario appena passato mentre org B ne ha uno più recente
 * già inviato). Recuperare solo il più recente farebbe perdere lo slot di A:
 * qui si ritornano tutti quelli entro `windowMinutes` e ancora nel giorno
 * corrente (ora italiana), dal più vecchio al più recente. Il dedup per
 * fascia in runScheduledSend evita ogni doppione per le org già servite.
 */
export function recoverableSlots(
  now: Date = new Date(),
  windowMinutes = 90,
  sendTimes: Array<{ label: string; minutes: number }> = SEND_TIMES,
): Array<{ ymd: string; label: string }> {
  const times = sendTimes.length > 0 ? sendTimes : SEND_TIMES;
  const p = romeParts(now);
  const nowMs = now.getTime();
  const found: Array<{ epoch: number; ymd: string; label: string }> = [];
  for (const dayOffset of [-1, 0]) {
    for (const t of times) {
      const epoch = romeWallTimeToEpoch(p.year, p.month, p.day + dayOffset, t.minutes);
      if (epoch > nowMs) continue;
      if (nowMs - epoch > windowMinutes * 60_000) continue;
      const slotYmd = romeParts(new Date(epoch)).ymd;
      if (slotYmd !== p.ymd) continue; // mai recuperare slot di ieri
      found.push({ epoch, ymd: slotYmd, label: t.label });
    }
  }
  return found
    .sort((a, b) => a.epoch - b.epoch)
    .map(({ ymd, label }) => ({ ymd, label }));
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
  /**
   * Report separato per brand (Task #519): se presente, il report include
   * SOLO le vendite dei PDV associati al brand (match per codice POS) e i
   * contenuti sono gated sul brand del report (fail-closed: solo un brand
   * WindTre può mostrare Protetti/Verisure). Assente ⇒ report unico legacy.
   */
  brand?: TelegramBrandTarget | null;
}): Promise<{ ok: boolean; error?: string; docError?: string }> {
  const { ymd } = romeNowParts();
  const brand = params.brand ?? null;
  // Intestazione/filename con il brand, così i report separati della stessa
  // chat sono immediatamente distinguibili.
  const reportName = brand ? `${params.orgName} — ${brand.brandName}` : params.orgName;

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
  // Phone&Phone: BiSuite invia i negozi col solo nome (codice POS vuoto).
  // Nel report vanno mostrati tutti gli store e il Back Office, ma non i
  // banchetti temporanei. La regola è volutamente limitata a questa org.
  if (params.orgName.replace(/[^a-z0-9]/gi, "").toLowerCase() === "phonephone") {
    rows = rows.filter((r) => !/\bbanchett[oi]\b/i.test(String(r.nomeNegozio ?? "")));
  }
  // Report per brand: SOLO le vendite dei PDV associati al brand (match per
  // codice POS, case-insensitive). Il filtro avviene PRIMA di ogni derivato
  // (trend, storico, mese, DTS): nessun contenuto cross-brand può filtrare.
  if (brand) {
    rows = rows.filter((r) => brand.posCodes.has(String(r.codicePos ?? "").trim().toLowerCase()));
  }
  // Task #367: canonicalizza le Ragioni Sociali (alias + normalizzazione dal
  // registro RS) così il report aggrega le varianti come un'unica azienda.
  try {
    const resolveRs = await cdgStorage.getRsResolver(params.orgId);
    rows = rows.map((r) => {
      const canon = r.ragioneSociale ? resolveRs(r.ragioneSociale) : r.ragioneSociale;
      return canon !== r.ragioneSociale ? { ...r, ragioneSociale: canon } : r;
    });
  } catch (e) {
    console.warn(`[telegram-report] canonicalizzazione RS fallita org=${params.orgId}:`, e);
  }
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
  // Contenuti report (Task #515): piste visibili + gruppi TELCO/NEW CORE
  // dalla Configurazione gara (gara_config.config.telegramReportContent),
  // con gating brand: le org Vodafone/Fastweb non devono vedere alcun
  // riferimento a Protetti/Verisure, qualunque cosa dica il config.
  // Fail-closed: se la lettura brand fallisce trattiamo l'org come VF
  // (niente Protetti/Verisure) — meglio nascondere una sezione a un'org
  // WindTre per un errore transitorio che mostrarla per errore a Vodafone.
  let reportContent;
  // Task #527 — true quando il report è del modello Vodafone/Fastweb
  // (brand non-WindTre, o org legacy con brand VF): pilota la
  // classificazione col listino canvass qui sotto.
  let isVfReport: boolean;
  if (brand) {
    // Report per brand (Task #519): config mensile per-brand (fallback alla
    // config root legacy) + gating sul brand del report: solo un brand
    // WindTre può mostrare Protetti/Verisure (fail-closed per tutti gli altri).
    reportContent = applyBrandKindGating(
      parseTelegramReportContentForBrand(garaCfgObj?.telegramReportContent, brand.brandId),
      brand.kind,
    );
    // "other" è volutamente fail-closed per i contenuti Protetti, ma non
    // significa necessariamente Vodafone/Fastweb (può essere TIM o un brand
    // futuro). Classificazione, soglie e premi VF solo per nomi VF espliciti.
    isVfReport = /vodafone|fastweb/i.test(brand.brandName);
  } else {
    // Report legacy unico (nessun PDV brandizzato). Il modello VF completo
    // (rimozione assicurazioni + energia→luce/gas + classificazione canvass)
    // si applica SOLO se l'org è VF pura: in un'org mista WindTre+VF il
    // report combinato resta col modello WindTre invariato — si applica
    // soltanto il fail-closed Protetti (Task #515). In caso di errore di
    // lettura brand si assume org mista (protecta-only), mai il remap VF.
    let hasVf = true;
    let hasW3 = true;
    try {
      const orgBrands = await storage.getOrganizationBrands(params.orgId);
      hasVf = orgBrands.some((b) => /vodafone|fastweb/i.test(b.name));
      hasW3 = orgBrands.some((b) => /windtre|wind3|wind 3|w3/i.test(b.name));
    } catch (e) {
      console.warn(`[telegram-report] lettura brand org=${params.orgId} fallita (gating VF fail-closed):`, e);
    }
    const vfOnly = hasVf && !hasW3;
    reportContent = applyBrandGating(
      parseTelegramReportContent(garaCfgObj?.telegramReportContent),
      hasVf,
      { protectaOnly: hasVf && hasW3 },
    );
    isVfReport = vfOnly;
  }
  // Accessori e Servizi al netto dell'IVA (Task #335): applicato subito
  // dopo l'aggregazione così messaggio, HTML, proiezione e top-KPI sono
  // tutti coerenti (÷1.22 su fatturati ACCESSORI + tutti i Servizi).
  // Le piste NON visibili in telegramReportContent spariscono da tutti gli
  // aggregati del report (mix, per pista, drill-down, trend, storico, mese).
  const visiblePiste = reportContent.pisteVisibili;
  // Task #527 — report di un brand Vodafone/Fastweb: gli articoli vanno
  // classificati col listino canvass (+ regole KPI per-org) così le piste
  // fini (luce, gas, iva_mobile, iva_wireline, vas) hanno conteggi reali.
  // Best-effort: se il listino non si carica, il report resta come prima
  // (classificazione WindTre) invece di saltare l'invio.
  let canvassIndex: import("../shared/canvassMapping").CanvassIndex | null = null;
  let canvassKpiRules: import("../shared/canvassKpiRules").CanvassKpiRule[] | null = null;
  if (isVfReport) {
    try {
      const { CANVASS_CATALOG } = await import("../shared/canvassCatalog");
      const { buildCanvassIndex } = await import("../shared/canvassMapping");
      const { sanitizeCanvassKpiRules } = await import("../shared/canvassKpiRules");
      const sys = await storage.getSystemConfig("canvass_reference");
      const saved = sys?.config as { offers?: unknown[] } | null | undefined;
      const offers = (saved && Array.isArray(saved.offers) && saved.offers.length > 0)
        ? (saved.offers as typeof CANVASS_CATALOG.offers)
        : CANVASS_CATALOG.offers;
      canvassIndex = buildCanvassIndex(offers);
      const orgCfg = await storage.getOrgConfig(params.orgId);
      canvassKpiRules = sanitizeCanvassKpiRules(
        (orgCfg?.config as Record<string, unknown> | null)?.canvassKpiRules,
      );
    } catch (e) {
      console.warn(`[telegram-report] listino canvass non caricato org=${params.orgId} (classificazione legacy):`, e);
    }
  }
  const aggregates = applyNettoIvaAccessoriServizi(
    aggregateDailyReport(todayRows, weights, visiblePiste, canvassIndex, canvassKpiRules),
  );
  const trend = buildDailyTrend(trendRows, trendFromYmd, ymd, visiblePiste, canvassIndex, canvassKpiRules);
  // Anche le pagine storiche per-giorno dell'HTML vanno al netto IVA
  // (accessori/servizi), coerenti con oggi e Totale mese.
  const history = buildDailyHistory(trendRows, trendFromYmd, ymd, visiblePiste, canvassIndex, canvassKpiRules).map((h) => ({
    ...h,
    aggregates: applyNettoIvaAccessoriServizi(h.aggregates),
  }));
  // Le righe sono già senza ANNULLATA (includeAnnullate=false in query).
  const month = {
    label: monthLabelOf(ymd),
    aggregates: applyNettoIvaAccessoriServizi(aggregateDailyReport(monthRows, weights, visiblePiste, canvassIndex, canvassKpiRules)),
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
  // Le soglie/premi VF del report aggregato sono quelli globali del mese.
  // Gli override per RS restano applicati nella Dashboard quando il
  // perimetro è una singola RS; un report brand multi-RS non deve scegliere
  // arbitrariamente l'override di una RS.
  const vfPisteConfig = isVfReport
    ? (((garaCfgObj?.vfPisteConfig as {
        configPerPista?: Partial<Record<string, VfPistaConf>>;
      } | undefined)?.configPerPista) ?? {})
    : undefined;
  // Proiezione a fine mese: un KPI per riga (volumi per pista + Telefoni + Accessori/Servizi)
  // stimati sui giorni lavorativi trascorsi, dagli aggregati del mese. I giorni
  // lavorativi tengono conto della divisione CC/strada (conteggi negozi dal
  // forecast); senza conteggi ⇒ soli giorni feriali (lun–sab).
  const monthProjection = buildMonthEndProjection(
    ymd,
    month.aggregates,
    forecast,
    { model: isVfReport ? "vf" : "windtre" },
  ) ?? undefined;
  // Avviso plafond ricariche (Task #538): RS con saldo negativo o sotto la
  // soglia di avviso. Il plafond è a livello org (non per brand): l'avviso
  // compare UNA volta per org, sul primo report della run (syncFirst), così
  // le org con report per-brand non lo ricevono duplicato nella stessa chat.
  // Best-effort: un errore nel calcolo non blocca mai l'invio del report.
  let plafondWarning = "";
  if (params.syncFirst !== false) {
    try {
      const { computePlafondSaldi } = await import("./plafondRicariche");
      const saldi = await computePlafondSaldi(params.orgId);
      const inAllerta = saldi.filter((s) => s.inAllerta && s.saldo !== null);
      if (inAllerta.length > 0) {
        const fmt = (n: number) =>
          new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" }).format(n);
        // Il messaggio parte con parse_mode HTML: i nomi RS vanno escapati o
        // un "&"/"<" nel nome fa rifiutare a Telegram l'INTERO report.
        const esc = (s: string) =>
          s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
        const lines = inAllerta.map((s) =>
          s.saldo! < 0
            ? `• ${esc(s.ragioneSociale)}: plafond ESAURITO (${fmt(s.saldo!)})`
            : `• ${esc(s.ragioneSociale)}: saldo ${fmt(s.saldo!)} sotto la soglia di ${fmt(s.soglia!)}`,
        );
        plafondWarning = `\n\n⚠️ PLAFOND RICARICHE IN ESAURIMENTO\n${lines.join("\n")}`;
      }
    } catch (e) {
      console.warn(`[telegram-report] avviso plafond ricariche non calcolato org=${params.orgId}:`, e);
    }
  }
  const message = buildTelegramReportMessage({
    orgName: reportName,
    dateYMD: ymd,
    timeLabel: params.timeLabel,
    aggregates,
    monthAggregates: month.aggregates,
    forecast,
    fascia: params.fascia ?? fasciaFromTimeLabel(params.timeLabel),
    content: reportContent,
  });
  const result = await sendTelegramMessage(params.botToken, params.chatId, message + plafondWarning);
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
      // Report per brand (Task #519): i lead DTS sono a livello org, non
      // hanno un brand proprio. Fail-closed: nel report di un brand tengo
      // solo i lead il cui idVendita corrisponde a una vendita del mese di
      // quel brand (monthRows è già filtrato per codicePos del brand); i
      // lead senza vendita collegata vengono omessi per non far trapelare
      // volumi/consulenti cross-brand.
      const brandSaleIds: Set<number> | null = params.brand
        ? new Set(
            monthRows
              .map((r) => dtsSaleCodiceEsterno({ codiceEsterno: null, rawData: r.rawData }))
              .filter((n): n is number => n !== null),
          )
        : null;
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
      const brandLeads = brandSaleIds
        ? leads.filter((l) => l.idVendita !== null && brandSaleIds.has(l.idVendita))
        : leads;
      const agg = aggregateDtsReport(
        brandLeads,
        monthRows.map((r) => ({
          bisuiteId: r.bisuiteId,
          stato: r.stato,
          codicePos: r.codicePos,
          nomeNegozio: r.nomeNegozio,
          rawData: r.rawData,
        })),
        // Le piste nascoste nel report Telegram spariscono anche dal
        // drill-down DTS (per pista, categorie canvass); "iva" resta sempre.
        { visiblePiste },
      );
      if (agg.totaleLead > 0 || agg.vendite.dts > 0) dts = agg;
    }
  } catch (e) {
    console.error(`[telegram-report] sezione DTS fallita per org ${params.orgId}:`, e);
  }

  const html = buildVenditeReportHtml({
    orgName: reportName,
    dateYMD: ymd,
    timeLabel: params.timeLabel,
    aggregates,
    trend,
    history,
    month,
    monthProjection,
    dts,
    content: reportContent,
    vfPisteConfig,
    isVfModel: isVfReport,
  });
  const fileName = reportHtmlFileName(reportName, ymd, params.timeLabel);
  const docResult = await sendTelegramDocument(params.botToken, params.chatId, fileName, html, {
    caption: `Report vendite${brand ? ` ${brand.brandName}` : ""} ${fmtReportDate(ymd)} — versione leggibile`,
  });
  if (!docResult.ok) {
    console.warn(
      `[telegram-report] allegato HTML FALLITO org=${params.orgId} (${params.orgName}): ${docResult.error} — il messaggio di testo è stato comunque inviato`,
    );
    return { ok: true, docError: docResult.error };
  }
  return { ok: true };
}

// Serializzazione delle run (Task #333): timer, recovery al boot e recovery
// da reschedule possono sovrapporsi (es. salvataggi config ravvicinati).
// Il dedup è read-then-send-then-record: due run CONCORRENTI potrebbero
// entrambe leggere "non inviato" e duplicare il messaggio prima della
// registrazione. Accodandole, ogni run rilegge gli invii registrati dopo
// che la precedente li ha scritti. (Il processo scheduler è singolo — PM2
// senza cluster — quindi la serializzazione in-process è sufficiente;
// telegram_report_sends resta comunque con vincolo di unicità come rete.)
let runQueue: Promise<void> = Promise.resolve();

export function runScheduledSend(
  timeLabel: string,
  opts?: { recovery?: boolean },
): Promise<void> {
  const next = runQueue.then(() => runScheduledSendInner(timeLabel, opts));
  runQueue = next.catch(() => {});
  return next;
}

async function runScheduledSendInner(
  timeLabel: string,
  opts?: { recovery?: boolean },
): Promise<void> {
  const orgs = await storage.getOrganizations();
  const { ymd } = romeNowParts();
  // Dedup (Task #332/#334): salta le org che hanno GIÀ ricevuto il report
  // della stessa FASCIA logica (parziale/chiusura) oggi. Confronto per
  // fascia e non per label: se un'org cambia orario a metà giornata, il
  // label registrato (es. "13:30") non coincide più con lo slot nuovo
  // (es. "12:00") ma la fascia sì — così niente doppioni né invii soppressi.
  let sentLabelsByOrg = new Map<string, Array<{ timeLabel: string; brandKey: string }>>();
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
      // Report separati per brand (Task #519): se almeno un PDV della
      // Struttura ha brand associati, si invia un report distinto per ogni
      // brand con PDV (stesso bot/chat). Nessun PDV brandizzato ⇒ report
      // unico legacy (brandKey ''). Dedup e registrazione per org+fascia+brand.
      let brandTargets: TelegramBrandTarget[] = [];
      try {
        const orgBrands = await storage.getOrganizationBrands(org.id);
        brandTargets = buildTelegramBrandTargets(orgBrands, cfg?.puntiVendita);
        if (brandTargets.length > 0) {
          const unassigned = unassignedPosCodes(cfg?.puntiVendita);
          if (unassigned.length > 0) {
            console.warn(
              `[telegram-report] org=${org.id} (${org.name}): ${unassigned.length} PDV senza brand ` +
                `(${unassigned.slice(0, 5).join(", ")}${unassigned.length > 5 ? ", …" : ""}) — ` +
                `le loro vendite NON compaiono in nessun report per brand`,
            );
          }
        }
      } catch (err) {
        console.warn(
          `[telegram-report] lettura brand/struttura fallita org=${org.id}, report unico legacy: ${err}`,
        );
      }
      const reportsToSend: Array<{ brand: TelegramBrandTarget | null; brandKey: string }> =
        brandTargets.length > 0
          ? brandTargets.map((b) => ({ brand: b, brandKey: b.brandId }))
          : [{ brand: null, brandKey: "" }];
      // La sync BiSuite del giorno va fatta UNA volta per org, non per brand:
      // syncFirst solo sul primo invio della lista.
      let firstOfOrg = true;
      let orgSentAny = false;
      let orgFailedAny = false;
      for (const rep of reportsToSend) {
        const alreadySent = sentLabels.some(
          (l) => l.brandKey === rep.brandKey && fasciaForLabel(l.timeLabel, times) === fascia,
        );
        if (alreadySent) continue;
        const brandTag = rep.brand ? ` brand=${rep.brand.brandName}` : "";
        const r = await sendDailyReportForOrg({
          orgId: org.id,
          orgName: org.name,
          botToken: tg.botToken,
          chatId: tg.chatId,
          timeLabel,
          fascia,
          syncFirst: firstOfOrg,
          brand: rep.brand,
        });
        firstOfOrg = false;
        if (r.ok) {
          orgSentAny = true;
          console.log(`[telegram-report] inviato report ${timeLabel}${brandTag} org=${org.id} (${org.name})`);
          // Registra l'invio per il dedup/recovery (Task #332). Un errore di
          // scrittura non deve far ripartire l'org (il messaggio è già arrivato).
          // Solo il brand inviato con successo viene registrato: gli altri
          // restano recuperabili.
          try {
            await storage.recordTelegramReportSend(org.id, ymd, timeLabel, rep.brandKey);
          } catch (err) {
            console.warn(`[telegram-report] registrazione invio fallita org=${org.id}${brandTag}: ${err}`);
          }
        } else {
          orgFailedAny = true;
          console.error(
            `[telegram-report] invio FALLITO ${timeLabel}${brandTag} org=${org.id} (${org.name}): ${r.error}`,
          );
        }
      }
      if (!orgSentAny && !orgFailedAny) {
        deduped++;
        continue;
      }
      if (orgSentAny) sent++;
      if (orgFailedAny) failed++;
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
 * Recovery bounded di uno slot già scattato (Task #332/#333): se "adesso"
 * cade entro la finestra (90 min, stesso giorno Roma) di uno degli orari
 * configurati, esegue la run per le sole org rimaste senza report di quella
 * fascia (il dedup per fascia logica evita ogni doppione). Usata al boot e
 * dopo un reschedule: così spostare uno slot NON ancora inviato su un orario
 * già passato di oggi non fa perdere l'invio.
 */
function maybeRecoverElapsedSlot(context: string): void {
  void collectSendTimes()
    .then(async (times) => {
      // TUTTI gli slot in finestra, non solo il più recente: con orari
      // per-org diversi un solo slot lascerebbe indietro le org il cui
      // orario spostato è meno recente di quello (magari già inviato) di
      // un'altra org. Le run sono comunque serializzate e deduplicate.
      const recs = recoverableSlots(new Date(), 90, times);
      for (const rec of recs) {
        console.log(
          `[telegram-report] ${context}: slot ${rec.label} del ${rec.ymd} dentro la finestra, ` +
            `verifico le org senza report (Roma: ${formatRomeNow()})`,
        );
        await runScheduledSend(rec.label, { recovery: true });
      }
    })
    .catch((err) => {
      console.error(`[telegram-report] ${context} fallita: ${err}`);
    });
}

/**
 * Ri-arma il timer dello scheduler (Task #334): da chiamare dopo un
 * salvataggio della config Telegram, così un nuovo orario ancora futuro
 * di OGGI viene pianificato subito (senza aspettare il prossimo giro).
 * Inoltre (Task #333) recupera subito uno slot spostato su un orario già
 * passato di oggi (entro 90 min): senza questo, un'org che sposta il
 * parziale non ancora inviato all'indietro lo perderebbe fino al riavvio.
 * No-op se lo scheduler non è avviato (es. ambiente dev).
 */
export function rescheduleTelegramReports(): void {
  if (!started || !scheduleNextFn) return;
  if (currentTimer) clearTimeout(currentTimer);
  currentTimer = null;
  scheduleGeneration++;
  maybeRecoverElapsedSlot("reschedule");
  void scheduleNextFn();
}

/**
 * Unione degli orari di invio configurati da tutte le org (Task #334):
 * lo scheduler pianifica il prossimo timer sull'orario più vicino fra
 * quelli configurati; alla run ogni org riceve solo i propri slot.
 * Se la lettura config fallisce si ricade sui default.
 */
export async function collectSendTimes(): Promise<Array<{ label: string; minutes: number }>> {
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
  maybeRecoverElapsedSlot("recovery al boot");

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
