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

await test("HTML: dashboard completa con hero, card piste, tipi, classifiche PDV e addetti", () => {
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
  assert.ok(html.includes("Importo totale"));
  assert.ok(html.includes("150,00 €"));
  // Card piste: solo piste con pezzi > 0, con tema colorato inline
  assert.ok(html.includes(">Mobile</div>"));
  assert.ok(html.includes(">Energia</div>"));
  assert.ok(!html.includes(">Fisso</div>"));
  assert.ok(html.includes("border-color:#2563eb")); // tema pista mobile
  // Breakdown categorie dentro la card pista
  assert.ok(html.includes("<span>UNTIED</span><b>1</b>"));
  // Tipi: solo voci > 0 (niente Servizi)
  assert.ok(html.includes(">Canvass</div>"));
  assert.ok(html.includes(">Prodotti</div>"));
  assert.ok(!html.includes(">Servizi</div>"));
  // Classifica PDV ordinata per importo↓ con barre
  assert.ok(html.includes("Per punto vendita"));
  assert.ok(html.indexOf("Centro") < html.indexOf("Mare"));
  assert.ok(html.includes('<span class="mono">P1</span>'));
  assert.ok(html.includes('<div class="bar">'));
  // Classifica addetti con medaglie top 3
  assert.ok(html.includes("Per addetto"));
  assert.ok(html.includes("🥇 Mario Rossi"));
  assert.ok(html.includes("🥈 Luigi Verdi"));
  assert.ok(html.indexOf("Mario Rossi") < html.indexOf("Luigi Verdi")); // 130 > 20
  // Senza trend: nessun grafico né KPI comparativi
  assert.ok(!html.includes("<svg"));
  assert.ok(!html.includes(">Ieri</div>"));
  // Nessuna risorsa esterna
  assert.ok(!html.includes("http://") && !html.includes("https://"));
});

await test("HTML con trend: KPI oggi/ieri/media, grafico andamento e sparkline pista", () => {
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
  // KPI comparativi
  assert.ok(html.includes(">Oggi</div>"));
  assert.ok(html.includes(">Ieri</div>"));
  assert.ok(html.includes(">Media 7 gg</div>"));
  // Delta: oggi(1) vs ieri(2) = -50% ▼; media 7gg = (4+2)/2 = 3 ⇒ -67% ▼
  assert.ok(html.includes("▼ 50% oggi vs ieri"));
  assert.ok(html.includes("▼ 67% oggi vs media"));
  // Grafico andamento + assi con date
  assert.ok(html.includes("Andamento — vendite ultimi 3 giorni"));
  assert.ok(html.includes("<svg"));
  assert.ok(html.includes("30/06"));
  assert.ok(html.includes("max 4"));
  // Sparkline dentro la card pista mobile
  assert.ok(html.includes("Andamento Mobile"));
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
  assert.ok(!html.includes('<div class="kpi-value">'));
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
  assert.ok(html.includes("Andamento — vendite ultimi 2 giorni"));
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

console.log(`\nRisultato: ${passed} passati, ${failed} falliti`);
if (failed > 0) process.exit(1);
