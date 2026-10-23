import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as XLSX from "xlsx";
import {
  extractRechargeSales,
  getRicaricheAnalysisProvidersForBrands,
  isRechargeDateWithinPeriod,
  normalizeRechargePhone,
  parseVodafoneRechargeWorkbook,
  parseWindTreRechargeWorkbook,
  rechargeApiRows,
  reconcileRechargeRows,
  rowsOutsideRechargePeriod,
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

test("periodo report: include entrambi i confini e identifica solo i giorni esterni", () => {
  const from = "2026-10-09";
  const to = "2026-10-11";
  assert.equal(isRechargeDateWithinPeriod("2026-10-09T00:00:00.000Z", from, to), true);
  assert.equal(isRechargeDateWithinPeriod("2026-10-11T23:59:59.000Z", from, to), true);
  assert.equal(isRechargeDateWithinPeriod("2026-10-08T23:59:59.000Z", from, to), false);
  assert.equal(isRechargeDateWithinPeriod("2026-10-12T00:00:00.000Z", from, to), false);
  assert.equal(isRechargeDateWithinPeriod("data non valida", from, to), false);
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

test("fixture BiSuite anonimizzata: venditaInfo1, prezzo testuale, annullata e multi-articolo", () => {
  const fixture = JSON.parse(readFileSync(
    new URL("./fixtures/ricariche-bisuite-anonimizzate.json", import.meta.url),
    "utf8",
  ));
  const sales = extractRechargeSales(fixture.sales);
  assert.equal(sales.length, 1, "the cancelled sale must not be extracted");
  assert.equal(sales[0].amount, 11, "sum only the two RICARICHE prices");
  assert.equal(sales[0].customer, "Cliente A");
  assert.deepEqual(sales[0].phones, ["3471234567"]);

  const [row] = reconcileRechargeRows([
    recharge("real-shape-sample", "2026-09-12T15:00:00.000Z", "3471234567", "", 11),
  ], sales);
  assert.equal(row.status, "VERIFICATO");
  assert.equal(row.amount, 11);
  assert.equal(row.bisuiteAmount, 11);
  assert.equal(row.difference, 0);
  assert.equal(row.customer, "Cliente A");
  assert.equal(row.saleId, "100001");
});

test("le ricariche BiSuite senza report provider sono righe API distinte e identificabili", () => {
  const fixture = JSON.parse(readFileSync(
    new URL("./fixtures/ricariche-bisuite-anonimizzate.json", import.meta.url),
    "utf8",
  ));
  const candidates = extractRechargeSales(fixture.sales, { splitArticles: true });
  const rows = rechargeApiRows(candidates);
  assert.equal(rows.length, 2);
  assert.equal(new Set(rows.map((row) => row.id)).size, 2);
  assert.ok(rows.every((row) => row.status === "RICEVUTA VIA API"));
  assert.ok(rows.every((row) => row.amount === null));
  assert.deepEqual(rows.map((row) => row.bisuiteAmount), [5, 6]);
  assert.equal(rows.reduce((sum, row) => sum + row.bisuiteAmount, 0), 11);
  assert.ok(rows.every((row) => row.supplier === "BiSuite API" && row.saleId === "100001"));
  assert.deepEqual(rows.map((row) => row.phone), ["3471234567", "3471234567"]);
});

test("venditaInfo1 senza etichetta telefonica non crea un candidato telefono", () => {
  const [sale] = extractRechargeSales([{
    id: "unlabeled",
    bisuiteId: 100003,
    dataVendita: "2026-09-12T15:10:00.000Z",
    codicePos: "POS-ANON",
    nomeCliente: "Cliente anonimo",
    stato: "FINALIZZATA IN CASSA",
    rawData: {
      articoli: [{
        categoria: { nome: "RICARICHE" },
        dettaglio: { prezzo: "10.00", venditaInfo1: "Riferimento: 3471234567" },
      }],
    },
  }]);
  assert.deepEqual(sale.phones, []);
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

test("telefoni BiSuite reali: venditaInfo etichettato, non ICCID o numeri liberi", () => {
  const sale = {
    id: "anon", bisuiteId: 101, dataVendita: "2026-10-09", stato: "FINALIZZATA IN CASSA",
    codicePos: "POS-ANON", nomeNegozio: "", nomeCliente: "",
    rawData: { articoli: [{ categoria: { nome: "RICARICHE" }, dettaglio: {
      prezzo: "15.00", domandeRisposte: [],
      venditaInfo1: "NUMERO TELEFONO: +39 700 000 0001",
      venditaInfo2: "ICCID: 8900000000000000000",
      venditaInfo3: "7000000002",
    } }] },
  };
  assert.deepEqual(extractRechargeSales([sale])[0].phones, ["7000000001"]);
});

const cmsFixture = JSON.parse(readFileSync(
  new URL("./fixtures/windtre-cms-recharges-anonymized.json", import.meta.url), "utf8",
));

test("CMS report intero: 108 Keycode e 1.841 euro verificati senza falsi mancanti", () => {
  const candidates = extractRechargeSales(cmsFixture.sales, { splitArticles: true });
  const rows = reconcileRechargeRows(cmsFixture.providerRows, candidates);
  const verified = rows.filter(r => r.status === "VERIFICATO");
  const missingFile = rows.filter(r => r.status === "NON PRESENTE SU FILE");
  assert.equal(cmsFixture.providerRows.length, 108);
  assert.equal(candidates.length, 198);
  assert.equal(verified.length, 108);
  assert.equal(verified.reduce((n, r) => n + Math.round(r.amount * 100), 0), 184100);
  assert.ok(verified.every(r => r.difference === 0 && r.amount === r.bisuiteAmount));
  assert.equal(rows.filter(r => r.status === "INCONGRUENZA IMPORTO").length, 0);
  assert.equal(rows.filter(r => r.status === "NON PRESENTE SU BISUITE").length, 0);
  assert.equal(missingFile.length, 90);
  assert.equal(missingFile.reduce((n, r) => n + Math.round(r.bisuiteAmount * 100), 0), 159500);
  assert.equal(rows.length, new Set(rows.map(r => r.id)).size);
  assert.equal(rows.reduce((n, r) => n + Math.round((r.bisuiteAmount ?? 0) * 100), 0), 343600);
  assert.ok(candidates.every(s => s.phones.length === 1));
  assert.equal(cmsFixture.sales.filter(s => s.stato === "ANNULLATA").length, 2);
  assert.ok(cmsFixture.providerRows.some(r => r.rechargeType === "SIM ATTIVA"));
  assert.ok(cmsFixture.providerRows.every(r => /^700\d{7}$/.test(r.phone)), "only synthetic phone identifiers");
});

test("CMS 9–11 ottobre: separa le 8 ricariche del 12 incluse nel file", () => {
  const candidates = extractRechargeSales(cmsFixture.sales, { splitArticles: true });
  const withinPeriod = r => isRechargeDateWithinPeriod(r.date, "2026-10-09", "2026-10-11");
  const included = cmsFixture.providerRows.filter(withinPeriod);
  const excluded = cmsFixture.providerRows.filter(r => !withinPeriod(r));
  const rows = reconcileRechargeRows(included, candidates.filter(withinPeriod));
  const outsideRows = rowsOutsideRechargePeriod(excluded);
  assert.equal(included.length, 100);
  assert.equal(excluded.length, 8);
  assert.equal(excluded.reduce((n, r) => n + r.amount, 0), 133);
  assert.equal(outsideRows.length, 8);
  assert.equal(outsideRows.reduce((n, r) => n + (r.amount ?? 0), 0), 133);
  assert.ok(outsideRows.every(r => r.status === "FUORI PERIODO"));
  assert.deepEqual(
    outsideRows.map(r => r.transactionId).sort(),
    excluded.map(r => r.transactionId).sort(),
    "all eight CMS transactions outside the declared 9–11 period remain present",
  );
  assert.equal(rows.filter(r => r.status === "VERIFICATO").length, 100);
  assert.equal(rows.filter(r => r.status === "NON PRESENTE SU FILE").length, 34);
  assert.equal(rows.reduce((n, r) => n + (r.amount ?? 0), 0), 1708);
  assert.equal(rows.filter(r => r.status === "NON PRESENTE SU FILE").reduce((n, r) => n + r.bisuiteAmount, 0), 591);
});

test("WindTre divide lo scontrino per articolo, VF conserva l'aggregato storico", () => {
  const multi = cmsFixture.sales.find(s =>
    s.stato !== "ANNULLATA" && s.rawData.articoli.length > 1 &&
    new Set(s.rawData.articoli.map(a => a.dettaglio.venditaInfo1)).size > 1,
  );
  assert.ok(multi);
  const single = extractRechargeSales([multi]);
  const split = extractRechargeSales([multi], { splitArticles: true });
  assert.equal(single.length, 1);
  assert.equal(split.length, multi.rawData.articoli.length);
  assert.equal(split.reduce((n, r) => n + r.amount, 0), single[0].amount);
  assert.equal(new Set(split.map(s => s.saleId)).size, 1, "visible sale ID remains the original receipt ID");
  assert.equal(new Set(split.map(s => s.candidateId)).size, split.length);
  const rows = reconcileRechargeRows([], split);
  assert.equal(new Set(rows.map(r => r.id)).size, split.length, "unmatched articles have distinct row IDs");
});

test("candidati più vincolati prima: confronta il giorno anche con timestamp provider", () => {
  const flexible = recharge("A", "2026-10-09T09:00:00.000Z", "7000000001", "7000000002", 10);
  const constrained = recharge("B", "2026-10-09T09:00:00.000Z", "7000000001", "", 10);
  const sales = ["7000000001", "7000000002"].map((phone, i) => ({
    saleId: String(i + 1), bisuiteId: i + 1, date: "2026-10-09",
    pdv: "POS-ANON", customer: "", amount: 10, phones: [phone],
  }));
  const rows = reconcileRechargeRows([flexible, constrained], sales);
  assert.equal(rows.filter(r => r.status === "VERIFICATO").length, 2);
});
