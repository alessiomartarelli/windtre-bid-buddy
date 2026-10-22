import test from "node:test";
import assert from "node:assert/strict";
import * as XLSX from "xlsx";
import {
  extractRechargeSales,
  getRicaricheAnalysisProvidersForBrands,
  normalizeRechargePhone,
  parseVodafoneRechargeWorkbook,
  parseWindTreRechargeWorkbook,
  reconcileRechargeRows,
} from "../shared/ricaricheAnalysis.ts";
import { isModuleAccessible, MODULES, sanitizeGrantableModules } from "../shared/modules.ts";

function workbookBytes(headers, rows) {
  const worksheet = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "IC REPORT 1 - RECHARGES");
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
}

const headers = [
  "Ora di  Ricarica", "Codice Dealer", "Ragione Sociale", "Canale di Vendite SAP",
  "ID Point", "Numero Telefono", "Numero Telefono Temporaneo", "Importo Ricarica",
  "ID Ricarica", "Tipologia Ricarica", "ID Transazione", "Login",
];
const windTreHeaders = [
  "Codice Ordine", "Keycode", "MSISDN", "ICCID", "Taglio ricarica",
  "Tipo ricarica", "Stato", "Data utilizzo", "PDV", "alias",
];

const recharge = (id, date, phone, temporary, amount) => ({
  id, transactionId: id, date, phone, temporaryPhone: temporary,
  phoneCandidates: [phone, temporary].filter(Boolean).map(normalizeRechargePhone),
  amount, customer: "", supplier: "Vodafone Store", dealerCode: "", pointId: "",
  rechargeType: "Ricarica virtuale", rowCount: 1,
});

test("parser VF normalizza data e importi e accorpa i duplicati dello stesso ID", () => {
  const data = workbookBytes(headers, [
    ["30/09/26 23:59:18", "D1", "RS", "Vodafone Store", "-1", "0039 347 111 2233", "3471112233", "€5.00", "VTIC", "Carrello", "TX-1", "'-1"],
    ["30/09/26 23:59:18", "D1", "RS", "Vodafone Store", "-1", "3471112233", "", "€10.00", "VTIC", "Carrello", "TX-1", "'-1"],
    ["01/10/26 08:00:00", "D2", "RS", "Vodafone Store", "-1", "3332221111", "", "€1.234,50", "VTIC", "Carrello", "TX-2", "LOGIN"],
  ]);
  const rows = parseVodafoneRechargeWorkbook(data);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].transactionId, "TX-1");
  assert.equal(rows[0].amount, 15);
  assert.equal(rows[0].rowCount, 2);
  assert.equal(rows[0].phone, "3471112233");
  assert.equal(rows[0].customer, "", "dealer login must not be presented as customer name");
  assert.equal(rows[0].date, "2026-09-30T23:59:18.000Z");
  assert.equal(rows[1].amount, 1234.5);
});

test("parser rejects fogli non-VF e righe valorizzate prive di ID transazione", () => {
  const windtre = workbookBytes(["DATA", "NUMERO", "IMPORTO"], [["30/09/26", "3471112233", "10"]]);
  assert.throws(() => parseVodafoneRechargeWorkbook(windtre), /colonne obbligatorie mancanti.*ID Transazione/i);
  const missingId = workbookBytes(headers, [["30/09/26 10:00:00", "D1", "RS", "VF", "-1", "3471112233", "", "€10", "", "", "", ""]]);
  assert.throws(() => parseVodafoneRechargeWorkbook(missingId), /senza ID Transazione/i);
});

test("parser WindTre usa Keycode come transazione e non accorpa righe per Codice Ordine", () => {
  const data = workbookBytes(windTreHeaders, [
    ["ORD-1", "KEY-1", "0039 347 111 2233", "ICCID-1", 15, "VSC", "BURNED", "2026-10-09", "POS-1", "alias"],
    ["ORD-1", "KEY-1", "3471112233", "ICCID-1", 5, "VSC", "BURNED", "2026-10-09", "POS-1", "alias"],
    ["ORD-1", "KEY-2", "3929170987", "ICCID-2", "€20,00", "SIM ATTIVA", "BURNED", "2026-10-10", "POS-2", "alias"],
  ]);
  const rows = parseWindTreRechargeWorkbook(data);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].transactionId, "KEY-1");
  assert.equal(rows[0].amount, 20);
  assert.equal(rows[0].rowCount, 2);
  assert.equal(rows[0].phone, "3471112233");
  assert.equal(rows[0].dealerCode, "ORD-1");
  assert.equal(rows[0].pointId, "POS-1");
  assert.equal(rows[0].supplier, "WindTre");
  assert.equal(rows[0].rechargeType, "VSC");
  assert.equal(rows[1].transactionId, "KEY-2");
  assert.equal(rows[1].amount, 20);
  assert.equal(rows[1].date, "2026-10-10T00:00:00.000Z");
  assert.equal(rows[1].rechargeType, "SIM ATTIVA");
});

test("parser WindTre rifiuta stati non verificati e formati non riconosciuti", () => {
  const pending = workbookBytes(windTreHeaders, [
    ["ORD-1", "KEY-1", "3471112233", "ICCID-1", 15, "VSC", "RESERVED", "2026-10-09", "POS-1", "alias"],
  ]);
  assert.throws(() => parseWindTreRechargeWorkbook(pending), /Stato WindTre non supportato.*RESERVED/i);
  const notWindTre = workbookBytes(["DATA", "NUMERO", "IMPORTO"], [["2026-10-09", "3471112233", 15]]);
  assert.throws(() => parseWindTreRechargeWorkbook(notWindTre), /colonne obbligatorie mancanti.*Keycode/i);
});

test("provider analisi ricariche segue il brand e conserva il fallback VF per tenant legacy", () => {
  assert.deepEqual(getRicaricheAnalysisProvidersForBrands(["Vodafone"]), ["vodafone_fastweb"]);
  assert.deepEqual(getRicaricheAnalysisProvidersForBrands(["Fastweb"]), ["vodafone_fastweb"]);
  assert.deepEqual(getRicaricheAnalysisProvidersForBrands(["WindTre"]), ["windtre"]);
  assert.deepEqual(getRicaricheAnalysisProvidersForBrands(["Vodafone", "Wind Tre"]), ["vodafone_fastweb", "windtre"]);
  assert.deepEqual(getRicaricheAnalysisProvidersForBrands([]), ["vodafone_fastweb"]);
  assert.deepEqual(getRicaricheAnalysisProvidersForBrands(["Brand sconosciuto"]), []);
});

test("normalizzazione telefonica rimuove prefisso internazionale senza alterare il numero", () => {
  assert.equal(normalizeRechargePhone("+39 (347) 123-4567"), "3471234567");
  assert.equal(normalizeRechargePhone("0039 347 123 4567"), "3471234567");
  assert.equal(normalizeRechargePhone("3471234567"), "3471234567");
});

test("riconciliazione assegna stati e differenza BiSuite meno fornitore con segno corretto", () => {
  const provider = [
    recharge("exact", "2026-09-01T10:00:00.000Z", "3471111111", "", 10),
    recharge("positive", "2026-09-02T10:00:00.000Z", "3472222222", "", 10),
    recharge("negative", "2026-09-03T10:00:00.000Z", "3473333333", "", 12),
    recharge("absent", "2026-09-04T10:00:00.000Z", "3474444444", "", 8),
  ];
  const sales = [
    { saleId: "10", bisuiteId: 10, date: "2026-09-01", pdv: "P1", customer: "Cliente 1", amount: 10, phones: ["3471111111"] },
    { saleId: "20", bisuiteId: 20, date: "2026-09-02", pdv: "P2", customer: "Cliente 2", amount: 13, phones: ["3472222222"] },
    { saleId: "30", bisuiteId: 30, date: "2026-09-03", pdv: "P3", customer: "Cliente 3", amount: 10, phones: ["3473333333"] },
    { saleId: "40", bisuiteId: 40, date: "2026-09-05", pdv: "P4", customer: "Cliente 4", amount: 7, phones: ["3475555555"] },
  ];
  const rows = reconcileRechargeRows(provider, sales);
  const byId = new Map(rows.map((r) => [r.transactionId || r.saleId, r]));
  assert.equal(byId.get("exact").status, "VERIFICATO");
  assert.equal(byId.get("positive").status, "INCONGRUENZA IMPORTO");
  assert.equal(byId.get("positive").difference, 3);
  assert.equal(byId.get("negative").difference, -2);
  assert.equal(byId.get("absent").status, "NON PRESENTE SU BISUITE");
  assert.equal(byId.get("40").status, "NON PRESENTE SU FILE");
});

test("una stessa vendita BiSuite non può verificare due transazioni del report", () => {
  const rows = reconcileRechargeRows([
    recharge("TX-A", "2026-09-01T00:00:00.000Z", "3470000000", "", 10),
    recharge("TX-B", "2026-09-01T00:00:00.000Z", "3470000000", "", 10),
  ], [
    { saleId: "only-sale", bisuiteId: 123, date: "2026-09-01", pdv: "P1", customer: "Cliente", amount: 10, phones: ["3470000000"] },
  ]);
  assert.equal(rows.filter((r) => r.saleId === "only-sale").length, 1);
  assert.equal(rows.filter((r) => r.status === "VERIFICATO").length, 1);
  assert.equal(rows.filter((r) => r.status === "NON PRESENTE SU BISUITE").length, 1);
});

test("riconciliazione WindTre conserva il provider e abbina la singola Keycode alla vendita", () => {
  const providerRows = parseWindTreRechargeWorkbook(workbookBytes(windTreHeaders, [
    ["ORD-1", "KEY-1", "3471112233", "ICCID-1", 15, "VSC", "BURNED", "2026-10-09", "POS-1", "alias"],
    ["ORD-1", "KEY-2", "3472222222", "ICCID-2", 20, "SIM ATTIVA", "BURNED", "2026-10-10", "POS-2", "alias"],
  ]));
  const rows = reconcileRechargeRows(providerRows, [
    { saleId: "w3-sale", bisuiteId: 9001, date: "2026-10-09", pdv: "POS-1", customer: "Cliente W3", amount: 15, phones: ["3471112233"] },
  ]);
  const matched = rows.find((row) => row.transactionId === "KEY-1");
  const missing = rows.find((row) => row.transactionId === "KEY-2");
  assert.equal(rows.length, 2);
  assert.equal(matched.supplier, "WindTre");
  assert.equal(matched.rechargeType, "VSC");
  assert.equal(matched.status, "VERIFICATO");
  assert.equal(matched.saleId, "w3-sale");
  assert.equal(missing.status, "NON PRESENTE SU BISUITE");
  assert.equal(missing.pdv, "POS-2", "unmatched rows retain the PDV from the provider report");
});

test("estrazione BiSuite usa solo articoli RICARICHE e legge telefono dai dettagli", () => {
  const rows = extractRechargeSales([
    {
      id: "uuid", bisuiteId: 456, dataVendita: "2026-09-01T12:00:00.000Z",
      codicePos: "POS1", nomeNegozio: "Negozio", nomeCliente: "Cliente", stato: "Completata",
      rawData: { articoli: [
        { categoria: { nome: "RICARICHE" }, dettaglio: { prezzo: "5.00", domandeRisposte: [{ domandaTesto: "Numero telefono da ricaricare", risposta: "+39 347 123 4567" }] } },
        { categoria: { nome: "RICARICHE" }, telefono: "3471234567", dettaglio: { prezzo: "5.00" } },
        { categoria: { nome: "ACCESSORI" }, dettaglio: { prezzo: "999.00" } },
      ] },
    },
    {
      id: "cancelled", bisuiteId: 457, dataVendita: "2026-09-01", codicePos: "POS1",
      nomeNegozio: "Negozio", nomeCliente: "Cliente", stato: "Annullata",
      rawData: { articoli: [{ categoria: { nome: "RICARICHE" }, dettaglio: { prezzo: "50" } }] },
    },
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].amount, 10);
  assert.deepEqual(rows[0].phones, ["3471234567"]);
});

test("Analisi - Ricariche è un modulo indipendente concedibile senza Amministrazione", () => {
  assert.ok(MODULES.some((module) => module.key === "analisi_ricariche"));
  assert.deepEqual(
    sanitizeGrantableModules(["analisi_ricariche"], { analisi_ricariche: true }, []),
    ["analisi_ricariche"],
  );
  assert.equal(isModuleAccessible({
    enabledModules: { analisi_ricariche: true, amministrazione: false },
    brandNames: [],
    moduliConsentiti: ["analisi_ricariche"],
    key: "analisi_ricariche",
  }), true);
  assert.equal(isModuleAccessible({
    enabledModules: { analisi_ricariche: false },
    brandNames: [],
    moduliConsentiti: ["analisi_ricariche"],
    key: "analisi_ricariche",
  }), false);
});
