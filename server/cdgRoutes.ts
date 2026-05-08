import type { Express, RequestHandler } from "express";
import path from "path";
import fs from "fs/promises";
import { z, type ZodType } from "zod";
import { sql } from "drizzle-orm";
import { db } from "./db";
import { storage } from "./storage";
import { cdgStorage } from "./cdgStorage";
import {
  insertCdgRagioneSocialeSchema,
  insertCdgCategoriaSchema,
  insertCdgFornitoreSchema,
  insertCdgSpesaSchema,
  insertCdgPdvManualeSchema,
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

// Calcolo coerente di iva e totale (importo) da imponibile + aliquota.
// Lavora in centesimi per evitare errori di floating point e arrotonda al
// centesimo. Restituisce stringhe pronte per le colonne numeric.
function computeImporti(imponibileStr: string, aliquotaStr: string): { imponibile: string; aliquotaIva: string; iva: string; importo: string } {
  const imp = Number.parseFloat(String(imponibileStr).replace(",", "."));
  const aliq = Number.parseFloat(String(aliquotaStr).replace(",", "."));
  if (!Number.isFinite(imp) || imp <= 0) throw new Error("Imponibile non valido");
  if (!Number.isFinite(aliq) || aliq < 0 || aliq > 100) throw new Error("Aliquota IVA non valida");
  const impCent = Math.round(imp * 100);
  const ivaCent = Math.round((impCent * aliq) / 100);
  const totCent = impCent + ivaCent;
  const fmt = (c: number) => (c / 100).toFixed(2);
  return { imponibile: fmt(impCent), aliquotaIva: aliq.toFixed(2), iva: fmt(ivaCent), importo: fmt(totCent) };
}

// Back-fill una tantum:
// 1) imponibile/iva (legacy pre-IVA): imponibile=importo, aliquotaIva=0, iva=0.
// 2) ragioni_sociali (multi-RS migration): popola array da ragione_sociale legacy.
// 3) pdv_codice remap → puntiVendita.codicePos: rimappa eventuali pdv_codice
//    legacy (impostati pre Task #71 via join con la vecchia tabella cdg_pdv,
//    ora droppata) al vero codicePos in organization_config.puntiVendita.
// Backfill retry-safe: il flag viene impostato solo dopo il completamento di
// tutti gli step. Se uno step fallisce transitoriamente (es. DB unreachable),
// l'intera procedura verrà rieseguita al prossimo register/restart. I singoli
// step sono già idempotenti (WHERE clauses che escludono righe già migrate).
let cdgBackfillDone = false;
let cdgBackfillRunning = false;
async function backfillCdg(): Promise<void> {
  if (cdgBackfillDone || cdgBackfillRunning) return;
  cdgBackfillRunning = true;
  let allOk = true;
  try {
    await db.execute(sql`
      UPDATE cdg_spese
         SET imponibile = importo, aliquota_iva = 0, iva = 0
       WHERE imponibile IS NULL
    `);
  } catch (e) {
    allOk = false;
    console.error("[cdg] backfill imponibile failed:", e);
  }
  try {
    await db.execute(sql`
      UPDATE cdg_categorie
         SET ragioni_sociali = ARRAY[ragione_sociale]
       WHERE ragione_sociale IS NOT NULL
         AND COALESCE(array_length(ragioni_sociali, 1), 0) = 0
    `);
    await db.execute(sql`
      UPDATE cdg_fornitori
         SET ragioni_sociali = ARRAY[ragione_sociale]
       WHERE ragione_sociale IS NOT NULL
         AND COALESCE(array_length(ragioni_sociali, 1), 0) = 0
    `);
  } catch (e) {
    allOk = false;
    console.error("[cdg] backfill ragioni_sociali failed:", e);
  }
  // Rimappa pdv_codice ai veri puntiVendita.codicePos. Le spese pre Task #71
  // possono avere pdv_codice = nome PDV (impostato dal vecchio backfill che
  // joinava la legacy cdg_pdv quando codicePos era null): questi valori non
  // corrispondono al codicePos in organization_config.puntiVendita, quindi
  // non sarebbero risolvibili dal frontend. Per ogni org, scorriamo le spese
  // con pdv_codice non vuoto e proviamo a matcharle contro
  // puntiVendita.codicePos; se non matcha, proviamo per puntiVendita.nome
  // (case-insensitive). Idempotente: se già corretto, l'UPDATE è no-op.
  try {
    const orgs = await db.execute(sql`
      SELECT DISTINCT sp.organization_id
        FROM cdg_spese sp
       WHERE sp.pdv_codice IS NOT NULL AND sp.pdv_codice <> ''
    `);
    const orgRows = (orgs as unknown as { rows: Array<{ organization_id: string }> }).rows || [];
    for (const { organization_id: orgId } of orgRows) {
      const cfg = await storage.getOrgConfig(orgId);
      const pv = ((cfg?.config as Record<string, unknown> | null)?.puntiVendita || []) as PuntoVendita[];
      if (!pv.length) continue;
      const codiciValidi = new Set<string>();
      const byNome = new Map<string, string>();
      for (const p of pv) {
        const codice = String(p?.codicePos || "").trim();
        const nome = String(p?.nome || "").trim();
        if (codice) codiciValidi.add(codice);
        if (codice && nome) byNome.set(nome.toLowerCase(), codice);
      }
      const speseRows = await db.execute(sql`
        SELECT id, pdv_codice FROM cdg_spese
         WHERE organization_id = ${orgId}
           AND pdv_codice IS NOT NULL AND pdv_codice <> ''
      `);
      const items = (speseRows as unknown as { rows: Array<{ id: string; pdv_codice: string }> }).rows || [];
      for (const it of items) {
        if (codiciValidi.has(it.pdv_codice)) continue;
        const remap = byNome.get(it.pdv_codice.toLowerCase());
        if (remap) {
          await db.execute(sql`UPDATE cdg_spese SET pdv_codice = ${remap} WHERE id = ${it.id}`);
        }
      }
    }
  } catch (e) {
    allOk = false;
    console.error("[cdg] remap pdv_codice → codicePos failed:", e);
  }
  cdgBackfillRunning = false;
  if (allOk) cdgBackfillDone = true;
}

interface PuntoVendita { codicePos?: unknown; nome?: unknown; ragioneSociale?: unknown }

async function getOrgPuntiVendita(orgId: string): Promise<PuntoVendita[]> {
  const cfg = await storage.getOrgConfig(orgId);
  return ((cfg?.config as Record<string, unknown> | null)?.puntiVendita || []) as PuntoVendita[];
}

export function registerCdgRoutes(app: Express, isAuthenticated: RequestHandler, requireModule: (k: string) => RequestHandler) {
  void ensureUploadDir().catch(() => { /* will retry per-write */ });
  void backfillCdg();

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

  // Lista RS unificata: PDV (da organization_config.puntiVendita, read-only)
  // + manuali (CRUD su cdg_ragioni_sociali). Le manuali con stesso nome di
  // una PDV mantengono origine "manuale" (sono editabili dall'utente).
  app.get("/api/cdg/ragioni-sociali/unified", ...gate, async (req: any, res) => {
    const profile = await requireOrgAdmin(req, res);
    if (!profile) return;
    const orgId = profile.organizationId!;
    const manuali = await cdgStorage.listRagioniSociali(orgId);
    const pdvList = await getOrgPuntiVendita(orgId);
    const pdvNames = new Set<string>();
    for (const p of pdvList) {
      const nome = String(p?.ragioneSociale || "").trim();
      if (nome) pdvNames.add(nome);
    }
    const manualiByNome = new Map(manuali.map(r => [r.nome, r] as const));
    const out: Array<{ nome: string; origine: "pdv" | "manuale"; id?: string; partitaIva?: string | null; note?: string | null }> = [];
    for (const r of manuali) {
      out.push({ nome: r.nome, origine: "manuale", id: r.id, partitaIva: r.partitaIva, note: r.note });
    }
    for (const nome of Array.from(pdvNames).sort((a, b) => a.localeCompare(b, "it"))) {
      if (!manualiByNome.has(nome)) out.push({ nome, origine: "pdv" });
    }
    out.sort((a, b) => a.nome.localeCompare(b.nome, "it"));
    res.json(out);
  });

  // PDV unificati: ereditati da organization_config.puntiVendita
  // (origine="config", read-only) + manuali da cdg_pdv_manuali
  // (origine="manuale", CRUD via Anagrafiche → PDV). Filtrabili per RS.
  // In caso di collisione su codice all'interno della stessa RS, il PDV
  // manuale è preferito ma viene comunque marcato `dup` per la UI.
  app.get("/api/cdg/pdv-by-rs", ...gate, async (req: any, res) => {
    const profile = await requireOrgAdmin(req, res);
    if (!profile) return;
    const orgId = profile.organizationId!;
    const rs = typeof req.query.rs === "string" ? req.query.rs.trim() : "";
    const [pdvCfg, pdvMan] = await Promise.all([
      getOrgPuntiVendita(orgId),
      cdgStorage.listPdvManuali(orgId, rs || undefined),
    ]);
    type Out = { codice: string; nome: string; ragioneSociale: string;
      origine: "config" | "manuale"; id?: string; indirizzo?: string | null; note?: string | null };
    const seen = new Map<string, Out>();
    const keyOf = (rsName: string, codice: string) => `${rsName}\u0000${codice}`;
    for (const m of pdvMan) {
      const k = keyOf(m.ragioneSociale, m.codice);
      seen.set(k, {
        codice: m.codice, nome: m.nome, ragioneSociale: m.ragioneSociale,
        origine: "manuale", id: m.id, indirizzo: m.indirizzo, note: m.note,
      });
    }
    for (const p of pdvCfg) {
      const rsName = String(p?.ragioneSociale || "").trim();
      if (rs && rsName !== rs) continue;
      const codicePos = String(p?.codicePos || "").trim();
      const nome = String(p?.nome || "").trim();
      const codice = codicePos || nome;
      if (!codice || !nome) continue;
      const k = keyOf(rsName, codice);
      if (seen.has(k)) continue;
      seen.set(k, { codice, nome, ragioneSociale: rsName, origine: "config" });
    }
    const out = Array.from(seen.values()).sort((a, b) =>
      a.ragioneSociale.localeCompare(b.ragioneSociale, "it") || a.nome.localeCompare(b.nome, "it"));
    res.json(out);
  });

  // === PDV Manuali (CRUD) ===
  app.get("/api/cdg/pdv-manuali", ...gate, async (req: any, res) => {
    const profile = await requireOrgAdmin(req, res);
    if (!profile) return;
    const rs = typeof req.query.rs === "string" ? req.query.rs : undefined;
    res.json(await cdgStorage.listPdvManuali(profile.organizationId!, rs));
  });
  app.post("/api/cdg/pdv-manuali", ...gate, async (req: any, res) => {
    const profile = await requireOrgAdmin(req, res);
    if (!profile) return;
    const parsed = insertCdgPdvManualeSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0].message });
    const orgId = profile.organizationId!;
    const valid = await getValidRsNames(orgId);
    if (!valid.has(parsed.data.ragioneSociale)) {
      return res.status(400).json({ error: `Ragione Sociale "${parsed.data.ragioneSociale}" non valida` });
    }
    // Collisione con un PDV ereditato (stesso codice nella stessa RS)
    const cfg = await getOrgPuntiVendita(orgId);
    const cfgClash = cfg.some(p => {
      const rsName = String(p?.ragioneSociale || "").trim();
      const codicePos = String(p?.codicePos || "").trim();
      const nome = String(p?.nome || "").trim();
      const code = codicePos || nome;
      return rsName === parsed.data.ragioneSociale && code === parsed.data.codice;
    });
    if (cfgClash) return res.status(409).json({ error: `Esiste già un PDV ereditato con codice "${parsed.data.codice}" in questa RS. Scegli un codice diverso.` });
    try {
      const r = await cdgStorage.createPdvManuale({ ...parsed.data, organizationId: orgId });
      res.status(201).json(r);
    } catch (e: unknown) {
      if (typeof e === "object" && e && "code" in e && String((e as { code: unknown }).code) === "23505") {
        return res.status(409).json({ error: "Esiste già un PDV manuale con questo codice in questa RS" });
      }
      res.status(500).json({ error: "Errore creazione PDV" });
    }
  });
  app.put("/api/cdg/pdv-manuali/:id", ...gate, async (req: any, res) => {
    const profile = await requireOrgAdmin(req, res);
    if (!profile) return;
    const parsed = insertCdgPdvManualeSchema.partial().safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0].message });
    const orgId = profile.organizationId!;
    const existing = await cdgStorage.getPdvManuale(req.params.id, orgId);
    if (!existing) return res.status(404).json({ error: "Non trovato" });
    const newRs = parsed.data.ragioneSociale ?? existing.ragioneSociale;
    const newCod = parsed.data.codice ?? existing.codice;
    if (parsed.data.ragioneSociale && parsed.data.ragioneSociale !== existing.ragioneSociale) {
      const valid = await getValidRsNames(orgId);
      if (!valid.has(newRs)) return res.status(400).json({ error: `Ragione Sociale "${newRs}" non valida` });
    }
    if (newRs !== existing.ragioneSociale || newCod !== existing.codice) {
      const cfg = await getOrgPuntiVendita(orgId);
      const cfgClash = cfg.some(p => {
        const rsName = String(p?.ragioneSociale || "").trim();
        const codicePos = String(p?.codicePos || "").trim();
        const nome = String(p?.nome || "").trim();
        const code = codicePos || nome;
        return rsName === newRs && code === newCod;
      });
      if (cfgClash) return res.status(409).json({ error: `Esiste già un PDV ereditato con codice "${newCod}" in questa RS.` });
    }
    try {
      const r = await cdgStorage.updatePdvManuale(req.params.id, orgId, parsed.data);
      if (!r) return res.status(404).json({ error: "Non trovato" });
      // Se è cambiato il codice, propaga sulle spese che lo riferiscono
      if (parsed.data.codice && parsed.data.codice !== existing.codice) {
        await db.execute(sql`
          UPDATE cdg_spese SET pdv_codice = ${parsed.data.codice}
           WHERE organization_id = ${orgId}
             AND ragione_sociale = ${existing.ragioneSociale}
             AND pdv_codice = ${existing.codice}
        `);
      }
      // Se è cambiata la RS, propaga sulle spese (mantenendo codice)
      if (parsed.data.ragioneSociale && parsed.data.ragioneSociale !== existing.ragioneSociale) {
        await db.execute(sql`
          UPDATE cdg_spese SET ragione_sociale = ${parsed.data.ragioneSociale}
           WHERE organization_id = ${orgId}
             AND ragione_sociale = ${existing.ragioneSociale}
             AND pdv_codice = ${parsed.data.codice ?? existing.codice}
        `);
      }
      res.json(r);
    } catch (e: unknown) {
      if (typeof e === "object" && e && "code" in e && String((e as { code: unknown }).code) === "23505") {
        return res.status(409).json({ error: "Esiste già un PDV manuale con questo codice in questa RS" });
      }
      res.status(500).json({ error: "Errore aggiornamento PDV" });
    }
  });
  app.delete("/api/cdg/pdv-manuali/:id", ...gate, async (req: any, res) => {
    const profile = await requireOrgAdmin(req, res);
    if (!profile) return;
    await cdgStorage.deletePdvManuale(req.params.id, profile.organizationId!);
    res.json({ success: true });
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
    const rs = await cdgStorage.getRagioneSociale(req.params.id, profile.organizationId!);
    if (rs) {
      const speseRs = await cdgStorage.listSpese(profile.organizationId!, { rs: rs.nome });
      await Promise.all(speseRs.map(s => deleteAllegato(s.allegatoPath)));
    }
    await cdgStorage.deleteRagioneSociale(req.params.id, profile.organizationId!);
    res.json({ success: true });
  });

  // ===== Inherited (org_config.puntiVendita) write-through =====
  // Helper: legge la config corrente, applica il mutator sull'array puntiVendita
  // e fa upsert preservando configVersion.
  async function mutateOrgPuntiVendita(
    orgId: string,
    mutator: (pv: Array<Record<string, unknown>>) => Array<Record<string, unknown>>,
  ): Promise<void> {
    const cfg = await storage.getOrgConfig(orgId);
    const config = (cfg?.config as Record<string, unknown> | null) || {};
    const pv = (config.puntiVendita as Array<Record<string, unknown>> | undefined) || [];
    const next = mutator(pv.map(p => ({ ...p })));
    const newConfig = { ...config, puntiVendita: next };
    const version = cfg?.configVersion || "2.0";
    await storage.upsertOrgConfig(orgId, newConfig, version);
  }

  // Rinomina/Modifica una RS ereditata (presente in puntiVendita).
  // - Se cambia il nome: rinomina ragioneSociale in TUTTE le voci puntiVendita,
  //   nei manuali (cat/forn arrays, pdv manuali, spese) e nella RS manuale
  //   eventualmente esistente con vecchio nome.
  // - partitaIva/note non sono campi della config: vengono persistiti come
  //   override in cdg_ragioni_sociali (upsert sul nome attuale).
  app.put("/api/cdg/ragioni-sociali/inherited/:nome", ...gate, async (req: any, res) => {
    const profile = await requireOrgAdmin(req, res);
    if (!profile) return;
    const orgId = profile.organizationId!;
    const oldName = decodeURIComponent(req.params.nome).trim();
    const parsed = z.object({
      nome: z.string().trim().min(1).optional(),
      partitaIva: z.string().nullable().optional(),
      note: z.string().nullable().optional(),
    }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0].message });
    const newName = (parsed.data.nome || oldName).trim();
    if (!newName) return res.status(400).json({ error: "Nome obbligatorio" });

    // Verifica che oldName esista come RS ereditata
    const cfgPv = await getOrgPuntiVendita(orgId);
    const exists = cfgPv.some(p => String(p?.ragioneSociale || "").trim() === oldName);
    if (!exists) return res.status(404).json({ error: "RS ereditata non trovata" });

    // Conflitto su rename: il nuovo nome non deve già esistere in altre RS
    if (newName !== oldName) {
      const valid = await getValidRsNames(orgId);
      if (valid.has(newName)) return res.status(409).json({ error: `Esiste già una Ragione Sociale "${newName}"` });
    }

    try {
      if (newName !== oldName) {
        // 1) puntiVendita: rinomina ragioneSociale
        await mutateOrgPuntiVendita(orgId, (pv) => pv.map(p =>
          String(p?.ragioneSociale || "").trim() === oldName
            ? { ...p, ragioneSociale: newName }
            : p
        ));
        // 2) cat/forn arrays
        await db.execute(sql`
          UPDATE cdg_categorie
             SET ragioni_sociali = array_replace(ragioni_sociali, ${oldName}, ${newName}),
                 ragione_sociale = CASE WHEN ragione_sociale = ${oldName} THEN ${newName} ELSE ragione_sociale END
           WHERE organization_id = ${orgId}
             AND ${oldName} = ANY(ragioni_sociali)
        `);
        await db.execute(sql`
          UPDATE cdg_fornitori
             SET ragioni_sociali = array_replace(ragioni_sociali, ${oldName}, ${newName}),
                 ragione_sociale = CASE WHEN ragione_sociale = ${oldName} THEN ${newName} ELSE ragione_sociale END
           WHERE organization_id = ${orgId}
             AND ${oldName} = ANY(ragioni_sociali)
        `);
        // 3) pdv manuali
        await db.execute(sql`
          UPDATE cdg_pdv_manuali SET ragione_sociale = ${newName}
           WHERE organization_id = ${orgId} AND ragione_sociale = ${oldName}
        `);
        // 4) spese
        await db.execute(sql`
          UPDATE cdg_spese SET ragione_sociale = ${newName}
           WHERE organization_id = ${orgId} AND ragione_sociale = ${oldName}
        `);
        // 5) eventuale RS manuale con vecchio nome → rinomina
        await db.execute(sql`
          UPDATE cdg_ragioni_sociali SET nome = ${newName}
           WHERE organization_id = ${orgId} AND nome = ${oldName}
        `);
      }

      // Upsert override partitaIva/note in cdg_ragioni_sociali sul nome attuale
      const piva = parsed.data.partitaIva ?? null;
      const note = parsed.data.note ?? null;
      const allManuali = await cdgStorage.listRagioniSociali(orgId);
      const existingManual = allManuali.find(r => r.nome === newName);
      if (existingManual) {
        await cdgStorage.updateRagioneSociale(existingManual.id, orgId, { partitaIva: piva, note });
      } else if (piva || note) {
        await cdgStorage.createRagioneSociale({ organizationId: orgId, nome: newName, partitaIva: piva, note });
      }
      res.json({ success: true, nome: newName });
    } catch (e) {
      console.error("[cdg] update inherited RS failed:", e);
      res.status(500).json({ error: "Errore aggiornamento RS ereditata" });
    }
  });

  // Elimina una RS ereditata: rimuove TUTTE le voci puntiVendita con quella RS,
  // cascade su pdv manuali, spese (con allegati), categorie/fornitori (array
  // remove + delete orfani), e RS manuale eventualmente omonima.
  // ATTENZIONE: impatta anche la Gestione Organizzazione (puntiVendita).
  app.delete("/api/cdg/ragioni-sociali/inherited/:nome", ...gate, async (req: any, res) => {
    const profile = await requireOrgAdmin(req, res);
    if (!profile) return;
    const orgId = profile.organizationId!;
    const nome = decodeURIComponent(req.params.nome).trim();
    if (!nome) return res.status(400).json({ error: "Nome mancante" });
    try {
      // Cancella allegati spese
      const speseRs = await cdgStorage.listSpese(orgId, { rs: nome });
      await Promise.all(speseRs.map(s => deleteAllegato(s.allegatoPath)));
      // Rimuove dalle puntiVendita
      await mutateOrgPuntiVendita(orgId, (pv) => pv.filter(p =>
        String(p?.ragioneSociale || "").trim() !== nome
      ));
      // Cascade
      await db.execute(sql`DELETE FROM cdg_spese WHERE organization_id = ${orgId} AND ragione_sociale = ${nome}`);
      await db.execute(sql`DELETE FROM cdg_pdv_manuali WHERE organization_id = ${orgId} AND ragione_sociale = ${nome}`);
      await db.execute(sql`
        UPDATE cdg_categorie SET ragioni_sociali = array_remove(ragioni_sociali, ${nome})
         WHERE organization_id = ${orgId} AND ${nome} = ANY(ragioni_sociali)
      `);
      await db.execute(sql`
        DELETE FROM cdg_categorie WHERE organization_id = ${orgId}
           AND COALESCE(array_length(ragioni_sociali, 1), 0) = 0
      `);
      await db.execute(sql`
        UPDATE cdg_fornitori SET ragioni_sociali = array_remove(ragioni_sociali, ${nome})
         WHERE organization_id = ${orgId} AND ${nome} = ANY(ragioni_sociali)
      `);
      await db.execute(sql`
        DELETE FROM cdg_fornitori WHERE organization_id = ${orgId}
           AND COALESCE(array_length(ragioni_sociali, 1), 0) = 0
      `);
      await db.execute(sql`DELETE FROM cdg_ragioni_sociali WHERE organization_id = ${orgId} AND nome = ${nome}`);
      res.json({ success: true });
    } catch (e) {
      console.error("[cdg] delete inherited RS failed:", e);
      res.status(500).json({ error: "Errore eliminazione RS ereditata" });
    }
  });

  // Modifica un PDV ereditato (in puntiVendita). Identifica per (rs, codice)
  // dove codice = codicePos || nome. Permette rename di RS/codice/nome.
  // I campi extra (canale, cluster*, tipoPosizione) vengono preservati.
  app.put("/api/cdg/pdv-inherited", ...gate, async (req: any, res) => {
    const profile = await requireOrgAdmin(req, res);
    if (!profile) return;
    const orgId = profile.organizationId!;
    const parsed = z.object({
      ragioneSociale: z.string().trim().min(1),
      codice: z.string().trim().min(1),
      newRagioneSociale: z.string().trim().min(1).optional(),
      newCodice: z.string().trim().min(1).optional(),
      newNome: z.string().trim().min(1).optional(),
    }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0].message });
    const { ragioneSociale: oldRs, codice: oldCod } = parsed.data;
    const newRs = parsed.data.newRagioneSociale || oldRs;
    const newCod = parsed.data.newCodice || oldCod;

    // Validazione RS destinazione (deve esistere o essere uguale)
    if (newRs !== oldRs) {
      const valid = await getValidRsNames(orgId);
      if (!valid.has(newRs)) return res.status(400).json({ error: `Ragione Sociale "${newRs}" non valida` });
    }

    // Helper: codice logico effettivo (codicePos || nome). Usato sia per il
    // matching dell'entry che per propagare il rename alle spese quando cambia
    // solo `nome` su una entry priva di `codicePos`.
    const effCode = (p: Record<string, unknown>) => {
      const codicePos = String(p?.codicePos || "").trim();
      const nomePdv = String(p?.nome || "").trim();
      return codicePos || nomePdv;
    };

    const cfgPv = await getOrgPuntiVendita(orgId);
    const sourceEntry = cfgPv.find(p =>
      String(p?.ragioneSociale || "").trim() === oldRs && effCode(p) === oldCod
    );
    if (!sourceEntry) return res.status(404).json({ error: "PDV ereditato non trovato" });

    // Calcola il codice effettivo destinazione: se l'entry usa fallback su
    // `nome` (no codicePos) e cambia `newNome`, anche il codice cambia.
    const sourceHasCodicePos = !!String(sourceEntry?.codicePos || "").trim();
    const finalNome = parsed.data.newNome ?? String(sourceEntry?.nome || "");
    const effNewCod = parsed.data.newCodice
      ? newCod
      : (sourceHasCodicePos ? oldCod : finalNome.trim());

    // Conflitto: (newRs, effNewCod) non deve già esistere su un altro entry
    if (newRs !== oldRs || effNewCod !== oldCod) {
      const dup = cfgPv.some(p => {
        if (p === sourceEntry) return false;
        return String(p?.ragioneSociale || "").trim() === newRs && effCode(p) === effNewCod;
      });
      if (dup) return res.status(409).json({ error: `Esiste già un PDV con codice "${effNewCod}" in "${newRs}"` });
      // E non deve collidere con un manuale
      const pdvMan = await cdgStorage.listPdvManuali(orgId, newRs);
      if (pdvMan.some(m => m.codice === effNewCod)) {
        return res.status(409).json({ error: `Esiste già un PDV manuale con codice "${effNewCod}" in "${newRs}"` });
      }
    }

    try {
      // Match per chiave stabile (oldRs, oldCod) DENTRO il mutator per evitare
      // race se la config cambia tra la read e la write.
      let applied = false;
      await mutateOrgPuntiVendita(orgId, (pv) => pv.map(p => {
        if (applied) return p;
        const rsName = String(p?.ragioneSociale || "").trim();
        if (rsName !== oldRs || effCode(p) !== oldCod) return p;
        applied = true;
        const updated: Record<string, unknown> = { ...p };
        if (parsed.data.newRagioneSociale) updated.ragioneSociale = newRs;
        if (parsed.data.newCodice) updated.codicePos = newCod;
        if (parsed.data.newNome) updated.nome = parsed.data.newNome;
        return updated;
      }));
      if (!applied) return res.status(409).json({ error: "PDV ereditato modificato concorrentemente, ricarica e riprova" });
      // Propaga rename codice/RS sulle spese collegate (incluso il caso in cui
      // il codice effettivo cambi a causa del rename del solo nome).
      if (effNewCod !== oldCod || newRs !== oldRs) {
        await db.execute(sql`
          UPDATE cdg_spese
             SET pdv_codice = ${effNewCod}, ragione_sociale = ${newRs}
           WHERE organization_id = ${orgId}
             AND ragione_sociale = ${oldRs}
             AND pdv_codice = ${oldCod}
        `);
      }
      res.json({ success: true, ragioneSociale: newRs, codice: effNewCod });
    } catch (e) {
      console.error("[cdg] update inherited PDV failed:", e);
      res.status(500).json({ error: "Errore aggiornamento PDV ereditato" });
    }
  });

  // Elimina un PDV ereditato dalla puntiVendita (impatta Gestione Organizzazione).
  // Le spese collegate restano (mantengono il codice salvato).
  app.delete("/api/cdg/pdv-inherited", ...gate, async (req: any, res) => {
    const profile = await requireOrgAdmin(req, res);
    if (!profile) return;
    const orgId = profile.organizationId!;
    const rs = String(req.query.rs || "").trim();
    const codice = String(req.query.codice || "").trim();
    if (!rs || !codice) return res.status(400).json({ error: "Parametri rs e codice obbligatori" });
    try {
      let removed = false;
      await mutateOrgPuntiVendita(orgId, (pv) => pv.filter(p => {
        const rsName = String(p?.ragioneSociale || "").trim();
        const codicePos = String(p?.codicePos || "").trim();
        const nomePdv = String(p?.nome || "").trim();
        const code = codicePos || nomePdv;
        const match = rsName === rs && code === codice;
        if (match) removed = true;
        return !match;
      }));
      if (!removed) return res.status(404).json({ error: "PDV ereditato non trovato" });
      res.json({ success: true });
    } catch (e) {
      console.error("[cdg] delete inherited PDV failed:", e);
      res.status(500).json({ error: "Errore eliminazione PDV ereditato" });
    }
  });

  // Validazione RS contro la lista unificata (manuali + PDV ereditate).
  // Ritorna l'insieme dei nomi RS validi per l'organizzazione.
  async function getValidRsNames(orgId: string): Promise<Set<string>> {
    const manuali = await cdgStorage.listRagioniSociali(orgId);
    const pdvList = await getOrgPuntiVendita(orgId);
    const out = new Set<string>(manuali.map(r => r.nome));
    for (const p of pdvList) {
      const n = String(p?.ragioneSociale || "").trim();
      if (n) out.add(n);
    }
    return out;
  }

  // Overlap check multi-RS per categorie/fornitori. Le vecchie unique index
  // (organization_id, ragione_sociale, lower(nome)) sono state droppate per la
  // migrazione multi-RS: senza questo controllo si potrebbero creare voci
  // duplicate (stesso nome, RS sovrapposte) ambigue nel selettore spese.
  async function checkAnagraficaOverlap(
    base: string, orgId: string, nome: string, ragioniSociali: string[], excludeId?: string,
  ): Promise<string | null> {
    if (!nome) return null;
    const dup = base === "categorie"
      ? await cdgStorage.findCategoriaOverlap(orgId, nome, ragioniSociali, excludeId)
      : await cdgStorage.findFornitoreOverlap(orgId, nome, ragioniSociali, excludeId);
    if (!dup) return null;
    const rsList = (dup.ragioniSociali || []).join(", ") || "nessuna RS";
    return `Esiste già una voce con nome "${dup.nome}" (RS: ${rsList}). Modifica quella esistente per aggiungere altre Ragioni Sociali.`;
  }

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
      const data = parsed.data as Record<string, unknown>;
      const rsArr = Array.isArray(data.ragioniSociali) ? (data.ragioniSociali as string[]) : [];
      if (rsArr.length > 0) {
        const valid = await getValidRsNames(profile.organizationId!);
        const bad = rsArr.find(n => !valid.has(n));
        if (bad) return res.status(400).json({ error: `Ragione Sociale "${bad}" non valida` });
      }
      const nome = String(data.nome || "").trim();
      const overlapErr = await checkAnagraficaOverlap(base, profile.organizationId!, nome, rsArr);
      if (overlapErr) return res.status(409).json({ error: overlapErr });
      try {
        const r = await cfg.create({ ...data, organizationId: profile.organizationId! });
        res.status(201).json(r);
      } catch (e: unknown) {
        if (typeof e === "object" && e && "code" in e && String((e as { code: unknown }).code) === "23505") {
          return res.status(409).json({ error: "Voce già esistente" });
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
      const data = parsed.data as Record<string, unknown>;
      if (Array.isArray(data.ragioniSociali)) {
        const rsArr = data.ragioniSociali as string[];
        if (rsArr.length === 0) return res.status(400).json({ error: "Seleziona almeno una Ragione Sociale" });
        const valid = await getValidRsNames(profile.organizationId!);
        const bad = rsArr.find(n => !valid.has(n));
        if (bad) return res.status(400).json({ error: `Ragione Sociale "${bad}" non valida` });
      }
      // Overlap check su PUT: se sto cambiando nome o RS, verifico che non
      // esista già un'altra voce con stesso nome e RS sovrapposte.
      if (data.nome !== undefined || Array.isArray(data.ragioniSociali)) {
        const existing = base === "categorie"
          ? await cdgStorage.getCategoria(req.params.id, profile.organizationId!)
          : await cdgStorage.getFornitore(req.params.id, profile.organizationId!);
        if (existing) {
          const newNome = data.nome !== undefined ? String(data.nome).trim() : existing.nome;
          const newRs = Array.isArray(data.ragioniSociali) ? (data.ragioniSociali as string[]) : (existing.ragioniSociali || []);
          const overlapErr = await checkAnagraficaOverlap(base, profile.organizationId!, newNome, newRs, req.params.id);
          if (overlapErr) return res.status(409).json({ error: overlapErr });
        }
      }
      const r = await cfg.update(req.params.id, profile.organizationId!, data);
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

  // Usage report: in quante spese è usata una categoria/fornitore.
  // Usato dal dialog di conferma cancellazione per mostrare l'impatto.
  app.get("/api/cdg/categorie/:id/usage", ...gate, async (req: any, res) => {
    const profile = await requireOrgAdmin(req, res);
    if (!profile) return;
    const cat = await cdgStorage.getCategoria(req.params.id, profile.organizationId!);
    if (!cat) return res.status(404).json({ error: "Non trovato" });
    res.json(await cdgStorage.getCategoriaUsage(req.params.id, profile.organizationId!));
  });
  app.get("/api/cdg/fornitori/:id/usage", ...gate, async (req: any, res) => {
    const profile = await requireOrgAdmin(req, res);
    if (!profile) return;
    const f = await cdgStorage.getFornitore(req.params.id, profile.organizationId!);
    if (!f) return res.status(404).json({ error: "Non trovato" });
    res.json(await cdgStorage.getFornitoreUsage(req.params.id, profile.organizationId!));
  });

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

  // === Spese ===
  // Verifica che ogni FK appartenga all'org dell'utente e (se presente) sia
  // compatibile con la Ragione Sociale della spesa (cat/forn: rs ∈ array;
  // pdv: codice presente in puntiVendita per quella RS).
  async function validateSpesaFks(
    orgId: string,
    rs: string,
    categoriaId: string | null | undefined,
    fornitoreId: string | null | undefined,
    pdvCodice: string | null | undefined,
  ): Promise<string | null> {
    if (categoriaId) {
      const cat = await cdgStorage.getCategoria(categoriaId, orgId);
      if (!cat) return "Categoria non trovata o non appartiene a questa organizzazione";
      if (!(cat.ragioniSociali || []).includes(rs)) return "La categoria non è associata alla Ragione Sociale selezionata";
    }
    if (fornitoreId) {
      const f = await cdgStorage.getFornitore(fornitoreId, orgId);
      if (!f) return "Fornitore non trovato o non appartiene a questa organizzazione";
      if (!(f.ragioniSociali || []).includes(rs)) return "Il fornitore non è associato alla Ragione Sociale selezionata";
    }
    if (pdvCodice) {
      const [pdvList, pdvMan] = await Promise.all([
        getOrgPuntiVendita(orgId),
        cdgStorage.listPdvManuali(orgId, rs),
      ]);
      const okCfg = pdvList.some(p => {
        if (String(p?.ragioneSociale || "").trim() !== rs) return false;
        const codicePos = String(p?.codicePos || "").trim();
        const nome = String(p?.nome || "").trim();
        const key = codicePos || nome;
        return key === pdvCodice;
      });
      const okMan = pdvMan.some(m => m.codice === pdvCodice);
      if (!okCfg && !okMan) return "Il PDV non è valido per la Ragione Sociale selezionata";
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
    const fkErr = await validateSpesaFks(profile.organizationId!, rest.ragioneSociale, rest.categoriaId, rest.fornitoreId, rest.pdvCodice);
    if (fkErr) return res.status(400).json({ error: fkErr });
    if (rest.imponibile === undefined || rest.imponibile === null || rest.aliquotaIva === undefined || rest.aliquotaIva === null) {
      return res.status(400).json({ error: "Imponibile e aliquota IVA sono obbligatori" });
    }
    try {
      const c = computeImporti(String(rest.imponibile), String(rest.aliquotaIva));
      rest.imponibile = c.imponibile; rest.aliquotaIva = c.aliquotaIva;
      rest.iva = c.iva; rest.importo = c.importo;
    } catch (e) {
      return res.status(400).json({ error: e instanceof Error ? e.message : "Calcolo IVA non valido" });
    }
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
    const baseSpesa = {
      ...rest,
      importo: rest.importo as string,
      organizationId: profile.organizationId!,
      createdBy: profile.id,
      allegatoPath,
      allegatoNome: allegatoPath ? allegatoNome ?? null : null,
      allegatoMime: allegatoPath ? safeMime : null,
    };
    const r = await cdgStorage.createSpesa(baseSpesa);

    // Ricorrenza mensile: genera N copie indipendenti per i mesi successivi
    // fino a `dataFineRicorrenza` (inclusa). Ogni copia mantiene flag e
    // scadenza. L'allegato NON viene duplicato per evitare bloat di storage.
    let generati = 0;
    if (rest.ricorrente && rest.dataFineRicorrenza) {
      try {
        const [cy, cm] = String(rest.meseCompetenza).split("-").map(Number);
        const fineParts = String(rest.dataFineRicorrenza).split("-").map(Number);
        const fineY = fineParts[0]; const fineM = fineParts[1];
        const dataPag = String(rest.dataPagamento);
        const [py, pm, pd] = dataPag.split("-").map(Number);
        const baseDayMs = Date.UTC(py, pm - 1, pd);
        const fineCompMs = Date.UTC(fineY, fineM - 1, 1);
        let cursorY = cy, cursorM = cm;
        while (true) {
          // Avanza di un mese
          cursorM += 1;
          if (cursorM > 12) { cursorM = 1; cursorY += 1; }
          const curMs = Date.UTC(cursorY, cursorM - 1, 1);
          if (curMs > fineCompMs) break;
          const monthsDelta = (cursorY - cy) * 12 + (cursorM - cm);
          // Stima la nuova data pagamento: stesso giorno del mese, clamp se
          // il mese non lo contiene (es. 31 gen -> 28/29 feb).
          const targetDate = new Date(baseDayMs);
          targetDate.setUTCMonth(targetDate.getUTCMonth() + monthsDelta);
          // Verifica clamp: se setUTCMonth è "rimbalzato" oltre, riporta a fine mese
          if (targetDate.getUTCMonth() !== (cursorM - 1)) {
            targetDate.setUTCDate(0); // ultimo giorno del mese precedente
          }
          const newPagYmd = targetDate.toISOString().slice(0, 10);
          const newComp = `${cursorY}-${String(cursorM).padStart(2, "0")}`;
          await cdgStorage.createSpesa({
            ...baseSpesa,
            allegatoPath: null,
            allegatoNome: null,
            allegatoMime: null,
            dataPagamento: newPagYmd,
            meseCompetenza: newComp,
          });
          generati += 1;
        }
      } catch (e) {
        console.error("[cdg] ricorrenza generation failed:", e);
      }
    }
    res.status(201).json({ ...r, ricorrenzaGenerati: generati });
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
    const targetPdvCod = rest.pdvCodice !== undefined ? rest.pdvCodice : existing.pdvCodice;
    const fkErr = await validateSpesaFks(profile.organizationId!, targetRs, targetCat, targetForn, targetPdvCod);
    if (fkErr) return res.status(400).json({ error: fkErr });

    const hasImpUpd = rest.imponibile !== undefined && rest.imponibile !== null;
    const hasAliqUpd = rest.aliquotaIva !== undefined && rest.aliquotaIva !== null;
    if (hasImpUpd || hasAliqUpd) {
      const imp = hasImpUpd ? String(rest.imponibile) : String(existing.imponibile ?? existing.importo ?? "0");
      const aliq = hasAliqUpd ? String(rest.aliquotaIva) : String(existing.aliquotaIva ?? "0");
      try {
        const c = computeImporti(imp, aliq);
        rest.imponibile = c.imponibile; rest.aliquotaIva = c.aliquotaIva;
        rest.iva = c.iva; rest.importo = c.importo;
      } catch (e) {
        return res.status(400).json({ error: e instanceof Error ? e.message : "Calcolo IVA non valido" });
      }
    }

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
    const disposition = ALLOWED_MIMES.has(mime) ? "inline" : "attachment";
    const safeFileName = (sp.allegatoNome || "allegato").replace(/[\r\n"]/g, "_");
    res.setHeader("Content-Type", mime);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Disposition", `${disposition}; filename="${encodeURIComponent(safeFileName)}"`);
    res.sendFile(resolved);
  });
}
