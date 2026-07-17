// Test PURI della Gara SOS Caring (Task #327): parsing dell'Excel caring
// PDV, aggregazione per Ragione Sociale / totale rete e fasce premio/malus
// sulla % Balance RS (shared/sosCaring.ts). NON serve né dev server né DB.
// Run: node --import tsx tests/sos-caring.test.mjs
import assert from "node:assert/strict";
import {
  SOS_CARING_REQUIRED_HEADERS,
  validateSosCaringHeaders,
  parseSosCaringRows,
  parseSosNumber,
  normalizeSosPosCode,
  parseSosPercent,
  aggregateSosCaring,
  computeBalancePct,
  computeSosCaringPremio,
  DEFAULT_SOS_CARING_PREMIO_CONFIG,
  formatAnnoMese,
} from "../shared/sosCaring.ts";

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

// Header come nel template reale (con colonne extra non richieste).
const HEADER = [
  "AnnoMese", "DVA", "Cod_GaraLettera", "Canale", "Cod_PdV_Panel", "AM",
  "RagioneSociale", "AllarmiStorici", "AllarmiActual", "Allarmi_MTD",
  "%_Check_Allarmi_Actual_su_MTD", "MNP_Out_su_LineeAllarmate",
  "MNP_Out_Micro_su_LineeAllarmate___Di_cui", "%_Churn", "GA_Gara",
  "CambiPiano_TIED", "CambiPiano_TIED_Di_cui_Micro", "%_Balance_Actual",
  "%_Balance_Forecast", "LeveMax", "%_Leve_Utilizzate",
  "Leve_SOS_Caring_Actual", "PercentualePR",
];

const row = (over = {}) => {
  const base = {
    annoMese: "202607", canale: "FR", codicePos: "9001426892",
    rs: "C.M.S. SRL", allarmi: 1204, mnpOut: 6, mnpOutMicro: 0,
    gaGara: 40, cpTied: 22, cpTiedMicro: 0,
    balA: 0.0967741935, balF: 0.1204629246, leveMax: 130,
    levePct: 0.0153846154, leveSos: 2,
  };
  const v = { ...base, ...over };
  return [
    v.annoMese, "MASCAGNI", "800000", v.canale, v.codicePos, "AM",
    v.rs, 1598, v.allarmi, 769.6, 0.49, v.mnpOut, v.mnpOutMicro, 0.005,
    v.gaGara, v.cpTied, v.cpTiedMicro, v.balA, v.balF, v.leveMax,
    v.levePct, v.leveSos, "",
  ];
};

// --- Header / parsing -------------------------------------------------------

test("validateSosCaringHeaders: header completo ok, colonne extra ignorate", () => {
  assert.deepEqual(validateSosCaringHeaders(HEADER), { ok: true, missing: [] });
});

test("validateSosCaringHeaders: segnala le colonne mancanti", () => {
  const partial = HEADER.filter((h) => h !== "GA_Gara" && h !== "%_Balance_Actual");
  const res = validateSosCaringHeaders(partial);
  assert.equal(res.ok, false);
  assert.deepEqual(res.missing, ["GA_Gara", "%_Balance_Actual"]);
});

test("parseSosCaringRows: normalizza righe, percentuali frazione→%, periodo", () => {
  const { rows, skipped, annoMese } = parseSosCaringRows([HEADER, row()]);
  assert.equal(skipped, 0);
  assert.equal(annoMese, "202607");
  assert.equal(rows.length, 1);
  const r = rows[0];
  assert.equal(r.codicePos, "9001426892");
  assert.equal(r.ragioneSociale, "C.M.S. SRL");
  assert.equal(r.canale, "FR");
  assert.equal(r.allarmiActual, 1204);
  assert.equal(r.gaGara, 40);
  assert.equal(r.cambiPianoTied, 22);
  assert.ok(Math.abs(r.balanceActualPct - 9.67741935) < 1e-6);
  assert.ok(Math.abs(r.balanceForecastPct - 12.04629246) < 1e-6);
  assert.ok(Math.abs(r.leveUtilizzatePct - 1.53846154) < 1e-6);
  assert.equal(r.leveSosActual, 2);
});

test("parseSosCaringRows: scarta righe senza PDV/RS, ignora righe vuote", () => {
  const { rows, skipped } = parseSosCaringRows([
    HEADER,
    row(),
    row({ codicePos: "" }),           // scartata (conta come skipped)
    ["", "", "", "", "", "", ""],      // vuota: ignorata senza skipped
    row({ rs: "" }),                   // scartata
  ]);
  assert.equal(rows.length, 1);
  assert.equal(skipped, 2);
});

test("parseSosNumber / parseSosPercent: tolleranza formati", () => {
  assert.equal(parseSosNumber("1.204"), 1204);
  assert.equal(parseSosNumber(""), 0);
  assert.equal(parseSosNumber("x"), 0);
  assert.ok(Math.abs(parseSosPercent(0.5) - 50) < 1e-9);   // frazione
  assert.ok(Math.abs(parseSosPercent(9.7) - 9.7) < 1e-9);  // già in punti %
  assert.ok(Math.abs(parseSosPercent("12,5%") - 12.5) < 1e-9);
  assert.equal(parseSosPercent(""), 0);
});

// --- Normalizzazione codici POS (Task #329) ---------------------------------

test("normalizeSosPosCode: trim, zeri iniziali, numeri Excel, casi limite", () => {
  assert.equal(normalizeSosPosCode("01234 "), "1234");
  assert.equal(normalizeSosPosCode(" 1234"), "1234");
  assert.equal(normalizeSosPosCode("0001234"), "1234");
  assert.equal(normalizeSosPosCode(1234), "1234");        // numero Excel
  assert.equal(normalizeSosPosCode("9001426892"), "9001426892");
  assert.equal(normalizeSosPosCode("000"), "0");          // tutto zeri
  assert.equal(normalizeSosPosCode("0"), "0");
  assert.equal(normalizeSosPosCode(" ab12 "), "AB12");    // non numerico: trim+upper
  assert.equal(normalizeSosPosCode(""), "");
  assert.equal(normalizeSosPosCode(null), "");
  assert.equal(normalizeSosPosCode(undefined), "");
});

test("normalizeSosPosCode: '01234 ' e '1234' matchano dopo la normalizzazione", () => {
  assert.equal(normalizeSosPosCode("01234 "), normalizeSosPosCode("1234"));
});

test("parseSosCaringRows: codicePos normalizzato al parsing (zeri iniziali/spazi)", () => {
  const { rows } = parseSosCaringRows([
    HEADER,
    row({ codicePos: "01234 " }),
    row({ codicePos: 567 }),
  ]);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].codicePos, "1234");
  assert.equal(rows[1].codicePos, "567");
});

test("parseSosCaringRows: codice PDV di soli zeri non viene scartato", () => {
  const { rows, skipped } = parseSosCaringRows([HEADER, row({ codicePos: "000" })]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].codicePos, "0");
  assert.equal(skipped, 0);
});

// --- Aggregazione RS / rete --------------------------------------------------

test("aggregateSosCaring: subtotali RS e totale rete con % Balance aggregata", () => {
  const matrix = [
    HEADER,
    row({ codicePos: "A1", rs: "C.M.S. SRL", mnpOut: 6, gaGara: 40, cpTied: 22 }),
    row({ codicePos: "A2", rs: "C.M.S. SRL", mnpOut: 10, gaGara: 37, cpTied: 15 }),
    row({ codicePos: "B1", rs: "CMS EVOLUTION SRL", mnpOut: 4, gaGara: 31, cpTied: 20 }),
  ];
  const { rows } = parseSosCaringRows(matrix);
  const agg = aggregateSosCaring(rows);
  assert.equal(agg.perRS.length, 2);
  const cms = agg.perRS[0];
  assert.equal(cms.ragioneSociale, "C.M.S. SRL");
  assert.equal(cms.totals.pdvCount, 2);
  assert.equal(cms.totals.mnpOut, 16);
  assert.equal(cms.totals.gaGara, 77);
  assert.equal(cms.totals.cambiPianoTied, 37);
  // % Balance RS = 16 / (77+37) = 14,035%
  assert.ok(Math.abs(cms.totals.balancePct - (16 / 114) * 100) < 1e-9);
  // Totale rete
  assert.equal(agg.totaleRete.pdvCount, 3);
  assert.equal(agg.totaleRete.mnpOut, 20);
  assert.ok(Math.abs(agg.totaleRete.balancePct - (20 / 165) * 100) < 1e-9);
});

test("aggregateSosCaring: RS deduplicata case-insensitive, denominatore 0 => 0%", () => {
  const { rows } = parseSosCaringRows([
    HEADER,
    row({ codicePos: "A1", rs: "Alfa Srl", mnpOut: 5, gaGara: 0, cpTied: 0 }),
    row({ codicePos: "A2", rs: "ALFA SRL", mnpOut: 3, gaGara: 0, cpTied: 0 }),
  ]);
  const agg = aggregateSosCaring(rows);
  assert.equal(agg.perRS.length, 1);
  assert.equal(agg.perRS[0].totals.balancePct, 0);
  assert.equal(computeBalancePct(10, 0, 0), 0);
});

// --- Fasce premio / malus ----------------------------------------------------

const premio = (balancePct, over = {}) =>
  computeSosCaringPremio({ balancePct, premioPartnership: 1000, negoziInGara: 13, ...over });

test("fascia < 10%: +30% del premio partnership", () => {
  const r = premio(9.99);
  assert.equal(r.fascia, "bonus1");
  assert.equal(r.bonusPct, 30);
  assert.equal(r.importo, 300);
});

test("confine 10%: cade nella fascia 10–20% (+20%)", () => {
  const r = premio(10);
  assert.equal(r.fascia, "bonus2");
  assert.equal(r.bonusPct, 20);
  assert.equal(r.importo, 200);
});

test("confine 20%: cade nella fascia 20–30% (+10%)", () => {
  const r19 = premio(19.999);
  assert.equal(r19.fascia, "bonus2");
  const r20 = premio(20);
  assert.equal(r20.fascia, "bonus3");
  assert.equal(r20.bonusPct, 10);
  assert.equal(r20.importo, 100);
});

test("confine 30%: incluso nella fascia +10%, oltre scatta il malus", () => {
  const r30 = premio(30);
  assert.equal(r30.fascia, "bonus3");
  assert.equal(r30.importo, 100);
  const r301 = premio(30.01);
  assert.equal(r301.fascia, "malus");
  assert.equal(r301.bonusPct, 0);
  assert.equal(r301.importo, -(500 * 13));
});

test("malus = malusPerNegozio × negozi in gara (mai positivo)", () => {
  const r = premio(45, { negoziInGara: 4 });
  assert.equal(r.importo, -2000);
  const r0 = premio(45, { negoziInGara: 0 });
  assert.equal(r0.importo, -0);
});

test("config override: soglie e importi personalizzati", () => {
  const r = computeSosCaringPremio({
    balancePct: 14,
    premioPartnership: 2000,
    negoziInGara: 2,
    config: { soglia1: 15, bonus1Pct: 50 },
  });
  assert.equal(r.fascia, "bonus1"); // 14 < 15
  assert.equal(r.importo, 1000);
  const m = computeSosCaringPremio({
    balancePct: 26,
    premioPartnership: 2000,
    negoziInGara: 2,
    config: { soglia3: 25, malusPerNegozio: 800 },
  });
  assert.equal(m.fascia, "malus");
  assert.equal(m.importo, -1600);
});

test("default config: 10/20/30 e 30/20/10% + 500€", () => {
  const c = DEFAULT_SOS_CARING_PREMIO_CONFIG;
  assert.deepEqual(
    [c.soglia1, c.soglia2, c.soglia3, c.bonus1Pct, c.bonus2Pct, c.bonus3Pct, c.malusPerNegozio],
    [10, 20, 30, 30, 20, 10, 500],
  );
});

test("formatAnnoMese: 202607 => Luglio 2026, invalidi => vuoto", () => {
  assert.equal(formatAnnoMese("202607"), "Luglio 2026");
  assert.equal(formatAnnoMese("202613"), "");
  assert.equal(formatAnnoMese(null), "");
});

console.log(`\n${passed} test passati.`);
