// Task #404: controllo automatico di drift tra shared/schema.ts e il DB
// di produzione, eseguito dal deploy DOPO il sync (drizzle-kit push) e
// PRIMA dello swap di dist. Se una tabella o colonna attesa dal codice
// non esiste nel DB, esce con codice != 0 e il deploy si ferma: è la rete
// di sicurezza contro il bug "vendite sparite" (colonna alias delle
// Ragioni Sociali mai applicata a prod).
//
// Uso: DATABASE_URL=postgres://... npx tsx scripts/verify-prod-schema.ts
//
// Nota: confronta SOLO in direzione codice -> DB (tabelle/colonne che il
// codice si aspetta). Colonne extra nel DB non bloccano il deploy: non
// causano 500, e drizzle-kit push non le rimuove senza conferma.
//
// Task #405: la logica di confronto vive in shared/schemaDrift.ts, riusata
// anche dal check periodico in prod (server/schemaDriftScheduler.ts) che
// notifica su Telegram il drift nato TRA un deploy e l'altro.

import { Client } from "pg";
import {
  buildDbColumnMap,
  collectExpectedTables,
  compareSchema,
  DB_COLUMNS_QUERY,
  type DbColumnRow,
} from "../shared/schemaDrift";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("ERROR: DATABASE_URL env var is required");
    process.exit(1);
  }

  const tables = collectExpectedTables();
  if (tables.length === 0) {
    console.error("ERROR: no pgTable exports found in shared/schema.ts");
    process.exit(1);
  }

  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    const res = await client.query<DbColumnRow>(DB_COLUMNS_QUERY);
    const problems = compareSchema(tables, buildDbColumnMap(res.rows));

    if (problems.length > 0) {
      console.error("SCHEMA DRIFT DETECTED between shared/schema.ts and the database:");
      for (const p of problems) console.error(`  - ${p}`);
      console.error(
        "The DB is missing objects the new code expects. Run drizzle-kit push against this DB and re-verify BEFORE swapping dist."
      );
      process.exit(1);
    }
    console.log(
      `Schema OK: ${tables.length} tables, all expected columns present in the database.`
    );
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error("ERROR: schema verification failed to run:", err);
  process.exit(1);
});
