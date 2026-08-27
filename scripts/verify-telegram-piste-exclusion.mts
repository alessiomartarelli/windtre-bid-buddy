/**
 * Verifica end-to-end (Task #517): una pista esclusa in
 * gara_config.config.telegramReportContent.pisteVisibili sparisce DAVVERO
 * da tutto il report Telegram "live" — messaggio di testo E allegato HTML.
 *
 * Task #515 aveva applicato il filtro alla fonte (aggregateDailyReport /
 * buildDailyTrend / buildDailyHistory con visiblePiste) coprendolo con soli
 * test puri; qui esercitiamo il PERCORSO DB reale dello scheduler
 * (stesso blocco di server/telegramReportScheduler.ts):
 *   storage.getGaraConfig -> parseTelegramReportContent -> applyBrandGating
 *   -> aggregateDailyReport/buildDailyTrend/buildDailyHistory(visiblePiste)
 *   -> buildTelegramReportMessage + buildVenditeReportHtml (con content).
 *
 * NON invia nulla su Telegram e NON tocca dati reali: crea un'org di test,
 * semina vendite del giorno (data Roma) su protecta (ALLARMI) e mobile
 * (UNTIED), poi:
 *   STEP 1 (baseline, nessuna config): "Windtre Protetti" compare sia nel
 *          messaggio che nell'HTML (prova positiva che il seed classifica).
 *   STEP 2 (protecta esclusa dal config): nessun riferimento
 *          "Protetti"/"Verisure"/"protecta" in NESSUNA sezione dei due
 *          output; mobile resta presente. (Hero/mix: i totali scontrino
 *          restano interi per scelta — non asseriti qui.)
 * Pulisce tutto a fine corsa.
 *
 * Lancio (DB dev, DATABASE_URL già presente):
 *   npx tsx scripts/verify-telegram-piste-exclusion.mts
 */
import crypto from "node:crypto";
import assert from "node:assert/strict";
import { storage } from "../server/storage";
import { pool } from "../server/db";
import {
  aggregateDailyReport,
  parsePerformanceWeights,
  buildDailyTrend,
  buildDailyHistory,
  buildTelegramReportMessage,
  monthLabelOf,
} from "@shared/venditeReport";
import { buildVenditeReportHtml } from "@shared/venditeReportHtml";
import { parseForecastConfig, fasciaFromTimeLabel } from "@shared/venditeCommento";
import {
  parseTelegramReportContent,
  applyBrandGating,
} from "@shared/telegramReportContent";

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

// Contatore monotono per bisuite_id deterministici (no collisioni casuali).
let bisuiteIdSeq = Date.now() % 1_000_000_000;

// Vendita BiSuite minima: un articolo di una categoria che classifica su una
// pista nota ("UNTIED" => mobile, "ALLARMI" => protecta).
async function insertSale(
  orgId: string,
  opts: { addetto: string; codicePos: string; categoria: string; prezzo: number; dataVenditaIso: string },
) {
  const bisuiteId = ++bisuiteIdSeq;
  const raw = {
    cliente: { clienteTipo: "FISICA" }, // privato: niente raddoppio P.IVA
    articoli: [
      {
        categoria: { nome: opts.categoria },
        tipologia: { nome: opts.categoria },
        descrizione: opts.categoria,
        dettaglio: { prezzo: String(opts.prezzo) },
      },
    ],
  };
  await pool.query(
    `INSERT INTO bisuite_sales
       (organization_id, bisuite_id, data_vendita, codice_pos, nome_negozio, nome_addetto, totale, stato, raw_data)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)`,
    [
      orgId,
      bisuiteId,
      opts.dataVenditaIso,
      opts.codicePos,
      `Negozio ${opts.codicePos}`,
      opts.addetto,
      String(opts.prezzo),
      "ATTIVO",
      JSON.stringify(raw),
    ],
  );
}

async function cleanupOrg(orgId: string) {
  await pool.query(`DELETE FROM gara_config WHERE organization_id = $1`, [orgId]).catch(() => {});
  await pool.query(`DELETE FROM bisuite_sales WHERE organization_id = $1`, [orgId]).catch(() => {});
  await pool.query(`DELETE FROM organizations WHERE id = $1`, [orgId]).catch(() => {});
}

// Replica ESATTA del blocco dello scheduler (server/telegramReportScheduler.ts):
// legge gara_config del mese, ne estrae pesi + contenuti report (con gating
// brand come farebbe lo scheduler) e ricostruisce TUTTI gli aggregati che
// alimentano messaggio e HTML con lo stesso visiblePiste.
async function schedulerOutputs(orgId: string, orgName: string, ymd: string, rows: any[]) {
  const gm = /^(\d{4})-(\d{2})-\d{2}$/.exec(ymd)!;
  const garaCfg = await storage.getGaraConfig(orgId, +gm[2], +gm[1]);
  const garaCfgObj = garaCfg?.config as Record<string, unknown> | undefined;
  const weights = parsePerformanceWeights(garaCfgObj?.performanceWeights);
  // Gating brand identico allo scheduler: l'org di test non ha brand
  // associati => isVfOrg=false (nessun filtro brand, conta solo il config).
  const orgBrands = await storage.getOrganizationBrands(orgId);
  const isVfOrg = orgBrands.some((b) => /vodafone|fastweb/i.test(b.name));
  const reportContent = applyBrandGating(
    parseTelegramReportContent(garaCfgObj?.telegramReportContent),
    isVfOrg,
  );
  const visiblePiste = reportContent.pisteVisibili;
  const aggregates = aggregateDailyReport(rows, weights, visiblePiste);
  const trend = buildDailyTrend(rows, ymd, ymd, visiblePiste);
  const history = buildDailyHistory(rows, ymd, ymd, visiblePiste);
  const forecast = parseForecastConfig(garaCfgObj?.venditeForecast);
  const message = buildTelegramReportMessage({
    orgName,
    dateYMD: ymd,
    timeLabel: "22:30",
    aggregates,
    monthAggregates: aggregates,
    forecast,
    fascia: fasciaFromTimeLabel("22:30"),
    content: reportContent,
  });
  const html = buildVenditeReportHtml({
    orgName,
    dateYMD: ymd,
    timeLabel: "22:30",
    aggregates,
    trend,
    history,
    month: { label: monthLabelOf(ymd), aggregates },
    monthProjection: undefined,
    content: reportContent,
  });
  return { visiblePiste, message, html };
}

// Ogni forma con cui la pista protecta può affiorare nei due output:
// label WindTre ("Windtre Protetti", anche solo "Protetti" nel commento),
// label VF ("Verisure") e chiave interna ("protecta").
const PROTECTA_MARKERS = ["protetti", "verisure", "protecta"];

function protectaLeaks(text: string): string[] {
  const low = text.toLowerCase();
  return PROTECTA_MARKERS.filter((m) => low.includes(m));
}

async function main() {
  const ymd = romeYmd();
  const dataVenditaIso = `${ymd}T10:00:00.000Z`;
  const orgName = `PisteExcl_${crypto.randomBytes(4).toString("hex")}`;
  const org = await storage.createOrganization({ name: orgName });
  console.log(`[verify] org di test creata: ${org.name} (${org.id}), data Roma=${ymd}`);

  let failed = false;
  try {
    // ── Seed vendite del giorno ──────────────────────────────────────────
    // "CARLA GAMMA" @POS_P vende 2 PROTECTA (ALLARMI) — è pure la migliore
    // del giorno, così se il filtro fallisse comparirebbe in standout,
    // classifiche e drill-down. "DARIO DELTA" @POS_M vende 1 MOBILE (UNTIED).
    await insertSale(org.id, { addetto: "CARLA GAMMA", codicePos: "POS_P", categoria: "ALLARMI", prezzo: 25, dataVenditaIso });
    await insertSale(org.id, { addetto: "CARLA GAMMA", codicePos: "POS_P", categoria: "ALLARMI", prezzo: 25, dataVenditaIso });
    await insertSale(org.id, { addetto: "DARIO DELTA", codicePos: "POS_M", categoria: "UNTIED", prezzo: 10, dataVenditaIso });

    const rows = await storage.getBisuiteSalesByItalianDateRange(org.id, ymd, ymd, false);
    assert.equal(rows.length, 3, "seed: mi aspetto 3 vendite del giorno");

    // ── STEP 1: nessuna config => tutte le piste visibili (baseline) ─────
    // Prova positiva: il seed classifica davvero su protecta e la pista
    // compare in ENTRAMBI gli output (altrimenti lo STEP 2 sarebbe vacuo).
    const s1 = await schedulerOutputs(org.id, org.name, ymd, rows);
    assert.ok(s1.visiblePiste.includes("protecta"), "baseline: protecta è tra le piste visibili di default");
    const msgLeaks1 = protectaLeaks(s1.message);
    const htmlLeaks1 = protectaLeaks(s1.html);
    console.log(`[verify] STEP 1 (baseline) marker protecta nel messaggio=${JSON.stringify(msgLeaks1)} nell'HTML=${JSON.stringify(htmlLeaks1)}`);
    assert.ok(msgLeaks1.length > 0, "baseline: il messaggio DEVE citare Protetti (il seed classifica su protecta)");
    assert.ok(htmlLeaks1.length > 0, "baseline: l'HTML DEVE citare Protetti");
    assert.ok(s1.message.toLowerCase().includes("protetti"), "baseline: label 'Protetti' presente nel messaggio");
    assert.ok(s1.html.includes("Windtre Protetti"), "baseline: label 'Windtre Protetti' presente nell'HTML");

    // ── STEP 2: config esclude protecta => sparisce da messaggio e HTML ──
    await pool.query(
      `INSERT INTO gara_config (organization_id, month, year, name, config)
       VALUES ($1,$2,$3,$4,$5::jsonb)`,
      [
        org.id,
        +ymd.slice(5, 7),
        +ymd.slice(0, 4),
        "test piste exclusion",
        JSON.stringify({
          telegramReportContent: {
            pisteVisibili: ["mobile", "fisso", "cb", "assicurazioni", "energia"],
          },
        }),
      ],
    );
    const s2 = await schedulerOutputs(org.id, org.name, ymd, rows);
    assert.ok(!s2.visiblePiste.includes("protecta"), "config: protecta NON è tra le piste visibili");
    const msgLeaks2 = protectaLeaks(s2.message);
    const htmlLeaks2 = protectaLeaks(s2.html);
    console.log(`[verify] STEP 2 (esclusa) marker protecta nel messaggio=${JSON.stringify(msgLeaks2)} nell'HTML=${JSON.stringify(htmlLeaks2)}`);
    assert.deepEqual(msgLeaks2, [], `esclusa: il messaggio NON deve contenere ${PROTECTA_MARKERS.join("/")}`);
    assert.deepEqual(htmlLeaks2, [], `esclusa: l'HTML NON deve contenere ${PROTECTA_MARKERS.join("/")} in nessuna sezione (piste, drill-down, trend, storico, mese)`);
    // Anche la venditrice/il negozio SOLO-protecta non devono più affiorare
    // nelle sezioni per-pista: i loro pezzi filtrati vanno a zero. (Nome e
    // negozio possono comparire nelle classifiche generali con 0 pezzi — qui
    // asseriamo che non ci sia NESSUN chip/citazione della pista.)
    // Le altre piste restano intere: mobile ancora presente in entrambi.
    assert.ok(s2.html.includes("Mobile"), "esclusa: la pista Mobile resta nell'HTML");
    assert.ok(s2.html.includes("DARIO DELTA"), "esclusa: l'addetto mobile resta nell'HTML");

    // ── STEP 3: array vuoto PRESENTE => selezione esplicita "niente" ─────
    // Nessuna pista visibile: nemmeno mobile deve comparire come pista.
    await pool.query(`UPDATE gara_config SET config = $2::jsonb WHERE organization_id = $1`, [
      org.id,
      JSON.stringify({ telegramReportContent: { pisteVisibili: [] } }),
    ]);
    const s3 = await schedulerOutputs(org.id, org.name, ymd, rows);
    assert.equal(s3.visiblePiste.length, 0, "vuoto: nessuna pista visibile");
    assert.deepEqual(protectaLeaks(s3.message), [], "vuoto: niente protecta nel messaggio");
    assert.deepEqual(protectaLeaks(s3.html), [], "vuoto: niente protecta nell'HTML");

    console.log("\n[verify] ✅ TUTTE LE ASSERZIONI OK — la pista esclusa dal config sparisce da messaggio e HTML sul percorso DB reale dello scheduler; baseline positiva confermata.");
  } catch (err) {
    failed = true;
    console.error(`\n[verify] ❌ FALLITO: ${err instanceof Error ? err.stack || err.message : err}`);
  } finally {
    await cleanupOrg(org.id);
    console.log(`[verify] org di test rimossa (${org.id}).`);
    await pool.end();
  }
  process.exit(failed ? 1 : 0);
}

main().catch(async (err) => {
  console.error(`[verify] errore fatale: ${err instanceof Error ? err.message : err}`);
  try { await pool.end(); } catch {}
  process.exit(1);
});
