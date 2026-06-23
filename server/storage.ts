import { db } from "./db";
import { profiles, organizations, preventivi, organizationConfig, passwordResetTokens, pdvConfigurations, systemConfig, bisuiteSales, garaConfig, drmsUploads, incentivazioneConfig, incentivazioneValenze, bisuiteSyncNotifications, finplanData, customerJourneys, customerJourneyItems, type Profile, type Organization, type Preventivo, type OrganizationConfig, type PasswordResetToken, type PdvConfiguration, type InsertPdvConfiguration, type InsertProfile, type InsertOrganization, type InsertPreventivo, type SystemConfig, type BisuiteSale, type InsertBisuiteSale, type GaraConfig, type DrmsUpload, type InsertDrmsUpload, type IncentivazioneConfigRow, type IncentivazioneValenze, type InsertIncentivazioneValenze, type BisuiteSyncNotification, type InsertBisuiteSyncNotification, type FinplanData, type CustomerJourney, type CustomerJourneyItem, type InsertCustomerJourneyItem, type CjItemState, type CjDriver } from "@shared/schema";
import { eq, desc, and, isNull, isNotNull, lt, gte, lte, inArray, sql } from "drizzle-orm";
import { driverFromCategory, isMobileActivationCategory, energiaSubtype, parseVenditaInfo, summarizeDrivers, type CjDriverSummary } from "@shared/customerJourney";

// Data trigger di default della customer journey: una CJ si apre solo per
// nuove attivazioni di pista mobile a partire da questa data (Task #158).
// È sovrascrivibile per organizzazione tramite la config
// (`config.customerJourneyTriggerDate`, Task #167); qui resta il fallback.
export const CJ_DEFAULT_TRIGGER_DATE = new Date("2026-07-01T00:00:00.000Z");

// Converte una data trigger in stringa "YYYY-MM-DD" (UTC) per la UI/API.
export function formatCjTriggerDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// Parsa una data trigger memorizzata in config. Accetta "YYYY-MM-DD" o un
// timestamp ISO completo; ritorna null se non valida/assente.
function parseCjTriggerDate(raw: unknown): Date | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  const v = raw.trim();
  const d = new Date(v.length === 10 ? `${v}T00:00:00.000Z` : v);
  return Number.isNaN(d.getTime()) ? null : d;
}

// Campi di dettaglio compilabili a mano su un item della customer journey
// (BiSuite non li fornisce in modo affidabile, Task #161). `dataAttivazione`
// è una data (o null per azzerare); gli altri sono stringhe (o null).
export type CjItemDetailsUpdate = {
  dataAttivazione?: Date | null;
  pdvDestinazione?: string | null;
  imei?: string | null;
  rata?: string | null;
};

export interface IStorage {
  // Profiles
  getProfile(id: string): Promise<Profile | undefined>;
  getProfileByEmail(email: string): Promise<Profile | undefined>;
  upsertProfile(profile: InsertProfile): Promise<Profile>;
  getProfilesByOrg(orgId: string): Promise<Profile[]>;
  updateProfile(id: string, updates: Partial<InsertProfile>): Promise<Profile>;
  deleteProfile(id: string): Promise<void>;

  // Organizations
  getOrganization(id: string): Promise<Organization | undefined>;
  getOrganizations(): Promise<Organization[]>;
  createOrganization(org: InsertOrganization): Promise<Organization>;
  updateOrganization(id: string, updates: Partial<InsertOrganization>): Promise<Organization>;
  deleteOrganization(id: string): Promise<void>;

  // Preventivi
  getPreventivi(orgId: string): Promise<(Preventivo & { createdByName: string | null; createdByEmail: string | null })[]>;
  getPreventivo(id: string): Promise<Preventivo | undefined>;
  createPreventivo(prev: InsertPreventivo): Promise<Preventivo>;
  updatePreventivo(id: string, name: string, data: any): Promise<Preventivo>;
  deletePreventivo(id: string): Promise<void>;

  // Organization Config
  getOrgConfig(orgId: string): Promise<OrganizationConfig | undefined>;
  upsertOrgConfig(orgId: string, config: any, version: string): Promise<OrganizationConfig>;

  // PDV Configurations
  getPdvConfigurations(orgId: string): Promise<PdvConfiguration[]>;
  getPdvConfiguration(id: string): Promise<PdvConfiguration | undefined>;
  createPdvConfiguration(config: InsertPdvConfiguration): Promise<PdvConfiguration>;
  updatePdvConfiguration(id: string, name: string, config: any): Promise<PdvConfiguration>;
  deletePdvConfiguration(id: string): Promise<void>;

  // System Config (super admin defaults)
  getSystemConfig(key: string): Promise<SystemConfig | undefined>;
  getAllSystemConfigs(): Promise<SystemConfig[]>;
  upsertSystemConfig(key: string, config: any, updatedBy: string | null): Promise<SystemConfig>;

  // BiSuite Sales
  upsertBisuiteSales(sales: InsertBisuiteSale[]): Promise<{ inserted: number; updated: number; total: number }>;
  getBisuiteSales(orgId: string, from?: Date, to?: Date, includeAnnullate?: boolean): Promise<BisuiteSale[]>;
  getBisuiteSalesByItalianMonth(orgId: string, year: number, month: number, includeAnnullate?: boolean): Promise<BisuiteSale[]>;
  getBisuiteSalesByItalianDateRange(orgId: string, fromYMD?: string, toYMD?: string, includeAnnullate?: boolean): Promise<BisuiteSale[]>;
  getBisuiteSale(id: string): Promise<BisuiteSale | undefined>;
  deleteBisuiteSalesByOrg(orgId: string): Promise<void>;
  reconcileBisuiteSales(orgId: string, fromYMD: string, toYMD: string, threshold: Date): Promise<{ deleted: number }>;

  // Gara Config
  getGaraConfig(orgId: string, month: number, year: number): Promise<GaraConfig | undefined>;
  getGaraConfigById(id: string): Promise<GaraConfig | undefined>;
  createGaraConfig(orgId: string, month: number, year: number, name: string, config: Record<string, unknown>): Promise<GaraConfig>;
  updateGaraConfig(id: string, config: Record<string, unknown>, name?: string): Promise<GaraConfig>;
  deleteGaraConfig(id: string): Promise<void>;
  listGaraConfigs(orgId: string, month: number, year: number): Promise<{ id: string; name: string | null; month: number; year: number; updatedAt: Date | null; createdAt: Date | null }[]>;
  listGaraConfigHistory(orgId: string): Promise<{ month: number; year: number; updatedAt: Date | null }[]>;

  // DRMS Uploads
  listDrmsUploads(orgId: string): Promise<Array<{ id: string; month: number; year: number; period: string; fileName: string; totaleImporto: string | null; righeCount: number; uploadedBy: string | null; uploadedAt: Date | null }>>;
  getDrmsUpload(id: string): Promise<DrmsUpload | undefined>;
  getDrmsUploadByPeriod(orgId: string, month: number, year: number): Promise<DrmsUpload | undefined>;
  createDrmsUpload(upload: InsertDrmsUpload): Promise<DrmsUpload>;
  deleteDrmsUploadsByPeriod(orgId: string, month: number, year: number): Promise<void>;
  deleteDrmsUpload(id: string): Promise<void>;

  // Incentivazione interna (gare addetto)
  getIncentivazioneConfig(orgId: string, month: number, year: number): Promise<IncentivazioneConfigRow | undefined>;
  upsertIncentivazioneConfig(orgId: string, month: number, year: number, config: Record<string, unknown>, updatedBy: string | null): Promise<IncentivazioneConfigRow>;
  listIncentivazioneValenze(orgId: string, month: number, year: number): Promise<IncentivazioneValenze[]>;
  upsertIncentivazioneValenze(value: InsertIncentivazioneValenze): Promise<IncentivazioneValenze>;
  deleteIncentivazioneValenze(orgId: string, month: number, year: number, sectionId: string): Promise<void>;
  aggregateAccessoriServizi(orgId: string, fromYMD: string, toYMD: string, accCats: number[], servCats: number[]): Promise<Array<{ name: string; acc: number; serv: number }>>;
  getLastBisuiteSync(orgId: string): Promise<Date | null>;

  // Password Reset Tokens
  createPasswordResetToken(email: string, token: string, expiresAt: Date): Promise<PasswordResetToken>;
  getValidResetToken(token: string): Promise<PasswordResetToken | undefined>;
  markTokenUsed(token: string): Promise<void>;

  // FinPlan Data
  getFinplanData(orgId: string): Promise<FinplanData | undefined>;
  upsertFinplanData(orgId: string, data: any, updatedBy: string | null): Promise<FinplanData>;

  // Customer Journey (Task #158)
  listCustomerJourneys(orgId: string, addettiFilter?: string[] | null): Promise<CustomerJourney[]>;
  getCustomerJourney(id: string, orgId: string): Promise<CustomerJourney | undefined>;
  getCustomerJourneyItems(journeyId: string): Promise<CustomerJourneyItem[]>;
  getCustomerJourneyItem(id: string, orgId: string): Promise<CustomerJourneyItem | undefined>;
  updateCustomerJourneyItemState(id: string, orgId: string, state: CjItemState, userId: string | null): Promise<CustomerJourneyItem>;
  setCustomerJourneyItemGettone(id: string, orgId: string, confirmed: boolean, userId: string | null): Promise<CustomerJourneyItem>;
  updateCustomerJourneyItemDetails(id: string, orgId: string, details: CjItemDetailsUpdate, userId: string | null): Promise<CustomerJourneyItem>;
  getCustomerJourneyTriggerDate(orgId: string): Promise<Date>;
  setCustomerJourneyTriggerDate(orgId: string, date: string | null): Promise<Date>;
  reconcileCustomerJourneys(orgId: string): Promise<{ journeys: number; items: number }>;

  // BiSuite Sync Notifications
  createBisuiteSyncNotification(notif: InsertBisuiteSyncNotification): Promise<BisuiteSyncNotification>;
  listBisuiteSyncNotifications(orgId: string, opts?: { unreadOnly?: boolean; limit?: number }): Promise<BisuiteSyncNotification[]>;
  countUnreadBisuiteSyncNotifications(orgId: string): Promise<number>;
  markBisuiteSyncNotificationRead(id: string, orgId: string): Promise<void>;
  markAllBisuiteSyncNotificationsRead(orgId: string): Promise<void>;
  deleteOldReadBisuiteSyncNotifications(olderThan: Date): Promise<{ deleted: number }>;
}

export class DatabaseStorage implements IStorage {
  // Profiles
  async getProfile(id: string): Promise<Profile | undefined> {
    const [profile] = await db.select().from(profiles).where(eq(profiles.id, id));
    return profile;
  }

  async getProfileByEmail(email: string): Promise<Profile | undefined> {
    const [profile] = await db.select().from(profiles).where(eq(profiles.email, email));
    return profile;
  }

  async upsertProfile(profile: InsertProfile): Promise<Profile> {
    const updateSet: any = {
      updatedAt: new Date(),
    };
    if (profile.email !== undefined) updateSet.email = profile.email;
    if (profile.fullName !== undefined) updateSet.fullName = profile.fullName;
    if (profile.profileImageUrl !== undefined) updateSet.profileImageUrl = profile.profileImageUrl;
    if (profile.passwordHash !== undefined) updateSet.passwordHash = profile.passwordHash;
    if (profile.role !== undefined) updateSet.role = profile.role;
    if (profile.organizationId !== undefined) updateSet.organizationId = profile.organizationId;

    const [result] = await db.insert(profiles)
      .values(profile)
      .onConflictDoUpdate({
        target: profiles.id,
        set: updateSet,
      })
      .returning();
    return result;
  }

  async getProfilesByOrg(orgId: string): Promise<Profile[]> {
    return await db.select().from(profiles).where(eq(profiles.organizationId, orgId));
  }

  async updateProfile(id: string, updates: Partial<InsertProfile>): Promise<Profile> {
    const [result] = await db.update(profiles)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(profiles.id, id))
      .returning();
    return result;
  }

  async deleteProfile(id: string): Promise<void> {
    await db.delete(profiles).where(eq(profiles.id, id));
  }

  // Organizations
  async getOrganization(id: string): Promise<Organization | undefined> {
    const [org] = await db.select().from(organizations).where(eq(organizations.id, id));
    return org;
  }

  async getOrganizations(): Promise<Organization[]> {
    return await db.select().from(organizations).orderBy(desc(organizations.createdAt));
  }

  async createOrganization(org: InsertOrganization): Promise<Organization> {
    const [result] = await db.insert(organizations).values(org).returning();
    return result;
  }

  async updateOrganization(id: string, updates: Partial<InsertOrganization>): Promise<Organization> {
    const [result] = await db.update(organizations)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(organizations.id, id))
      .returning();
    return result;
  }

  async deleteOrganization(id: string): Promise<void> {
    await db.delete(organizations).where(eq(organizations.id, id));
  }

  // Preventivi
  async getPreventivi(orgId: string): Promise<(Preventivo & { createdByName: string | null; createdByEmail: string | null })[]> {
    const rows = await db.select({
      preventivo: preventivi,
      createdByName: profiles.fullName,
      createdByEmail: profiles.email,
    }).from(preventivi)
      .leftJoin(profiles, eq(profiles.id, preventivi.createdBy))
      .where(eq(preventivi.organizationId, orgId))
      .orderBy(desc(preventivi.updatedAt));
    return rows.map((r) => ({
      ...r.preventivo,
      createdByName: r.createdByName,
      createdByEmail: r.createdByEmail,
    }));
  }

  async getPreventivo(id: string): Promise<Preventivo | undefined> {
    const [prev] = await db.select().from(preventivi).where(eq(preventivi.id, id));
    return prev;
  }

  async createPreventivo(prev: InsertPreventivo): Promise<Preventivo> {
    const [result] = await db.insert(preventivi).values(prev).returning();
    return result;
  }

  async updatePreventivo(id: string, name: string, data: any): Promise<Preventivo> {
    const [result] = await db.update(preventivi)
      .set({ name, data, updatedAt: new Date() })
      .where(eq(preventivi.id, id))
      .returning();
    return result;
  }

  async deletePreventivo(id: string): Promise<void> {
    await db.delete(preventivi).where(eq(preventivi.id, id));
  }

  // Organization Config
  async getOrgConfig(orgId: string): Promise<OrganizationConfig | undefined> {
    const [config] = await db.select().from(organizationConfig)
      .where(eq(organizationConfig.organizationId, orgId));
    return config;
  }

  async upsertOrgConfig(orgId: string, config: any, version: string): Promise<OrganizationConfig> {
    const [result] = await db.insert(organizationConfig)
      .values({
        organizationId: orgId,
        config,
        configVersion: version,
      })
      .onConflictDoUpdate({
        target: organizationConfig.organizationId,
        set: {
          config,
          configVersion: version,
          updatedAt: new Date(),
        },
      })
      .returning();
    return result;
  }
  // PDV Configurations
  async getPdvConfigurations(orgId: string): Promise<PdvConfiguration[]> {
    return await db.select().from(pdvConfigurations)
      .where(eq(pdvConfigurations.organizationId, orgId))
      .orderBy(desc(pdvConfigurations.updatedAt));
  }

  async getPdvConfiguration(id: string): Promise<PdvConfiguration | undefined> {
    const [result] = await db.select().from(pdvConfigurations)
      .where(eq(pdvConfigurations.id, id));
    return result;
  }

  async createPdvConfiguration(config: InsertPdvConfiguration): Promise<PdvConfiguration> {
    const [result] = await db.insert(pdvConfigurations).values(config).returning();
    return result;
  }

  async updatePdvConfiguration(id: string, name: string, config: any): Promise<PdvConfiguration> {
    const [result] = await db.update(pdvConfigurations)
      .set({ name, config, updatedAt: new Date() })
      .where(eq(pdvConfigurations.id, id))
      .returning();
    return result;
  }

  async deletePdvConfiguration(id: string): Promise<void> {
    await db.delete(pdvConfigurations).where(eq(pdvConfigurations.id, id));
  }

  // System Config
  async getSystemConfig(key: string): Promise<SystemConfig | undefined> {
    const [config] = await db.select().from(systemConfig).where(eq(systemConfig.key, key));
    return config;
  }

  async getAllSystemConfigs(): Promise<SystemConfig[]> {
    return await db.select().from(systemConfig);
  }

  async upsertSystemConfig(key: string, config: any, updatedBy: string | null): Promise<SystemConfig> {
    const [result] = await db.insert(systemConfig)
      .values({ key, config, updatedBy })
      .onConflictDoUpdate({
        target: systemConfig.key,
        set: { config, updatedBy, updatedAt: new Date() },
      })
      .returning();
    return result;
  }

  // BiSuite Sales
  /**
   * Upsert non distruttivo basato sull'unique constraint
   * (organization_id, bisuite_id). Aggiorna i campi mutabili dei record già
   * presenti e inserisce quelli nuovi. Restituisce conteggi separati di
   * inseriti/aggiornati usando il trick `xmax = 0` di Postgres (xmax è 0
   * per le righe appena inserite, non-zero per quelle aggiornate via
   * ON CONFLICT DO UPDATE).
   *
   * IMPORTANTE: NON cancella nulla. Se la stessa coppia (org, bisuite_id)
   * compare più volte nello stesso batch tiene l'ultima occorrenza per
   * evitare l'errore Postgres "ON CONFLICT DO UPDATE command cannot affect
   * row a second time".
   */
  async upsertBisuiteSales(
    sales: InsertBisuiteSale[],
  ): Promise<{ inserted: number; updated: number; total: number }> {
    if (sales.length === 0) return { inserted: 0, updated: 0, total: 0 };

    // Dedup intra-batch su (orgId, bisuiteId): tiene l'ultima occorrenza
    const dedupMap = new Map<string, InsertBisuiteSale>();
    for (const s of sales) {
      const key = `${s.organizationId}::${s.bisuiteId}`;
      dedupMap.set(key, s);
    }
    const deduped = Array.from(dedupMap.values());

    let inserted = 0;
    let updated = 0;
    const BATCH = 500;
    for (let i = 0; i < deduped.length; i += BATCH) {
      const batch = deduped.slice(i, i + BATCH);
      const result = await db.insert(bisuiteSales)
        .values(batch)
        .onConflictDoUpdate({
          target: [bisuiteSales.organizationId, bisuiteSales.bisuiteId],
          set: {
            dataVendita: sql`excluded.data_vendita`,
            codicePos: sql`excluded.codice_pos`,
            nomeNegozio: sql`excluded.nome_negozio`,
            ragioneSociale: sql`excluded.ragione_sociale`,
            nomeAddetto: sql`excluded.nome_addetto`,
            nomeCliente: sql`excluded.nome_cliente`,
            totale: sql`excluded.totale`,
            stato: sql`excluded.stato`,
            categorieArticoli: sql`excluded.categorie_articoli`,
            rawData: sql`excluded.raw_data`,
            fetchedAt: sql`now()`,
            lastSeenAt: sql`now()`,
          },
        })
        .returning({ wasInserted: sql<boolean>`(xmax = 0)` });
      for (const row of result) {
        if (row.wasInserted) inserted++;
        else updated++;
      }
    }
    return { inserted, updated, total: inserted + updated };
  }

  async getBisuiteSales(orgId: string, from?: Date, to?: Date, includeAnnullate: boolean = false): Promise<BisuiteSale[]> {
    const conditions = [eq(bisuiteSales.organizationId, orgId)];
    if (from) conditions.push(gte(bisuiteSales.dataVendita, from));
    if (to) conditions.push(lte(bisuiteSales.dataVendita, to));
    if (!includeAnnullate) conditions.push(sql`upper(coalesce(trim(${bisuiteSales.stato}), '')) <> 'ANNULLATA'`);
    return await db.select().from(bisuiteSales)
      .where(and(...conditions))
      .orderBy(desc(bisuiteSales.dataVendita));
  }

  /**
   * Vendite filtrate per mese/anno italiano (Europe/Rome).
   * Le date BiSuite sono salvate come wall-time italiano in colonna `timestamp`
   * (senza fuso). Estraiamo anno/mese direttamente dalla colonna senza conversioni
   * di fuso, evitando lo slittamento ±2h dell'approccio basato su from/to.
   */
  async getBisuiteSalesByItalianMonth(orgId: string, year: number, month: number, includeAnnullate: boolean = false): Promise<BisuiteSale[]> {
    const conditions = [
      eq(bisuiteSales.organizationId, orgId),
      sql`extract(year from ${bisuiteSales.dataVendita}) = ${year}`,
      sql`extract(month from ${bisuiteSales.dataVendita}) = ${month}`,
    ];
    if (!includeAnnullate) conditions.push(sql`upper(coalesce(trim(${bisuiteSales.stato}), '')) <> 'ANNULLATA'`);
    return await db.select().from(bisuiteSales)
      .where(and(...conditions))
      .orderBy(desc(bisuiteSales.dataVendita));
  }

  /**
   * Vendite filtrate per intervallo di date italiane (YYYY-MM-DD inclusi).
   * Confronta direttamente la parte data della colonna wall-time italiano,
   * senza alcuna conversione di fuso orario o widening ±2h.
   */
  async getBisuiteSalesByItalianDateRange(orgId: string, fromYMD?: string, toYMD?: string, includeAnnullate: boolean = false): Promise<BisuiteSale[]> {
    const conditions = [eq(bisuiteSales.organizationId, orgId)];
    if (fromYMD) conditions.push(sql`${bisuiteSales.dataVendita}::date >= ${fromYMD}::date`);
    if (toYMD) conditions.push(sql`${bisuiteSales.dataVendita}::date <= ${toYMD}::date`);
    if (!includeAnnullate) conditions.push(sql`upper(coalesce(trim(${bisuiteSales.stato}), '')) <> 'ANNULLATA'`);
    return await db.select().from(bisuiteSales)
      .where(and(...conditions))
      .orderBy(desc(bisuiteSales.dataVendita));
  }

  async getBisuiteSale(id: string): Promise<BisuiteSale | undefined> {
    const [result] = await db.select().from(bisuiteSales).where(eq(bisuiteSales.id, id));
    return result;
  }

  async deleteBisuiteSalesByOrg(orgId: string): Promise<void> {
    await db.delete(bisuiteSales).where(eq(bisuiteSales.organizationId, orgId));
  }

  /**
   * Reconcile: dopo aver completato la sync di un range, elimina i record
   * dell'org la cui `data_vendita` cade in [fromYMD..toYMD] (date italiane,
   * confronto su `::date`) e che NON sono stati toccati dalla sync corrente
   * (cioè `last_seen_at < threshold`). Serve a propagare le cancellazioni
   * o gli accorpamenti effettuati lato BiSuite alla nostra copia.
   * I record con `last_seen_at` NULL (legacy, pre-Task #104) sono trattati
   * come stale e quindi eliminabili se nel range.
   */
  async reconcileBisuiteSales(
    orgId: string,
    fromYMD: string,
    toYMD: string,
    threshold: Date,
  ): Promise<{ deleted: number }> {
    const result = await db.delete(bisuiteSales).where(and(
      eq(bisuiteSales.organizationId, orgId),
      sql`${bisuiteSales.dataVendita}::date >= ${fromYMD}::date`,
      sql`${bisuiteSales.dataVendita}::date <= ${toYMD}::date`,
      sql`(${bisuiteSales.lastSeenAt} IS NULL OR ${bisuiteSales.lastSeenAt} < ${threshold.toISOString()})`,
    )).returning({ id: bisuiteSales.id });
    return { deleted: result.length };
  }

  // Gara Config
  async getGaraConfig(orgId: string, month: number, year: number): Promise<GaraConfig | undefined> {
    const [result] = await db.select().from(garaConfig)
      .where(and(
        eq(garaConfig.organizationId, orgId),
        eq(garaConfig.month, month),
        eq(garaConfig.year, year),
      ))
      .orderBy(desc(garaConfig.updatedAt))
      .limit(1);
    return result;
  }

  async getGaraConfigById(id: string): Promise<GaraConfig | undefined> {
    const [result] = await db.select().from(garaConfig)
      .where(eq(garaConfig.id, id));
    return result;
  }

  async createGaraConfig(orgId: string, month: number, year: number, name: string, config: Record<string, unknown>): Promise<GaraConfig> {
    const [result] = await db.insert(garaConfig)
      .values({ organizationId: orgId, month, year, name, config })
      .returning();
    return result;
  }

  async updateGaraConfig(id: string, config: Record<string, unknown>, name?: string): Promise<GaraConfig> {
    const updates: Record<string, unknown> = { config, updatedAt: new Date() };
    if (name !== undefined) updates.name = name;
    const [result] = await db.update(garaConfig)
      .set(updates)
      .where(eq(garaConfig.id, id))
      .returning();
    return result;
  }

  async deleteGaraConfig(id: string): Promise<void> {
    await db.delete(garaConfig).where(eq(garaConfig.id, id));
  }

  async listGaraConfigs(orgId: string, month: number, year: number): Promise<{ id: string; name: string | null; month: number; year: number; updatedAt: Date | null; createdAt: Date | null }[]> {
    return db.select({
      id: garaConfig.id,
      name: garaConfig.name,
      month: garaConfig.month,
      year: garaConfig.year,
      updatedAt: garaConfig.updatedAt,
      createdAt: garaConfig.createdAt,
    }).from(garaConfig)
      .where(and(
        eq(garaConfig.organizationId, orgId),
        eq(garaConfig.month, month),
        eq(garaConfig.year, year),
      ))
      .orderBy(desc(garaConfig.updatedAt));
  }

  async listGaraConfigHistory(orgId: string): Promise<{ month: number; year: number; updatedAt: Date | null }[]> {
    const results = await db.select({
      month: garaConfig.month,
      year: garaConfig.year,
      updatedAt: garaConfig.updatedAt,
    }).from(garaConfig)
      .where(eq(garaConfig.organizationId, orgId))
      .orderBy(desc(garaConfig.year), desc(garaConfig.month));
    return results;
  }

  // DRMS Uploads
  async listDrmsUploads(orgId: string) {
    return await db.select({
      id: drmsUploads.id,
      month: drmsUploads.month,
      year: drmsUploads.year,
      period: drmsUploads.period,
      fileName: drmsUploads.fileName,
      totaleImporto: drmsUploads.totaleImporto,
      righeCount: drmsUploads.righeCount,
      uploadedBy: drmsUploads.uploadedBy,
      uploadedAt: drmsUploads.uploadedAt,
    }).from(drmsUploads)
      .where(eq(drmsUploads.organizationId, orgId))
      .orderBy(desc(drmsUploads.year), desc(drmsUploads.month), desc(drmsUploads.uploadedAt));
  }

  async getDrmsUpload(id: string): Promise<DrmsUpload | undefined> {
    const [r] = await db.select().from(drmsUploads).where(eq(drmsUploads.id, id));
    return r;
  }

  async getDrmsUploadByPeriod(orgId: string, month: number, year: number): Promise<DrmsUpload | undefined> {
    const [r] = await db.select().from(drmsUploads)
      .where(and(
        eq(drmsUploads.organizationId, orgId),
        eq(drmsUploads.month, month),
        eq(drmsUploads.year, year),
      ))
      .orderBy(desc(drmsUploads.uploadedAt))
      .limit(1);
    return r;
  }

  async createDrmsUpload(upload: InsertDrmsUpload): Promise<DrmsUpload> {
    const [r] = await db.insert(drmsUploads).values(upload).returning();
    return r;
  }

  async deleteDrmsUploadsByPeriod(orgId: string, month: number, year: number): Promise<void> {
    await db.delete(drmsUploads).where(and(
      eq(drmsUploads.organizationId, orgId),
      eq(drmsUploads.month, month),
      eq(drmsUploads.year, year),
    ));
  }

  async deleteDrmsUpload(id: string): Promise<void> {
    await db.delete(drmsUploads).where(eq(drmsUploads.id, id));
  }

  // Incentivazione interna (gare addetto)
  async getIncentivazioneConfig(orgId: string, month: number, year: number): Promise<IncentivazioneConfigRow | undefined> {
    const [r] = await db.select().from(incentivazioneConfig)
      .where(and(
        eq(incentivazioneConfig.organizationId, orgId),
        eq(incentivazioneConfig.month, month),
        eq(incentivazioneConfig.year, year),
      ))
      .limit(1);
    return r;
  }

  async upsertIncentivazioneConfig(orgId: string, month: number, year: number, config: Record<string, unknown>, updatedBy: string | null): Promise<IncentivazioneConfigRow> {
    const [r] = await db.insert(incentivazioneConfig)
      .values({ organizationId: orgId, month, year, config, updatedBy })
      .onConflictDoUpdate({
        target: [incentivazioneConfig.organizationId, incentivazioneConfig.month, incentivazioneConfig.year],
        set: { config, updatedBy, updatedAt: new Date() },
      })
      .returning();
    return r;
  }

  async listIncentivazioneValenze(orgId: string, month: number, year: number): Promise<IncentivazioneValenze[]> {
    return await db.select().from(incentivazioneValenze)
      .where(and(
        eq(incentivazioneValenze.organizationId, orgId),
        eq(incentivazioneValenze.month, month),
        eq(incentivazioneValenze.year, year),
      ));
  }

  async upsertIncentivazioneValenze(value: InsertIncentivazioneValenze): Promise<IncentivazioneValenze> {
    const [r] = await db.insert(incentivazioneValenze)
      .values(value)
      .onConflictDoUpdate({
        target: [incentivazioneValenze.organizationId, incentivazioneValenze.month, incentivazioneValenze.year, incentivazioneValenze.sectionId],
        set: {
          fileName: value.fileName,
          rows: value.rows,
          uploadedBy: value.uploadedBy ?? null,
          uploadedAt: new Date(),
        },
      })
      .returning();
    return r;
  }

  async deleteIncentivazioneValenze(orgId: string, month: number, year: number, sectionId: string): Promise<void> {
    await db.delete(incentivazioneValenze).where(and(
      eq(incentivazioneValenze.organizationId, orgId),
      eq(incentivazioneValenze.month, month),
      eq(incentivazioneValenze.year, year),
      eq(incentivazioneValenze.sectionId, sectionId),
    ));
  }

  // Aggrega Accessori/Servizi dalle vendite BiSuite per il periodo: somma il
  // `dettaglio.prezzo` di ogni articolo per categoria.id, raggruppato per
  // addetto (match case-insensitive). Esclude le vendite ANNULLATA.
  async aggregateAccessoriServizi(orgId: string, fromYMD: string, toYMD: string, accCats: number[], servCats: number[]): Promise<Array<{ name: string; acc: number; serv: number }>> {
    const toIntArr = (xs: number[]) => {
      const ints = xs.map((n) => Math.trunc(Number(n))).filter((n) => Number.isFinite(n));
      return ints.length ? ints : [-1];
    };
    const accArr = toIntArr(accCats);
    const servArr = toIntArr(servCats);
    // NB: un array JS interpolato in `sql` verrebbe espanso in più placeholder
    // (`ANY($1, $2)`) -> errore Postgres 42809. Costruiamo un vero array int[].
    const intArrayLit = (xs: number[]) => sql`ARRAY[${sql.join(xs.map((n) => sql`${n}`), sql`, `)}]::int[]`;
    const rows = await db.execute(sql`
      SELECT min(s.nome_addetto) AS name,
        coalesce(sum(CASE WHEN (a->'categoria'->>'id')::int = ANY(${intArrayLit(accArr)}) THEN (a->'dettaglio'->>'prezzo')::numeric ELSE 0 END), 0) AS acc,
        coalesce(sum(CASE WHEN (a->'categoria'->>'id')::int = ANY(${intArrayLit(servArr)}) THEN (a->'dettaglio'->>'prezzo')::numeric ELSE 0 END), 0) AS serv
      FROM ${bisuiteSales} s,
        jsonb_array_elements(s.raw_data->'articoli') a
      WHERE s.organization_id = ${orgId}
        AND s.data_vendita::date >= ${fromYMD}::date
        AND s.data_vendita::date <= ${toYMD}::date
        AND upper(coalesce(trim(s.stato), '')) <> 'ANNULLATA'
        AND s.nome_addetto IS NOT NULL AND trim(s.nome_addetto) <> ''
      GROUP BY lower(trim(s.nome_addetto))
    `);
    const out = (rows as unknown as { rows?: any[] }).rows ?? (rows as unknown as any[]);
    return (out as any[]).map((r) => ({
      name: String(r.name ?? ""),
      acc: Number(r.acc ?? 0),
      serv: Number(r.serv ?? 0),
    }));
  }

  // Data dell'ultima sincronizzazione vendite dal connettore BiSuite per l'org:
  // ogni sync aggiorna `last_seen_at` su ogni vendita vista, quindi il max è
  // l'istante dell'ultimo fetch riuscito. null se non ci sono ancora vendite.
  async getLastBisuiteSync(orgId: string): Promise<Date | null> {
    const [row] = await db
      .select({ last: sql<Date | null>`max(${bisuiteSales.lastSeenAt})` })
      .from(bisuiteSales)
      .where(eq(bisuiteSales.organizationId, orgId));
    return row?.last ? new Date(row.last) : null;
  }

  // Password Reset Tokens
  async createPasswordResetToken(email: string, token: string, expiresAt: Date): Promise<PasswordResetToken> {
    const [result] = await db.insert(passwordResetTokens)
      .values({ email, token, expiresAt })
      .returning();
    return result;
  }

  async getValidResetToken(token: string): Promise<PasswordResetToken | undefined> {
    const [result] = await db.select().from(passwordResetTokens)
      .where(
        and(
          eq(passwordResetTokens.token, token),
          isNull(passwordResetTokens.usedAt)
        )
      );
    if (result && result.expiresAt > new Date()) {
      return result;
    }
    return undefined;
  }

  async markTokenUsed(token: string): Promise<void> {
    await db.update(passwordResetTokens)
      .set({ usedAt: new Date() })
      .where(eq(passwordResetTokens.token, token));
  }

  // FinPlan Data
  async getFinplanData(orgId: string): Promise<FinplanData | undefined> {
    const [row] = await db.select().from(finplanData).where(eq(finplanData.organizationId, orgId));
    return row;
  }

  async upsertFinplanData(orgId: string, data: any, updatedBy: string | null): Promise<FinplanData> {
    const [row] = await db.insert(finplanData)
      .values({ organizationId: orgId, data, updatedBy })
      .onConflictDoUpdate({
        target: finplanData.organizationId,
        set: { data, updatedBy, updatedAt: new Date() },
      })
      .returning();
    return row;
  }

  // === Customer Journey (Task #158) ===

  async listCustomerJourneys(orgId: string, addettiFilter?: string[] | null): Promise<CustomerJourney[]> {
    // `addettiFilter == null` => nessun filtro (admin/super_admin vedono tutto).
    // `addettiFilter` array (anche vuoto) => filtro operatore: un array vuoto
    // significa "nessun addetto associato" e DEVE restituire [] (no leakage).
    if (addettiFilter != null) {
      // L'operatore vede solo le journey che contengono almeno un item
      // gestito da uno dei suoi nominativi addetto (case-insensitive).
      const lower = addettiFilter.map((a) => a.toLowerCase().trim()).filter(Boolean);
      if (lower.length === 0) return [];
      const rows = await db.selectDistinct({ cj: customerJourneys })
        .from(customerJourneys)
        .innerJoin(customerJourneyItems, eq(customerJourneyItems.journeyId, customerJourneys.id))
        .where(and(
          eq(customerJourneys.organizationId, orgId),
          inArray(sql`lower(trim(${customerJourneyItems.addetto}))`, lower),
        ))
        .orderBy(desc(customerJourneys.openedAt));
      return rows.map((r) => r.cj);
    }
    return await db.select().from(customerJourneys)
      .where(eq(customerJourneys.organizationId, orgId))
      .orderBy(desc(customerJourneys.openedAt));
  }

  async getCustomerJourney(id: string, orgId: string): Promise<CustomerJourney | undefined> {
    const [row] = await db.select().from(customerJourneys)
      .where(and(eq(customerJourneys.id, id), eq(customerJourneys.organizationId, orgId)));
    return row;
  }

  async getCustomerJourneyItems(journeyId: string): Promise<CustomerJourneyItem[]> {
    return await db.select().from(customerJourneyItems)
      .where(eq(customerJourneyItems.journeyId, journeyId))
      .orderBy(desc(customerJourneyItems.dataInserimento));
  }

  // Riepilogo driver per-journey per la lista (schede cliente): recupera in
  // una sola query (driver, state) di tutti gli item delle journey indicate,
  // li raggruppa per journeyId e calcola il riepilogo driver con la stessa
  // logica del dettaglio (`summarizeDrivers`). Evita una query per scheda.
  async getCustomerJourneyDriverSummaries(
    journeyIds: string[],
  ): Promise<Map<string, CjDriverSummary[]>> {
    const out = new Map<string, CjDriverSummary[]>();
    if (journeyIds.length === 0) return out;
    const rows = await db.select({
      journeyId: customerJourneyItems.journeyId,
      driver: customerJourneyItems.driver,
      state: customerJourneyItems.state,
    }).from(customerJourneyItems)
      .where(inArray(customerJourneyItems.journeyId, journeyIds));
    const byJourney = new Map<string, { driver: CjDriver; state: CjItemState }[]>();
    for (const r of rows) {
      const list = byJourney.get(r.journeyId) ?? [];
      list.push({ driver: r.driver as CjDriver, state: r.state as CjItemState });
      byJourney.set(r.journeyId, list);
    }
    for (const id of journeyIds) {
      out.set(id, summarizeDrivers(byJourney.get(id) ?? []));
    }
    return out;
  }

  async getCustomerJourneyItem(id: string, orgId: string): Promise<CustomerJourneyItem | undefined> {
    const [row] = await db.select().from(customerJourneyItems)
      .where(and(eq(customerJourneyItems.id, id), eq(customerJourneyItems.organizationId, orgId)));
    return row;
  }

  async updateCustomerJourneyItemState(id: string, orgId: string, state: CjItemState, userId: string | null): Promise<CustomerJourneyItem> {
    const [row] = await db.update(customerJourneyItems)
      .set({
        state,
        stateManual: true,
        stateUpdatedAt: new Date(),
        stateUpdatedBy: userId,
        updatedAt: new Date(),
      })
      .where(and(eq(customerJourneyItems.id, id), eq(customerJourneyItems.organizationId, orgId)))
      .returning();
    return row;
  }

  async setCustomerJourneyItemGettone(id: string, orgId: string, confirmed: boolean, userId: string | null): Promise<CustomerJourneyItem> {
    const [row] = await db.update(customerJourneyItems)
      .set({
        gettoneConfirmed: confirmed,
        gettoneConfirmedAt: confirmed ? new Date() : null,
        gettoneConfirmedBy: confirmed ? userId : null,
        updatedAt: new Date(),
      })
      .where(and(eq(customerJourneyItems.id, id), eq(customerJourneyItems.organizationId, orgId)))
      .returning();
    return row;
  }

  async updateCustomerJourneyItemDetails(id: string, orgId: string, details: CjItemDetailsUpdate, userId: string | null): Promise<CustomerJourneyItem> {
    // Aggiorna solo i campi forniti (undefined => non toccato; null => azzera).
    const set: Record<string, unknown> = {
      detailsManual: true,
      detailsUpdatedAt: new Date(),
      detailsUpdatedBy: userId,
      updatedAt: new Date(),
    };
    if (details.dataAttivazione !== undefined) set.dataAttivazione = details.dataAttivazione;
    if (details.pdvDestinazione !== undefined) set.pdvDestinazione = details.pdvDestinazione;
    if (details.imei !== undefined) set.imei = details.imei;
    if (details.rata !== undefined) set.rata = details.rata;
    const [row] = await db.update(customerJourneyItems)
      .set(set)
      .where(and(eq(customerJourneyItems.id, id), eq(customerJourneyItems.organizationId, orgId)))
      .returning();
    return row;
  }

  /**
   * Motore di reconcile: deriva le customer journey dalle vendite BiSuite
   * dell'organizzazione. Una journey si apre quando un cliente registra una
   * nuova attivazione di pista mobile dalla data trigger configurata per
   * l'organizzazione (fallback {@link CJ_DEFAULT_TRIGGER_DATE}). Per i
   * clienti con journey aperta materializza un item per ogni articolo-driver
   * (mobile/fisso/energia/assicurazioni/telefono/protetti) di TUTTE le sue
   * vendite (anche precedenti al trigger), così da mostrare il quadro
   * completo del cross-sell. Lo stato auto (inserito/attivato/stornato) deriva
   * dallo `stato` della vendita; gli stati impostati manualmente
   * (`state_manual`) e le conferme gettone non vengono mai sovrascritti.
   */
  async getCustomerJourneyTriggerDate(orgId: string): Promise<Date> {
    const cfg = await this.getOrgConfig(orgId);
    const raw = (cfg?.config as Record<string, unknown> | null | undefined)?.customerJourneyTriggerDate;
    return parseCjTriggerDate(raw) ?? CJ_DEFAULT_TRIGGER_DATE;
  }

  async setCustomerJourneyTriggerDate(orgId: string, date: string | null): Promise<Date> {
    const cfg = await this.getOrgConfig(orgId);
    const config: Record<string, unknown> = { ...((cfg?.config as Record<string, unknown> | null) || {}) };
    if (date && parseCjTriggerDate(date)) {
      config.customerJourneyTriggerDate = formatCjTriggerDate(parseCjTriggerDate(date)!);
    } else {
      delete config.customerJourneyTriggerDate;
    }
    await this.upsertOrgConfig(orgId, config, cfg?.configVersion || "2.0");
    return this.getCustomerJourneyTriggerDate(orgId);
  }

  async reconcileCustomerJourneys(orgId: string): Promise<{ journeys: number; items: number }> {
    const triggerDate = await this.getCustomerJourneyTriggerDate(orgId);
    const sales = await db.select().from(bisuiteSales)
      .where(eq(bisuiteSales.organizationId, orgId));

    type Anag = {
      customerKey: string; customerType: string;
      nome: string | null; cognome: string | null; ragioneSociale: string | null;
      nominativo: string | null; telefono: string | null; codiceCliente: string | null;
    };
    type Candidate = {
      anag: Anag;
      hasTrigger: boolean;
      triggerSaleId: string | null; triggerBisuiteId: number | null; openedAt: Date | null;
      items: InsertCustomerJourneyItem[];
    };
    const byCustomer = new Map<string, Candidate>();

    for (const sale of sales) {
      const raw: any = sale.rawData || {};
      const cliente: any = raw.cliente || {};
      const cf = String(cliente.codiceFiscale || "").toUpperCase().trim();
      const piva = String(cliente.piva || "").toUpperCase().trim();
      const tipo = String(cliente.clienteTipo || "").toUpperCase().trim();
      const isAzienda = tipo === "GIURIDICA" || tipo === "PROFESSIONISTA";
      let customerKey = "";
      let customerType = "privato";
      if (isAzienda && piva) { customerKey = piva; customerType = "azienda"; }
      else if (cf) { customerKey = cf; customerType = "privato"; }
      else if (piva) { customerKey = piva; customerType = "azienda"; }
      else continue; // cliente non identificabile: impossibile collegare

      const anag: Anag = {
        customerKey, customerType,
        nome: cliente.nome ?? null,
        cognome: cliente.cognome ?? null,
        ragioneSociale: cliente.ragioneSociale ?? cliente.denominazione ?? null,
        nominativo: cliente.nominativo ?? cliente.denominazione ?? cliente.ragioneSociale ?? null,
        telefono: cliente.tel1 ?? cliente.tel2 ?? null,
        codiceCliente: cliente.codiceEsterno != null ? String(cliente.codiceEsterno) : null,
      };

      // L'addetto vendita è per-vendita, non è un campo anagrafico del cliente.
      const saleAddetto: string | null = raw.addetto?.nominativo ?? sale.nomeAddetto ?? null;

      let cand = byCustomer.get(customerKey);
      if (!cand) {
        cand = { anag, hasTrigger: false, triggerSaleId: null, triggerBisuiteId: null, openedAt: null, items: [] };
        byCustomer.set(customerKey, cand);
      } else {
        // mantieni l'anagrafica più completa
        cand.anag = { ...cand.anag, ...Object.fromEntries(Object.entries(anag).filter(([, v]) => v != null && v !== "")) } as Anag;
      }

      const saleDate: Date | null = sale.dataVendita ?? null;
      const stato = String(sale.stato || "").toUpperCase();
      // Un contratto semplicemente letto dalle vendite BiSuite parte da
      // "inserito", il primo stato del processo di tracking: l'avanzamento
      // (in_lavorazione/attivato/pagato/...) è gestito a mano dall'operatore.
      // Le vendite annullate restano "stornato".
      const autoState: CjItemState = stato.includes("ANNULL") ? "stornato" : "inserito";

      const articoli: any[] = Array.isArray(raw.articoli) ? raw.articoli : [];
      for (const art of articoli) {
        const categoria = art?.categoria?.nome ?? null;
        const tipologia = art?.tipologia?.nome ?? null;
        const driver = driverFromCategory(categoria);
        if (!driver) continue;

        // Trigger journey: nuova attivazione mobile dalla data configurata.
        if (driver === "mobile" && isMobileActivationCategory(categoria)
            && autoState !== "stornato" && saleDate && saleDate >= triggerDate) {
          if (!cand.hasTrigger || (cand.openedAt && saleDate < cand.openedAt)) {
            cand.hasTrigger = true;
            cand.triggerSaleId = sale.id;
            cand.triggerBisuiteId = sale.bisuiteId ?? null;
            cand.openedAt = saleDate;
          }
        }

        const dett: any = art?.dettaglio || {};
        const parsed = parseVenditaInfo(dett);
        const sub = energiaSubtype(tipologia);
        let pod: string | null = null;
        let pdr: string | null = null;
        if (parsed.podPdr) {
          if (sub === "gas") pdr = parsed.podPdr;
          else if (sub === "luce") pod = parsed.podPdr;
          else pod = parsed.podPdr;
        }
        const modVendita = dett.tipologiaVendita ?? null;
        const isFinanziamento = String(modVendita || "").toUpperCase().includes("FINANZIAMENTO");

        cand.items.push({
          journeyId: "", // riempito dopo aver creato/recuperato la journey
          organizationId: orgId,
          driver,
          bisuiteSaleId: sale.id,
          bisuiteId: sale.bisuiteId ?? null,
          bisuiteArticleId: art?.id != null ? Number(art.id) : null,
          nome: cliente.nome ?? null,
          cognome: cliente.cognome ?? null,
          cf: cf || null,
          piva: piva || null,
          telefono: cliente.tel1 ?? null,
          codiceCliente: anag.codiceCliente,
          codiceContratto: parsed.codiceContratto ?? null,
          categoria,
          tipologia,
          descrizione: art?.descrizione ?? null,
          canone: dett.canone != null ? String(dett.canone) : null,
          dataInserimento: saleDate,
          dataAttivazione: null,
          addetto: saleAddetto,
          pdvOrigine: raw.attivita?.nominativo ?? sale.nomeNegozio ?? null,
          pdvDestinazione: null,
          pod, pdr,
          imei: parsed.imei ?? null,
          importo: dett.prezzo != null ? String(dett.prezzo) : (raw.importoScontrino != null ? String(raw.importoScontrino) : null),
          rata: isFinanziamento && dett.importoFinanziato != null ? String(dett.importoFinanziato) : null,
          modVendita,
          state: autoState,
        });
      }
    }

    let journeyCount = 0;
    let itemCount = 0;
    for (const cand of Array.from(byCustomer.values())) {
      if (!cand.hasTrigger) continue;
      journeyCount++;

      const [journey] = await db.insert(customerJourneys)
        .values({
          organizationId: orgId,
          customerKey: cand.anag.customerKey,
          customerType: cand.anag.customerType,
          nome: cand.anag.nome,
          cognome: cand.anag.cognome,
          ragioneSociale: cand.anag.ragioneSociale,
          nominativo: cand.anag.nominativo,
          telefono: cand.anag.telefono,
          codiceCliente: cand.anag.codiceCliente,
          triggerSaleId: cand.triggerSaleId,
          triggerBisuiteId: cand.triggerBisuiteId,
          openedAt: cand.openedAt,
          status: "aperta",
        })
        .onConflictDoUpdate({
          target: [customerJourneys.organizationId, customerJourneys.customerKey],
          set: {
            customerType: cand.anag.customerType,
            nome: cand.anag.nome,
            cognome: cand.anag.cognome,
            ragioneSociale: cand.anag.ragioneSociale,
            nominativo: cand.anag.nominativo,
            telefono: cand.anag.telefono,
            codiceCliente: cand.anag.codiceCliente,
            updatedAt: new Date(),
          },
        })
        .returning();

      for (const item of cand.items) {
        item.journeyId = journey.id;
        if (item.bisuiteArticleId == null) continue; // serve per la unique key
        await db.insert(customerJourneyItems)
          .values(item)
          .onConflictDoUpdate({
            target: [customerJourneyItems.organizationId, customerJourneyItems.bisuiteSaleId, customerJourneyItems.bisuiteArticleId],
            set: {
              journeyId: sql`excluded.journey_id`,
              driver: sql`excluded.driver`,
              bisuiteId: sql`excluded.bisuite_id`,
              nome: sql`excluded.nome`,
              cognome: sql`excluded.cognome`,
              cf: sql`excluded.cf`,
              piva: sql`excluded.piva`,
              telefono: sql`excluded.telefono`,
              codiceCliente: sql`excluded.codice_cliente`,
              codiceContratto: sql`excluded.codice_contratto`,
              categoria: sql`excluded.categoria`,
              tipologia: sql`excluded.tipologia`,
              descrizione: sql`excluded.descrizione`,
              canone: sql`excluded.canone`,
              dataInserimento: sql`excluded.data_inserimento`,
              addetto: sql`excluded.addetto`,
              pdvOrigine: sql`excluded.pdv_origine`,
              pod: sql`excluded.pod`,
              pdr: sql`excluded.pdr`,
              // IMEI e RATA possono essere compilati a mano (BiSuite non li
              // fornisce in modo affidabile): se l'item è stato modificato
              // manualmente, il reconcile li preserva. data_attivazione e
              // pdv_destinazione sono esclusi dall'upsert per lo stesso motivo.
              imei: sql`CASE WHEN ${customerJourneyItems.detailsManual} THEN ${customerJourneyItems.imei} ELSE excluded.imei END`,
              importo: sql`excluded.importo`,
              rata: sql`CASE WHEN ${customerJourneyItems.detailsManual} THEN ${customerJourneyItems.rata} ELSE excluded.rata END`,
              modVendita: sql`excluded.mod_vendita`,
              // Preserva lo stato impostato manualmente; altrimenti aggiorna
              // con lo stato auto derivato dal connettore.
              state: sql`CASE WHEN ${customerJourneyItems.stateManual} THEN ${customerJourneyItems.state} ELSE excluded.state END`,
              updatedAt: new Date(),
            },
          });
        itemCount++;
      }
    }

    return { journeys: journeyCount, items: itemCount };
  }

  // BiSuite Sync Notifications
  async createBisuiteSyncNotification(notif: InsertBisuiteSyncNotification): Promise<BisuiteSyncNotification> {
    const [result] = await db.insert(bisuiteSyncNotifications).values(notif).returning();
    return result;
  }

  async listBisuiteSyncNotifications(
    orgId: string,
    opts: { unreadOnly?: boolean; limit?: number } = {},
  ): Promise<BisuiteSyncNotification[]> {
    const where = opts.unreadOnly
      ? and(eq(bisuiteSyncNotifications.organizationId, orgId), isNull(bisuiteSyncNotifications.readAt))
      : eq(bisuiteSyncNotifications.organizationId, orgId);
    const q = db.select().from(bisuiteSyncNotifications)
      .where(where)
      .orderBy(desc(bisuiteSyncNotifications.createdAt));
    if (opts.limit && opts.limit > 0) {
      return await q.limit(opts.limit);
    }
    return await q;
  }

  async countUnreadBisuiteSyncNotifications(orgId: string): Promise<number> {
    const [row] = await db.select({ c: sql<number>`count(*)::int` })
      .from(bisuiteSyncNotifications)
      .where(and(
        eq(bisuiteSyncNotifications.organizationId, orgId),
        isNull(bisuiteSyncNotifications.readAt),
      ));
    return row?.c ?? 0;
  }

  async markBisuiteSyncNotificationRead(id: string, orgId: string): Promise<void> {
    await db.update(bisuiteSyncNotifications)
      .set({ readAt: new Date() })
      .where(and(
        eq(bisuiteSyncNotifications.id, id),
        eq(bisuiteSyncNotifications.organizationId, orgId),
      ));
  }

  async markAllBisuiteSyncNotificationsRead(orgId: string): Promise<void> {
    await db.update(bisuiteSyncNotifications)
      .set({ readAt: new Date() })
      .where(and(
        eq(bisuiteSyncNotifications.organizationId, orgId),
        isNull(bisuiteSyncNotifications.readAt),
      ));
  }

  /**
   * Cancella le notifiche di sync BiSuite già lette (`read_at` non null) la
   * cui `read_at` è più vecchia di `olderThan`. Le notifiche non lette non
   * vengono mai toccate. Usata dal job notturno per evitare crescita
   * indefinita della tabella.
   */
  async deleteOldReadBisuiteSyncNotifications(olderThan: Date): Promise<{ deleted: number }> {
    const result = await db.delete(bisuiteSyncNotifications)
      .where(and(
        isNotNull(bisuiteSyncNotifications.readAt),
        lt(bisuiteSyncNotifications.readAt, olderThan),
      ))
      .returning({ id: bisuiteSyncNotifications.id });
    return { deleted: result.length };
  }
}

export const storage = new DatabaseStorage();
