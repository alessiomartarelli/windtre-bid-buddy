// Types per il payload FinPlan Studio. Il blob lato server è opaco
// (jsonb) — questi tipi descrivono lo shape PRODOTTO dal tool standalone
// (`client/public/finplan/index.html`, funzione `saveProject()`) e dal
// wizard di setup (`buildSnapshot` in FinPlanSetupWizard.tsx).
//
// REGOLE DI MIGRAZIONE (Task #142+):
//  1. Tutti i campi sono `.optional()` e tutti gli oggetti `.passthrough()`
//     così la validazione runtime NON inflaziona shape (no default values
//     che alterino il payload). Questo è critico per la byte-compat con
//     il blob scritto dall'iframe legacy: lo stesso `finplan_data` viene
//     letto/scritto sia dall'iframe che dalla shell React durante la
//     migrazione, e qualunque normalizzazione client-side rischierebbe
//     di clobberare campi non ancora modellati qui.
//  2. Sub-strutture vagamente conosciute (riempite dal main script ma
//     con shape eterogenea) usano `z.record(z.unknown())` o
//     `z.unknown()` ma sono comunque DOCUMENTATE qui sotto col link al
//     punto di mutazione nel file standalone.

import { z } from "zod";

// ───────────────────── PRIMITIVE comuni ─────────────────────

/** "Gen"…"Dic" — chiavi mese italiane usate da `m[].month` nel tool standalone. */
export const MonthLabelSchema = z.string();
export type MonthLabel = z.infer<typeof MonthLabelSchema>;

export const MonthlyTotalSchema = z.object({
  month: MonthLabelSchema.optional(),
  e: z.number().optional(),
  u: z.number().optional(),
}).passthrough();
export type MonthlyTotal = z.infer<typeof MonthlyTotalSchema>;

// ───────────────────── Transazioni ─────────────────────

/** "E" entrata, "U" uscita. */
export const TxTypeSchema = z.enum(["E", "U"]);
export type TxType = z.infer<typeof TxTypeSchema>;

// Source: index.html riga ~2268 `co.transactions.push({id:uid(),month,type,catId,amount,ivaRate,desc})`
export const TransactionSchema = z.object({
  id: z.union([z.number(), z.string()]).optional(),
  month: z.number().int().min(0).max(11).optional(),
  type: TxTypeSchema.optional(),
  amount: z.number().optional(),
  catId: z.string().optional(),
  ivaRate: z.number().optional(),
  desc: z.string().optional(),
}).passthrough();
export type FinplanTransaction = z.infer<typeof TransactionSchema>;

// ───────────────────── Categorie ─────────────────────

export const CategorySchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  type: TxTypeSchema.optional(),
  color: z.string().optional(),
  infragruppo: z.boolean().optional(),
  giroconto: z.boolean().optional(),
  estero: z.boolean().optional(),
}).passthrough();
export type FinplanCategory = z.infer<typeof CategorySchema>;

// ───────────────────── Obiettivi ─────────────────────

export const ObjectiveSchema = z.object({
  id: z.union([z.number(), z.string()]).optional(),
  name: z.string().optional(),
  tipo: z.string().optional(),
  target: z.number().optional(),
  current: z.number().optional(),
  color: z.string().optional(),
}).passthrough();
export type FinplanObjective = z.infer<typeof ObjectiveSchema>;

// ───────────────────── Debiti / scadenze / ADE ─────────────────────

export const DebtSchema = z.object({
  id: z.union([z.number(), z.string()]).optional(),
  name: z.string().optional(),
  amount: z.number().optional(),
}).passthrough();
export type FinplanDebt = z.infer<typeof DebtSchema>;

export const DebtScadenzaSchema = z.object({
  id: z.union([z.number(), z.string()]).optional(),
  date: z.string().optional(),
  amount: z.number().optional(),
}).passthrough();
export type FinplanDebtScadenza = z.infer<typeof DebtScadenzaSchema>;

// Source: index.html riga ~6484 `co.ade.push({id, tipo, ente, ... rateScadenze:[]})`
export const AdeSchema = z.object({
  id: z.union([z.number(), z.string()]).optional(),
  tipo: z.enum(["bonario", "cartella"]).optional(),
  ente: z.string().optional(),
  numero: z.string().optional(),
  anno: z.number().optional(),
  importo: z.number().optional(),
  scadenza: z.string().optional(),
  stato: z.string().optional(),
  tributo: z.string().optional(),
  periodo: z.string().optional(),
  note: z.string().optional(),
  rateazione: z.boolean().optional(),
  nRate: z.number().optional(),
  importoRata: z.number().optional(),
  rateScadenze: z.array(z.unknown()).optional(),
}).passthrough();
export type FinplanAde = z.infer<typeof AdeSchema>;

// ───────────────────── Investimenti / inv ─────────────────────

export const InvestmentSchema = z.object({
  id: z.union([z.number(), z.string()]).optional(),
  name: z.string().optional(),
  amount: z.number().optional(),
  alloc: z.number().optional(),
}).passthrough();
export type FinplanInvestment = z.infer<typeof InvestmentSchema>;

// ───────────────────── Perdite / proiezioni ─────────────────────

export const PerditeSchema = z.object({
  attivo: z.boolean().optional(),
  importo: z.number().optional(),
  recuperato: z.number().optional(),
  costiFissi: z.number().optional(),
  mesePart: z.number().int().optional(),
  usaCashFlow: z.boolean().optional(),
  manuale: z.array(z.number()).optional(),
}).passthrough();
export type FinplanPerdite = z.infer<typeof PerditeSchema>;

// ───────────────────── IVA / Budget / Personale / Partitari / CDG ─────

export const IvaPeriodSchema = z.enum(["mensile", "trimestrale"]);
export type IvaPeriod = z.infer<typeof IvaPeriodSchema>;

// Source: index.html riga ~4793 `bgt.catBudget.push({catId, annual:val})`
export const CatBudgetEntrySchema = z.object({
  catId: z.string(),
  annual: z.number().optional(),
}).passthrough();

export const BudgetSchema = z.object({
  e: z.number().optional(),
  u: z.number().optional(),
  catBudget: z.array(CatBudgetEntrySchema).optional(),
  ripartizione: z.string().optional(),
}).passthrough();
export type FinplanBudget = z.infer<typeof BudgetSchema>;

// Personale/HR — modello flessibile (le righe sono importate da Excel
// con colonne arbitrarie, vedi index.html ~hrParseExcel).
export const PersonaleRowSchema = z.object({
  id: z.union([z.number(), z.string()]).optional(),
  nome: z.string().optional(),
  ruolo: z.string().optional(),
  costoMensile: z.number().optional(),
}).passthrough();
export type FinplanPersonaleRow = z.infer<typeof PersonaleRowSchema>;

// Source: index.html riga ~6079 `co.partitari[type].push({id, ragsoc, nfatt, emiss, scad, imp, iva, pagato, stato})`
export const PartitarioRowSchema = z.object({
  id: z.union([z.number(), z.string()]).optional(),
  ragsoc: z.string().optional(),
  nfatt: z.string().optional(),
  emiss: z.string().optional(),
  scad: z.string().optional(),
  imp: z.number().optional(),
  iva: z.number().optional(),
  pagato: z.number().optional(),
  stato: z.string().optional(),
}).passthrough();
export type FinplanPartitarioRow = z.infer<typeof PartitarioRowSchema>;

export const PartitariSchema = z.object({
  C: z.array(PartitarioRowSchema).optional(),
  F: z.array(PartitarioRowSchema).optional(),
}).passthrough();
export type FinplanPartitari = z.infer<typeof PartitariSchema>;

export const PartitariPdfSchema = z.object({
  corrente: z.unknown().nullable().optional(),
  precedente: z.unknown().nullable().optional(),
}).passthrough();

// Source: index.html riga ~1166 `cfExclude:{ E:[], U:[], ctpVar:{} }` —
// E/U: array di catId marked variabile; ctpVar: mappa "<catId>_<ctp>" → 'fisso'|'variabile'.
export const CfExcludeSchema = z.object({
  E: z.array(z.string()).optional(),
  U: z.array(z.string()).optional(),
  ctpVar: z.record(z.enum(["fisso", "variabile"])).optional(),
}).passthrough();
export type FinplanCfExclude = z.infer<typeof CfExcludeSchema>;

// Source: index.html riga ~3543/4578 `co.archivio.files.push({id,name,type,size,date,ci,cartella?,note?})`
export const ArchivioFileSchema = z.object({
  id: z.union([z.number(), z.string()]).optional(),
  name: z.string().optional(),
  type: z.string().optional(),
  size: z.number().optional(),
  date: z.string().optional(),
  ci: z.union([z.number(), z.string()]).optional(),
  cartella: z.string().optional(),
  note: z.string().optional(),
}).passthrough();

// Source: index.html riga ~3598 `{id,date,label,m:[...],transactions:[...]}`
export const ArchivioSnapshotSchema = z.object({
  id: z.union([z.number(), z.string()]).optional(),
  date: z.string().optional(),
  label: z.string().optional(),
  m: z.array(MonthlyTotalSchema).optional(),
  transactions: z.array(TransactionSchema).optional(),
}).passthrough();

export const ArchivioSchema = z.object({
  files: z.array(ArchivioFileSchema).optional(),
  snapshots: z.array(ArchivioSnapshotSchema).optional(),
}).passthrough();
export type FinplanArchivio = z.infer<typeof ArchivioSchema>;

export const ImportedFileSchema = z.object({
  name: z.string().optional(),
  date: z.string().optional(),
  type: z.string().optional(),
}).passthrough();
export type FinplanImportedFile = z.infer<typeof ImportedFileSchema>;

// Source: index.html riga ~4498/9787 — scadenzario aggiunto dall'import
// CC e dalla UI Scadenze. Non presente nel buildSnapshot del wizard
// (assente al primo boot) ma può comparire dopo il primo edit.
export const ScadenzarioRowSchema = z.object({
  id: z.union([z.number(), z.string()]).optional(),
  tipo: z.enum(["incasso", "pagamento"]).optional(),
  controparte: z.string().optional(),
  desc: z.string().optional(),
  importo: z.number().optional(),
  data: z.string().optional(),
  stato: z.string().optional(),
  note: z.string().optional(),
}).passthrough();

// Source: index.html riga ~9107 (cdg.pdv) e ~9176 (cdg.voci) — modulo
// Controllo di Gestione interno al tool (separato dal CdG dell'app).
export const CdgPdvSchema = z.object({
  id: z.union([z.number(), z.string()]).optional(),
  nome: z.string().optional(),
}).passthrough();

export const CdgVoceSchema = z.object({
  id: z.union([z.number(), z.string()]).optional(),
  pdvId: z.union([z.number(), z.string()]).optional(),
  categoria: z.string().optional(),
}).passthrough();

export const CdgChiaveSchema = z.object({
  id: z.union([z.number(), z.string()]).optional(),
  pdvId: z.union([z.number(), z.string()]).optional(),
  metodo: z.string().optional(),
  peso: z.number().optional(),
}).passthrough();

export const CdgSchema = z.object({
  pdv: z.array(CdgPdvSchema).optional(),
  voci: z.array(CdgVoceSchema).optional(),
  chiavi: z.array(CdgChiaveSchema).optional(),
}).passthrough();
export type FinplanCdg = z.infer<typeof CdgSchema>;

export const StoricoMeseSchema = z.object({
  ym: z.string().optional(),
  m: z.array(MonthlyTotalSchema).optional(),
}).passthrough();

// ───────────────────── Snapshot per Ragione Sociale ─────────────────────

export const FinplanCompanySnapshotSchema = z.object({
  m: z.array(MonthlyTotalSchema).optional(),
  transactions: z.array(TransactionSchema).optional(),
  cats: z.array(CategorySchema).optional(),
  obj: z.array(ObjectiveSchema).optional(),
  perdite: PerditeSchema.optional(),
  debts: z.array(DebtSchema).optional(),
  debtScadenze: z.array(DebtScadenzaSchema).optional(),
  ade: z.array(AdeSchema).optional(),
  inv: z.array(InvestmentSchema).optional(),
  growth: z.number().optional(),
  importedFile: ImportedFileSchema.nullable().optional(),
  importedFiles: z.array(ImportedFileSchema).optional(),
  importedFileHR: ImportedFileSchema.nullable().optional(),
  ivaPeriod: IvaPeriodSchema.optional(),
  txIdSeq: z.number().optional(),
  budget: BudgetSchema.optional(),
  personale: z.array(PersonaleRowSchema).optional(),
  excludeInfragruppo: z.boolean().optional(),
  excludeGiroconto: z.boolean().optional(),
  excludeEstero: z.boolean().optional(),
  excludeFinanziamenti: z.boolean().optional(),
  excludeRateazioni: z.boolean().optional(),
  showLordo: z.boolean().optional(),
  partitari: PartitariSchema.optional(),
  partitariPdf: PartitariPdfSchema.optional(),
  cfExclude: CfExcludeSchema.optional(),
  storicoMesi: z.array(StoricoMeseSchema).optional(),
  archivio: ArchivioSchema.optional(),
  scadenzario: z.array(ScadenzarioRowSchema).optional(),
  cdg: CdgSchema.optional(),
  // Ragione sociale: il tool standalone la deriva dall'indice; il
  // wizard la passa esplicitamente. Manteniamo opzionale per back-compat.
  name: z.string().optional(),
}).passthrough();
export type FinplanCompanySnapshot = z.infer<typeof FinplanCompanySnapshotSchema>;

// ───────────────────── Snapshot top-level ─────────────────────

export const FinplanSnapshotSchema = z.object({
  version: z.number().optional(),
  savedAt: z.string().optional(),
  data: z.array(FinplanCompanySnapshotSchema).optional(),
  consGrowth: z.number().optional(),
  consIvaPeriod: IvaPeriodSchema.optional(),
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
