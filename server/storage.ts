import { db } from "./db";
import { profiles, organizations, preventivi, organizationConfig, passwordResetTokens, pdvConfigurations, systemConfig, bisuiteSales, garaConfig, drmsUploads, type Profile, type Organization, type Preventivo, type OrganizationConfig, type PasswordResetToken, type PdvConfiguration, type InsertPdvConfiguration, type InsertProfile, type InsertOrganization, type InsertPreventivo, type SystemConfig, type BisuiteSale, type InsertBisuiteSale, type GaraConfig, type DrmsUpload, type InsertDrmsUpload } from "@shared/schema";
import { eq, desc, and, isNull, gte, lte, sql } from "drizzle-orm";

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
  getPreventivi(orgId: string): Promise<Preventivo[]>;
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
  upsertSystemConfig(key: string, config: any, updatedBy: string): Promise<SystemConfig>;

  // BiSuite Sales
  upsertBisuiteSales(sales: InsertBisuiteSale[]): Promise<number>;
  getBisuiteSales(orgId: string, from?: Date, to?: Date, includeAnnullate?: boolean): Promise<BisuiteSale[]>;
  getBisuiteSalesByItalianMonth(orgId: string, year: number, month: number, includeAnnullate?: boolean): Promise<BisuiteSale[]>;
  getBisuiteSalesByItalianDateRange(orgId: string, fromYMD?: string, toYMD?: string, includeAnnullate?: boolean): Promise<BisuiteSale[]>;
  getBisuiteSale(id: string): Promise<BisuiteSale | undefined>;
  deleteBisuiteSalesByOrg(orgId: string): Promise<void>;

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
  async getPreventivi(orgId: string): Promise<Preventivo[]> {
    return await db.select().from(preventivi)
      .where(eq(preventivi.organizationId, orgId))
      .orderBy(desc(preventivi.updatedAt));
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

  async upsertSystemConfig(key: string, config: any, updatedBy: string): Promise<SystemConfig> {
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
  async upsertBisuiteSales(sales: InsertBisuiteSale[]): Promise<number> {
    if (sales.length === 0) return 0;
    let inserted = 0;
    for (const sale of sales) {
      await db.insert(bisuiteSales)
        .values(sale)
        .onConflictDoNothing();
      inserted++;
    }
    return inserted;
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
}

export const storage = new DatabaseStorage();
