import { pgTable, text, serial, varchar, timestamp, jsonb, index } from "drizzle-orm/pg-core";
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

export type PasswordResetToken = typeof passwordResetTokens.$inferSelect;

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];
