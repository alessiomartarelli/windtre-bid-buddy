/**
 * Verifica end-to-end (Task #284): i pesi del punteggio performance
 * configurati in gara_config.config.performanceWeights cambiano DAVVERO il
 * report Telegram "live" — riordinano lo standout "il migliore" nel messaggio
 * e le classifiche addetti/negozi nell'allegato HTML.
 *
 * Task #283 aveva reso i pesi configurabili e li aveva verificati con soli
 * test puri + typecheck; qui esercitiamo il PERCORSO DB reale dello scheduler:
 *   storage.getGaraConfig -> parsePerformanceWeights -> aggregateDailyReport
 *   -> buildTelegramReportMessage + buildVenditeReportHtml.
 *
 * NON invia nulla su Telegram e NON tocca dati reali: crea un'org di test,
 * semina vendite del giorno (data Roma), legge i pesi dal DB, ricostruisce
 * messaggio + HTML e asserisce il riordino; poi svuota i pesi e conferma il
 * fallback ai default di sistema. Pulisce tutto a fine corsa.
 *
 * Lancio (DB dev, DATABASE_URL già presente):
 *   npx tsx scripts/verify-performance-weights-effect.mts
 */
import crypto from "node:crypto";
import assert from "node:assert/strict";
import { storage } from "../server/storage";
import { pool } from "../server/db";
import {
  aggregateDailyReport,
  parsePerformanceWeights,
  buildTelegramReportMessage,
  monthLabelOf,
  topPerformer,
} from "@shared/venditeReport";
import { buildVenditeReportHtml } from "@shared/venditeReportHtml";
import { parseForecastConfig, fasciaFromTimeLabel } from "@shared/venditeCommento";

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
// pista nota (es. "UNTIED" => mobile, "ALLARMI" => protecta).
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

// Replica ESATTA del blocco di caricamento pesi dello scheduler
// (server/telegramReportScheduler.ts): legge gara_config del mese della data e
// costruisce gli aggregati con quei pesi (fallback ai default se assenti).
async function schedulerAggregates(orgId: string, ymd: string, rows: any[]) {
  const gm = /^(\d{4})-(\d{2})-\d{2}$/.exec(ymd)!;
  const garaCfg = await storage.getGaraConfig(orgId, +gm[2], +gm[1]);
  const garaCfgObj = garaCfg?.config as Record<string, unknown> | undefined;
  const weights = parsePerformanceWeights(garaCfgObj?.performanceWeights);
  return { weights, aggregates: aggregateDailyReport(rows, weights) };
}

function standoutAddetto(message: string): string | null {
  // Nel commento lo standout addetto compare come "bravo l'addetto <b>NOME</b>"
  // oppure "Bravo l'addetto <b>NOME</b>".
  const m = /[Bb]ravo l'addetto <b>([^<]+)<\/b>/.exec(message);
  return m ? m[1] : null;
}

// Estrae la sola sezione "Per addetto" dell'HTML (classifica per punteggio),
// così l'ordine controllato è quello della classifica e non di altri pannelli
// (es. il riepilogo "migliori per KPI") che citano gli stessi nomi.
function addettiSectionOf(html: string): string {
  const start = html.indexOf("<h2>Per addetto</h2>");
  if (start < 0) return "";
  const rest = html.slice(start);
  const end = rest.indexOf('<div class="card"', 1);
  return end < 0 ? rest : rest.slice(0, end);
}

// Come sopra ma per la classifica negozi ("Per punto vendita").
function negoziSectionOf(html: string): string {
  const start = html.indexOf("<h2>Per punto vendita</h2>");
  if (start < 0) return "";
  const rest = html.slice(start);
  const end = rest.indexOf('<div class="card"', 1);
  return end < 0 ? rest : rest.slice(0, end);
}

async function main() {
  const ymd = romeYmd();
  const dataVenditaIso = `${ymd}T10:00:00.000Z`;
  const orgName = `PerfWeights_${crypto.randomBytes(4).toString("hex")}`;
  const org = await storage.createOrganization({ name: orgName });
  console.log(`[verify] org di test creata: ${org.name} (${org.id}), data Roma=${ymd} mese=${monthLabelOf(ymd)}`);

  let failed = false;
  try {
    // ── Seed vendite del giorno ──────────────────────────────────────────
    // Addetto A "ALICE ALFA" @POS_A: 2 attivazioni MOBILE (UNTIED).
    // Addetto B "BRUNO BETA"  @POS_B: 1 attivazione PROTECTA (ALLARMI).
    // Default: mobile=1 (A=2 punti), protecta=10 (B=10 punti) => vince B.
    await insertSale(org.id, { addetto: "ALICE ALFA", codicePos: "POS_A", categoria: "UNTIED", prezzo: 10, dataVenditaIso });
    await insertSale(org.id, { addetto: "ALICE ALFA", codicePos: "POS_A", categoria: "UNTIED", prezzo: 10, dataVenditaIso });
    await insertSale(org.id, { addetto: "BRUNO BETA", codicePos: "POS_B", categoria: "ALLARMI", prezzo: 10, dataVenditaIso });

    const rows = await storage.getBisuiteSalesByItalianDateRange(org.id, ymd, ymd, false);
    assert.equal(rows.length, 3, "seed: mi aspetto 3 vendite del giorno");

    const forecast = parseForecastConfig(undefined);
    const buildMessage = (aggregates: any) =>
      buildTelegramReportMessage({
        orgName: org.name,
        dateYMD: ymd,
        timeLabel: "22:30",
        aggregates,
        monthAggregates: aggregates,
        forecast,
        fascia: fasciaFromTimeLabel("22:30"),
      });
    const buildHtml = (aggregates: any) =>
      buildVenditeReportHtml({
        orgName: org.name,
        dateYMD: ymd,
        timeLabel: "22:30",
        aggregates,
        trend: [],
        history: [],
        month: { label: monthLabelOf(ymd), aggregates },
        monthProjection: undefined,
      });

    // ── STEP 1: nessuna config => default di sistema, vince PROTECTA (B) ──
    const s1 = await schedulerAggregates(org.id, ymd, rows);
    assert.deepEqual(s1.weights.pesi.protecta, 10, "default protecta = 10");
    assert.deepEqual(s1.weights.pesi.mobile, 1, "default mobile = 1");
    const top1 = topPerformer(s1.aggregates);
    console.log(`[verify] STEP 1 (default) top addetto=${top1.addetto?.nome} punti=${top1.addetto?.valore} | top negozio=${top1.negozio?.nome} punti=${top1.negozio?.valore}`);
    assert.equal(top1.addetto?.nome, "BRUNO BETA", "default: vince BRUNO BETA (protecta 10 > mobile 2)");
    assert.equal(top1.negozio?.nome, "Negozio POS_B", "default: vince Negozio POS_B");
    // Classifica addetti: B prima di A.
    assert.equal(s1.aggregates.perAddetto[0].nomeAddetto, "BRUNO BETA", "default: classifica addetti B in testa");
    const msg1 = buildMessage(s1.aggregates);
    const html1 = buildHtml(s1.aggregates);
    assert.equal(standoutAddetto(msg1), "BRUNO BETA", "default: standout nel messaggio = BRUNO BETA");
    // Nella classifica "Per addetto" dell'HTML, B deve precedere A.
    const sec1 = addettiSectionOf(html1);
    assert.ok(sec1.indexOf("BRUNO BETA") >= 0 && sec1.indexOf("BRUNO BETA") < sec1.indexOf("ALICE ALFA"), "default: HTML classifica addetti mostra BRUNO BETA prima di ALICE ALFA");
    const neg1 = negoziSectionOf(html1);
    assert.ok(neg1.indexOf("Negozio POS_B") >= 0 && neg1.indexOf("Negozio POS_B") < neg1.indexOf("Negozio POS_A"), "default: HTML classifica negozi mostra POS_B prima di POS_A");

    // ── STEP 2: pesi custom (mobile alto, protecta azzerata) => vince A ──
    // performanceWeights: mobile=10, protecta=0. A=20 punti, B=0 => vince A.
    await pool.query(
      `INSERT INTO gara_config (organization_id, month, year, name, config)
       VALUES ($1,$2,$3,$4,$5::jsonb)`,
      [
        org.id,
        +ymd.slice(5, 7),
        +ymd.slice(0, 4),
        "test perf weights",
        JSON.stringify({ performanceWeights: { mobile: 10, protecta: 0 } }),
      ],
    );
    const s2 = await schedulerAggregates(org.id, ymd, rows);
    assert.equal(s2.weights.pesi.mobile, 10, "custom: mobile = 10");
    assert.equal(s2.weights.pesi.protecta, 0, "custom: protecta = 0");
    // I campi NON specificati ricadono sul default (fallback per-campo).
    assert.equal(s2.weights.pesi.fisso, 3, "custom: fisso non specificato => default 3");
    const top2 = topPerformer(s2.aggregates);
    console.log(`[verify] STEP 2 (custom) top addetto=${top2.addetto?.nome} punti=${top2.addetto?.valore} | top negozio=${top2.negozio?.nome} punti=${top2.negozio?.valore}`);
    assert.equal(top2.addetto?.nome, "ALICE ALFA", "custom: vince ALICE ALFA (mobile 20 > protecta 0)");
    assert.equal(top2.negozio?.nome, "Negozio POS_A", "custom: vince Negozio POS_A");
    assert.equal(s2.aggregates.perAddetto[0].nomeAddetto, "ALICE ALFA", "custom: classifica addetti A in testa");
    const msg2 = buildMessage(s2.aggregates);
    const html2 = buildHtml(s2.aggregates);
    assert.equal(standoutAddetto(msg2), "ALICE ALFA", "custom: standout nel messaggio = ALICE ALFA");
    const sec2 = addettiSectionOf(html2);
    assert.ok(sec2.indexOf("ALICE ALFA") >= 0 && sec2.indexOf("ALICE ALFA") < sec2.indexOf("BRUNO BETA"), "custom: HTML classifica addetti mostra ALICE ALFA prima di BRUNO BETA");
    const neg2 = negoziSectionOf(html2);
    assert.ok(neg2.indexOf("Negozio POS_A") >= 0 && neg2.indexOf("Negozio POS_A") < neg2.indexOf("Negozio POS_B"), "custom: HTML classifica negozi mostra POS_A prima di POS_B");
    // Prova positiva che lo standout è cambiato rispetto allo step default.
    assert.notEqual(standoutAddetto(msg1), standoutAddetto(msg2), "lo standout DEVE cambiare fra default e custom");

    // ── STEP 3: config presente ma performanceWeights vuoto => default ──
    await pool.query(`UPDATE gara_config SET config = $2::jsonb WHERE organization_id = $1`, [
      org.id,
      JSON.stringify({ performanceWeights: {} }),
    ]);
    const s3 = await schedulerAggregates(org.id, ymd, rows);
    assert.equal(s3.weights.pesi.protecta, 10, "fallback: protecta torna al default 10");
    assert.equal(s3.weights.pesi.mobile, 1, "fallback: mobile torna al default 1");
    const top3 = topPerformer(s3.aggregates);
    console.log(`[verify] STEP 3 (fallback) top addetto=${top3.addetto?.nome} punti=${top3.addetto?.valore}`);
    assert.equal(top3.addetto?.nome, "BRUNO BETA", "fallback: torna a vincere BRUNO BETA come con i default");

    console.log("\n[verify] ✅ TUTTE LE ASSERZIONI OK — i pesi configurati riordinano standout + classifiche (messaggio e HTML), e il config vuoto ricade sui default.");
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
