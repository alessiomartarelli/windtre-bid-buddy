// Task #405: test della logica di drift schema (shared/schemaDrift.ts) e
// del formato messaggio/scheduling del check periodico. Puro, nessun DB.
// Uso: npx tsx scripts/test-schema-drift.ts

import {
  buildDbColumnMap,
  collectExpectedTables,
  compareSchema,
} from "../shared/schemaDrift";

let failures = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) {
    console.log(`  ok - ${name}`);
  } else {
    failures++;
    console.error(`  FAIL - ${name}${detail ? `: ${detail}` : ""}`);
  }
}

// 1) collectExpectedTables enumera le tabelle reali dello schema.
const tables = collectExpectedTables();
check("collectExpectedTables trova tabelle", tables.length > 10, `trovate ${tables.length}`);
const profiles = tables.find((t) => t.name === "profiles");
check("tabella profiles presente", !!profiles);
check(
  "profiles ha colonne note",
  !!profiles && profiles.columns.includes("id") && profiles.columns.length > 3,
);

// 2) compareSchema: DB perfettamente allineato => nessun problema.
const perfectRows = tables.flatMap((t) =>
  t.columns.map((c) => ({ table_name: t.name, column_name: c })),
);
check(
  "DB allineato => zero problemi",
  compareSchema(tables, buildDbColumnMap(perfectRows)).length === 0,
);

// 3) Tabella mancante.
const withoutUsers = perfectRows.filter((r) => r.table_name !== "profiles");
const p3 = compareSchema(tables, buildDbColumnMap(withoutUsers));
check(
  "tabella mancante segnalata",
  p3.length === 1 && p3[0] === "missing table: profiles",
  JSON.stringify(p3),
);

// 4) Colonna mancante.
const firstUserCol = profiles!.columns[0];
const withoutCol = perfectRows.filter(
  (r) => !(r.table_name === "profiles" && r.column_name === firstUserCol),
);
const p4 = compareSchema(tables, buildDbColumnMap(withoutCol));
check(
  "colonna mancante segnalata",
  p4.length === 1 && p4[0] === `missing column: profiles.${firstUserCol}`,
  JSON.stringify(p4),
);

// 5) Colonne/tabelle EXTRA nel DB non sono un problema.
const withExtra = perfectRows.concat([
  { table_name: "profiles", column_name: "colonna_legacy_extra" },
  { table_name: "tabella_legacy", column_name: "id" },
]);
check(
  "extra nel DB ignorati",
  compareSchema(tables, buildDbColumnMap(withExtra)).length === 0,
);

// 6) Scheduler: formato messaggio, limite Telegram, dedup su invio fallito.
// Importato dinamicamente perché server/schemaDriftScheduler importa
// server/db (richiede DATABASE_URL, presente in dev).
const {
  formatDriftMessage,
  checkAndNotify,
  __setTestOverrides,
} = await import("../server/schemaDriftScheduler");

// 6a) Messaggio enorme resta sotto i 4096 char con tag HTML bilanciati.
const hugeProblems = Array.from(
  { length: 500 },
  (_, i) => `missing column: tabella_lunga_${i}.colonna_con_nome_molto_lungo_${i}`,
);
const hugeMsg = formatDriftMessage(hugeProblems);
check("messaggio enorme sotto il limite Telegram", hugeMsg.length <= 4096, `len=${hugeMsg.length}`);
check(
  "tag <code> bilanciati",
  (hugeMsg.match(/<code>/g) ?? []).length === (hugeMsg.match(/<\/code>/g) ?? []).length,
);
check("indica i problemi omessi", /… e altri \d+ problemi/.test(hugeMsg));
const smallMsg = formatDriftMessage(["missing table: foo"]);
check("messaggio piccolo senza riga omessi", !/… e altri/.test(smallMsg) && smallMsg.includes("missing table: foo"));

// 6b) Dedup: aggiornato SOLO a invio riuscito.
process.env.TELEGRAM_BOT_TOKEN = "test-token";
process.env.TELEGRAM_CHAT_ID = "test-chat";
const drift = { problems: ["missing table: foo"], tableCount: 1 };
let sendCalls = 0;
let sendOk = false;
__setTestOverrides({
  send: async () => {
    sendCalls++;
    return sendOk ? { ok: true } : { ok: false, error: "network down" };
  },
  runCheck: async () => drift,
});

await checkAndNotify("test-1"); // invio fallisce
check("primo invio tentato", sendCalls === 1, `sendCalls=${sendCalls}`);
await checkAndNotify("test-2"); // deve RITENTARE (niente dedup su failure)
check("retry dopo invio fallito", sendCalls === 2, `sendCalls=${sendCalls}`);

sendOk = true;
await checkAndNotify("test-3"); // invio riesce => dedup attivo
check("terzo invio riuscito", sendCalls === 3, `sendCalls=${sendCalls}`);
await checkAndNotify("test-4"); // stesso drift, stesso giorno => nessun invio
check("dedup dopo invio riuscito", sendCalls === 3, `sendCalls=${sendCalls}`);

// 6c) Rientro: notifica di risoluzione una sola volta.
drift.problems = [];
await checkAndNotify("test-5");
check("notifica rientro inviata", sendCalls === 4, `sendCalls=${sendCalls}`);
await checkAndNotify("test-6");
check("rientro notificato una sola volta", sendCalls === 4, `sendCalls=${sendCalls}`);

__setTestOverrides(null);

if (failures > 0) {
  console.error(`\n${failures} test falliti`);
  process.exit(1);
}
console.log("\nTutti i test schema-drift passati.");
