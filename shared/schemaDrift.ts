// Task #405: logica riusabile di confronto tra shared/schema.ts e le
// colonne reali di un database Postgres. Usata sia dal check di deploy
// (scripts/verify-prod-schema.ts) sia dal controllo periodico in prod
// (server/schemaDriftScheduler.ts) che notifica su Telegram.
//
// Import relativi (niente alias @shared) così i test tsx possono caricare
// questo modulo direttamente.

import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import * as schema from "./schema";

export interface ExpectedTable {
  name: string;
  columns: string[];
}

/** Enumera tutte le pgTable esportate da shared/schema.ts. */
export function collectExpectedTables(): ExpectedTable[] {
  const tables: ExpectedTable[] = [];
  for (const value of Object.values(schema)) {
    if (value instanceof PgTable) {
      const cfg = getTableConfig(value);
      tables.push({ name: cfg.name, columns: cfg.columns.map((c) => c.name) });
    }
  }
  return tables;
}

/**
 * Confronta le tabelle attese dal codice con le colonne reali del DB
 * (mappa table_name -> set di column_name, schema public).
 *
 * Ritorna l'elenco dei problemi in direzione codice -> DB: tabelle o
 * colonne che il codice si aspetta ma il DB non ha. Colonne extra nel DB
 * non sono un problema (non causano 500 e drizzle-kit push non le rimuove
 * senza conferma).
 */
export function compareSchema(
  expected: ExpectedTable[],
  dbCols: Map<string, Set<string>>,
): string[] {
  const problems: string[] = [];
  for (const t of expected) {
    const cols = dbCols.get(t.name);
    if (!cols) {
      problems.push(`missing table: ${t.name}`);
      continue;
    }
    for (const c of t.columns) {
      if (!cols.has(c)) problems.push(`missing column: ${t.name}.${c}`);
    }
  }
  return problems;
}

/** Righe di information_schema.columns (schema public). */
export interface DbColumnRow {
  table_name: string;
  column_name: string;
}

export const DB_COLUMNS_QUERY = `SELECT table_name, column_name
   FROM information_schema.columns
  WHERE table_schema = 'public'`;

/** Costruisce la mappa table -> colonne dalle righe della query. */
export function buildDbColumnMap(rows: DbColumnRow[]): Map<string, Set<string>> {
  const dbCols = new Map<string, Set<string>>();
  for (const row of rows) {
    let set = dbCols.get(row.table_name);
    if (!set) {
      set = new Set();
      dbCols.set(row.table_name, set);
    }
    set.add(row.column_name);
  }
  return dbCols;
}
