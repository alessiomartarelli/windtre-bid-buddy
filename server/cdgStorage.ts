import { db } from "./db";
import { and, desc, eq, gte, isNull, lte, or, sql } from "drizzle-orm";
import {
  cdgRagioniSociali, cdgCategorie, cdgFornitori, cdgSpese, cdgPdvManuali,
  type CdgRagioneSociale, type InsertCdgRagioneSociale,
  type CdgCategoria, type InsertCdgCategoria,
  type CdgFornitore, type InsertCdgFornitore,
  type CdgSpesa, type InsertCdgSpesa,
  type CdgPdvManuale, type InsertCdgPdvManuale,
} from "@shared/schema";

// Task #345: cdg_ragioni_sociali è il registro canonico delle RS. Le tabelle
// figlie (spese, pdv manuali, categorie, fornitori) referenziano le RS per ID
// (`ragione_sociale_id` / `ragione_sociale_ids`); le colonne nome restano come
// cache denormalizzata per back-compat, ma in LETTURA il nome viene sempre
// risolto dal registro. Le rinomine aggiornano il registro e sincronizzano la
// cache con UPDATE chiavati per ID (impossibile "mancare" righe come accadeva
// con la propagazione per nome → RS fantasma).

// Esecutore generico: db oppure una transaction. Le API drizzle usate qui
// (execute/select/insert/update/delete) sono identiche nei due casi.
type Dbx = Pick<typeof db, "execute" | "select" | "insert" | "update" | "delete">;

function rowsOf<T>(res: unknown): T[] {
  return ((res as { rows?: T[] }).rows || []) as T[];
}

/**
 * Garantisce che esista una riga registro per (orgId, nome) e ne ritorna l'id.
 * Se la riga non esiste viene creata con `origine` indicata (default "auto":
 * anchor puro portatore di id, non mostrato come RS manuale in UI).
 */
async function ensureRsAnchor(dbx: Dbx, orgId: string, nome: string, origine: "auto" | "manuale" = "auto"): Promise<string> {
  const n = String(nome).trim();
  const ins = await dbx.execute(sql`
    INSERT INTO cdg_ragioni_sociali (organization_id, nome, origine)
    VALUES (${orgId}, ${n}, ${origine})
    ON CONFLICT (organization_id, nome) DO NOTHING
    RETURNING id
  `);
  const created = rowsOf<{ id: string }>(ins)[0];
  if (created) return created.id;
  const sel = await dbx.execute(sql`
    SELECT id FROM cdg_ragioni_sociali WHERE organization_id = ${orgId} AND nome = ${n}
  `);
  const found = rowsOf<{ id: string }>(sel)[0];
  if (!found) throw new Error(`ensureRsAnchor: RS "${n}" non trovata dopo upsert`);
  return found.id;
}

async function ensureRsAnchors(dbx: Dbx, orgId: string, nomi: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  for (const nome of nomi) {
    const n = String(nome).trim();
    if (!n || map.has(n)) continue;
    map.set(n, await ensureRsAnchor(dbx, orgId, n));
  }
  return map;
}

/** Mappa id → nome corrente dal registro (per risoluzione in lettura). */
async function getRsNameMap(orgId: string): Promise<Map<string, string>> {
  const res = await db.execute(sql`
    SELECT id, nome FROM cdg_ragioni_sociali WHERE organization_id = ${orgId}
  `);
  return new Map(rowsOf<{ id: string; nome: string }>(res).map(r => [r.id, r.nome]));
}

async function getRsIdByName(orgId: string, nome: string): Promise<string | null> {
  const res = await db.execute(sql`
    SELECT id FROM cdg_ragioni_sociali WHERE organization_id = ${orgId} AND nome = ${nome}
  `);
  return rowsOf<{ id: string }>(res)[0]?.id || null;
}

// Risoluzione in lettura: il nome servito è quello corrente del registro.
function resolveSingleRs<T extends { ragioneSociale: string | null; ragioneSocialeId?: string | null }>(rows: T[], map: Map<string, string>): T[] {
  return rows.map(r => {
    const nome = r.ragioneSocialeId ? map.get(r.ragioneSocialeId) : undefined;
    return nome && nome !== r.ragioneSociale ? { ...r, ragioneSociale: nome } : r;
  });
}

function resolveMultiRs<T extends { ragioniSociali: string[]; ragioneSocialeIds?: string[] }>(rows: T[], map: Map<string, string>): T[] {
  return rows.map(r => {
    const ids = r.ragioneSocialeIds || [];
    if (ids.length === 0) return r;
    const nomi = ids.map(id => map.get(id)).filter((n): n is string => !!n);
    if (nomi.length === 0) return r; // anchor spariti: fallback ai nomi salvati
    // Gli id sono canonici (rinomine), ma NON devono far sparire associazioni
    // salvate solo per nome (id non ancora backfillato, es. RS ereditate):
    // tieni ogni nome salvato il cui id di registro non è già coperto dagli
    // id della riga (o che non è nel registro affatto).
    const idByName = new Map(Array.from(map.entries()).map(([id, nome]) => [nome, id]));
    const idSet = new Set(ids);
    const nomiSet = new Set(nomi);
    for (const nome of r.ragioniSociali || []) {
      const regId = idByName.get(nome);
      if ((!regId || !idSet.has(regId)) && !nomiSet.has(nome)) nomiSet.add(nome);
    }
    const out = Array.from(nomiSet).sort((a, b) => a.localeCompare(b, "it"));
    return { ...r, ragioniSociali: out };
  });
}

/**
 * Sincronizza la cache denormalizzata dei nomi dopo la rinomina della RS
 * `rsId` (oldName → newName). Chiavata per ID (più fallback per nome per
 * eventuali righe legacy non ancora collegate): nessuna riga può sfuggire.
 */
async function syncRsDenorm(dbx: Dbx, orgId: string, rsId: string, oldName: string, newName: string): Promise<void> {
  await dbx.execute(sql`
    UPDATE cdg_spese
       SET ragione_sociale = ${newName}, ragione_sociale_id = ${rsId}
     WHERE organization_id = ${orgId}
       AND (ragione_sociale_id = ${rsId}
            OR (ragione_sociale_id IS NULL AND ragione_sociale = ${oldName}))
  `);
  await dbx.execute(sql`
    UPDATE cdg_pdv_manuali
       SET ragione_sociale = ${newName}, ragione_sociale_id = ${rsId}
     WHERE organization_id = ${orgId}
       AND (ragione_sociale_id = ${rsId}
            OR (ragione_sociale_id IS NULL AND ragione_sociale = ${oldName}))
  `);
  // Multi-RS: per le righe collegate per id ricostruisce l'intero array nomi
  // dal registro (già rinominato); per le righe legacy solo-name fa replace.
  for (const table of ["cdg_categorie", "cdg_fornitori"] as const) {
    await dbx.execute(sql`
      UPDATE ${sql.raw(table)} c
         SET ragioni_sociali = (
               SELECT COALESCE(array_agg(r.nome ORDER BY r.nome), ARRAY[]::text[])
                 FROM cdg_ragioni_sociali r
                WHERE r.id = ANY(c.ragione_sociale_ids)),
             ragione_sociale = CASE WHEN c.ragione_sociale = ${oldName} THEN ${newName} ELSE c.ragione_sociale END
       WHERE c.organization_id = ${orgId}
         AND ${rsId} = ANY(c.ragione_sociale_ids)
    `);
    await dbx.execute(sql`
      UPDATE ${sql.raw(table)} c
         SET ragioni_sociali = array_replace(ragioni_sociali, ${oldName}, ${newName}),
             ragione_sociale = CASE WHEN c.ragione_sociale = ${oldName} THEN ${newName} ELSE c.ragione_sociale END
       WHERE c.organization_id = ${orgId}
         AND NOT (${rsId} = ANY(c.ragione_sociale_ids))
         AND ${oldName} = ANY(c.ragioni_sociali)
    `);
  }
}

export const cdgStorage = {
  // === Registro RS ===
  /** Espone l'upsert dell'anchor (usato dalle route per collegare per id). */
  async ensureRsId(orgId: string, nome: string, origine: "auto" | "manuale" = "auto"): Promise<string> {
    return ensureRsAnchor(db, orgId, nome, origine);
  },
  async getRsIdByName(orgId: string, nome: string): Promise<string | null> {
    return getRsIdByName(orgId, nome);
  },
  /**
   * Rinomina una RS per nome (usata dai percorsi "struttura"/"ereditata"):
   * garantisce l'anchor, aggiorna il registro e sincronizza le tabelle figlie
   * per ID. Ritorna l'id dell'anchor.
   */
  async renameRsByName(orgId: string, oldName: string, newName: string): Promise<string> {
    return await db.transaction(async (tx) => {
      const rsId = await ensureRsAnchor(tx, orgId, oldName);
      // Se esiste già un anchor con il nuovo nome (es. residuo di una vecchia
      // rinomina parziale), MERGE: ripunta i figli sull'anchor esistente e
      // elimina quello vecchio, invece di fallire sull'unique (org, nome).
      const dupRes = await tx.execute(sql`
        SELECT id FROM cdg_ragioni_sociali
         WHERE organization_id = ${orgId} AND nome = ${newName} AND id <> ${rsId}
      `);
      const dup = rowsOf<{ id: string }>(dupRes)[0];
      if (dup) {
        await tx.execute(sql`
          UPDATE cdg_spese SET ragione_sociale_id = ${dup.id}
           WHERE organization_id = ${orgId} AND ragione_sociale_id = ${rsId}
        `);
        await tx.execute(sql`
          UPDATE cdg_pdv_manuali SET ragione_sociale_id = ${dup.id}
           WHERE organization_id = ${orgId} AND ragione_sociale_id = ${rsId}
        `);
        for (const table of ["cdg_categorie", "cdg_fornitori"] as const) {
          await tx.execute(sql`
            UPDATE ${sql.raw(table)}
               SET ragione_sociale_ids = array_replace(ragione_sociale_ids, ${rsId}, ${dup.id})
             WHERE organization_id = ${orgId} AND ${rsId} = ANY(ragione_sociale_ids)
          `);
        }
        await tx.execute(sql`
          DELETE FROM cdg_ragioni_sociali WHERE id = ${rsId} AND organization_id = ${orgId}
        `);
        await syncRsDenorm(tx, orgId, dup.id, oldName, newName);
        return dup.id;
      }
      await tx.execute(sql`
        UPDATE cdg_ragioni_sociali SET nome = ${newName}
         WHERE id = ${rsId} AND organization_id = ${orgId}
      `);
      await syncRsDenorm(tx, orgId, rsId, oldName, newName);
      return rsId;
    });
  },

  // Ragioni Sociali (manuali). `origine='auto'` = anchor per RS ereditate:
  // escluse di default dalla lista (non sono voci manuali).
  async listRagioniSociali(orgId: string, opts: { includeAuto?: boolean } = {}): Promise<CdgRagioneSociale[]> {
    const conds = [eq(cdgRagioniSociali.organizationId, orgId)];
    if (!opts.includeAuto) conds.push(eq(cdgRagioniSociali.origine, "manuale"));
    return db.select().from(cdgRagioniSociali)
      .where(and(...conds))
      .orderBy(cdgRagioniSociali.nome);
  },
  async createRagioneSociale(data: InsertCdgRagioneSociale): Promise<CdgRagioneSociale> {
    // Se esiste già un anchor "auto" con lo stesso nome lo promuove a manuale
    // (l'utente non vede gli anchor: per lui la RS non esisteva). Se esiste
    // già una RS manuale, propaga l'unique violation (la route risponde 409).
    const res = await db.execute(sql`
      INSERT INTO cdg_ragioni_sociali (organization_id, nome, partita_iva, note, origine)
      VALUES (${data.organizationId}, ${data.nome}, ${data.partitaIva ?? null}, ${data.note ?? null}, 'manuale')
      ON CONFLICT (organization_id, nome) DO UPDATE
        SET origine = 'manuale',
            partita_iva = EXCLUDED.partita_iva,
            note = EXCLUDED.note
        WHERE cdg_ragioni_sociali.origine = 'auto'
      RETURNING *
    `);
    const r = rowsOf<Record<string, unknown>>(res)[0];
    if (!r) {
      const err = new Error("Ragione Sociale già esistente") as Error & { code: string };
      err.code = "23505";
      throw err;
    }
    return {
      id: r.id, organizationId: r.organization_id, nome: r.nome,
      partitaIva: r.partita_iva, note: r.note, origine: r.origine, createdAt: r.created_at,
    } as CdgRagioneSociale;
  },
  async updateRagioneSociale(id: string, orgId: string, updates: Partial<InsertCdgRagioneSociale>): Promise<CdgRagioneSociale | null> {
    // Se cambia il nome: aggiorna SOLO il registro e sincronizza la cache
    // denormalizzata per ID (Task #345) — niente più propagazione per nome.
    return await db.transaction(async (tx) => {
      const [existing] = await tx.select().from(cdgRagioniSociali)
        .where(and(eq(cdgRagioniSociali.id, id), eq(cdgRagioniSociali.organizationId, orgId)));
      if (!existing) return null;
      const [r] = await tx.update(cdgRagioniSociali).set(updates)
        .where(and(eq(cdgRagioniSociali.id, id), eq(cdgRagioniSociali.organizationId, orgId)))
        .returning();
      if (r && updates.nome && updates.nome !== existing.nome) {
        await syncRsDenorm(tx, orgId, id, existing.nome, updates.nome);
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
    // Elimina la RS e le spese/PDV collegati (per ID, con fallback per nome
    // sulle righe legacy). Categorie/fornitori sono multi-RS: la RS viene
    // rimossa dalle liste, e se la lista resta vuota la voce viene cancellata.
    const [rs] = await db.select().from(cdgRagioniSociali)
      .where(and(eq(cdgRagioniSociali.id, id), eq(cdgRagioniSociali.organizationId, orgId)));
    if (!rs) return;
    await db.execute(sql`
      DELETE FROM cdg_spese
       WHERE organization_id = ${orgId}
         AND (ragione_sociale_id = ${id}
              OR (ragione_sociale_id IS NULL AND ragione_sociale = ${rs.nome}))
    `);
    await db.execute(sql`
      DELETE FROM cdg_pdv_manuali
       WHERE organization_id = ${orgId}
         AND (ragione_sociale_id = ${id}
              OR (ragione_sociale_id IS NULL AND ragione_sociale = ${rs.nome}))
    `);
    for (const table of ["cdg_categorie", "cdg_fornitori"] as const) {
      await db.execute(sql`
        UPDATE ${sql.raw(table)}
           SET ragione_sociale_ids = array_remove(ragione_sociale_ids, ${id}),
               ragioni_sociali = array_remove(ragioni_sociali, ${rs.nome})
         WHERE organization_id = ${orgId}
           AND (${id} = ANY(ragione_sociale_ids) OR ${rs.nome} = ANY(ragioni_sociali))
      `);
      await db.execute(sql`
        DELETE FROM ${sql.raw(table)}
         WHERE organization_id = ${orgId}
           AND COALESCE(array_length(ragioni_sociali, 1), 0) = 0
           AND COALESCE(array_length(ragione_sociale_ids, 1), 0) = 0
      `);
    }
    await db.delete(cdgRagioniSociali)
      .where(and(eq(cdgRagioniSociali.id, id), eq(cdgRagioniSociali.organizationId, orgId)));
  },

  async getCategoria(id: string, orgId: string): Promise<CdgCategoria | undefined> {
    const [r] = await db.select().from(cdgCategorie)
      .where(and(eq(cdgCategorie.id, id), eq(cdgCategorie.organizationId, orgId)));
    if (!r) return undefined;
    return resolveMultiRs([r], await getRsNameMap(orgId))[0];
  },
  async getFornitore(id: string, orgId: string): Promise<CdgFornitore | undefined> {
    const [r] = await db.select().from(cdgFornitori)
      .where(and(eq(cdgFornitori.id, id), eq(cdgFornitori.organizationId, orgId)));
    if (!r) return undefined;
    return resolveMultiRs([r], await getRsNameMap(orgId))[0];
  },
  // Categorie (multi-RS). Filtro `rs` (nome): match per id registro o nome.
  async listCategorie(orgId: string, rs?: string): Promise<CdgCategoria[]> {
    const conds = [eq(cdgCategorie.organizationId, orgId)];
    if (rs) {
      const rsId = await getRsIdByName(orgId, rs);
      conds.push(rsId
        ? sql`(${rsId} = ANY(${cdgCategorie.ragioneSocialeIds}) OR ${rs} = ANY(${cdgCategorie.ragioniSociali}))`
        : sql`${rs} = ANY(${cdgCategorie.ragioniSociali})`);
    }
    const rows = await db.select().from(cdgCategorie).where(and(...conds)).orderBy(cdgCategorie.nome);
    return resolveMultiRs(rows, await getRsNameMap(orgId));
  },
  async createCategoria(data: InsertCdgCategoria): Promise<CdgCategoria> {
    const ids = await ensureRsAnchors(db, data.organizationId, data.ragioniSociali || []);
    const [r] = await db.insert(cdgCategorie)
      .values({ ...data, ragioneSocialeIds: Array.from(ids.values()) })
      .returning();
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
    const r = rowsOf<CdgCategoria>(rows)[0];
    return r || null;
  },
  async updateCategoria(id: string, orgId: string, updates: Partial<InsertCdgCategoria>): Promise<CdgCategoria | null> {
    const set: Partial<InsertCdgCategoria> = { ...updates };
    if (Array.isArray(updates.ragioniSociali)) {
      const ids = await ensureRsAnchors(db, orgId, updates.ragioniSociali);
      set.ragioneSocialeIds = Array.from(ids.values());
    }
    const [r] = await db.update(cdgCategorie).set(set)
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
             COALESCE(ARRAY_AGG(DISTINCT COALESCE(r.nome, sp.ragione_sociale)) FILTER (WHERE COALESCE(r.nome, sp.ragione_sociale) IS NOT NULL), ARRAY[]::text[]) AS rs
        FROM cdg_spese sp
        LEFT JOIN cdg_ragioni_sociali r ON r.id = sp.ragione_sociale_id
       WHERE sp.organization_id = ${orgId}
         AND sp.categoria_id = ${id}
    `);
    const r = rowsOf<{ cnt: number; rs: string[] }>(rows)[0];
    return { speseCount: Number(r?.cnt || 0), ragioniSocialiUsate: r?.rs || [] };
  },

  // Fornitori (multi-RS). Stessa logica delle categorie.
  async listFornitori(orgId: string, rs?: string): Promise<CdgFornitore[]> {
    const conds = [eq(cdgFornitori.organizationId, orgId)];
    if (rs) {
      const rsId = await getRsIdByName(orgId, rs);
      conds.push(rsId
        ? sql`(${rsId} = ANY(${cdgFornitori.ragioneSocialeIds}) OR ${rs} = ANY(${cdgFornitori.ragioniSociali}))`
        : sql`${rs} = ANY(${cdgFornitori.ragioniSociali})`);
    }
    const rows = await db.select().from(cdgFornitori).where(and(...conds)).orderBy(cdgFornitori.nome);
    return resolveMultiRs(rows, await getRsNameMap(orgId));
  },
  async createFornitore(data: InsertCdgFornitore): Promise<CdgFornitore> {
    const ids = await ensureRsAnchors(db, data.organizationId, data.ragioniSociali || []);
    const [r] = await db.insert(cdgFornitori)
      .values({ ...data, ragioneSocialeIds: Array.from(ids.values()) })
      .returning();
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
    const r = rowsOf<CdgFornitore>(rows)[0];
    return r || null;
  },
  async updateFornitore(id: string, orgId: string, updates: Partial<InsertCdgFornitore>): Promise<CdgFornitore | null> {
    const set: Partial<InsertCdgFornitore> = { ...updates };
    if (Array.isArray(updates.ragioniSociali)) {
      const ids = await ensureRsAnchors(db, orgId, updates.ragioniSociali);
      set.ragioneSocialeIds = Array.from(ids.values());
    }
    const [r] = await db.update(cdgFornitori).set(set)
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
             COALESCE(ARRAY_AGG(DISTINCT COALESCE(r.nome, sp.ragione_sociale)) FILTER (WHERE COALESCE(r.nome, sp.ragione_sociale) IS NOT NULL), ARRAY[]::text[]) AS rs
        FROM cdg_spese sp
        LEFT JOIN cdg_ragioni_sociali r ON r.id = sp.ragione_sociale_id
       WHERE sp.organization_id = ${orgId}
         AND sp.fornitore_id = ${id}
    `);
    const r = rowsOf<{ cnt: number; rs: string[] }>(rows)[0];
    return { speseCount: Number(r?.cnt || 0), ragioniSocialiUsate: r?.rs || [] };
  },

  // Spese
  async listSpese(orgId: string, opts: { rs?: string; from?: string; to?: string; meseCompetenza?: string } = {}): Promise<CdgSpesa[]> {
    const conds = [eq(cdgSpese.organizationId, orgId)];
    if (opts.rs) {
      const rsId = await getRsIdByName(orgId, opts.rs);
      conds.push(rsId
        ? or(
            eq(cdgSpese.ragioneSocialeId, rsId),
            and(isNull(cdgSpese.ragioneSocialeId), eq(cdgSpese.ragioneSociale, opts.rs)),
          )!
        : eq(cdgSpese.ragioneSociale, opts.rs));
    }
    if (opts.from) conds.push(gte(cdgSpese.dataPagamento, opts.from));
    if (opts.to) conds.push(lte(cdgSpese.dataPagamento, opts.to));
    if (opts.meseCompetenza) conds.push(eq(cdgSpese.meseCompetenza, opts.meseCompetenza));
    const rows = await db.select().from(cdgSpese).where(and(...conds)).orderBy(desc(cdgSpese.dataPagamento));
    return resolveSingleRs(rows, await getRsNameMap(orgId));
  },
  async getSpesa(id: string, orgId: string): Promise<CdgSpesa | undefined> {
    const [r] = await db.select().from(cdgSpese)
      .where(and(eq(cdgSpese.id, id), eq(cdgSpese.organizationId, orgId)));
    if (!r) return undefined;
    return resolveSingleRs([r], await getRsNameMap(orgId))[0];
  },
  async createSpesa(data: InsertCdgSpesa): Promise<CdgSpesa> {
    const rsId = data.ragioneSocialeId
      ?? (data.ragioneSociale ? await ensureRsAnchor(db, data.organizationId, data.ragioneSociale) : null);
    const [r] = await db.insert(cdgSpese).values({ ...data, ragioneSocialeId: rsId }).returning();
    return r;
  },
  /**
   * Crea la spesa master e tutti i cloni ricorrenti in un'UNICA transazione
   * (come importSpese): o tutte le occorrenze o nessuna. I cloni non
   * duplicano l'allegato. Ritorna la master.
   */
  async createSpesaConRicorrenza(
    data: InsertCdgSpesa,
    cloni: Array<{ dataPagamento: string; meseCompetenza: string }>,
  ): Promise<CdgSpesa> {
    return await db.transaction(async (tx) => {
      const rsId = data.ragioneSocialeId
        ?? (data.ragioneSociale ? await ensureRsAnchor(tx, data.organizationId, data.ragioneSociale) : null);
      const [master] = await tx.insert(cdgSpese).values({ ...data, ragioneSocialeId: rsId }).returning();
      for (const c of cloni) {
        await tx.insert(cdgSpese).values({
          ...data,
          ragioneSocialeId: rsId,
          allegatoPath: null,
          allegatoNome: null,
          allegatoMime: null,
          dataPagamento: c.dataPagamento,
          meseCompetenza: c.meseCompetenza,
        });
      }
      return master;
    });
  },
  async updateSpesa(id: string, orgId: string, updates: Partial<InsertCdgSpesa>): Promise<CdgSpesa | null> {
    const set: Partial<InsertCdgSpesa> = { ...updates };
    if (updates.ragioneSociale && updates.ragioneSocialeId === undefined) {
      set.ragioneSocialeId = await ensureRsAnchor(db, orgId, updates.ragioneSociale);
    }
    const [r] = await db.update(cdgSpese)
      .set({ ...set, updatedAt: new Date() })
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
    if (rs) {
      const rsId = await getRsIdByName(orgId, rs);
      conds.push(rsId
        ? or(
            eq(cdgPdvManuali.ragioneSocialeId, rsId),
            and(isNull(cdgPdvManuali.ragioneSocialeId), eq(cdgPdvManuali.ragioneSociale, rs)),
          )!
        : eq(cdgPdvManuali.ragioneSociale, rs));
    }
    const rows = await db.select().from(cdgPdvManuali).where(and(...conds)).orderBy(cdgPdvManuali.nome);
    return resolveSingleRs(rows, await getRsNameMap(orgId));
  },
  async getPdvManuale(id: string, orgId: string): Promise<CdgPdvManuale | undefined> {
    const [r] = await db.select().from(cdgPdvManuali)
      .where(and(eq(cdgPdvManuali.id, id), eq(cdgPdvManuali.organizationId, orgId)));
    if (!r) return undefined;
    return resolveSingleRs([r], await getRsNameMap(orgId))[0];
  },
  async createPdvManuale(data: InsertCdgPdvManuale): Promise<CdgPdvManuale> {
    const rsId = data.ragioneSocialeId
      ?? (data.ragioneSociale ? await ensureRsAnchor(db, data.organizationId, data.ragioneSociale) : null);
    const [r] = await db.insert(cdgPdvManuali).values({ ...data, ragioneSocialeId: rsId }).returning();
    return r;
  },
  async updatePdvManuale(id: string, orgId: string, updates: Partial<InsertCdgPdvManuale>): Promise<CdgPdvManuale | null> {
    const set: Partial<InsertCdgPdvManuale> = { ...updates };
    if (updates.ragioneSociale && updates.ragioneSocialeId === undefined) {
      set.ragioneSocialeId = await ensureRsAnchor(db, orgId, updates.ragioneSociale);
    }
    const [r] = await db.update(cdgPdvManuali).set(set)
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
      // Ricorrenza pianificata (dalla preview): se presente, la riga genera
      // un'occorrenza per elemento di `occorrenze` (stesse regole del
      // dialogo "Nuova spesa"). Se null, spesa una tantum.
      ricorrenza?: {
        periodicita: "mensile" | "annuale";
        dataInizio: string;
        dataFine: string;
        offsetMesi: number;
        occorrenze: Array<{ dataPagamento: string; meseCompetenza: string }>;
      } | null;
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
        // Una riga ricorrente si espande in N occorrenze (come il dialogo
        // "Nuova spesa"); il dedupe da doppio import è per occorrenza.
        const occorrenze = r.ricorrenza
          ? r.ricorrenza.occorrenze
          : [{ dataPagamento: r.dataPagamento, meseCompetenza: r.meseCompetenza }];
        for (const occ of occorrenze) {
          const dup = await tx.execute(sql`
            SELECT 1 FROM cdg_spese
             WHERE organization_id = ${orgId}
               AND ragione_sociale = ${r.rs}
               AND descrizione = ${r.descrizione}
               AND importo = ${r.importo}
               AND data_pagamento = ${occ.dataPagamento}
               AND mese_competenza = ${occ.meseCompetenza}
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
            dataPagamento: occ.dataPagamento,
            meseCompetenza: occ.meseCompetenza,
            metodoPagamento: r.metodoPagamento,
            note: r.note,
            ricorrente: !!r.ricorrenza,
            periodicita: r.ricorrenza?.periodicita ?? null,
            dataInizioRicorrenza: r.ricorrenza?.dataInizio ?? null,
            dataFineRicorrenza: r.ricorrenza?.dataFine ?? null,
            cashFlowOffsetMesi: r.ricorrenza?.offsetMesi ?? 0,
          });
        }
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
