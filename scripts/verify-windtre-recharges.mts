/**
 * Audit in sola lettura: nessun upload, sync o modifica dei dati.
 * Esempio:
 * npx tsx scripts/verify-windtre-recharges.mts --workbook report.xlsx \
 *   --org org-admin-windtre --from 2026-10-09 --to 2026-10-11
 * DATABASE_URL deve indicare un collegamento DB già configurato e attendibile.
 * Per riprodurre il confronto senza accessi al DB:
 * npx tsx scripts/verify-windtre-recharges.mts \
 *   --snapshot tests/fixtures/windtre-cms-recharges-anonymized.json
 *
 * Stampa solo aggregati. --fixture scrive esclusivamente una proiezione
 * pseudonimizzata (mai rawData originale, nomi, Keycode, ICCID o POS reali).
 */
import { readFile, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
import pg from "pg";
import {
  parseWindTreRechargeWorkbook, extractRechargeSales, reconcileRechargeRows,
  normalizeRechargePhone, RICARICHE_ANALYSIS_STATUSES,
  type RechargeProviderRow,
} from "../shared/ricaricheAnalysis";

const args = process.argv.slice(2);
const allowedOptions = new Set(["--workbook", "--org", "--from", "--to", "--fixture", "--snapshot"]);
for (let i = 0; i < args.length; i += 2) {
  assert(allowedOptions.has(args[i]), `Opzione non supportata: ${args[i]}`);
  assert(args[i + 1] && !args[i + 1].startsWith("--"), `Valore mancante: ${args[i]}`);
}
function option(name: string): string | undefined {
  const i = args.indexOf(name);
  if (i < 0) return undefined;
  const value = args[i + 1];
  if (!value || value.startsWith("--")) throw new Error(`Valore mancante: ${name}`);
  return value;
}
const workbook = option("--workbook");
const org = option("--org");
const snapshotPath = option("--snapshot");
assert(!snapshotPath || (!workbook && !org && !option("--fixture")), "Usare --snapshot senza --workbook, --org o --fixture.");
assert(snapshotPath || (workbook && org), "Specificare --workbook e --org, oppure --snapshot.");
const snapshot = snapshotPath ? JSON.parse(await readFile(snapshotPath, "utf8")) : undefined;
if (snapshot) {
  assert(Array.isArray(snapshot.providerRows) && snapshot.providerRows.length > 0 && Array.isArray(snapshot.sales), "Snapshot non valido.");
}
const provider: RechargeProviderRow[] = snapshot
  ? snapshot.providerRows
  : parseWindTreRechargeWorkbook(await readFile(workbook!));
const days = provider.map(r => r.date.slice(0, 10)).sort();
const from = option("--from") ?? snapshot?.expected?.requestedPeriod?.from ?? days[0];
const to = option("--to") ?? snapshot?.expected?.requestedPeriod?.to ?? days.at(-1)!;
assert(/^\d{4}-\d{2}-\d{2}$/.test(from) && /^\d{4}-\d{2}-\d{2}$/.test(to) && from <= to, "Intervallo non valido.");
const queryFrom = from < days[0] ? from : days[0];
const queryTo = to > days.at(-1)! ? to : days.at(-1)!;
// Stessa semantica wall-time italiano e stessa organizzazione della route.
// Si proiettano solo gli articoli ricarica; nessun nominativo cliente.
const sql = `
 SELECT s.id, s.bisuite_id AS "bisuiteId", s.data_vendita::text AS "dataVendita",
        s.codice_pos AS "codicePos", s.nome_negozio AS "nomeNegozio",
        '' AS "nomeCliente", s.stato,
        jsonb_build_object('articoli', COALESCE((
          SELECT jsonb_agg(a) FROM jsonb_array_elements(s.raw_data->'articoli') a
          WHERE a->'categoria'->>'nome' = 'RICARICHE'
        ), '[]'::jsonb)) AS "rawData"
 FROM bisuite_sales s
 WHERE s.organization_id = $1 AND s.data_vendita::date BETWEEN $2::date AND $3::date
 ORDER BY s.data_vendita DESC, s.bisuite_id`;
const params = [org, queryFrom, queryTo];

async function loadSales(): Promise<any[]> {
  assert(process.env.DATABASE_URL, "DATABASE_URL mancante.");
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const c = await pool.connect();
    try {
      await c.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      return (await c.query(sql, params)).rows;
    } finally {
      await c.query("ROLLBACK");
      c.release();
    }
  } finally {
    await pool.end();
  }
}

const sales: any[] = snapshot ? snapshot.sales : await loadSales();
assert(sales.length > 0, "Nessuna vendita nel perimetro: verificare azienda e intervallo.");
const candidates = extractRechargeSales(sales, { splitArticles: true });
const cents = (n: number | null) => Math.round((n ?? 0) * 100);
function summary(input: typeof provider, available: typeof candidates) {
  const rows = reconcileRechargeRows(input, available);
  const states = Object.fromEntries(RICARICHE_ANALYSIS_STATUSES.map(status => {
    const selected = rows.filter(r => r.status === status);
    return [status, {
      count: selected.length,
      providerCents: selected.reduce((n, r) => n + cents(r.amount), 0),
      bisuiteCents: selected.reduce((n, r) => n + cents(r.bisuiteAmount), 0),
    }];
  }));
  assert.equal(rows.filter(r => r.transactionId).length, input.length);
  assert.equal(rows.filter(r => r.saleId).length, available.length);
  assert.equal(new Set(rows.map(r => r.id)).size, rows.length);
  assert.equal(rows.reduce((n, r) => n + cents(r.amount), 0), input.reduce((n, r) => n + cents(r.amount), 0));
  assert.equal(rows.reduce((n, r) => n + cents(r.bisuiteAmount), 0), available.reduce((n, r) => n + cents(r.amount), 0));
  return { providerCount: input.length, bisuiteCount: available.length, states };
}
const inRange = (date: string) => date.slice(0, 10) >= from && date.slice(0, 10) <= to;
const result = {
  source: snapshot ? "snapshot-pseudonymized" : "database-read-only",
  requestedPeriod: { from, to },
  workbookPeriod: { from: days[0], to: days.at(-1) },
  workbookSourceRows: provider.reduce((n, r) => n + r.rowCount, 0),
  salesInSnapshot: sales.length,
  candidatesWithoutPhone: candidates.filter(s => !s.phones.length).length,
  outsideRequestedPeriod: {
    count: provider.filter(r => !inRange(r.date)).length,
    amountCents: provider.filter(r => !inRange(r.date)).reduce((n, r) => n + cents(r.amount), 0),
  },
  entireWorkbook: summary(provider, candidates.filter(s => s.date >= days[0] && s.date <= days.at(-1)!)),
  requestedPeriodOnly: summary(provider.filter(r => inRange(r.date)), candidates.filter(s => inRange(s.date))),
  byDay: [...new Set(days)].map(day => ({
    day, ...summary(provider.filter(r => r.date.startsWith(day)), candidates.filter(s => s.date === day)),
  })),
};
if (snapshot?.expected) {
  assert.deepEqual(result.entireWorkbook, snapshot.expected.entireWorkbook);
  if (from === snapshot.expected.requestedPeriod.from && to === snapshot.expected.requestedPeriod.to) {
    assert.deepEqual(result.requestedPeriodOnly, snapshot.expected.requestedPeriodOnly);
  }
}
console.log(JSON.stringify(result, null, 2));

const fixture = option("--fixture");
if (fixture) {
  const phones = new Map<string, string>();
  const pseudonym = (phone: string) => {
    if (!phones.has(phone)) phones.set(phone, String(7000000000 + phones.size));
    return phones.get(phone)!;
  };
  const anonymizedProvider = provider.map((r, i) => ({
    ...r, id: `KEY-${i + 1}`, transactionId: `KEY-${i + 1}`,
    phone: pseudonym(r.phone), temporaryPhone: "",
    phoneCandidates: r.phoneCandidates.map(pseudonym),
    customer: "", dealerCode: "ORDER-ANON", pointId: "POS-ANON",
  }));
  const anonymizedSales = sales.filter(s => s.rawData.articoli.length).map((s, i) => ({
    id: `sale-${i + 1}`, bisuiteId: i + 1, dataVendita: s.dataVendita,
    codicePos: "POS-ANON", nomeNegozio: "", nomeCliente: "", stato: s.stato,
    rawData: { articoli: s.rawData.articoli.map((a: any) => {
      const details = a.dettaglio;
      // Proiezione esplicita: mai copiare i campi testo originali.
      const info: Record<string, string> = {};
      for (let k = 1; k <= 5; k++) {
        const value = details?.[`venditaInfo${k}`];
        if (typeof value !== "string" || !value) continue;
        assert(/^NUMERO TELEFONO:\s*\d{10}$/i.test(value), "Formato fixture non previsto; proiezione interrotta.");
        info[`venditaInfo${k}`] = `NUMERO TELEFONO: ${pseudonym(normalizeRechargePhone(value))}`;
      }
      return { categoria: { nome: "RICARICHE" }, dettaglio: {
        prezzo: details?.prezzo, domandeRisposte: [], ...info,
      } };
    }) },
  }));
  // Verifica che la pseudonimizzazione non alteri i conteggi o gli importi.
  assert.deepEqual(summary(anonymizedProvider, extractRechargeSales(anonymizedSales, { splitArticles: true })), result.entireWorkbook);
  await writeFile(fixture, JSON.stringify({
    description: "CMS 9–12 ottobre 2026: proiezione pseudonimizzata, telefoni sintetici 700…; nessun dato cliente originale.",
    providerRows: anonymizedProvider, sales: anonymizedSales, expected: result,
  }, null, 2) + "\n");
}
