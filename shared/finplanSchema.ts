// Types per il payload FinPlan Studio. Il blob lato server è opaco
// (jsonb) — questi tipi descrivono lo shape PRODOTTO dal tool standalone
// (`client/public/finplan/index.html`, funzione `saveProject()`) e dal
// wizard di setup (`buildSnapshot` in FinPlanSetupWizard.tsx).
//
// Regola: ogni nuovo campo aggiunto qui deve restare BACKWARD-COMPATIBLE
// con quanto l'iframe scrive, perché durante la migrazione i due mondi
// (iframe legacy + app React) condividono lo stesso `finplan_data.data`.
// Tutti i campi sono optional + permissivi (z.unknown per sub-strutture
// non ancora modellate) per evitare crash su shape future.

import { z } from "zod";

// ───────────────────── PRIMITIVE comuni ─────────────────────

/** "01"…"12" — chiavi mese usate da `m[].month`. */
export const MonthKeySchema = z.enum([
  "01", "02", "03", "04", "05", "06",
  "07", "08", "09", "10", "11", "12",
]);
export type MonthKey = z.infer<typeof MonthKeySchema>;

export const MonthlyTotalSchema = z.object({
  month: MonthKeySchema,
  e: z.number().default(0),
  u: z.number().default(0),
}).passthrough();
export type MonthlyTotal = z.infer<typeof MonthlyTotalSchema>;

// ───────────────────── Transazioni ─────────────────────

/** "E" entrata, "U" uscita. */
export const TxTypeSchema = z.enum(["E", "U"]);
export type TxType = z.infer<typeof TxTypeSchema>;

export const TransactionSchema = z.object({
  id: z.number(),
  month: z.number().int().min(0).max(11),
  type: TxTypeSchema,
  amount: z.number(),
  catId: z.string(),
  ivaRate: z.number().default(0),
  desc: z.string().default(""),
}).passthrough();
export type FinplanTransaction = z.infer<typeof TransactionSchema>;

// ───────────────────── Categorie ─────────────────────

export const CategorySchema = z.object({
  id: z.string(),
  name: z.string(),
  type: TxTypeSchema,
  color: z.string().optional(),
}).passthrough();
export type FinplanCategory = z.infer<typeof CategorySchema>;

// ───────────────────── Obiettivi ─────────────────────

export const ObjectiveSchema = z.object({
  id: z.number(),
  name: z.string().default(""),
  tipo: z.string().default("custom"),
  target: z.number().default(0),
  current: z.number().default(0),
  color: z.string().optional(),
}).passthrough();
export type FinplanObjective = z.infer<typeof ObjectiveSchema>;

// ───────────────────── Debiti / scadenze / ADE ─────────────────────

export const DebtSchema = z.object({
  id: z.union([z.number(), z.string()]),
  name: z.string().default(""),
  amount: z.number().default(0),
}).passthrough();
export type FinplanDebt = z.infer<typeof DebtSchema>;

export const DebtScadenzaSchema = z.object({
  id: z.union([z.number(), z.string()]).optional(),
  date: z.string().optional(),
  amount: z.number().optional(),
}).passthrough();
export type FinplanDebtScadenza = z.infer<typeof DebtScadenzaSchema>;

// ───────────────────── Investimenti / inv ─────────────────────

export const InvestmentSchema = z.object({
  id: z.number(),
  name: z.string(),
  amount: z.number().default(0),
  alloc: z.number().default(0),
}).passthrough();
export type FinplanInvestment = z.infer<typeof InvestmentSchema>;

// ───────────────────── Perdite / proiezioni ─────────────────────

export const PerditeSchema = z.object({
  attivo: z.boolean().default(false),
  importo: z.number().default(0),
  recuperato: z.number().default(0),
  costiFissi: z.number().default(0),
  mesePart: z.number().int().default(0),
  usaCashFlow: z.boolean().default(true),
  manuale: z.array(z.number()).length(12).optional(),
}).passthrough();
export type FinplanPerdite = z.infer<typeof PerditeSchema>;

// ───────────────────── IVA / Budget / Personale / Partitari / CDG ─────

export const IvaPeriodSchema = z.enum(["mensile", "trimestrale"]);
export type IvaPeriod = z.infer<typeof IvaPeriodSchema>;

export const BudgetSchema = z.object({
  e: z.number().default(0),
  u: z.number().default(0),
  catBudget: z.array(z.unknown()).default([]),
  ripartizione: z.string().default("uniforme"),
}).passthrough();
export type FinplanBudget = z.infer<typeof BudgetSchema>;

export const PersonaleRowSchema = z.object({
  id: z.union([z.number(), z.string()]).optional(),
  nome: z.string().optional(),
}).passthrough();
export type FinplanPersonaleRow = z.infer<typeof PersonaleRowSchema>;

export const PartitariSchema = z.object({
  C: z.array(z.unknown()).default([]),
  F: z.array(z.unknown()).default([]),
}).passthrough();
export type FinplanPartitari = z.infer<typeof PartitariSchema>;

export const PartitariPdfSchema = z.object({
  corrente: z.unknown().nullable().optional(),
  precedente: z.unknown().nullable().optional(),
}).passthrough();

export const CfExcludeSchema = z.object({
  E: z.array(z.unknown()).default([]),
  U: z.array(z.unknown()).default([]),
  ctpVar: z.record(z.unknown()).default({}),
}).passthrough();

export const ArchivioSchema = z.object({
  files: z.array(z.unknown()).default([]),
  snapshots: z.array(z.unknown()).default([]),
}).passthrough();

export const ImportedFileSchema = z.object({
  name: z.string(),
  date: z.string(),
  type: z.string().optional(),
}).passthrough();

// ───────────────────── Snapshot per Ragione Sociale ─────────────────────

export const FinplanCompanySnapshotSchema = z.object({
  m: z.array(MonthlyTotalSchema).default([]),
  transactions: z.array(TransactionSchema).default([]),
  cats: z.array(CategorySchema).default([]),
  obj: z.array(ObjectiveSchema).default([]),
  perdite: PerditeSchema.optional(),
  debts: z.array(DebtSchema).default([]),
  debtScadenze: z.array(DebtScadenzaSchema).default([]),
  ade: z.array(z.unknown()).default([]),
  inv: z.array(InvestmentSchema).default([]),
  growth: z.number().default(0),
  importedFile: ImportedFileSchema.nullable().optional(),
  importedFiles: z.array(ImportedFileSchema).default([]),
  importedFileHR: ImportedFileSchema.nullable().optional(),
  ivaPeriod: IvaPeriodSchema.default("trimestrale"),
  txIdSeq: z.number().default(1),
  budget: BudgetSchema.optional(),
  personale: z.array(PersonaleRowSchema).default([]),
  excludeInfragruppo: z.boolean().default(false),
  excludeGiroconto: z.boolean().default(false),
  excludeEstero: z.boolean().default(false),
  excludeFinanziamenti: z.boolean().default(false),
  excludeRateazioni: z.boolean().default(false),
  showLordo: z.boolean().default(false),
  partitari: PartitariSchema.optional(),
  partitariPdf: PartitariPdfSchema.optional(),
  cfExclude: CfExcludeSchema.optional(),
  storicoMesi: z.array(z.unknown()).default([]),
  archivio: ArchivioSchema.optional(),
  // Ragione sociale: il tool standalone la deriva dall'indice; il
  // wizard la passa esplicitamente. Manteniamo opzionale per back-compat.
  name: z.string().optional(),
}).passthrough();
export type FinplanCompanySnapshot = z.infer<typeof FinplanCompanySnapshotSchema>;

// ───────────────────── Snapshot top-level ─────────────────────

export const FinplanSnapshotSchema = z.object({
  version: z.number().default(3),
  savedAt: z.string().optional(),
  data: z.array(FinplanCompanySnapshotSchema).default([]),
  consGrowth: z.number().default(5),
  consIvaPeriod: IvaPeriodSchema.default("trimestrale"),
  _setupWizard: z.unknown().optional(),
}).passthrough();
export type FinplanSnapshot = z.infer<typeof FinplanSnapshotSchema>;

// ───────────────────── Wire types (`/api/finplan`) ─────────────────────

export interface FinplanApiResponse {
  data: FinplanSnapshot | Record<string, never>;
  updatedAt: string | null;
  updatedBy: string | null;
}

export interface FinplanPutRequest {
  data: FinplanSnapshot;
}

export interface FinplanPutResponse {
  ok: true;
  updatedAt: string;
}
