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

import { Client } from "pg";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import * as schema from "../shared/schema";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("ERROR: DATABASE_URL env var is required");
    process.exit(1);
  }

  // Raccogli tutte le pgTable esportate da shared/schema.ts
  const tables: { name: string; columns: string[] }[] = [];
  for (const value of Object.values(schema)) {
    if (value instanceof PgTable) {
      const cfg = getTableConfig(value);
      tables.push({ name: cfg.name, columns: cfg.columns.map((c) => c.name) });
    }
  }
  if (tables.length === 0) {
    console.error("ERROR: no pgTable exports found in shared/schema.ts");
    process.exit(1);
  }

  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    const res = await client.query<{ table_name: string; column_name: string }>(
      `SELECT table_name, column_name
         FROM information_schema.columns
        WHERE table_schema = 'public'`
    );
    const dbCols = new Map<string, Set<string>>();
    for (const row of res.rows) {
      let set = dbCols.get(row.table_name);
      if (!set) {
        set = new Set();
        dbCols.set(row.table_name, set);
      }
      set.add(row.column_name);
    }

    const problems: string[] = [];
    for (const t of tables) {
      const cols = dbCols.get(t.name);
      if (!cols) {
        problems.push(`missing table: ${t.name}`);
        continue;
      }
      for (const c of t.columns) {
        if (!cols.has(c)) problems.push(`missing column: ${t.name}.${c}`);
      }
    }

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
