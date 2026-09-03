// Test PURI del report vendite giornaliero su Telegram (Task #239).
// Coprono shared/venditeReport.ts (aggregazione + messaggio) e
// msUntilNextSend / resolveTelegramConfig di server/telegramReportScheduler.ts
// nella parte pura. NON serve né dev server né DB: i moduli TS sono caricati
// via loader tsx (import relativi in shared/).
import assert from "node:assert/strict";

const {
  aggregateDailyReport,
  applyNettoIvaAccessoriServizi,
  IVA_RATE,
  buildTelegramReportMessage,
  fmtEuro,
  fmtReportDate,
  buildDailyTrend,
  buildDailyHistory,
  monthStartYmd,
  monthLabelOf,
  pctDelta,
  addYmdDays,
  trendYmdOf,
  saleCustomerKind,
  energiaClienteFromDescrizione,
  telefoniPezziOf,
  monthWorkingDays,
  monthWorkingDaysByType,
  blendedWorkingDays,
  projectMonthEnd,
  buildMonthEndProjection,
  buildTopPerKpi,
  performanceScore,
  fmtPunti,
  topPerformer,
  bestProtettiSeller,
  PERFORMANCE_WEIGHTS,
  DEFAULT_PERFORMANCE_WEIGHTS,
  parsePerformanceWeights,
} = await import("../shared/venditeReport.ts");
const {
  buildVenditeReportHtml,
  reportHtmlFileName,
  escapeHtml,
  svgAreaChart,
} = await import("../shared/venditeReportHtml.ts");
const {
  buildDirettoreCommento,
  parseForecastConfig,
  fasciaFromTimeLabel,
  hasForecast,
  EMPTY_FORECAST,
} = await import("../shared/venditeCommento.ts");
const {
  DEFAULT_TELEGRAM_REPORT_CONTENT,
  TELEGRAM_REPORT_PISTE,
  parseTelegramReportContent,
  parseTelegramReportContentForBrand,
  applyBrandGating,
  applyBrandKindGating,
  telegramBrandKindOf,
  buildTelegramBrandTargets,
  unassignedPosCodes,
  effectiveGroupPiste,
  isPistaVisible,
  groupPezziOf,
  buildGroupTopByPezzi,
} = await import("../shared/telegramReportContent.ts");

let passed = 0;
let failed = 0;
async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    console.error(`  ✗ ${name}`);
    console.error(`    ${err.message}`);
  }
}

// Helper: costruisce una vendita con articoli BiSuite-shaped.
function sale({ stato = "COMPLETATA", totale = "0", codicePos = "POS1", nomeNegozio = "Negozio 1", nomeAddetto = null, articoli = [] } = {}) {
  return {
    stato,
    totale,
    codicePos,
    nomeNegozio,
    nomeAddetto,
    rawData: { articoli },
  };
}
function art(categoria, prezzo, opts = {}) {
  const a = { categoria: { nome: categoria }, dettaglio: { prezzo: String(prezzo) } };
  if (opts.tipologia) a.tipologia = { nome: opts.tipologia };
  if (opts.descrizione) a.descrizione = opts.descrizione;
  return a;
}

console.log("\n— aggregateDailyReport —");

await test("input vuoto ⇒ tutto a zero", () => {
  const a = aggregateDailyReport([]);
  assert.equal(a.vendite, 0);
  assert.equal(a.importo, 0);
  assert.deepEqual(a.countByType, { canvass: 0, prodotti: 0, servizi: 0 });
  assert.deepEqual(a.perPdv, []);
});

await test("vendite ANNULLATA escluse da tutti i conteggi (case-insensitive)", () => {
  const a = aggregateDailyReport([
    sale({ stato: "ANNULLATA", totale: "100", articoli: [art("UNTIED", 100)] }),
    sale({ stato: "annullata ", totale: "50", articoli: [art("TELEFONIA", 50)] }),
    sale({ stato: "COMPLETATA", totale: "30", articoli: [art("UNTIED", 30)] }),
  ]);
  assert.equal(a.vendite, 1);
  assert.equal(a.importo, 30);
  assert.equal(a.countByType.canvass, 1);
  assert.equal(a.countByType.prodotti, 0);
  assert.equal(a.perPdv.length, 1);
  assert.equal(a.perPdv[0].vendite, 1);
});

await test("visiblePiste: pezzi delle piste nascoste esclusi da mix/pista/drill-down (Task #515)", () => {
  const rows = [
    sale({ totale: "130", nomeAddetto: "Anna", articoli: [art("UNTIED", 30), art("ENERGIA W3", 10), art("TELEFONIA", 100)] }),
    sale({ totale: "25", nomeAddetto: "Bruno", codicePos: "POS2", nomeNegozio: "Negozio 2", articoli: [art("ENERGIA W3", 25)] }),
  ];
  const a = aggregateDailyReport(rows, undefined, ["mobile", "fisso"]);
  // I totali per VENDITA restano a livello scontrino (includono anche telefoni).
  assert.equal(a.vendite, 2);
  assert.equal(a.importo, 155);
  // Il mix canvass esclude i pezzi/importi di energia (nascosta).
  assert.equal(a.countByType.canvass, 1);
  assert.equal(a.amountByType.canvass, 30);
  assert.equal(a.countByPista.mobile, 1);
  assert.equal(a.countByPista.energia, undefined);
  assert.equal(a.amountByPista.energia, undefined);
  // Drill-down PDV/addetto senza la pista nascosta; energiaByCliente vuoto.
  const pos2 = a.perPdv.find((p) => p.codicePos === "POS2");
  assert.equal(pos2.dettaglio.countByPista.energia ?? 0, 0);
  const anna = a.perAddetto.find((x) => x.nomeAddetto === "Anna");
  assert.equal(anna.dettaglio.countByPista.energia ?? 0, 0);
  assert.equal(anna.dettaglio.countByPista.mobile, 1);
  assert.equal(a.energiaByCliente.privato.pezzi + a.energiaByCliente.business.pezzi, 0);
  // Coupon Caring è il dettaglio della pista CB: con cb nascosta sparisce.
  const ccRows = [sale({ totale: "10", articoli: [art("MIA TIED", 10, { descrizione: "COUPON CARING" })] })];
  const ccHidden = aggregateDailyReport(ccRows, undefined, ["mobile"]);
  assert.equal(ccHidden.couponCaring.pezzi, 0, "coupon caring nascosto senza pista cb");
  const ccShown = aggregateDailyReport(ccRows, undefined, ["cb"]);
  assert.ok(ccShown.couponCaring.pezzi >= 0); // shape invariata
  // Senza parametro: nessun filtro (comportamento storico).
  const full = aggregateDailyReport(rows);
  assert.equal(full.countByType.canvass, 3);
  assert.equal(full.countByPista.energia, 2);
});

await test("aggregazione per tipo e pista su più vendite", () => {
  const a = aggregateDailyReport([
    sale({ totale: "130", articoli: [art("UNTIED", 30), art("TELEFONIA", 100)] }),
    sale({ totale: "80", articoli: [art("ENERGIA W3", 0), art("ADSL/FIBRA/FWA CF", 25), art("SPEDIZIONE", 5)] }),
  ]);
  assert.equal(a.vendite, 2);
  assert.equal(a.importo, 210);
  assert.equal(a.countByType.canvass, 3); // UNTIED + ENERGIA W3 + ADSL
  assert.equal(a.countByType.prodotti, 1);
  assert.equal(a.countByType.servizi, 1);
  assert.equal(a.amountByType.canvass, 55);
  assert.equal(a.countByPista.mobile, 1);
  assert.equal(a.countByPista.energia, 1);
  assert.equal(a.countByPista.fisso, 1);
  assert.equal(a.amountByPista.fisso, 25);
});

await test("applyNettoIvaAccessoriServizi: netto IVA solo su ACCESSORI e Servizi", () => {
  const lordo = aggregateDailyReport([
    sale({ totale: "244", articoli: [art("TELEFONIA", 122), art("ACCESSORI", 61), art("SPEDIZIONE", 61)] }),
  ]);
  const a = applyNettoIvaAccessoriServizi(lordo);
  const cat = (list, name) => list.find((c) => c.categoria === name);
  // Telefonia resta LORDA
  assert.equal(cat(a.prodottiByCategoria, "TELEFONIA").importo, 122);
  // Accessori e servizi ÷ 1.22
  assert.ok(Math.abs(cat(a.prodottiByCategoria, "ACCESSORI").importo - 61 / IVA_RATE) < 1e-9);
  assert.ok(Math.abs(cat(a.serviziByCategoria, "SPEDIZIONE").importo - 61 / IVA_RATE) < 1e-9);
  // Totali per tipo coerenti (prodotti = telefonia lorda + accessori netti)
  assert.ok(Math.abs(a.amountByType.prodotti - (122 + 61 / IVA_RATE)) < 1e-9);
  assert.ok(Math.abs(a.amountByType.servizi - 61 / IVA_RATE) < 1e-9);
  // Pezzi e importo vendita invariati; drill-down PDV nettato
  assert.equal(a.countByType.prodotti, 2);
  assert.equal(a.importo, lordo.importo);
  const drill = a.perPdv[0].dettaglio;
  assert.ok(Math.abs(cat(drill.prodottiByCategoria, "ACCESSORI").importo - 61 / IVA_RATE) < 1e-9);
  assert.ok(Math.abs(cat(drill.serviziByCategoria, "SPEDIZIONE").importo - 61 / IVA_RATE) < 1e-9);
  // L'originale non è mutato
  assert.equal(cat(lordo.prodottiByCategoria, "ACCESSORI").importo, 61);
});

await test("pezzi CB = SOLO MIA TIED + MIA UNTIED + RIVINCOLO (altre categorie CB escluse)", () => {
  const a = aggregateDailyReport([
    sale({
      totale: "70",
      articoli: [
        art("ALTRI EVENTI CB", 10),
        art("WINDTRE SECURITY PRO CB", 5),
        art("ADD-ON CB", 5),
        art("MIGRAZIONE EXTRA TRAMITE ASK", 5),
        art("RIVINCOLO", 30),
        art("MIA TIED", 10),
        art("MIA UNTIED", 5),
      ],
    }),
  ]);
  assert.equal(a.countByType.canvass, 7); // restano tutti canvass
  assert.equal(a.countByPista.cb, 3); // RIVINCOLO + MIA TIED + MIA UNTIED
  assert.equal(a.amountByPista.cb, 45);
  const catCb = (a.categorieByPista.cb ?? []).map((c) => c.categoria);
  assert.deepEqual(catCb.sort(), ["MIA TIED", "MIA UNTIED", "RIVINCOLO"]);
});

await test("Coupon Caring: esclusi dai pezzi CB, conteggiati nel report dedicato", () => {
  const a = aggregateDailyReport([
    sale({
      totale: "60",
      articoli: [
        art("MIA TIED", 20, { tipologia: "COUPON CARING TIED" }),
        art("MIA UNTIED", 10, { tipologia: "COUPON CARING UNTIED" }),
        art("MIA TIED", 15, { tipologia: "OFFERTA MIA" }),
        art("RIVINCOLO", 15),
      ],
    }),
  ]);
  assert.equal(a.countByPista.cb, 2); // MIA TIED normale + RIVINCOLO
  assert.equal(a.amountByPista.cb, 30);
  assert.equal(a.countByType.canvass, 4); // i coupon restano canvass
  assert.equal(a.couponCaring.pezzi, 2);
  assert.equal(a.couponCaring.importo, 30);
  assert.deepEqual(
    a.couponCaring.byCategoria.map((c) => c.categoria).sort(),
    ["MIA TIED", "MIA UNTIED"],
  );
  const catCb = (a.categorieByPista.cb ?? []).map((c) => c.categoria);
  assert.deepEqual(catCb.sort(), ["MIA TIED", "RIVINCOLO"]);
});

await test("report HTML: sezione dedicata Coupon Caring presente solo se > 0", () => {
  const withCoupon = aggregateDailyReport([
    sale({ totale: "20", articoli: [art("MIA TIED", 20, { tipologia: "COUPON CARING TIED" })] }),
  ]);
  const html = buildVenditeReportHtml({
    orgName: "Org Test",
    dateYMD: "2026-07-17",
    timeLabel: "13:30",
    aggregates: withCoupon,
  });
  assert.ok(html.includes("Coupon Caring"));
  assert.ok(html.includes("esclusi dai pezzi CB"));

  const senza = aggregateDailyReport([
    sale({ totale: "10", articoli: [art("RIVINCOLO", 10)] }),
  ]);
  const html2 = buildVenditeReportHtml({
    orgName: "Org Test",
    dateYMD: "2026-07-17",
    timeLabel: "13:30",
    aggregates: senza,
  });
  assert.ok(!html2.includes("Coupon Caring"));
});

await test("per-PDV: raggruppa per codicePos, ordina per importo↓, N/D per mancante", () => {
  const a = aggregateDailyReport([
    sale({ codicePos: "A", nomeNegozio: "Alfa", totale: "10" }),
    sale({ codicePos: "B", nomeNegozio: "Beta", totale: "100" }),
    sale({ codicePos: "A", nomeNegozio: "", totale: "15" }),
    sale({ codicePos: null, nomeNegozio: null, totale: "1" }),
  ]);
  assert.deepEqual(a.perPdv.map((p) => p.codicePos), ["B", "A", "N/D"]);
  const pdvA = a.perPdv.find((p) => p.codicePos === "A");
  assert.equal(pdvA.vendite, 2);
  assert.equal(pdvA.importo, 25);
  assert.equal(pdvA.nomeNegozio, "Alfa");
});

await test("per-PDV: codice POS vuoto usa nome negozio e non accorpa store distinti", () => {
  const a = aggregateDailyReport([
    sale({ codicePos: "", nomeNegozio: "Vodafone Store Roma Est", totale: "100" }),
    sale({ codicePos: null, nomeNegozio: "Vodafone Store Fiumicino", totale: "80" }),
    sale({ codicePos: "", nomeNegozio: "Vodafone Store Roma Est", totale: "20" }),
    sale({ codicePos: "", nomeNegozio: "Back Office Vodafone Partner", totale: "10" }),
  ]);
  assert.deepEqual(
    a.perPdv.map((p) => p.nomeNegozio),
    ["Vodafone Store Roma Est", "Vodafone Store Fiumicino", "Back Office Vodafone Partner"],
  );
  assert.equal(a.perPdv[0].vendite, 2);
  const html = buildVenditeReportHtml({
    orgName: "Phone&Phone",
    dateYMD: "2026-08-28",
    aggregates: a,
  });
  assert.ok(html.includes("Vodafone Store Roma Est"));
  assert.ok(html.includes("Vodafone Store Fiumicino"));
  assert.ok(html.includes("Back Office Vodafone Partner"));
  assert.ok(!html.includes('<span class="mono">Vodafone Store Roma Est</span>'), "nome non duplicato come codice POS");
});

await test("totale malformato ⇒ 0, non NaN", () => {
  const a = aggregateDailyReport([sale({ totale: "abc" }), sale({ totale: null })]);
  assert.equal(a.importo, 0);
  assert.equal(a.vendite, 2);
});

await test("per-addetto: grouping case-insensitive, N/D per mancante, ordina per importo↓", () => {
  const a = aggregateDailyReport([
    sale({ nomeAddetto: "Mario Rossi", totale: "10" }),
    sale({ nomeAddetto: "MARIO ROSSI ", totale: "15" }),
    sale({ nomeAddetto: "Luigi Verdi", totale: "100" }),
    sale({ nomeAddetto: null, totale: "1" }),
    sale({ nomeAddetto: "  ", totale: "2", stato: "ANNULLATA" }), // esclusa
  ]);
  assert.deepEqual(a.perAddetto.map((x) => x.nomeAddetto), ["Luigi Verdi", "Mario Rossi", "N/D"]);
  const mario = a.perAddetto.find((x) => x.nomeAddetto === "Mario Rossi");
  assert.equal(mario.vendite, 2);
  assert.equal(mario.importo, 25);
  const nd = a.perAddetto.find((x) => x.nomeAddetto === "N/D");
  assert.equal(nd.vendite, 1);
  assert.equal(nd.importo, 1);
});

await test("rawData senza articoli non crasha", () => {
  const a = aggregateDailyReport([
    { stato: "OK", totale: "5", codicePos: "X", nomeNegozio: "X", rawData: null },
  ]);
  assert.equal(a.vendite, 1);
  assert.equal(a.importo, 5);
});

console.log("\n— fmtEuro / fmtReportDate —");

await test("fmtEuro stile it-IT con migliaia e decimali", () => {
  assert.equal(fmtEuro(0), "0,00 €");
  assert.equal(fmtEuro(1234.5), "1.234,50 €");
  assert.equal(fmtEuro(1234567.891), "1.234.567,89 €");
  assert.equal(fmtEuro(-42.1), "-42,10 €");
});

await test("fmtReportDate YYYY-MM-DD ⇒ DD/MM/YYYY, input non valido passthrough", () => {
  assert.equal(fmtReportDate("2026-07-02"), "02/07/2026");
  assert.equal(fmtReportDate("oggi"), "oggi");
});

console.log("\n— buildTelegramReportMessage —");

await test("intestazione: data, fascia oraria, org (escape HTML)", () => {
  const msg = buildTelegramReportMessage({
    orgName: "Org & Co <srl>",
    dateYMD: "2026-07-02",
    timeLabel: "13:30",
    aggregates: aggregateDailyReport([]),
  });
  assert.ok(msg.includes("Report vendite 02/07/2026"));
  assert.ok(msg.includes("13:30"));
  assert.ok(msg.includes("🏢 Org &amp; Co &lt;srl&gt;"));
  assert.ok(!msg.includes("<srl>"));
});

await test("giorno senza vendite ⇒ commento 'giornata al palo', niente sezioni dettaglio", () => {
  const msg = buildTelegramReportMessage({
    orgName: "Org Test",
    dateYMD: "2026-07-02",
    timeLabel: "13:30",
    aggregates: aggregateDailyReport([]),
  });
  // Commento discorsivo per giornata vuota (parziale): apertura ☀️ + frase palo
  assert.ok(msg.includes("☀️"));
  assert.ok(/palo|tabellone|ghiaccio|rimonta|zero/.test(msg));
  // Il dettaglio ora vive solo nell'allegato HTML: niente sezioni nel testo.
  assert.ok(!msg.includes("Per tipo"));
  assert.ok(!msg.includes("Per pista"));
  assert.ok(!msg.includes("Per punto vendita"));
  assert.ok(!msg.includes("Proiezione fine mese"));
});

await test("messaggio con vendite ⇒ commento discorsivo, nessuna sezione elenco", () => {
  const aggregates = aggregateDailyReport([
    sale({ codicePos: "P1", nomeNegozio: "Centro", totale: "130", articoli: [art("UNTIED", 30), art("TELEFONIA", 100)] }),
    sale({ codicePos: "P2", nomeNegozio: "Mare", totale: "20", articoli: [art("ENERGIA W3", 20)] }),
  ]);
  const msg = buildTelegramReportMessage({
    orgName: "Org",
    dateYMD: "2026-07-02",
    timeLabel: "13:30",
    aggregates,
  });
  // Riassunto discorsivo della giornata (parziale ⇒ "Finora").
  assert.ok(msg.includes("<b>2 vendite</b>"));
  assert.ok(msg.includes("Finora"));
  // Standout negozio in evidenza.
  assert.ok(msg.includes("Centro"));
  // Nessuna delle vecchie sezioni elenco.
  assert.ok(!msg.includes("<b>Per tipo</b>"));
  assert.ok(!msg.includes("<b>Per pista</b>"));
  assert.ok(!msg.includes("<b>Per punto vendita</b>"));
});

console.log("\n— buildVenditeReportHtml / reportHtmlFileName —");

await test("HTML: dashboard completa con hero, highlights, gara piste, mix tipi, classifiche", () => {
  const aggregates = aggregateDailyReport([
    sale({ codicePos: "P1", nomeNegozio: "Centro", nomeAddetto: "Mario Rossi", totale: "130", articoli: [art("UNTIED", 30), art("TELEFONIA", 100)] }),
    sale({ codicePos: "P2", nomeNegozio: "Mare", nomeAddetto: "Luigi Verdi", totale: "20", articoli: [art("ENERGIA W3", 20)] }),
  ]);
  const html = buildVenditeReportHtml({
    orgName: "Org Test",
    dateYMD: "2026-07-02",
    timeLabel: "13:30",
    aggregates,
  });
  assert.ok(html.startsWith("<!doctype html>"));
  assert.ok(html.includes("Report vendite 02/07/2026"));
  assert.ok(html.includes("Org Test"));
  assert.ok(html.includes("ore 13:30"));
  // Hero: numero grande + importo totale
  assert.ok(html.includes('<div class="hero-num">2</div>'));
  assert.ok(html.includes("150,00 €"));
  // Highlights: pista del giorno + sezione "I migliori" per KPI (Task #272)
  assert.ok(!html.includes("Top negozio"));
  assert.ok(!html.includes("Top addetto"));
  assert.ok(html.includes("Pista del giorno"));
  assert.ok(html.includes("I migliori del giorno"));
  assert.ok(html.includes("TELCO"));
  assert.ok(html.includes("Telefoni"));
  assert.ok(html.includes("<b>Mario Rossi</b>"));
  assert.ok(html.includes("<b>Centro</b>"));
  // Gara piste: solo piste con pezzi > 0, con colore tema inline
  assert.ok(html.includes('style="color:#60a5fa">Mobile</span>')); // tema mobile dark
  assert.ok(html.includes(">Energia</span>"));
  assert.ok(!html.includes(">Fisso</span>"));
  assert.ok(html.includes('<div class="pbar">'));
  // Chip categorie dentro la riga pista
  assert.ok(html.includes(">UNTIED ×1</span>"));
  // Mix tipi: donut SVG + legenda solo voci > 0 (niente Servizi)
  assert.ok(html.includes("Mix del giorno"));
  assert.ok(html.includes("<svg")); // donut
  assert.ok(html.includes(">Canvass</span>"));
  assert.ok(html.includes(">Prodotti</span>"));
  assert.ok(!html.includes(">Servizi</span>"));
  // Classifica PDV ordinata per importo↓ con barre
  assert.ok(html.includes("Per punto vendita"));
  assert.ok(html.indexOf("Centro") < html.indexOf("Mare"));
  assert.ok(html.includes('<span class="mono">P1</span>'));
  // Barre come <span> (phrasing content): dentro <summary> i <div> non
  // sono conformi e possono rompere il toggle su alcune WebView mobili.
  assert.ok(html.includes('<span class="bar">'));
  // Classifica addetti con medaglie top 3
  assert.ok(html.includes("Per addetto"));
  assert.ok(html.includes("🥇 Mario Rossi"));
  assert.ok(html.includes("🥈 Luigi Verdi"));
  // Senza trend: niente sezione andamento né chip delta nell'hero
  assert.ok(!html.includes("Andamento"));
  assert.ok(!html.includes("oggi vs ieri"));
  // Nessuna risorsa esterna
  assert.ok(!html.includes("http://") && !html.includes("https://"));
});

await test("HTML con trend: delta nell'hero, grafico andamento, delta pista", () => {
  const aggregates = aggregateDailyReport([
    sale({ codicePos: "P1", nomeNegozio: "Centro", nomeAddetto: "Mario Rossi", totale: "30", articoli: [art("UNTIED", 30)] }),
  ]);
  const trend = [
    { ymd: "2026-06-30", vendite: 4, importo: 100, countByPista: { mobile: 2 } },
    { ymd: "2026-07-01", vendite: 2, importo: 50, countByPista: { mobile: 1 } },
    { ymd: "2026-07-02", vendite: 1, importo: 30, countByPista: { mobile: 1 } },
  ];
  const html = buildVenditeReportHtml({
    orgName: "Org",
    dateYMD: "2026-07-02",
    aggregates,
    trend,
  });
  // Delta nell'hero: oggi(1) vs ieri(2) = -50% ▼; media 7gg = (4+2)/2 = 3 ⇒ -67% ▼
  assert.ok(html.includes('<div class="hero-chips">'));
  assert.ok(html.includes("▼ 50% oggi vs ieri"));
  assert.ok(html.includes("▼ 67% oggi vs media 7 gg"));
  // Grafico andamento + assi con giorno settimana e picco
  assert.ok(html.includes("Andamento · ultimi 3 giorni"));
  assert.ok(html.includes("<svg"));
  assert.ok(html.includes("30/06"));
  assert.ok(html.includes("picco 4"));
  // Delta pista: oggi(1) vs media 7gg pista (2+1)/2=1.5 ⇒ -33% ▼
  assert.ok(html.includes("▼ 33% vs media 7 gg"));
});

await test("HTML: giorno senza vendite ⇒ hero a 0 + card vuota, niente classifiche", () => {
  const html = buildVenditeReportHtml({
    orgName: "Org",
    dateYMD: "2026-07-02",
    aggregates: aggregateDailyReport([]),
  });
  assert.ok(html.includes('<div class="hero-num">0</div>'));
  assert.ok(html.includes("Nessuna vendita registrata oggi."));
  assert.ok(!html.includes("Per punto vendita"));
  assert.ok(!html.includes("Per addetto"));
  assert.ok(!html.includes("La gara delle piste"));
});

await test("HTML: giorno vuoto MA con trend ⇒ il grafico di andamento resta", () => {
  const trend = [
    { ymd: "2026-07-01", vendite: 3, importo: 90, countByPista: {} },
    { ymd: "2026-07-02", vendite: 0, importo: 0, countByPista: {} },
  ];
  const html = buildVenditeReportHtml({
    orgName: "Org",
    dateYMD: "2026-07-02",
    aggregates: aggregateDailyReport([]),
    trend,
  });
  assert.ok(html.includes("Nessuna vendita registrata oggi."));
  assert.ok(html.includes("Andamento · ultimi 2 giorni"));
  assert.ok(html.includes("<svg"));
});

await test("HTML: escape dei valori dinamici (org, negozio, addetto)", () => {
  const aggregates = aggregateDailyReport([
    sale({ codicePos: "P1", nomeNegozio: "Negozio <b>&", nomeAddetto: "Addetto \"X\" <script>", totale: "10" }),
  ]);
  const html = buildVenditeReportHtml({
    orgName: "Org & Co <srl>",
    dateYMD: "2026-07-02",
    aggregates,
  });
  assert.ok(html.includes("Org &amp; Co &lt;srl&gt;"));
  assert.ok(html.includes("Negozio &lt;b&gt;&amp;"));
  assert.ok(html.includes("Addetto &quot;X&quot; &lt;script&gt;"));
  assert.ok(!html.includes("<script>"));
});

await test("escapeHtml: tutti i 5 caratteri speciali", () => {
  assert.equal(escapeHtml(`&<>"'`), "&amp;&lt;&gt;&quot;&#39;");
  assert.equal(escapeHtml("ok"), "ok");
});

await test("reportHtmlFileName: slug org + data + orario, accenti e simboli rimossi", () => {
  assert.equal(
    reportHtmlFileName("WindTre Admin", "2026-07-02", "13:30"),
    "report-vendite-windtre-admin-2026-07-02-1330.html",
  );
  assert.equal(
    reportHtmlFileName("Càffè & Co!!", "2026-07-02"),
    "report-vendite-caffe-co-2026-07-02.html",
  );
  // Org vuota/solo simboli ⇒ fallback "org"
  assert.equal(reportHtmlFileName("***", "2026-07-02"), "report-vendite-org-2026-07-02.html");
});

console.log("\n— buildDailyTrend / pctDelta / helper trend —");

await test("buildDailyTrend: bucketing per giorno, zero-fill e annullate escluse", () => {
  const rows = [
    { ...sale({ totale: "30", articoli: [art("UNTIED", 30)] }), dataVendita: new Date(2026, 5, 30, 10, 15) },
    { ...sale({ totale: "20", articoli: [art("ENERGIA W3", 20)] }), dataVendita: "2026-06-30 18:00:00" },
    { ...sale({ stato: "ANNULLATA", totale: "99" }), dataVendita: "2026-06-30" },
    { ...sale({ totale: "50" }), dataVendita: "2026-07-02T09:00:00" },
    { ...sale({ totale: "77" }), dataVendita: "2026-06-01" }, // fuori intervallo
    { ...sale({ totale: "11" }), dataVendita: null }, // senza data
  ];
  const trend = buildDailyTrend(rows, "2026-06-30", "2026-07-02");
  assert.equal(trend.length, 3);
  assert.deepEqual(trend.map((d) => d.ymd), ["2026-06-30", "2026-07-01", "2026-07-02"]);
  assert.equal(trend[0].vendite, 2); // Date + stringa, annullata esclusa
  assert.equal(trend[0].importo, 50);
  assert.equal(trend[0].countByPista.mobile, 1);
  assert.equal(trend[0].countByPista.energia, 1);
  assert.equal(trend[1].vendite, 0); // giorno mancante riempito a zero
  assert.equal(trend[1].importo, 0);
  assert.equal(trend[2].vendite, 1);
  assert.equal(trend[2].importo, 50);
});

await test("buildDailyTrend: intervallo non valido o rovesciato ⇒ []", () => {
  assert.deepEqual(buildDailyTrend([], "2026-07-02", "2026-06-30"), []);
  assert.deepEqual(buildDailyTrend([], "not-a-date", "2026-07-02"), []);
});

await test("pctDelta: variazione arrotondata, base non positiva ⇒ null", () => {
  assert.equal(pctDelta(110, 100), 10);
  assert.equal(pctDelta(90, 100), -10);
  assert.equal(pctDelta(1, 3), -67);
  assert.equal(pctDelta(5, 5), 0);
  assert.equal(pctDelta(5, 0), null);
  assert.equal(pctDelta(5, -2), null);
  assert.equal(pctDelta(5, NaN), null);
});

await test("addYmdDays e trendYmdOf: aritmetica giorni e parsing date", () => {
  assert.equal(addYmdDays("2026-07-01", -1), "2026-06-30");
  assert.equal(addYmdDays("2026-06-19", 13), "2026-07-02"); // cambio mese
  assert.equal(addYmdDays("2026-12-31", 1), "2027-01-01"); // cambio anno
  assert.equal(trendYmdOf(new Date(2026, 6, 2, 23, 59)), "2026-07-02");
  assert.equal(trendYmdOf("2026-07-02 13:30:00"), "2026-07-02");
  assert.equal(trendYmdOf("boh"), null);
  assert.equal(trendYmdOf(null), null);
  assert.equal(trendYmdOf(new Date("invalid")), null);
});

await test("svgAreaChart: SVG inline con path e punto finale, <2 valori ⇒ vuoto", () => {
  const svg = svgAreaChart([1, 3, 2], { w: 320, h: 96, color: "#f97316" });
  assert.ok(svg.startsWith("<svg"));
  assert.ok(svg.includes('viewBox="0 0 320 96"'));
  assert.ok(svg.includes("<path"));
  assert.ok(svg.includes("<circle"));
  assert.ok(svg.includes("#f97316"));
  assert.equal(svgAreaChart([5], { w: 320, h: 96, color: "#000" }), "");
  assert.equal(svgAreaChart([], { w: 320, h: 96, color: "#000" }), "");
});

await test("aggregateDailyReport: categorieByPista ordinate per pezzi decrescenti", () => {
  const a = aggregateDailyReport([
    sale({ articoli: [art("UNTIED", 10), art("UNTIED", 10), art("TIED CF", 10)] }),
    sale({ articoli: [art("UNTIED", 10)] }),
  ]);
  const mobile = a.categorieByPista.mobile;
  assert.ok(Array.isArray(mobile));
  assert.deepEqual(mobile[0], { categoria: "UNTIED", pezzi: 3 });
  assert.deepEqual(mobile[1], { categoria: "TIED CF", pezzi: 1 });
});

console.log("\n— buildTopPerKpi (migliori per KPI, Task #272) —");

await test("migliori per KPI: vincitori distinti per TELCO/New Core/Telefoni/Accessori/Servizi", () => {
  const a = aggregateDailyReport([
    // Mario (P1 Centro): 2 mobile + 1 fisso = 3 TELCO; 1 telefono; 10 € accessori
    sale({ codicePos: "P1", nomeNegozio: "Centro", nomeAddetto: "Mario", totale: "300", articoli: [art("UNTIED", 30), art("UNTIED", 30), art("ADSL/FIBRA/FWA CF", 25), art("TELEFONIA", 200), art("ACCESSORI", 10)] }),
    // Luigi (P2 Mare): 1 mobile; 2 telefoni; 50 € accessori; 1 assicurazione + 1 energia = 2 New Core; 80 € servizi
    sale({ codicePos: "P2", nomeNegozio: "Mare", nomeAddetto: "Luigi", totale: "700", articoli: [art("UNTIED", 30), art("TELEFONIA", 250), art("TELEFONIA", 250), art("ACCESSORI", 50), art("ASSICURAZIONI", 0), art("ENERGIA W3", 0), art("SPEDIZIONE", 80)] }),
  ]);
  const kpis = buildTopPerKpi(a);
  assert.deepEqual(kpis.map((k) => k.key), ["telco", "newcore", "telefoni", "accessori", "servizi"]);
  const by = Object.fromEntries(kpis.map((k) => [k.key, k]));
  assert.deepEqual(by.telco.addetto, { nome: "Mario", valore: 3 });
  assert.deepEqual(by.telco.negozio, { nome: "Centro", valore: 3 });
  assert.equal(by.telco.unit, "pz");
  assert.deepEqual(by.newcore.addetto, { nome: "Luigi", valore: 2 });
  assert.deepEqual(by.newcore.negozio, { nome: "Mare", valore: 2 });
  assert.deepEqual(by.telefoni.addetto, { nome: "Luigi", valore: 2 });
  assert.deepEqual(by.accessori.addetto, { nome: "Luigi", valore: 50 });
  assert.equal(by.accessori.unit, "€");
  assert.deepEqual(by.servizi.addetto, { nome: "Luigi", valore: 80 });
  assert.deepEqual(by.servizi.negozio, { nome: "Mare", valore: 80 });
});

await test("migliori per KPI: N/D escluso, KPI a zero per tutti assente", () => {
  const a = aggregateDailyReport([
    sale({ codicePos: null, nomeNegozio: null, nomeAddetto: null, totale: "100", articoli: [art("UNTIED", 100)] }),
    sale({ codicePos: "P1", nomeNegozio: "Centro", nomeAddetto: "Anna", totale: "10", articoli: [art("ACCESSORI", 10)] }),
  ]);
  const kpis = buildTopPerKpi(a);
  const by = Object.fromEntries(kpis.map((k) => [k.key, k]));
  // TELCO: la vendita mobile è tutta su addetto/negozio N/D ⇒ nessun vincitore ⇒ voce assente.
  assert.equal(by.telco, undefined);
  assert.equal(by.telefoni, undefined);
  assert.equal(by.servizi, undefined);
  assert.deepEqual(by.accessori.addetto, { nome: "Anna", valore: 10 });
  assert.deepEqual(by.accessori.negozio, { nome: "Centro", valore: 10 });
});

await test("migliori per KPI: pareggio deterministico (vince chi ha più importo totale)", () => {
  const a = aggregateDailyReport([
    sale({ codicePos: "P1", nomeNegozio: "Alfa", nomeAddetto: "Primo", totale: "50", articoli: [art("UNTIED", 50)] }),
    sale({ codicePos: "P2", nomeNegozio: "Beta", nomeAddetto: "Secondo", totale: "200", articoli: [art("UNTIED", 200)] }),
  ]);
  const by = Object.fromEntries(buildTopPerKpi(a).map((k) => [k.key, k]));
  // 1 TELCO a testa: vince chi viene prima nell'ordinamento per importo↓ (Secondo/Beta).
  assert.deepEqual(by.telco.addetto, { nome: "Secondo", valore: 1 });
  assert.deepEqual(by.telco.negozio, { nome: "Beta", valore: 1 });
});

await test("migliori per KPI: input vuoto ⇒ []", () => {
  assert.deepEqual(buildTopPerKpi(aggregateDailyReport([])), []);
});

await test("HTML: card WindTre Protetti sempre presente, con congrats se venduti", () => {
  const conProtetti = aggregateDailyReport([
    sale({ codicePos: "P1", nomeNegozio: "Centro", nomeAddetto: "Mario Rossi", totale: "60", articoli: [art("ALLARMI", 60)] }),
  ]);
  const html = buildVenditeReportHtml({ orgName: "Org Test", dateYMD: "2026-07-15", timeLabel: "13:30", aggregates: conProtetti });
  assert.ok(html.includes("🛡️ WindTre Protetti"));
  assert.ok(html.includes("👏 Complimenti"));
  assert.ok(html.includes("<b>Mario Rossi</b>"));
  // Senza Protetti: card comunque presente con messaggio di spinta.
  const senza = aggregateDailyReport([
    sale({ codicePos: "P1", nomeNegozio: "Centro", totale: "30", articoli: [art("UNTIED", 30)] }),
  ]);
  const html2 = buildVenditeReportHtml({ orgName: "Org Test", dateYMD: "2026-07-15", timeLabel: "13:30", aggregates: senza });
  assert.ok(html2.includes("🛡️ WindTre Protetti"));
  assert.ok(html2.includes("Nessun WindTre Protetti"));
});

console.log("\n— punteggio performance (Task #282) —");

await test("performanceScore: somma pesata per pista, telefoni flat", () => {
  // 1 mobile (CF) = 1, 1 fisso = 3, 1 protecta = 10, 1 telefono = 1 ⇒ 15
  const a = aggregateDailyReport([
    sale({ codicePos: "P1", nomeAddetto: "Mario", totale: "10", articoli: [art("UNTIED", 10)] }),
    sale({ codicePos: "P1", nomeAddetto: "Mario", totale: "20", articoli: [art("ADSL/FIBRA/FWA CF", 20)] }),
    sale({ codicePos: "P1", nomeAddetto: "Mario", totale: "30", articoli: [art("ALLARMI", 30)] }),
    sale({ codicePos: "P1", nomeAddetto: "Mario", totale: "5", articoli: [art("TELEFONIA", 5)] }),
  ]);
  const mario = a.perAddetto.find((x) => x.nomeAddetto === "Mario");
  assert.equal(performanceScore(mario.dettaglio), 15);
});

await test("performanceScore: attivazione P.IVA (business) vale il doppio", () => {
  const priv = aggregateDailyReport([
    sale({ nomeAddetto: "A", totale: "10", articoli: [art("UNTIED", 10)] }),
  ]);
  const biz = aggregateDailyReport([
    { ...sale({ nomeAddetto: "A", totale: "10", articoli: [art("UNTIED", 10)] }),
      rawData: { articoli: [art("UNTIED", 10)], cliente: { clienteTipo: "GIURIDICA" } } },
  ]);
  assert.equal(performanceScore(priv.perAddetto[0].dettaglio), 1);
  assert.equal(performanceScore(biz.perAddetto[0].dettaglio), 2);
});

await test("classifiche ordinate per PUNTEGGIO, non per fatturato", () => {
  // Bea: 1 protecta (score 10) ma solo 30€. Aldo: 1 mobile (score 1) ma 500€.
  const a = aggregateDailyReport([
    sale({ codicePos: "P1", nomeNegozio: "Uno", nomeAddetto: "Bea", totale: "30", articoli: [art("ALLARMI", 30)] }),
    sale({ codicePos: "P2", nomeNegozio: "Due", nomeAddetto: "Aldo", totale: "500", articoli: [art("UNTIED", 500)] }),
  ]);
  assert.deepEqual(a.perAddetto.map((x) => x.nomeAddetto), ["Bea", "Aldo"]);
  assert.deepEqual(a.perPdv.map((x) => x.codicePos), ["P1", "P2"]);
});

await test("topPerformer: primo con punteggio>0, esclude N/D", () => {
  const a = aggregateDailyReport([
    sale({ codicePos: "P1", nomeNegozio: "Uno", nomeAddetto: "Bea", totale: "30", articoli: [art("ALLARMI", 30)] }),
    sale({ codicePos: null, nomeNegozio: null, nomeAddetto: null, totale: "500", articoli: [art("UNTIED", 500)] }),
  ]);
  const tp = topPerformer(a);
  assert.deepEqual(tp.addetto, { nome: "Bea", valore: 10 });
  assert.deepEqual(tp.negozio, { nome: "Uno", valore: 10 });
});

await test("topPerformer: nessuna vendita ⇒ null", () => {
  const tp = topPerformer(aggregateDailyReport([]));
  assert.equal(tp.addetto, null);
  assert.equal(tp.negozio, null);
});

await test("bestProtettiSeller: vince chi ha più Protetti; null senza Protetti", () => {
  const a = aggregateDailyReport([
    sale({ codicePos: "P1", nomeNegozio: "Uno", nomeAddetto: "Bea", totale: "30", articoli: [art("ALLARMI", 30)] }),
    sale({ codicePos: "P1", nomeNegozio: "Uno", nomeAddetto: "Bea", totale: "30", articoli: [art("ALLARMI", 30)] }),
    sale({ codicePos: "P2", nomeNegozio: "Due", nomeAddetto: "Aldo", totale: "30", articoli: [art("ALLARMI", 30)] }),
  ]);
  const b = bestProtettiSeller(a);
  assert.deepEqual(b.addetto, { nome: "Bea", valore: 2 });
  assert.deepEqual(b.negozio, { nome: "Uno", valore: 2 });
  const none = bestProtettiSeller(aggregateDailyReport([
    sale({ nomeAddetto: "X", totale: "10", articoli: [art("UNTIED", 10)] }),
  ]));
  assert.equal(none.addetto, null);
  assert.equal(none.negozio, null);
});

await test("PERFORMANCE_WEIGHTS: pesi attesi per pista", () => {
  assert.equal(PERFORMANCE_WEIGHTS.mobile, 1);
  assert.equal(PERFORMANCE_WEIGHTS.fisso, 3);
  assert.equal(PERFORMANCE_WEIGHTS.energia, 2);
  assert.equal(PERFORMANCE_WEIGHTS.assicurazioni, 2);
  assert.equal(PERFORMANCE_WEIGHTS.protecta, 10);
  assert.equal(PERFORMANCE_WEIGHTS.cb, 0.5);
});

await test("parsePerformanceWeights: undefined ⇒ default di sistema", () => {
  const w = parsePerformanceWeights(undefined);
  assert.deepEqual(w, DEFAULT_PERFORMANCE_WEIGHTS);
  // Deve essere una copia, non un alias del default condiviso.
  assert.notEqual(w.pesi, DEFAULT_PERFORMANCE_WEIGHTS.pesi);
});

await test("parsePerformanceWeights: fallback per-campo sui valori mancanti/non validi", () => {
  const w = parsePerformanceWeights({ mobile: 5, protecta: "abc", telefoni: "2,5", ivaMultiplier: 0.5 });
  assert.equal(w.pesi.mobile, 5); // override numerico
  assert.equal(w.pesi.protecta, 10); // non numerico ⇒ default
  assert.equal(w.pesi.fisso, 3); // assente ⇒ default
  assert.equal(w.telefoni, 2.5); // stringa con virgola ⇒ 2.5
  assert.equal(w.ivaMultiplier, 2); // < 1 ⇒ default (P.IVA non può valere meno di CF)
});

await test("parsePerformanceWeights: accetta peso pista 0 ma non negativo", () => {
  const w = parsePerformanceWeights({ cb: 0, energia: -3 });
  assert.equal(w.pesi.cb, 0); // 0 valido (pista esclusa dal punteggio)
  assert.equal(w.pesi.energia, 2); // negativo ⇒ default
});

await test("performanceScore: usa i pesi configurati (override)", () => {
  const a = aggregateDailyReport([
    sale({ nomeAddetto: "Mario", totale: "10", articoli: [art("UNTIED", 10)] }),
    sale({ nomeAddetto: "Mario", totale: "30", articoli: [art("ALLARMI", 30)] }),
  ]);
  const d = a.perAddetto.find((x) => x.nomeAddetto === "Mario").dettaglio;
  // Default: 1 mobile (1) + 1 protecta (10) = 11.
  assert.equal(performanceScore(d), 11);
  // Pesi custom: mobile 5, protecta 1 ⇒ 5 + 1 = 6.
  const custom = parsePerformanceWeights({ mobile: 5, protecta: 1 });
  assert.equal(performanceScore(d, custom), 6);
});

await test("aggregateDailyReport: i pesi custom cambiano l'ordine delle classifiche", () => {
  const rows = [
    sale({ codicePos: "P1", nomeNegozio: "Uno", nomeAddetto: "Bea", totale: "30", articoli: [art("ALLARMI", 30)] }), // 1 protecta
    sale({ codicePos: "P2", nomeNegozio: "Due", nomeAddetto: "Aldo", totale: "10", articoli: [art("UNTIED", 10)] }), // 1 mobile
  ];
  // Default: protecta (10) > mobile (1) ⇒ Bea prima.
  assert.deepEqual(aggregateDailyReport(rows).perAddetto.map((x) => x.nomeAddetto), ["Bea", "Aldo"]);
  // Custom: mobile 20, protecta 1 ⇒ Aldo prima.
  const custom = parsePerformanceWeights({ mobile: 20, protecta: 1 });
  assert.deepEqual(aggregateDailyReport(rows, custom).perAddetto.map((x) => x.nomeAddetto), ["Aldo", "Bea"]);
});

await test("performanceScore: moltiplicatore P.IVA configurabile", () => {
  const biz = aggregateDailyReport([
    { ...sale({ nomeAddetto: "A", totale: "10", articoli: [art("UNTIED", 10)] }),
      rawData: { articoli: [art("UNTIED", 10)], cliente: { clienteTipo: "GIURIDICA" } } },
  ]);
  const d = biz.perAddetto[0].dettaglio;
  // Default multiplier 2 ⇒ 1 mobile P.IVA = 2.
  assert.equal(performanceScore(d), 2);
  // Multiplier 3 ⇒ 3.
  const custom = parsePerformanceWeights({ ivaMultiplier: 3 });
  assert.equal(performanceScore(d, custom), 3);
});

await test("fmtPunti: singolare/plurale e virgola decimale it-IT", () => {
  assert.equal(fmtPunti(1), "1 punto");
  assert.equal(fmtPunti(0), "0 punti");
  assert.equal(fmtPunti(15), "15 punti");
  assert.equal(fmtPunti(2.5), "2,5 punti");
});

console.log("\n— storico navigabile + totale mese —");

await test("monthStartYmd e monthLabelOf: inizio mese ed etichetta italiana", () => {
  assert.equal(monthStartYmd("2026-07-15"), "2026-07-01");
  assert.equal(monthStartYmd("2026-07-01"), "2026-07-01");
  assert.equal(monthStartYmd("boh"), "boh"); // passthrough input non valido
  assert.equal(monthLabelOf("2026-07-03"), "luglio 2026");
  assert.equal(monthLabelOf("2026-12-31"), "dicembre 2026");
  assert.equal(monthLabelOf("boh"), "boh");
});

await test("buildDailyHistory: aggregati completi per giorno, zero-fill, ordine crescente", () => {
  const rows = [
    { ...sale({ totale: "100", articoli: [art("UNTIED", 50)] }), dataVendita: "2026-07-01 10:00:00" },
    { ...sale({ totale: "30", nomeAddetto: "Mario" }), dataVendita: "2026-07-03 09:00:00" },
    { ...sale({ totale: "70" }), dataVendita: "2026-06-30 12:00:00" }, // fuori intervallo
    { ...sale({ totale: "999" }), dataVendita: null }, // senza data
  ];
  const h = buildDailyHistory(rows, "2026-07-01", "2026-07-03");
  assert.equal(h.length, 3);
  assert.deepEqual(h.map((d) => d.ymd), ["2026-07-01", "2026-07-02", "2026-07-03"]);
  assert.equal(h[0].aggregates.vendite, 1);
  assert.equal(h[0].aggregates.importo, 100);
  assert.equal(h[0].aggregates.countByPista.mobile, 1); // aggregato COMPLETO, non solo conteggi
  assert.equal(h[1].aggregates.vendite, 0); // zero-fill
  assert.equal(h[2].aggregates.perAddetto[0].nomeAddetto, "Mario");
});

await test("buildDailyHistory: intervallo non valido o rovesciato ⇒ []", () => {
  assert.deepEqual(buildDailyHistory([], "2026-07-03", "2026-07-01"), []);
  assert.deepEqual(buildDailyHistory([], "boh", "2026-07-01"), []);
});

await test("HTML navigabile: una pagina per giorno, nav ‹ ›, solo l'ultima visibile", () => {
  const mk = (n) => aggregateDailyReport(Array.from({ length: n }, () => sale({ totale: "10", articoli: [art("UNTIED", 10)] })));
  const history = [
    { ymd: "2026-07-01", aggregates: mk(3) },
    { ymd: "2026-07-02", aggregates: mk(5) },
    { ymd: "2026-07-03", aggregates: mk(0) },
  ];
  const html = buildVenditeReportHtml({
    orgName: "Org Test",
    dateYMD: "2026-07-03",
    aggregates: history[2].aggregates,
    trend: history.map((h) => ({ ymd: h.ymd, vendite: h.aggregates.vendite, importo: h.aggregates.importo, countByPista: h.aggregates.countByPista })),
    history,
  });
  // Tre pagine giorno, solo l'ultima senza hidden.
  assert.ok(html.includes('data-page="d0" hidden'));
  assert.ok(html.includes('data-page="d1" hidden'));
  assert.ok(html.includes('data-page="d2">'));
  assert.ok(!html.includes('data-page="d2" hidden'));
  // Barra di navigazione + JS inline.
  assert.ok(html.includes('id="nav-prev"'));
  assert.ok(html.includes('id="nav-next"'));
  assert.ok(html.includes('id="nav-label"'));
  assert.ok(html.includes("<script>"));
  // Etichette hero: oggi vs giorni passati.
  assert.ok(html.includes("Vendite di oggi"));
  assert.ok(html.includes("Vendite di mer 01/07"));
  // Delta della pagina storica calcolati sul "presente" di quel giorno.
  assert.ok(html.includes("vs giorno prima"));
  // Nessuna risorsa esterna.
  assert.ok(!/src\s*=\s*"http/.test(html));
  assert.ok(!/href\s*=\s*"http/.test(html));
});

await test("HTML: pagina Totale mese con hero, gara piste mese e bottone Mese", () => {
  const monthAgg = aggregateDailyReport([
    sale({ nomeAddetto: "Mario", totale: "100", articoli: [art("UNTIED", 50)] }),
    sale({ nomeAddetto: "Mario", totale: "200", articoli: [art("LUCE", 80)] }),
  ]);
  const html = buildVenditeReportHtml({
    orgName: "Org Test",
    dateYMD: "2026-07-03",
    aggregates: aggregateDailyReport([]),
    history: [
      { ymd: "2026-07-02", aggregates: aggregateDailyReport([sale({ totale: "100" })]) },
      { ymd: "2026-07-03", aggregates: aggregateDailyReport([]) },
    ],
    month: { label: "luglio 2026", aggregates: monthAgg },
  });
  assert.ok(html.includes('data-page="month" hidden'));
  assert.ok(html.includes("Totale luglio 2026"));
  assert.ok(html.includes("La gara delle piste · mese"));
  // Migliori per KPI del mese (Task #272): maturato, senza proiezione.
  assert.ok(html.includes("I migliori del mese"));
  assert.ok(html.includes('id="nav-month"'));
  assert.ok(html.includes("Tocca per il totale del mese"));
  assert.ok(html.includes("Tocca per tornare al giorno"));
});

await test("HTML: proiezione VF usa per ogni pista gli stessi colori del giornaliero", () => {
  const a = aggregateDailyReport([
    sale({ totale: "10", articoli: [art("UNTIED", 10)] }),
  ]);
  const proj = buildMonthEndProjection("2026-08-29", a, undefined, { model: "vf" });
  const html = buildVenditeReportHtml({
    orgName: "Phone&Phone",
    dateYMD: "2026-08-29",
    aggregates: a,
    history: [
      { ymd: "2026-08-28", aggregates: a },
      { ymd: "2026-08-29", aggregates: a },
    ],
    month: { label: "agosto 2026", aggregates: a },
    monthProjection: proj ?? undefined,
    content: {
      pisteVisibili: ["mobile", "fisso", "cb", "luce", "gas", "iva_mobile", "iva_wireline", "vas"],
      telcoPiste: ["mobile", "fisso"],
      newCorePiste: ["cb", "luce", "gas", "iva_mobile", "iva_wireline", "vas"],
    },
  });
  for (const [label, color] of [
    ["Luce", "#facc15"],
    ["Gas", "#fb923c"],
    ["IVA Mobile", "#93c5fd"],
    ["IVA Wireline", "#c4b5fd"],
    ["VAS", "#5eead4"],
  ]) {
    assert.ok(html.includes(`style="color:${color}`), `${label} deve usare il colore pista giornaliero`);
    assert.ok(html.includes(`background:linear-gradient(90deg,${color},${color}66)`), `${label} deve usare il gradiente pista giornaliero`);
  }
});

await test("HTML: history/trend disallineati ⇒ pagina senza trend, nessun crash, JSON label safe", () => {
  const html = buildVenditeReportHtml({
    orgName: "Org Test",
    dateYMD: "2026-07-03",
    aggregates: aggregateDailyReport([sale({ totale: "10" })]),
    // trend NON copre i giorni dello storico (finestre diverse).
    trend: [
      { ymd: "2026-06-01", vendite: 1, importo: 10, countByPista: {} },
      { ymd: "2026-06-02", vendite: 2, importo: 20, countByPista: {} },
    ],
    history: [
      { ymd: "2026-07-02", aggregates: aggregateDailyReport([sale({ totale: "5" })]) },
      { ymd: "2026-07-03", aggregates: aggregateDailyReport([sale({ totale: "10" })]) },
    ],
  });
  assert.ok(html.includes('data-page="d1">'));
  assert.ok(!html.includes("Andamento ·")); // trendSlice assente ⇒ niente grafico
  // ymd ostile non può chiudere il tag <script> (escape \u003c nel JSON).
  const evil = buildVenditeReportHtml({
    orgName: "Org",
    dateYMD: "2026-07-03",
    aggregates: aggregateDailyReport([]),
    history: [{ ymd: "</script><script>alert(1)//", aggregates: aggregateDailyReport([]) }],
  });
  assert.ok(!evil.includes("</script><script>alert"));
});

await test("HTML retrocompatibile: senza history niente nav né script", () => {
  const html = buildVenditeReportHtml({
    orgName: "Org Test",
    dateYMD: "2026-07-02",
    aggregates: aggregateDailyReport([sale({ totale: "50" })]),
  });
  assert.ok(!html.includes('id="nav-prev"'));
  assert.ok(!html.includes("<script>"));
  assert.ok(html.includes('data-page="d0"'));
});

console.log("\n— scheduler: msUntilNextSend / resolveTelegramConfig —");

const { msUntilNextSend } = await import("../server/telegramReportScheduler.ts").catch(() => ({}));

if (msUntilNextSend) {
  const romeOffsetMs = (date) => {
    // Trova l'istante UTC che a Roma corrisponde a un orario noto usando Intl.
    const fmt = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Rome",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    return fmt.format(date);
  };

  // Costruisce un Date il cui orario a Roma è hh:mm del 2 luglio 2026 (CEST, UTC+2).
  const romeDate = (hh, mm) => new Date(Date.UTC(2026, 6, 2, hh - 2, mm, 0));

  await test("alle 10:00 Roma il prossimo invio è alle 13:30 (~3h30m)", () => {
    const { delayMs, label } = msUntilNextSend(romeDate(10, 0));
    assert.equal(label, "13:30");
    const expected = 3.5 * 3600 * 1000;
    assert.ok(Math.abs(delayMs - expected) < 60_000, `delay ${delayMs} lontano da ${expected}`);
  });

  await test("alle 14:00 Roma il prossimo invio è alle 22:15 (nuovo default)", () => {
    const { delayMs, label } = msUntilNextSend(romeDate(14, 0));
    assert.equal(label, "22:15");
    const expected = 8.25 * 3600 * 1000;
    assert.ok(Math.abs(delayMs - expected) < 60_000);
  });

  await test("orari custom (Task #334): 21:00 configurato ⇒ prossimo invio 21:00", () => {
    const customTimes = [
      { label: "12:00", minutes: 12 * 60 },
      { label: "21:00", minutes: 21 * 60 },
    ];
    const { delayMs, label } = msUntilNextSend(romeDate(14, 0), customTimes);
    assert.equal(label, "21:00");
    assert.ok(Math.abs(delayMs - 7 * 3600 * 1000) < 60_000);
  });

  await test("orari custom non ordinati: sceglie comunque il più vicino", () => {
    const customTimes = [
      { label: "22:00", minutes: 22 * 60 },
      { label: "13:00", minutes: 13 * 60 },
      { label: "20:00", minutes: 20 * 60 },
    ];
    const { label } = msUntilNextSend(romeDate(14, 0), customTimes);
    assert.equal(label, "20:00");
  });

  await test("alle 23:00 Roma il prossimo invio è il 13:30 di domani", () => {
    const { delayMs, label } = msUntilNextSend(romeDate(23, 0));
    assert.equal(label, "13:30");
    const expected = 14.5 * 3600 * 1000;
    assert.ok(Math.abs(delayMs - expected) < 60_000);
  });

  // ── DST (Task #239 review): la notte del cambio ora ha 23h/25h — il
  // delay deve essere calcolato su epoch assoluti, non su giorni da 24h.
  await test("DST marzo (29/03/2026, giorno da 23h): 22:35 sab → 13:30 dom = ~13h55m", () => {
    // Sabato 28/03/2026 22:35 Roma = 21:35 UTC (CET, +1).
    const now = new Date(Date.UTC(2026, 2, 28, 21, 35, 0));
    const { delayMs, label } = msUntilNextSend(now);
    assert.equal(label, "13:30");
    // Domenica 29/03 13:30 Roma = 11:30 UTC (CEST, +2) ⇒ 13h55m reali.
    const expected = (13 * 60 + 55) * 60 * 1000;
    assert.ok(
      Math.abs(delayMs - expected) < 60_000,
      `delay ${delayMs} lontano da ${expected} (un calcolo a 24h fisse darebbe 14h55m)`,
    );
  });

  await test("DST ottobre (25/10/2026, giorno da 25h): 22:35 sab → 13:30 dom = ~15h55m", () => {
    // Sabato 24/10/2026 22:35 Roma = 20:35 UTC (CEST, +2).
    const now = new Date(Date.UTC(2026, 9, 24, 20, 35, 0));
    const { delayMs, label } = msUntilNextSend(now);
    assert.equal(label, "13:30");
    // Domenica 25/10 13:30 Roma = 12:30 UTC (CET, +1) ⇒ 15h55m reali.
    const expected = (15 * 60 + 55) * 60 * 1000;
    assert.ok(
      Math.abs(delayMs - expected) < 60_000,
      `delay ${delayMs} lontano da ${expected} (un calcolo a 24h fisse darebbe 14h55m)`,
    );
  });

  await test("DST: anche 13:30 → 22:15 nello STESSO giorno del cambio resta corretto", () => {
    // Domenica 29/03/2026 14:00 Roma = 12:00 UTC (CEST già attivo).
    const now = new Date(Date.UTC(2026, 2, 29, 12, 0, 0));
    const { delayMs, label } = msUntilNextSend(now);
    assert.equal(label, "22:15");
    const expected = 8.25 * 3600 * 1000; // 22:15 - 14:00, nessuna transizione in mezzo
    assert.ok(Math.abs(delayMs - expected) < 60_000, `delay ${delayMs} lontano da ${expected}`);
  });

  await test("rollover fine mese/anno: 31/12 23:00 → 13:30 dell'1/1", () => {
    // 31/12/2026 23:00 Roma = 22:00 UTC (CET).
    const now = new Date(Date.UTC(2026, 11, 31, 22, 0, 0));
    const { delayMs, label } = msUntilNextSend(now);
    assert.equal(label, "13:30");
    const expected = 14.5 * 3600 * 1000;
    assert.ok(Math.abs(delayMs - expected) < 60_000, `delay ${delayMs} lontano da ${expected}`);
  });

  // ── telegramSendTimes (Task #334): orari configurabili ──
  const { parseSendTimes, normalizeTimeLabel, fasciaForLabel, DEFAULT_SEND_TIMES } =
    await import("../shared/telegramSendTimes.ts");

  await test("normalizeTimeLabel: valida e normalizza HH:MM", () => {
    assert.equal(normalizeTimeLabel("9:05"), "09:05");
    assert.equal(normalizeTimeLabel(" 22:15 "), "22:15");
    assert.equal(normalizeTimeLabel("24:00"), null);
    assert.equal(normalizeTimeLabel("12:60"), null);
    assert.equal(normalizeTimeLabel("2:30"), null); // finestra DST
    assert.equal(normalizeTimeLabel("02:00"), null);
    assert.equal(normalizeTimeLabel("abc"), null);
    assert.equal(normalizeTimeLabel(1330), null);
  });

  await test("parseSendTimes: default, per-campo e orari uguali", () => {
    assert.deepEqual(parseSendTimes(undefined), DEFAULT_SEND_TIMES);
    assert.deepEqual(parseSendTimes({ parziale: "12:00", chiusura: "21:00" }),
      { parziale: "12:00", chiusura: "21:00" });
    // Campo invalido ⇒ default solo per quel campo.
    assert.deepEqual(parseSendTimes({ parziale: "x", chiusura: "21:00" }),
      { parziale: "13:30", chiusura: "21:00" });
    // Orari coincidenti ⇒ default completi.
    assert.deepEqual(parseSendTimes({ parziale: "21:00", chiusura: "21:00" }), DEFAULT_SEND_TIMES);
  });

  await test("fasciaForLabel: chiusura sul label configurato, fallback ≥18", () => {
    const times = { parziale: "13:30", chiusura: "22:15" };
    assert.equal(fasciaForLabel("22:15", times), "chiusura");
    assert.equal(fasciaForLabel("13:30", times), "parziale");
    // Orario inatteso: fallback sull'ora.
    assert.equal(fasciaForLabel("19:00", times), "chiusura");
    assert.equal(fasciaForLabel("11:00", times), "parziale");
    // Chiusura anticipata configurata prima delle 18 resta chiusura.
    assert.equal(fasciaForLabel("17:00", { parziale: "12:00", chiusura: "17:00" }), "chiusura");
  });

  // ── recoverableSlot (Task #332): recupero al boot della run interrotta ──
  const { recoverableSlot } = await import("../server/telegramReportScheduler.ts");

  await test("recoverableSlot: 35 min dopo le 22:15 ⇒ slot 22:15 di oggi", () => {
    const r = recoverableSlot(romeDate(22, 50));
    assert.deepEqual(r, { ymd: "2026-07-02", label: "22:15" });
  });

  await test("recoverableSlot con orari custom (Task #334)", () => {
    const customTimes = [
      { label: "12:00", minutes: 12 * 60 },
      { label: "21:00", minutes: 21 * 60 },
    ];
    assert.deepEqual(recoverableSlot(romeDate(21, 30), 90, customTimes), {
      ymd: "2026-07-02",
      label: "21:00",
    });
    assert.equal(recoverableSlot(romeDate(14, 0), 90, customTimes), null); // 12:00 + 120 min
  });

  await test("recoverableSlot: 45 min dopo le 13:30 ⇒ slot 13:30", () => {
    const r = recoverableSlot(romeDate(14, 15));
    assert.deepEqual(r, { ymd: "2026-07-02", label: "13:30" });
  });

  await test("recoverableSlot: oltre la finestra (default 90 min) ⇒ null", () => {
    assert.equal(recoverableSlot(romeDate(15, 1)), null); // 13:30 + 91 min
    assert.equal(recoverableSlot(romeDate(10, 0)), null); // nessuno slot passato oggi, ieri 22:30 lontano
  });

  await test("recoverableSlot: finestra custom", () => {
    // 15:30 = 120 min dopo le 13:30: dentro con finestra 130, fuori con 100.
    assert.deepEqual(recoverableSlot(romeDate(15, 30), 130), { ymd: "2026-07-02", label: "13:30" });
    assert.equal(recoverableSlot(romeDate(15, 30), 100), null);
  });

  await test("recoverableSlot: mai la chiusura di ieri dopo mezzanotte (giorno diverso)", () => {
    // 3 luglio 00:30 Roma (22:30 UTC del 2/7): 22:15 di ieri è a ~135 min
    // ma anche con finestra larga NON va recuperato — il report è del giorno.
    const after = new Date(Date.UTC(2026, 6, 2, 22, 30, 0)); // 00:30 Roma del 3/7
    assert.equal(recoverableSlot(after, 600), null);
  });

  await test("recoverableSlot: esattamente all'orario dello slot ⇒ recuperabile", () => {
    const r = recoverableSlot(romeDate(13, 30));
    assert.deepEqual(r, { ymd: "2026-07-02", label: "13:30" });
  });

  const { resolveTelegramConfig } = await import("../server/telegramReportScheduler.ts");

  await test("resolveTelegramConfig: null/disabled/incompleta ⇒ null", () => {
    assert.equal(resolveTelegramConfig(undefined), null);
    assert.equal(resolveTelegramConfig({ enabled: false, bot_token: "t", chat_id: "c" }), null);
    assert.equal(resolveTelegramConfig({ enabled: true, bot_token: "", chat_id: "c" }), null);
    assert.equal(resolveTelegramConfig({ enabled: true, bot_token: "t", chat_id: "  " }), null);
  });

  await test("resolveTelegramConfig: token in chiaro passthrough", () => {
    const r = resolveTelegramConfig({ enabled: true, bot_token: "123:abc", chat_id: "-100999" });
    assert.deepEqual(r, { botToken: "123:abc", chatId: "-100999" });
  });
} else {
  console.log("  (scheduler non importabile in questo ambiente — sezione saltata)");
  failed++;
}

// ── Redazione log (server/logRedact.ts) ──────────────────────────────
// Il logger API serializza i body JSON delle risposte: il replacer deve
// mascherare i segreti (bot token Telegram, client secret BiSuite,
// password SMTP) per non spillarli nei log runtime.
const { logJsonReplacer, isSensitiveLogKey } = await import("../server/logRedact.ts");

await test("logJsonReplacer: maschera bot_token/secret/password, lascia il resto", () => {
  const body = {
    enabled: true,
    bot_token: "123456:ABCdef",
    client_secret: "s3gr3t0",
    smtp_password: "pw",
    api_key: "k",
    authorization: "Bearer xyz",
    chat_id: "-100999",
    name: "Org 1",
    count: 5,
  };
  const out = JSON.parse(JSON.stringify(body, logJsonReplacer));
  assert.equal(out.bot_token, "[redacted]");
  assert.equal(out.client_secret, "[redacted]");
  assert.equal(out.smtp_password, "[redacted]");
  assert.equal(out.api_key, "[redacted]");
  assert.equal(out.authorization, "[redacted]");
  assert.equal(out.chat_id, "-100999");
  assert.equal(out.name, "Org 1");
  assert.equal(out.count, 5);
  assert.ok(!JSON.stringify(out).includes("ABCdef"));
});

await test("logJsonReplacer: annidato + array + stringa vuota non mascherata", () => {
  const body = { items: [{ token: "abc", label: "ok" }], nested: { password: "" } };
  const out = JSON.parse(JSON.stringify(body, logJsonReplacer));
  assert.equal(out.items[0].token, "[redacted]");
  assert.equal(out.items[0].label, "ok");
  assert.equal(out.nested.password, "");
});

await test("logJsonReplacer: data URL immagine lungo troncato, corto intatto", () => {
  const long = "data:image/png;base64," + "A".repeat(300);
  const out = JSON.parse(JSON.stringify({ img: long, icon: "data:image/png;base64,AA" }, logJsonReplacer));
  assert.ok(out.img.startsWith("[dataURL "));
  assert.equal(out.icon, "data:image/png;base64,AA");
});

await test("isSensitiveLogKey: match case-insensitive e varianti", () => {
  for (const k of ["bot_token", "BOT_TOKEN", "accessToken", "client_secret", "Password", "api-key", "cookie", "credentials"]) {
    assert.ok(isSensitiveLogKey(k), `${k} dovrebbe essere sensibile`);
  }
  for (const k of ["chat_id", "name", "enabled", "totale"]) {
    assert.ok(!isSensitiveLogKey(k), `${k} NON dovrebbe essere sensibile`);
  }
});

console.log("\n— dettaglio categorie + split pagamenti —");

// Helper: articolo con importi pagamento per-articolo.
function artPay(categoria, prezzo, { fin = 0, credito = 0 } = {}) {
  return {
    categoria: { nome: categoria },
    dettaglio: { prezzo: String(prezzo), importoFinanziato: String(fin), importoCredito: String(credito) },
  };
}
// Helper: vendita con mix pagamento scontrino.
function salePay({ articoli = [], pagamento = null, totale = "0" } = {}) {
  return { stato: "COMPLETATA", totale, codicePos: "POS1", nomeNegozio: "Negozio 1", nomeAddetto: null, rawData: { articoli, pagamento } };
}

await test("prodottiByCategoria: pezzi/importo per categoria, ordinati per importo↓", () => {
  const a = aggregateDailyReport([
    salePay({ articoli: [artPay("TELEFONIA", 500), artPay("ACCESSORI", 30), artPay("ACCESSORI", 20)] }),
    salePay({ articoli: [artPay("TELEFONIA", 300), artPay("UNTIED", 30)] }),
  ]);
  assert.deepEqual(a.prodottiByCategoria.map((c) => c.categoria), ["TELEFONIA", "ACCESSORI"]);
  const tel = a.prodottiByCategoria[0];
  assert.equal(tel.pezzi, 2);
  assert.equal(tel.importo, 800);
  const acc = a.prodottiByCategoria[1];
  assert.equal(acc.pezzi, 2);
  assert.equal(acc.importo, 50);
  // UNTIED è canvass: NON compare fra i prodotti.
  assert.ok(!a.prodottiByCategoria.some((c) => c.categoria === "UNTIED"));
});

await test("serviziByCategoria: fatturato e numero servizi separati dai prodotti", () => {
  const a = aggregateDailyReport([
    salePay({ articoli: [artPay("SPEDIZIONE", 5), artPay("ASSISTENZA", 25), artPay("TELEFONIA", 100)] }),
  ]);
  assert.deepEqual(a.serviziByCategoria.map((c) => c.categoria), ["ASSISTENZA", "SPEDIZIONE"]);
  assert.equal(a.serviziByCategoria.reduce((s, c) => s + c.pezzi, 0), 2);
  assert.equal(a.serviziByCategoria.reduce((s, c) => s + c.importo, 0), 30);
  assert.equal(a.countByType.servizi, 2);
  assert.equal(a.amountByType.servizi, 30);
});

await test("split pagamenti: finanziato/VAR esatti per-articolo, resto sul mix scontrino", () => {
  // Telefono 600: 500 finanziato, 100 sul mix (60 contanti / 40 POS).
  // Accessorio 40: tutto sul mix. Mix vendita: contanti 84, POS 56 (60/40%).
  const a = aggregateDailyReport([
    salePay({
      articoli: [artPay("TELEFONIA", 600, { fin: 500 }), artPay("ACCESSORI", 40)],
      pagamento: { contanti: "84", pagamentiElettronici: "56" },
    }),
  ]);
  const tel = a.prodottiByCategoria.find((c) => c.categoria === "TELEFONIA");
  assert.equal(tel.pagamenti.finanziato, 500);
  assert.ok(Math.abs(tel.pagamenti.contanti - 60) < 0.01);
  assert.ok(Math.abs(tel.pagamenti.pos - 40) < 0.01);
  assert.equal(tel.pagamenti.varCredito, 0);
  assert.equal(tel.pagamenti.altro, 0);
  const acc = a.prodottiByCategoria.find((c) => c.categoria === "ACCESSORI");
  assert.ok(Math.abs(acc.pagamenti.contanti - 24) < 0.01);
  assert.ok(Math.abs(acc.pagamenti.pos - 16) < 0.01);
  // Lo split somma al fatturato della categoria.
  const sum = Object.values(tel.pagamenti).reduce((s, v) => s + v, 0);
  assert.ok(Math.abs(sum - tel.importo) < 0.01);
});

await test("split pagamenti: VAR (credito), mix con bonifici in `altro`, vendita senza mix ⇒ altro", () => {
  const a = aggregateDailyReport([
    salePay({
      articoli: [artPay("SMART DEVICE", 200, { credito: 200 }), artPay("ACCESSORI", 50)],
      pagamento: { contanti: "0", bonifici: "50" },
    }),
    salePay({ articoli: [artPay("ACCESSORI", 10)] }), // nessun pagamento nel rawData
  ]);
  const sd = a.prodottiByCategoria.find((c) => c.categoria === "SMART DEVICE");
  assert.equal(sd.pagamenti.varCredito, 200);
  assert.equal(sd.pagamenti.contanti + sd.pagamenti.pos + sd.pagamenti.altro, 0);
  const acc = a.prodottiByCategoria.find((c) => c.categoria === "ACCESSORI");
  // 50 via bonifici (mix "altro") + 10 senza mix ⇒ altro.
  assert.ok(Math.abs(acc.pagamenti.altro - 60) < 0.01);
  assert.equal(acc.pagamenti.contanti, 0);
});

await test("split pagamenti: fin+VAR > prezzo ⇒ cappati, somma bucket == importo", () => {
  // Dati sporchi: finanziato 500 + credito 200 su un prezzo di 600.
  const a = aggregateDailyReport([
    salePay({ articoli: [artPay("TELEFONIA", 600, { fin: 500, credito: 200 })] }),
  ]);
  const tel = a.prodottiByCategoria.find((c) => c.categoria === "TELEFONIA");
  assert.equal(tel.pagamenti.finanziato, 500);
  assert.equal(tel.pagamenti.varCredito, 100); // cappato al residuo
  const sum = Object.values(tel.pagamenti).reduce((s, v) => s + v, 0);
  assert.ok(Math.abs(sum - tel.importo) < 0.01, `sum=${sum} importo=${tel.importo}`);
  assert.ok(Object.values(tel.pagamenti).every((v) => v >= 0));
});

await test("split pagamenti: mix con valori negativi ⇒ clampati, nessun bucket negativo", () => {
  const a = aggregateDailyReport([
    salePay({
      articoli: [artPay("ACCESSORI", 100)],
      pagamento: { contanti: "-50", pagamentiElettronici: "100" },
    }),
    salePay({
      articoli: [artPay("SMART DEVICE", 80)],
      pagamento: { contanti: "-10", bonifici: "-5" }, // mix effettivo nullo
    }),
  ]);
  const acc = a.prodottiByCategoria.find((c) => c.categoria === "ACCESSORI");
  assert.equal(acc.pagamenti.contanti, 0); // il -50 non pesa
  assert.ok(Math.abs(acc.pagamenti.pos - 100) < 0.01);
  const sd = a.prodottiByCategoria.find((c) => c.categoria === "SMART DEVICE");
  assert.ok(Math.abs(sd.pagamenti.altro - 80) < 0.01); // fallback mix nullo
  for (const c of a.prodottiByCategoria) {
    assert.ok(Object.values(c.pagamenti).every((v) => v >= 0), `bucket negativo in ${c.categoria}`);
  }
});

await test("HTML: card Prodotti per categoria e Servizi con chip pagamenti", () => {
  const rows = [
    salePay({
      totale: "735",
      articoli: [artPay("TELEFONIA", 600, { fin: 500 }), artPay("ACCESSORI", 40), artPay("SPEDIZIONE", 5), artPay("UNTIED", 90)],
      pagamento: { contanti: "135", pagamentiElettronici: "0" },
    }),
  ];
  const html = buildVenditeReportHtml({
    orgName: "Org Test",
    dateYMD: "2026-07-02",
    aggregates: aggregateDailyReport(rows),
  });
  assert.ok(html.includes("Prodotti per categoria"), "manca la card prodotti");
  assert.ok(html.includes(">Servizi (netto IVA) <span"), "manca la card servizi");
  assert.ok(html.includes("TELEFONIA"), "manca la categoria TELEFONIA");
  assert.ok(html.includes("🏦 Finanziato 500,00 €"), "manca il chip finanziato");
  assert.ok(html.includes("💵 Contanti"), "manca il chip contanti");
  // Sottotitolo con i totali della sezione servizi (1 pz · 5 €).
  assert.ok(html.includes("1 pz · 5,00 €"), "manca il totale servizi nel sottotitolo");
});

await test("HTML: giornata senza prodotti/servizi ⇒ card assenti", () => {
  const html = buildVenditeReportHtml({
    orgName: "Org Test",
    dateYMD: "2026-07-02",
    aggregates: aggregateDailyReport([salePay({ totale: "30", articoli: [artPay("UNTIED", 30)] })]),
  });
  assert.ok(!html.includes("Prodotti per categoria"));
  assert.ok(!html.includes(">Servizi (netto IVA) <span"));
});

console.log("\n— drill-down negozio/addetto (Task #251) —");

await test("dettaglio per-PDV: canvass per pista + categorie prodotti/servizi con fatturato", () => {
  const a = aggregateDailyReport([
    { ...sale({ codicePos: "A", nomeNegozio: "Alfa", totale: "130", articoli: [art("UNTIED", 30), art("TELEFONIA", 100)] }), nomeAddetto: "Mario" },
    { ...sale({ codicePos: "A", nomeNegozio: "Alfa", totale: "55", articoli: [art("UNTIED", 30), art("ADSL/FIBRA/FWA CF", 20), art("SPEDIZIONE", 5)] }), nomeAddetto: "Luigi" },
    { ...sale({ codicePos: "B", nomeNegozio: "Beta", totale: "20", articoli: [art("ENERGIA W3", 20)] }), nomeAddetto: "Mario" },
    { ...sale({ codicePos: "A", stato: "ANNULLATA", totale: "99", articoli: [art("UNTIED", 99), art("TELEFONIA", 99)] }) },
  ]);
  const pdvA = a.perPdv.find((p) => p.codicePos === "A");
  // Canvass per pista SOLO del PDV A (annullata esclusa).
  assert.deepEqual(pdvA.dettaglio.countByPista, { mobile: 2, fisso: 1 });
  // Prodotti e servizi con pezzi + fatturato.
  assert.deepEqual(pdvA.dettaglio.prodottiByCategoria, [{ categoria: "TELEFONIA", pezzi: 1, importo: 100 }]);
  assert.deepEqual(pdvA.dettaglio.serviziByCategoria, [{ categoria: "SPEDIZIONE", pezzi: 1, importo: 5 }]);
  const pdvB = a.perPdv.find((p) => p.codicePos === "B");
  assert.deepEqual(pdvB.dettaglio.countByPista, { energia: 1 });
  assert.deepEqual(pdvB.dettaglio.prodottiByCategoria, []);
  assert.deepEqual(pdvB.dettaglio.serviziByCategoria, []);
});

await test("dettaglio per-addetto: fusione case-insensitive, N/D, ordinamento categorie per fatturato↓", () => {
  const a = aggregateDailyReport([
    { ...sale({ totale: "130", articoli: [art("UNTIED", 30), art("ACCESSORI", 20), art("TELEFONIA", 500)] }), nomeAddetto: "Mario Rossi" },
    { ...sale({ totale: "40", articoli: [art("TIED CF", 40), art("ACCESSORI", 15)] }), nomeAddetto: "MARIO ROSSI " },
    { ...sale({ totale: "5", articoli: [art("SPEDIZIONE", 5)] }), nomeAddetto: null },
  ]);
  const mario = a.perAddetto.find((x) => x.nomeAddetto === "Mario Rossi");
  assert.deepEqual(mario.dettaglio.countByPista, { mobile: 2 }); // UNTIED + TIED CF fusi
  // Ordinati per fatturato decrescente: TELEFONIA(500) prima di ACCESSORI(35).
  assert.deepEqual(mario.dettaglio.prodottiByCategoria, [
    { categoria: "TELEFONIA", pezzi: 1, importo: 500 },
    { categoria: "ACCESSORI", pezzi: 2, importo: 35 },
  ]);
  assert.deepEqual(mario.dettaglio.serviziByCategoria, []);
  const nd = a.perAddetto.find((x) => x.nomeAddetto === "N/D");
  assert.deepEqual(nd.dettaglio.serviziByCategoria, [{ categoria: "SPEDIZIONE", pezzi: 1, importo: 5 }]);
});

await test("HTML: righe PDV/addetto toccabili (<details>) con pannello drill-down", () => {
  const aggregates = aggregateDailyReport([
    { ...sale({ codicePos: "P1", nomeNegozio: "Centro", totale: "135", articoli: [art("UNTIED", 30), art("TELEFONIA", 100), art("SPEDIZIONE", 5)] }), nomeAddetto: "Mario Rossi" },
  ]);
  const html = buildVenditeReportHtml({
    orgName: "Org Test",
    dateYMD: "2026-07-02",
    aggregates,
  });
  // Riga = <details> con summary toccabile e hint.
  assert.ok(html.includes('<details class="rank"><summary>'));
  assert.ok(html.includes("Tocca per il dettaglio ▾"));
  // Pannello: canvass per pista con tema colore + categorie con fatturato.
  assert.ok(html.includes('<div class="drill">'));
  assert.ok(html.includes("Canvass per pista"));
  assert.ok(html.includes('<b style="color:#60a5fa">Mobile</b> ×1'));
  assert.ok(html.includes("Accessori e prodotti"));
  assert.ok(html.includes(">TELEFONIA</span><span class=\"drill-val\">1 pz · 100,00 €</span>"));
  assert.ok(html.includes(">SPEDIZIONE</span><span class=\"drill-val\">1 pz · 5,00 €</span>"));
  // Drill sia nella card PDV sia in quella addetti (2 pannelli).
  assert.equal(html.split('<div class="drill">').length - 1, 2);
  // Nessuno script necessario: toggle nativo <details>.
  assert.ok(!html.includes("<script>"));
});

await test("HTML: riga senza articoli ⇒ nessun <details>, resta un div semplice", () => {
  const aggregates = aggregateDailyReport([sale({ codicePos: "P1", nomeNegozio: "Centro", totale: "10" })]);
  const html = buildVenditeReportHtml({
    orgName: "Org Test",
    dateYMD: "2026-07-02",
    aggregates,
  });
  assert.ok(html.includes("Per punto vendita"));
  assert.ok(!html.includes("<details"));
  assert.ok(!html.includes('<div class="drill">'));
  assert.ok(html.includes('<div class="rank">'));
});

await test("HTML navigabile: drill-down presente anche nelle pagine storico e Totale mese", () => {
  const mkAgg = () => aggregateDailyReport([
    { ...sale({ codicePos: "P1", nomeNegozio: "Centro", totale: "30", articoli: [art("UNTIED", 30)] }), nomeAddetto: "Mario" },
  ]);
  const html = buildVenditeReportHtml({
    orgName: "Org Test",
    dateYMD: "2026-07-03",
    aggregates: mkAgg(),
    history: [
      { ymd: "2026-07-02", aggregates: mkAgg() },
      { ymd: "2026-07-03", aggregates: mkAgg() },
    ],
    month: { label: "luglio 2026", aggregates: mkAgg() },
  });
  // 3 pagine (d0, d1, month) × 2 card (PDV + addetti) = 6 pannelli.
  assert.equal(html.split('<div class="drill">').length - 1, 6);
  assert.ok(html.includes('<details class="rank">'));
});

console.log("\n— arricchimenti report (Task #263) —");

// Helper: vendita con blocco cliente in rawData (per lo split energia).
function saleCli({ cliente = null, articoli = [], totale = "0", stato = "COMPLETATA" } = {}) {
  return { stato, totale, codicePos: "POS1", nomeNegozio: "Negozio 1", nomeAddetto: null, rawData: { articoli, cliente } };
}

await test("saleCustomerKind: GIURIDICA/PROFESSIONISTA ⇒ business (anche senza P.IVA)", () => {
  assert.equal(saleCustomerKind({ cliente: { clienteTipo: "GIURIDICA", piva: "12345678901" } }), "business");
  assert.equal(saleCustomerKind({ cliente: { clienteTipo: "PROFESSIONISTA", piva: "12345678901", codiceFiscale: "RSSMRA80A01H501U" } }), "business");
  // Regola OR: azienda senza P.IVA (o con solo CF) resta business.
  assert.equal(saleCustomerKind({ cliente: { clienteTipo: "GIURIDICA" } }), "business");
  assert.equal(saleCustomerKind({ cliente: { clienteTipo: "GIURIDICA", codiceFiscale: "RSSMRA80A01H501U" } }), "business");
});

await test("saleCustomerKind: CF senza azienda ⇒ privato; solo P.IVA ⇒ business; vuoto ⇒ privato", () => {
  assert.equal(saleCustomerKind({ cliente: { codiceFiscale: "RSSMRA80A01H501U" } }), "privato");
  assert.equal(saleCustomerKind({ cliente: { clienteTipo: "FISICA", codiceFiscale: "RSSMRA80A01H501U" } }), "privato");
  assert.equal(saleCustomerKind({ cliente: { piva: "12345678901" } }), "business");
  assert.equal(saleCustomerKind({ cliente: {} }), "privato");
  assert.equal(saleCustomerKind(null), "privato");
});

await test("energiaClienteFromDescrizione: Business ⇐ descrizione con BUSINESS/MICROBUSINESS; altrimenti CF", () => {
  assert.equal(energiaClienteFromDescrizione("LUCE MICROBUSINESS - DOMICILIAZIONE BANCARIA"), "business");
  assert.equal(energiaClienteFromDescrizione("CLIENTE BUSINESS CON DOMICILIAZIONE BANCARIA"), "business");
  assert.equal(energiaClienteFromDescrizione("LUCE - DOMICILIAZIONE BANCARIA"), "privato");
  assert.equal(energiaClienteFromDescrizione("CLIENTE CONSUMER"), "privato");
  assert.equal(energiaClienteFromDescrizione(""), "privato");
});

await test("energiaByCliente: split CF/IVA dalla DESCRIZIONE offerta, non dal tipo cliente, solo pista energia", () => {
  const a = aggregateDailyReport([
    // Offerta consumer venduta a cliente registrato business ⇒ resta CF (conta la descrizione).
    saleCli({ cliente: { clienteTipo: "GIURIDICA", piva: "1" }, totale: "20", articoli: [art("ENERGIA W3", 20, { descrizione: "LUCE - DOMICILIAZIONE BANCARIA" })] }),
    // Offerta MICROBUSINESS venduta a cliente CF ⇒ IVA (conta la descrizione).
    saleCli({ cliente: { codiceFiscale: "RSSMRA80A01H501U" }, totale: "50", articoli: [art("ENERGIA W3", 30, { descrizione: "GAS MICROBUSINESS - BOLLETTINO POSTALE" }), art("ENERGIA W3", 20, { descrizione: "LUCE MICROBUSINESS - DOMICILIAZIONE BANCARIA" })] }),
    // Mobile: non deve toccare l'energia.
    saleCli({ totale: "40", articoli: [art("UNTIED", 40)] }),
  ]);
  assert.deepEqual(a.energiaByCliente.privato, { pezzi: 1, importo: 20 });
  assert.deepEqual(a.energiaByCliente.business, { pezzi: 2, importo: 50 });
});

await test("energiaByCliente: sempre presente a zero senza vendite energia", () => {
  const a = aggregateDailyReport([saleCli({ cliente: { codiceFiscale: "X" }, articoli: [art("UNTIED", 30)] })]);
  assert.deepEqual(a.energiaByCliente, { privato: { pezzi: 0, importo: 0 }, business: { pezzi: 0, importo: 0 } });
});

await test("assicurazioniDettaglio: per categoria con pezzi/importo, ordinato per pezzi↓", () => {
  const a = aggregateDailyReport([
    saleCli({ articoli: [art("ASSICURAZIONI", 100), art("ASSICURAZIONI", 50), art("WINDTRE SECURITY PRO GA", 30)] }),
    saleCli({ articoli: [art("ASSICURAZIONI BUSINESS PRO", 200)] }),
  ]);
  assert.deepEqual(a.assicurazioniDettaglio.map((c) => c.categoria), [
    "ASSICURAZIONI",
    "ASSICURAZIONI BUSINESS PRO",
    "WINDTRE SECURITY PRO GA",
  ]);
  assert.deepEqual(a.assicurazioniDettaglio[0], { categoria: "ASSICURAZIONI", pezzi: 2, importo: 150 });
});

await test("telefoniPezziOf: pezzi della categoria TELEFONIA, 0 se assente", () => {
  const a = aggregateDailyReport([saleCli({ articoli: [art("TELEFONIA", 500), art("TELEFONIA", 300), art("ACCESSORI", 10)] })]);
  assert.equal(telefoniPezziOf(a), 2);
  assert.equal(telefoniPezziOf(aggregateDailyReport([])), 0);
});

await test("monthWorkingDays: giorni lavorativi trascorsi/totali, input non valido ⇒ null", () => {
  // Luglio 2026: 23 giorni lavorativi (festività: nessuna infrasettimanale a luglio).
  const wd = monthWorkingDays("2026-07-15");
  assert.ok(wd !== null);
  assert.ok(wd.total >= 22 && wd.total <= 23, `total=${wd.total}`);
  assert.ok(wd.elapsed > 0 && wd.elapsed <= wd.total);
  assert.equal(monthWorkingDays("not-a-date"), null);
});

await test("projectMonthEnd: proporzione lineare; giorni non positivi ⇒ null", () => {
  assert.equal(projectMonthEnd(100, 10, 20), 200);
  assert.equal(projectMonthEnd(0, 10, 20), 0);
  assert.equal(projectMonthEnd(100, 0, 20), null);
  assert.equal(projectMonthEnd(100, 10, 0), null);
});

await test("buildMonthEndProjection: un KPI per riga, maturato+proiezione arrotondati", () => {
  const monthAgg = aggregateDailyReport([
    saleCli({ articoli: [art("UNTIED", 30), art("TELEFONIA", 500)] }),
    saleCli({ articoli: [art("ADSL/FIBRA/FWA CF", 20)] }),
  ]);
  const proj = buildMonthEndProjection("2026-07-15", monthAgg);
  assert.ok(proj !== null);
  const kpi = (key) => proj.kpis.find((k) => k.key === key);
  // Nessuna riga "Canvass totali": solo KPI per pista + telefoni + acc/serv.
  assert.equal(proj.kpis.find((k) => /canvass totali/i.test(k.label)), undefined);
  assert.equal(kpi("mobile").maturato, 1); // UNTIED ⇒ pista mobile
  assert.equal(kpi("fisso").maturato, 1); // ADSL/FIBRA/FWA CF ⇒ pista fisso
  assert.equal(kpi("telefoni").maturato, 1); // 1 TELEFONIA
  assert.equal(kpi("telefoni").unit, "pz");
  assert.equal(kpi("accessori").unit, "€");
  assert.equal(kpi("servizi").unit, "€");
  const tel = kpi("telefoni");
  assert.ok(Number.isInteger(tel.proiezione));
  assert.ok(tel.proiezione >= tel.maturato);
  assert.equal(proj.label, "luglio 2026");
  assert.equal(buildMonthEndProjection("bad", monthAgg), null);
});

await test("blendedWorkingDays: senza conteggi ⇒ giorni feriali (lun–sab, > mon-fri)", () => {
  // Luglio 2026: nessuna festività infrasettimanale.
  const wdt = monthWorkingDaysByType("2026-07-15");
  const feriali = blendedWorkingDays("2026-07-15"); // nessun conteggio negozi
  assert.ok(feriali !== null);
  // Il fallback usa il calendario "strada" = lun–sab (esclude domeniche+festivi).
  assert.equal(feriali.total, wdt.strada.total);
  // I feriali (lun–sab) sono più dei giorni lun–ven usati da monthWorkingDays.
  const monfri = monthWorkingDays("2026-07-15");
  assert.ok(feriali.total > monfri.total, `feriali=${feriali.total} monfri=${monfri.total}`);
  assert.ok(feriali.elapsed <= feriali.total);
  assert.equal(blendedWorkingDays("bad"), null);
});

await test("blendedWorkingDays: con conteggi CC/strada ⇒ media pesata dei due calendari", () => {
  const wdt = monthWorkingDaysByType("2026-07-15");
  // Solo negozi CC ⇒ calendario CC (include le domeniche).
  const soloCc = blendedWorkingDays("2026-07-15", { numeroNegoziCc: 3, numeroNegoziStrada: 0 });
  assert.equal(soloCc.total, wdt.cc.total);
  assert.equal(soloCc.elapsed, wdt.cc.elapsed);
  // Solo negozi strada ⇒ calendario strada.
  const soloStrada = blendedWorkingDays("2026-07-15", { numeroNegoziCc: 0, numeroNegoziStrada: 5 });
  assert.equal(soloStrada.total, wdt.strada.total);
  // Mix ⇒ media pesata compresa fra i due totali.
  const mix = blendedWorkingDays("2026-07-15", { numeroNegoziCc: 1, numeroNegoziStrada: 1 });
  const atteso = (wdt.cc.total + wdt.strada.total) / 2;
  assert.ok(Math.abs(mix.total - atteso) < 1e-9, `mix=${mix.total} atteso=${atteso}`);
  assert.ok(mix.total >= wdt.strada.total && mix.total <= wdt.cc.total);
});

await test("buildMonthEndProjection: i conteggi CC/strada cambiano i giorni lavorativi e la stima", () => {
  const monthAgg = aggregateDailyReport(
    Array.from({ length: 40 }, () => saleCli({ articoli: [art("UNTIED", 30)] })),
  );
  const feriali = buildMonthEndProjection("2026-07-15", monthAgg);
  const conCc = buildMonthEndProjection("2026-07-15", monthAgg, { numeroNegoziCc: 4, numeroNegoziStrada: 0 });
  assert.ok(feriali !== null && conCc !== null);
  // CC lavora anche la domenica ⇒ più giorni totali dei soli feriali.
  assert.ok(conCc.totalWorkingDays > feriali.totalWorkingDays,
    `cc=${conCc.totalWorkingDays} feriali=${feriali.totalWorkingDays}`);
  // Stesso maturato, calendari diversi ⇒ proiezioni (grezze) diverse.
  const mat = feriali.kpis.find((k) => k.key === "mobile").maturato;
  const rawFeriali = projectMonthEnd(mat, feriali.elapsedWorkingDays, feriali.totalWorkingDays);
  const rawCc = projectMonthEnd(mat, conCc.elapsedWorkingDays, conCc.totalWorkingDays);
  assert.notEqual(rawFeriali, rawCc);
});

await test("messaggio: con forecast + monthAggregates ⇒ passo mensile e proiezione nel commento", () => {
  const today = aggregateDailyReport([
    saleCli({ totale: "540", articoli: [art("TELEFONIA", 500), art("ACCESSORI", 40)] }),
  ]);
  const monthAgg = aggregateDailyReport([
    saleCli({ totale: "540", articoli: [art("TELEFONIA", 500), art("ACCESSORI", 40)] }),
    saleCli({ totale: "30", articoli: [art("UNTIED", 30)] }),
  ]);
  const msg = buildTelegramReportMessage({
    orgName: "Org",
    dateYMD: "2026-07-15",
    timeLabel: "22:30",
    aggregates: today,
    monthAggregates: monthAgg,
    forecast: parseForecastConfig({ mobileVolumi: 100, telefoniPezzi: 60, accessoriFatturato: 2000 }),
  });
  // Fascia chiusura ⇒ apertura notturna 🌙 e lead "In chiusura".
  assert.ok(msg.includes("🌙"));
  assert.ok(msg.includes("In chiusura"));
  // Framing mensile: passo + proiezione + obiettivo.
  assert.ok(msg.includes("Sul mese"));
  assert.ok(/proiezione/.test(msg));
  assert.ok(/obiettivo/.test(msg));
  // Nessuna vecchia sezione elenco.
  assert.ok(!msg.includes("Fatturato prodotti/servizi"));
  assert.ok(!msg.includes("Proiezione fine mese"));
});

await test("messaggio: sezioni per-pista sono elenchi puntati (una riga per pista)", () => {
  const today = aggregateDailyReport([
    saleCli({ totale: "540", articoli: [art("TELEFONIA", 500), art("ACCESSORI", 40)] }),
    saleCli({ totale: "30", articoli: [art("UNTIED", 30)] }),
  ]);
  const monthAgg = aggregateDailyReport([
    saleCli({ totale: "540", articoli: [art("TELEFONIA", 500), art("ACCESSORI", 40)] }),
    saleCli({ totale: "30", articoli: [art("UNTIED", 30)] }),
  ]);
  const msg = buildTelegramReportMessage({
    orgName: "Org",
    dateYMD: "2026-07-15",
    timeLabel: "22:30",
    aggregates: today,
    monthAggregates: monthAgg,
    forecast: parseForecastConfig({ mobileVolumi: 100, telefoniPezzi: 60, accessoriFatturato: 2000 }),
  });
  // Impaginazione a blocchi: presenza di righe vuote di separazione.
  assert.ok(msg.includes("\n\n"));
  // Elenco puntato per pista nella sezione giornata.
  assert.ok(/Dettaglio di giornata:\n• /.test(msg), "manca l'elenco puntato della giornata");
  // Elenco puntato per pista nella sezione mese.
  assert.ok(/Sul mese[^]*\n• /.test(msg), "manca l'elenco puntato del mese");
  // Ogni pista del mese è su una riga bullet a sé.
  const bulletLines = msg.split("\n").filter((l) => l.startsWith("• "));
  assert.ok(bulletLines.length >= 3, `attese più righe bullet, trovate ${bulletLines.length}`);
  // I bullet del mese mantengono proiezione + obiettivo.
  assert.ok(bulletLines.some((l) => /proiezione/.test(l) && /obiettivo/.test(l)));
});

await test("messaggio: senza forecast nessun framing mensile ma commento presente", () => {
  const aggregates = aggregateDailyReport([saleCli({ totale: "30", articoli: [art("UNTIED", 30)] })]);
  const msg = buildTelegramReportMessage({ orgName: "Org", dateYMD: "2026-07-15", aggregates });
  assert.ok(!msg.includes("Proiezione fine mese"));
  assert.ok(!msg.includes("Sul mese"));
  // Il commento della giornata resta comunque presente.
  assert.ok(msg.includes("<b>1 vendite</b>"));
});

await test("commento: varietà deterministica per data — stesso giorno identico, giorni diversi variano (Task #266)", () => {
  const aggregates = aggregateDailyReport([
    saleCli({ codicePos: "P1", nomeNegozio: "Centro", totale: "130", articoli: [art("UNTIED", 30), art("TELEFONIA", 100)] }),
  ]);
  const mk = (ymd) => buildTelegramReportMessage({ orgName: "Org", dateYMD: ymd, timeLabel: "13:30", aggregates });
  // Stessa data ⇒ testo identico (determinismo).
  assert.equal(mk("2026-07-15"), mk("2026-07-15"));
  // Su un arco di date il testo non è sempre identico (la varietà cambia).
  const variants = new Set();
  for (let d = 1; d <= 20; d++) variants.add(mk(`2026-07-${String(d).padStart(2, "0")}`));
  assert.ok(variants.size > 1, "il commento deve variare fra date diverse");
});

await test("HTML: chip pista Assicurazioni = descrizione prodotto; Energia = CF/IVA; niente card duplicate sotto (Task #264)", () => {
  const rows = [
    // Energia: una consumer (CF) e una microbusiness (IVA) ⇒ chip CF/IVA.
    saleCli({ totale: "20", articoli: [art("ENERGIA W3", 20, { descrizione: "LUCE - DOMICILIAZIONE BANCARIA" })] }),
    saleCli({ totale: "50", articoli: [art("ENERGIA W3", 50, { descrizione: "LUCE MICROBUSINESS - DOMICILIAZIONE BANCARIA" })] }),
    saleCli({
      totale: "150",
      articoli: [
        art("ASSICURAZIONI", 100, { tipologia: "ASSICURAZIONI CASA", descrizione: "CASA ELETTRODOMESTICI" }),
        art("ASSICURAZIONI", 50, { tipologia: "ASSICURAZIONI MOBILITY", descrizione: "VIAGGI E VACANZE" }),
      ],
    }),
  ];
  const html = buildVenditeReportHtml({ orgName: "Org", dateYMD: "2026-07-15", aggregates: aggregateDailyReport(rows) });
  // I chip della card "La gara delle piste" mostrano il dettaglio inline.
  assert.ok(html.includes(`<span class="chip">CASA ELETTRODOMESTICI ×1</span>`), "manca il chip descrizione assicurazione");
  assert.ok(html.includes(`<span class="chip">VIAGGI E VACANZE ×1</span>`), "manca il secondo chip descrizione assicurazione");
  assert.ok(html.includes(`<span class="chip">CF ×1</span>`), "manca il chip energia CF");
  assert.ok(html.includes(`<span class="chip">IVA ×1</span>`), "manca il chip energia IVA");
  // Le card dedicate sotto sono state rimosse: nessuna duplicazione.
  assert.ok(!html.includes(">Assicurazioni <span"), "la card Assicurazioni dedicata non deve più esistere");
  assert.ok(!html.includes("Energia · Privati vs Business"), "la card Energia dedicata non deve più esistere");
  // "Assicurazioni" compare solo come nome pista, non come titolo card.
  assert.ok(html.includes(`>Assicurazioni</span>`), "manca il nome pista Assicurazioni");
});

await test("assicurazioniDettaglio: raggruppa per descrizione prodotto (tipologia — descrizione), non per bucket pista", () => {
  const a = aggregateDailyReport([
    saleCli({
      articoli: [
        art("ASSICURAZIONI", 100, { tipologia: "ASSICURAZIONI CASA", descrizione: "FULL" }),
        art("ASSICURAZIONI", 80, { tipologia: "ASSICURAZIONI CASA", descrizione: "FULL" }),
        art("ASSICURAZIONI", 50, { tipologia: "ASSICURAZIONI PERSONA", descrizione: "BASE" }),
      ],
    }),
  ]);
  assert.deepEqual(a.assicurazioniDettaglio.map((c) => c.categoria), [
    "ASSICURAZIONI CASA — FULL",
    "ASSICURAZIONI PERSONA — BASE",
  ]);
  assert.deepEqual(a.assicurazioniDettaglio[0], { categoria: "ASSICURAZIONI CASA — FULL", pezzi: 2, importo: 180 });
});

await test("HTML: card Proiezione fine mese solo nella pagina mese", () => {
  const monthAgg = aggregateDailyReport([saleCli({ articoli: [art("UNTIED", 30), art("TELEFONIA", 500)] })]);
  const proj = buildMonthEndProjection("2026-07-15", monthAgg);
  const html = buildVenditeReportHtml({
    orgName: "Org",
    dateYMD: "2026-07-15",
    aggregates: aggregateDailyReport([saleCli({ articoli: [art("UNTIED", 30)] })]),
    month: { label: "luglio 2026", aggregates: monthAgg },
    monthProjection: proj,
  });
  assert.ok(html.includes("Proiezione fine mese"), "manca la card proiezione");
  // La card proiezione è nella pagina mese (data-page="month").
  const monthPage = html.slice(html.indexOf('data-page="month"'));
  assert.ok(monthPage.includes("Proiezione fine mese"));
});

console.log("\n— parseForecastConfig / hasForecast / fasciaFromTimeLabel —");

await test("parseForecastConfig: stringhe/virgole ⇒ numeri; vuoti/≤0/NaN ⇒ null", () => {
  const fc = parseForecastConfig({
    mobileVolumi: "240",
    telefoniPezzi: 120,
    accessoriFatturato: "5.000,50".replace(".", ""), // "5000,50"
    serviziFatturato: "",
    numeroNegoziCc: 0,
    numeroNegoziStrada: "abc",
  });
  assert.equal(fc.mobileVolumi, 240);
  assert.equal(fc.telefoniPezzi, 120);
  assert.equal(fc.accessoriFatturato, 5000.5);
  assert.equal(fc.serviziFatturato, null);
  assert.equal(fc.numeroNegoziCc, null); // 0 ⇒ null
  assert.equal(fc.numeroNegoziStrada, null);
});

await test("parseForecastConfig: input null/undefined ⇒ EMPTY_FORECAST", () => {
  assert.deepEqual(parseForecastConfig(null), EMPTY_FORECAST);
  assert.deepEqual(parseForecastConfig(undefined), EMPTY_FORECAST);
});

await test("hasForecast: vero solo con almeno una dimensione valutabile", () => {
  assert.equal(hasForecast(EMPTY_FORECAST), false);
  assert.equal(hasForecast(parseForecastConfig({ numeroNegoziCc: 4 })), false); // solo divisore
  assert.equal(hasForecast(parseForecastConfig({ numeroNegoziStrada: 4 })), false); // solo divisore
  assert.equal(hasForecast(parseForecastConfig({ mobileVolumi: 10 })), true);
});

await test("fasciaFromTimeLabel: 22:xx ⇒ chiusura, resto ⇒ parziale", () => {
  assert.equal(fasciaFromTimeLabel("22:30"), "chiusura");
  assert.equal(fasciaFromTimeLabel("13:30"), "parziale");
  assert.equal(fasciaFromTimeLabel(""), "parziale");
  assert.equal(fasciaFromTimeLabel(null), "parziale");
  assert.equal(fasciaFromTimeLabel(undefined), "parziale");
});

console.log("\n— buildDirettoreCommento —");

const cjToday = aggregateDailyReport([
  sale({ codicePos: "P1", nomeNegozio: "Centro", nomeAddetto: "Mario Rossi", totale: "540", articoli: [art("UNTIED", 30), art("TELEFONIA", 500), art("ACCESSORI", 40)] }),
]);
const cjMonth = aggregateDailyReport([
  sale({ codicePos: "P1", nomeNegozio: "Centro", totale: "540", articoli: [art("UNTIED", 30), art("TELEFONIA", 500), art("ACCESSORI", 40)] }),
  sale({ codicePos: "P2", nomeNegozio: "Mare", totale: "60", articoli: [art("UNTIED", 30), art("UNTIED", 30)] }),
]);
const cjForecast = parseForecastConfig({ mobileVolumi: 100, telefoniPezzi: 60, accessoriFatturato: 2000, serviziFatturato: 500 });

await test("determinismo: stessa data ⇒ stesso testo, date diverse possono differire", () => {
  const base = { fascia: "parziale", forecast: cjForecast, today: cjToday, month: cjMonth, elapsedWorkingDays: 10, totalWorkingDays: 26 };
  const a1 = buildDirettoreCommento({ ...base, dateYMD: "2026-07-15" });
  const a2 = buildDirettoreCommento({ ...base, dateYMD: "2026-07-15" });
  assert.equal(a1, a2);
  const b = buildDirettoreCommento({ ...base, dateYMD: "2026-07-16" });
  // Non richiediamo che differiscano sempre, ma il testo deve essere valido.
  assert.ok(typeof b === "string" && b.length > 0);
});

await test("parziale con vendite: apertura ☀️, lead 'Finora', standout negozio+addetto", () => {
  const s = buildDirettoreCommento({
    fascia: "parziale", dateYMD: "2026-07-15", forecast: cjForecast,
    today: cjToday, month: cjMonth, elapsedWorkingDays: 10, totalWorkingDays: 26,
  });
  assert.ok(s.includes("☀️"));
  assert.ok(s.includes("Finora"));
  assert.ok(s.includes("<b>1 vendite</b>"));
  assert.ok(s.includes("Centro"));
  assert.ok(s.includes("Mario Rossi"));
  assert.ok(s.includes("Sul mese"));
  // Standout TELCO a pezzi (UNTIED ⇒ mobile), nessun punteggio pesato.
  assert.ok(s.includes("TELCO"));
  assert.ok(/pezz[io]/.test(s));
  assert.ok(!/di performance|puntegg/.test(s));
});

await test("chiusura con vendite: apertura 🌙 e lead 'In chiusura'", () => {
  const s = buildDirettoreCommento({
    fascia: "chiusura", dateYMD: "2026-07-15", forecast: cjForecast,
    today: cjToday, month: cjMonth, elapsedWorkingDays: 20, totalWorkingDays: 26,
  });
  assert.ok(s.includes("🌙"));
  assert.ok(s.includes("In chiusura"));
});

await test("giornata al palo parziale: frase dedicata, niente lead giornata", () => {
  const s = buildDirettoreCommento({
    fascia: "parziale", dateYMD: "2026-07-15", forecast: cjForecast,
    today: aggregateDailyReport([]), month: cjMonth, elapsedWorkingDays: 10, totalWorkingDays: 26,
  });
  assert.ok(s.includes("☀️"));
  assert.ok(/palo|tabellone|ghiaccio|rimonta|zero/.test(s));
  assert.ok(!s.includes("Finora"));
});

await test("giornata al palo chiusura: frase dedicata di reset", () => {
  const s = buildDirettoreCommento({
    fascia: "chiusura", dateYMD: "2026-07-15", forecast: cjForecast,
    today: aggregateDailyReport([]), month: cjMonth, elapsedWorkingDays: 20, totalWorkingDays: 26,
  });
  assert.ok(s.includes("🌙"));
  assert.ok(/palo|Tabellone|dimenticare|domani/.test(s));
});

await test("banda performance: molto sopra ⇒ tono positivo, molto sotto ⇒ tono di recupero", () => {
  // Mese molto sopra il passo: forecast bassissimo ⇒ delta molto positivo.
  const sopra = buildDirettoreCommento({
    fascia: "parziale", dateYMD: "2026-07-15",
    forecast: parseForecastConfig({ mobileVolumi: 1 }),
    today: cjToday, month: cjMonth, elapsedWorkingDays: 25, totalWorkingDays: 26,
  });
  assert.ok(sopra.includes("davanti al passo"));
  // Mese molto sotto il passo: forecast altissimo ⇒ delta molto negativo.
  const sotto = buildDirettoreCommento({
    fascia: "parziale", dateYMD: "2026-07-15",
    forecast: parseForecastConfig({ mobileVolumi: 100000 }),
    today: cjToday, month: cjMonth, elapsedWorkingDays: 25, totalWorkingDays: 26,
  });
  assert.ok(sotto.includes("dietro al passo"));
});

await test("apertura che finisce con ! non produce doppia punteggiatura (!.)", () => {
  // La banda 'molto sopra' in chiusura può pescare "Chiusura col botto,
  // squadra!" / "…e che giornata!": il punto non va aggiunto in coda.
  for (const dateYMD of ["2026-07-15", "2026-07-16", "2026-07-17", "2026-07-18", "2026-07-19"]) {
    const s = buildDirettoreCommento({
      fascia: "chiusura", dateYMD,
      forecast: parseForecastConfig({ mobileVolumi: 1 }),
      today: cjToday, month: cjMonth, elapsedWorkingDays: 25, totalWorkingDays: 26,
    });
    assert.ok(!s.includes("!."), `doppia punteggiatura in: ${s.slice(0, 60)}`);
    assert.ok(!s.includes("?."));
  }
});

await test("senza forecast: solo commento giornata, nessun framing mensile né spunto", () => {
  const s = buildDirettoreCommento({
    fascia: "parziale", dateYMD: "2026-07-15", forecast: EMPTY_FORECAST,
    today: cjToday, month: cjMonth, elapsedWorkingDays: 10, totalWorkingDays: 26,
  });
  assert.ok(s.includes("Finora"));
  assert.ok(!s.includes("Sul mese"));
  assert.ok(!s.includes("passo"));
});

await test("WindTre Protetti: sempre citato anche a zero", () => {
  const s = buildDirettoreCommento({
    fascia: "parziale", dateYMD: "2026-07-15", forecast: cjForecast,
    today: cjToday, month: cjMonth, elapsedWorkingDays: 10, totalWorkingDays: 26,
  });
  assert.ok(s.includes("WindTre Protetti"));
  assert.ok(s.includes("ancora a zero"));
});

await test("WindTre Protetti: citato anche a GIORNATA AL PALO (zero vendite)", () => {
  const vuoto = aggregateDailyReport([]);
  const s = buildDirettoreCommento({
    fascia: "chiusura", dateYMD: "2026-07-15", forecast: cjForecast,
    today: vuoto, month: cjMonth, elapsedWorkingDays: 10, totalWorkingDays: 26,
  });
  assert.ok(/palo|Tabellone|dimenticare|domani/.test(s));
  assert.ok(s.includes("WindTre Protetti"));
});

await test("HTML: card WindTre Protetti presente anche a zero vendite", () => {
  const vuoto = aggregateDailyReport([]);
  const html = buildVenditeReportHtml({ orgName: "Org Test", dateYMD: "2026-07-15", timeLabel: "22:30", aggregates: vuoto });
  assert.ok(html.includes("Nessuna vendita registrata"));
  assert.ok(html.includes("🛡️ WindTre Protetti"));
});

await test("WindTre Protetti: con vendite ⇒ congratulazioni al venditore", () => {
  const conProtetti = aggregateDailyReport([
    sale({ codicePos: "P1", nomeNegozio: "Centro", nomeAddetto: "Mario Rossi", totale: "60", articoli: [art("ALLARMI", 60)] }),
  ]);
  const s = buildDirettoreCommento({
    fascia: "chiusura", dateYMD: "2026-07-15", forecast: cjForecast,
    today: conProtetti, month: cjMonth, elapsedWorkingDays: 10, totalWorkingDays: 26,
  });
  assert.ok(s.includes("WindTre Protetti"));
  assert.ok(s.includes("1 WindTre Protetti"));
  assert.ok(s.includes("complimenti a <b>Mario Rossi</b>"));
});

await test("accessori/servizi: menzione a parte, senza citare il punteggio", () => {
  const s = buildDirettoreCommento({
    fascia: "parziale", dateYMD: "2026-07-15", forecast: cjForecast,
    today: cjToday, month: cjMonth, elapsedWorkingDays: 10, totalWorkingDays: 26,
  });
  assert.ok(s.includes("Il fatturato di"));
  assert.ok(s.includes("arricchisce lo scontrino"));
  assert.ok(s.includes("accessori"));
  assert.ok(!s.includes("A parte dal punteggio"));
});

// ── Contenuti report Telegram (Task #515) ────────────────────────────
console.log("\n— telegramReportContent (Task #515) —");

await test("parse: default legacy con input assente/non-oggetto", () => {
  for (const raw of [undefined, null, 42, "x", []]) {
    assert.deepEqual(parseTelegramReportContent(raw), DEFAULT_TELEGRAM_REPORT_CONTENT);
  }
  assert.deepEqual(DEFAULT_TELEGRAM_REPORT_CONTENT.pisteVisibili, ["mobile", "fisso", "cb", "assicurazioni", "protecta", "energia"]);
  assert.deepEqual(DEFAULT_TELEGRAM_REPORT_CONTENT.telcoPiste, ["mobile", "fisso"]);
  assert.deepEqual(DEFAULT_TELEGRAM_REPORT_CONTENT.newCorePiste, ["assicurazioni", "energia"]);
});

await test("parse: array vuoto rispettato, campo mancante ⇒ default, whitelist+ordine normalizzati", () => {
  const c = parseTelegramReportContent({ pisteVisibili: ["energia", "mobile", "iva", "boh"], telcoPiste: [] });
  assert.deepEqual(c.pisteVisibili, ["mobile", "energia"]); // ordine canonico, ignoti scartati
  assert.deepEqual(c.telcoPiste, []); // vuoto esplicito rispettato
  assert.deepEqual(c.newCorePiste, DEFAULT_TELEGRAM_REPORT_CONTENT.newCorePiste);
});

await test("gating VF: protecta rimossa da visibilità e gruppi anche se salvata", () => {
  const c = applyBrandGating(parseTelegramReportContent({ pisteVisibili: TELEGRAM_REPORT_PISTE, newCorePiste: ["protecta", "energia"] }), true);
  assert.ok(!c.pisteVisibili.includes("protecta"));
  assert.ok(!c.newCorePiste.includes("protecta"));
  const w = applyBrandGating(parseTelegramReportContent({ pisteVisibili: TELEGRAM_REPORT_PISTE }), false);
  assert.ok(w.pisteVisibili.includes("protecta")); // WindTre: resta se abilitata
});

await test("gating VF protectaOnly (org mista legacy): WindTre invariato, solo Protetti rimosso", () => {
  const c = applyBrandGating(
    parseTelegramReportContent({ pisteVisibili: ["mobile", "fisso", "cb", "assicurazioni", "protecta", "energia"], newCorePiste: ["protecta", "assicurazioni", "energia"] }),
    true,
    { protectaOnly: true },
  );
  assert.ok(!c.pisteVisibili.includes("protecta"), "Protetti rimosso (fail-closed)");
  assert.ok(!c.newCorePiste.includes("protecta"));
  // Il modello WindTre NON viene rimappato: energia e assicurazioni restano,
  // le piste VF non compaiono.
  assert.ok(c.pisteVisibili.includes("energia"));
  assert.ok(c.pisteVisibili.includes("assicurazioni"));
  assert.deepEqual(c.newCorePiste, ["assicurazioni", "energia"]);
  assert.ok(!c.pisteVisibili.includes("luce") && !c.pisteVisibili.includes("gas"));
});

// ── Report separati per brand (Task #519) ────────────────────────────
console.log("\n— report per brand (Task #519) —");

await test("telegramBrandKindOf: riconoscimento tollerante WindTre, fail-closed sugli altri", () => {
  for (const n of ["WindTre", "WIND TRE", "wind-tre", "W3", "Wind3"]) {
    assert.equal(telegramBrandKindOf(n), "windtre", n);
  }
  for (const n of ["Vodafone", "Fastweb", "Sky Wifi", "", null, undefined]) {
    assert.equal(telegramBrandKindOf(n), "other", String(n));
  }
});

await test("parseTelegramReportContentForBrand: voce per-brand, fallback legacy root, input rotti", () => {
  const raw = {
    pisteVisibili: ["mobile", "fisso"],
    perBrand: {
      "b-vf": { pisteVisibili: ["energia"], telcoPiste: [] },
    },
  };
  const vf = parseTelegramReportContentForBrand(raw, "b-vf");
  assert.deepEqual(vf.pisteVisibili, ["energia"]);
  assert.deepEqual(vf.telcoPiste, []);
  // Brand senza voce ⇒ eredita la selezione root legacy.
  const w3 = parseTelegramReportContentForBrand(raw, "b-w3");
  assert.deepEqual(w3.pisteVisibili, ["mobile", "fisso"]);
  // brandId assente o raw non-oggetto ⇒ parse legacy.
  assert.deepEqual(parseTelegramReportContentForBrand(raw, null).pisteVisibili, ["mobile", "fisso"]);
  assert.deepEqual(parseTelegramReportContentForBrand(42, "b-vf"), DEFAULT_TELEGRAM_REPORT_CONTENT);
  assert.deepEqual(parseTelegramReportContentForBrand({ perBrand: { "b-vf": "x" } }, "b-vf"), parseTelegramReportContent({ perBrand: { "b-vf": "x" } }));
});

await test("applyBrandKindGating: solo windtre conserva protecta; other fail-closed", () => {
  const full = parseTelegramReportContent({ pisteVisibili: TELEGRAM_REPORT_PISTE, newCorePiste: ["protecta", "energia"] });
  const w = applyBrandKindGating(full, "windtre");
  assert.ok(w.pisteVisibili.includes("protecta"));
  const o = applyBrandKindGating(full, "other");
  assert.ok(!o.pisteVisibili.includes("protecta"));
  assert.ok(!o.newCorePiste.includes("protecta"));
});

await test("buildTelegramBrandTargets: solo brand con PDV, POS normalizzati, multi-brand in entrambi", () => {
  const brands = [
    { id: "b-w3", name: "WindTre" },
    { id: "b-vf", name: "Vodafone" },
    { id: "b-fw", name: "Fastweb" },
  ];
  const pdv = [
    { codicePos: " P100 ", brandIds: ["b-w3"] },
    { codicePos: "P200", brandIds: ["b-vf", "b-w3"] }, // multi-brand
    { codicePos: "P300" }, // senza brand
    { nome: "SoloNome", brandIds: ["b-vf"] }, // fallback su nome
  ];
  const targets = buildTelegramBrandTargets(brands, pdv);
  assert.deepEqual(targets.map((t) => t.brandId), ["b-w3", "b-vf"]); // b-fw senza PDV escluso
  const w3 = targets.find((t) => t.brandId === "b-w3");
  assert.deepEqual([...w3.posCodes].sort(), ["p100", "p200"]);
  assert.equal(w3.kind, "windtre");
  const vf = targets.find((t) => t.brandId === "b-vf");
  assert.deepEqual([...vf.posCodes].sort(), ["p200", "solonome"]);
  assert.equal(vf.kind, "other");
  // Struttura senza brand ⇒ nessun target (report unico legacy).
  assert.deepEqual(buildTelegramBrandTargets(brands, [{ codicePos: "P1" }]), []);
  assert.deepEqual(buildTelegramBrandTargets(brands, undefined), []);
  assert.deepEqual(unassignedPosCodes(pdv), ["p300"]);
});

await test("effectiveGroupPiste: interseca gruppo e piste visibili", () => {
  const c = parseTelegramReportContent({ pisteVisibili: ["mobile"], telcoPiste: ["mobile", "fisso"] });
  assert.deepEqual(effectiveGroupPiste(c, "telco"), ["mobile"]);
  assert.equal(isPistaVisible(c, "fisso"), false);
});

await test("groupPezziOf/buildGroupTopByPezzi: somma pezzi per gruppo, esclude N/D", () => {
  const a = aggregateDailyReport([
    sale({ codicePos: "P1", nomeNegozio: "Centro", nomeAddetto: "Mario", articoli: [art("UNTIED", 30), art("UNTIED", 30)] }),
    sale({ codicePos: "P2", nomeNegozio: "Mare", nomeAddetto: "Luigi", articoli: [art("ADSL/FIBRA/FWA CF", 30), art("ALLARMI", 60)] }),
  ]);
  assert.equal(groupPezziOf(a, ["mobile", "fisso"]), 3);
  const top = buildGroupTopByPezzi(a, ["mobile", "fisso"]);
  assert.equal(top.addetto?.nome, "Mario");
  assert.equal(top.addetto?.pezzi, 2);
  assert.equal(top.negozio?.nome, "Centro");
  const soloProt = buildGroupTopByPezzi(a, ["protecta"]);
  assert.equal(soloProt.addetto?.nome, "Luigi");
});

await test("commento: pista esclusa sparisce da testo; VF senza riferimenti Protetti/Verisure", () => {
  const contentVf = applyBrandGating(parseTelegramReportContent(undefined), true);
  const s = buildDirettoreCommento({
    fascia: "parziale", dateYMD: "2026-07-15", forecast: cjForecast,
    today: cjToday, month: cjMonth, elapsedWorkingDays: 10, totalWorkingDays: 26,
    content: contentVf,
  });
  assert.ok(!s.includes("Protetti"));
  assert.ok(!s.includes("Verisure"));
});

await test("commento: gruppi indipendenti — TELCO vuoto ⇒ blocco assente, NEW CORE resta", () => {
  const today = aggregateDailyReport([
    sale({ codicePos: "P1", nomeNegozio: "Centro", nomeAddetto: "Anna", articoli: [art("ENERGIA W3", 30)] }),
  ]);
  const content = parseTelegramReportContent({ telcoPiste: [], newCorePiste: ["energia"] });
  const s = buildDirettoreCommento({
    fascia: "parziale", dateYMD: "2026-07-15", forecast: cjForecast,
    today, month: cjMonth, elapsedWorkingDays: 10, totalWorkingDays: 26,
    content,
  });
  assert.ok(!s.includes("TELCO"));
  assert.ok(s.includes("NEW CORE"));
  assert.ok(s.includes("Anna"));
});

await test("HTML: pista esclusa sparisce da card piste, proiezioni e drill; Protetti omesso", () => {
  const a = aggregateDailyReport([
    sale({ codicePos: "P1", nomeNegozio: "Centro", nomeAddetto: "Mario", articoli: [art("UNTIED", 30), art("ALLARMI", 60), art("LUCE", 20)] }),
  ]);
  const content = applyBrandGating(parseTelegramReportContent(undefined), true); // niente protecta
  const proj = buildMonthEndProjection("2026-07-15", a, cjForecast) ?? undefined;
  const html = buildVenditeReportHtml({
    orgName: "Org VF", dateYMD: "2026-07-15", timeLabel: "22:30",
    aggregates: a, month: { label: "Luglio 2026", aggregates: a }, monthProjection: proj,
    content,
  });
  assert.ok(!html.includes("Protetti"));
  assert.ok(!html.includes("Verisure"));
  // Task #527 — nel modello VF la vecchia "energia" è rimappata su
  // Luce+Gas: la card Energia legacy sparisce dal report VF.
  assert.ok(!content.pisteVisibili.includes("energia"));
  assert.ok(content.pisteVisibili.includes("luce") && content.pisteVisibili.includes("gas"));
  // Senza content ⇒ default legacy: Protetti presente.
  const htmlDefault = buildVenditeReportHtml({ orgName: "Org W3", dateYMD: "2026-07-15", timeLabel: "22:30", aggregates: a });
  assert.ok(htmlDefault.includes("WindTre Protetti"));
});

await test("HTML: classifiche PDV/addetti ordinate per pezzi delle piste visibili", () => {
  const a = aggregateDailyReport([
    // P1/Mario: importo alto ma pezzi mobile 1; P2/Luigi: 3 pezzi mobile.
    sale({ codicePos: "P1", nomeNegozio: "Alfa", nomeAddetto: "Mario", totale: "900", articoli: [art("UNTIED", 900)] }),
    sale({ codicePos: "P2", nomeNegozio: "Beta", nomeAddetto: "Luigi", totale: "90", articoli: [art("UNTIED", 30), art("UNTIED", 30), art("UNTIED", 30)] }),
  ]);
  const html = buildVenditeReportHtml({ orgName: "O", dateYMD: "2026-07-15", timeLabel: "22:30", aggregates: a });
  const iBeta = html.indexOf("Beta");
  const iAlfa = html.indexOf("Alfa");
  assert.ok(iBeta >= 0 && iAlfa >= 0 && iBeta < iAlfa, "Beta (3 pz) prima di Alfa (1 pz)");
  assert.ok(html.indexOf("Luigi") < html.indexOf("🥇") + 200); // medaglia sul primo per pezzi
  assert.ok(/3 pz/.test(html));
});

// ── Scheduler con storage mockato (Task #333) ────────────────────────
// Cambio orari a metà giornata: niente slot persi, niente doppi invii,
// recovery al boot senza duplicati. Si mockano i metodi del singleton
// `storage` e il fetch globale (Telegram API), così runScheduledSend gira
// end-to-end senza DB né rete.
console.log("\n— scheduler: runScheduledSend con storage mockato (Task #333) —");

const schedMod = await import("../server/telegramReportScheduler.ts").catch(() => ({}));
const storageMod = await import("../server/storage.ts").catch(() => ({}));

if (schedMod.runScheduledSend && storageMod.storage) {
  const { runScheduledSend, collectSendTimes, recoverableSlot: recSlot } = schedMod;
  const { storage } = storageMod;

  // Stato del mock, reimpostato da setupScenario per ogni test.
  let mockOrgs = [];
  let mockConfigs = new Map(); // orgId -> config object
  let mockGaraConfigs = new Map(); // orgId -> gara_config.config del mese
  let mockSentLabels = new Map(); // orgId -> string[] (label già inviati oggi)
  let mockOrgBrands = new Map(); // orgId -> [{ id, name }] (Task #519)
  let mockSales = []; // righe bisuite restituite dal mock (Task #519)
  let recordedSends = []; // { orgId, ymd, label } registrati dalla run
  let telegramCalls = []; // URL delle chiamate api.telegram.org intercettate
  let telegramDocs = []; // FormData dei sendDocument (allegati HTML)
  let mockDtsLeads = []; // lead DTS restituiti dal mock (Task #519)
  // Plafond ricariche (Task #538): stato per computePlafondSaldi.
  let mockPlafondOps = []; // righe plafond_ricariche_ops (asc per createdAt)
  let mockPlafondRegistry = []; // [{ id, nome }] registro RS
  let mockPlafondConsumo = []; // [{ rs, consumo }]
  let telegramMessages = []; // testi dei sendMessage intercettati
  // Listino canvass VF (Task #529): valore restituito da getSystemConfig
  // ("canvass_reference"); la stringa "throw" simula il DB irraggiungibile.
  let mockCanvassRef;

  const originals = {};
  const patch = (name, fn) => {
    if (!(name in originals)) originals[name] = storage[name];
    storage[name] = fn;
  };
  patch("getOrganizations", async () => mockOrgs);
  patch("getOrgConfig", async (orgId) => {
    const config = mockConfigs.get(orgId);
    return config ? { organizationId: orgId, config } : undefined;
  });
  // Il dedup è per org+fascia+brand (Task #519): il mock normalizza le
  // stringhe legacy in { timeLabel, brandKey: '' } come farebbe il DB.
  const toSentEntry = (l) => (typeof l === "string" ? { timeLabel: l, brandKey: "" } : l);
  patch("getTelegramReportSendLabels", async () => {
    const m = new Map();
    for (const [k, v] of mockSentLabels) m.set(k, v.map(toSentEntry));
    return m;
  });
  patch("recordTelegramReportSend", async (orgId, ymd, label, brandKey = "") => {
    recordedSends.push({ orgId, ymd, label, brandKey });
    const prev = mockSentLabels.get(orgId) ?? [];
    mockSentLabels.set(orgId, [...prev, { timeLabel: label, brandKey }]);
  });
  patch("getBisuiteSalesByItalianDateRange", async () => mockSales);
  patch("getGaraConfig", async (orgId) => {
    const config = mockGaraConfigs.get(orgId);
    return config ? { organizationId: orgId, config } : undefined;
  });
  patch("getDtsLeads", async () => mockDtsLeads);
  patch("getOrganizationBrands", async (orgId) => mockOrgBrands.get(orgId) ?? []);
  patch("getSystemConfig", async (key) => {
    if (mockCanvassRef === "throw") throw new Error("DB non raggiungibile (test)");
    return key === "canvass_reference" ? mockCanvassRef : undefined;
  });
  // Plafond ricariche (Task #538): senza questi patch computePlafondSaldi
  // tenterebbe il DB reale (best-effort: warning saltato, ma test sporchi).
  patch("listPlafondRicaricheOps", async () => mockPlafondOps);
  patch("getRicaricheConsumoByRawRs", async () => mockPlafondConsumo);
  const cdgMod = await import("../server/cdgStorage.ts").catch(() => ({}));
  const cdgOriginals = {};
  if (cdgMod.cdgStorage) {
    const patchCdg = (name, fn) => {
      if (!(name in cdgOriginals)) cdgOriginals[name] = cdgMod.cdgStorage[name];
      cdgMod.cdgStorage[name] = fn;
    };
    patchCdg("listRagioniSociali", async () => mockPlafondRegistry);
    patchCdg("getRsResolver", async () => (s) => s);
  }

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    const u = String(url);
    if (u.includes("api.telegram.org")) {
      telegramCalls.push(u);
      if (u.includes("sendDocument") && options?.body instanceof FormData) {
        telegramDocs.push(options.body);
      }
      if (u.includes("sendMessage") && typeof options?.body === "string") {
        try { telegramMessages.push(JSON.parse(options.body).text); } catch {}
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ ok: true }),
      };
    }
    throw new Error(`fetch inatteso nel test: ${u}`);
  };

  const tgConfig = (sendTimes) => ({
    telegramReport: {
      enabled: true,
      bot_token: "123:abc", // in chiaro: resolveTelegramConfig fa passthrough
      chat_id: "-100999",
      ...(sendTimes ? { send_times: sendTimes } : {}),
    },
  });

  const setupScenario = ({ orgs, sent = {}, sales = [], dtsLeads = [], canvassRef, plafond } = {}) => {
    mockDtsLeads = dtsLeads;
    mockCanvassRef = canvassRef;
    mockPlafondOps = plafond?.ops ?? [];
    mockPlafondRegistry = plafond?.registry ?? [];
    mockPlafondConsumo = plafond?.consumo ?? [];
    telegramMessages = [];
    telegramDocs = [];
    mockOrgs = orgs.map((o) => ({ id: o.id, name: o.name ?? o.id }));
    mockConfigs = new Map(orgs.map((o) => [o.id, {
      ...tgConfig(o.sendTimes),
      ...(o.puntiVendita ? { puntiVendita: o.puntiVendita } : {}),
    }]));
    mockGaraConfigs = new Map(orgs
      .filter((o) => o.garaConfig)
      .map((o) => [o.id, o.garaConfig]));
    mockOrgBrands = new Map(orgs.map((o) => [o.id, o.brands ?? []]));
    mockSales = sales;
    mockSentLabels = new Map(Object.entries(sent));
    recordedSends = [];
    telegramCalls = [];
  };

  // Ogni invio riuscito = 2 chiamate Telegram (sendMessage + sendDocument).
  const sendsFor = (orgId) => recordedSends.filter((r) => r.orgId === orgId);

  try {
    await test("orario spostato a un momento futuro di oggi ⇒ lo scheduler mira al nuovo slot e l'invio parte (nessuno slot perso)", async () => {
      // L'org sposta il parziale da 13:30 a 15:00 alle 14:00: il vecchio
      // slot è già passato ma il nuovo è futuro ⇒ va pianificato oggi.
      setupScenario({ orgs: [{ id: "org-a", sendTimes: { parziale: "15:00", chiusura: "22:15" } }] });
      const times = await collectSendTimes();
      assert.deepEqual(times.map((t) => t.label), ["15:00", "22:15"]);
      // Alle 14:00 Roma (CEST) il prossimo slot è il nuovo 15:00 di oggi.
      const at1400 = new Date(Date.UTC(2026, 6, 2, 12, 0, 0));
      const { label } = schedMod.msUntilNextSend(at1400, times);
      assert.equal(label, "15:00");
      // Allo scatto del timer la run invia davvero al nuovo orario.
      await runScheduledSend("15:00");
      assert.equal(sendsFor("org-a").length, 1);
      assert.equal(sendsFor("org-a")[0].label, "15:00");
      assert.equal(telegramCalls.length, 2); // messaggio + allegato HTML
    });

    await test("cambio orario dopo il parziale già inviato ⇒ nessun doppio parziale, la chiusura parte regolarmente", async () => {
      // Parziale inviato alle 13:30, poi l'orario cambia a 12:00: lo slot
      // "12:00" (es. ri-armato da un reschedule o run di un'altra org) NON
      // deve produrre un secondo parziale (dedup per fascia, non per label).
      setupScenario({
        orgs: [{ id: "org-a", sendTimes: { parziale: "12:00", chiusura: "22:15" } }],
        sent: { "org-a": ["13:30"] },
      });
      await runScheduledSend("12:00");
      assert.equal(sendsFor("org-a").length, 0, "doppio parziale non atteso");
      assert.equal(telegramCalls.length, 0);
      // La chiusura invece parte regolarmente.
      await runScheduledSend("22:15");
      assert.equal(sendsFor("org-a").length, 1);
      assert.equal(sendsFor("org-a")[0].label, "22:15");
      assert.equal(telegramCalls.length, 2);
    });

    await test("report separati per brand: un invio per brand con PDV, POS filtrati, dedup per brand (Task #519)", async () => {
      const sale = (codicePos, categoria) => ({
        bisuiteId: `s-${codicePos}-${Math.random().toString(36).slice(2, 6)}`,
        codicePos,
        nomeNegozio: `Neg ${codicePos}`,
        nomeAddetto: "Anna",
        stato: "OK",
        // dataVendita di OGGI (Roma) così finisce negli aggregati del giorno
        dataVendita: new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Rome" }).format(new Date()),
        totale: "30",
        ragioneSociale: "RS Uno",
        rawData: { articoli: [{ categoria, importo: 30, quantita: 1 }] },
      });
      setupScenario({
        orgs: [{
          id: "org-b",
          name: "Org Multi",
          brands: [
            { id: "b-w3", name: "WindTre" },
            { id: "b-vf", name: "Vodafone" },
            { id: "b-fw", name: "Fastweb" }, // senza PDV: nessun report
          ],
          puntiVendita: [
            { codicePos: "P100", nome: "Neg P100", ragioneSociale: "RS Uno", brandIds: ["b-w3"] },
            { codicePos: "P200", nome: "Neg P200", ragioneSociale: "RS Uno", brandIds: ["b-vf"] },
          ],
        }],
        sales: [sale("P100", "UNTIED"), sale("P200", "UNTIED")],
      });
      await runScheduledSend("13:30");
      const sends = sendsFor("org-b");
      assert.equal(sends.length, 2, "un invio registrato per ciascun brand con PDV");
      assert.deepEqual(sends.map((s) => s.brandKey).sort(), ["b-vf", "b-w3"]);
      assert.equal(telegramCalls.length, 4, "2 report × (messaggio + allegato)");
      // Rilancio stesso slot ⇒ dedup per org+fascia+brand: nessun doppione.
      telegramCalls = [];
      await runScheduledSend("13:30");
      assert.equal(sendsFor("org-b").length, 2);
      assert.equal(telegramCalls.length, 0);
      // Chiusura: entrambi i brand ripartono (fascia diversa).
      await runScheduledSend("22:15");
      assert.equal(sendsFor("org-b").length, 4);
    });

    await test("DTS nei report per brand: solo i lead agganciati a vendite del brand (fail-closed)", async () => {
      const oggi = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Rome" }).format(new Date());
      const sale = (codicePos, codiceEsterno) => ({
        bisuiteId: `s-${codicePos}-${codiceEsterno}`,
        codicePos,
        nomeNegozio: `Neg ${codicePos}`,
        nomeAddetto: "Anna",
        stato: "OK",
        dataVendita: oggi,
        totale: "30",
        rawData: { codiceEsterno: String(codiceEsterno), articoli: [{ categoria: "UNTIED", importo: 30, quantita: 1 }] },
      });
      const lead = (consulente, idVendita) => ({
        leadKey: `lk-${consulente}-${idVendita}`,
        consulente,
        campagna: "CAMP",
        nominativo: `Cliente ${consulente}`,
        email: null, codiceFiscale: null, telefono: null,
        inCarico: null, stato: "FISSATO",
        data: oggi,
        idVendita,
        addettoVendita: null, origineLead: null,
      });
      setupScenario({
        orgs: [{
          id: "org-d",
          brands: [{ id: "b-w3", name: "WindTre" }, { id: "b-vf", name: "Vodafone" }],
          puntiVendita: [
            { codicePos: "P100", brandIds: ["b-w3"] },
            { codicePos: "P200", brandIds: ["b-vf"] },
          ],
        }],
        sales: [sale("P100", 111), sale("P200", 222)],
        dtsLeads: [lead("MARIO_W3", 111), lead("LUCA_VF", 222), lead("SENZA_VENDITA", null)],
      });
      await runScheduledSend("13:30");
      assert.equal(telegramDocs.length, 2, "un allegato HTML per brand");
      const htmls = await Promise.all(telegramDocs.map((f) => f.get("document").text()));
      // Senza il filtro per brand ogni report mostrerebbe 3 lead (tutti
      // quelli dell'org, incluso quello senza vendita collegata). Col
      // fail-closed ciascun brand vede SOLO il suo lead agganciato.
      for (const h of htmls) {
        const m = h.match(/DTS fissati<\/span><b>(\d+)</);
        assert.ok(m, "sezione DTS presente nell'allegato");
        assert.equal(m[1], "1", "un solo lead (quello del brand) nel report");
      }
    });

    await test("brand parzialmente inviato ⇒ il recovery reinvia SOLO il brand mancante", async () => {
      setupScenario({
        orgs: [{
          id: "org-b",
          brands: [{ id: "b-w3", name: "WindTre" }, { id: "b-vf", name: "Vodafone" }],
          puntiVendita: [
            { codicePos: "P100", brandIds: ["b-w3"] },
            { codicePos: "P200", brandIds: ["b-vf"] },
          ],
        }],
        sent: { "org-b": [{ timeLabel: "13:30", brandKey: "b-w3" }] },
      });
      await runScheduledSend("13:30");
      const sends = sendsFor("org-b");
      assert.equal(sends.length, 1, "solo il brand mancante viene recuperato");
      assert.equal(sends[0].brandKey, "b-vf");
    });

    await test("org senza PDV brandizzati ⇒ report unico legacy con brandKey ''", async () => {
      setupScenario({
        orgs: [{
          id: "org-l",
          brands: [{ id: "b-w3", name: "WindTre" }],
          puntiVendita: [{ codicePos: "P100" }],
        }],
      });
      await runScheduledSend("13:30");
      const sends = sendsFor("org-l");
      assert.equal(sends.length, 1);
      assert.equal(sends[0].brandKey, "");
      assert.equal(telegramCalls.length, 2);
    });

    await test("org mista W3+VF senza PDV brandizzati ⇒ report legacy col modello WindTre intatto (no remap VF)", async () => {
      // Stato di migrazione realistico: brand associati ma nessun PDV
      // ancora brandizzato ⇒ un solo report combinato. Il modello WindTre
      // deve restare invariato (Energia e Assicurazioni presenti, niente
      // Luce/Gas); si applica solo il fail-closed Protetti.
      const oggi = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Rome" }).format(new Date());
      const sale = (id, categoria) => ({
        bisuiteId: `s-mix-${id}`,
        codicePos: "P100",
        nomeNegozio: "Neg P100",
        nomeAddetto: "Anna",
        stato: "OK",
        dataVendita: oggi,
        totale: "30",
        rawData: { articoli: [{ categoria, importo: 30, quantita: 1 }] },
      });
      setupScenario({
        orgs: [{
          id: "org-mix",
          name: "Org Mista",
          brands: [{ id: "b-w3", name: "WindTre" }, { id: "b-vf", name: "Vodafone" }],
          puntiVendita: [{ codicePos: "P100", nome: "Neg P100" }], // nessun brandIds
        }],
        sales: [sale(1, "ENERGIA W3"), sale(2, "ASSICURAZIONI")],
      });
      await runScheduledSend("13:30");
      const sends = sendsFor("org-mix");
      assert.equal(sends.length, 1, "un solo report legacy");
      assert.equal(sends[0].brandKey, "");
      assert.equal(telegramDocs.length, 1);
      const h = await telegramDocs[0].get("document").text();
      assert.ok(h.includes("Energia"), "pista Energia WindTre presente nell'HTML");
      assert.ok(h.includes("Assicurazioni"), "pista Assicurazioni presente nell'HTML");
      assert.ok(!h.includes("Luce") && !h.includes("IVA Mobile"), "nessuna pista VF nel report legacy misto");
    });

    await test("org VF pura senza PDV brandizzati ⇒ modello VF (energia→Luce/Gas, no Assicurazioni)", async () => {
      const oggi = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Rome" }).format(new Date());
      setupScenario({
        orgs: [{
          id: "org-vf",
          name: "Org VF",
          brands: [{ id: "b-vf", name: "Vodafone" }, { id: "b-fw", name: "Fastweb" }],
          puntiVendita: [{ codicePos: "P200", nome: "Neg P200" }],
        }],
        sales: [{
          bisuiteId: "s-vf-1",
          codicePos: "P200",
          nomeNegozio: "Neg P200",
          nomeAddetto: "Anna",
          stato: "OK",
          dataVendita: oggi,
          totale: "30",
          rawData: { articoli: [{ categoria: "UNTIED", importo: 30, quantita: 1 }] },
        }],
      });
      await runScheduledSend("13:30");
      const sends = sendsFor("org-vf");
      assert.equal(sends.length, 1);
      assert.equal(telegramDocs.length, 1);
      const h = await telegramDocs[0].get("document").text();
      assert.ok(!h.includes("Assicurazioni"), "Assicurazioni esclusa dal modello VF");
      assert.ok(!h.includes("Protetti"), "Protetti escluso dal modello VF");
    });

    // ── Report brand VF con listino canvass reale (Task #529) ─────────────
    // Listino di test deterministico: cinque offerte VF che matchano per
    // codice esatto (Luce, Gas, IVA Mobile, IVA Wireline e VAS).
    const listinoVf = {
      config: {
        offers: [
          { codice: "CANLUCE12208", offerId: "LUCE1", nomeEtichetta: "Luce Casa", pista: "ENERGIA VODAFONE", categoria: "ENERGIA CASA", tipologia: "LUCE", canone: 0, brand: "vodafone" },
          { codice: "CANGAS012208", offerId: "GAS01", nomeEtichetta: "Gas Casa", pista: "ENERGIA VODAFONE", categoria: "ENERGIA CASA", tipologia: "GAS", canone: 0, brand: "vodafone" },
          { codice: "CANIVAM12208", offerId: "IVAM1", nomeEtichetta: "IVA Mobile", pista: "PISTA IVA", categoria: "IVA VOCE", tipologia: "MOBILE", canone: 0, brand: "vodafone" },
          { codice: "CANIVAW12208", offerId: "IVAW1", nomeEtichetta: "IVA Wireline", pista: "PISTA IVA", categoria: "IVA RETE FISSA", tipologia: "WIRELINE", canone: 0, brand: "vodafone" },
          { codice: "CANVAS012208", offerId: "VAS01", nomeEtichetta: "Soluzioni Digitali", pista: "PISTA IVA", categoria: "SOLUZIONI DIGITALI", tipologia: "VAS", canone: 0, brand: "vodafone" },
        ],
      },
    };
    const oggiRoma = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Rome" }).format(new Date());
    // Articolo in forma BiSuite completa ({categoria:{nome}}, dettaglio.prezzo):
    // solo così la classificazione da listino (e quella legacy) lo vede.
    const artFull = (codice, catNome, prezzo) => ({
      codice,
      categoria: { nome: catNome },
      tipologia: { nome: "OFFERTA VF" },
      descrizione: `Art ${codice ?? catNome}`,
      dettaglio: { prezzo: String(prezzo) },
    });
    const saleFull = (id, codicePos, articoli) => ({
      bisuiteId: `s-529-${id}`,
      codicePos,
      nomeNegozio: `Neg ${codicePos}`,
      nomeAddetto: "Anna",
      stato: "OK",
      dataVendita: oggiRoma(),
      totale: "30",
      rawData: { articoli },
    });
    // Ogni allegato per nome file (contiene lo slug "org — brand").
    const docsByName = async () => {
      const out = new Map();
      for (const f of telegramDocs) {
        const doc = f.get("document");
        out.set(String(doc.name ?? ""), await doc.text());
      }
      return out;
    };

    await test("Phone&Phone: tutti gli store senza codice POS + Back Office, banchetti esclusi", async () => {
      const row = (id, nomeNegozio) => ({
        ...saleFull(id, "", [artFull(null, "UNTIED", 30)]),
        codicePos: "",
        nomeNegozio,
      });
      setupScenario({
        orgs: [{
          id: "org-phone",
          name: "Phone&Phone",
          brands: [],
          puntiVendita: [],
        }],
        sales: [
          row("roma-est", "VODAFONE STORE ROMA EST"),
          row("fiumicino", "VODAFONE STORE FIUMICINO"),
          row("back-office", "BACK OFFICE VODAFONE PARTNER"),
          row("banchetto", "BANCHETTO FCO"),
        ],
      });
      await runScheduledSend("13:30");
      assert.equal(telegramDocs.length, 1);
      const h = await telegramDocs[0].get("document").text();
      assert.ok(h.includes("VODAFONE STORE ROMA EST"));
      assert.ok(h.includes("VODAFONE STORE FIUMICINO"));
      assert.ok(h.includes("BACK OFFICE VODAFONE PARTNER"));
      assert.ok(!h.includes("BANCHETTO FCO"));
    });

    await test("brand VF con vendite del listino ⇒ card Luce/Gas con conteggi reali; report WindTre intatto (Task #529)", async () => {
      setupScenario({
        orgs: [{
          id: "org-529",
          name: "Org Multi",
          brands: [{ id: "b-w3", name: "WindTre" }, { id: "b-vf", name: "Vodafone" }],
          puntiVendita: [
            { codicePos: "P100", nome: "Neg P100", brandIds: ["b-w3"] },
            { codicePos: "P200", nome: "Neg P200", brandIds: ["b-vf"] },
          ],
          garaConfig: {
            vfPisteConfig: {
              configPerPista: {
                luce: { targetS1: 1, targetS2: 2, targetS3: 4, premioS1: 50, premioS2: 100, premioS3: 200 },
                gas: { targetS1: 2, targetS2: 3, targetS3: 5, premioS1: 60, premioS2: 120, premioS3: 240 },
              },
            },
          },
        }],
        sales: [
          // Brand VF: conteggi reali per tutte le cinque piste dedicate.
          saleFull("vf1", "P200", [
            artFull("CANLUCE12208", "OFFERTE ENERGIA VF", 25),
            artFull("CANGAS012208", "OFFERTE ENERGIA VF", 20),
            artFull("CANIVAM12208", "OFFERTE IVA VF", 10),
            artFull("CANIVAW12208", "OFFERTE IVA VF", 10),
            artFull("CANVAS012208", "OFFERTE VAS VF", 10),
          ]),
          saleFull("vf2", "P200", [artFull("CANLUCE12208", "OFFERTE ENERGIA VF", 25)]),
          // Brand WindTre: una vendita mobile classica.
          saleFull("w31", "P100", [artFull(null, "UNTIED", 30)]),
        ],
        canvassRef: listinoVf,
      });
      await runScheduledSend("13:30");
      assert.equal(sendsFor("org-529").length, 2, "un invio per ciascun brand");
      assert.equal(telegramDocs.length, 2, "un allegato HTML per brand");
      const docs = await docsByName();
      const vfHtml = [...docs.entries()].find(([n]) => n.includes("vodafone"))?.[1];
      const w3Html = [...docs.entries()].find(([n]) => n.includes("windtre"))?.[1];
      assert.ok(vfHtml && w3Html, "allegati riconoscibili per brand nel nome file");
      // Card Luce e Gas con i pezzi REALI classificati dal listino.
      assert.match(vfHtml, />Luce<\/span><span class="pval">2 pz/, "card Luce con 2 pezzi nel report VF");
      assert.match(vfHtml, />Gas<\/span><span class="pval">1 pz/, "card Gas con 1 pezzo nel report VF");
      assert.match(vfHtml, />IVA Mobile<\/span><span class="pval">1 pz/, "card IVA Mobile valorizzata nel report VF");
      assert.match(vfHtml, />IVA Wireline<\/span><span class="pval">1 pz/, "card IVA Wireline valorizzata nel report VF");
      assert.match(vfHtml, />VAS<\/span><span class="pval">1 pz/, "card VAS valorizzata nel report VF");
      assert.ok(vfHtml.includes("IVA Mobile"), "proiezione/card IVA Mobile presente");
      assert.ok(!vfHtml.includes("Mobile P.IVA"), "vecchio indicatore Mobile P.IVA assente dal modello VF");
      assert.ok(!vfHtml.includes("Fisso P.IVA"), "vecchio indicatore Fisso P.IVA assente dal modello VF");
      assert.ok(vfHtml.includes("Raggiunta S2 · premio 100,00 €"), "soglia e premio Luce configurati nell'HTML");
      assert.ok(vfHtml.includes("S3 4 pz / 200,00 €"), "obiettivi completi Luce nell'HTML");
      assert.ok(vfHtml.includes("Mancano 1 pz alla prossima soglia"), "avanzamento Gas nell'HTML");
      assert.ok(!/>Energia<\/span>/.test(vfHtml), "nessuna card Energia generica nel report VF");
      // Il report WindTre resta col modello classico: niente piste VF,
      // la vendita UNTIED conta nella pista Mobile.
      assert.ok(!/>Luce<\/span>/.test(w3Html) && !/>Gas<\/span>/.test(w3Html), "nessuna pista VF nel report WindTre");
      assert.ok(!w3Html.includes("Raggiunta S2 · premio 100,00 €"), "nessun premio VF nel report WindTre");
      assert.match(w3Html, />Mobile<\/span><span class="pval">1 pz/, "vendita UNTIED nella pista Mobile del report WindTre");
    });

    await test("brand VF con listino NON caricabile ⇒ il report esce comunque (classificazione legacy, Task #529)", async () => {
      setupScenario({
        orgs: [{
          id: "org-529f",
          name: "Org VF",
          brands: [{ id: "b-vf", name: "Vodafone" }],
          puntiVendita: [{ codicePos: "P200", nome: "Neg P200", brandIds: ["b-vf"] }],
        }],
        sales: [saleFull("vf1", "P200", [
          // Offerta del listino: senza listino non è classificabile per pista.
          artFull("CANLUCE12208", "OFFERTE ENERGIA VF", 25),
          // Categoria della mappa legacy WindTre: DEVE finire in pista Mobile,
          // prova che la classificazione legacy è davvero attiva.
          artFull(null, "UNTIED", 30),
        ])],
        canvassRef: "throw",
      });
      await runScheduledSend("13:30");
      const sends = sendsFor("org-529f");
      assert.equal(sends.length, 1, "l'invio NON deve saltare se il listino non si carica");
      assert.equal(sends[0].brandKey, "b-vf");
      assert.equal(telegramCalls.length, 2, "messaggio + allegato inviati comunque");
      assert.equal(telegramDocs.length, 1);
      const h = await telegramDocs[0].get("document").text();
      // Fallback = classificazione legacy WindTre: UNTIED conta in Mobile...
      assert.match(h, />Mobile<\/span><span class="pval">1 pz/, "classificazione legacy attiva (UNTIED → Mobile)");
      // ...mentre l'offerta del listino non produce alcuna card Luce.
      assert.ok(!/>Luce<\/span>/.test(h), "nessuna card Luce senza listino (fallback legacy)");
    });

    await test("brand non-WindTre ma non VF ⇒ non riceve classificazione, soglie o premi Vodafone", async () => {
      setupScenario({
        orgs: [{
          id: "org-other",
          name: "Org Other",
          brands: [{ id: "b-tim", name: "TIM" }],
          puntiVendita: [{ codicePos: "P300", nome: "Neg P300", brandIds: ["b-tim"] }],
          garaConfig: {
            vfPisteConfig: {
              configPerPista: {
                luce: { targetS1: 1, targetS2: 2, targetS3: 3, premioS1: 50, premioS2: 100, premioS3: 200 },
              },
            },
          },
        }],
        sales: [saleFull("other1", "P300", [artFull("CANLUCE12208", "OFFERTE ENERGIA VF", 25)])],
        canvassRef: listinoVf,
      });
      await runScheduledSend("13:30");
      assert.equal(telegramDocs.length, 1);
      const h = await telegramDocs[0].get("document").text();
      assert.ok(!/>Luce<\/span>/.test(h), "nessuna pista VF per un brand diverso da Vodafone/Fastweb");
      assert.ok(!h.includes("premio 50,00 €"), "nessun premio VF per un brand diverso da Vodafone/Fastweb");
    });

    await test("recovery al boot con orari cambiati rispetto agli invii registrati ⇒ nessun duplicato", async () => {
      // Ieri sera l'org aveva parziale=13:30 (inviato e registrato come
      // "13:30"); oggi l'orario è 14:00 e il processo riparte alle 14:30:
      // recoverableSlot indica 14:00 ma la fascia parziale è già coperta.
      setupScenario({
        orgs: [{ id: "org-a", sendTimes: { parziale: "14:00", chiusura: "22:15" } }],
        sent: { "org-a": ["13:30"] },
      });
      const times = await collectSendTimes();
      const boot = new Date(Date.UTC(2026, 6, 2, 12, 30, 0)); // 14:30 Roma
      const rec = recSlot(boot, 90, times);
      assert.deepEqual(rec, { ymd: "2026-07-02", label: "14:00" });
      await runScheduledSend(rec.label, { recovery: true });
      assert.equal(sendsFor("org-a").length, 0, "recovery non deve duplicare il parziale");
      assert.equal(telegramCalls.length, 0);
    });

    await test("recovery al boot recupera davvero le org rimaste senza report", async () => {
      // Stessa finestra di recovery, ma nessun invio registrato: la run
      // di recovery DEVE inviare (lo slot era andato perso per il restart).
      setupScenario({
        orgs: [{ id: "org-a", sendTimes: { parziale: "14:00", chiusura: "22:15" } }],
      });
      await runScheduledSend("14:00", { recovery: true });
      assert.equal(sendsFor("org-a").length, 1);
      assert.equal(sendsFor("org-a")[0].label, "14:00");
    });

    await test("slot di un'altra org ⇒ chi non ha quell'orario viene saltato senza invio", async () => {
      // org-b sposta il parziale a 15:00: allo scatto delle 15:00 solo
      // org-b invia; org-a (13:30 già inviato o meno) non deve partire.
      setupScenario({
        orgs: [
          { id: "org-a" }, // default 13:30/22:15
          { id: "org-b", sendTimes: { parziale: "15:00", chiusura: "22:15" } },
        ],
        sent: { "org-a": ["13:30"] },
      });
      const times = await collectSendTimes();
      assert.deepEqual(times.map((t) => t.label), ["13:30", "15:00", "22:15"]);
      await runScheduledSend("15:00");
      assert.equal(sendsFor("org-a").length, 0);
      assert.equal(sendsFor("org-b").length, 1);
      assert.equal(sendsFor("org-b")[0].label, "15:00");
    });

    await test("run ripetuta dello stesso slot (timer doppio) ⇒ il secondo giro non re-invia", async () => {
      setupScenario({
        orgs: [{ id: "org-a", sendTimes: { parziale: "15:00", chiusura: "22:15" } }],
      });
      await runScheduledSend("15:00");
      await runScheduledSend("15:00");
      assert.equal(sendsFor("org-a").length, 1, "seconda run stesso slot deduplicata");
      assert.equal(telegramCalls.length, 2);
    });

    // ── Avviso plafond ricariche nel messaggio (Task #538) ──────────────
    const plafondScenario = (nomeRs, { saldo, sogliaOp } = {}) => {
      const rsId = "rs-1";
      const ops = [{
        ragioneSocialeId: rsId,
        tipo: "imposta",
        importo: String(saldo),
        saldoPrima: "0",
        saldoDopo: String(saldo),
        consumoCutoff: null,
        createdAt: new Date("2026-01-01T10:00:00Z"),
      }];
      if (sogliaOp !== undefined) {
        ops.push({
          ragioneSocialeId: rsId,
          tipo: "soglia",
          importo: String(sogliaOp),
          saldoPrima: String(saldo),
          saldoDopo: String(saldo),
          consumoCutoff: null,
          createdAt: new Date("2026-01-01T11:00:00Z"),
        });
      }
      return { ops, registry: [{ id: rsId, nome: nomeRs }], consumo: [] };
    };

    await test("plafond sotto soglia ⇒ avviso nel messaggio, con nome RS escapato per l'HTML Telegram (Task #538)", async () => {
      // Nome RS con caratteri speciali HTML: '&' e '<' devono arrivare
      // escapati o Telegram rifiuta l'INTERO messaggio (parse_mode HTML).
      const nome = "ROSSI & FIGLI <SRL>";
      setupScenario({
        // Task #548: la RS deve avere almeno un PDV in Struttura o non
        // materializza alcuna riga plafond (e quindi nessun avviso).
        orgs: [{ id: "org-p", puntiVendita: [{ codicePos: "PP1", nome: "Neg PP1", ragioneSociale: nome }] }],
        plafond: plafondScenario(nome, { saldo: 20 }), // sotto default 50
      });
      await runScheduledSend("13:30");
      assert.equal(telegramMessages.length, 1);
      const msg = telegramMessages[0];
      assert.ok(msg.includes("PLAFOND RICARICHE IN ESAURIMENTO"), "blocco avviso presente");
      assert.ok(msg.includes("ROSSI &amp; FIGLI &lt;SRL&gt;"), `nome RS escapato nel messaggio: ${msg.slice(-200)}`);
      assert.ok(!msg.includes(nome), "il nome RS grezzo (non escapato) non deve comparire");
      assert.ok(msg.includes("sotto la soglia"), "testo sotto-soglia presente");
    });

    await test("plafond negativo ⇒ avviso ESAURITO; saldo sopra soglia ⇒ nessun avviso", async () => {
      setupScenario({
        orgs: [{ id: "org-p", puntiVendita: [{ codicePos: "PN1", nome: "Neg PN1", ragioneSociale: "RS NEGATIVA" }] }],
        plafond: plafondScenario("RS NEGATIVA", { saldo: -12.5 }),
      });
      await runScheduledSend("13:30");
      assert.ok(telegramMessages[0].includes("plafond ESAURITO"), "avviso esaurito per saldo negativo");

      setupScenario({
        orgs: [{ id: "org-p2", puntiVendita: [{ codicePos: "PO1", nome: "Neg PO1", ragioneSociale: "RS OK" }] }],
        plafond: plafondScenario("RS OK", { saldo: 500 }),
      });
      await runScheduledSend("13:30");
      assert.equal(telegramMessages.length, 1);
      assert.ok(!telegramMessages[0].includes("PLAFOND RICARICHE"), "nessun avviso con saldo sopra soglia");
    });

    await test("report per brand: l'avviso plafond compare UNA sola volta per org (solo primo invio)", async () => {
      setupScenario({
        orgs: [{
          id: "org-pb",
          brands: [{ id: "b-w3", name: "WindTre" }, { id: "b-vf", name: "Vodafone" }],
          puntiVendita: [
            { codicePos: "P100", nome: "Neg P100", brandIds: ["b-w3"] },
            { codicePos: "P200", nome: "Neg P200", brandIds: ["b-vf"] },
          ],
          puntiVendita: [
            { codicePos: "P100", nome: "Neg P100", brandIds: ["b-w3"], ragioneSociale: "RS SOTTO" },
            { codicePos: "P200", nome: "Neg P200", brandIds: ["b-vf"] },
          ],
        }],
        plafond: plafondScenario("RS SOTTO", { saldo: 5 }),
      });
      await runScheduledSend("13:30");
      assert.equal(telegramMessages.length, 2, "un messaggio per brand");
      const withWarning = telegramMessages.filter((m) => m.includes("PLAFOND RICARICHE IN ESAURIMENTO"));
      assert.equal(withWarning.length, 1, "avviso solo nel primo report dell'org, non duplicato per brand");
      assert.ok(telegramMessages[0].includes("PLAFOND RICARICHE"), "l'avviso sta sul primo invio");
    });

    await test("errore nel calcolo plafond ⇒ il report parte comunque senza avviso (best-effort)", async () => {
      setupScenario({ orgs: [{ id: "org-perr" }] });
      const prevOps = storage.listPlafondRicaricheOps;
      storage.listPlafondRicaricheOps = async () => { throw new Error("DB giù (test)"); };
      try {
        await runScheduledSend("13:30");
      } finally {
        storage.listPlafondRicaricheOps = prevOps;
      }
      assert.equal(telegramMessages.length, 1, "il report viene inviato comunque");
      assert.ok(!telegramMessages[0].includes("PLAFOND RICARICHE"), "nessun avviso se il calcolo fallisce");
    });

    // ── Integrazione timer: startTelegramReportScheduler + rescheduleTelegramReports ──
    // setTimeout/clearTimeout globali fintati: si verifica il percorso REALE
    // di salvataggio config ⇒ reschedule (timer vecchio cancellato, uno solo
    // attivo, recovery immediata di uno slot spostato su un orario passato).
    const realSetTimeout = globalThis.setTimeout;
    const realClearTimeout = globalThis.clearTimeout;
    const flush = (ms = 50) => new Promise((r) => realSetTimeout(r, ms));
    let fakeTimers = []; // { id, fn, delay, cleared }
    let nextTimerId = 1;
    globalThis.setTimeout = (fn, delay, ...args) => {
      // I timer "lunghi" sono dello scheduler; quelli brevi (< 5s) passano
      // al setTimeout reale per non rompere eventuali attese interne.
      if (typeof delay === "number" && delay >= 5000) {
        const t = { id: { unref() {} }, fn, delay, cleared: false };
        t.id.__fake = t;
        fakeTimers.push(t);
        return t.id;
      }
      return realSetTimeout(fn, delay, ...args);
    };
    globalThis.clearTimeout = (id) => {
      if (id && id.__fake) {
        id.__fake.cleared = true;
        return;
      }
      return realClearTimeout(id);
    };
    // Timer ESTRANEI possono finire nella cattura (es. pg-pool arma un
    // "remove idle client" da 10s in momenti non deterministici): contarli
    // faceva flakare gli assert `activeTimers().length === 1`. Il timer dello
    // scheduler è identificato in modo deterministico dal SUO callback
    // (la closure di scheduleNext chiama runScheduledSend); i timer estranei
    // restano comunque catturati, così non scattano davvero durante la suite.
    const isSchedulerTimer = (t) => String(t.fn).includes("runScheduledSend");
    const activeTimers = () => fakeTimers.filter((t) => !t.cleared && isSchedulerTimer(t));

    // Orario di Roma "adesso", per costruire label passati/futuri validi.
    const romeNowMinutes = () => {
      const fmt = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Europe/Rome",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      });
      const [h, m] = fmt.format(new Date()).split(":").map((x) => parseInt(x, 10));
      return (h % 24) * 60 + m;
    };
    const labelOfMinutes = (min) => {
      const norm = ((min % 1440) + 1440) % 1440;
      const h = Math.floor(norm / 60);
      return `${String(h).padStart(2, "0")}:${String(norm % 60).padStart(2, "0")}`;
    };

    try {
      const nowMin = romeNowMinutes();
      // Serve un orario di OGGI passato da ~30 min (finestra recovery 90 min),
      // fuori dalla fascia vietata 02:00–02:59. Vicino a mezzanotte o alle 02
      // il test non è costruibile in modo affidabile: si salta (raro).
      let pastMin = nowMin - 30;
      if (Math.floor(pastMin / 60) === 2) pastMin = 119; // 01:59, comunque entro 90 min
      const feasible = nowMin >= 35 && Math.floor(pastMin / 60) !== 2;
      const pastLabel = labelOfMinutes(pastMin);
      const futureLabel = labelOfMinutes(nowMin + 300); // sempre valido come "altro" orario
      const otherLabel = futureLabel === pastLabel ? labelOfMinutes(nowMin + 360) : futureLabel;

      await test("startTelegramReportScheduler arma UN solo timer sul prossimo slot", async () => {
        // Entrambe le fasce già inviate: il recovery al boot non deve inviare.
        setupScenario({
          orgs: [{ id: "org-a" }], // default 13:30/22:15
          sent: { "org-a": ["13:30", "22:15"] },
        });
        schedMod.startTelegramReportScheduler();
        await flush();
        assert.equal(activeTimers().length, 1, "un solo timer attivo dopo lo start");
        assert.equal(recordedSends.length, 0, "boot recovery deduplicata, nessun invio");
      });

      await test("salvataggio config ⇒ reschedule: timer vecchio cancellato, uno solo attivo", async () => {
        setupScenario({
          orgs: [{ id: "org-a", sendTimes: { parziale: otherLabel, chiusura: "23:59" === otherLabel ? "23:58" : "23:59" } }],
          sent: { "org-a": ["13:30", "22:15"] },
        });
        const before = activeTimers()[0];
        schedMod.rescheduleTelegramReports();
        await flush();
        assert.ok(before.cleared, "il timer precedente va cancellato");
        assert.equal(activeTimers().length, 1, "dopo il reschedule resta UN solo timer");
      });

      await test("recoverableSlots: TUTTI gli slot in finestra, dal più vecchio al più recente", () => {
        // 2 luglio 2026, 15:00 Roma (CEST): 14:00 e 14:40 in finestra 90 min,
        // 13:00 fuori finestra, 16:00 futuro, 22:15 futuro.
        const at1500 = new Date(Date.UTC(2026, 6, 2, 13, 0, 0));
        const times = ["13:00", "14:00", "14:40", "16:00", "22:15"].map((label) => ({
          label,
          minutes: parseInt(label.slice(0, 2), 10) * 60 + parseInt(label.slice(3), 10),
        }));
        assert.deepEqual(schedMod.recoverableSlots(at1500, 90, times), [
          { ymd: "2026-07-02", label: "14:00" },
          { ymd: "2026-07-02", label: "14:40" },
        ]);
        // recoverableSlot resta il più recente.
        assert.deepEqual(schedMod.recoverableSlot(at1500, 90, times), {
          ymd: "2026-07-02",
          label: "14:40",
        });
      });

      if (feasible && nowMin >= 65) {
        await test("due org con slot passati DIVERSI ⇒ il reschedule recupera entrambe (non solo lo slot più recente)", async () => {
          // org-a ha spostato il parziale a now-60 (non inviato), org-b a
          // now-30 (GIÀ inviato): recuperare solo lo slot più recente
          // lascerebbe org-a senza report.
          const olderLabel = labelOfMinutes(nowMin - 60);
          const olderOk = Math.floor((nowMin - 60) / 60) !== 2 && olderLabel !== pastLabel;
          if (!olderOk) return; // fascia 02:xx: caso non costruibile ora
          setupScenario({
            orgs: [
              { id: "org-a", sendTimes: { parziale: olderLabel, chiusura: otherLabel } },
              { id: "org-b", sendTimes: { parziale: pastLabel, chiusura: otherLabel } },
            ],
            sent: { "org-b": [pastLabel] },
          });
          schedMod.rescheduleTelegramReports();
          await flush(200);
          assert.equal(sendsFor("org-a").length, 1, "anche lo slot meno recente va recuperato");
          assert.equal(sendsFor("org-a")[0].label, olderLabel);
          assert.equal(sendsFor("org-b").length, 0, "org-b già servita: nessun doppione");
        });
      }

      if (feasible) {
        await test("reschedule CONCORRENTI (salvataggi ravvicinati) ⇒ un solo invio per org (run serializzate)", async () => {
          setupScenario({
            orgs: [{ id: "org-a", sendTimes: { parziale: pastLabel, chiusura: otherLabel } }],
          });
          // Due reschedule back-to-back senza attese: senza serializzazione
          // entrambe le recovery leggerebbero "non inviato" e duplicherebbero.
          schedMod.rescheduleTelegramReports();
          schedMod.rescheduleTelegramReports();
          await flush(200);
          assert.equal(sendsFor("org-a").length, 1, "recovery concorrenti non devono duplicare");
          assert.equal(
            telegramCalls.length,
            2,
            "un solo messaggio + un solo allegato nonostante il doppio reschedule",
          );
          assert.equal(activeTimers().length, 1);
        });

        await test("parziale NON inviato spostato a un orario già passato ⇒ recovery immediata al reschedule (nessuno slot perso)", async () => {
          setupScenario({
            orgs: [{ id: "org-a", sendTimes: { parziale: pastLabel, chiusura: otherLabel } }],
          });
          schedMod.rescheduleTelegramReports();
          await flush(150);
          assert.equal(sendsFor("org-a").length, 1, "lo slot spostato all'indietro va recuperato subito");
          assert.equal(sendsFor("org-a")[0].label, pastLabel);
          assert.equal(activeTimers().length, 1);
        });

        await test("parziale GIÀ inviato spostato a un orario passato ⇒ il reschedule non re-invia", async () => {
          setupScenario({
            orgs: [{ id: "org-a", sendTimes: { parziale: pastLabel, chiusura: otherLabel } }],
            sent: { "org-a": ["13:30", "22:15"] },
          });
          schedMod.rescheduleTelegramReports();
          await flush(150);
          assert.equal(sendsFor("org-a").length, 0, "fascia già coperta: nessun doppione dal reschedule");
          assert.equal(activeTimers().length, 1);
        });
      } else {
        console.log("  (orario attuale a ridosso di mezzanotte/02:00 — test recovery-reschedule saltati)");
      }
    } finally {
      globalThis.setTimeout = realSetTimeout;
      globalThis.clearTimeout = realClearTimeout;
    }
  } finally {
    for (const [name, fn] of Object.entries(originals)) storage[name] = fn;
    if (cdgMod.cdgStorage) {
      for (const [name, fn] of Object.entries(cdgOriginals)) cdgMod.cdgStorage[name] = fn;
    }
    globalThis.fetch = originalFetch;
  }
} else {
  console.log("  (scheduler/storage non importabili in questo ambiente — sezione saltata)");
  failed++;
}

console.log(`\nRisultato: ${passed} passati, ${failed} falliti`);
// Exit esplicito anche in caso di successo: l'import di server/storage crea
// il pool Postgres, i cui handle vivi terrebbero il processo appeso.
process.exit(failed > 0 ? 1 : 0);
