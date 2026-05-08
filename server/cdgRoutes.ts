import type { Express, RequestHandler } from "express";
import path from "path";
import fs from "fs/promises";
import { z } from "zod";
import { storage } from "./storage";
import { cdgStorage } from "./cdgStorage";
import {
  insertCdgRagioneSocialeSchema,
  insertCdgCategoriaSchema,
  insertCdgFornitoreSchema,
  insertCdgPdvSchema,
  insertCdgSpesaSchema,
} from "@shared/schema";

const UPLOAD_DIR = process.env.CDG_UPLOAD_DIR
  || path.join(process.cwd(), "uploads", "cdg");

async function ensureUploadDir() {
  await fs.mkdir(UPLOAD_DIR, { recursive: true });
}

const MAX_ALLEGATO_BYTES = 8 * 1024 * 1024; // 8MB

async function saveAllegato(orgId: string, base64: string, originalName: string): Promise<{ filePath: string; size: number }> {
  await ensureUploadDir();
  const buf = Buffer.from(base64, "base64");
  if (buf.length === 0) throw new Error("File vuoto");
  if (buf.length > MAX_ALLEGATO_BYTES) throw new Error("File troppo grande (max 8MB)");
  const orgDir = path.join(UPLOAD_DIR, orgId);
  await fs.mkdir(orgDir, { recursive: true });
  const safeName = originalName.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80);
  const fileName = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}_${safeName}`;
  const filePath = path.join(orgDir, fileName);
  await fs.writeFile(filePath, buf);
  return { filePath: path.relative(process.cwd(), filePath), size: buf.length };
}

async function deleteAllegato(relPath: string | null | undefined) {
  if (!relPath) return;
  const abs = path.isAbsolute(relPath) ? relPath : path.join(process.cwd(), relPath);
  // Sanity: must be inside UPLOAD_DIR
  const resolved = path.resolve(abs);
  const root = path.resolve(UPLOAD_DIR);
  if (!resolved.startsWith(root)) return;
  try { await fs.unlink(resolved); } catch { /* ignore */ }
}

export function registerCdgRoutes(app: Express, isAuthenticated: RequestHandler, requireModule: (k: string) => RequestHandler) {
  const requireOrgAdmin = async (req: any, res: any) => {
    const profile = await storage.getProfile(req.session.userId);
    if (!profile?.organizationId) {
      res.status(400).json({ error: "Utente senza organizzazione" });
      return null;
    }
    if (!["super_admin", "admin"].includes(profile.role)) {
      res.status(403).json({ error: "Accesso non autorizzato" });
      return null;
    }
    return profile;
  };

  const gate: RequestHandler[] = [isAuthenticated, requireModule("controllo_gestione")];

  // === Ragioni Sociali ===
  app.get("/api/cdg/ragioni-sociali", ...gate, async (req: any, res) => {
    const profile = await requireOrgAdmin(req, res);
    if (!profile) return;
    const items = await cdgStorage.listRagioniSociali(profile.organizationId!);
    res.json(items);
  });
  app.post("/api/cdg/ragioni-sociali", ...gate, async (req: any, res) => {
    const profile = await requireOrgAdmin(req, res);
    if (!profile) return;
    const parsed = insertCdgRagioneSocialeSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0].message });
    try {
      const r = await cdgStorage.createRagioneSociale({ ...parsed.data, organizationId: profile.organizationId! });
      res.status(201).json(r);
    } catch (e: any) {
      if (String(e?.code) === "23505") return res.status(409).json({ error: "Ragione Sociale già esistente" });
      res.status(500).json({ error: "Errore creazione" });
    }
  });
  app.put("/api/cdg/ragioni-sociali/:id", ...gate, async (req: any, res) => {
    const profile = await requireOrgAdmin(req, res);
    if (!profile) return;
    const parsed = insertCdgRagioneSocialeSchema.partial().safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0].message });
    const r = await cdgStorage.updateRagioneSociale(req.params.id, profile.organizationId!, parsed.data);
    if (!r) return res.status(404).json({ error: "Non trovato" });
    res.json(r);
  });
  app.delete("/api/cdg/ragioni-sociali/:id", ...gate, async (req: any, res) => {
    const profile = await requireOrgAdmin(req, res);
    if (!profile) return;
    await cdgStorage.deleteRagioneSociale(req.params.id, profile.organizationId!);
    res.json({ success: true });
  });

  // Helper generico per anagrafiche RS-scoped
  const makeAnagraficaRoutes = <T,>(
    base: string,
    schema: z.ZodType<T>,
    list: (orgId: string, rs?: string) => Promise<unknown>,
    create: (data: any) => Promise<unknown>,
    update: (id: string, orgId: string, updates: any) => Promise<unknown | null>,
    del: (id: string, orgId: string) => Promise<void>,
  ) => {
    app.get(`/api/cdg/${base}`, ...gate, async (req: any, res) => {
      const profile = await requireOrgAdmin(req, res);
      if (!profile) return;
      const rs = req.query.rs as string | undefined;
      const items = await list(profile.organizationId!, rs);
      res.json(items);
    });
    app.post(`/api/cdg/${base}`, ...gate, async (req: any, res) => {
      const profile = await requireOrgAdmin(req, res);
      if (!profile) return;
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: (parsed as any).error.errors[0].message });
      const r = await create({ ...parsed.data, organizationId: profile.organizationId! });
      res.status(201).json(r);
    });
    app.put(`/api/cdg/${base}/:id`, ...gate, async (req: any, res) => {
      const profile = await requireOrgAdmin(req, res);
      if (!profile) return;
      const parsed = (schema as any).partial().safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0].message });
      const r = await update(req.params.id, profile.organizationId!, parsed.data);
      if (!r) return res.status(404).json({ error: "Non trovato" });
      res.json(r);
    });
    app.delete(`/api/cdg/${base}/:id`, ...gate, async (req: any, res) => {
      const profile = await requireOrgAdmin(req, res);
      if (!profile) return;
      await del(req.params.id, profile.organizationId!);
      res.json({ success: true });
    });
  };

  makeAnagraficaRoutes(
    "categorie", insertCdgCategoriaSchema as any,
    cdgStorage.listCategorie, cdgStorage.createCategoria, cdgStorage.updateCategoria, cdgStorage.deleteCategoria,
  );
  makeAnagraficaRoutes(
    "fornitori", insertCdgFornitoreSchema as any,
    cdgStorage.listFornitori, cdgStorage.createFornitore, cdgStorage.updateFornitore, cdgStorage.deleteFornitore,
  );
  makeAnagraficaRoutes(
    "pdv", insertCdgPdvSchema as any,
    cdgStorage.listPdv, cdgStorage.createPdv, cdgStorage.updatePdv, cdgStorage.deletePdv,
  );

  // === Spese ===
  app.get("/api/cdg/spese", ...gate, async (req: any, res) => {
    const profile = await requireOrgAdmin(req, res);
    if (!profile) return;
    const items = await cdgStorage.listSpese(profile.organizationId!, {
      rs: req.query.rs as string | undefined,
      from: req.query.from as string | undefined,
      to: req.query.to as string | undefined,
      meseCompetenza: req.query.competenza as string | undefined,
    });
    res.json(items);
  });

  app.post("/api/cdg/spese", ...gate, async (req: any, res) => {
    const profile = await requireOrgAdmin(req, res);
    if (!profile) return;
    const parsed = insertCdgSpesaSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0].message });
    const { allegatoBase64, allegatoNome, allegatoMime, ...rest } = parsed.data as any;
    let allegatoPath: string | null = null;
    if (allegatoBase64 && allegatoNome) {
      try {
        const saved = await saveAllegato(profile.organizationId!, allegatoBase64, allegatoNome);
        allegatoPath = saved.filePath;
      } catch (e: any) {
        return res.status(400).json({ error: e?.message || "Errore upload" });
      }
    }
    const r = await cdgStorage.createSpesa({
      ...rest,
      organizationId: profile.organizationId!,
      createdBy: profile.id,
      allegatoPath: allegatoPath,
      allegatoNome: allegatoPath ? allegatoNome : null,
      allegatoMime: allegatoPath ? allegatoMime || null : null,
    });
    res.status(201).json(r);
  });

  app.put("/api/cdg/spese/:id", ...gate, async (req: any, res) => {
    const profile = await requireOrgAdmin(req, res);
    if (!profile) return;
    const existing = await cdgStorage.getSpesa(req.params.id, profile.organizationId!);
    if (!existing) return res.status(404).json({ error: "Non trovato" });
    const parsed = insertCdgSpesaSchema.partial().safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0].message });
    const { allegatoBase64, allegatoNome, allegatoMime, ...rest } = parsed.data as any;
    const updates: any = { ...rest };
    if (allegatoBase64 && allegatoNome) {
      try {
        const saved = await saveAllegato(profile.organizationId!, allegatoBase64, allegatoNome);
        await deleteAllegato(existing.allegatoPath);
        updates.allegatoPath = saved.filePath;
        updates.allegatoNome = allegatoNome;
        updates.allegatoMime = allegatoMime || null;
      } catch (e: any) {
        return res.status(400).json({ error: e?.message || "Errore upload" });
      }
    } else if (req.body.removeAllegato === true) {
      await deleteAllegato(existing.allegatoPath);
      updates.allegatoPath = null;
      updates.allegatoNome = null;
      updates.allegatoMime = null;
    }
    const r = await cdgStorage.updateSpesa(req.params.id, profile.organizationId!, updates);
    res.json(r);
  });

  app.delete("/api/cdg/spese/:id", ...gate, async (req: any, res) => {
    const profile = await requireOrgAdmin(req, res);
    if (!profile) return;
    const existing = await cdgStorage.getSpesa(req.params.id, profile.organizationId!);
    if (existing) await deleteAllegato(existing.allegatoPath);
    await cdgStorage.deleteSpesa(req.params.id, profile.organizationId!);
    res.json({ success: true });
  });

  // Download allegato
  app.get("/api/cdg/spese/:id/allegato", ...gate, async (req: any, res) => {
    const profile = await requireOrgAdmin(req, res);
    if (!profile) return;
    const sp = await cdgStorage.getSpesa(req.params.id, profile.organizationId!);
    if (!sp || !sp.allegatoPath) return res.status(404).json({ error: "Allegato non presente" });
    const abs = path.isAbsolute(sp.allegatoPath) ? sp.allegatoPath : path.join(process.cwd(), sp.allegatoPath);
    const resolved = path.resolve(abs);
    const root = path.resolve(UPLOAD_DIR);
    if (!resolved.startsWith(root)) return res.status(403).json({ error: "Path non consentito" });
    res.setHeader("Content-Type", sp.allegatoMime || "application/octet-stream");
    res.setHeader("Content-Disposition", `inline; filename="${encodeURIComponent(sp.allegatoNome || "allegato")}"`);
    res.sendFile(resolved);
  });
}
