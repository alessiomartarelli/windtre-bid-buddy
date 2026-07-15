// Test PURI del modulo Gestione DTS (Task #321): parsing dell'Excel dei
// lead drive-to-store e aggregazioni del report di incidenza
// (shared/dtsReport.ts). NON serve né dev server né DB.
// Run: node --import tsx tests/dts-report.test.mjs
import assert from "node:assert/strict";
import {
  DTS_REQUIRED_HEADERS,
  normalizeConsulente,
  parseDtsDate,
  parseIdVendita,
  dtsLeadKey,
  validateDtsHeaders,
  parseDtsRows,
  mergeDtsLeads,
  filterDtsLeads,
  aggregateDtsReport,
  dtsSaleCodiceEsterno,
  dtsAvailableMonths,
  dtsMonthLabel,
} from "../shared/dtsReport.ts";
import { buildVenditeReportHtml } from "../shared/venditeReportHtml.ts";
import { aggregateDailyReport } from "../shared/venditeReport.ts";

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    console.error(`  ✗ ${name}`);
    console.error(e);
    process.exit(1);
  }
}

// --- Parsing --------------------------------------------------------------

test("normalizeConsulente rimuove estensione e spazi", () => {
  assert.equal(normalizeConsulente("DALIA BOLES.csv"), "DALIA BOLES");
  assert.equal(normalizeConsulente("  MARIO   ROSSI.XLSX "), "MARIO ROSSI");
  assert.equal(normalizeConsulente(null), "");
});

test("parseDtsDate: gg/mm/aaaa, ISO, seriale Excel, invalidi", () => {
  assert.equal(parseDtsDate("05/07/2026"), "2026-07-05");
  assert.equal(parseDtsDate("5/7/2026"), "2026-07-05");
  assert.equal(parseDtsDate("2026-07-05"), "2026-07-05");
  // Seriale Excel: 46208 = 2026-07-05 (epoca 1899-12-30).
  assert.equal(parseDtsDate(46208), "2026-07-05");
  assert.equal(parseDtsDate(""), null);
  assert.equal(parseDtsDate("boh"), null);
  assert.equal(parseDtsDate("32/13/2026"), null);
});

test("parseIdVendita: numeri, stringhe, vuoti", () => {
  assert.equal(parseIdVendita(12345), 12345);
  assert.equal(parseIdVendita("12345"), 12345);
  assert.equal(parseIdVendita(""), null);
  assert.equal(parseIdVendita(null), null);
  assert.equal(parseIdVendita("abc"), null);
  assert.equal(parseIdVendita(0), null);
});

test("dtsLeadKey stabile: telefono > CF, nominativo sempre incluso, insensibile a case", () => {
  const a = dtsLeadKey({ data: "2026-07-05", telefono: "333 123", codiceFiscale: "X", nominativo: "Mario  Rossi", campagna: "CAMP" });
  const b = dtsLeadKey({ data: "2026-07-05", telefono: "333  123", codiceFiscale: "", nominativo: "MARIO ROSSI", campagna: "camp" });
  assert.equal(a, b);
  const c = dtsLeadKey({ data: "2026-07-05", telefono: "", codiceFiscale: "RSSMRA", nominativo: "MARIO ROSSI", campagna: "CAMP" });
  assert.notEqual(a, c);
  // Task #324: stesso telefono/data/campagna ma nominativo diverso ⇒ chiavi
  // diverse (lead distinti, es. coniugi con lo stesso numero).
  const d = dtsLeadKey({ data: "2026-07-05", telefono: "333 123", codiceFiscale: "", nominativo: "LUCIA VERDI", campagna: "CAMP" });
  assert.notEqual(a, d);
});

test("validateDtsHeaders: ok con tutte le colonne, missing elencate", () => {
  assert.equal(validateDtsHeaders([...DTS_REQUIRED_HEADERS]).ok, true);
  const v = validateDtsHeaders(["Source.Name", "CAMPAGNA"]);
  assert.equal(v.ok, false);
  assert.ok(v.missing.includes("ID VENDITA"));
});

const HEADERS = [...DTS_REQUIRED_HEADERS];
function row({ src = "ANNA.csv", camp = "W3", nom = "", email = "", cf = "", tel = "", inCarico = "", stato = "FISSATO", data = "05/07/2026", id = "", addetto = "", origine = "FB" } = {}) {
  return [src, camp, nom, email, cf, tel, inCarico, stato, data, id, addetto, origine];
}

test("parseDtsRows: scarta righe vuote/anonime, dedup per chiave, ID VENDITA non perso", () => {
  const matrix = [
    HEADERS,
    row({ nom: "MARIO ROSSI", tel: "333111", id: 100 }),
    row({ nom: "LUIGI BIANCHI", tel: "333222" }),
    [], // vuota
    row({ nom: "", tel: "", cf: "" }), // anonima
    // Duplicato di MARIO (stessa chiave), senza ID: l'ID 100 non si perde.
    row({ nom: "MARIO ROSSI", tel: "333111", stato: "RICHIAMARE" }),
  ];
  const { leads, skipped } = parseDtsRows(matrix);
  assert.equal(skipped, 2);
  assert.equal(leads.length, 2);
  const mario = leads.find((l) => l.telefono === "333111");
  assert.equal(mario.idVendita, 100);
  assert.equal(mario.stato, "RICHIAMARE"); // vince l'ultima riga
  assert.equal(mario.consulente, "ANNA");
  assert.equal(mario.data, "2026-07-05");
});

test("mergeDtsLeads: re-upload aggiorna lo stato ma non perde l'ID vendita", () => {
  const { leads: v1 } = parseDtsRows([HEADERS, row({ nom: "A", tel: "1", id: 55 })]);
  const { leads: v2 } = parseDtsRows([HEADERS, row({ nom: "A", tel: "1", stato: "NO SHOW" })]);
  const merged = mergeDtsLeads(v1, v2);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].idVendita, 55);
  assert.equal(merged[0].stato, "NO SHOW");
});

// --- Filtri e aggregazioni -------------------------------------------------

const LEADS = parseDtsRows([
  HEADERS,
  row({ src: "ANNA.csv", nom: "M1", tel: "1", data: "05/07/2026", id: 10 }),
  row({ src: "ANNA.csv", nom: "M2", tel: "2", data: "06/07/2026", id: 20 }),
  row({ src: "ANNA.csv", nom: "M3", tel: "3", data: "07/07/2026" }),
  row({ src: "BRUNO.csv", nom: "M4", tel: "4", data: "05/07/2026", id: 99 }), // vendita inesistente
  row({ src: "BRUNO.csv", nom: "M5", tel: "5", data: "05/06/2026", id: 30 }), // mese prima
]).leads;

// Task #324: il match usa il CODICE ESTERNO (rawData.codiceEsterno / campo
// codiceEsterno), NON il bisuiteId interno. I bisuiteId qui sono volutamente
// grandi (~1.1M come in prod) per accorgersi di regressioni sul campo usato.
function sale(codiceEsterno, { stato = "OK", pos = "P1", neg = "Negozio 1", raw = undefined } = {}) {
  return {
    bisuiteId: 1_100_000 + codiceEsterno,
    codiceEsterno,
    stato,
    codicePos: pos,
    nomeNegozio: neg,
    rawData: raw === undefined ? { codiceEsterno: String(codiceEsterno) } : raw,
  };
}

const SALES = [
  sale(10),
  sale(20, { pos: "P2", neg: "Negozio 2" }),
  sale(11),
  sale(12, { pos: "P2", neg: "Negozio 2" }),
  sale(30, { stato: "ANNULLATA" }), // esclusa
];

test("parseDtsRows: lead distinti con stesso telefono/data/campagna NON collassano (Task #324)", () => {
  const matrix = [
    HEADERS,
    row({ nom: "MARIO ROSSI", tel: "3937577885", data: "09/07/2026", id: 250838 }),
    row({ nom: "LUCIA VERDI", tel: "3937577885", data: "09/07/2026", id: 250839 }),
  ];
  const { leads } = parseDtsRows(matrix);
  assert.equal(leads.length, 2);
  assert.deepEqual(leads.map((l) => l.idVendita).sort(), [250838, 250839]);
});

test("parseDtsRows: stessa persona con DUE ID VENDITA diversi = due lead (Task #324)", () => {
  // Caso reale: doppio acquisto lo stesso giorno (250838 MANUALE + 250839 CSV).
  const matrix = [
    HEADERS,
    row({ nom: "EUSEPI RICCARDO", tel: "3937577885", data: "09/07/2026", id: 250838 }),
    row({ nom: "EUSEPI RICCARDO", tel: "3937577885", data: "09/07/2026", id: 250839 }),
  ];
  const { leads } = parseDtsRows(matrix);
  assert.equal(leads.length, 2);
  assert.deepEqual(leads.map((l) => l.idVendita).sort(), [250838, 250839]);
  // Le chiavi restano uniche (vincolo DB) e stabili.
  assert.equal(new Set(leads.map((l) => l.leadKey)).size, 2);
  // Ma la stessa persona SENZA id o con lo stesso id continua a fondersi.
  const dup = parseDtsRows([
    HEADERS,
    row({ nom: "EUSEPI RICCARDO", tel: "3937577885", data: "09/07/2026", id: null }),
    row({ nom: "EUSEPI RICCARDO", tel: "3937577885", data: "09/07/2026", id: 250838 }),
  ]).leads;
  assert.equal(dup.length, 1);
  assert.equal(dup[0].idVendita, 250838);
});

test("dtsSaleCodiceEsterno: precedenza campo esplicito su rawData, null se assente", () => {
  assert.equal(dtsSaleCodiceEsterno({ codiceEsterno: 111, rawData: { codiceEsterno: "222" } }), 111);
  assert.equal(dtsSaleCodiceEsterno({ codiceEsterno: null, rawData: { codiceEsterno: "222" } }), 222);
  assert.equal(dtsSaleCodiceEsterno({ rawData: { codiceEsterno: "222" } }), 222);
  assert.equal(dtsSaleCodiceEsterno({ rawData: {} }), null);
  assert.equal(dtsSaleCodiceEsterno({ rawData: null }), null);
  assert.equal(dtsSaleCodiceEsterno({ rawData: { codiceEsterno: "abc" } }), null);
});

test("aggregateDtsReport: match via codiceEsterno, NON via bisuiteId (Task #324)", () => {
  const leads = parseDtsRows([HEADERS, row({ nom: "X", tel: "9", data: "05/07/2026", id: 250838 })]).leads;
  // codiceEsterno solo in rawData (come dalla tabella bisuite_sales).
  const s = {
    bisuiteId: 1145531,
    stato: "FINALIZZATA IN CASSA",
    codicePos: "P1",
    nomeNegozio: "Negozio 1",
    rawData: { codiceEsterno: "250838" },
  };
  const a = aggregateDtsReport(leads, [s]);
  assert.equal(a.leadConvertiti, 1);
  assert.equal(a.vendite.dts, 1);
  // Un lead con id = bisuiteId NON deve matchare.
  const leads2 = parseDtsRows([HEADERS, row({ nom: "X", tel: "9", data: "05/07/2026", id: 1145531 })]).leads;
  const b = aggregateDtsReport(leads2, [s]);
  assert.equal(b.leadConvertiti, 0);
  // rawData senza codiceEsterno ⇒ vendita non agganciabile, nessun errore.
  const c = aggregateDtsReport(leads, [{ ...s, rawData: {} }]);
  assert.equal(c.leadConvertiti, 0);
});

test("filterDtsLeads: mese e consulente", () => {
  assert.equal(filterDtsLeads(LEADS, { month: "2026-07" }).length, 4);
  assert.equal(filterDtsLeads(LEADS, { month: "2026-07", consulente: "anna" }).length, 3);
  assert.equal(filterDtsLeads(LEADS, null).length, 5);
});

test("aggregateDtsReport: KPI lead e incidenza vendite", () => {
  const leads = filterDtsLeads(LEADS, { month: "2026-07" });
  const a = aggregateDtsReport(leads, SALES);
  assert.equal(a.totaleLead, 4);
  assert.equal(a.leadConIdVendita, 3); // 10, 20, 99
  assert.equal(a.leadConvertiti, 2); // 10 e 20 trovati; 99 no
  assert.equal(a.conversionePct, 50);
  assert.equal(a.vendite.totale, 4); // ANNULLATA esclusa
  assert.equal(a.vendite.dts, 2);
  assert.equal(a.vendite.incidenzaPct, 50);
});

test("aggregateDtsReport: per negozio ordinato e filtro codicePos", () => {
  const leads = filterDtsLeads(LEADS, { month: "2026-07" });
  const a = aggregateDtsReport(leads, SALES);
  assert.equal(a.perNegozio.length, 2);
  assert.deepEqual(a.perNegozio.map((n) => n.codicePos).sort(), ["P1", "P2"]);
  const p1 = aggregateDtsReport(leads, SALES, { codicePos: "P1" });
  assert.equal(p1.vendite.totale, 2);
  assert.equal(p1.vendite.dts, 1);
  assert.equal(p1.leadConvertiti, 1); // solo la 10 è in P1
});

test("aggregateDtsReport: per consulente con tasso", () => {
  const leads = filterDtsLeads(LEADS, { month: "2026-07" });
  const a = aggregateDtsReport(leads, SALES);
  const anna = a.perConsulente.find((c) => c.consulente === "ANNA");
  const bruno = a.perConsulente.find((c) => c.consulente === "BRUNO");
  assert.equal(anna.fissati, 3);
  assert.equal(anna.convertiti, 2);
  assert.equal(anna.tassoPct, 66.7);
  assert.equal(bruno.fissati, 1);
  assert.equal(bruno.convertiti, 0);
  assert.equal(bruno.tassoPct, 0);
  // Ordinati per fissati ↓.
  assert.equal(a.perConsulente[0].consulente, "ANNA");
});

test("aggregateDtsReport: incidenza arrotondata a 1 decimale, null se 0 vendite", () => {
  const a = aggregateDtsReport([], [sale(1), sale(2), sale(3)]);
  assert.equal(a.vendite.incidenzaPct, 0);
  const b = aggregateDtsReport([], []);
  assert.equal(b.vendite.incidenzaPct, null);
  assert.equal(b.conversionePct, null);
});

test("dtsAvailableMonths e dtsMonthLabel", () => {
  assert.deepEqual(dtsAvailableMonths(LEADS), ["2026-07", "2026-06"]);
  assert.equal(dtsMonthLabel("2026-07"), "luglio 2026");
  assert.equal(dtsMonthLabel("boh"), "boh");
});

// --- Sezione DTS nell'allegato HTML Telegram --------------------------------

test("buildVenditeReportHtml: sezione DTS presente nella pagina mese", () => {
  const aggregates = aggregateDailyReport([]);
  const leads = filterDtsLeads(LEADS, { month: "2026-07" });
  const dts = aggregateDtsReport(leads, SALES);
  const html = buildVenditeReportHtml({
    orgName: "Org Test",
    dateYMD: "2026-07-14",
    aggregates,
    month: { label: "luglio", aggregates },
    dts,
  });
  assert.ok(html.includes("Drive to Store"));
  assert.ok(html.includes("DTS fissati"));
  assert.ok(html.includes("Negozio 1"));
  assert.ok(html.includes(".dts-kpis"));
});

test("buildVenditeReportHtml: senza dts la sezione non compare", () => {
  const aggregates = aggregateDailyReport([]);
  const html = buildVenditeReportHtml({
    orgName: "Org Test",
    dateYMD: "2026-07-14",
    aggregates,
    month: { label: "luglio", aggregates },
  });
  assert.ok(!html.includes("Drive to Store"));
});

test("buildVenditeReportHtml: dts vuoto (0 lead, 0 vendite) non compare", () => {
  const aggregates = aggregateDailyReport([]);
  const html = buildVenditeReportHtml({
    orgName: "Org Test",
    dateYMD: "2026-07-14",
    aggregates,
    month: { label: "luglio", aggregates },
    dts: aggregateDtsReport([], []),
  });
  assert.ok(!html.includes("Drive to Store"));
});

console.log(`\n${passed} test passati.`);
