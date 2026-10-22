import { test } from "node:test";
import assert from "node:assert/strict";
import * as XLSX from "xlsx";
import { buildGettoneJourneys, filterGettoneByInsertDate, CJ_NO_DESTINATION_FILTER_VALUE } from "../shared/customerJourney.ts";
import { reconcileCjMobile, CJ_SIM_REASONS, matchesDiagnosticFilters } from "../shared/customerJourneyDiagnostics.ts";
import { CJ_DIAGNOSTICS_PAYMENT_WARNING } from "../shared/customerJourneyDiagnosticsExport.ts";
import { buildCjDiagnosticsWorkbook } from "../client/src/lib/customerJourneyDiagnosticsExport.ts";

const filters = { typeFilter: "tutti", pdvFilter: [], addettoFilter: "tutti", stateFilter: "tutti", search: "" };
const from = "2026-07-01", to = "2026-07-31";
const row = (id, changes = {}) => ({
  itemId: String(id), journeyId: "j", customerKey: "CF", cliente: "Cliente",
  customerType: "privato", pdv: "Roma", addetto: "Mario", driver: "mobile", state: "inserito",
  economicState: null, categoria: "UNTIED", tipologia: "VOCE", descrizione: "SIM voce",
  bisuiteSaleId: `s${id}`, bisuiteArticleId: id, codiceContratto: `000${id}`,
  iccid: "89000000000000000001",
  ...(changes.driver === "telefono" ? { categoria: "TELEFONIA", tipologia: "SMARTPHONE", bisuiteSaleId: "s1" } : {}),
  openedAt: "2026-07-02", insertedAt: "2026-07-02", eventDate: "2026-07-02", valore: 0,
  ...changes,
});
const source = (id, changes = {}) => ({
  saleId: `s${id}`, bisuiteId: id, articleId: id, categoria: "UNTIED",
  tipologia: "VOCE", descrizione: "SIM voce", insertedAt: "2026-07-02",
  customerKey: "CF", customerType: "privato", cliente: "Cliente", pdv: "Roma", addetto: "Mario",
  cancelled: false, contract: `000${id}`, ...changes,
});

test("diagnostic destination filters use the effective sale destination, never the manual CJ value", () => {
  const linked = row(1, {
    pdvOrigine: "Origine A",
    pdvDestinazione: "Manuale CJ",
    pdvDestinazioneEffettiva: "Destinazione reale",
  });
  assert.equal(matchesDiagnosticFilters(linked, {
    ...filters,
    pdvDestinazioneFilter: ["Destinazione reale"],
  }), true);
  assert.equal(matchesDiagnosticFilters(linked, {
    ...filters,
    pdvDestinazioneFilter: ["Manuale CJ"],
  }), false);
  assert.equal(matchesDiagnosticFilters(row(2, {
    pdvOrigine: "Origine B",
    pdvDestinazione: "Manuale CJ",
  }), {
    ...filters,
    pdvDestinazioneFilter: [CJ_NO_DESTINATION_FILTER_VALUE],
  }), true);
});
function exported(sources, rows, f = filters, start = from, end = to, selection) {
  const selected = selection ?? filterGettoneByInsertDate(buildGettoneJourneys(rows), start, end);
  const d = reconcileCjMobile(sources, rows, selected, f, start, end);
  // Test the actual file format, not just the input objects; no server, DB or browser.
  const bytes = XLSX.write(buildCjDiagnosticsWorkbook(d, f, start, end), { type: "buffer", bookType: "xlsx" });
  const wb = XLSX.read(bytes, { type: "buffer" });
  const sheets = Object.fromEntries(wb.SheetNames.map(name =>
    [name, XLSX.utils.sheet_to_json(wb.Sheets[name], { defval: "" })]));
  const summary = Object.fromEntries(sheets.Riepilogo.map(r => [r.Voce, r.Valore]));
  return { d, wb, bytes, sheets, summary };
}

test("actual XLSX contains summary, exclusive exclusions, articles, contracts and customer gettoni", () => {
  const sources = [
    source(1), source(2, { tipologia: "DATI" }), source(3, { descrizione: "TOURIST" }),
    source(4, { tipologia: "ALTRE GA NON TURISTICHE" }), source(5, { cancelled: true, descrizione: "TOURIST" }),
    source(6, { customerKey: "" }), source(7),
    source(8), source(9), source(10), source(11),
    source(12, { categoria: "NON MOBILE" }),
  ];
  const rows = [row(1), row(8, { economicState: "stornato" }), row(9, { state: "ko" }),
    row(10, { eventDate: "2027-02-01" }),
    row(11, { journeyId: "old", openedAt: "2026-06-01" }),
  ];
  const { d, wb, sheets, summary } = exported(sources, rows, filters, from, to, buildGettoneJourneys([row(1)]));
  assert.deepEqual(wb.SheetNames, ["Riepilogo", "Articoli BiSuite", "Contratti SIM CJ", "Gettoni per cliente"]);
  assert.equal(sheets["Articoli BiSuite"].length, d.sourceTotal);
  assert.equal(d.sourceTotal, 12);
  for (const [reason, label] of Object.entries(CJ_SIM_REASONS)) {
    assert.equal(summary[label], 1, reason);
    assert.equal(sheets["Articoli BiSuite"].filter(r => r["Codice motivo esclusivo"] === reason).length, 1, reason);
  }
  assert.equal(summary["Discrepanza SIM CJ nel periodo − articoli ammessi BiSuite"], d.discrepancy);
  assert.equal(sheets["Articoli BiSuite"][0].Contratto, "0001", "leading zeros remain text");
  assert.equal(wb.Sheets["Articoli BiSuite"].N2.t, "s");
  assert.equal(sheets["Articoli BiSuite"].find(r => r["Codice motivo esclusivo"] === "unlinked")["Esito DRMS"], "Non disponibile");
  assert.equal(summary.Avvertenza, CJ_DIAGNOSTICS_PAYMENT_WARNING);
});

test("period, subsequent, cumulative T0–T5 and missing-source discrepancy survive XLSX round trip", () => {
  const rows = [row(1), row(2, { insertedAt: "2026-08-01", eventDate: "2026-08-01" }),
    row(3, { insertedAt: "2026-12-31", eventDate: "2026-12-31" }),
    row(4, { insertedAt: "2027-01-01", eventDate: "2027-01-01" }),
    row(5, { insertedAt: null }), row(6, { insertedAt: "2026-06-30", eventDate: "2026-07-01" })];
  const { summary, sheets } = exported([], rows, filters, from, to, buildGettoneJourneys([row(1)]));
  assert.equal(summary["SIM valide nel periodo"], 1);
  assert.equal(summary["SIM successive (dopo il «al»)"], 2);
  assert.equal(summary["Altre SIM cumulative (precedenti o senza data)"], 2);
  assert.equal(summary["SIM valide cumulative T0–T5"], 5);
  assert.equal(summary["Discrepanza SIM CJ nel periodo − articoli ammessi BiSuite"], 1);
  assert.deepEqual(sheets["Contratti SIM CJ"].map(r => r["Periodo inserimento"]),
    ["Nel periodo", "Successiva", "Successiva", "Precedente o senza data", "Precedente o senza data"]);
  assert.ok(!sheets["Contratti SIM CJ"].some(r => r.Contratto === "0004"), "T6 is outside the exported CJ perimeter");
});

test("DRMS, manual override/reset and confirmed checkbox are separate from presumed smartphone gettone", () => {
  const rows = [
    row(1, { drmsOutcomeState: "pagato", economicState: "pagato" }),
    row(2, { drmsOutcomeState: "stornato", economicState: "pagato", economicStateManual: true }),
    row(3, { drmsOutcomeState: "pagato", economicState: "annullato", economicStateManual: true }),
    row(4, { drmsOutcomeState: "riaccreditato", economicState: null, economicStateManual: true }),
    row(5, { gettoneConfirmed: true }),
    row(6, { driver: "fisso", economicState: "pagato" }), row(7, { driver: "telefono" }),
  ];
  const { sheets, summary, wb } = exported([source(1)], rows);
  const contracts = sheets["Contratti SIM CJ"];
  assert.equal(contracts[1]["Esito DRMS"], "Stornato");
  assert.equal(contracts[1]["Stato economico utilizzato"], "Pagato");
  assert.equal(contracts[1]["Origine stato utilizzato"], "Manuale");
  assert.equal(contracts[1]["Discrepanza manuale / DRMS"], "Sì");
  assert.equal(contracts[2]["Contribuisce alle SIM valide cumulative"], "No");
  assert.equal(contracts[3]["Stato economico utilizzato"], "—");
  assert.equal(contracts[4]["Spunta manuale gettone confermato"], "Sì");
  assert.equal(summary["Azzeramenti manuali"], 1);
  assert.equal(summary["SIM con spunta manuale gettone confermato"], 1);
  assert.match(summary["DRMS e manuale"], /non da sommare/);
  const j = sheets["Gettoni per cliente"][0];
  assert.equal(j["Gettone esiti positivi (EUR)"], 20);
  assert.equal(j["Gettone inclusi smartphone presunti (EUR)"], 30);
  assert.equal(j["Incremento presunto (EUR)"], 10);
  assert.equal(wb.Sheets["Gettoni per cliente"].C2.t, "n");
  assert.equal(j.Avvertenza, CJ_DIAGNOSTICS_PAYMENT_WARNING);
});

test("every active filter is recorded and respected; export never fetches or widens authorized inputs", () => {
  const rows = [row(1), row(2, { cliente: "Riservato", addetto: "Luigi", journeyId: "other" })];
  const sources = [source(1), source(2, { cliente: "Riservato", addetto: "Luigi" })];
  for (const f of [
    { ...filters, addettoFilter: "Mario" }, { ...filters, pdvFilter: ["Milano"] },
    { ...filters, typeFilter: "azienda" }, { ...filters, stateFilter: "pagato" },
    { ...filters, search: "Nessun risultato" },
  ]) {
    const { sheets, summary } = exported(sources, rows, f, from, to, buildGettoneJourneys([row(1)]));
    assert.equal(summary.Addetto, f.addettoFilter);
    assert.equal(summary.PDV, f.pdvFilter.join(" · ") || "Tutti");
    assert.equal(summary["Tipo cliente"], f.typeFilter);
    assert.equal(summary.Stato, f.stateFilter);
    assert.equal(summary.Ricerca, f.search);
    assert.ok(!JSON.stringify(sheets).includes("Riservato"));
    if (f.addettoFilter !== "Mario") {
      assert.equal(sheets["Articoli BiSuite"].length, 0);
      assert.equal(sheets["Contratti SIM CJ"].length, 0);
    }
  }
  const empty = exported([], [], filters);
  assert.equal(empty.summary["Clienti distinti"], 0);
  assert.ok(Object.values(empty.sheets).slice(1).every(sheet => sheet.length === 0));
  for (const name of empty.wb.SheetNames.slice(1)) assert.ok(empty.wb.Sheets[name]["!ref"], "empty detail retains headers");
});

test("diagnostic XLSX records active origin, destination and company filters, but omits them when unset", () => {
  const active = exported([], [], {
    ...filters,
    pdvOrigineFilter: ["Roma"],
    pdvDestinazioneFilter: [CJ_NO_DESTINATION_FILTER_VALUE, "Torino"],
    ragioneSocialeFilter: "Acme",
  });
  assert.equal(active.summary["PDV origine"], "Roma");
  assert.equal(active.summary["PDV destinazione effettiva"], "Senza destinazione · Torino");
  assert.equal(active.summary["Ragione sociale"], "Acme");

  const unset = exported([], [], filters);
  assert.ok(!Object.hasOwn(unset.summary, "PDV origine"));
  assert.ok(!Object.hasOwn(unset.summary, "PDV destinazione effettiva"));
  assert.ok(!Object.hasOwn(unset.summary, "Ragione sociale"));
});

test("open date range exports explicit instructions and text stays text, never an Excel formula", () => {
  const { summary, wb, sheets } = exported([source(1, { cliente: "=HYPERLINK(\"bad\")" })],
    [row(1)], filters, "", "");
  assert.equal(summary["Dal (inserimento prima SIM valida)"], "Senza limite");
  assert.equal(summary["Al (inserimento prima SIM valida)"], "Senza limite");
  assert.match(summary["Distinzione successive"], /Imposta la data/);
  assert.equal(wb.Sheets["Articoli BiSuite"].E2.t, "s");
  assert.equal(wb.Sheets["Articoli BiSuite"].E2.f, undefined);
  assert.equal(sheets["Articoli BiSuite"][0].Cliente, '=HYPERLINK("bad")');
});
