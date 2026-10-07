/**
 * Read-only VPS audit. Never imports storage or calls an application endpoint.
 * Prints aggregates only; snapshots contain opaque keys, not customer identity.
 * Usage: npx tsx scripts/verify-cj-eligibility-prod.ts before|after|audit
 * audit prints current aggregates without reading or writing a baseline.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import {
  driverFromCategory, isCjMobileEligible, isCjItemActive,
  monthOfIso, pisteInWindow, summarizeDrivers,
} from "../shared/customerJourney";

const phase = process.argv[2];
if (phase !== "before" && phase !== "after" && phase !== "audit") throw new Error("Expected before|after|audit");
const snapshotPath = "/tmp/cj-eligibility-prod-baseline.json";
const remote = `
const {Client}=require("/var/www/incentive-w3/node_modules/pg");
const cfg=require("/var/www/incentive-w3/ecosystem.config.cjs");
const app=cfg.apps.find(a=>a.name==="incentive-w3");
const c=new Client({connectionString:app.env.DATABASE_URL});
(async()=>{
 await c.connect();
 await c.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
 await c.query("SET LOCAL statement_timeout='45s'");
 const orgs=(await c.query(\`SELECT organization_id AS org, config->>'customerJourneyEligibilityVersion' AS version,
 config->>'customerJourneyReconciledAt' AS watermark,
 coalesce(config->>'customerJourneyTriggerDate','2026-07-01') AS floor
 FROM organization_config WHERE organization_id IN
 (SELECT DISTINCT organization_id FROM customer_journeys)\`)).rows;
 const sales=(await c.query(\`SELECT s.id,s.organization_id AS org,s.bisuite_id AS bid,
 s.data_vendita AS date,s.stato,
 md5(CASE WHEN upper(trim(coalesce(s.raw_data->'cliente'->>'clienteTipo',''))) IN ('GIURIDICA','PROFESSIONISTA')
 AND trim(coalesce(s.raw_data->'cliente'->>'piva',''))<>'' THEN upper(trim(s.raw_data->'cliente'->>'piva'))
 ELSE coalesce(nullif(upper(trim(s.raw_data->'cliente'->>'codiceFiscale')),''),nullif(upper(trim(s.raw_data->'cliente'->>'piva')),'')) END) AS key,
 coalesce((SELECT jsonb_agg(jsonb_build_object('id',a->'id','categoria',a->'categoria',
 'tipologia',a->'tipologia','descrizione',a->'descrizione'))
 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(s.raw_data->'articoli')='array'
 THEN s.raw_data->'articoli' ELSE '[]'::jsonb END) a
 WHERE upper(trim(a->'categoria'->>'nome')) IN ('UNTIED','TIED CF','TIED IVA','ALTRE GA','ADD-ON GA','VERY MOBILE')), '[]'::jsonb) AS articles
 FROM bisuite_sales s WHERE s.organization_id IN
 (SELECT DISTINCT organization_id FROM customer_journeys)\`)).rows;
 const journeys=(await c.query(\`SELECT id,organization_id AS org,md5(customer_key) AS key,
 opened_at AS opened,trigger_sale_id AS trigger FROM customer_journeys\`)).rows;
 const items=(await c.query(\`SELECT id,journey_id AS journey,organization_id AS org,
 bisuite_sale_id AS sale,bisuite_article_id AS article,driver,categoria,tipologia,descrizione,
 coalesce(data_attivazione,data_inserimento) AS date,state,economic_state AS "economicState",
 state_manual AS "stateManual",economic_state_manual AS "economicManual",details_manual AS "detailsManual",
 md5(jsonb_build_array(imei,rata,pdv_destinazione,data_attivazione,gettone_confirmed,details_manual)::text) AS detailhash
 FROM customer_journey_items\`)).rows;
 await c.query("ROLLBACK");await c.end();
 console.log(JSON.stringify({orgs,sales,journeys,items}));
})().catch(async()=>{console.error("Read-only production audit failed");await c.end();process.exit(1)});
`;
let output: string;
try {
output = execFileSync("sshpass", [
  "-e", "ssh", "-o", "StrictHostKeyChecking=accept-new", "-o", "ConnectTimeout=15",
  "root@85.215.124.207", "node -",
], { input: remote, env: { ...process.env, SSHPASS: process.env.VPS_PASSWORD }, maxBuffer: 80 * 1024 * 1024 }).toString();
} catch {
  throw new Error("Production audit transport failed; captured output suppressed to protect customer data");
}
const data = JSON.parse(output);

const expected = new Map<string, { sale: string; date: string; bid: number }>();
const orgById = new Map(data.orgs.map((o: any) => [o.org, o]));
const itemsByJourney = new Map<string, any[]>();
for (const i of data.items) {
  const rows = itemsByJourney.get(i.journey) ?? [];
  rows.push({ ...i, eventDate: i.date });
  itemsByJourney.set(i.journey, rows);
}
const excluded = { data: 0, tourist: 0, alarm: 0, other: 0 };
let mobile = 0;
let suspiciousEligible = 0;
for (const s of data.sales) {
  const org: any = orgById.get(s.org);
  for (const a of Array.isArray(s.articles) ? s.articles : []) {
    const item = { categoria: a?.categoria?.nome, tipologia: a?.tipologia?.nome, descrizione: a?.descrizione };
    if (driverFromCategory(item.categoria) !== "mobile") continue;
    mobile++;
    const eligible = isCjMobileEligible(item);
    const text = `${item.tipologia ?? ""} ${item.descrizione ?? ""}`.toUpperCase();
    if (!eligible) {
      if (/TOURIST|TURISTIC/.test(text)) excluded.tourist++;
      else if (/ALLARM/.test(text) || item.tipologia?.toUpperCase().trim() === "ALTRE GA NON TURISTICHE") excluded.alarm++;
      else if (/\bDATA\b|\bDATI\b/.test(text)) excluded.data++;
      else excluded.other++;
    } else if (/\bTOURIST\b|\bALLARME\b|\bSOLO DATI\b|\bDATA ONLY\b/.test(text)) {
      // Diagnostic only; never changes classification.
      suspiciousEligible++;
    }
    if (!eligible || !s.key || !s.date || String(s.stato).toUpperCase().includes("ANNULL") || new Date(s.date) < new Date(org?.floor ?? "2026-07-01")) continue;
    const key = `${s.org}:${s.key}`;
    const old = expected.get(key);
    if (!old || s.date < old.date || (s.date === old.date && (s.bid ?? Number.MAX_SAFE_INTEGER) < old.bid)) {
      expected.set(key, { sale: s.id, date: s.date, bid: s.bid ?? Number.MAX_SAFE_INTEGER });
    }
  }
}
let invalidJourneys = 0, wrongT0 = 0, excludedHistorical = 0, excludedActiveContributions = 0;
let inWindowActive = 0, outsideWindowActive = 0, cohort = 0, summaryMismatch = 0;
const cohorts: Record<string, number> = {};
for (const j of data.journeys) {
  const e = expected.get(`${j.org}:${j.key}`);
  if (!e) invalidJourneys++;
  else if (new Date(e.date).getTime() !== new Date(j.opened).getTime() || e.sale !== j.trigger) wrongT0++;
  const t0 = monthOfIso(j.opened);
  const items = itemsByJourney.get(j.id) ?? [];
  if (items.some((i: any) => i.driver === "mobile" && isCjMobileEligible(i) && isCjItemActive(i) && pisteInWindow(i.date, t0))) cohort++;
  cohorts[String(j.opened).slice(0, 7)] = (cohorts[String(j.opened).slice(0, 7)] ?? 0) + 1;
  for (const i of items) {
    if (i.driver === "mobile" && !isCjMobileEligible(i)) { excludedHistorical++; continue; }
    if (isCjItemActive(i)) {
      if (pisteInWindow(i.date, t0)) inWindowActive++;
      else outsideWindowActive++;
    }
  }
  for (const summary of summarizeDrivers(items, t0)) {
    const eligibleRows = items.filter((i: any) => i.driver === summary.driver && (i.driver !== "mobile" || isCjMobileEligible(i)) && pisteInWindow(i.date, t0));
    if (summary.count !== eligibleRows.length || summary.activated !== eligibleRows.some(isCjItemActive)) summaryMismatch++;
    if (summary.driver === "mobile" && summary.count > eligibleRows.length) excludedActiveContributions++;
  }
}
const snapshot = {
  journeys: data.journeys,
  items: data.items.map(({ descrizione, tipologia, categoria, ...i }: any) => i),
};
let preserved: Record<string, number> | undefined;
if (phase === "before") writeFileSync(snapshotPath, JSON.stringify(snapshot), { mode: 0o600 });
else if (phase === "after") {
  const before = JSON.parse(readFileSync(snapshotPath, "utf8"));
  const keptJourneyIds = new Set(data.journeys.map((j: any) => j.id));
  const afterItems = new Map(data.items.map((i: any) => [i.id, i]));
  preserved = { expectedRetained: 0, missing: 0, manualStateChanged: 0, economicStateChanged: 0, manualDetailsChanged: 0, removedWithIneligibleJourney: 0, t0Moved: 0 };
  for (const j of before.journeys) {
    const now = data.journeys.find((n: any) => n.id === j.id);
    if (now && now.opened !== j.opened) preserved.t0Moved++;
  }
  for (const i of before.items) {
    if (!keptJourneyIds.has(i.journey)) { preserved.removedWithIneligibleJourney++; continue; }
    preserved.expectedRetained++;
    const n: any = afterItems.get(i.id);
    if (!n) { preserved.missing++; continue; }
    if (i.stateManual && (i.state !== n.state || !n.stateManual)) preserved.manualStateChanged++;
    if (i.economicState != null && (i.economicState !== n.economicState || i.economicManual !== n.economicManual)) preserved.economicStateChanged++;
    if (i.detailsManual && i.detailhash !== n.detailhash) preserved.manualDetailsChanged++;
  }
}
console.log(JSON.stringify({
  phase, capturedAt: new Date().toISOString(), organizations: data.orgs.length,
  upgradedOrganizations: data.orgs.filter((o: any) => o.version === "1").length,
  sales: data.sales.length, mobileArticles: mobile, excluded, suspiciousEligible,
  journeys: data.journeys.length, expectedCustomers: expected.size,
  invalidJourneys, wrongT0, cohorts, cohort, excludedHistorical,
  excludedActiveContributions, summaryMismatch, inWindowActive, outsideWindowActive, preserved,
  baselineCoverage: phase === "after" ? (() => {
    const b = JSON.parse(readFileSync(snapshotPath, "utf8"));
    return {
      manualOperative: b.items.filter((i: any) => i.stateManual).length,
      economic: b.items.filter((i: any) => i.economicState != null).length,
      manualEconomic: b.items.filter((i: any) => i.economicManual).length,
      manualDetails: b.items.filter((i: any) => i.detailsManual).length,
    };
  })() : undefined,
}, null, 2));
