// Test PURI del report vendite giornaliero su Telegram (Task #239).
// Coprono shared/venditeReport.ts (aggregazione + messaggio) e
// msUntilNextSend / resolveTelegramConfig di server/telegramReportScheduler.ts
// nella parte pura. NON serve né dev server né DB: i moduli TS sono caricati
// via loader tsx (import relativi in shared/).
import assert from "node:assert/strict";

const {
  aggregateDailyReport,
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
} = await import("../shared/venditeReport.ts");
const {
  buildVenditeReportHtml,
  reportHtmlFileName,
  escapeHtml,
  svgAreaChart,
} = await import("../shared/venditeReportHtml.ts");

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
function art(categoria, prezzo) {
  return { categoria: { nome: categoria }, dettaglio: { prezzo: String(prezzo) } };
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

await test("giorno senza vendite ⇒ messaggio 'Nessuna vendita'", () => {
  const msg = buildTelegramReportMessage({
    orgName: "Org Test",
    dateYMD: "2026-07-02",
    timeLabel: "13:30",
    aggregates: aggregateDailyReport([]),
  });
  assert.ok(msg.includes("Report vendite 02/07/2026"));
  assert.ok(msg.includes("13:30"));
  assert.ok(msg.includes("Org Test"));
  assert.ok(msg.includes("Nessuna vendita registrata oggi."));
  assert.ok(!msg.includes("Per tipo"));
});

await test("messaggio completo: totali, sezioni tipo/pista/PDV, solo voci > 0", () => {
  const aggregates = aggregateDailyReport([
    sale({ codicePos: "P1", nomeNegozio: "Centro", totale: "130", articoli: [art("UNTIED", 30), art("TELEFONIA", 100)] }),
    sale({ codicePos: "P2", nomeNegozio: "Mare", totale: "20", articoli: [art("ENERGIA W3", 20)] }),
  ]);
  const msg = buildTelegramReportMessage({
    orgName: "Org & Co <srl>",
    dateYMD: "2026-07-02",
    aggregates,
  });
  assert.ok(msg.includes("Vendite: <b>2</b>"));
  assert.ok(msg.includes("Importo totale: <b>150,00 €</b>"));
  assert.ok(msg.includes("<b>Per tipo</b>"));
  assert.ok(msg.includes("Canvass: 2 pz — 50,00 €"));
  assert.ok(msg.includes("Prodotti: 1 pz — 100,00 €"));
  assert.ok(!msg.includes("Servizi:")); // zero pezzi ⇒ riga assente
  assert.ok(msg.includes("<b>Per pista</b>"));
  assert.ok(msg.includes("Mobile: 1 pz — 30,00 €"));
  assert.ok(msg.includes("Energia: 1 pz — 20,00 €"));
  assert.ok(!msg.includes("Fisso:"));
  assert.ok(msg.includes("<b>Per punto vendita</b>"));
  assert.ok(msg.includes("Centro (P1): 1 vendite — 130,00 €"));
  // Ordine PDV per importo decrescente
  assert.ok(msg.indexOf("Centro (P1)") < msg.indexOf("Mare (P2)"));
  // Escape HTML di nomi con caratteri speciali
  assert.ok(msg.includes("Org &amp; Co &lt;srl&gt;"));
  assert.ok(!msg.includes("<srl>"));
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
  // Highlights: top negozio/addetto/pista
  assert.ok(html.includes("Top negozio"));
  assert.ok(html.includes("Top addetto"));
  assert.ok(html.includes("Pista del giorno"));
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
  assert.ok(html.includes('<div class="bar">'));
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
    sale({ totale: "100", articoli: [art("UNTIED", 50)] }),
    sale({ totale: "200", articoli: [art("LUCE", 80)] }),
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
  assert.ok(html.includes('id="nav-month"'));
  assert.ok(html.includes("Tocca per il totale del mese"));
  assert.ok(html.includes("Tocca per tornare al giorno"));
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

  await test("alle 14:00 Roma il prossimo invio è alle 22:30", () => {
    const { delayMs, label } = msUntilNextSend(romeDate(14, 0));
    assert.equal(label, "22:30");
    const expected = 8.5 * 3600 * 1000;
    assert.ok(Math.abs(delayMs - expected) < 60_000);
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

  await test("DST: anche 13:30 → 22:30 nello STESSO giorno del cambio resta 9h", () => {
    // Domenica 29/03/2026 14:00 Roma = 12:00 UTC (CEST già attivo).
    const now = new Date(Date.UTC(2026, 2, 29, 12, 0, 0));
    const { delayMs, label } = msUntilNextSend(now);
    assert.equal(label, "22:30");
    const expected = 8.5 * 3600 * 1000; // 22:30 - 14:00, nessuna transizione in mezzo
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
  assert.ok(html.includes(">Servizi <span"), "manca la card servizi");
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
  assert.ok(!html.includes(">Servizi <span"));
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

console.log(`\nRisultato: ${passed} passati, ${failed} falliti`);
if (failed > 0) process.exit(1);
