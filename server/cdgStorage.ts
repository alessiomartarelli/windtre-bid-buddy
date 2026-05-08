import { db } from "./db";
import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import {
  cdgRagioniSociali, cdgCategorie, cdgFornitori, cdgPdv, cdgSpese,
  type CdgRagioneSociale, type InsertCdgRagioneSociale,
  type CdgCategoria, type InsertCdgCategoria,
  type CdgFornitore, type InsertCdgFornitore,
  type CdgPdv,
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
    // Se cambia il nome, propaga il rename: per categorie/fornitori (multi-RS)
    // sostituisce il nome nell'array `ragioni_sociali` via array_replace; per
    // spese (single-RS string) aggiorna `ragione_sociale`. cdg_pdv è legacy
    // ma viene comunque aggiornata per coerenza dei dati storici.
    return await db.transaction(async (tx) => {
      const [existing] = await tx.select().from(cdgRagioniSociali)
        .where(and(eq(cdgRagioniSociali.id, id), eq(cdgRagioniSociali.organizationId, orgId)));
      if (!existing) return null;
      const [r] = await tx.update(cdgRagioniSociali).set(updates)
        .where(and(eq(cdgRagioniSociali.id, id), eq(cdgRagioniSociali.organizationId, orgId)))
        .returning();
      if (r && updates.nome && updates.nome !== existing.nome) {
        const oldName = existing.nome;
        const newName = updates.nome;
        await tx.execute(sql`
          UPDATE cdg_categorie
             SET ragioni_sociali = array_replace(ragioni_sociali, ${oldName}, ${newName}),
                 ragione_sociale = CASE WHEN ragione_sociale = ${oldName} THEN ${newName} ELSE ragione_sociale END
           WHERE organization_id = ${orgId}
             AND ${oldName} = ANY(ragioni_sociali)
        `);
        await tx.execute(sql`
          UPDATE cdg_fornitori
             SET ragioni_sociali = array_replace(ragioni_sociali, ${oldName}, ${newName}),
                 ragione_sociale = CASE WHEN ragione_sociale = ${oldName} THEN ${newName} ELSE ragione_sociale END
           WHERE organization_id = ${orgId}
             AND ${oldName} = ANY(ragioni_sociali)
        `);
        await tx.update(cdgPdv).set({ ragioneSociale: newName })
          .where(and(eq(cdgPdv.organizationId, orgId), eq(cdgPdv.ragioneSociale, oldName)));
        await tx.update(cdgSpese).set({ ragioneSociale: newName })
          .where(and(eq(cdgSpese.organizationId, orgId), eq(cdgSpese.ragioneSociale, oldName)));
      }
      return r || null;
    });
  },
  async getRagioneSociale(id: string, orgId: string): Promise<CdgRagioneSociale | undefined> {
    const [r] = await db.select().from(cdgRagioniSociali)
      .where(and(eq(cdgRagioniSociali.id, id), eq(cdgRagioniSociali.organizationId, orgId)));
    return r;
  },
  async deleteRagioneSociale(id: string, orgId: string): Promise<void> {
    // Elimina la RS e le spese collegate. Categorie/fornitori sono multi-RS:
    // viene rimosso il nome dalla lista, e se la lista resta vuota la voce
    // viene cancellata (era unicamente associata a quella RS).
    const [rs] = await db.select().from(cdgRagioniSociali)
      .where(and(eq(cdgRagioniSociali.id, id), eq(cdgRagioniSociali.organizationId, orgId)));
    if (!rs) return;
    await db.delete(cdgSpese)
      .where(and(eq(cdgSpese.organizationId, orgId), eq(cdgSpese.ragioneSociale, rs.nome)));
    await db.execute(sql`
      UPDATE cdg_categorie
         SET ragioni_sociali = array_remove(ragioni_sociali, ${rs.nome})
       WHERE organization_id = ${orgId}
         AND ${rs.nome} = ANY(ragioni_sociali)
    `);
    await db.execute(sql`
      DELETE FROM cdg_categorie
       WHERE organization_id = ${orgId}
         AND COALESCE(array_length(ragioni_sociali, 1), 0) = 0
    `);
    await db.execute(sql`
      UPDATE cdg_fornitori
         SET ragioni_sociali = array_remove(ragioni_sociali, ${rs.nome})
       WHERE organization_id = ${orgId}
         AND ${rs.nome} = ANY(ragioni_sociali)
    `);
    await db.execute(sql`
      DELETE FROM cdg_fornitori
       WHERE organization_id = ${orgId}
         AND COALESCE(array_length(ragioni_sociali, 1), 0) = 0
    `);
    await db.delete(cdgPdv)
      .where(and(eq(cdgPdv.organizationId, orgId), eq(cdgPdv.ragioneSociale, rs.nome)));
    await db.delete(cdgRagioniSociali)
      .where(and(eq(cdgRagioniSociali.id, id), eq(cdgRagioniSociali.organizationId, orgId)));
  },

  async getCategoria(id: string, orgId: string): Promise<CdgCategoria | undefined> {
    const [r] = await db.select().from(cdgCategorie)
      .where(and(eq(cdgCategorie.id, id), eq(cdgCategorie.organizationId, orgId)));
    return r;
  },
  async getFornitore(id: string, orgId: string): Promise<CdgFornitore | undefined> {
    const [r] = await db.select().from(cdgFornitori)
      .where(and(eq(cdgFornitori.id, id), eq(cdgFornitori.organizationId, orgId)));
    return r;
  },
  // Categorie (multi-RS). Filtro `rs`: ritorna voci la cui lista contiene rs.
  async listCategorie(orgId: string, rs?: string): Promise<CdgCategoria[]> {
    const conds = [eq(cdgCategorie.organizationId, orgId)];
    if (rs) conds.push(sql`${rs} = ANY(${cdgCategorie.ragioniSociali})`);
    return db.select().from(cdgCategorie).where(and(...conds)).orderBy(cdgCategorie.nome);
  },
  async createCategoria(data: InsertCdgCategoria): Promise<CdgCategoria> {
    const [r] = await db.insert(cdgCategorie).values(data).returning();
    return r;
  },
  // Pre-check friendly allineato all'unique index (organization_id, nome):
  // confronto case-sensitive (stesso comportamento del DB unique constraint)
  // indipendente dalle RS associate.
  async findCategoriaOverlap(orgId: string, nome: string, _ragioniSociali: string[], excludeId?: string): Promise<CdgCategoria | null> {
    const rows = await db.execute(sql`
      SELECT * FROM cdg_categorie
       WHERE organization_id = ${orgId}
         AND nome = ${nome}
         ${excludeId ? sql`AND id <> ${excludeId}` : sql``}
       LIMIT 1
    `);
    const r = (rows as unknown as { rows: CdgCategoria[] }).rows?.[0];
    return r || null;
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

  // Fornitori (multi-RS). Stessa logica delle categorie.
  async listFornitori(orgId: string, rs?: string): Promise<CdgFornitore[]> {
    const conds = [eq(cdgFornitori.organizationId, orgId)];
    if (rs) conds.push(sql`${rs} = ANY(${cdgFornitori.ragioniSociali})`);
    return db.select().from(cdgFornitori).where(and(...conds)).orderBy(cdgFornitori.nome);
  },
  async createFornitore(data: InsertCdgFornitore): Promise<CdgFornitore> {
    const [r] = await db.insert(cdgFornitori).values(data).returning();
    return r;
  },
  async findFornitoreOverlap(orgId: string, nome: string, _ragioniSociali: string[], excludeId?: string): Promise<CdgFornitore | null> {
    const rows = await db.execute(sql`
      SELECT * FROM cdg_fornitori
       WHERE organization_id = ${orgId}
         AND nome = ${nome}
         ${excludeId ? sql`AND id <> ${excludeId}` : sql``}
       LIMIT 1
    `);
    const r = (rows as unknown as { rows: CdgFornitore[] }).rows?.[0];
    return r || null;
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
