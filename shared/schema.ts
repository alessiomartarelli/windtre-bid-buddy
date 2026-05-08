import { pgTable, text, serial, varchar, timestamp, jsonb, index, boolean, integer, uniqueIndex, numeric, date } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { relations, sql } from "drizzle-orm";

// Session storage table (Replit Auth)
export const sessions = pgTable(
  "sessions",
  {
    sid: varchar("sid").primaryKey(),
    sess: jsonb("sess").notNull(),
    expire: timestamp("expire").notNull(),
  },
  (table) => [index("IDX_session_expire").on(table.expire)]
);

// Organizations
export const organizations = pgTable("organizations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: varchar("name").notNull(),
  enabledModules: jsonb("enabled_modules").$type<Record<string, boolean>>().default({}),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Profiles (users)
export const profiles = pgTable("profiles", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  email: varchar("email").unique(),
  passwordHash: varchar("password_hash"),
  fullName: varchar("full_name"),
  role: varchar("role").notNull().default("operatore"),
  organizationId: varchar("organization_id").references(() => organizations.id),
  profileImageUrl: varchar("profile_image_url"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Preventivi (quotes)
export const preventivi = pgTable("preventivi", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: varchar("name").notNull(),
  data: jsonb("data").default({}),
  organizationId: varchar("organization_id").references(() => organizations.id).notNull(),
  createdBy: varchar("created_by").references(() => profiles.id).notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Organization config
export const organizationConfig = pgTable("organization_config", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").references(() => organizations.id).notNull().unique(),
  config: jsonb("config").default({}),
  configVersion: varchar("config_version").default("1.0"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// PDV Configurations (named, per-organization)
export const pdvConfigurations = pgTable("pdv_configurations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").references(() => organizations.id).notNull(),
  name: varchar("name").notNull(),
  config: jsonb("config").default({}),
  configVersion: varchar("config_version").default("2.0"),
  createdBy: varchar("created_by").references(() => profiles.id),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// System config (super admin defaults for calculation parameters)
export const systemConfig = pgTable("system_config", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  key: varchar("key").notNull().unique(),
  config: jsonb("config").default({}),
  updatedBy: varchar("updated_by").references(() => profiles.id),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// BiSuite Sales (imported from external BiSuite API)
export const bisuiteSales = pgTable("bisuite_sales", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").references(() => organizations.id).notNull(),
  bisuiteId: integer("bisuite_id").notNull(),
  dataVendita: timestamp("data_vendita"),
  codicePos: varchar("codice_pos"),
  nomeNegozio: varchar("nome_negozio"),
  ragioneSociale: varchar("ragione_sociale"),
  nomeAddetto: varchar("nome_addetto"),
  nomeCliente: varchar("nome_cliente"),
  totale: varchar("totale"),
  stato: varchar("stato"),
  categorieArticoli: text("categorie_articoli"),
  rawData: jsonb("raw_data").notNull(),
  fetchedAt: timestamp("fetched_at").defaultNow(),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("IDX_bisuite_sales_org").on(table.organizationId),
  index("IDX_bisuite_sales_date").on(table.dataVendita),
  index("IDX_bisuite_sales_pos").on(table.codicePos),
  index("IDX_bisuite_sales_bisuite_id").on(table.bisuiteId),
]);

// Gara Config (per-organization, per-month competition configuration)
export const garaConfig = pgTable("gara_config", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").references(() => organizations.id).notNull(),
  month: integer("month").notNull(),
  year: integer("year").notNull(),
  name: varchar("name").default(''),
  config: jsonb("config").default({}),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("IDX_gara_config_org_month_year").on(table.organizationId, table.month, table.year),
]);

// DRMS Uploads (DRMS Commissioning Excel uploads, per org+month)
export const drmsUploads = pgTable("drms_uploads", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").references(() => organizations.id).notNull(),
  month: integer("month").notNull(),
  year: integer("year").notNull(),
  fileName: varchar("file_name").notNull(),
  period: varchar("period").notNull(),
  totaleImporto: varchar("totale_importo").default('0'),
  righeCount: integer("righe_count").notNull().default(0),
  rows: jsonb("rows").notNull().default([]),
  uploadedBy: varchar("uploaded_by").references(() => profiles.id),
  uploadedAt: timestamp("uploaded_at").defaultNow(),
}, (table) => [
  index("IDX_drms_uploads_org_month_year").on(table.organizationId, table.month, table.year),
]);

// === Controllo di Gestione ===
// Anagrafica Ragioni Sociali (per organizzazione). Le altre anagrafiche
// (categorie, fornitori, PDV) sono scoped per (organizationId, ragioneSociale).
export const cdgRagioniSociali = pgTable("cdg_ragioni_sociali", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").references(() => organizations.id).notNull(),
  nome: varchar("nome").notNull(),
  partitaIva: varchar("partita_iva"),
  note: text("note"),
  createdAt: timestamp("created_at").defaultNow(),
}, (t) => [
  index("IDX_cdg_rs_org").on(t.organizationId),
  uniqueIndex("UQ_cdg_rs_org_nome").on(t.organizationId, t.nome),
]);

// Categorie multi-RS: una categoria può essere associata a più Ragioni Sociali.
// `ragioneSociale` è la colonna legacy (back-compat), `ragioniSociali` è la
// lista canonica (validata server-side: min 1 elemento per insert).
export const cdgCategorie = pgTable("cdg_categorie", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").references(() => organizations.id).notNull(),
  ragioneSociale: varchar("ragione_sociale"),
  ragioniSociali: text("ragioni_sociali").array().notNull().default(sql`ARRAY[]::text[]`),
  nome: varchar("nome").notNull(),
  colore: varchar("colore"),
  createdAt: timestamp("created_at").defaultNow(),
}, (t) => [
  index("IDX_cdg_cat_org").on(t.organizationId),
  uniqueIndex("UQ_cdg_cat_org_nome").on(t.organizationId, t.nome),
]);

export const cdgFornitori = pgTable("cdg_fornitori", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").references(() => organizations.id).notNull(),
  ragioneSociale: varchar("ragione_sociale"),
  ragioniSociali: text("ragioni_sociali").array().notNull().default(sql`ARRAY[]::text[]`),
  nome: varchar("nome").notNull(),
  partitaIva: varchar("partita_iva"),
  note: text("note"),
  createdAt: timestamp("created_at").defaultNow(),
}, (t) => [
  index("IDX_cdg_forn_org").on(t.organizationId),
  uniqueIndex("UQ_cdg_forn_org_nome").on(t.organizationId, t.nome),
]);

// LEGACY: cdg_pdv non viene più utilizzata per CRUD. I PDV sono ereditati da
// `organization_config.puntiVendita`. La tabella resta per back-compat read
// (risoluzione `cdg_spese.pdv_id` legacy → codice PDV nel backfill).
export const cdgPdv = pgTable("cdg_pdv", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").references(() => organizations.id).notNull(),
  ragioneSociale: varchar("ragione_sociale").notNull(),
  nome: varchar("nome").notNull(),
  codice: varchar("codice"),
  createdAt: timestamp("created_at").defaultNow(),
}, (t) => [
  index("IDX_cdg_pdv_org_rs").on(t.organizationId, t.ragioneSociale),
]);

// Spese: doppia data (pagamento per cassa, competenza per accrual).
// meseCompetenza è "YYYY-MM" per facilitare aggregazioni mensili.
export const cdgSpese = pgTable("cdg_spese", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").references(() => organizations.id).notNull(),
  ragioneSociale: varchar("ragione_sociale").notNull(),
  categoriaId: varchar("categoria_id").references(() => cdgCategorie.id, { onDelete: 'set null' }),
  fornitoreId: varchar("fornitore_id").references(() => cdgFornitori.id, { onDelete: 'set null' }),
  // pdvId è legacy: i PDV sono ora ereditati da organization_config.puntiVendita
  // e referenziati per `pdvCodice` (= puntiVendita.codicePos). pdvId resta
  // intenzionalmente con FK su cdg_pdv (onDelete: 'set null') per consentire
  // un eventuale rollback alla vecchia tabella prima del drop definitivo
  // (vedi follow-up #71). Non viene più scritto: insertCdgSpesaSchema lo omette.
  // per back-compat read e backfill, e viene risolto a pdvCodice una-tantum.
  pdvId: varchar("pdv_id").references(() => cdgPdv.id, { onDelete: 'set null' }),
  pdvCodice: varchar("pdv_codice"),
  descrizione: varchar("descrizione").notNull(),
  // Imponibile (€) e aliquota IVA (% — 0/4/5/10/22 o custom). `iva` è derivata
  // server-side da imponibile*aliquota/100. `importo` resta = imponibile+iva
  // (totale fattura) per backward compat con dashboard, filtri e export.
  imponibile: numeric("imponibile", { precision: 14, scale: 2 }),
  aliquotaIva: numeric("aliquota_iva", { precision: 5, scale: 2 }),
  iva: numeric("iva", { precision: 14, scale: 2 }),
  importo: numeric("importo", { precision: 14, scale: 2 }).notNull(),
  dataPagamento: date("data_pagamento").notNull(),
  meseCompetenza: varchar("mese_competenza", { length: 7 }).notNull(),
  metodoPagamento: varchar("metodo_pagamento"),
  allegatoPath: varchar("allegato_path"),
  allegatoNome: varchar("allegato_nome"),
  allegatoMime: varchar("allegato_mime"),
  note: text("note"),
  createdBy: varchar("created_by").references(() => profiles.id),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (t) => [
  index("IDX_cdg_spese_org_rs").on(t.organizationId, t.ragioneSociale),
  index("IDX_cdg_spese_competenza").on(t.organizationId, t.meseCompetenza),
  index("IDX_cdg_spese_pagamento").on(t.organizationId, t.dataPagamento),
]);

// Password reset tokens
export const passwordResetTokens = pgTable("password_reset_tokens", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  email: varchar("email").notNull(),
  token: varchar("token").notNull().unique(),
  expiresAt: timestamp("expires_at").notNull(),
  usedAt: timestamp("used_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

// Relations
export const organizationsRelations = relations(organizations, ({ many }) => ({
  profiles: many(profiles),
  preventivi: many(preventivi),
}));

export const profilesRelations = relations(profiles, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [profiles.organizationId],
    references: [organizations.id],
  }),
  preventivi: many(preventivi),
}));

export const preventiviRelations = relations(preventivi, ({ one }) => ({
  organization: one(organizations, {
    fields: [preventivi.organizationId],
    references: [organizations.id],
  }),
  creator: one(profiles, {
    fields: [preventivi.createdBy],
    references: [profiles.id],
  }),
}));

// Types
export type Organization = typeof organizations.$inferSelect;
export type Profile = typeof profiles.$inferSelect;
export type Preventivo = typeof preventivi.$inferSelect;
export type OrganizationConfig = typeof organizationConfig.$inferSelect;

export type InsertOrganization = typeof organizations.$inferInsert;
export type InsertProfile = typeof profiles.$inferInsert;
export type InsertPreventivo = typeof preventivi.$inferInsert;

export type PdvConfiguration = typeof pdvConfigurations.$inferSelect;
export type InsertPdvConfiguration = typeof pdvConfigurations.$inferInsert;
export type PasswordResetToken = typeof passwordResetTokens.$inferSelect;
export type SystemConfig = typeof systemConfig.$inferSelect;
export type BisuiteSale = typeof bisuiteSales.$inferSelect;
export type InsertBisuiteSale = typeof bisuiteSales.$inferInsert;

export type GaraConfig = typeof garaConfig.$inferSelect;
export type InsertGaraConfig = typeof garaConfig.$inferInsert;

export type DrmsUpload = typeof drmsUploads.$inferSelect;
export type InsertDrmsUpload = typeof drmsUploads.$inferInsert;

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

// === Controllo di Gestione types ===
export type CdgRagioneSociale = typeof cdgRagioniSociali.$inferSelect;
export type InsertCdgRagioneSociale = typeof cdgRagioniSociali.$inferInsert;
export type CdgCategoria = typeof cdgCategorie.$inferSelect;
export type InsertCdgCategoria = typeof cdgCategorie.$inferInsert;
export type CdgFornitore = typeof cdgFornitori.$inferSelect;
export type InsertCdgFornitore = typeof cdgFornitori.$inferInsert;
export type CdgPdv = typeof cdgPdv.$inferSelect;
export type InsertCdgPdv = typeof cdgPdv.$inferInsert;
export type CdgSpesa = typeof cdgSpese.$inferSelect;
export type InsertCdgSpesa = typeof cdgSpese.$inferInsert;

export const insertCdgRagioneSocialeSchema = createInsertSchema(cdgRagioniSociali).omit({ id: true, createdAt: true, organizationId: true });
// Categorie/Fornitori sono multi-RS: `ragioniSociali` è obbligatorio (min 1).
// `ragioneSociale` legacy resta opzionale per back-compat in lettura/insert ma
// è ignorato in scrittura dalla UI nuova.
export const insertCdgCategoriaSchema = createInsertSchema(cdgCategorie)
  .omit({ id: true, createdAt: true, organizationId: true })
  .extend({
    ragioneSociale: z.string().optional().nullable(),
    ragioniSociali: z.array(z.string().min(1)).min(1, "Seleziona almeno una Ragione Sociale"),
  });
export const insertCdgFornitoreSchema = createInsertSchema(cdgFornitori)
  .omit({ id: true, createdAt: true, organizationId: true })
  .extend({
    ragioneSociale: z.string().optional().nullable(),
    ragioniSociali: z.array(z.string().min(1)).min(1, "Seleziona almeno una Ragione Sociale"),
  });
export const insertCdgPdvSchema = createInsertSchema(cdgPdv).omit({ id: true, createdAt: true, organizationId: true });
// Importo, imponibile e iva sono accettati come string|number (front invia
// string formattata). Server ricalcola sempre iva e importo da imponibile +
// aliquotaIva quando entrambi sono presenti, per garantire coerenza.
const numericString = z.union([z.string(), z.number()])
  .transform((v) => typeof v === 'number' ? v.toString() : v);
// pdvId è legacy: il client deve usare solo `pdvCodice`. Lo omettiamo dallo
// schema di input per impedire al client di scrivere riferimenti FK legacy
// non più validati lato server (rischio di puntare a cdg_pdv di altra org
// o di altra RS).
export const insertCdgSpesaSchema = createInsertSchema(cdgSpese).omit({
  id: true, createdAt: true, updatedAt: true, organizationId: true, createdBy: true,
  allegatoPath: true, allegatoNome: true, allegatoMime: true,
  pdvId: true,
}).extend({
  importo: numericString.optional(),
  imponibile: numericString.optional().nullable(),
  aliquotaIva: numericString.optional().nullable(),
  iva: numericString.optional().nullable(),
  meseCompetenza: z.string().regex(/^\d{4}-\d{2}$/, "Formato YYYY-MM richiesto"),
  allegatoBase64: z.string().optional(),
  allegatoNome: z.string().optional(),
  allegatoMime: z.string().optional(),
});
