/**
 * READ-ONLY: anteprima del commento "direttore vendite" del report Telegram
 * (Task #267) usando i DATI REALI di prod, senza inviare nulla e senza
 * scrivere sul DB. Replica la catena dello scheduler (stessa finestra dati,
 * stessi aggregati, stesso parseForecastConfig) e stampa:
 *  - il testo del messaggio per fascia parziale (13:30) e chiusura (22:30)
 *  - una tabella di cross-check dei numeri (oggi/mese per dimensione, delta %,
 *    proiezioni) da confrontare con l'allegato HTML.
 *
 * Lancio (tunnel SSH al Postgres di prod):
 *   DATABASE_URL=<prod via tunnel> ORG_ID=org-admin-windtre \
 *     npx tsx scripts/preview-telegram-commento.mts
 */
import { storage } from "../server/storage";
import { pool } from "../server/db";
import {
  addYmdDays,
  aggregateDailyReport,
  parsePerformanceWeights,
  monthStartYmd,
  monthLabelOf,
  monthWorkingDays,
  trendYmdOf,
  telefoniPezziOf,
  buildTelegramReportMessage,
  buildMonthEndProjection,
  fmtEuro,
  type DailyReportAggregates,
} from "@shared/venditeReport";
import { parseForecastConfig, hasForecast } from "@shared/venditeCommento";

function romeYmd(now: Date = new Date()): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Rome",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const p = fmt.formatToParts(now);
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? "0";
  return `${g("year")}-${g("month")}-${g("day")}`;
}

function accessoriImporto(a: DailyReportAggregates): number {
  const x = a.prodottiByCategoria.find((c) => c.categoria.trim().toUpperCase() === "ACCESSORI");
  return x?.importo ?? 0;
}

async function main() {
  const orgId = (process.env.ORG_ID ?? "org-admin-windtre").trim();
  const ymd = (process.env.YMD ?? romeYmd()).trim();
  const org = (await storage.getOrganizations()).find((o) => o.id === orgId);
  if (!org) {
    console.error(`[preview] nessuna org con id=${orgId}`);
    await pool.end();
    process.exit(1);
  }

  const orgConfig = await storage.getOrgConfig(org.id);
  const cfg = orgConfig?.config as Record<string, unknown> | undefined;
  const tg = cfg?.telegramReport as Record<string, unknown> | undefined;
  // Forecast dalla config di prod, con override opzionale via env (read-only,
  // NON scrive sul DB) per esercitare mese-framing/delta/proiezioni/bande.
  const envFc = {
    canvassPezzi: process.env.FC_CANVASS,
    telefoniPezzi: process.env.FC_TELEFONI,
    accessoriFatturato: process.env.FC_ACCESSORI,
    serviziFatturato: process.env.FC_SERVIZI,
    numeroNegozi: process.env.FC_NEGOZI,
    giorniLavorativiPerNegozio: process.env.FC_GIORNI,
  };
  const anyEnvFc = Object.values(envFc).some((v) => v !== undefined && v !== "");
  const forecast = anyEnvFc ? parseForecastConfig(envFc) : parseForecastConfig(tg?.forecast);
  if (anyEnvFc) console.log(">> FORECAST DA ENV (override read-only, prod non modificato)");

  const TREND_DAYS = 14;
  const trendFromYmd = addYmdDays(ymd, -(TREND_DAYS - 1));
  const monthFromYmd = monthStartYmd(ymd);
  const fromYmd = trendFromYmd < monthFromYmd ? trendFromYmd : monthFromYmd;
  const rows = await storage.getBisuiteSalesByItalianDateRange(org.id, fromYmd, ymd, false);
  const monthRows = rows.filter((r) => {
    const d = trendYmdOf(r.dataVendita);
    return d !== null && d >= monthFromYmd;
  });
  const todayRows = rows.filter((r) => trendYmdOf(r.dataVendita) === ymd);
  // Pesi del punteggio performance (Task #283): per-org/per-mese dalla
  // Configurazione gara (gara_config.config.performanceWeights), con fallback
  // ai default di sistema. Stessa catena dello scheduler
  // (server/telegramReportScheduler.ts) così lo standout "il migliore" e le
  // classifiche addetti/negozi combaciano col report inviato davvero.
  const gm = /^(\d{4})-(\d{2})-\d{2}$/.exec(ymd);
  let garaCfgObj: Record<string, unknown> | undefined;
  if (gm) {
    const garaCfg = await storage.getGaraConfig(org.id, +gm[2], +gm[1]);
    garaCfgObj = garaCfg?.config as Record<string, unknown> | undefined;
  }
  const weights = parsePerformanceWeights(garaCfgObj?.performanceWeights);
  const aggregates = aggregateDailyReport(todayRows, weights);
  const monthAgg = aggregateDailyReport(monthRows, weights);

  console.log("═".repeat(72));
  console.log(`ORG: ${org.name} (${org.id})`);
  console.log(`Data (Roma): ${ymd}   Mese: ${monthLabelOf(ymd)}`);
  console.log(`telegramReport.enabled = ${tg?.enabled ?? "(assente)"}   chat_id = ${tg?.chat_id ? "presente" : "ASSENTE"}   bot_token = ${tg?.bot_token ? "presente" : "ASSENTE"}`);
  console.log(`forecast configurato? ${hasForecast(forecast)}`);
  console.log("forecast:", JSON.stringify(forecast));
  const weightsConfigured = garaCfgObj?.performanceWeights !== undefined;
  console.log(`pesi performance configurati (gara_config)? ${weightsConfigured}${weightsConfigured ? "" : " (default di sistema)"}`);
  console.log("pesi performance:", JSON.stringify(weights.pesi));
  const wd = monthWorkingDays(ymd);
  console.log(`giorni lavorativi calendario: elapsed=${wd?.elapsed} total=${wd?.total}`);
  console.log("─".repeat(72));
  console.log(`Vendite oggi: ${aggregates.vendite}  importo ${fmtEuro(aggregates.importo)}`);
  console.log(`Vendite mese: ${monthAgg.vendite}  importo ${fmtEuro(monthAgg.importo)}`);
  console.log("─".repeat(72));

  const dims: Array<{ label: string; unit: "pz" | "€"; fc: number | null; today: number; month: number }> = [
    { label: "canvass", unit: "pz", fc: forecast.canvassPezzi, today: aggregates.countByType.canvass, month: monthAgg.countByType.canvass },
    { label: "telefonia", unit: "pz", fc: forecast.telefoniPezzi, today: telefoniPezziOf(aggregates), month: telefoniPezziOf(monthAgg) },
    { label: "accessori", unit: "€", fc: forecast.accessoriFatturato, today: accessoriImporto(aggregates), month: accessoriImporto(monthAgg) },
    { label: "servizi", unit: "€", fc: forecast.serviziFatturato, today: aggregates.amountByType.servizi, month: monthAgg.amountByType.servizi },
  ];
  const total = forecast.giorniLavorativiPerNegozio && forecast.giorniLavorativiPerNegozio > 0 ? forecast.giorniLavorativiPerNegozio : wd?.total ?? 0;
  const elapsed = total > 0 ? Math.min(wd?.elapsed ?? 0, total) : wd?.elapsed ?? 0;
  console.log("CROSS-CHECK NUMERI (per il confronto con l'allegato HTML):");
  console.log(`  passo giorni lavorativi usato: elapsed=${elapsed} total=${total}`);
  for (const d of dims) {
    const fmt = (v: number) => (d.unit === "€" ? fmtEuro(v) : String(Math.round(v)));
    if (d.fc === null) {
      console.log(`  ${d.label.padEnd(10)} oggi=${fmt(d.today).padStart(12)}  mese=${fmt(d.month).padStart(12)}  forecast=—`);
      continue;
    }
    const expectedToDate = total > 0 ? (d.fc * Math.min(elapsed, total)) / total : null;
    const monthDeltaPct = expectedToDate && expectedToDate > 0 ? Math.round(((d.month - expectedToDate) / expectedToDate) * 100) : null;
    const dailyTarget = total > 0 ? d.fc / total : null;
    const todayDeltaPct = dailyTarget && dailyTarget > 0 ? Math.round(((d.today - dailyTarget) / dailyTarget) * 100) : null;
    const projection = elapsed > 0 && total > 0 ? Math.round((d.month / elapsed) * total) : null;
    console.log(
      `  ${d.label.padEnd(10)} oggi=${fmt(d.today).padStart(12)} (Δgiorno ${todayDeltaPct ?? "—"}%)  ` +
        `mese=${fmt(d.month).padStart(12)} (Δpasso ${monthDeltaPct ?? "—"}%)  ` +
        `forecast=${fmt(d.fc)}  atteso-a-oggi=${expectedToDate === null ? "—" : fmt(expectedToDate)}  proiezione=${projection === null ? "—" : fmt(projection)}`,
    );
  }
  console.log("─".repeat(72));

  const projFull = buildMonthEndProjection(ymd, monthAgg);
  console.log("Proiezione HTML (buildMonthEndProjection):", JSON.stringify(projFull));
  console.log("═".repeat(72));

  for (const [fascia, timeLabel] of [
    ["parziale", "13:30"],
    ["chiusura", "22:30"],
  ] as const) {
    const message = buildTelegramReportMessage({
      orgName: org.name,
      dateYMD: ymd,
      timeLabel,
      aggregates,
      monthAggregates: monthAgg,
      forecast,
      fascia,
    });
    console.log(`\n########## MESSAGGIO ${fascia.toUpperCase()} (${timeLabel}) ##########`);
    console.log(message);
    console.log("#".repeat(72));
  }

  await pool.end();
}

main().catch((err) => {
  console.error(`[preview] errore: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
