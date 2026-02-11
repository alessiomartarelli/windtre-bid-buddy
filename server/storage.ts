import { db } from "./db";
import { profiles, organizations, preventivi, organizationConfig, type Profile, type Organization, type Preventivo, type OrganizationConfig, type InsertProfile, type InsertOrganization, type InsertPreventivo } from "@shared/schema";
import { eq, desc, and } from "drizzle-orm";

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
}

export const storage = new DatabaseStorage();
