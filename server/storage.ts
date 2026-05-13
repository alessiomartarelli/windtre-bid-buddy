import { db } from "./db";
import { profiles, organizations, preventivi, organizationConfig, passwordResetTokens, pdvConfigurations, systemConfig, bisuiteSales, garaConfig, drmsUploads, bisuiteSyncNotifications, type Profile, type Organization, type Preventivo, type OrganizationConfig, type PasswordResetToken, type PdvConfiguration, type InsertPdvConfiguration, type InsertProfile, type InsertOrganization, type InsertPreventivo, type SystemConfig, type BisuiteSale, type InsertBisuiteSale, type GaraConfig, type DrmsUpload, type InsertDrmsUpload, type BisuiteSyncNotification, type InsertBisuiteSyncNotification } from "@shared/schema";
import { eq, desc, and, isNull, isNotNull, lt, gte, lte, sql } from "drizzle-orm";

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

  // Password Reset Tokens
  createPasswordResetToken(email: string, token: string, expiresAt: Date): Promise<PasswordResetToken>;
  getValidResetToken(token: string): Promise<PasswordResetToken | undefined>;
  markTokenUsed(token: string): Promise<void>;

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
