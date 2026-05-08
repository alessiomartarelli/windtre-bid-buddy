import type { Express, RequestHandler } from "express";
import path from "path";
import fs from "fs/promises";
import { z, type ZodType } from "zod";
import { storage } from "./storage";
import { cdgStorage } from "./cdgStorage";
import {
  insertCdgRagioneSocialeSchema,
  insertCdgCategoriaSchema,
  insertCdgFornitoreSchema,
  insertCdgPdvSchema,
  insertCdgSpesaSchema,
  type Profile,
} from "@shared/schema";

const UPLOAD_DIR = process.env.CDG_UPLOAD_DIR
  || path.join(process.cwd(), "uploads", "cdg");

async function ensureUploadDir() {
  await fs.mkdir(UPLOAD_DIR, { recursive: true });
}

const MAX_ALLEGATO_BYTES = 8 * 1024 * 1024;

const ALLOWED_MIMES = new Set<string>([
  "application/pdf",
  "image/jpeg", "image/png", "image/gif", "image/webp", "image/heic", "image/heif",
]);
const ALLOWED_EXTS = new Set<string>([".pdf", ".jpg", ".jpeg", ".png", ".gif", ".webp", ".heic", ".heif"]);

// Sniff signature minimo per evitare upload mascherati (HTML/script con MIME PDF).
function sniffMime(buf: Buffer): string | null {
  if (buf.length >= 4 && buf.slice(0, 4).toString("ascii") === "%PDF") return "application/pdf";
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.length >= 8 && buf.slice(0, 8).toString("hex") === "89504e470d0a1a0a") return "image/png";
  if (buf.length >= 6) {
    const h = buf.slice(0, 6).toString("ascii");
    if (h === "GIF87a" || h === "GIF89a") return "image/gif";
  }
  if (buf.length >= 12) {
    const riff = buf.slice(0, 4).toString("ascii");
    const webp = buf.slice(8, 12).toString("ascii");
    if (riff === "RIFF" && webp === "WEBP") return "image/webp";
  }
  if (buf.length >= 12) {
    const ftyp = buf.slice(4, 8).toString("ascii");
    if (ftyp === "ftyp") {
      const brand = buf.slice(8, 12).toString("ascii");
      if (brand.startsWith("heic") || brand.startsWith("heix") || brand.startsWith("mif1") || brand.startsWith("heif")) return "image/heic";
    }
  }
  return null;
}

async function saveAllegato(orgId: string, base64: string, originalName: string, declaredMime?: string): Promise<{ filePath: string; size: number; mime: string }> {
  await ensureUploadDir();
  const buf = Buffer.from(base64, "base64");
  if (buf.length === 0) throw new Error("File vuoto");
  if (buf.length > MAX_ALLEGATO_BYTES) throw new Error("File troppo grande (max 8MB)");

  const ext = path.extname(originalName).toLowerCase();
  if (!ALLOWED_EXTS.has(ext)) throw new Error("Estensione non consentita (solo PDF e immagini)");

  const sniffed = sniffMime(buf);
  if (!sniffed) throw new Error("Contenuto non riconosciuto come PDF o immagine");
  if (!ALLOWED_MIMES.has(sniffed)) throw new Error("Tipo file non consentito");
  if (declaredMime && declaredMime !== sniffed && !(declaredMime.startsWith("image/") && sniffed.startsWith("image/"))) {
    throw new Error("MIME dichiarato incoerente con il contenuto");
  }

  const orgDir = path.join(UPLOAD_DIR, orgId);
  await fs.mkdir(orgDir, { recursive: true });
  const safeName = originalName.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80);
  const fileName = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}_${safeName}`;
  const filePath = path.join(orgDir, fileName);
  await fs.writeFile(filePath, buf);
  return { filePath: path.relative(process.cwd(), filePath), size: buf.length, mime: sniffed };
}

async function deleteAllegato(relPath: string | null | undefined) {
  if (!relPath) return;
  const abs = path.isAbsolute(relPath) ? relPath : path.join(process.cwd(), relPath);
  const resolved = path.resolve(abs);
  const root = path.resolve(UPLOAD_DIR);
  if (!resolved.startsWith(root)) return;
  try { await fs.unlink(resolved); } catch { /* ignore */ }
}

interface AnagraficaCrud {
  base: string;
  schema: ZodType<Record<string, unknown>>;
  list: (orgId: string, rs?: string) => Promise<unknown[]>;
  create: (data: Record<string, unknown> & { organizationId: string }) => Promise<unknown>;
  update: (id: string, orgId: string, updates: Record<string, unknown>) => Promise<unknown | null>;
  del: (id: string, orgId: string) => Promise<void>;
}

export function registerCdgRoutes(app: Express, isAuthenticated: RequestHandler, requireModule: (k: string) => RequestHandler) {
  void ensureUploadDir().catch(() => { /* will retry per-write */ });

  const requireOrgAdmin = async (req: { session: { userId: string } }, res: { status: (c: number) => { json: (d: unknown) => void } }): Promise<Profile | null> => {
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
    res.json(await cdgStorage.listRagioniSociali(profile.organizationId!));
  });
  app.post("/api/cdg/ragioni-sociali", ...gate, async (req: any, res) => {
    const profile = await requireOrgAdmin(req, res);
    if (!profile) return;
    const parsed = insertCdgRagioneSocialeSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0].message });
    try {
      const r = await cdgStorage.createRagioneSociale({ ...parsed.data, organizationId: profile.organizationId! });
      res.status(201).json(r);
    } catch (e: unknown) {
      if (typeof e === "object" && e && "code" in e && String((e as { code: unknown }).code) === "23505") {
        return res.status(409).json({ error: "Ragione Sociale già esistente" });
      }
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
    // Pulisci anche gli allegati su disco delle spese che verranno eliminate
    // a cascata, per evitare file orfani in uploads/cdg/<orgId>/.
    const rs = await cdgStorage.getRagioneSociale(req.params.id, profile.organizationId!);
    if (rs) {
      const speseRs = await cdgStorage.listSpese(profile.organizationId!, { rs: rs.nome });
      await Promise.all(speseRs.map(s => deleteAllegato(s.allegatoPath)));
    }
    await cdgStorage.deleteRagioneSociale(req.params.id, profile.organizationId!);
    res.json({ success: true });
  });

  function registerAnagrafica(cfg: AnagraficaCrud) {
    const { base, schema } = cfg;
    app.get(`/api/cdg/${base}`, ...gate, async (req: any, res) => {
      const profile = await requireOrgAdmin(req, res);
      if (!profile) return;
      const rs = typeof req.query.rs === "string" ? req.query.rs : undefined;
      res.json(await cfg.list(profile.organizationId!, rs));
    });
    app.post(`/api/cdg/${base}`, ...gate, async (req: any, res) => {
      const profile = await requireOrgAdmin(req, res);
      if (!profile) return;
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0].message });
      try {
        const r = await cfg.create({ ...parsed.data, organizationId: profile.organizationId! });
        res.status(201).json(r);
      } catch (e: unknown) {
        if (typeof e === "object" && e && "code" in e && String((e as { code: unknown }).code) === "23505") {
          return res.status(409).json({ error: "Voce già esistente per questa Ragione Sociale" });
        }
        res.status(500).json({ error: "Errore creazione" });
      }
    });
    app.put(`/api/cdg/${base}/:id`, ...gate, async (req: any, res) => {
      const profile = await requireOrgAdmin(req, res);
      if (!profile) return;
      const partial = (schema as unknown as { partial: () => ZodType<Record<string, unknown>> }).partial();
      const parsed = partial.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0].message });
      const r = await cfg.update(req.params.id, profile.organizationId!, parsed.data);
      if (!r) return res.status(404).json({ error: "Non trovato" });
      res.json(r);
    });
    app.delete(`/api/cdg/${base}/:id`, ...gate, async (req: any, res) => {
      const profile = await requireOrgAdmin(req, res);
      if (!profile) return;
      await cfg.del(req.params.id, profile.organizationId!);
      res.json({ success: true });
    });
  }

  registerAnagrafica({
    base: "categorie",
    schema: insertCdgCategoriaSchema as unknown as ZodType<Record<string, unknown>>,
    list: (orgId, rs) => cdgStorage.listCategorie(orgId, rs),
    create: (data) => cdgStorage.createCategoria(data as Parameters<typeof cdgStorage.createCategoria>[0]),
    update: (id, orgId, updates) => cdgStorage.updateCategoria(id, orgId, updates),
    del: cdgStorage.deleteCategoria,
  });
  registerAnagrafica({
    base: "fornitori",
    schema: insertCdgFornitoreSchema as unknown as ZodType<Record<string, unknown>>,
    list: (orgId, rs) => cdgStorage.listFornitori(orgId, rs),
    create: (data) => cdgStorage.createFornitore(data as Parameters<typeof cdgStorage.createFornitore>[0]),
    update: (id, orgId, updates) => cdgStorage.updateFornitore(id, orgId, updates),
    del: cdgStorage.deleteFornitore,
  });
  registerAnagrafica({
    base: "pdv",
    schema: insertCdgPdvSchema as unknown as ZodType<Record<string, unknown>>,
    list: (orgId, rs) => cdgStorage.listPdv(orgId, rs),
    create: (data) => cdgStorage.createPdv(data as Parameters<typeof cdgStorage.createPdv>[0]),
    update: (id, orgId, updates) => cdgStorage.updatePdv(id, orgId, updates),
    del: cdgStorage.deletePdv,
  });

  // === Spese ===
  // Verifica che ogni FK appartenga all'org dell'utente e (se presente) alla
  // stessa Ragione Sociale della spesa, per evitare cross-tenant / cross-RS leakage.
  async function validateSpesaFks(
    orgId: string,
    rs: string,
    categoriaId: string | null | undefined,
    fornitoreId: string | null | undefined,
    pdvId: string | null | undefined,
  ): Promise<string | null> {
    if (categoriaId) {
      const cat = await cdgStorage.getCategoria(categoriaId, orgId);
      if (!cat) return "Categoria non trovata o non appartiene a questa organizzazione";
      if (cat.ragioneSociale !== rs) return "La categoria non appartiene alla Ragione Sociale selezionata";
    }
    if (fornitoreId) {
      const f = await cdgStorage.getFornitore(fornitoreId, orgId);
      if (!f) return "Fornitore non trovato o non appartiene a questa organizzazione";
      if (f.ragioneSociale !== rs) return "Il fornitore non appartiene alla Ragione Sociale selezionata";
    }
    if (pdvId) {
      const p = await cdgStorage.getPdvOne(pdvId, orgId);
      if (!p) return "PDV non trovato o non appartiene a questa organizzazione";
      if (p.ragioneSociale !== rs) return "Il PDV non appartiene alla Ragione Sociale selezionata";
    }
    return null;
  }

  app.get("/api/cdg/spese", ...gate, async (req: any, res) => {
    const profile = await requireOrgAdmin(req, res);
    if (!profile) return;
    const items = await cdgStorage.listSpese(profile.organizationId!, {
      rs: typeof req.query.rs === "string" ? req.query.rs : undefined,
      from: typeof req.query.from === "string" ? req.query.from : undefined,
      to: typeof req.query.to === "string" ? req.query.to : undefined,
      meseCompetenza: typeof req.query.competenza === "string" ? req.query.competenza : undefined,
    });
    res.json(items);
  });

  app.post("/api/cdg/spese", ...gate, async (req: any, res) => {
    const profile = await requireOrgAdmin(req, res);
    if (!profile) return;
    const parsed = insertCdgSpesaSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0].message });
    const { allegatoBase64, allegatoNome, allegatoMime, ...rest } = parsed.data;
    const fkErr = await validateSpesaFks(profile.organizationId!, rest.ragioneSociale, rest.categoriaId, rest.fornitoreId, rest.pdvId);
    if (fkErr) return res.status(400).json({ error: fkErr });
    let allegatoPath: string | null = null;
    let safeMime: string | null = null;
    if (allegatoBase64 && allegatoNome) {
      try {
        const saved = await saveAllegato(profile.organizationId!, allegatoBase64, allegatoNome, allegatoMime);
        allegatoPath = saved.filePath;
        safeMime = saved.mime;
      } catch (e: unknown) {
        return res.status(400).json({ error: e instanceof Error ? e.message : "Errore upload" });
      }
    }
    const r = await cdgStorage.createSpesa({
      ...rest,
      organizationId: profile.organizationId!,
      createdBy: profile.id,
      allegatoPath,
      allegatoNome: allegatoPath ? allegatoNome ?? null : null,
      allegatoMime: allegatoPath ? safeMime : null,
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
    const { allegatoBase64, allegatoNome, allegatoMime, ...rest } = parsed.data;

    const targetRs = rest.ragioneSociale ?? existing.ragioneSociale;
    const targetCat = rest.categoriaId !== undefined ? rest.categoriaId : existing.categoriaId;
    const targetForn = rest.fornitoreId !== undefined ? rest.fornitoreId : existing.fornitoreId;
    const targetPdv = rest.pdvId !== undefined ? rest.pdvId : existing.pdvId;
    const fkErr = await validateSpesaFks(profile.organizationId!, targetRs, targetCat, targetForn, targetPdv);
    if (fkErr) return res.status(400).json({ error: fkErr });

    const updates: Record<string, unknown> = { ...rest };
    if (allegatoBase64 && allegatoNome) {
      try {
        const saved = await saveAllegato(profile.organizationId!, allegatoBase64, allegatoNome, allegatoMime);
        await deleteAllegato(existing.allegatoPath);
        updates.allegatoPath = saved.filePath;
        updates.allegatoNome = allegatoNome;
        updates.allegatoMime = saved.mime;
      } catch (e: unknown) {
        return res.status(400).json({ error: e instanceof Error ? e.message : "Errore upload" });
      }
    } else if (req.body?.removeAllegato === true) {
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

  app.get("/api/cdg/spese/:id/allegato", ...gate, async (req: any, res) => {
    const profile = await requireOrgAdmin(req, res);
    if (!profile) return;
    const sp = await cdgStorage.getSpesa(req.params.id, profile.organizationId!);
    if (!sp || !sp.allegatoPath) return res.status(404).json({ error: "Allegato non presente" });
    const abs = path.isAbsolute(sp.allegatoPath) ? sp.allegatoPath : path.join(process.cwd(), sp.allegatoPath);
    const resolved = path.resolve(abs);
    const root = path.resolve(UPLOAD_DIR) + path.sep;
    if (!(resolved + path.sep).startsWith(root)) return res.status(403).json({ error: "Path non consentito" });
    const mime = sp.allegatoMime && ALLOWED_MIMES.has(sp.allegatoMime) ? sp.allegatoMime : "application/octet-stream";
    // Inline solo per MIME whitelisted (PDF/immagini); altrimenti force attachment.
    const disposition = ALLOWED_MIMES.has(mime) ? "inline" : "attachment";
    const safeFileName = (sp.allegatoNome || "allegato").replace(/[\r\n"]/g, "_");
    res.setHeader("Content-Type", mime);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Disposition", `${disposition}; filename="${encodeURIComponent(safeFileName)}"`);
    res.sendFile(resolved);
  });
}
