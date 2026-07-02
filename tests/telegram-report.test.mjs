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
} = await import("../shared/venditeReport.ts");

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
function sale({ stato = "COMPLETATA", totale = "0", codicePos = "POS1", nomeNegozio = "Negozio 1", articoli = [] } = {}) {
  return {
    stato,
    totale,
    codicePos,
    nomeNegozio,
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
