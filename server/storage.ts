import { db } from "./db";
import { profiles, organizations, preventivi, organizationConfig, passwordResetTokens, pdvConfigurations, systemConfig, type Profile, type Organization, type Preventivo, type OrganizationConfig, type PasswordResetToken, type PdvConfiguration, type InsertPdvConfiguration, type InsertProfile, type InsertOrganization, type InsertPreventivo, type SystemConfig } from "@shared/schema";
import { eq, desc, and, isNull } from "drizzle-orm";

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
