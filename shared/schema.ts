import { pgTable, text, varchar, timestamp, jsonb, index, boolean, integer, uniqueIndex, numeric, date } from "drizzle-orm/pg-core";
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
  emailNotificationsDisabled: boolean("email_notifications_disabled").notNull().default(false),
  // Customer Journey (Task #158): nominativi "addetto" BiSuite associati a
  // questo profilo operatore. Usati per il filtro per-operatore: l'operatore
  // vede solo le vendite/CJ il cui `nomeAddetto` rientra in questa lista.
  // Matcha `bisuite_sales.nome_addetto` (case-insensitive lato query).
  bisuiteAddetti: text("bisuite_addetti").array().notNull().default(sql`ARRAY[]::text[]`),
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
  lastSeenAt: timestamp("last_seen_at").defaultNow(),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("IDX_bisuite_sales_org").on(table.organizationId),
  index("IDX_bisuite_sales_date").on(table.dataVendita),
  index("IDX_bisuite_sales_pos").on(table.codicePos),
  index("IDX_bisuite_sales_bisuite_id").on(table.bisuiteId),
  index("IDX_bisuite_sales_last_seen").on(table.lastSeenAt),
  uniqueIndex("UQ_bisuite_sales_org_bisuite_id").on(table.organizationId, table.bisuiteId),
]);

// === Customer Journey (Task #158) ===
// Una journey per cliente (identificato da CF per i privati, P.IVA per le
// aziende) per organizzazione. Si apre automaticamente quando il cliente
// registra una nuova attivazione di pista mobile dal 01/07/2026.
export const customerJourneys = pgTable("customer_journeys", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").references(() => organizations.id).notNull(),
  // CF (privati) o P.IVA (aziende), normalizzato uppercase/trim.
  customerKey: varchar("customer_key").notNull(),
  // 'privato' | 'azienda'
  customerType: varchar("customer_type").notNull().default("privato"),
  nome: varchar("nome"),
  cognome: varchar("cognome"),
  ragioneSociale: varchar("ragione_sociale"),
  nominativo: varchar("nominativo"),
  telefono: varchar("telefono"),
  codiceCliente: varchar("codice_cliente"),
  // Vendita BiSuite che ha innescato la journey (nuova attivazione mobile).
  triggerSaleId: varchar("trigger_sale_id"),
  triggerBisuiteId: integer("trigger_bisuite_id"),
  openedAt: timestamp("opened_at"),
  // 'aperta' | 'chiusa'
  status: varchar("status").notNull().default("aperta"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("IDX_cj_org").on(table.organizationId),
  uniqueIndex("UQ_cj_org_customer").on(table.organizationId, table.customerKey),
]);

// Ogni item è un contratto/driver tracciato all'interno di una journey.
// I campi anagrafici e di contratto derivano dal file ITEM_CJ; quelli non
// forniti dal connettore restano NULL/vuoti (vedi docs/customer-journey.md).
export const customerJourneyItems = pgTable("customer_journey_items", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  journeyId: varchar("journey_id").references(() => customerJourneys.id, { onDelete: "cascade" }).notNull(),
  organizationId: varchar("organization_id").references(() => organizations.id).notNull(),
  // Driver: 'mobile' | 'fisso' | 'energia' | 'assicurazioni' | 'telefono' | 'protetti'
  driver: varchar("driver").notNull(),
  // Riferimenti alla vendita BiSuite di origine.
  bisuiteSaleId: varchar("bisuite_sale_id"),
  bisuiteId: integer("bisuite_id"),
  bisuiteArticleId: integer("bisuite_article_id"),
  // Campi ITEM_CJ
  nome: varchar("nome"),
  cognome: varchar("cognome"),
  cf: varchar("cf"),
  piva: varchar("piva"),
  telefono: varchar("telefono"),
  codiceCliente: varchar("codice_cliente"),
  codiceContratto: varchar("codice_contratto"),
  categoria: varchar("categoria"),
  tipologia: varchar("tipologia"),
  descrizione: text("descrizione"),
  canone: varchar("canone"),
  dataInserimento: timestamp("data_inserimento"),
  dataAttivazione: timestamp("data_attivazione"),
  addetto: varchar("addetto"),
  pdvOrigine: varchar("pdv_origine"),
  pdvDestinazione: varchar("pdv_destinazione"),
  pod: varchar("pod"),
  pdr: varchar("pdr"),
  imei: varchar("imei"),
  importo: varchar("importo"),
  rata: varchar("rata"),
  modVendita: varchar("mod_vendita"),
  // Stato: 'inserito' | 'in_lavorazione' | 'attivato' | 'ko' | 'pagato' | 'stornato' | 'riaccreditato'
  state: varchar("state").notNull().default("inserito"),
  // true se lo stato è stato impostato manualmente: il reconcile automatico
  // non lo sovrascrive più (preserva le conferme manuali del gettone, ecc.).
  stateManual: boolean("state_manual").notNull().default(false),
  stateUpdatedAt: timestamp("state_updated_at"),
  stateUpdatedBy: varchar("state_updated_by"),
  // Conferma manuale del gettone (formula non cablata in Fase 1).
  gettoneConfirmed: boolean("gettone_confirmed").notNull().default(false),
  gettoneConfirmedAt: timestamp("gettone_confirmed_at"),
  gettoneConfirmedBy: varchar("gettone_confirmed_by"),
  // true se i campi di dettaglio (data attivazione, PDV destinazione, IMEI,
  // RATA) sono stati compilati a mano: il reconcile non li sovrascrive più
  // (BiSuite non fornisce questi campi in modo affidabile, Task #161).
  detailsManual: boolean("details_manual").notNull().default(false),
  detailsUpdatedAt: timestamp("details_updated_at"),
  detailsUpdatedBy: varchar("details_updated_by"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("IDX_cji_journey").on(table.journeyId),
  index("IDX_cji_org").on(table.organizationId),
  uniqueIndex("UQ_cji_org_sale_article").on(table.organizationId, table.bisuiteSaleId, table.bisuiteArticleId),
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

// PDV manuali per Controllo di Gestione: tabella separata dai PDV ereditati
// da `organization_config.puntiVendita`. Permettono di registrare punti
// vendita ad-hoc usati solo per imputare spese (es. magazzini, sedi, PDV non
// ancora configurati a livello org). `codice` è univoco per (org, rs) e
// viene usato come `cdgSpese.pdvCodice` esattamente come quelli ereditati.
export const cdgPdvManuali = pgTable("cdg_pdv_manuali", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").references(() => organizations.id).notNull(),
  ragioneSociale: varchar("ragione_sociale").notNull(),
  codice: varchar("codice").notNull(),
  nome: varchar("nome").notNull(),
  indirizzo: text("indirizzo"),
  note: text("note"),
  createdAt: timestamp("created_at").defaultNow(),
}, (t) => [
  index("IDX_cdg_pdv_manuali_org_rs").on(t.organizationId, t.ragioneSociale),
  uniqueIndex("UQ_cdg_pdv_manuali_org_rs_codice").on(t.organizationId, t.ragioneSociale, t.codice),
]);

// Spese: doppia data (pagamento per cassa, competenza per accrual).
// meseCompetenza è "YYYY-MM" per facilitare aggregazioni mensili.
// Nota: la vecchia tabella `cdg_pdv` e la colonna `cdg_spese.pdv_id` sono
// state droppate (Task #71). I PDV sono ora un mix:
//  - ereditati read-only da `organization_config.puntiVendita`
//  - manuali in `cdg_pdv_manuali` (CRUD da Anagrafiche → PDV)
// Entrambi referenziati da `pdvCodice`.
export const cdgSpese = pgTable("cdg_spese", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").references(() => organizations.id).notNull(),
  ragioneSociale: varchar("ragione_sociale").notNull(),
  categoriaId: varchar("categoria_id").references(() => cdgCategorie.id, { onDelete: 'set null' }),
  fornitoreId: varchar("fornitore_id").references(() => cdgFornitori.id, { onDelete: 'set null' }),
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
  // Ricorrenza mensile: quando `ricorrente=true`, alla creazione il backend
  // genera N copie indipendenti — una per ogni mese successivo fino a
  // `dataFineRicorrenza` inclusa. Ogni copia mantiene flag e scadenza per
  // evidenza in UI; le copie non sono "linkate" alla master (modifiche e
  // delete sono per riga singola).
  ricorrente: boolean("ricorrente").notNull().default(false),
  // 'mensile' | 'annuale' (null se una tantum)
  periodicita: varchar("periodicita", { length: 16 }),
  // Sfasamento cassa vs competenza in MESI (0..3): la dataPagamento di
  // ogni occorrenza viene calcolata come (meseCompetenza + offset, giornoPagamento).
  cashFlowOffsetMesi: integer("cash_flow_offset_mesi").notNull().default(0),
  dataInizioRicorrenza: date("data_inizio_ricorrenza"),
  dataFineRicorrenza: date("data_fine_ricorrenza"),
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

// Notifiche di sync BiSuite (push agli admin)
// Una riga per ogni org che lo scheduler notturno chiude come `partial`
// (alcuni mesi mancanti) o `failed` (errore fatale a livello di org).
// La pagina Vendite BiSuite legge le righe non lette per mostrarle in
// un campanellino in navbar.
export const bisuiteSyncNotifications = pgTable("bisuite_sync_notifications", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
  status: varchar("status").notNull(),
  failedMonths: jsonb("failed_months").$type<string[]>().default([]),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  readAt: timestamp("read_at"),
}, (t) => [
  index("IDX_bisuite_notif_org_unread").on(t.organizationId, t.readAt),
]);

export type BisuiteSyncNotification = typeof bisuiteSyncNotifications.$inferSelect;
export type InsertBisuiteSyncNotification = typeof bisuiteSyncNotifications.$inferInsert;

// FinPlan Studio data (per-organization snapshot of the embedded
// HTML tool: una riga per org, blob JSONB opaco lato server).
export const finplanData = pgTable("finplan_data", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull().unique(),
  data: jsonb("data").default({}),
  updatedBy: varchar("updated_by").references(() => profiles.id),
  updatedAt: timestamp("updated_at").defaultNow(),
  createdAt: timestamp("created_at").defaultNow(),
});

export type FinplanData = typeof finplanData.$inferSelect;
export type InsertFinplanData = typeof finplanData.$inferInsert;

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

export type CustomerJourney = typeof customerJourneys.$inferSelect;
export type InsertCustomerJourney = typeof customerJourneys.$inferInsert;
export const insertCustomerJourneySchema = createInsertSchema(customerJourneys).omit({
  id: true, createdAt: true, updatedAt: true,
});

export type CustomerJourneyItem = typeof customerJourneyItems.$inferSelect;
export type InsertCustomerJourneyItem = typeof customerJourneyItems.$inferInsert;
export const insertCustomerJourneyItemSchema = createInsertSchema(customerJourneyItems).omit({
  id: true, createdAt: true, updatedAt: true,
});

export const CJ_ITEM_STATES = [
  "inserito", "in_lavorazione", "attivato", "ko", "pagato", "stornato", "riaccreditato",
] as const;
export type CjItemState = (typeof CJ_ITEM_STATES)[number];

export const CJ_DRIVERS = [
  "mobile", "fisso", "energia", "assicurazioni", "telefono", "protetti",
] as const;
export type CjDriver = (typeof CJ_DRIVERS)[number];

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
export type CdgSpesa = typeof cdgSpese.$inferSelect;
export type InsertCdgSpesa = typeof cdgSpese.$inferInsert;
export type CdgPdvManuale = typeof cdgPdvManuali.$inferSelect;
export type InsertCdgPdvManuale = typeof cdgPdvManuali.$inferInsert;

export const insertCdgRagioneSocialeSchema = createInsertSchema(cdgRagioniSociali).omit({ id: true, createdAt: true, organizationId: true });
export const insertCdgPdvManualeSchema = createInsertSchema(cdgPdvManuali)
  .omit({ id: true, createdAt: true, organizationId: true })
  .extend({
    ragioneSociale: z.string().trim().min(1, "Ragione Sociale obbligatoria"),
    codice: z.string().trim().min(1, "Codice obbligatorio"),
    nome: z.string().trim().min(1, "Nome obbligatorio"),
    indirizzo: z.string().optional().nullable(),
    note: z.string().optional().nullable(),
  });
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
// Importo, imponibile e iva sono accettati come string|number (front invia
// string formattata). Server ricalcola sempre iva e importo da imponibile +
// aliquotaIva quando entrambi sono presenti, per garantire coerenza.
const numericString = z.union([z.string(), z.number()])
  .transform((v) => typeof v === 'number' ? v.toString() : v);
export const insertCdgSpesaSchema = createInsertSchema(cdgSpese).omit({
  id: true, createdAt: true, updatedAt: true, organizationId: true, createdBy: true,
  allegatoPath: true, allegatoNome: true, allegatoMime: true,
}).extend({
  importo: numericString.optional(),
  imponibile: numericString.optional().nullable(),
  aliquotaIva: numericString.optional().nullable(),
  iva: numericString.optional().nullable(),
  meseCompetenza: z.string().regex(/^\d{4}-\d{2}$/, "Formato YYYY-MM richiesto"),
  ricorrente: z.boolean().optional(),
  periodicita: z.enum(["mensile", "annuale"]).optional().nullable(),
  cashFlowOffsetMesi: z.number().int().min(0).max(3).optional(),
  dataInizioRicorrenza: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Formato YYYY-MM-DD richiesto").optional().nullable(),
  dataFineRicorrenza: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Formato YYYY-MM-DD richiesto").optional().nullable(),
  allegatoBase64: z.string().optional(),
  allegatoNome: z.string().optional(),
  allegatoMime: z.string().optional(),
});
