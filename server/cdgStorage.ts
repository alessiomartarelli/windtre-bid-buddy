import { db } from "./db";
import { and, desc, eq, gte, lte } from "drizzle-orm";
import {
  cdgRagioniSociali, cdgCategorie, cdgFornitori, cdgPdv, cdgSpese,
  type CdgRagioneSociale, type InsertCdgRagioneSociale,
  type CdgCategoria, type InsertCdgCategoria,
  type CdgFornitore, type InsertCdgFornitore,
  type CdgPdv, type InsertCdgPdv,
  type CdgSpesa, type InsertCdgSpesa,
} from "@shared/schema";

export const cdgStorage = {
  // Ragioni Sociali
  async listRagioniSociali(orgId: string): Promise<CdgRagioneSociale[]> {
    return db.select().from(cdgRagioniSociali)
      .where(eq(cdgRagioniSociali.organizationId, orgId))
      .orderBy(cdgRagioniSociali.nome);
  },
  async createRagioneSociale(data: InsertCdgRagioneSociale): Promise<CdgRagioneSociale> {
    const [r] = await db.insert(cdgRagioniSociali).values(data).returning();
    return r;
  },
  async updateRagioneSociale(id: string, orgId: string, updates: Partial<InsertCdgRagioneSociale>): Promise<CdgRagioneSociale | null> {
    const [r] = await db.update(cdgRagioniSociali).set(updates)
      .where(and(eq(cdgRagioniSociali.id, id), eq(cdgRagioniSociali.organizationId, orgId)))
      .returning();
    return r || null;
  },
  async deleteRagioneSociale(id: string, orgId: string): Promise<void> {
    // Pulisci anagrafiche e spese collegate per nome RS (relazione "by-name")
    const [rs] = await db.select().from(cdgRagioniSociali)
      .where(and(eq(cdgRagioniSociali.id, id), eq(cdgRagioniSociali.organizationId, orgId)));
    if (!rs) return;
    await db.delete(cdgSpese)
      .where(and(eq(cdgSpese.organizationId, orgId), eq(cdgSpese.ragioneSociale, rs.nome)));
    await db.delete(cdgCategorie)
      .where(and(eq(cdgCategorie.organizationId, orgId), eq(cdgCategorie.ragioneSociale, rs.nome)));
    await db.delete(cdgFornitori)
      .where(and(eq(cdgFornitori.organizationId, orgId), eq(cdgFornitori.ragioneSociale, rs.nome)));
    await db.delete(cdgPdv)
      .where(and(eq(cdgPdv.organizationId, orgId), eq(cdgPdv.ragioneSociale, rs.nome)));
    await db.delete(cdgRagioniSociali)
      .where(and(eq(cdgRagioniSociali.id, id), eq(cdgRagioniSociali.organizationId, orgId)));
  },

  // Categorie
  async listCategorie(orgId: string, rs?: string): Promise<CdgCategoria[]> {
    const conds = [eq(cdgCategorie.organizationId, orgId)];
    if (rs) conds.push(eq(cdgCategorie.ragioneSociale, rs));
    return db.select().from(cdgCategorie).where(and(...conds)).orderBy(cdgCategorie.nome);
  },
  async createCategoria(data: InsertCdgCategoria): Promise<CdgCategoria> {
    const [r] = await db.insert(cdgCategorie).values(data).returning();
    return r;
  },
  async updateCategoria(id: string, orgId: string, updates: Partial<InsertCdgCategoria>): Promise<CdgCategoria | null> {
    const [r] = await db.update(cdgCategorie).set(updates)
      .where(and(eq(cdgCategorie.id, id), eq(cdgCategorie.organizationId, orgId)))
      .returning();
    return r || null;
  },
  async deleteCategoria(id: string, orgId: string): Promise<void> {
    await db.delete(cdgCategorie)
      .where(and(eq(cdgCategorie.id, id), eq(cdgCategorie.organizationId, orgId)));
  },

  // Fornitori
  async listFornitori(orgId: string, rs?: string): Promise<CdgFornitore[]> {
    const conds = [eq(cdgFornitori.organizationId, orgId)];
    if (rs) conds.push(eq(cdgFornitori.ragioneSociale, rs));
    return db.select().from(cdgFornitori).where(and(...conds)).orderBy(cdgFornitori.nome);
  },
  async createFornitore(data: InsertCdgFornitore): Promise<CdgFornitore> {
    const [r] = await db.insert(cdgFornitori).values(data).returning();
    return r;
  },
  async updateFornitore(id: string, orgId: string, updates: Partial<InsertCdgFornitore>): Promise<CdgFornitore | null> {
    const [r] = await db.update(cdgFornitori).set(updates)
      .where(and(eq(cdgFornitori.id, id), eq(cdgFornitori.organizationId, orgId)))
      .returning();
    return r || null;
  },
  async deleteFornitore(id: string, orgId: string): Promise<void> {
    await db.delete(cdgFornitori)
      .where(and(eq(cdgFornitori.id, id), eq(cdgFornitori.organizationId, orgId)));
  },

  // PDV
  async listPdv(orgId: string, rs?: string): Promise<CdgPdv[]> {
    const conds = [eq(cdgPdv.organizationId, orgId)];
    if (rs) conds.push(eq(cdgPdv.ragioneSociale, rs));
    return db.select().from(cdgPdv).where(and(...conds)).orderBy(cdgPdv.nome);
  },
  async createPdv(data: InsertCdgPdv): Promise<CdgPdv> {
    const [r] = await db.insert(cdgPdv).values(data).returning();
    return r;
  },
  async updatePdv(id: string, orgId: string, updates: Partial<InsertCdgPdv>): Promise<CdgPdv | null> {
    const [r] = await db.update(cdgPdv).set(updates)
      .where(and(eq(cdgPdv.id, id), eq(cdgPdv.organizationId, orgId)))
      .returning();
    return r || null;
  },
  async deletePdv(id: string, orgId: string): Promise<void> {
    await db.delete(cdgPdv)
      .where(and(eq(cdgPdv.id, id), eq(cdgPdv.organizationId, orgId)));
  },

  // Spese
  async listSpese(orgId: string, opts: { rs?: string; from?: string; to?: string; meseCompetenza?: string } = {}): Promise<CdgSpesa[]> {
    const conds = [eq(cdgSpese.organizationId, orgId)];
    if (opts.rs) conds.push(eq(cdgSpese.ragioneSociale, opts.rs));
    if (opts.from) conds.push(gte(cdgSpese.dataPagamento, opts.from));
    if (opts.to) conds.push(lte(cdgSpese.dataPagamento, opts.to));
    if (opts.meseCompetenza) conds.push(eq(cdgSpese.meseCompetenza, opts.meseCompetenza));
    return db.select().from(cdgSpese).where(and(...conds)).orderBy(desc(cdgSpese.dataPagamento));
  },
  async getSpesa(id: string, orgId: string): Promise<CdgSpesa | undefined> {
    const [r] = await db.select().from(cdgSpese)
      .where(and(eq(cdgSpese.id, id), eq(cdgSpese.organizationId, orgId)));
    return r;
  },
  async createSpesa(data: InsertCdgSpesa): Promise<CdgSpesa> {
    const [r] = await db.insert(cdgSpese).values(data).returning();
    return r;
  },
  async updateSpesa(id: string, orgId: string, updates: Partial<InsertCdgSpesa>): Promise<CdgSpesa | null> {
    const [r] = await db.update(cdgSpese)
      .set({ ...updates, updatedAt: new Date() })
      .where(and(eq(cdgSpese.id, id), eq(cdgSpese.organizationId, orgId)))
      .returning();
    return r || null;
  },
  async deleteSpesa(id: string, orgId: string): Promise<void> {
    await db.delete(cdgSpese)
      .where(and(eq(cdgSpese.id, id), eq(cdgSpese.organizationId, orgId)));
  },
};
