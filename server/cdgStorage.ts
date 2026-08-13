import { db } from "./db";
import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import {
  cdgRagioniSociali, cdgCategorie, cdgFornitori, cdgSpese, cdgPdvManuali,
  type CdgRagioneSociale, type InsertCdgRagioneSociale,
  type CdgCategoria, type InsertCdgCategoria,
  type CdgFornitore, type InsertCdgFornitore,
  type CdgSpesa, type InsertCdgSpesa,
  type CdgPdvManuale, type InsertCdgPdvManuale,
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
    // spese (single-RS string) aggiorna `ragione_sociale`.
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
        await tx.update(cdgSpese).set({ ragioneSociale: newName })
          .where(and(eq(cdgSpese.organizationId, orgId), eq(cdgSpese.ragioneSociale, oldName)));
        await tx.execute(sql`
          UPDATE cdg_pdv_manuali SET ragione_sociale = ${newName}
           WHERE organization_id = ${orgId} AND ragione_sociale = ${oldName}
        `);
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
  async getCategoriaUsage(id: string, orgId: string): Promise<{ speseCount: number; ragioniSocialiUsate: string[] }> {
    const rows = await db.execute(sql`
      SELECT COUNT(*)::int AS cnt,
             COALESCE(ARRAY_AGG(DISTINCT ragione_sociale) FILTER (WHERE ragione_sociale IS NOT NULL), ARRAY[]::text[]) AS rs
        FROM cdg_spese
       WHERE organization_id = ${orgId}
         AND categoria_id = ${id}
    `);
    const r = (rows as unknown as { rows: Array<{ cnt: number; rs: string[] }> }).rows?.[0];
    return { speseCount: Number(r?.cnt || 0), ragioniSocialiUsate: r?.rs || [] };
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
  async getFornitoreUsage(id: string, orgId: string): Promise<{ speseCount: number; ragioniSocialiUsate: string[] }> {
    const rows = await db.execute(sql`
      SELECT COUNT(*)::int AS cnt,
             COALESCE(ARRAY_AGG(DISTINCT ragione_sociale) FILTER (WHERE ragione_sociale IS NOT NULL), ARRAY[]::text[]) AS rs
        FROM cdg_spese
       WHERE organization_id = ${orgId}
         AND fornitore_id = ${id}
    `);
    const r = (rows as unknown as { rows: Array<{ cnt: number; rs: string[] }> }).rows?.[0];
    return { speseCount: Number(r?.cnt || 0), ragioniSocialiUsate: r?.rs || [] };
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

  // PDV manuali (separati dai PDV ereditati da organization_config.puntiVendita)
  async listPdvManuali(orgId: string, rs?: string): Promise<CdgPdvManuale[]> {
    const conds = [eq(cdgPdvManuali.organizationId, orgId)];
    if (rs) conds.push(eq(cdgPdvManuali.ragioneSociale, rs));
    return db.select().from(cdgPdvManuali).where(and(...conds)).orderBy(cdgPdvManuali.nome);
  },
  async getPdvManuale(id: string, orgId: string): Promise<CdgPdvManuale | undefined> {
    const [r] = await db.select().from(cdgPdvManuali)
      .where(and(eq(cdgPdvManuali.id, id), eq(cdgPdvManuali.organizationId, orgId)));
    return r;
  },
  async createPdvManuale(data: InsertCdgPdvManuale): Promise<CdgPdvManuale> {
    const [r] = await db.insert(cdgPdvManuali).values(data).returning();
    return r;
  },
  async updatePdvManuale(id: string, orgId: string, updates: Partial<InsertCdgPdvManuale>): Promise<CdgPdvManuale | null> {
    const [r] = await db.update(cdgPdvManuali).set(updates)
      .where(and(eq(cdgPdvManuali.id, id), eq(cdgPdvManuali.organizationId, orgId)))
      .returning();
    return r || null;
  },
  async deletePdvManuale(id: string, orgId: string): Promise<void> {
    await db.delete(cdgPdvManuali)
      .where(and(eq(cdgPdvManuali.id, id), eq(cdgPdvManuali.organizationId, orgId)));
  },

  // Import massivo spese da Excel: crea in un'unica transazione le anagrafiche
  // mancanti (categorie/fornitori/PDV manuali), associa le esistenti alla RS
  // dove serve, poi inserisce le spese. O tutto o niente.
  async importSpese(
    orgId: string,
    createdBy: string,
    rows: Array<{
      rs: string;
      categoriaId: string | null; categoriaNew: string | null; categoriaAssocId: string | null;
      fornitoreId: string | null; fornitoreNew: string | null; fornitoreAssocId: string | null;
      pdvCodice: string | null; pdvNew: { codice: string; nome: string } | null;
      descrizione: string;
      imponibile: string; aliquotaIva: string; iva: string; importo: string;
      dataPagamento: string; meseCompetenza: string;
      metodoPagamento: string | null; note: string | null;
    }>,
  ): Promise<{ speseCreate: number; categorieCreate: number; fornitoriCreati: number; pdvCreati: number }> {
    return await db.transaction(async (tx) => {
      // 1) Categorie/fornitori nuovi: dedupe per nome (case-insensitive),
      //    RS = unione delle RS delle righe che li citano.
      const newCats = new Map<string, { nome: string; rs: Set<string> }>();
      const newForns = new Map<string, { nome: string; rs: Set<string> }>();
      const newPdvs = new Map<string, { rs: string; codice: string; nome: string }>();
      for (const r of rows) {
        if (r.categoriaNew) {
          const k = r.categoriaNew.toLowerCase();
          const e = newCats.get(k) || { nome: r.categoriaNew, rs: new Set<string>() };
          e.rs.add(r.rs); newCats.set(k, e);
        }
        if (r.fornitoreNew) {
          const k = r.fornitoreNew.toLowerCase();
          const e = newForns.get(k) || { nome: r.fornitoreNew, rs: new Set<string>() };
          e.rs.add(r.rs); newForns.set(k, e);
        }
        if (r.pdvNew) newPdvs.set(`${r.rs}||${r.pdvNew.codice}`, { rs: r.rs, ...r.pdvNew });
      }
      // Insert conflict-safe: se un'altra sessione ha creato la stessa voce
      // nel frattempo (unique org+nome), riusa l'esistente e associa le RS.
      const catIdByLower = new Map<string, string>();
      for (const e of Array.from(newCats.values())) {
        const [c] = await tx.insert(cdgCategorie)
          .values({ organizationId: orgId, nome: e.nome, ragioniSociali: Array.from(e.rs) })
          .onConflictDoNothing()
          .returning();
        let id = c?.id;
        if (!id) {
          const [existing] = await tx.select().from(cdgCategorie)
            .where(and(eq(cdgCategorie.organizationId, orgId), eq(cdgCategorie.nome, e.nome)));
          if (!existing) throw new Error(`Categoria "${e.nome}" non creabile`);
          id = existing.id;
          for (const rs of Array.from(e.rs)) {
            await tx.execute(sql`UPDATE cdg_categorie SET ragioni_sociali = array_append(ragioni_sociali, ${rs}) WHERE id = ${id} AND NOT (${rs} = ANY(ragioni_sociali))`);
          }
        }
        catIdByLower.set(e.nome.toLowerCase(), id);
      }
      const fornIdByLower = new Map<string, string>();
      for (const e of Array.from(newForns.values())) {
        const [f] = await tx.insert(cdgFornitori)
          .values({ organizationId: orgId, nome: e.nome, ragioniSociali: Array.from(e.rs) })
          .onConflictDoNothing()
          .returning();
        let id = f?.id;
        if (!id) {
          const [existing] = await tx.select().from(cdgFornitori)
            .where(and(eq(cdgFornitori.organizationId, orgId), eq(cdgFornitori.nome, e.nome)));
          if (!existing) throw new Error(`Fornitore "${e.nome}" non creabile`);
          id = existing.id;
          for (const rs of Array.from(e.rs)) {
            await tx.execute(sql`UPDATE cdg_fornitori SET ragioni_sociali = array_append(ragioni_sociali, ${rs}) WHERE id = ${id} AND NOT (${rs} = ANY(ragioni_sociali))`);
          }
        }
        fornIdByLower.set(e.nome.toLowerCase(), id);
      }
      // 2) Associazioni RS mancanti su anagrafiche esistenti (idempotente).
      const assocCat = new Map<string, Set<string>>();
      const assocForn = new Map<string, Set<string>>();
      for (const r of rows) {
        if (r.categoriaAssocId) (assocCat.get(r.categoriaAssocId) || assocCat.set(r.categoriaAssocId, new Set()).get(r.categoriaAssocId)!).add(r.rs);
        if (r.fornitoreAssocId) (assocForn.get(r.fornitoreAssocId) || assocForn.set(r.fornitoreAssocId, new Set()).get(r.fornitoreAssocId)!).add(r.rs);
      }
      for (const [id, rsSet] of Array.from(assocCat.entries())) for (const rs of Array.from(rsSet)) {
        await tx.execute(sql`UPDATE cdg_categorie SET ragioni_sociali = array_append(ragioni_sociali, ${rs}) WHERE id = ${id} AND organization_id = ${orgId} AND NOT (${rs} = ANY(ragioni_sociali))`);
      }
      for (const [id, rsSet] of Array.from(assocForn.entries())) for (const rs of Array.from(rsSet)) {
        await tx.execute(sql`UPDATE cdg_fornitori SET ragioni_sociali = array_append(ragioni_sociali, ${rs}) WHERE id = ${id} AND organization_id = ${orgId} AND NOT (${rs} = ANY(ragioni_sociali))`);
      }
      // 3) PDV manuali nuovi (conflict-safe: riusa se già creato altrove).
      for (const p of Array.from(newPdvs.values())) {
        await tx.insert(cdgPdvManuali)
          .values({ organizationId: orgId, ragioneSociale: p.rs, codice: p.codice, nome: p.nome })
          .onConflictDoNothing();
      }
      // 4) Spese. Protezione da doppio import (retry dello stesso file):
      //    una riga identica già presente (stessa RS, descrizione, importo e
      //    data pagamento) viene saltata e conteggiata come duplicato.
      let duplicati = 0;
      let inserite = 0;
      for (const r of rows) {
        const categoriaId = r.categoriaId ?? (r.categoriaNew ? catIdByLower.get(r.categoriaNew.toLowerCase()) ?? null : null);
        const fornitoreId = r.fornitoreId ?? (r.fornitoreNew ? fornIdByLower.get(r.fornitoreNew.toLowerCase()) ?? null : null);
        const dup = await tx.execute(sql`
          SELECT 1 FROM cdg_spese
           WHERE organization_id = ${orgId}
             AND ragione_sociale = ${r.rs}
             AND descrizione = ${r.descrizione}
             AND importo = ${r.importo}
             AND data_pagamento = ${r.dataPagamento}
             AND mese_competenza = ${r.meseCompetenza}
             AND imponibile IS NOT DISTINCT FROM ${r.imponibile}::numeric
             AND aliquota_iva IS NOT DISTINCT FROM ${r.aliquotaIva}::numeric
             AND pdv_codice IS NOT DISTINCT FROM ${r.pdvCodice}
             AND categoria_id IS NOT DISTINCT FROM ${categoriaId}
             AND fornitore_id IS NOT DISTINCT FROM ${fornitoreId}
             AND metodo_pagamento IS NOT DISTINCT FROM ${r.metodoPagamento}
             AND note IS NOT DISTINCT FROM ${r.note}
           LIMIT 1
        `);
        if ((dup as unknown as { rows?: unknown[] }).rows?.length) { duplicati += 1; continue; }
        inserite += 1;
        await tx.insert(cdgSpese).values({
          organizationId: orgId,
          createdBy,
          ragioneSociale: r.rs,
          categoriaId,
          fornitoreId,
          pdvCodice: r.pdvCodice,
          descrizione: r.descrizione,
          imponibile: r.imponibile,
          aliquotaIva: r.aliquotaIva,
          iva: r.iva,
          importo: r.importo,
          dataPagamento: r.dataPagamento,
          meseCompetenza: r.meseCompetenza,
          metodoPagamento: r.metodoPagamento,
          note: r.note,
          ricorrente: false,
        });
      }
      return {
        speseCreate: inserite,
        duplicati,
        categorieCreate: newCats.size,
        fornitoriCreati: newForns.size,
        pdvCreati: newPdvs.size,
      };
    });
  },
};
