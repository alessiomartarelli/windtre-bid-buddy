import type { Express, RequestHandler } from "express";
import { type Server } from "http";
import { storage, type CjItemDetailsUpdate, CJ_DEFAULT_TRIGGER_DATE, formatCjTriggerDate } from "./storage";
import session from "express-session";
import connectPg from "connect-pg-simple";
import bcrypt from "bcryptjs";
import { z } from "zod";
import type { BiSuiteMappingRule } from "../shared/bisuiteMapping";
import { getEffectiveRulesForEditor, getDefaultRulesHash, patchSavedRulesWithDefaultExclusions } from "../shared/bisuiteMapping";
import { isModuleEnabled, MODULE_KEYS } from "../shared/modules";
import { type BisuiteSale, CJ_ITEM_STATES, type CjItemState, type CjDriver, insertBrandSchema } from "@shared/schema";
import { driverFromCategory, CJ_DRIVER_ORDER, summarizeDrivers } from "@shared/customerJourney";
import { normalizeConfig, buildCalendar, normN, SECTION_IDS } from "@shared/incentivazione";
import { registerCdgRoutes } from "./cdgRoutes";
import { toItalianWallTime, runBisuiteFetchForOrg, formatFailedMonths } from "./bisuiteFetch";
import {
  loadEmailConfig,
  invalidateEmailConfigCache,
  sendTestEmailWithConfig,
  verifySmtpConnectionWithConfig,
  SMTP_CONFIG_KEY,
  type SmtpConfig,
} from "./email";
import { decryptSecret, encryptSecret, getSecretKey, isEncrypted } from "./cryptoSecret";
import { sendDailyReportForOrg } from "./telegramReportScheduler";
import { db } from "./db";
import { sql } from "drizzle-orm";
// FinPlan PRELOAD: rimosso in Task #148 (cutover finale). Le route
// `/api/finplan/preload(/status)`, l'allowlist `FINPLAN_PRELOAD_ORGS`,
// la cache in-memory del file `server/data/finplan-preload.json` e il
// flag DB `finplanPreloadEnabled` sono stati eliminati. La shell React
// gestisce ora il setup iniziale via `FinPlanSetupWizard` (mostrato sse
// l'org non ha ancora dati salvati su `/api/finplan`).

function toItalianYMD(input: string | undefined): string | undefined | null {
  if (input === undefined || input === null || input === "") return undefined;
  const sepIdx = input.search(/[T ]/);
  const datePart = sepIdx >= 0 ? input.slice(0, sepIdx) : input;
  return /^\d{4}-\d{2}-\d{2}$/.test(datePart) ? datePart : null;
}

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
});

const signupSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  fullName: z.string().min(2),
  organizationName: z.string().min(2),
});

function setupSession(app: Express) {
  const sessionTtl = 7 * 24 * 60 * 60 * 1000;
  const pgStore = connectPg(session);
  const sessionStore = new pgStore({
    conString: process.env.DATABASE_URL,
    createTableIfMissing: true,
    ttl: sessionTtl,
    tableName: "sessions",
  });

  app.set("trust proxy", 1);
  app.use(
    session({
      secret: process.env.SESSION_SECRET!,
      store: sessionStore,
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        secure: process.env.FORCE_HTTPS === "true",
        sameSite: "lax",
        maxAge: sessionTtl,
      },
    })
  );
}

const isAuthenticated: RequestHandler = async (req: any, res, next) => {
  if (req.session && req.session.userId) {
    const profile = await storage.getProfile(req.session.userId);
    if (profile && profile.isActive === false) {
      req.session.destroy(() => {});
      return res.status(403).json({ message: "Account disattivato. Contatta il tuo amministratore." });
    }
    return next();
  }
  return res.status(401).json({ message: "Unauthorized" });
};

// Blocca le route se nessuno dei moduli indicati è abilitato per l'org dell'utente.
// Accetta una singola chiave o un array (semantica OR: basta che uno sia abilitato).
// super_admin bypassa sempre. Richiede isAuthenticated prima.
function requireModule(moduleKey: string | string[]): RequestHandler {
  const keys = Array.isArray(moduleKey) ? moduleKey : [moduleKey];
  return async (req: any, res, next) => {
    try {
      const profile = await storage.getProfile(req.session.userId);
      if (!profile) return res.status(401).json({ error: "Unauthorized" });
      if (profile.role === "super_admin") return next();
      if (!profile.organizationId) {
        return res.status(403).json({ error: "Modulo non abilitato" });
      }
      const org = await storage.getOrganization(profile.organizationId);
      if (!org) {
        return res.status(403).json({ error: "Modulo non abilitato" });
      }
      const enabled = org.enabledModules ?? null;
      const anyEnabled = keys.some((k) => isModuleEnabled(enabled, k));
      if (!anyEnabled) {
        return res.status(403).json({ error: "Modulo non abilitato" });
      }
      next();
    } catch (e) {
      res.status(500).json({ error: "Errore controllo modulo" });
    }
  };
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  setupSession(app);

  // One-shot migration (Task #82): backfill any new `descrizioneEscludi`
  // tokens added to default mapping rules into the saved system_config so
  // that `getDefaultMappingRules` upgrades (e.g. adding "PROFESSIONAL DATA
  // 100" to the DATA 10 rule in Task #79) take effect on installations
  // that already saved a snapshot of the rules. Idempotent: re-runs are
  // no-ops once the saved rules already contain every default exclusion.
  void (async () => {
    try {
      const sysMapping = await storage.getSystemConfig("bisuite_mapping");
      const mapping = (sysMapping?.config ?? null) as
        | { rules?: BiSuiteMappingRule[]; version?: string }
        | null;
      const savedRules: BiSuiteMappingRule[] = Array.isArray(mapping?.rules)
        ? (mapping!.rules as BiSuiteMappingRule[])
        : [];
      if (savedRules.length === 0) return;
      const { rules: patched, changed } = patchSavedRulesWithDefaultExclusions(savedRules);
      if (!changed) return;
      const updatedBy = sysMapping?.updatedBy ?? null;
      await storage.upsertSystemConfig(
        "bisuite_mapping",
        { ...(mapping || {}), rules: patched },
        updatedBy as string,
      );
      console.log("[bisuite-mapping] backfill: patched saved rules with new default exclusions");
    } catch (e) {
      console.error("[bisuite-mapping] backfill failed:", e);
    }
  })();

  // === AUTH: Signup ===
  app.post("/api/auth/signup", async (req: any, res) => {
    try {
      const validation = signupSchema.safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({ error: validation.error.errors[0].message });
      }

      const { email, password, fullName, organizationName } = validation.data;

      const existing = await storage.getProfileByEmail(email);
      if (existing) {
        return res.status(400).json({ error: "User already registered" });
      }

      const passwordHash = await bcrypt.hash(password, 10);

      const org = await storage.createOrganization({ name: organizationName });

      const profile = await storage.upsertProfile({
        email,
        passwordHash,
        fullName,
        organizationId: org.id,
        role: "admin",
      });

      req.session.userId = profile.id;

      await new Promise<void>((resolve, reject) => {
        req.session.save((err: any) => {
          if (err) reject(err);
          else resolve();
        });
      });

      const organization = await storage.getOrganization(profile.organizationId!);
      res.status(201).json({ ...profile, passwordHash: undefined, organization });
    } catch (error) {
      console.error("Signup error:", error);
      res.status(500).json({ error: "Errore durante la registrazione" });
    }
  });

  // === AUTH: Login ===
  app.post("/api/auth/login", async (req: any, res) => {
    try {
      const validation = loginSchema.safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({ error: validation.error.errors[0].message });
      }

      const { email, password } = validation.data;

      const profile = await storage.getProfileByEmail(email);
      if (!profile || !profile.passwordHash) {
        return res.status(401).json({ error: "Invalid login credentials" });
      }

      const valid = await bcrypt.compare(password, profile.passwordHash);
      if (!valid) {
        return res.status(401).json({ error: "Invalid login credentials" });
      }

      if (profile.isActive === false) {
        return res.status(403).json({ error: "Account disattivato. Contatta il tuo amministratore." });
      }

      req.session.userId = profile.id;

      let organization = null;
      if (profile.organizationId) {
        organization = await storage.getOrganization(profile.organizationId);
      }

      await new Promise<void>((resolve, reject) => {
        req.session.save((err: any) => {
          if (err) reject(err);
          else resolve();
        });
      });

      res.json({ ...profile, passwordHash: undefined, organization });
    } catch (error) {
      console.error("Login error:", error);
      res.status(500).json({ error: "Errore durante il login" });
    }
  });

  // === AUTH: Logout ===
  app.post("/api/auth/logout", (req: any, res) => {
    req.session.destroy((err: any) => {
      if (err) {
        return res.status(500).json({ error: "Errore durante il logout" });
      }
      res.clearCookie("connect.sid");
      res.json({ success: true });
    });
  });

  // Get current user profile with organization
  app.get("/api/user", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session.userId;
      const profile = await storage.getProfile(userId);

      if (!profile) {
        return res.status(401).json({ message: "Unauthorized" });
      }

      let organization = null;
      let organizationBrands: { id: string; name: string }[] = [];
      if (profile.organizationId) {
        organization = await storage.getOrganization(profile.organizationId);
        // Brand (operatori) associati all'org — read-only per tutti i ruoli.
        organizationBrands = (await storage.getOrganizationBrands(profile.organizationId))
          .map((b) => ({ id: b.id, name: b.name }));
      }

      res.json({ ...profile, passwordHash: undefined, organization, organizationBrands });
    } catch (error) {
      console.error("Error fetching user:", error);
      res.status(500).json({ message: "Failed to fetch user" });
    }
  });

  // === PREVENTIVI ===
  app.get("/api/preventivi", isAuthenticated, requireModule("simulatore"), async (req: any, res) => {
    try {
      const userId = req.session.userId;
      const profile = await storage.getProfile(userId);
      if (!profile?.organizationId) {
        return res.json([]);
      }
      const items = await storage.getPreventivi(profile.organizationId);
      res.json(items);
    } catch (error) {
      res.status(500).json({ message: "Error fetching preventivi" });
    }
  });

  app.post("/api/preventivi", isAuthenticated, requireModule("simulatore"), async (req: any, res) => {
    try {
      const userId = req.session.userId;
      const profile = await storage.getProfile(userId);
      if (!profile?.organizationId) {
        return res.status(400).json({ message: "User has no organization" });
      }
      const { name, data } = req.body;
      const preventivo = await storage.createPreventivo({
        name,
        data,
        organizationId: profile.organizationId,
        createdBy: userId,
      });
      res.status(201).json(preventivo);
    } catch (error) {
      res.status(500).json({ message: "Error creating preventivo" });
    }
  });

  app.put("/api/preventivi/:id", isAuthenticated, requireModule("simulatore"), async (req: any, res) => {
    try {
      const userId = req.session.userId;
      const profile = await storage.getProfile(userId);
      if (!profile?.organizationId) {
        return res.status(403).json({ message: "Forbidden" });
      }
      const existing = await storage.getPreventivo(req.params.id);
      if (!existing) {
        return res.status(404).json({ message: "Not found" });
      }
      if (existing.organizationId !== profile.organizationId) {
        return res.status(404).json({ message: "Not found" });
      }
      const { name, data } = req.body;
      const preventivo = await storage.updatePreventivo(req.params.id, name, data);
      res.json(preventivo);
    } catch (error) {
      res.status(500).json({ message: "Error updating preventivo" });
    }
  });

  app.delete("/api/preventivi/:id", isAuthenticated, requireModule("simulatore"), async (req: any, res) => {
    try {
      const userId = req.session.userId;
      const profile = await storage.getProfile(userId);
      if (!profile?.organizationId) {
        return res.status(403).json({ message: "Forbidden" });
      }
      const existing = await storage.getPreventivo(req.params.id);
      if (!existing) {
        return res.status(404).json({ message: "Not found" });
      }
      if (existing.organizationId !== profile.organizationId) {
        return res.status(404).json({ message: "Not found" });
      }
      await storage.deletePreventivo(req.params.id);
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ message: "Error deleting preventivo" });
    }
  });

  app.get("/api/preventivi/:id", isAuthenticated, requireModule("simulatore"), async (req: any, res) => {
    try {
      const userId = req.session.userId;
      const profile = await storage.getProfile(userId);
      if (!profile?.organizationId) {
        return res.status(403).json({ message: "Forbidden" });
      }
      const preventivo = await storage.getPreventivo(req.params.id);
      if (!preventivo) {
        return res.status(404).json({ message: "Not found" });
      }
      if (preventivo.organizationId !== profile.organizationId) {
        return res.status(404).json({ message: "Not found" });
      }
      res.json(preventivo);
    } catch (error) {
      res.status(500).json({ message: "Error loading preventivo" });
    }
  });

  // === ORGANIZATION CONFIG ===
  // /api/organization-config è letta/scritta da molte pagine modulari
  // (simulatore, tabelle_calcolo, amministrazione, gara_*, drms, AdminPanel).
  // Basta che UNO di questi moduli sia abilitato per l'org per accedervi.
  const ORG_CONFIG_MODULES = [
    "simulatore",
    "tabelle_calcolo",
    "amministrazione",
    "gara_configurazione",
    "gara_dashboard",
    "vendite_bisuite",
    "mappatura_bisuite",
    "drms_commissioning",
  ];

  app.get("/api/organization-config", isAuthenticated, requireModule(ORG_CONFIG_MODULES), async (req: any, res) => {
    try {
      const userId = req.session.userId;
      const profile = await storage.getProfile(userId);
      if (!profile?.organizationId) {
        return res.json(null);
      }
      const config = await storage.getOrgConfig(profile.organizationId);
      res.json(config || null);
    } catch (error) {
      res.status(500).json({ message: "Error fetching config" });
    }
  });

  app.put("/api/organization-config", isAuthenticated, requireModule(ORG_CONFIG_MODULES), async (req: any, res) => {
    try {
      const userId = req.session.userId;
      const profile = await storage.getProfile(userId);
      if (!profile?.organizationId) {
        return res.status(400).json({ message: "User has no organization" });
      }
      const { config, configVersion } = req.body;
      // Struttura canonica (puntiVendita, ragioniSociali) è write-protected:
      // solo admin/super_admin possono modificarla. Per i non-admin la guardia
      // confronta lo stato POST-MERGE: se il payload omette una chiave protetta,
      // verrebbe rimossa dal save → re-inietto il valore corrente. Se la include
      // con valore diverso → 403.
      let effectiveConfig: Record<string, unknown> = (config as Record<string, unknown> | null) || {};
      if (!['admin', 'super_admin'].includes(profile.role)) {
        const cur = await storage.getOrgConfig(profile.organizationId);
        const curCfg = (cur?.config as Record<string, unknown> | null) || {};
        const ser = (v: unknown) => JSON.stringify(v ?? null);
        const protectedKeys: ReadonlyArray<"puntiVendita" | "ragioniSociali"> = ["puntiVendita", "ragioniSociali"];
        const merged: Record<string, unknown> = { ...effectiveConfig };
        for (const k of protectedKeys) {
          const incomingHas = Object.prototype.hasOwnProperty.call(effectiveConfig, k);
          if (incomingHas && ser(effectiveConfig[k]) !== ser(curCfg[k])) {
            return res.status(403).json({ message: `Solo admin/super_admin possono modificare ${k}` });
          }
          if (Object.prototype.hasOwnProperty.call(curCfg, k)) {
            merged[k] = curCfg[k];
          } else {
            delete merged[k];
          }
        }
        effectiveConfig = merged;
      }
      const result = await storage.upsertOrgConfig(profile.organizationId, effectiveConfig, configVersion || "2.0");
      res.json(result);
    } catch (error) {
      res.status(500).json({ message: "Error saving config" });
    }
  });

  // === FINPLAN (Tab Analisi in Amministrazione) ===
  // Persistenza opaca per-organizzazione del tool HTML "FinPlan Studio"
  // embeddato nel tab Analisi. Visibile a tutti gli utenti autenticati con
  // un'organizzazione (la pagina Amministrazione gestisce già la
  // visibilità del tab a livello UI).
  // Stesso gate della pagina Amministrazione: serve almeno uno dei due moduli.
  const FINPLAN_MODULES = ["amministrazione", "controllo_gestione"];

  // Task #152 — heuristica condivisa per riconoscere uno snapshot FinPlan
  // "vuoto": 0 transazioni totali, 0 debiti, 0 obiettivi con valori non
  // nulli (target/current > 0). Lo skeleton creato dal setup wizard al
  // primo accesso ha sempre un default obj per RS con target=0/current=0:
  // li consideriamo "non meaningful" così uno skeleton iniziale conta
  // come vuoto e non può sovrascrivere dati reali.
  function isEmptyFinplanSnapshot(data: unknown): boolean {
    if (!data || typeof data !== "object") return true;
    const d = data as Record<string, unknown>;
    const arr = Array.isArray(d.data) ? (d.data as unknown[]) : [];
    if (arr.length === 0) return true;
    let tx = 0, debts = 0, objMeaningful = 0;
    for (const entry of arr) {
      if (!entry || typeof entry !== "object") continue;
      const e = entry as Record<string, unknown>;
      if (Array.isArray(e.transactions)) tx += (e.transactions as unknown[]).length;
      if (Array.isArray(e.debts)) debts += (e.debts as unknown[]).length;
      if (Array.isArray(e.obj)) {
        for (const o of e.obj as unknown[]) {
          if (!o || typeof o !== "object") continue;
          const oo = o as Record<string, unknown>;
          const target = Number(oo.target ?? 0);
          const current = Number(oo.current ?? 0);
          if ((Number.isFinite(target) && target > 0) || (Number.isFinite(current) && current > 0)) {
            objMeaningful++;
          }
        }
      }
    }
    return tx === 0 && debts === 0 && objMeaningful === 0;
  }

  app.get("/api/finplan", isAuthenticated, requireModule(FINPLAN_MODULES), async (req: any, res) => {
    try {
      const profile = await storage.getProfile(req.session.userId);
      if (!profile?.organizationId) return res.json({ data: {}, updatedAt: null, updatedBy: null });
      const row = await storage.getFinplanData(profile.organizationId);
      // Primo accesso o nessun dato: ritorna oggetto vuoto autoritativo
      // (lo shim lato client lo usa per resettare la cache cross-org).
      if (!row) return res.json({ data: {}, updatedAt: null, updatedBy: null });
      res.json({ data: row.data ?? {}, updatedAt: row.updatedAt, updatedBy: row.updatedBy });
    } catch (e) {
      console.error("[finplan] GET error:", e);
      res.status(500).json({ message: "Error fetching finplan data" });
    }
  });

  // (Route preload eliminate in Task #148 — vedi nota in testa al file.)

  app.put("/api/finplan", isAuthenticated, requireModule(FINPLAN_MODULES), async (req: any, res) => {
    try {
      const profile = await storage.getProfile(req.session.userId);
      if (!profile?.organizationId) return res.status(400).json({ message: "User has no organization" });
      const data = (req.body && typeof req.body === "object") ? req.body.data : null;
      if (data === undefined) return res.status(400).json({ message: "Missing data" });
      // Limite di sicurezza ~12MB sul payload JSON serializzato.
      try {
        const sz = JSON.stringify(data).length;
        if (sz > 12 * 1024 * 1024) return res.status(413).json({ message: "Payload troppo grande (max 12MB)" });
      } catch { return res.status(400).json({ message: "Data non serializzabile" }); }
      // Task #152 — guard difensivo: rifiuta uno snapshot "vuoto" (0
      // transazioni totali, 0 debiti, 0 obiettivi con valori) se il DB
      // ha già contenuto reale. Lo skeleton creato dal setup wizard al
      // primo accesso post-deploy NON deve mai sovrascrivere dati
      // esistenti. Bypass esplicito tramite header `X-FinPlan-Force-Empty: 1`
      // per i casi in cui l'utente vuole davvero azzerare.
      const force = req.get("X-FinPlan-Force-Empty") === "1";
      if (!force && isEmptyFinplanSnapshot(data)) {
        const existing = await storage.getFinplanData(profile.organizationId);
        if (existing && !isEmptyFinplanSnapshot(existing.data)) {
          console.warn(
            `[finplan] PUT blocked: empty snapshot would overwrite non-empty data (org=${profile.organizationId}, existing updatedAt=${existing.updatedAt?.toISOString?.() ?? existing.updatedAt})`,
          );
          return res.status(409).json({
            message: "Refused: empty payload would overwrite non-empty existing data",
            code: "FINPLAN_EMPTY_OVERWRITE_BLOCKED",
            existingUpdatedAt: existing.updatedAt,
          });
        }
      }
      const row = await storage.upsertFinplanData(profile.organizationId, data, profile.id);
      res.json({ ok: true, updatedAt: row.updatedAt });
    } catch (e) {
      console.error("[finplan] PUT error:", e);
      res.status(500).json({ message: "Error saving finplan data" });
    }
  });

  // === SYSTEM CONFIG (super admin calculation defaults) ===
  app.get("/api/system-config", isAuthenticated, requireModule(ORG_CONFIG_MODULES), async (req: any, res) => {
    try {
      const configs = await storage.getAllSystemConfigs();
      const result: Record<string, any> = {};
      for (const c of configs) {
        result[c.key] = c.config;
      }
      res.json(result);
    } catch (error) {
      res.status(500).json({ message: "Error fetching system config" });
    }
  });

  app.get("/api/system-config/:key", isAuthenticated, requireModule(ORG_CONFIG_MODULES), async (req: any, res) => {
    try {
      const config = await storage.getSystemConfig(req.params.key);
      res.json(config?.config || null);
    } catch (error) {
      res.status(500).json({ message: "Error fetching system config" });
    }
  });

  app.put("/api/system-config/:key", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session.userId;
      const profile = await storage.getProfile(userId);
      if (!profile || profile.role !== "super_admin") {
        return res.status(403).json({ message: "Solo il super admin può modificare i parametri di sistema" });
      }
      const { config } = req.body;
      const result = await storage.upsertSystemConfig(req.params.key, config, userId);
      res.json(result);
    } catch (error) {
      res.status(500).json({ message: "Error saving system config" });
    }
  });

  // === SMTP CONFIG (super admin only) ===
  // GET ritorna la config attualmente attiva (DB merged con env). La password
  // viene mascherata: torniamo solo `passSet: true|false`. La sorgente di
  // ciascun campo è indicata in `sources` per dare al super admin un'idea di
  // cosa arriva da env e cosa è stato salvato dal pannello.
  const smtpConfigSchema = z.object({
    host: z.string().trim().max(255).optional().default(""),
    port: z.coerce.number().int().min(1).max(65535).optional().default(587),
    secure: z.boolean().optional().default(false),
    user: z.string().trim().max(255).optional().default(""),
    pass: z.string().max(1024).optional(),
    from: z.string().trim().max(255).optional().default(""),
    baseUrl: z.string().trim().max(500).optional().default(""),
  });

  app.get("/api/admin/smtp-config", isAuthenticated, async (req: any, res) => {
    try {
      const profile = await storage.getProfile(req.session.userId);
      if (!profile || profile.role !== "super_admin") {
        return res.status(403).json({ message: "Solo il super admin può vedere la configurazione SMTP" });
      }
      const effective = await loadEmailConfig(true);
      const sys = await storage.getSystemConfig(SMTP_CONFIG_KEY);
      const saved = (sys?.config ?? null) as Partial<SmtpConfig> | null;
      res.json({
        // Campi visibili nel form (no password in chiaro)
        host: effective.host,
        port: effective.port,
        secure: effective.secure,
        user: effective.user,
        from: effective.from,
        baseUrl: effective.baseUrl,
        passSet: !!effective.pass,
        // Mostriamo cosa è in DB vs cosa arriva dall'env, così il super admin
        // sa se sta sovrascrivendo un valore d'ambiente.
        savedInDb: saved
          ? {
              host: !!saved.host,
              port: typeof saved.port === "number",
              secure: typeof saved.secure === "boolean",
              user: typeof saved.user === "string" && saved.user.length > 0,
              pass: typeof saved.pass === "string" && saved.pass.length > 0,
              from: !!saved.from,
              baseUrl: !!saved.baseUrl,
            }
          : null,
        envFallback: {
          host: !!process.env.SMTP_HOST?.trim(),
          user: !!process.env.SMTP_USER?.trim(),
          pass: !!process.env.SMTP_PASS,
          from: !!process.env.SMTP_FROM?.trim(),
          baseUrl: !!process.env.APP_BASE_URL?.trim(),
        },
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      res.status(500).json({ message: `Errore lettura SMTP: ${msg}` });
    }
  });

  // PUT salva i campi compilati. Per la password: stringa vuota o omessa =
  // mantieni quella già salvata; stringa non vuota = sostituisci.
  app.put("/api/admin/smtp-config", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session.userId;
      const profile = await storage.getProfile(userId);
      if (!profile || profile.role !== "super_admin") {
        return res.status(403).json({ message: "Solo il super admin può modificare la configurazione SMTP" });
      }
      const parsed = smtpConfigSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Dati non validi", errors: parsed.error.flatten() });
      }
      const existing = await storage.getSystemConfig(SMTP_CONFIG_KEY);
      const prev = (existing?.config ?? {}) as Partial<SmtpConfig>;
      const incoming = parsed.data;
      // Cifratura della password: se è in arrivo una nuova password la cifriamo
      // ora; altrimenti riutilizziamo il valore già presente in DB (che può
      // essere già cifrato o legacy in chiaro — verrà migrato alla prossima load).
      let nextPass: string = "";
      if (incoming.pass && incoming.pass.length > 0) {
        if (!getSecretKey()) {
          return res.status(503).json({
            message:
              "SMTP_SECRET_KEY non configurata sul server: impossibile salvare una nuova password SMTP cifrata. Configura la variabile d'ambiente e riprova.",
          });
        }
        nextPass = encryptSecret(incoming.pass);
      } else if (typeof prev.pass === "string" && prev.pass.length > 0) {
        // Manteniamo il valore esistente: se non è ancora cifrato e abbiamo la
        // chiave lo cifriamo ora (migrazione opportunistica al primo save).
        if (!isEncrypted(prev.pass) && getSecretKey()) {
          nextPass = encryptSecret(prev.pass);
        } else {
          nextPass = prev.pass;
        }
      }
      const next: Partial<SmtpConfig> = {
        host: incoming.host ?? "",
        port: incoming.port ?? 587,
        secure: !!incoming.secure,
        user: incoming.user ?? "",
        from: incoming.from ?? "",
        baseUrl: incoming.baseUrl ?? "",
        pass: nextPass,
      };
      await storage.upsertSystemConfig(SMTP_CONFIG_KEY, next, userId);
      invalidateEmailConfigCache();
      const refreshed = await loadEmailConfig(true);
      res.json({
        ok: true,
        host: refreshed.host,
        port: refreshed.port,
        secure: refreshed.secure,
        user: refreshed.user,
        from: refreshed.from,
        baseUrl: refreshed.baseUrl,
        passSet: !!refreshed.pass,
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      res.status(500).json({ message: `Errore salvataggio SMTP: ${msg}` });
    }
  });

  // POST invia un'email di test usando la config attualmente attiva (post-save
  // se appena salvata). Ritorna esito esplicito con l'errore SMTP se fallisce.
  app.post("/api/admin/smtp-test", isAuthenticated, async (req: any, res) => {
    try {
      const profile = await storage.getProfile(req.session.userId);
      if (!profile || profile.role !== "super_admin") {
        return res.status(403).json({ message: "Solo il super admin può inviare email di test" });
      }
      const schema = z.object({ to: z.string().email("Email destinatario non valida") });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: parsed.error.errors[0]?.message ?? "Email non valida" });
      }
      const cfg = await loadEmailConfig(true);
      if (!cfg.host) {
        return res.status(400).json({ message: "Host SMTP non configurato (nessun valore in DB né in env)" });
      }
      const result = await sendTestEmailWithConfig(
        cfg,
        parsed.data.to,
        profile.email ?? profile.id,
      );
      if (result.ok) {
        res.json({ ok: true, messageId: result.messageId });
      } else {
        res.status(502).json({ ok: false, message: `Invio fallito: ${result.error}` });
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      res.status(500).json({ message: `Errore invio test: ${msg}` });
    }
  });

  // POST verifica la connessione SMTP senza inviare email, usando la config
  // attualmente attiva (DB + env). Sfrutta transporter.verify() di nodemailer.
  app.post("/api/admin/smtp-verify", isAuthenticated, async (req: any, res) => {
    try {
      const profile = await storage.getProfile(req.session.userId);
      if (!profile || profile.role !== "super_admin") {
        return res.status(403).json({ message: "Solo il super admin può verificare la connessione SMTP" });
      }
      const cfg = await loadEmailConfig(true);
      if (!cfg.host) {
        return res.status(400).json({ message: "Host SMTP non configurato (nessun valore in DB né in env)" });
      }
      const result = await verifySmtpConnectionWithConfig(cfg);
      if (result.ok) {
        res.json({ ok: true });
      } else {
        res.status(502).json({ ok: false, message: `Verifica fallita: ${result.error}` });
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      res.status(500).json({ message: `Errore verifica SMTP: ${msg}` });
    }
  });

  // === PDV CONFIGURATIONS ===
  app.get("/api/pdv-configurations", isAuthenticated, requireModule("simulatore"), async (req: any, res) => {
    try {
      const userId = req.session.userId;
      const profile = await storage.getProfile(userId);
      if (!profile?.organizationId) {
        return res.json([]);
      }
      const configs = await storage.getPdvConfigurations(profile.organizationId);
      res.json(configs);
    } catch (error) {
      res.status(500).json({ message: "Error fetching PDV configurations" });
    }
  });

  app.get("/api/pdv-configurations/:id", isAuthenticated, requireModule("simulatore"), async (req: any, res) => {
    try {
      const config = await storage.getPdvConfiguration(req.params.id);
      if (!config) {
        return res.status(404).json({ message: "Configuration not found" });
      }
      res.json(config);
    } catch (error) {
      res.status(500).json({ message: "Error fetching PDV configuration" });
    }
  });

  app.post("/api/pdv-configurations", isAuthenticated, requireModule("simulatore"), async (req: any, res) => {
    try {
      const userId = req.session.userId;
      const profile = await storage.getProfile(userId);
      if (!profile?.organizationId) {
        return res.status(400).json({ message: "User has no organization" });
      }
      const { name, config, configVersion } = req.body;
      if (!name || !name.trim()) {
        return res.status(400).json({ message: "Name is required" });
      }
      const result = await storage.createPdvConfiguration({
        organizationId: profile.organizationId,
        name: name.trim(),
        config,
        configVersion: configVersion || "2.0",
        createdBy: userId,
      });
      res.status(201).json(result);
    } catch (error) {
      res.status(500).json({ message: "Error creating PDV configuration" });
    }
  });

  app.put("/api/pdv-configurations/:id", isAuthenticated, requireModule("simulatore"), async (req: any, res) => {
    try {
      const { name, config } = req.body;
      if (!name || !name.trim()) {
        return res.status(400).json({ message: "Name is required" });
      }
      const result = await storage.updatePdvConfiguration(req.params.id, name.trim(), config);
      res.json(result);
    } catch (error) {
      res.status(500).json({ message: "Error updating PDV configuration" });
    }
  });

  app.delete("/api/pdv-configurations/:id", isAuthenticated, requireModule("simulatore"), async (req: any, res) => {
    try {
      await storage.deletePdvConfiguration(req.params.id);
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ message: "Error deleting PDV configuration" });
    }
  });

  // === GARA CONFIG (per-org, per-month competition configuration) ===
  // Helper: require admin/super_admin role
  const requireAdminRole = async (req: { session: { userId: string } }, res: { status: (code: number) => { json: (data: unknown) => void } }) => {
    const profile = await storage.getProfile(req.session.userId);
    if (!profile?.organizationId) {
      res.status(400).json({ message: "Utente senza organizzazione" });
      return null;
    }
    if (!["super_admin", "admin"].includes(profile.role)) {
      res.status(403).json({ message: "Solo admin può accedere alla configurazione gara" });
      return null;
    }
    return profile;
  };

  app.get("/api/gara-config", isAuthenticated, requireModule(["gara_configurazione", "gara_dashboard"]), async (req: any, res) => {
    try {
      const userId = req.session.userId;
      const profile = await storage.getProfile(userId);
      if (!profile || !profile.organizationId) {
        return res.status(403).json({ message: "Profilo o organizzazione non trovata" });
      }
      const configId = req.query.id as string | undefined;
      if (configId) {
        const config = await storage.getGaraConfigById(configId);
        if (!config || config.organizationId !== profile.organizationId) {
          return res.status(404).json({ message: "Configurazione non trovata" });
        }
        return res.json(config);
      }
      const month = parseInt(req.query.month as string);
      const year = parseInt(req.query.year as string);
      if (isNaN(month) || isNaN(year) || month < 1 || month > 12) {
        return res.status(400).json({ message: "Parametri month/year non validi" });
      }
      const orgId = (profile as any).organizationId || (profile as any).organization_id;
      const config = await storage.getGaraConfig(orgId, month, year);
      res.json(config || null);
    } catch (error) {
      console.error("Error fetching gara config:", error);
      res.status(500).json({ message: "Errore nel recupero della configurazione gara" });
    }
  });

  app.get("/api/gara-config/list", isAuthenticated, requireModule(["gara_configurazione", "gara_dashboard"]), async (req: any, res) => {
    try {
      const userId = req.session.userId;
      const profile = await storage.getProfile(userId);
      if (!profile || !profile.organizationId) {
        return res.status(403).json({ message: "Profilo o organizzazione non trovata" });
      }
      const month = parseInt(req.query.month as string);
      const year = parseInt(req.query.year as string);
      if (isNaN(month) || isNaN(year) || month < 1 || month > 12) {
        return res.status(400).json({ message: "Parametri month/year non validi" });
      }
      const configs = await storage.listGaraConfigs(profile.organizationId!, month, year);
      res.json(configs);
    } catch (error) {
      console.error("Error listing gara configs:", error);
      res.status(500).json({ message: "Errore nel recupero delle configurazioni gara" });
    }
  });

  app.put("/api/gara-config", isAuthenticated, requireModule("gara_configurazione"), async (req: any, res) => {
    try {
      const profile = await requireAdminRole(req, res);
      if (!profile) return;
      const { month, year, config, name, id } = req.body;
      if (!month || !year || month < 1 || month > 12) {
        return res.status(400).json({ message: "Parametri month/year non validi" });
      }
      const configName = name || 'Configurazione';
      let result;
      if (id) {
        const existing = await storage.getGaraConfigById(id);
        if (!existing || existing.organizationId !== profile.organizationId) {
          return res.status(404).json({ message: "Configurazione non trovata" });
        }
        result = await storage.updateGaraConfig(id, config, configName);
      } else {
        result = await storage.createGaraConfig(profile.organizationId!, month, year, configName, config);
      }
      res.json(result);
    } catch (error) {
      console.error("Error saving gara config:", error);
      res.status(500).json({ message: "Errore nel salvataggio della configurazione gara" });
    }
  });

  app.delete("/api/gara-config/:id", isAuthenticated, requireModule("gara_configurazione"), async (req: any, res) => {
    try {
      const profile = await requireAdminRole(req, res);
      if (!profile) return;
      const configId = req.params.id;
      const existing = await storage.getGaraConfigById(configId);
      if (!existing || existing.organizationId !== profile.organizationId) {
        return res.status(404).json({ message: "Configurazione non trovata" });
      }
      await storage.deleteGaraConfig(configId);
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting gara config:", error);
      res.status(500).json({ message: "Errore nell'eliminazione della configurazione gara" });
    }
  });

  app.get("/api/gara-config/history", isAuthenticated, requireModule("gara_configurazione"), async (req: any, res) => {
    try {
      const profile = await requireAdminRole(req, res);
      if (!profile) return;
      const history = await storage.listGaraConfigHistory(profile.organizationId!);
      res.json(history);
    } catch (error) {
      console.error("Error fetching gara config history:", error);
      res.status(500).json({ message: "Errore nel recupero dello storico configurazione gara" });
    }
  });

  interface SimulatorPdvEntry {
    id?: string;
    codicePos: string;
    nome?: string;
    nomeNegozio?: string;
    ragioneSociale?: string;
    tipoPosizione?: string;
    canale?: string;
    clusterMobile?: string;
    clusterFisso?: string;
    clusterCB?: string;
    clusterPIva?: string;
    abilitaEnergia?: boolean;
    abilitaAssicurazioni?: boolean;
    calendar?: { weeklySchedule: { workingDays: number[] } };
  }

  function mapPdvListForGara(pdvList: SimulatorPdvEntry[]) {
    return pdvList.map((pdv) => ({
      id: pdv.id || pdv.codicePos,
      codicePos: pdv.codicePos,
      nome: pdv.nome || pdv.nomeNegozio || "",
      ragioneSociale: pdv.ragioneSociale || "",
      tipoPosizione: pdv.tipoPosizione || "altro",
      canale: pdv.canale || "franchising",
      clusterMobile: pdv.clusterMobile || "",
      clusterFisso: pdv.clusterFisso || "",
      clusterCB: pdv.clusterCB || "",
      clusterPIva: pdv.clusterPIva || "",
      abilitaEnergia: pdv.abilitaEnergia ?? false,
      abilitaAssicurazioni: pdv.abilitaAssicurazioni ?? false,
      calendar: pdv.calendar || { weeklySchedule: { workingDays: [1, 2, 3, 4, 5, 6] } },
    }));
  }

  app.post("/api/gara-config/import-from-simulator", isAuthenticated, requireModule("gara_configurazione"), async (req: any, res) => {
    try {
      const profile = await requireAdminRole(req, res);
      if (!profile) return;
      const { month, year, source, pdvConfigurationId } = req.body;
      if (!month || !year || month < 1 || month > 12) {
        return res.status(400).json({ message: "Parametri month/year non validi" });
      }
      const importSource = source || "pdv_configuration";
      let pdvList: SimulatorPdvEntry[] = [];
      let importedFromMeta: Record<string, unknown> = {};

      let extraConfigFields: Record<string, unknown> = {};

      const calcConfigKeys = [
        "pistaMobile", "pistaFisso", "calendarioGara",
        "pistaMobileConfig", "pistaFissoConfig", "energiaConfig",
        "energiaPdvInGara", "mobileCategories",
        "partnershipRewardConfig", "assicurazioniConfig", "assicurazioniPdvInGara",
        "tipologiaGara", "modalitaInserimentoRS",
        "pistaMobileRSConfig", "pistaFissoRSConfig", "partnershipRewardRSConfig",
      ];

      if (importSource === "organization_config") {
        const orgConfig = await storage.getOrgConfig(profile.organizationId!);
        if (!orgConfig) {
          return res.status(404).json({ message: "Configurazione organizzazione non trovata" });
        }
        const configData = orgConfig.config as Record<string, unknown> | null;
        pdvList = (configData?.puntiVendita || configData?.pdvList || []) as SimulatorPdvEntry[];
        for (const key of calcConfigKeys) {
          if (configData?.[key]) extraConfigFields[key] = configData[key];
        }
        importedFromMeta = {
          type: "organization_config",
          organizationConfigId: orgConfig.id,
          importedAt: new Date().toISOString(),
        };
      } else {
        if (!pdvConfigurationId) {
          return res.status(400).json({ message: "ID configurazione PDV richiesto" });
        }
        const pdvConfig = await storage.getPdvConfiguration(pdvConfigurationId);
        if (!pdvConfig) {
          return res.status(404).json({ message: "Configurazione PDV non trovata" });
        }
        if (pdvConfig.organizationId !== profile.organizationId) {
          return res.status(403).json({ message: "Configurazione PDV non appartiene alla tua organizzazione" });
        }
        const configData = pdvConfig.config as Record<string, unknown> | null;
        pdvList = (configData?.puntiVendita || configData?.pdvList || []) as SimulatorPdvEntry[];
        for (const key of calcConfigKeys) {
          if (configData?.[key]) extraConfigFields[key] = configData[key];
        }
        importedFromMeta = {
          type: "pdv_configuration",
          pdvConfigurationId,
          pdvConfigurationName: pdvConfig.name,
          importedAt: new Date().toISOString(),
        };
      }

      const garaConfigData: Record<string, unknown> = {
        pdvList: mapPdvListForGara(pdvList),
        ...extraConfigFields,
        importedFrom: importedFromMeta,
      };
      const importName = `Importato da ${importSource === 'organization_config' ? 'Config Org' : 'Simulatore'} - ${new Date().toLocaleDateString('it-IT')}`;
      const result = await storage.createGaraConfig(profile.organizationId!, month, year, importName, garaConfigData);
      res.json(result);
    } catch (error) {
      console.error("Error importing gara config from simulator:", error);
      res.status(500).json({ message: "Errore nell'importazione dalla configurazione simulatore" });
    }
  });

  app.get("/api/gara-config/pdv-from-sales", isAuthenticated, requireModule("gara_configurazione"), async (req: any, res) => {
    try {
      const profile = await requireAdminRole(req, res);
      if (!profile) return;
      const month = parseInt(req.query.month as string);
      const year = parseInt(req.query.year as string);
      if (isNaN(month) || isNaN(year) || month < 1 || month > 12) {
        return res.status(400).json({ message: "Parametri month/year non validi" });
      }
      const sales = await storage.getBisuiteSalesByItalianMonth(profile.organizationId!, year, month);
      const pdvMap = new Map<string, { codicePos: string; nomeNegozio: string; ragioneSociale: string; salesCount: number }>();
      for (const sale of sales) {
        const codicePos = sale.codicePos || "";
        if (!codicePos) continue;
        if (!pdvMap.has(codicePos)) {
          pdvMap.set(codicePos, {
            codicePos,
            nomeNegozio: sale.nomeNegozio || "",
            ragioneSociale: sale.ragioneSociale || "",
            salesCount: 0,
          });
        }
        const entry = pdvMap.get(codicePos);
        if (entry) entry.salesCount++;
      }
      const pdvList = Array.from(pdvMap.values()).sort((a, b) => a.codicePos.localeCompare(b.codicePos));
      res.json(pdvList);
    } catch (error) {
      console.error("Error fetching PDVs from sales:", error);
      res.status(500).json({ message: "Errore nel recupero PDV dalle vendite" });
    }
  });

  // === DRMS Commissioning Uploads ===
  const drmsUploadSchema = z.object({
    fileName: z.string().min(1).max(255),
    month: z.number().int().min(1).max(12),
    year: z.number().int().min(2020).max(2100),
    period: z.string().min(1).max(20),
    totaleImporto: z.number().or(z.string()).optional(),
    righeCount: z.number().int().nonnegative(),
    rows: z.array(z.record(z.unknown())),
    overwrite: z.boolean().optional(),
  });

  app.get("/api/drms", isAuthenticated, requireModule("drms_commissioning"), async (req: any, res) => {
    try {
      const profile = await requireAdminRole(req, res);
      if (!profile) return;
      const list = await storage.listDrmsUploads(profile.organizationId!);
      res.json(list);
    } catch (e) {
      console.error("Error listing DRMS uploads:", e);
      res.status(500).json({ message: "Errore nel recupero degli upload DRMS" });
    }
  });

  app.get("/api/drms/by-period", isAuthenticated, requireModule("drms_commissioning"), async (req: any, res) => {
    try {
      const profile = await requireAdminRole(req, res);
      if (!profile) return;
      const month = parseInt(req.query.month as string);
      const year = parseInt(req.query.year as string);
      if (isNaN(month) || isNaN(year) || month < 1 || month > 12) {
        return res.status(400).json({ message: "Parametri month/year non validi" });
      }
      const upload = await storage.getDrmsUploadByPeriod(profile.organizationId!, month, year);
      res.json(upload || null);
    } catch (e) {
      console.error("Error fetching DRMS by period:", e);
      res.status(500).json({ message: "Errore nel recupero del DRMS per periodo" });
    }
  });

  app.get("/api/drms/:id", isAuthenticated, requireModule("drms_commissioning"), async (req: any, res) => {
    try {
      const profile = await requireAdminRole(req, res);
      if (!profile) return;
      const upload = await storage.getDrmsUpload(req.params.id);
      if (!upload || upload.organizationId !== profile.organizationId) {
        return res.status(404).json({ message: "Upload DRMS non trovato" });
      }
      res.json(upload);
    } catch (e) {
      console.error("Error fetching DRMS upload:", e);
      res.status(500).json({ message: "Errore nel recupero dell'upload DRMS" });
    }
  });

  app.post("/api/drms", isAuthenticated, requireModule("drms_commissioning"), async (req: any, res) => {
    try {
      const profile = await requireAdminRole(req, res);
      if (!profile) return;
      const parsed = drmsUploadSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Dati DRMS non validi", errors: parsed.error.flatten() });
      }
      const { fileName, month, year, period, totaleImporto, righeCount, rows, overwrite } = parsed.data;

      if (overwrite) {
        await storage.deleteDrmsUploadsByPeriod(profile.organizationId!, month, year);
      } else {
        const existing = await storage.getDrmsUploadByPeriod(profile.organizationId!, month, year);
        if (existing) {
          return res.status(409).json({ message: "Esiste già un DRMS per questo periodo. Usa overwrite=true per sovrascriverlo.", existingId: existing.id });
        }
      }

      const result = await storage.createDrmsUpload({
        organizationId: profile.organizationId!,
        month,
        year,
        fileName,
        period,
        totaleImporto: totaleImporto !== undefined ? String(totaleImporto) : '0',
        righeCount,
        rows,
        uploadedBy: profile.id,
      });
      res.json({ id: result.id, month: result.month, year: result.year, period: result.period, righeCount: result.righeCount });
    } catch (e) {
      console.error("Error saving DRMS upload:", e);
      res.status(500).json({ message: "Errore nel salvataggio dell'upload DRMS" });
    }
  });

  app.delete("/api/drms/:id", isAuthenticated, requireModule("drms_commissioning"), async (req: any, res) => {
    try {
      const profile = await requireAdminRole(req, res);
      if (!profile) return;
      const upload = await storage.getDrmsUpload(req.params.id);
      if (!upload || upload.organizationId !== profile.organizationId) {
        return res.status(404).json({ message: "Upload DRMS non trovato" });
      }
      await storage.deleteDrmsUpload(req.params.id);
      res.json({ ok: true });
    } catch (e) {
      console.error("Error deleting DRMS upload:", e);
      res.status(500).json({ message: "Errore nell'eliminazione dell'upload DRMS" });
    }
  });

  // === Incentivazione interna (gare addetto, Task #170) ===
  // Config per org+mese+anno: sezioni/piste/target/lucchetti, categorie
  // connettore Accessori/Servizi, festività. Admin-editabile in-app.
  app.get("/api/incentivazione/config", isAuthenticated, requireModule("incentivazione_interna"), async (req: any, res) => {
    try {
      const profile = await storage.getProfile(req.session.userId);
      if (!profile?.organizationId) return res.status(403).json({ error: "Accesso non autorizzato" });
      const month = parseInt(String(req.query.month), 10);
      const year = parseInt(String(req.query.year), 10);
      if (!month || !year || month < 1 || month > 12) return res.status(400).json({ error: "Mese/anno non validi" });
      const row = await storage.getIncentivazioneConfig(profile.organizationId, month, year);
      const config = normalizeConfig(row?.config ?? null, year);
      res.json({ month, year, config, updatedAt: row?.updatedAt ?? null, isDefault: !row });
    } catch (e) {
      console.error("Incentivazione config get error:", e);
      res.status(500).json({ error: "Errore nel recupero della configurazione" });
    }
  });

  app.put("/api/incentivazione/config", isAuthenticated, requireModule("incentivazione_interna"), async (req: any, res) => {
    try {
      const profile = await requireAdminRole(req, res);
      if (!profile) return;
      const month = parseInt(String(req.body.month), 10);
      const year = parseInt(String(req.body.year), 10);
      if (!month || !year || month < 1 || month > 12) return res.status(400).json({ error: "Mese/anno non validi" });
      const config = normalizeConfig(req.body.config ?? null, year);
      const row = await storage.upsertIncentivazioneConfig(profile.organizationId!, month, year, config as unknown as Record<string, unknown>, profile.id);
      res.json({ month, year, config, updatedAt: row.updatedAt });
    } catch (e) {
      console.error("Incentivazione config put error:", e);
      res.status(500).json({ error: "Errore nel salvataggio della configurazione" });
    }
  });

  // === Multi-config (Task #273): gestione configurazioni con nome ===
  // Più configurazioni possono coesistere per org+mese+anno (nomi diversi).
  // La gestione (CRUD) è riservata ad admin/super_admin; gli operatori
  // ricevono l'elenco {id, name} del periodo dentro la dashboard.
  app.get("/api/incentivazione/configs", isAuthenticated, requireModule("incentivazione_interna"), async (req: any, res) => {
    try {
      const profile = await requireAdminRole(req, res);
      if (!profile) return;
      const month = req.query.month !== undefined ? parseInt(String(req.query.month), 10) : undefined;
      const year = req.query.year !== undefined ? parseInt(String(req.query.year), 10) : undefined;
      if ((month !== undefined && (!month || month < 1 || month > 12)) || (year !== undefined && !year)) {
        return res.status(400).json({ error: "Mese/anno non validi" });
      }
      const rows = await storage.listIncentivazioneConfigs(profile.organizationId!, month, year);
      res.json(rows.map((r) => ({
        id: r.id, month: r.month, year: r.year, name: r.name,
        updatedAt: r.updatedAt, createdAt: r.createdAt,
      })));
    } catch (e) {
      console.error("Incentivazione configs list error:", e);
      res.status(500).json({ error: "Errore nel recupero delle configurazioni" });
    }
  });

  app.get("/api/incentivazione/configs/:id", isAuthenticated, requireModule("incentivazione_interna"), async (req: any, res) => {
    try {
      const profile = await requireAdminRole(req, res);
      if (!profile) return;
      const row = await storage.getIncentivazioneConfigById(profile.organizationId!, String(req.params.id));
      if (!row) return res.status(404).json({ error: "Configurazione non trovata" });
      res.json({
        id: row.id, month: row.month, year: row.year, name: row.name,
        config: normalizeConfig(row.config ?? null, row.year), updatedAt: row.updatedAt,
      });
    } catch (e) {
      console.error("Incentivazione config detail error:", e);
      res.status(500).json({ error: "Errore nel recupero della configurazione" });
    }
  });

  // Crea una nuova configurazione (con nome). Con `sourceId` duplica una
  // configurazione esistente (regole di gara copiate).
  app.post("/api/incentivazione/configs", isAuthenticated, requireModule("incentivazione_interna"), async (req: any, res) => {
    try {
      const profile = await requireAdminRole(req, res);
      if (!profile) return;
      const month = parseInt(String(req.body.month), 10);
      const year = parseInt(String(req.body.year), 10);
      const name = String(req.body.name ?? "").trim();
      if (!month || !year || month < 1 || month > 12) return res.status(400).json({ error: "Mese/anno non validi" });
      if (!name) return res.status(400).json({ error: "Nome obbligatorio" });
      const siblings = await storage.listIncentivazioneConfigs(profile.organizationId!, month, year);
      if (siblings.some((s) => s.name.toLowerCase() === name.toLowerCase())) {
        return res.status(409).json({ error: "Esiste già una configurazione con questo nome per il periodo" });
      }
      let config: Record<string, unknown>;
      if (req.body.sourceId) {
        const source = await storage.getIncentivazioneConfigById(profile.organizationId!, String(req.body.sourceId));
        if (!source) return res.status(404).json({ error: "Configurazione di origine non trovata" });
        config = normalizeConfig(source.config ?? null, year) as unknown as Record<string, unknown>;
      } else {
        config = normalizeConfig(req.body.config ?? null, year) as unknown as Record<string, unknown>;
      }
      const row = await storage.createIncentivazioneConfig(profile.organizationId!, month, year, name, config, profile.id);
      res.status(201).json({ id: row.id, month: row.month, year: row.year, name: row.name, config, updatedAt: row.updatedAt });
    } catch (e) {
      console.error("Incentivazione config create error:", e);
      res.status(500).json({ error: "Errore nella creazione della configurazione" });
    }
  });

  // Rinomina e/o aggiorna le regole di gara di una configurazione.
  app.patch("/api/incentivazione/configs/:id", isAuthenticated, requireModule("incentivazione_interna"), async (req: any, res) => {
    try {
      const profile = await requireAdminRole(req, res);
      if (!profile) return;
      const existing = await storage.getIncentivazioneConfigById(profile.organizationId!, String(req.params.id));
      if (!existing) return res.status(404).json({ error: "Configurazione non trovata" });
      const patch: { name?: string; config?: Record<string, unknown> } = {};
      if (req.body.name !== undefined) {
        const name = String(req.body.name ?? "").trim();
        if (!name) return res.status(400).json({ error: "Nome obbligatorio" });
        const siblings = await storage.listIncentivazioneConfigs(profile.organizationId!, existing.month, existing.year);
        if (siblings.some((s) => s.id !== existing.id && s.name.toLowerCase() === name.toLowerCase())) {
          return res.status(409).json({ error: "Esiste già una configurazione con questo nome per il periodo" });
        }
        patch.name = name;
      }
      if (req.body.config !== undefined) {
        patch.config = normalizeConfig(req.body.config ?? null, existing.year) as unknown as Record<string, unknown>;
      }
      const row = await storage.updateIncentivazioneConfig(profile.organizationId!, existing.id, patch, profile.id);
      res.json({
        id: row!.id, month: row!.month, year: row!.year, name: row!.name,
        config: normalizeConfig(row!.config ?? null, row!.year), updatedAt: row!.updatedAt,
      });
    } catch (e) {
      console.error("Incentivazione config patch error:", e);
      res.status(500).json({ error: "Errore nell'aggiornamento della configurazione" });
    }
  });

  app.delete("/api/incentivazione/configs/:id", isAuthenticated, requireModule("incentivazione_interna"), async (req: any, res) => {
    try {
      const profile = await requireAdminRole(req, res);
      if (!profile) return;
      const existing = await storage.getIncentivazioneConfigById(profile.organizationId!, String(req.params.id));
      if (!existing) return res.status(404).json({ error: "Configurazione non trovata" });
      await storage.deleteIncentivazioneConfig(profile.organizationId!, existing.id);
      res.json({ ok: true });
    } catch (e) {
      console.error("Incentivazione config delete error:", e);
      res.status(500).json({ error: "Errore nell'eliminazione della configurazione" });
    }
  });

  // Dashboard data: calendario + valenze caricate + Accessori/Servizi live,
  // filtrate per operatore (isolamento per-addetto come Customer Journey).
  // Con più configurazioni nel periodo, il segmento opzionale :configId
  // seleziona quale usare (default: la prima/storica). Le valenze restano
  // per org+mese+anno, condivise tra le configurazioni del periodo.
  app.get("/api/incentivazione/dashboard/:month/:year{/:configId}", isAuthenticated, requireModule("incentivazione_interna"), async (req: any, res) => {
    try {
      const profile = await storage.getProfile(req.session.userId);
      if (!profile?.organizationId) return res.status(403).json({ error: "Accesso non autorizzato" });
      const month = parseInt(String(req.params.month), 10);
      const year = parseInt(String(req.params.year), 10);
      if (!month || !year || month < 1 || month > 12) return res.status(400).json({ error: "Mese/anno non validi" });

      const cfgRows = await storage.listIncentivazioneConfigs(profile.organizationId, month, year);
      const requestedId = req.params.configId ? String(req.params.configId) : null;
      const cfgRow = requestedId
        ? cfgRows.find((r) => r.id === requestedId)
        : cfgRows[0];
      if (requestedId && !cfgRow) return res.status(404).json({ error: "Configurazione non trovata" });
      const config = normalizeConfig(cfgRow?.config ?? null, year);
      const calendar = buildCalendar(year, month, config.holidays);

      // Filtro operatore: null = admin/super (vede tutto), array = solo i propri
      // addetti (anche vuoto => nessun dato, mai leak del tenant).
      const addettiFilter = profile.role === "operatore"
        ? (profile.bisuiteAddetti ?? []).map((a) => normN(a)).filter(Boolean)
        : null;
      const allowed = (name: string) => addettiFilter === null || addettiFilter.includes(normN(name));

      const valenzeRows = await storage.listIncentivazioneValenze(profile.organizationId, month, year);
      const valenze: Record<string, { fileName: string; uploadedAt: Date | null; rows: any[] }> = {};
      for (const v of valenzeRows) {
        const rows = Array.isArray(v.rows) ? (v.rows as any[]) : [];
        valenze[v.sectionId] = {
          fileName: v.fileName,
          uploadedAt: v.uploadedAt,
          rows: rows.filter((r) => allowed(String(r?.name ?? ""))),
        };
      }

      const liveAll = await storage.aggregateAccessoriServizi(
        profile.organizationId, calendar.from, calendar.to, config.catAcc, config.catServ,
      );
      const live = liveAll.filter((l) => allowed(l.name));
      const lastBisuiteSync = await storage.getLastBisuiteSync(profile.organizationId);

      res.json({
        month, year, config, calendar, valenze, live, lastBisuiteSync,
        configId: cfgRow?.id ?? null,
        configName: cfgRow?.name ?? null,
        configs: cfgRows.map((r) => ({ id: r.id, name: r.name })),
      });
    } catch (e) {
      console.error("Incentivazione dashboard error:", e);
      res.status(500).json({ error: "Errore nel recupero della dashboard" });
    }
  });

  // Salva le valenze di una sezione (rows già parsate dal client via SheetJS).
  app.post("/api/incentivazione/valenze", isAuthenticated, requireModule("incentivazione_interna"), async (req: any, res) => {
    try {
      const profile = await requireAdminRole(req, res);
      if (!profile) return;
      const month = parseInt(String(req.body.month), 10);
      const year = parseInt(String(req.body.year), 10);
      const sectionId = String(req.body.sectionId ?? "").trim();
      const fileName = String(req.body.fileName ?? "valenze.xlsx").trim();
      const rows = Array.isArray(req.body.rows) ? req.body.rows : null;
      if (!month || !year || month < 1 || month > 12) return res.status(400).json({ error: "Mese/anno non validi" });
      if (!SECTION_IDS.includes(sectionId as any)) return res.status(400).json({ error: "Sezione non valida" });
      if (!rows || !rows.length) return res.status(400).json({ error: "Nessuna riga valida" });
      const saved = await storage.upsertIncentivazioneValenze({
        organizationId: profile.organizationId!,
        month, year, sectionId, fileName, rows, uploadedBy: profile.id,
      });
      res.json({ ok: true, sectionId, count: rows.length, uploadedAt: saved.uploadedAt });
    } catch (e) {
      console.error("Incentivazione valenze post error:", e);
      res.status(500).json({ error: "Errore nel salvataggio delle valenze" });
    }
  });

  app.delete("/api/incentivazione/valenze", isAuthenticated, requireModule("incentivazione_interna"), async (req: any, res) => {
    try {
      const profile = await requireAdminRole(req, res);
      if (!profile) return;
      const month = parseInt(String(req.query.month), 10);
      const year = parseInt(String(req.query.year), 10);
      const sectionId = String(req.query.sectionId ?? "").trim();
      if (!month || !year || !SECTION_IDS.includes(sectionId as any)) return res.status(400).json({ error: "Parametri non validi" });
      await storage.deleteIncentivazioneValenze(profile.organizationId!, month, year, sectionId);
      res.json({ ok: true });
    } catch (e) {
      console.error("Incentivazione valenze delete error:", e);
      res.status(500).json({ error: "Errore nell'eliminazione delle valenze" });
    }
  });

  // === ADMIN: Import RS/PDV from BiSuite sales ===
  app.get("/api/admin/bisuite-rs-pdv", isAuthenticated, requireModule("vendite_bisuite"), async (req: any, res) => {
    try {
      const userId = req.session.userId;
      const profile = await storage.getProfile(userId);
      if (!profile || !["super_admin", "admin"].includes(profile.role)) {
        return res.status(403).json({ message: "Forbidden" });
      }
      if (!profile.organizationId) {
        return res.json({ ragioniSociali: [], puntiVendita: [] });
      }
      const sales = await storage.getBisuiteSales(profile.organizationId);
      const rsSet = new Set<string>();
      const pdvMap = new Map<string, { codicePos: string; nomeNegozio: string; ragioneSociale: string; salesCount: number }>();
      for (const sale of sales) {
        const rsTrimmed = (sale.ragioneSociale || "").trim();
        if (rsTrimmed) rsSet.add(rsTrimmed);
        const codicePos = sale.codicePos || "";
        if (!codicePos) continue;
        if (!pdvMap.has(codicePos)) {
          pdvMap.set(codicePos, {
            codicePos,
            nomeNegozio: sale.nomeNegozio || "",
            ragioneSociale: sale.ragioneSociale || "",
            salesCount: 0,
          });
        }
        const entry = pdvMap.get(codicePos);
        if (entry) entry.salesCount++;
      }
      res.json({
        ragioniSociali: Array.from(rsSet).sort(),
        puntiVendita: Array.from(pdvMap.values()).sort((a, b) => a.codicePos.localeCompare(b.codicePos)),
      });
    } catch (error) {
      console.error("Error fetching RS/PDV from BiSuite:", error);
      res.status(500).json({ message: "Errore nel recupero dati BiSuite" });
    }
  });

  // === ADMIN: Dipendenti from BiSuite sales ===
  app.get("/api/admin/bisuite-dipendenti", isAuthenticated, requireModule(["vendite_bisuite", "customer_journey"]), async (req: any, res) => {
    try {
      const userId = req.session.userId;
      const profile = await storage.getProfile(userId);
      if (!profile || !["super_admin", "admin"].includes(profile.role)) {
        return res.status(403).json({ message: "Forbidden" });
      }
      if (!profile.organizationId) {
        return res.json([]);
      }
      const sales = await storage.getBisuiteSales(profile.organizationId);
      const dipendenteMap = new Map<string, { nome: string; pdvMap: Map<string, { codicePos: string; nomeNegozio: string; vendite: number }> }>();
      for (const sale of sales) {
        const nome = (sale.nomeAddetto || "").trim();
        if (!nome) continue;
        const nomeKey = nome.toUpperCase();
        if (!dipendenteMap.has(nomeKey)) {
          dipendenteMap.set(nomeKey, { nome, pdvMap: new Map() });
        }
        const dip = dipendenteMap.get(nomeKey)!;
        const codicePos = (sale.codicePos || "").trim();
        if (codicePos) {
          if (!dip.pdvMap.has(codicePos)) {
            dip.pdvMap.set(codicePos, { codicePos, nomeNegozio: sale.nomeNegozio || "", vendite: 0 });
          }
          dip.pdvMap.get(codicePos)!.vendite++;
        }
      }
      const result = Array.from(dipendenteMap.values())
        .map(d => ({
          nome: d.nome,
          totaleVendite: Array.from(d.pdvMap.values()).reduce((sum, p) => sum + p.vendite, 0),
          pdv: Array.from(d.pdvMap.values()).sort((a, b) => b.vendite - a.vendite),
        }))
        .sort((a, b) => a.nome.localeCompare(b.nome, 'it'));
      res.json(result);
    } catch (error) {
      console.error("Error fetching dipendenti from BiSuite:", error);
      res.status(500).json({ message: "Errore nel recupero dipendenti" });
    }
  });

  // === ADMIN: Team Management ===
  app.get("/api/admin/team", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session.userId;
      const profile = await storage.getProfile(userId);
      if (!profile || !["super_admin", "admin"].includes(profile.role)) {
        return res.status(403).json({ message: "Forbidden" });
      }
      if (!profile.organizationId) {
        return res.json([]);
      }
      const members = await storage.getProfilesByOrg(profile.organizationId);
      res.json(members);
    } catch (error) {
      res.status(500).json({ message: "Error fetching team" });
    }
  });

  app.put("/api/admin/team/:id", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session.userId;
      const profile = await storage.getProfile(userId);
      if (!profile || !["super_admin", "admin"].includes(profile.role)) {
        return res.status(403).json({ message: "Forbidden" });
      }
      const { fullName, email } = req.body;
      const updated = await storage.updateProfile(req.params.id, { fullName, email });
      res.json(updated);
    } catch (error) {
      res.status(500).json({ message: "Error updating user" });
    }
  });

  app.delete("/api/admin/team/:id", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session.userId;
      const profile = await storage.getProfile(userId);
      if (!profile || !["super_admin", "admin"].includes(profile.role)) {
        return res.status(403).json({ message: "Forbidden" });
      }
      await storage.deleteProfile(req.params.id);
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ message: "Error deleting user" });
    }
  });

  // === SUPER ADMIN: Organizations ===
  app.get("/api/super-admin/organizations", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session.userId;
      const profile = await storage.getProfile(userId);
      if (!profile || profile.role !== "super_admin") {
        return res.status(403).json({ message: "Forbidden" });
      }
      const orgs = await storage.getOrganizations();
      res.json(orgs);
    } catch (error) {
      res.status(500).json({ message: "Error fetching organizations" });
    }
  });

  app.post("/api/super-admin/organizations", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session.userId;
      const profile = await storage.getProfile(userId);
      if (!profile || profile.role !== "super_admin") {
        return res.status(403).json({ message: "Forbidden" });
      }
      const { name } = req.body;
      const org = await storage.createOrganization({ name });
      res.status(201).json(org);
    } catch (error) {
      res.status(500).json({ message: "Error creating organization" });
    }
  });

  // GET enabled modules for an organization (super-admin only)
  const getOrgModulesHandler = async (req: any, res: any) => {
    try {
      const profile = await storage.getProfile(req.session.userId);
      if (!profile || profile.role !== "super_admin") {
        return res.status(403).json({ message: "Forbidden" });
      }
      const org = await storage.getOrganization(req.params.id);
      if (!org) return res.status(404).json({ message: "Organizzazione non trovata" });
      res.json({ enabledModules: org.enabledModules || {} });
    } catch (e) {
      res.status(500).json({ message: "Errore lettura moduli" });
    }
  };
  app.get("/api/super-admin/organizations/:id/modules", isAuthenticated, getOrgModulesHandler);
  // Alias per allineamento naming admin
  app.get("/api/admin/organizations/:id/modules", isAuthenticated, getOrgModulesHandler);

  // PUT enabled modules for an organization (super-admin only)
  const putOrgModulesHandler = async (req: any, res: any) => {
    try {
      const profile = await storage.getProfile(req.session.userId);
      if (!profile || profile.role !== "super_admin") {
        return res.status(403).json({ message: "Forbidden" });
      }
      const body = req.body?.enabledModules;
      if (!body || typeof body !== "object" || Array.isArray(body)) {
        return res.status(400).json({ message: "enabledModules deve essere un oggetto" });
      }
      // Sanitize: solo chiavi note e valori boolean
      const sanitized: Record<string, boolean> = {};
      for (const k of MODULE_KEYS) {
        if (k in body) sanitized[k] = body[k] !== false;
      }
      const updated = await storage.updateOrganization(req.params.id, {
        enabledModules: sanitized,
      });
      res.json({ enabledModules: updated.enabledModules || {} });
    } catch (e) {
      console.error("Error updating modules:", e);
      res.status(500).json({ message: "Errore aggiornamento moduli" });
    }
  };
  app.put("/api/super-admin/organizations/:id/modules", isAuthenticated, putOrgModulesHandler);
  app.put("/api/admin/organizations/:id/modules", isAuthenticated, putOrgModulesHandler);

  // (PUT toggle finplan-preload eliminato in Task #148 insieme alle route
  // di preload; vedi nota in testa al file.)

  app.get("/api/super-admin/profiles", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session.userId;
      const profile = await storage.getProfile(userId);
      if (!profile || profile.role !== "super_admin") {
        return res.status(403).json({ message: "Forbidden" });
      }
      // Get all profiles across all orgs
      const orgs = await storage.getOrganizations();
      const allProfiles: any[] = [];
      for (const org of orgs) {
        const members = await storage.getProfilesByOrg(org.id);
        allProfiles.push(...members);
      }
      // Also get profiles without org
      res.json(allProfiles);
    } catch (error) {
      res.status(500).json({ message: "Error fetching profiles" });
    }
  });

  // === ADMIN API aliases (matching frontend fetch calls) ===
  app.get("/api/auth/user", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session.userId;
      const profile = await storage.getProfile(userId);
      if (!profile) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      let organization = null;
      let organizationBrands: { id: string; name: string }[] = [];
      if (profile.organizationId) {
        organization = await storage.getOrganization(profile.organizationId);
        organizationBrands = (await storage.getOrganizationBrands(profile.organizationId))
          .map((b) => ({ id: b.id, name: b.name }));
      }
      res.json({ ...profile, passwordHash: undefined, organization, organizationBrands });
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch user" });
    }
  });

  app.get("/api/admin/team-members", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session.userId;
      const profile = await storage.getProfile(userId);
      if (!profile || !["super_admin", "admin"].includes(profile.role)) {
        return res.status(403).json({ message: "Forbidden" });
      }
      if (!profile.organizationId) return res.json([]);
      const members = await storage.getProfilesByOrg(profile.organizationId);
      res.json(members);
    } catch (error) {
      res.status(500).json({ message: "Error fetching team members" });
    }
  });

  app.get("/api/admin/organizations", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session.userId;
      const profile = await storage.getProfile(userId);
      if (!profile || profile.role !== "super_admin") {
        return res.status(403).json({ message: "Forbidden" });
      }
      const orgs = await storage.getOrganizations();
      res.json(orgs);
    } catch (error) {
      res.status(500).json({ message: "Error fetching organizations" });
    }
  });

  // === BRAND (operatori telefonici, Task #277) — solo super_admin ===
  // Catalogo globale di brand + associazione multiselect alle organizzazioni.
  const requireSuperAdmin = async (req: any, res: any): Promise<boolean> => {
    const profile = await storage.getProfile(req.session.userId);
    if (!profile || profile.role !== "super_admin") {
      res.status(403).json({ message: "Solo il super admin può gestire i brand" });
      return false;
    }
    return true;
  };

  app.get("/api/admin/brands", isAuthenticated, async (req: any, res) => {
    try {
      if (!(await requireSuperAdmin(req, res))) return;
      const list = await storage.getBrands();
      // Includiamo il conteggio associazioni per la conferma di eliminazione.
      const orgMap = await storage.getAllOrganizationBrandIds();
      const counts: Record<string, number> = {};
      for (const ids of Object.values(orgMap)) {
        for (const id of ids) counts[id] = (counts[id] ?? 0) + 1;
      }
      res.json(list.map((b) => ({ ...b, orgCount: counts[b.id] ?? 0 })));
    } catch (error) {
      res.status(500).json({ message: "Errore nel caricamento dei brand" });
    }
  });

  app.post("/api/admin/brands", isAuthenticated, async (req: any, res) => {
    try {
      if (!(await requireSuperAdmin(req, res))) return;
      const parsed = insertBrandSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: parsed.error.errors[0]?.message ?? "Nome brand non valido" });
      }
      const existing = await storage.getBrandByNameCi(parsed.data.name);
      if (existing) {
        return res.status(409).json({ message: `Esiste già un brand con questo nome (${existing.name})` });
      }
      const brand = await storage.createBrand({ name: parsed.data.name });
      res.status(201).json(brand);
    } catch (error) {
      res.status(500).json({ message: "Errore nella creazione del brand" });
    }
  });

  app.patch("/api/admin/brands/:id", isAuthenticated, async (req: any, res) => {
    try {
      if (!(await requireSuperAdmin(req, res))) return;
      const parsed = insertBrandSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: parsed.error.errors[0]?.message ?? "Nome brand non valido" });
      }
      const brand = await storage.getBrand(req.params.id);
      if (!brand) return res.status(404).json({ message: "Brand non trovato" });
      const dupe = await storage.getBrandByNameCi(parsed.data.name);
      if (dupe && dupe.id !== brand.id) {
        return res.status(409).json({ message: `Esiste già un brand con questo nome (${dupe.name})` });
      }
      const updated = await storage.updateBrand(brand.id, parsed.data.name);
      res.json(updated);
    } catch (error) {
      res.status(500).json({ message: "Errore nella modifica del brand" });
    }
  });

  app.delete("/api/admin/brands/:id", isAuthenticated, async (req: any, res) => {
    try {
      if (!(await requireSuperAdmin(req, res))) return;
      const brand = await storage.getBrand(req.params.id);
      if (!brand) return res.status(404).json({ message: "Brand non trovato" });
      const removedAssociations = await storage.countBrandAssociations(brand.id);
      // Le associazioni org↔brand vengono rimosse in cascata (FK).
      await storage.deleteBrand(brand.id);
      res.json({ ok: true, removedAssociations });
    } catch (error) {
      res.status(500).json({ message: "Errore nell'eliminazione del brand" });
    }
  });

  // Mappa orgId -> brandIds per il pannello super admin.
  app.get("/api/admin/organization-brands", isAuthenticated, async (req: any, res) => {
    try {
      if (!(await requireSuperAdmin(req, res))) return;
      res.json(await storage.getAllOrganizationBrandIds());
    } catch (error) {
      res.status(500).json({ message: "Errore nel caricamento delle associazioni brand" });
    }
  });

  app.get("/api/admin/organizations/:id/brands", isAuthenticated, async (req: any, res) => {
    try {
      if (!(await requireSuperAdmin(req, res))) return;
      const org = await storage.getOrganization(req.params.id);
      if (!org) return res.status(404).json({ message: "Organizzazione non trovata" });
      res.json({ brandIds: await storage.getOrganizationBrandIds(org.id) });
    } catch (error) {
      res.status(500).json({ message: "Errore nel caricamento dei brand dell'organizzazione" });
    }
  });

  // PUT sostituisce l'insieme dei brand associati (multiselect).
  app.put("/api/admin/organizations/:id/brands", isAuthenticated, async (req: any, res) => {
    try {
      if (!(await requireSuperAdmin(req, res))) return;
      const org = await storage.getOrganization(req.params.id);
      if (!org) return res.status(404).json({ message: "Organizzazione non trovata" });
      const schema = z.object({ brandIds: z.array(z.string().min(1)).max(200) });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "brandIds deve essere un array di id" });
      }
      // Verifica che tutti i brand esistano prima di scrivere.
      const all = await storage.getBrands();
      const validIds = new Set(all.map((b) => b.id));
      const unknown = parsed.data.brandIds.filter((id) => !validIds.has(id));
      if (unknown.length > 0) {
        return res.status(400).json({ message: `Brand inesistenti: ${unknown.join(", ")}` });
      }
      const saved = await storage.setOrganizationBrands(org.id, parsed.data.brandIds);
      res.json({ ok: true, brandIds: saved });
    } catch (error) {
      res.status(500).json({ message: "Errore nel salvataggio dei brand dell'organizzazione" });
    }
  });

  app.get("/api/admin/profiles", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session.userId;
      const profile = await storage.getProfile(userId);
      if (!profile || profile.role !== "super_admin") {
        return res.status(403).json({ message: "Forbidden" });
      }
      const orgs = await storage.getOrganizations();
      const allProfiles: any[] = [];
      for (const org of orgs) {
        const members = await storage.getProfilesByOrg(org.id);
        allProfiles.push(...members);
      }
      res.json(allProfiles);
    } catch (error) {
      res.status(500).json({ message: "Error fetching profiles" });
    }
  });

  app.post("/api/admin/create-user", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session.userId;
      const adminProfile = await storage.getProfile(userId);
      if (!adminProfile || !["super_admin", "admin"].includes(adminProfile.role)) {
        return res.status(403).json({ message: "Forbidden" });
      }
      const { email, password, fullName, full_name, organizationId, organization_id, role, organizationName } = req.body;
      const resolvedFullName = fullName || full_name;
      const resolvedEmail = email;
      const resolvedRole = role || "operatore";

      if (!resolvedEmail || !resolvedFullName) {
        return res.status(400).json({ error: "Email e nome sono obbligatori" });
      }

      // L'admin di tenant non può assegnare il ruolo super_admin (solo il
      // super_admin può creare altri super_admin).
      if (adminProfile.role === "admin" && resolvedRole === "super_admin") {
        return res.status(403).json({ error: "Non puoi assegnare il ruolo super_admin" });
      }

      const existing = await storage.getProfileByEmail(resolvedEmail);
      if (existing) {
        return res.status(400).json({ error: "Esiste già un utente con questa email" });
      }

      // Scoping organizzazione: l'admin crea utenti SOLO nella propria org
      // (ignora qualsiasi organizationId passato dal client). Il super_admin
      // può indicare un'org esplicita o crearne una nuova al volo.
      let resolvedOrgId = adminProfile.role === "super_admin"
        ? (organizationId || organization_id || adminProfile.organizationId)
        : adminProfile.organizationId;

      if (organizationName && adminProfile.role === "super_admin") {
        const newOrg = await storage.createOrganization({ name: organizationName });
        resolvedOrgId = newOrg.id;
      }

      let passwordHash: string | undefined;
      if (password) {
        passwordHash = await bcrypt.hash(password, 10);
      }

      const newProfile = await storage.upsertProfile({
        id: `user_${Date.now()}`,
        email: resolvedEmail,
        fullName: resolvedFullName,
        passwordHash,
        organizationId: resolvedOrgId,
        role: resolvedRole,
      });
      res.json(newProfile);
    } catch (error) {
      console.error("Error creating user:", error);
      res.status(500).json({ error: "Error creating user" });
    }
  });

  app.post("/api/admin/update-user", isAuthenticated, async (req: any, res) => {
    try {
      const currentUserId = req.session.userId;
      const profile = await storage.getProfile(currentUserId);
      if (!profile || !["super_admin", "admin"].includes(profile.role)) {
        return res.status(403).json({ message: "Forbidden" });
      }
      const { user_id, userId: userIdAlt, full_name, fullName, email, role } = req.body;
      const targetId = user_id || userIdAlt;
      const resolvedFullName = fullName || full_name;
      if (profile.role === "admin") {
        const targetProfile = await storage.getProfile(targetId);
        if (!targetProfile || targetProfile.organizationId !== profile.organizationId) {
          return res.status(403).json({ message: "Cannot update users outside your organization" });
        }
      }
      const updateData: any = {};
      if (resolvedFullName) updateData.fullName = resolvedFullName;
      if (email) updateData.email = email;
      if (role && ["super_admin", "admin"].includes(profile.role)) {
        if (profile.role === "admin" && role === "super_admin") {
          return res.status(403).json({ error: "Non puoi assegnare il ruolo super_admin" });
        }
        updateData.role = role;
      }
      const updated = await storage.updateProfile(targetId, updateData);
      res.json(updated);
    } catch (error) {
      res.status(500).json({ error: "Error updating user" });
    }
  });

  // Associazione operatore ↔ nominativi addetto BiSuite (Task #158): governa
  // il filtro per-operatore su vendite e customer journey.
  app.post("/api/admin/profile-addetti", isAuthenticated, async (req: any, res) => {
    try {
      const profile = await storage.getProfile(req.session.userId);
      if (!profile || !["super_admin", "admin"].includes(profile.role)) {
        return res.status(403).json({ message: "Forbidden" });
      }
      const { user_id, userId: userIdAlt, addetti } = req.body as { user_id?: string; userId?: string; addetti?: unknown };
      const targetId = user_id || userIdAlt;
      if (!targetId) return res.status(400).json({ error: "user_id obbligatorio" });
      if (!Array.isArray(addetti) || !addetti.every((a) => typeof a === "string")) {
        return res.status(400).json({ error: "addetti deve essere un array di stringhe" });
      }
      const targetProfile = await storage.getProfile(targetId);
      if (!targetProfile) return res.status(404).json({ error: "Utente non trovato" });
      if (profile.role === "admin" && targetProfile.organizationId !== profile.organizationId) {
        return res.status(403).json({ error: "Non puoi modificare utenti di un'altra organizzazione" });
      }
      const cleaned = Array.from(new Set(
        (addetti as string[]).map((a) => a.trim()).filter(Boolean),
      ));
      const updated = await storage.updateProfile(targetId, { bisuiteAddetti: cleaned });
      res.json(updated);
    } catch (error) {
      console.error("Error updating profile addetti:", error);
      res.status(500).json({ error: "Errore nell'aggiornamento degli addetti" });
    }
  });

  app.post("/api/admin/update-organization", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session.userId;
      const profile = await storage.getProfile(userId);
      if (!profile || !["super_admin", "admin"].includes(profile.role)) {
        return res.status(403).json({ error: "Non autorizzato" });
      }
      const { organizationId, name } = req.body;
      if (!organizationId || !name || !name.trim()) {
        return res.status(400).json({ error: "Nome organizzazione obbligatorio" });
      }
      if (profile.role === "admin" && profile.organizationId !== organizationId) {
        return res.status(403).json({ error: "Non puoi modificare altre organizzazioni" });
      }
      const updated = await storage.updateOrganization(organizationId, { name: name.trim() });
      res.json(updated);
    } catch (error) {
      console.error("Error updating organization:", error);
      res.status(500).json({ error: "Errore nell'aggiornamento dell'organizzazione" });
    }
  });

  // === ORGANIZATION BRANDING (logo per PDF) ===
  // Logo is stored as a base64 dataURL inside `organization_config.config.brandingLogoDataUrl`.
  // GET is available to any authenticated user belonging to an org so PDFs can
  // be auto-stamped. PUT is admin/super_admin only.
  app.get("/api/organization-branding/logo", isAuthenticated, async (req: any, res) => {
    try {
      const profile = await storage.getProfile(req.session.userId);
      if (!profile?.organizationId) {
        return res.json({ logoDataUrl: null });
      }
      const cfg = await storage.getOrgConfig(profile.organizationId);
      const data = (cfg?.config as Record<string, unknown> | null) || {};
      const logo = typeof data.brandingLogoDataUrl === "string" ? data.brandingLogoDataUrl : null;
      res.json({ logoDataUrl: logo });
    } catch (e) {
      res.status(500).json({ message: "Errore nel recupero del logo" });
    }
  });

  app.put("/api/organization-branding/logo", isAuthenticated, async (req: any, res) => {
    try {
      const profile = await storage.getProfile(req.session.userId);
      if (!profile || !["admin", "super_admin"].includes(profile.role)) {
        return res.status(403).json({ message: "Solo admin/super_admin possono modificare il logo" });
      }
      if (!profile.organizationId) {
        return res.status(400).json({ message: "Utente senza organizzazione" });
      }
      const { logoDataUrl } = req.body ?? {};
      let value: string | null = null;
      if (logoDataUrl !== null && logoDataUrl !== undefined && logoDataUrl !== "") {
        if (typeof logoDataUrl !== "string") {
          return res.status(400).json({ message: "logoDataUrl non valido" });
        }
        const m = logoDataUrl.match(/^data:image\/(png|jpe?g);base64,([A-Za-z0-9+/=]+)$/);
        if (!m) {
          return res.status(400).json({ message: "Formato logo non valido (solo PNG o JPEG, dataURL base64)" });
        }
        // Approx decoded size in bytes ≈ base64 length * 3/4. Limit ~2 MB raw.
        const approxBytes = Math.floor((m[2].length * 3) / 4);
        if (approxBytes > 2 * 1024 * 1024) {
          return res.status(413).json({ message: "Logo troppo grande (max 2 MB)" });
        }
        value = logoDataUrl;
      }
      const cur = await storage.getOrgConfig(profile.organizationId);
      const curCfg = (cur?.config as Record<string, unknown> | null) || {};
      const nextCfg: Record<string, unknown> = { ...curCfg };
      if (value === null) delete nextCfg.brandingLogoDataUrl;
      else nextCfg.brandingLogoDataUrl = value;
      const result = await storage.upsertOrgConfig(profile.organizationId, nextCfg, cur?.configVersion || "2.0");
      const out = (result.config as Record<string, unknown> | null) || {};
      res.json({ logoDataUrl: typeof out.brandingLogoDataUrl === "string" ? out.brandingLogoDataUrl : null });
    } catch (e) {
      res.status(500).json({ message: "Errore nel salvataggio del logo" });
    }
  });

  app.post("/api/admin/delete-entity", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session.userId;
      const profile = await storage.getProfile(userId);
      if (!profile || !["super_admin", "admin"].includes(profile.role)) {
        return res.status(403).json({ message: "Forbidden" });
      }
      const { entity_type, entity_id, type, id } = req.body;
      const resolvedType = entity_type || type;
      const resolvedId = entity_id || id;
      if (resolvedType === "user" || resolvedType === "profile") {
        if (profile.role === "admin") {
          const targetProfile = await storage.getProfile(resolvedId);
          if (!targetProfile || targetProfile.organizationId !== profile.organizationId) {
            return res.status(403).json({ message: "Cannot delete users outside your organization" });
          }
        }
        await storage.deleteProfile(resolvedId);
      } else if (resolvedType === "organization") {
        if (profile.role !== "super_admin") {
          return res.status(403).json({ message: "Only super admins can delete organizations" });
        }
        await storage.deleteOrganization(resolvedId);
      }
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Error deleting entity" });
    }
  });

  // === ADMIN: Change user password ===
  app.post("/api/admin/change-password", isAuthenticated, async (req: any, res) => {
    try {
      const currentUserId = req.session.userId;
      const adminProfile = await storage.getProfile(currentUserId);
      if (!adminProfile || !["super_admin", "admin"].includes(adminProfile.role)) {
        return res.status(403).json({ error: "Forbidden" });
      }
      const { userId: targetUserId, newPassword } = req.body;
      if (!targetUserId || !newPassword || newPassword.length < 6) {
        return res.status(400).json({ error: "Password deve avere almeno 6 caratteri" });
      }
      if (adminProfile.role === "admin") {
        const targetProfile = await storage.getProfile(targetUserId);
        if (!targetProfile || targetProfile.organizationId !== adminProfile.organizationId) {
          return res.status(403).json({ error: "Non puoi modificare utenti di altre organizzazioni" });
        }
      }
      const passwordHash = await bcrypt.hash(newPassword, 10);
      await storage.updateProfile(targetUserId, { passwordHash });
      res.json({ success: true });
    } catch (error) {
      console.error("Error changing password:", error);
      res.status(500).json({ error: "Errore nel cambio password" });
    }
  });

  // === USER: Change own password ===
  app.post("/api/auth/change-password", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session.userId;
      const profile = await storage.getProfile(userId);
      if (!profile || !profile.passwordHash) {
        return res.status(400).json({ error: "Profilo non trovato" });
      }
      const { currentPassword, newPassword } = req.body;
      if (!currentPassword || !newPassword) {
        return res.status(400).json({ error: "Password attuale e nuova sono obbligatorie" });
      }
      if (newPassword.length < 6) {
        return res.status(400).json({ error: "La nuova password deve avere almeno 6 caratteri" });
      }
      const valid = await bcrypt.compare(currentPassword, profile.passwordHash);
      if (!valid) {
        return res.status(401).json({ error: "Password attuale non corretta" });
      }
      const passwordHash = await bcrypt.hash(newPassword, 10);
      await storage.updateProfile(userId, { passwordHash });
      res.json({ success: true });
    } catch (error) {
      console.error("Error changing own password:", error);
      res.status(500).json({ error: "Errore nel cambio password" });
    }
  });

  // === USER: Modifica le proprie informazioni (nome, email) ===
  // Self-service per QUALSIASI utente autenticato (operatore/admin/super_admin)
  // limitato al proprio profilo. Il ruolo NON è modificabile da qui (resta una
  // competenza admin via /api/admin/update-user).
  app.patch("/api/auth/profile", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session.userId;
      const profile = await storage.getProfile(userId);
      if (!profile) {
        return res.status(404).json({ error: "Profilo non trovato" });
      }
      const { fullName, full_name, email } = req.body ?? {};
      const resolvedFullName = fullName ?? full_name;
      const updateData: { fullName?: string; email?: string } = {};

      if (typeof resolvedFullName === "string" && resolvedFullName.trim()) {
        updateData.fullName = resolvedFullName.trim();
      }

      if (typeof email === "string" && email.trim()) {
        const newEmail = email.trim();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail)) {
          return res.status(400).json({ error: "Email non valida" });
        }
        if (newEmail !== profile.email) {
          const existing = await storage.getProfileByEmail(newEmail);
          if (existing && existing.id !== userId) {
            return res.status(400).json({ error: "Esiste già un utente con questa email" });
          }
          updateData.email = newEmail;
        }
      }

      if (Object.keys(updateData).length === 0) {
        return res.status(400).json({ error: "Nessun dato da aggiornare" });
      }

      const updated = await storage.updateProfile(userId, updateData);
      res.json({ ...updated, passwordHash: undefined });
    } catch (error) {
      console.error("Error updating own profile:", error);
      res.status(500).json({ error: "Errore nell'aggiornamento del profilo" });
    }
  });

  // === Profilo: preferenza notifiche email ===
  app.patch("/api/auth/email-preferences", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session.userId;
      const profile = await storage.getProfile(userId);
      if (!profile) {
        return res.status(404).json({ error: "Profilo non trovato" });
      }
      if (!["admin", "super_admin"].includes(profile.role)) {
        return res.status(403).json({ error: "Solo admin / super admin possono gestire le notifiche email" });
      }
      const { emailNotificationsDisabled } = req.body ?? {};
      if (typeof emailNotificationsDisabled !== "boolean") {
        return res.status(400).json({ error: "emailNotificationsDisabled deve essere boolean" });
      }
      const updated = await storage.updateProfile(userId, { emailNotificationsDisabled });
      res.json({ emailNotificationsDisabled: updated.emailNotificationsDisabled });
    } catch (error) {
      console.error("Error updating email preferences:", error);
      res.status(500).json({ error: "Errore nell'aggiornamento delle preferenze email" });
    }
  });

  // === ADMIN: Toggle user active status ===
  app.post("/api/admin/toggle-active", isAuthenticated, async (req: any, res) => {
    try {
      const currentUserId = req.session.userId;
      const adminProfile = await storage.getProfile(currentUserId);
      if (!adminProfile || !["super_admin", "admin"].includes(adminProfile.role)) {
        return res.status(403).json({ error: "Forbidden" });
      }
      const { userId: targetUserId, isActive } = req.body;
      if (!targetUserId || typeof isActive !== "boolean") {
        return res.status(400).json({ error: "Parametri non validi" });
      }
      if (targetUserId === currentUserId) {
        return res.status(400).json({ error: "Non puoi disattivare te stesso" });
      }
      if (adminProfile.role === "admin") {
        const targetProfile = await storage.getProfile(targetUserId);
        if (!targetProfile || targetProfile.organizationId !== adminProfile.organizationId) {
          return res.status(403).json({ error: "Non puoi modificare utenti di altre organizzazioni" });
        }
      }
      const updated = await storage.updateProfile(targetUserId, { isActive });
      res.json(updated);
    } catch (error) {
      console.error("Error toggling user active:", error);
      res.status(500).json({ error: "Errore nell'aggiornamento dello stato utente" });
    }
  });

  // ── BiSuite API: helpers ──────────────────────────────────────────
  const BISUITE_ALLOWED_HOSTS = ["db.bisuite.app", "db1.bisuite.app", "85.94.215.97"];

  function validateBisuiteUrl(urlStr: string): boolean {
    try {
      const u = new URL(urlStr);
      return BISUITE_ALLOWED_HOSTS.includes(u.hostname);
    } catch {
      return false;
    }
  }

  const BISUITE_SALES_PATH = "/api/v1/sales/full";

  function deriveBaseUrl(apiUrlStr: string): string {
    try {
      const u = new URL(apiUrlStr);
      return `${u.protocol}//${u.host}`;
    } catch {
      return "https://db1.bisuite.app";
    }
  }

  function deriveSalesEndpoint(apiUrlStr: string): string {
    return `${deriveBaseUrl(apiUrlStr)}${BISUITE_SALES_PATH}`;
  }

  function deriveTokenEndpoint(apiUrlStr: string): string {
    return `${deriveBaseUrl(apiUrlStr)}/api/v1/oauth/token`;
  }

  async function getBisuiteToken(tokenUrl: string, clientId: string, clientSecret: string): Promise<string> {
    const resp = await fetch(tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        grant_type: "client_credentials",
        client_id: clientId,
        client_secret: clientSecret,
      }),
    });
    if (!resp.ok) {
      const body = await resp.text();
      throw new Error(`OAuth token request failed (${resp.status}): ${body}`);
    }
    const data = (await resp.json()) as { access_token?: string };
    if (!data.access_token) throw new Error("No access_token in OAuth response");
    return data.access_token;
  }

  // ── GET credentials ─────────────────────────────────────────────
  app.get("/api/admin/bisuite-credentials", isAuthenticated, requireModule(["vendite_bisuite", "customer_journey"]), async (req: any, res) => {
    try {
      const profile = await storage.getProfile(req.session.userId);
      if (!profile || !["super_admin", "admin"].includes(profile.role)) {
        return res.status(403).json({ error: "Solo gli amministratori possono accedere alle credenziali BiSuite" });
      }

      // Il super_admin può indicare qualsiasi org; l'admin di tenant è
      // vincolato alla propria organizzazione.
      const orgId = profile.role === "super_admin"
        ? (req.query.org_id as string)
        : (profile.organizationId ?? undefined);
      if (!orgId) return res.status(400).json({ error: "org_id è obbligatorio" });
      if (profile.role !== "super_admin" && orgId !== profile.organizationId) {
        return res.status(403).json({ error: "Non puoi accedere alle credenziali di un'altra organizzazione" });
      }

      const orgConfig = await storage.getOrgConfig(orgId);
      const cfg = orgConfig?.config as Record<string, unknown> | undefined;
      const creds = cfg?.bisuiteCredentials as Record<string, string> | undefined;

      if (!creds) return res.json(null);

      // Decifra il client_secret per la visualizzazione nel form admin.
      // Se la decifratura fallisce (chiave mancante o payload corrotto)
      // restituiamo stringa vuota: l'admin dovrà reinserire il segreto.
      const rawSecret = creds.client_secret || "";
      let secretForUi = "";
      if (rawSecret) {
        if (isEncrypted(rawSecret)) {
          const dec = decryptSecret(rawSecret);
          secretForUi = dec ?? "";
        } else {
          secretForUi = rawSecret;
        }
      }

      res.json({
        api_url: creds.api_url || "",
        client_id: creds.client_id || "",
        client_secret: secretForUi,
      });
    } catch (error) {
      console.error("Error loading BiSuite credentials:", error);
      res.status(500).json({ error: "Errore nel caricamento delle credenziali" });
    }
  });

  // ── POST credentials (create) ──────────────────────────────────
  app.post("/api/admin/bisuite-credentials", isAuthenticated, requireModule(["vendite_bisuite", "customer_journey"]), async (req: any, res) => {
    try {
      const profile = await storage.getProfile(req.session.userId);
      if (!profile || !["super_admin", "admin"].includes(profile.role)) {
        return res.status(403).json({ error: "Solo gli amministratori possono gestire le credenziali BiSuite" });
      }

      const { organization_id, api_url, client_id, client_secret } = req.body;
      if (!organization_id || !client_id || !client_secret) {
        return res.status(400).json({ error: "organization_id, client_id e client_secret sono obbligatori" });
      }
      if (profile.role !== "super_admin" && organization_id !== profile.organizationId) {
        return res.status(403).json({ error: "Non puoi gestire le credenziali di un'altra organizzazione" });
      }
      if (api_url && !validateBisuiteUrl(api_url)) {
        return res.status(400).json({ error: "URL API non consentito. Utilizzare un host BiSuite valido." });
      }
      if (!getSecretKey()) {
        return res.status(500).json({
          error:
            "SMTP_SECRET_KEY non configurata sul server: impossibile salvare il client_secret BiSuite cifrato. Configura la variabile d'ambiente e riprova.",
        });
      }

      const orgConfig = await storage.getOrgConfig(organization_id);
      const existingConfig = (orgConfig?.config as Record<string, unknown>) || {};

      const encSecret = isEncrypted(client_secret) ? client_secret : encryptSecret(client_secret);
      const updatedConfig = {
        ...existingConfig,
        bisuiteCredentials: { api_url: api_url || "", client_id, client_secret: encSecret },
      };

      await storage.upsertOrgConfig(
        organization_id,
        updatedConfig,
        orgConfig?.configVersion || "2.0",
      );

      res.json({ success: true });
    } catch (error) {
      console.error("Error saving BiSuite credentials:", error);
      res.status(500).json({ error: "Errore nel salvataggio delle credenziali" });
    }
  });

  // ── PUT credentials (update) ────────────────────────────────────
  app.put("/api/admin/bisuite-credentials", isAuthenticated, requireModule(["vendite_bisuite", "customer_journey"]), async (req: any, res) => {
    try {
      const profile = await storage.getProfile(req.session.userId);
      if (!profile || !["super_admin", "admin"].includes(profile.role)) {
        return res.status(403).json({ error: "Solo gli amministratori possono gestire le credenziali BiSuite" });
      }

      const { organization_id, api_url, client_id, client_secret } = req.body;
      if (!organization_id || !client_id || !client_secret) {
        return res.status(400).json({ error: "organization_id, client_id e client_secret sono obbligatori" });
      }
      if (profile.role !== "super_admin" && organization_id !== profile.organizationId) {
        return res.status(403).json({ error: "Non puoi gestire le credenziali di un'altra organizzazione" });
      }
      if (api_url && !validateBisuiteUrl(api_url)) {
        return res.status(400).json({ error: "URL API non consentito. Utilizzare un host BiSuite valido." });
      }
      if (!getSecretKey()) {
        return res.status(500).json({
          error:
            "SMTP_SECRET_KEY non configurata sul server: impossibile salvare il client_secret BiSuite cifrato. Configura la variabile d'ambiente e riprova.",
        });
      }

      const orgConfig = await storage.getOrgConfig(organization_id);
      const existingConfig = (orgConfig?.config as Record<string, unknown>) || {};

      const encSecret = isEncrypted(client_secret) ? client_secret : encryptSecret(client_secret);
      const updatedConfig = {
        ...existingConfig,
        bisuiteCredentials: { api_url: api_url || "", client_id, client_secret: encSecret },
      };

      await storage.upsertOrgConfig(
        organization_id,
        updatedConfig,
        orgConfig?.configVersion || "2.0",
      );

      res.json({ success: true });
    } catch (error) {
      console.error("Error updating BiSuite credentials:", error);
      res.status(500).json({ error: "Errore nell'aggiornamento delle credenziali" });
    }
  });

  // ── Telegram report vendite giornaliero (Task #239) ─────────────
  // GET config: token decifrato per il form admin (stesso pattern delle
  // credenziali BiSuite qui sopra).
  app.get("/api/admin/telegram-report", isAuthenticated, requireModule("vendite_bisuite"), async (req: any, res) => {
    try {
      const profile = await storage.getProfile(req.session.userId);
      if (!profile || !["super_admin", "admin"].includes(profile.role)) {
        return res.status(403).json({ error: "Solo gli amministratori possono accedere alla configurazione Telegram" });
      }
      const orgId = profile.role === "super_admin"
        ? (req.query.org_id as string)
        : (profile.organizationId ?? undefined);
      if (!orgId) return res.status(400).json({ error: "org_id è obbligatorio" });
      if (profile.role !== "super_admin" && orgId !== profile.organizationId) {
        return res.status(403).json({ error: "Non puoi accedere alla configurazione di un'altra organizzazione" });
      }

      const orgConfig = await storage.getOrgConfig(orgId);
      const cfg = orgConfig?.config as Record<string, unknown> | undefined;
      const tg = cfg?.telegramReport as Record<string, unknown> | undefined;
      if (!tg) return res.json(null);

      // MAI restituire il token in chiaro: il logger API serializza i
      // body JSON delle risposte e il token finirebbe nei log. La UI
      // riceve solo il flag has_token; per cambiarlo si digita un token
      // nuovo, per mantenerlo si lascia il campo vuoto.
      const rawToken = typeof tg.bot_token === "string" ? tg.bot_token : "";
      res.json({
        enabled: tg.enabled === true,
        has_token: rawToken.length > 0,
        chat_id: typeof tg.chat_id === "string" ? tg.chat_id : "",
      });
    } catch (error) {
      console.error("Error loading Telegram report config:", error);
      res.status(500).json({ error: "Errore nel caricamento della configurazione Telegram" });
    }
  });

  // POST config: salva token (cifrato), chat id e flag abilitazione.
  app.post("/api/admin/telegram-report", isAuthenticated, requireModule("vendite_bisuite"), async (req: any, res) => {
    try {
      const profile = await storage.getProfile(req.session.userId);
      if (!profile || !["super_admin", "admin"].includes(profile.role)) {
        return res.status(403).json({ error: "Solo gli amministratori possono gestire la configurazione Telegram" });
      }
      const { organization_id, enabled, bot_token, chat_id, clear_token } = req.body ?? {};
      if (!organization_id || typeof organization_id !== "string") {
        return res.status(400).json({ error: "organization_id è obbligatorio" });
      }
      if (profile.role !== "super_admin" && organization_id !== profile.organizationId) {
        return res.status(403).json({ error: "Non puoi gestire la configurazione di un'altra organizzazione" });
      }
      const token = typeof bot_token === "string" ? bot_token.trim() : "";
      const chatId = typeof chat_id === "string" ? chat_id.trim() : "";
      const isEnabled = enabled === true;
      const clearToken = clear_token === true;
      if (token && !getSecretKey()) {
        return res.status(500).json({
          error:
            "SMTP_SECRET_KEY non configurata sul server: impossibile salvare il bot token cifrato. Configura la variabile d'ambiente e riprova.",
        });
      }

      const orgConfig = await storage.getOrgConfig(organization_id);
      const existingConfig = (orgConfig?.config as Record<string, unknown>) || {};
      // Token vuoto nel payload = mantieni quello già salvato (la GET non
      // lo restituisce mai in chiaro, quindi la UI non può rimandarlo).
      // clear_token: true = rimozione esplicita del token salvato.
      const existingTg = existingConfig.telegramReport as Record<string, unknown> | undefined;
      const existingToken = typeof existingTg?.bot_token === "string" ? existingTg.bot_token : "";
      const encToken = clearToken
        ? ""
        : token
          ? (isEncrypted(token) ? token : encryptSecret(token))
          : existingToken;
      if (isEnabled && (!encToken || !chatId)) {
        return res.status(400).json({ error: "Per abilitare il report servono bot token e chat ID" });
      }
      // Il forecast/obiettivi vive ora nella Configurazione gara
      // (gara_config.config.venditeForecast), per-mese: qui restano solo
      // token, chat_id e flag di abilitazione. Un eventuale forecast già
      // salvato in questo blocco viene preservato ma non più usato.
      const existingForecast = existingTg?.forecast;
      const updatedConfig = {
        ...existingConfig,
        telegramReport: {
          enabled: isEnabled,
          bot_token: encToken,
          chat_id: chatId,
          ...(existingForecast !== undefined ? { forecast: existingForecast } : {}),
        },
      };
      await storage.upsertOrgConfig(
        organization_id,
        updatedConfig,
        orgConfig?.configVersion || "2.0",
      );
      res.json({ success: true });
    } catch (error) {
      console.error("Error saving Telegram report config:", error);
      res.status(500).json({ error: "Errore nel salvataggio della configurazione Telegram" });
    }
  });

  // POST test: invia SUBITO il report del giorno corrente al gruppo usando
  // le credenziali passate nel body (così l'admin testa la config appena
  // digitata, anche prima di salvarla). Niente sync BiSuite: usa i dati
  // già presenti nel DB per dare una risposta rapida.
  app.post("/api/admin/telegram-report-test", isAuthenticated, requireModule("vendite_bisuite"), async (req: any, res) => {
    try {
      const profile = await storage.getProfile(req.session.userId);
      if (!profile || !["super_admin", "admin"].includes(profile.role)) {
        return res.status(403).json({ error: "Solo gli amministratori possono inviare il test Telegram" });
      }
      const { organization_id, bot_token, chat_id } = req.body ?? {};
      if (!organization_id || typeof organization_id !== "string") {
        return res.status(400).json({ error: "organization_id è obbligatorio" });
      }
      if (profile.role !== "super_admin" && organization_id !== profile.organizationId) {
        return res.status(403).json({ error: "Non puoi inviare test per un'altra organizzazione" });
      }
      let token = typeof bot_token === "string" ? bot_token.trim() : "";
      let chatId = typeof chat_id === "string" ? chat_id.trim() : "";
      // Fallback alla config salvata se il body non fornisce le credenziali.
      if (!token || !chatId) {
        const orgConfig = await storage.getOrgConfig(organization_id);
        const cfg = orgConfig?.config as Record<string, unknown> | undefined;
        const tg = cfg?.telegramReport as Record<string, unknown> | undefined;
        if (!token && typeof tg?.bot_token === "string" && tg.bot_token) {
          token = isEncrypted(tg.bot_token) ? (decryptSecret(tg.bot_token) ?? "") : tg.bot_token;
        }
        if (!chatId && typeof tg?.chat_id === "string") chatId = tg.chat_id.trim();
      }
      if (isEncrypted(token)) {
        token = decryptSecret(token) ?? "";
      }
      if (!token || !chatId) {
        return res.status(400).json({ error: "Bot token e chat ID sono obbligatori per il test" });
      }

      const org = await storage.getOrganization(organization_id);
      // syncFirst: come lo scheduler, aggiorna le vendite BiSuite del giorno
      // PRIMA di inviare, così il report di prova riflette le ultime vendite.
      // Un errore di sync non blocca l'invio (stessa semantica dello scheduler).
      const result = await sendDailyReportForOrg({
        orgId: organization_id,
        orgName: org?.name ?? "Organizzazione",
        botToken: token,
        chatId,
        timeLabel: "test",
        syncFirst: true,
      });
      if (!result.ok) {
        return res.status(400).json({ error: `Invio Telegram fallito: ${result.error}` });
      }
      // Il messaggio di testo è arrivato; se l'allegato HTML è fallito lo
      // segnaliamo senza considerare il test fallito (stessa semantica dello
      // scheduler: l'allegato non blocca il report).
      if (result.docError) {
        return res.json({
          success: true,
          warning: `Messaggio inviato, ma allegato HTML fallito: ${result.docError}`,
        });
      }
      res.json({ success: true });
    } catch (error) {
      console.error("Error sending Telegram test report:", error);
      res.status(500).json({ error: "Errore nell'invio del report di test" });
    }
  });

  // ── POST bisuite-api (proxy) ────────────────────────────────────
  app.post("/api/admin/bisuite-api", isAuthenticated, requireModule(["vendite_bisuite", "customer_journey"]), async (req: any, res) => {
    try {
      const profile = await storage.getProfile(req.session.userId);
      if (!profile || !["super_admin", "admin"].includes(profile.role)) {
        return res.status(403).json({ error: "Solo gli amministratori possono utilizzare l'API BiSuite" });
      }

      const { action, organization_id, start_date, end_date, api_url, client_id, client_secret } = req.body;

      let apiUrlStr: string;
      let cId: string;
      let cSecret: string;

      if (action === "test_connection" && api_url && client_id && client_secret) {
        if (!validateBisuiteUrl(api_url)) {
          return res.status(400).json({ error: "URL API non consentito. Utilizzare un host BiSuite valido." });
        }
        apiUrlStr = api_url;
        cId = client_id;
        cSecret = client_secret;
      } else if (organization_id) {
        // L'admin di tenant può operare solo sulla propria organizzazione;
        // il super_admin su qualsiasi org.
        if (profile.role !== "super_admin" && organization_id !== profile.organizationId) {
          return res.status(403).json({ error: "Non puoi utilizzare l'API BiSuite di un'altra organizzazione" });
        }
        const orgConfig = await storage.getOrgConfig(organization_id);
        const cfg = orgConfig?.config as Record<string, unknown> | undefined;
        const creds = cfg?.bisuiteCredentials as Record<string, string> | undefined;
        if (!creds || !creds.client_id || !creds.client_secret) {
          return res.status(400).json({ error: "Credenziali BiSuite non configurate per questa organizzazione" });
        }
        apiUrlStr = creds.api_url || "https://db1.bisuite.app";
        cId = creds.client_id;
        // Decifra il client_secret cifrato at-rest. Se la decifratura
        // fallisce (chiave mancante o payload corrotto) rifiutiamo con
        // 500: usare un secret nullo provocherebbe comunque un OAuth
        // failure poco diagnostico.
        if (isEncrypted(creds.client_secret)) {
          const dec = decryptSecret(creds.client_secret);
          if (dec === null) {
            return res.status(500).json({
              error: "Impossibile decifrare il client_secret BiSuite (SMTP_SECRET_KEY mancante o errata).",
            });
          }
          cSecret = dec;
        } else {
          cSecret = creds.client_secret;
        }
      } else {
        return res.status(400).json({ error: "organization_id o credenziali dirette sono obbligatorie" });
      }

      const tokenUrl = deriveTokenEndpoint(apiUrlStr);
      const accessToken = await getBisuiteToken(tokenUrl, cId, cSecret);

      if (action === "test_connection") {
        return res.json({ success: true, message: "Connessione OAuth2 riuscita" });
      }

      if (action === "fetch_sales") {
        const salesUrl = new URL(deriveSalesEndpoint(apiUrlStr));
        if (start_date) salesUrl.searchParams.set("from", start_date);
        if (end_date) salesUrl.searchParams.set("to", end_date);

        const salesResp = await fetch(salesUrl.toString(), {
          method: "GET",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: "application/json",
          },
        });

        if (!salesResp.ok) {
          const errBody = await salesResp.text();
          return res.status(salesResp.status).json({
            error: `BiSuite API error (${salesResp.status})`,
            details: errBody,
          });
        }

        const salesData = await salesResp.json();
        return res.json(salesData);
      }

      return res.status(400).json({ error: `Azione non supportata: ${action}` });
    } catch (error: unknown) {
      console.error("BiSuite API proxy error:", error);
      const msg = error instanceof Error ? error.message : String(error);
      res.status(500).json({
        error: "Errore nella comunicazione con BiSuite",
        details: msg,
      });
    }
  });

  // ── BiSuite Sales Import & Read endpoints ─────────────────────
  function extractSaleFields(sale: any, organizationId: string) {
    const bisuiteId = sale.id || sale.codiceEsterno || 0;
    const dataVenditaStr = sale.dataVendita || sale.createdAt;
    const dataVendita = toItalianWallTime(dataVenditaStr);

    let codicePos = '';
    let nomeNegozio = '';

    const attivitaDiretta = sale.attivita;
    if (attivitaDiretta && typeof attivitaDiretta === 'object' && !Array.isArray(attivitaDiretta)) {
      codicePos = attivitaDiretta.codiceOperatoreWind || '';
      nomeNegozio = attivitaDiretta.nominativo || '';
    }

    if (!codicePos && !nomeNegozio) {
      const attivitaAddetto = sale.addetto?.attivita;
      if (Array.isArray(attivitaAddetto) && attivitaAddetto.length > 0) {
        codicePos = attivitaAddetto[0].codiceOperatoreWind || '';
        nomeNegozio = attivitaAddetto[0].nominativo || '';
      }
    }

    const ragioneSociale = sale.ragioneSociale?.azienda || '';
    const nomeAddetto = sale.addetto?.nominativo || '';
    const nomeCliente = sale.cliente?.nominativo || '';
    const totale = sale.totale || '0';
    const stato = sale.stato || '';
    const categorie = (sale.articoli || [])
      .map((a: any) => a.categoria?.nome || '')
      .filter((c: string) => c)
      .filter((c: string, i: number, arr: string[]) => arr.indexOf(c) === i)
      .join(', ');

    return {
      organizationId,
      bisuiteId: typeof bisuiteId === 'number' ? bisuiteId : parseInt(bisuiteId) || 0,
      dataVendita,
      codicePos,
      nomeNegozio,
      ragioneSociale,
      nomeAddetto,
      nomeCliente,
      totale: String(totale),
      stato,
      categorieArticoli: categorie,
      rawData: sale,
    };
  }

  app.post("/api/admin/bisuite-import", isAuthenticated, requireModule("vendite_bisuite"), async (req: any, res) => {
    try {
      const userId = req.session.userId;
      const profile = await storage.getProfile(userId);
      if (!profile || !["super_admin", "admin"].includes(profile.role)) {
        return res.status(403).json({ error: "Accesso non autorizzato" });
      }

      const { organization_id, start_date, end_date } = req.body;
      if (!organization_id) {
        return res.status(400).json({ error: "organization_id richiesto" });
      }

      // Solo super_admin può triggerare la sync per un'org diversa dalla
      // propria; admin di tenant è limitato alla propria organizzazione
      // (evita IDOR cross-tenant).
      if (profile.role !== "super_admin" && organization_id !== profile.organizationId) {
        return res.status(403).json({ error: "Non puoi importare vendite per altre organizzazioni" });
      }

      try {
        const r = await runBisuiteFetchForOrg(organization_id, {
          startDate: start_date,
          endDate: end_date,
        });
        const partial = r.failedChunks.length > 0;
        const failedMonths = partial ? formatFailedMonths(r.failedChunks) : [];
        const baseMsg = `Sincronizzate ${r.totalFromApi} vendite (nuove ${r.inserted}, aggiornate ${r.updated})`;
        const message = partial
          ? `${baseMsg}. Sync parziale: mesi non aggiornati ${failedMonths.join(", ")}.`
          : baseMsg;
        res.json({
          success: true,
          partial,
          status: partial ? "partial" : "ok",
          message,
          count: r.inserted + r.updated,
          totalFromApi: r.totalFromApi,
          inserted: r.inserted,
          updated: r.updated,
          chunks: r.chunks,
          failedChunks: r.failedChunks,
          failedMonths,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return res.status(500).json({ error: "Errore durante l'importazione", details: msg });
      }
    } catch (error: unknown) {
      console.error("BiSuite import error:", error);
      const msg = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: "Errore durante l'importazione", details: msg });
    }
  });

  // Reconcile (Task #104): fetch del range + eliminazione dei record nello
  // stesso range con `last_seen_at` più vecchio dell'inizio del fetch
  // (= cancellati o accorpati su BiSuite). Idempotente. Ammessi sia query
  // string (`?orgId=...&from=...&to=...`) sia body JSON.
  app.post("/api/admin/bisuite-reconcile", isAuthenticated, requireModule("vendite_bisuite"), async (req: any, res) => {
    try {
      const userId = req.session.userId;
      const profile = await storage.getProfile(userId);
      if (!profile || !["super_admin", "admin"].includes(profile.role)) {
        return res.status(403).json({ error: "Accesso non autorizzato" });
      }

      const orgId = (req.query.orgId as string) || (req.query.organization_id as string) || req.body?.organization_id || req.body?.orgId;
      const from = (req.query.from as string) || req.body?.from || req.body?.start_date;
      const to = (req.query.to as string) || req.body?.to || req.body?.end_date;
      if (!orgId) {
        return res.status(400).json({ error: "orgId richiesto" });
      }
      if (!from || !to) {
        return res.status(400).json({ error: "from e to richiesti (YYYY-MM-DD)" });
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
        return res.status(400).json({ error: "Formato date non valido, atteso YYYY-MM-DD" });
      }
      if (from > to) {
        return res.status(400).json({ error: "from deve essere <= to" });
      }
      if (profile.role !== "super_admin" && orgId !== profile.organizationId) {
        return res.status(403).json({ error: "Non puoi eseguire reconcile per altre organizzazioni" });
      }

      try {
        const r = await runBisuiteFetchForOrg(orgId, {
          startDate: from,
          endDate: to,
          reconcile: true,
        });
        res.json({
          success: true,
          message: r.reconciled
            ? `Sincronizzate ${r.totalFromApi} vendite (nuove ${r.inserted}, aggiornate ${r.updated}); eliminate ${r.reconciled.deleted} obsolete`
            : `Sincronizzate ${r.totalFromApi} vendite (nuove ${r.inserted}, aggiornate ${r.updated}); reconcile saltato per chunk falliti`,
          totalFromApi: r.totalFromApi,
          inserted: r.inserted,
          updated: r.updated,
          chunks: r.chunks,
          failedChunks: r.failedChunks,
          reconciled: r.reconciled ?? null,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return res.status(500).json({ error: "Errore durante il reconcile", details: msg });
      }
    } catch (error: unknown) {
      console.error("BiSuite reconcile error:", error);
      const msg = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: "Errore durante il reconcile", details: msg });
    }
  });

  app.get("/api/bisuite-credentials-status", isAuthenticated, requireModule("vendite_bisuite"), async (req: any, res) => {
    try {
      const profile = await storage.getProfile(req.session.userId);
      if (!profile?.organizationId) {
        return res.status(403).json({ error: "Accesso non autorizzato" });
      }
      const orgConfig = await storage.getOrgConfig(profile.organizationId);
      const cfg = orgConfig?.config as Record<string, any> | undefined;
      const creds = cfg?.bisuiteCredentials;
      const configured = !!(creds?.client_id && creds?.client_secret);
      res.json({ configured });
    } catch (error: unknown) {
      console.error("BiSuite credentials status error:", error);
      res.status(500).json({ error: "Errore nel controllo credenziali" });
    }
  });

  // === Notifiche di sync BiSuite (push agli admin) ===
  // Disponibili solo per admin/super_admin: contengono la lista dei mesi
  // mancanti (status=partial) o l'errore (status=failed) generati dallo
  // scheduler notturno. La pagina Vendite BiSuite resta il punto di
  // riprova, quindi le notifiche linkano lì.
  app.get("/api/bisuite-notifications", isAuthenticated, async (req: any, res) => {
    try {
      const profile = await storage.getProfile(req.session.userId);
      if (!profile?.organizationId) {
        return res.status(403).json({ error: "Accesso non autorizzato" });
      }
      if (!["super_admin", "admin"].includes(profile.role)) {
        return res.status(403).json({ error: "Solo admin può leggere le notifiche di sync" });
      }
      const unreadOnly = req.query.unreadOnly === "true";
      const limitRaw = parseInt(req.query.limit as string, 10);
      const limit = Number.isFinite(limitRaw) && limitRaw > 0 && limitRaw <= 200 ? limitRaw : 50;
      const items = await storage.listBisuiteSyncNotifications(profile.organizationId, { unreadOnly, limit });
      const unread = await storage.countUnreadBisuiteSyncNotifications(profile.organizationId);
      res.json({ items, unread });
    } catch (error: unknown) {
      console.error("BiSuite notifications list error:", error);
      const msg = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: "Errore nel recupero notifiche", details: msg });
    }
  });

  app.post("/api/bisuite-notifications/mark-all-read", isAuthenticated, async (req: any, res) => {
    try {
      const profile = await storage.getProfile(req.session.userId);
      if (!profile?.organizationId) {
        return res.status(403).json({ error: "Accesso non autorizzato" });
      }
      if (!["super_admin", "admin"].includes(profile.role)) {
        return res.status(403).json({ error: "Solo admin può aggiornare le notifiche" });
      }
      await storage.markAllBisuiteSyncNotificationsRead(profile.organizationId);
      res.json({ success: true });
    } catch (error: unknown) {
      console.error("BiSuite notifications mark-all-read error:", error);
      const msg = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: "Errore aggiornamento notifiche", details: msg });
    }
  });

  app.post("/api/bisuite-notifications/:id/read", isAuthenticated, async (req: any, res) => {
    try {
      const profile = await storage.getProfile(req.session.userId);
      if (!profile?.organizationId) {
        return res.status(403).json({ error: "Accesso non autorizzato" });
      }
      if (!["super_admin", "admin"].includes(profile.role)) {
        return res.status(403).json({ error: "Solo admin può aggiornare le notifiche" });
      }
      await storage.markBisuiteSyncNotificationRead(req.params.id, profile.organizationId);
      res.json({ success: true });
    } catch (error: unknown) {
      console.error("BiSuite notifications mark-read error:", error);
      const msg = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: "Errore aggiornamento notifica", details: msg });
    }
  });

  app.post("/api/bisuite-fetch", isAuthenticated, requireModule(["vendite_bisuite", "amministrazione", "gara_dashboard"]), async (req: any, res) => {
    try {
      const profile = await storage.getProfile(req.session.userId);
      if (!profile?.organizationId) {
        return res.status(403).json({ error: "Accesso non autorizzato" });
      }

      const orgId = profile.organizationId;
      const { start_date, end_date } = req.body;

      const orgConfig = await storage.getOrgConfig(orgId);
      const cfg = orgConfig?.config as Record<string, any> | undefined;
      const creds = cfg?.bisuiteCredentials;
      if (!creds?.client_id || !creds?.client_secret) {
        return res.status(400).json({ error: "Credenziali BiSuite non configurate per la tua organizzazione. Contatta il super admin." });
      }

      const r = await runBisuiteFetchForOrg(orgId, {
        startDate: start_date,
        endDate: end_date,
      });

      const partial = r.failedChunks.length > 0;
      const failedMonths = partial ? formatFailedMonths(r.failedChunks) : [];
      const baseMsg = `Sincronizzate ${r.totalFromApi} vendite (nuove ${r.inserted}, aggiornate ${r.updated})`;
      const message = partial
        ? `${baseMsg}. Sync parziale: mesi non aggiornati ${failedMonths.join(", ")}.`
        : baseMsg;

      res.json({
        success: true,
        partial,
        status: partial ? "partial" : "ok",
        message,
        count: r.inserted + r.updated,
        totalFromApi: r.totalFromApi,
        inserted: r.inserted,
        updated: r.updated,
        chunks: r.chunks,
        failedChunks: r.failedChunks,
        failedMonths,
      });
    } catch (error: unknown) {
      console.error("BiSuite fetch error:", error);
      const msg = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: "Errore durante l'importazione", details: msg });
    }
  });

  app.get("/api/bisuite-sales", isAuthenticated, requireModule(["vendite_bisuite", "amministrazione", "gara_dashboard"]), async (req: any, res) => {
    try {
      const userId = req.session.userId;
      const profile = await storage.getProfile(userId);
      if (!profile?.organizationId) {
        return res.status(403).json({ error: "Accesso non autorizzato" });
      }

      const orgId = (req.query.organization_id as string) || profile.organizationId;
      if (profile.role !== "super_admin" && orgId !== profile.organizationId) {
        return res.status(403).json({ error: "Non puoi accedere ai dati di un'altra organizzazione" });
      }

      // Filtro stretto sul giorno italiano (Europe/Rome). Niente widening ±2h:
      // la colonna data_vendita è un timestamp wall-time italiano (senza fuso),
      // quindi confrontiamo direttamente per anno/mese o per data (YYYY-MM-DD).
      // Per default escludiamo le vendite ANNULLATA dai dati aggregati; il
      // chiamante può passare includeAnnullate=true per includerle (usato dalla
      // pagina VenditeBiSuite che mostra anche le righe annullate con badge).
      const includeAnnullate = req.query.includeAnnullate === "true";

      // Filtro per-operatore (Task #158): l'operatore vede solo le vendite il
      // cui addetto rientra nei nominativi BiSuite a lui associati
      // (profile.bisuiteAddetti, match case-insensitive). Admin e super_admin
      // vedono tutte le vendite dell'org.
      const operatorAddetti = profile.role === "operatore"
        ? (profile.bisuiteAddetti ?? []).map((a) => a.toLowerCase().trim()).filter(Boolean)
        : null;
      const applyOperatorFilter = (sales: BisuiteSale[]): BisuiteSale[] => {
        if (!operatorAddetti) return sales;
        if (operatorAddetti.length === 0) return [];
        return sales.filter((s) => operatorAddetti.includes(String(s.nomeAddetto || "").toLowerCase().trim()));
      };

      const yearParam = req.query.year ? parseInt(req.query.year as string, 10) : NaN;
      const monthParam = req.query.month ? parseInt(req.query.month as string, 10) : NaN;
      if (Number.isFinite(yearParam) && Number.isFinite(monthParam) && monthParam >= 1 && monthParam <= 12) {
        const sales = applyOperatorFilter(await storage.getBisuiteSalesByItalianMonth(orgId, yearParam, monthParam, includeAnnullate));
        return res.json({ sales, count: sales.length });
      }

      const fromYMD = toItalianYMD(req.query.from as string | undefined);
      const toYMD = toItalianYMD(req.query.to as string | undefined);
      if (fromYMD === null || toYMD === null) {
        return res.status(400).json({ error: "Parametri from/to non validi (atteso YYYY-MM-DD)" });
      }
      const sales = applyOperatorFilter(await storage.getBisuiteSalesByItalianDateRange(orgId, fromYMD, toYMD, includeAnnullate));
      res.json({ sales, count: sales.length });
    } catch (error: unknown) {
      console.error("BiSuite sales read error:", error);
      const msg = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: "Errore nel recupero vendite", details: msg });
    }
  });

  app.get("/api/admin/bisuite-mapping", isAuthenticated, requireModule("mappatura_bisuite"), async (req: any, res) => {
    try {
      const profile = await storage.getProfile(req.session.userId);
      if (!profile || profile.role !== "super_admin") {
        return res.status(403).json({ error: "Accesso non autorizzato" });
      }

      const sysConfig = await storage.getSystemConfig("bisuite_mapping");
      const mapping = (sysConfig?.config ?? null) as
        | { rules?: BiSuiteMappingRule[]; version?: string }
        | null;
      const savedRules: BiSuiteMappingRule[] = Array.isArray(mapping?.rules)
        ? (mapping!.rules as BiSuiteMappingRule[])
        : [];
      const effectiveRules = getEffectiveRulesForEditor(savedRules);
      if (mapping) {
        res.json({ ...mapping, effectiveRules });
      } else {
        res.json({ effectiveRules });
      }
    } catch (error) {
      console.error("Error loading BiSuite mapping:", error);
      res.status(500).json({ error: "Errore nel caricamento della mappatura" });
    }
  });

  app.put("/api/admin/bisuite-mapping", isAuthenticated, requireModule("mappatura_bisuite"), async (req: any, res) => {
    try {
      const profile = await storage.getProfile(req.session.userId);
      if (!profile || profile.role !== "super_admin") {
        return res.status(403).json({ error: "Accesso non autorizzato" });
      }

      const mapping = req.body?.mapping as
        | { rules?: unknown; version?: string }
        | undefined;
      if (!mapping || !Array.isArray(mapping.rules)) {
        return res.status(400).json({ error: "mapping con rules è obbligatorio" });
      }

      // Defense in depth: never persist synthesized twins. Drop any rule
      // marked synthetic and strip the flag from the rest.
      const sanitizedRules: BiSuiteMappingRule[] = (mapping.rules as BiSuiteMappingRule[])
        .filter((r): r is BiSuiteMappingRule => !!r && !r.synthetic)
        .map((r) => {
          const { synthetic, ...rest } = r;
          void synthetic;
          return rest;
        });
      const sanitizedMapping = { ...mapping, rules: sanitizedRules };
      const effectiveRules = getEffectiveRulesForEditor(sanitizedRules);

      await storage.upsertSystemConfig("bisuite_mapping", sanitizedMapping, profile.id);
      res.json({ success: true, mapping: { ...sanitizedMapping, effectiveRules } });
    } catch (error) {
      console.error("Error saving BiSuite mapping:", error);
      res.status(500).json({ error: "Errore nel salvataggio della mappatura" });
    }
  });

  app.get("/api/bisuite-sales/:id", isAuthenticated, requireModule("vendite_bisuite"), async (req: any, res) => {
    try {
      const userId = req.session.userId;
      const profile = await storage.getProfile(userId);
      if (!profile) return res.status(403).json({ error: "Accesso non autorizzato" });

      const sale = await storage.getBisuiteSale(req.params.id);
      if (!sale) return res.status(404).json({ error: "Vendita non trovata" });

      if (profile.role !== "super_admin" && sale.organizationId !== profile.organizationId) {
        return res.status(403).json({ error: "Accesso non autorizzato" });
      }

      // Filtro per-operatore (Task #158): l'operatore può vedere solo le
      // vendite il cui addetto rientra nei suoi nominativi BiSuite (stesso
      // contratto null-vs-empty usato nella lista): nessun addetto => 403.
      if (profile.role === "operatore") {
        const mine = (profile.bisuiteAddetti ?? []).map((a) => a.toLowerCase().trim()).filter(Boolean);
        const owns = mine.includes(String(sale.nomeAddetto || "").toLowerCase().trim());
        if (!owns) return res.status(403).json({ error: "Accesso non autorizzato" });
      }

      res.json(sale);
    } catch (error: unknown) {
      console.error("BiSuite sale detail error:", error);
      const msg = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: "Errore nel recupero dettaglio", details: msg });
    }
  });

  // ── Customer Journey (Task #158) ────────────────────────────────
  // Lista journey dell'org. Per gli operatori filtra solo le journey che
  // contengono almeno un item gestito dai loro nominativi addetto.
  app.get("/api/customer-journeys", isAuthenticated, requireModule("customer_journey"), async (req: any, res) => {
    try {
      const profile = await storage.getProfile(req.session.userId);
      if (!profile?.organizationId) return res.status(403).json({ error: "Accesso non autorizzato" });
      // Le vendite già scaricate da altre pagine (Vendite BiSuite, Incentivazione,
      // scheduler) vengono riconciliate automaticamente in customer journey, così
      // compaiono senza dover premere "Rigenera da BiSuite". Il reconcile parte solo
      // se le vendite locali sono cambiate dall'ultimo (watermark), quindi i load
      // successivi restano leggeri. Eventuali errori non bloccano la lista.
      try {
        await storage.reconcileCustomerJourneysIfStale(profile.organizationId);
      } catch (e) {
        console.error("Customer journeys auto-reconcile error:", e);
      }
      const addettiFilter = profile.role === "operatore" ? (profile.bisuiteAddetti ?? []) : null;
      const journeys = await storage.listCustomerJourneys(profile.organizationId, addettiFilter);
      // Allega a ogni scheda il riepilogo driver (attivati vs attivabili),
      // così la lista può mostrare lo stato dei 6 driver senza una chiamata
      // di dettaglio per cliente.
      const journeyIds = journeys.map((j) => j.id);
      // openedAt (T0) + addetti dell'operatore servono a classificare la fase di
      // ogni driver (periodo/altrui/precedente) per le pastiglie colorate.
      const openedAtMap = new Map(journeys.map((j) => [j.id, j.openedAt ?? null]));
      const summaries = await storage.getCustomerJourneyDriverSummaries(journeyIds, {
        openedAt: openedAtMap,
        myAddetti: addettiFilter,
      });
      const values = await storage.getCustomerJourneyValues(journeyIds);
      // Facet (negozio/addetto/stato) per i filtri della lista schede (Task #187).
      // Stesso isolamento operatore: un operatore vede solo i valori dei propri
      // item, anche su journey con item di addetti diversi.
      const facets = await storage.getCustomerJourneyItemFacets(journeyIds, addettiFilter);
      const withDrivers = journeys.map((j) => ({
        ...j,
        drivers: summaries.get(j.id) ?? [],
        valore: values.get(j.id) ?? 0,
        pdvs: facets.get(j.id)?.pdvs ?? [],
        addetti: facets.get(j.id)?.addetti ?? [],
        states: facets.get(j.id)?.states ?? [],
      }));
      res.json(withDrivers);
    } catch (error) {
      console.error("Customer journeys list error:", error);
      res.status(500).json({ error: "Errore nel recupero delle customer journey" });
    }
  });

  // Reportistica (Task #187): righe item-level aggregabili per
  // negozio / addetto / ragione sociale. Stessa regola di isolamento della
  // lista: l'operatore vede SOLO gli item dei propri nominativi addetto.
  // DEVE precedere la route `/:id` per non essere intercettata da essa.
  app.get("/api/customer-journeys/report", isAuthenticated, requireModule("customer_journey"), async (req: any, res) => {
    try {
      const profile = await storage.getProfile(req.session.userId);
      if (!profile?.organizationId) return res.status(403).json({ error: "Accesso non autorizzato" });
      const addettiFilter = profile.role === "operatore" ? (profile.bisuiteAddetti ?? []) : null;
      const rows = await storage.getCustomerJourneyReportRows(profile.organizationId, addettiFilter);
      res.json(rows);
    } catch (error) {
      console.error("Customer journey report error:", error);
      res.status(500).json({ error: "Errore nel recupero della reportistica" });
    }
  });

  // Dettaglio journey: anagrafica + items + riepilogo driver
  // (attivati vs attivabili). L'operatore può vedere solo le proprie journey.
  app.get("/api/customer-journeys/:id", isAuthenticated, requireModule("customer_journey"), async (req: any, res) => {
    try {
      const profile = await storage.getProfile(req.session.userId);
      if (!profile?.organizationId) return res.status(403).json({ error: "Accesso non autorizzato" });
      const journey = await storage.getCustomerJourney(req.params.id, profile.organizationId);
      if (!journey) return res.status(404).json({ error: "Customer journey non trovata" });

      const items = await storage.getCustomerJourneyItems(journey.id);

      if (profile.role === "operatore") {
        const mine = (profile.bisuiteAddetti ?? []).map((a) => a.toLowerCase().trim()).filter(Boolean);
        const owns = items.some((it) => mine.includes(String(it.addetto || "").toLowerCase().trim()));
        if (!owns) return res.status(403).json({ error: "Accesso non autorizzato" });
      }

      // Un driver è "attivato" se ha almeno un item in stato non KO e non
      // stornato. L'energia distingue gas/luce ma per il riepilogo conta come
      // singolo driver attivabile.
      const drivers = summarizeDrivers(items.map((it) => ({ driver: it.driver as CjDriver, state: it.state as CjItemState })));

      res.json({ journey, items, drivers });
    } catch (error) {
      console.error("Customer journey detail error:", error);
      res.status(500).json({ error: "Errore nel recupero della customer journey" });
    }
  });

  // Reconcile: ricostruisce le journey dell'org dalle vendite BiSuite.
  app.post("/api/customer-journeys/reconcile", isAuthenticated, requireModule("customer_journey"), async (req: any, res) => {
    try {
      const profile = await storage.getProfile(req.session.userId);
      if (!profile?.organizationId) return res.status(403).json({ error: "Accesso non autorizzato" });
      if (!["super_admin", "admin"].includes(profile.role)) {
        return res.status(403).json({ error: "Solo gli amministratori possono rigenerare le customer journey" });
      }
      const result = await storage.reconcileCustomerJourneys(profile.organizationId);
      res.json(result);
    } catch (error) {
      console.error("Customer journey reconcile error:", error);
      res.status(500).json({ error: "Errore nella rigenerazione delle customer journey" });
    }
  });

  // Config del modulo: data dalla quale si aprono le customer journey.
  app.get("/api/customer-journey-config", isAuthenticated, requireModule("customer_journey"), async (req: any, res) => {
    try {
      const profile = await storage.getProfile(req.session.userId);
      if (!profile?.organizationId) return res.status(403).json({ error: "Accesso non autorizzato" });
      const triggerDate = await storage.getCustomerJourneyTriggerDate(profile.organizationId);
      res.json({
        triggerDate: formatCjTriggerDate(triggerDate),
        defaultTriggerDate: formatCjTriggerDate(CJ_DEFAULT_TRIGGER_DATE),
      });
    } catch (error) {
      console.error("Customer journey config get error:", error);
      res.status(500).json({ error: "Errore nel recupero della configurazione" });
    }
  });

  app.put("/api/customer-journey-config", isAuthenticated, requireModule("customer_journey"), async (req: any, res) => {
    try {
      const profile = await storage.getProfile(req.session.userId);
      if (!profile?.organizationId) return res.status(403).json({ error: "Accesso non autorizzato" });
      if (!["super_admin", "admin"].includes(profile.role)) {
        return res.status(403).json({ error: "Solo gli amministratori possono modificare la configurazione" });
      }
      const { triggerDate } = req.body as { triggerDate?: string | null };
      if (triggerDate != null && triggerDate !== "" && !/^\d{4}-\d{2}-\d{2}$/.test(triggerDate)) {
        return res.status(400).json({ error: "Data non valida (formato atteso AAAA-MM-GG)" });
      }
      const saved = await storage.setCustomerJourneyTriggerDate(
        profile.organizationId,
        triggerDate && triggerDate !== "" ? triggerDate : null,
      );
      res.json({
        triggerDate: formatCjTriggerDate(saved),
        defaultTriggerDate: formatCjTriggerDate(CJ_DEFAULT_TRIGGER_DATE),
      });
    } catch (error) {
      console.error("Customer journey config put error:", error);
      res.status(500).json({ error: "Errore nel salvataggio della configurazione" });
    }
  });

  // Aggiorna manualmente lo stato di un item della journey.
  app.patch("/api/customer-journey-items/:id/state", isAuthenticated, requireModule("customer_journey"), async (req: any, res) => {
    try {
      const profile = await storage.getProfile(req.session.userId);
      if (!profile?.organizationId) return res.status(403).json({ error: "Accesso non autorizzato" });
      const { state } = req.body as { state?: string };
      if (!state || !CJ_ITEM_STATES.includes(state as CjItemState)) {
        return res.status(400).json({ error: "Stato non valido" });
      }
      const item = await storage.getCustomerJourneyItem(req.params.id, profile.organizationId);
      if (!item) return res.status(404).json({ error: "Item non trovato" });
      if (profile.role === "operatore") {
        const mine = (profile.bisuiteAddetti ?? []).map((a) => a.toLowerCase().trim()).filter(Boolean);
        if (!mine.includes(String(item.addetto || "").toLowerCase().trim())) {
          return res.status(403).json({ error: "Accesso non autorizzato" });
        }
      }
      const updated = await storage.updateCustomerJourneyItemState(req.params.id, profile.organizationId, state as CjItemState, profile.id);
      res.json(updated);
    } catch (error) {
      console.error("Customer journey item state error:", error);
      res.status(500).json({ error: "Errore nell'aggiornamento dello stato" });
    }
  });

  // Conferma/annulla manualmente il gettone di un item (la formula non è
  // cablata in Fase 1: si registra solo la conferma manuale).
  app.patch("/api/customer-journey-items/:id/gettone", isAuthenticated, requireModule("customer_journey"), async (req: any, res) => {
    try {
      const profile = await storage.getProfile(req.session.userId);
      if (!profile?.organizationId) return res.status(403).json({ error: "Accesso non autorizzato" });
      const { confirmed } = req.body as { confirmed?: boolean };
      if (typeof confirmed !== "boolean") {
        return res.status(400).json({ error: "Parametro 'confirmed' obbligatorio (boolean)" });
      }
      const item = await storage.getCustomerJourneyItem(req.params.id, profile.organizationId);
      if (!item) return res.status(404).json({ error: "Item non trovato" });
      if (profile.role === "operatore") {
        const mine = (profile.bisuiteAddetti ?? []).map((a) => a.toLowerCase().trim()).filter(Boolean);
        if (!mine.includes(String(item.addetto || "").toLowerCase().trim())) {
          return res.status(403).json({ error: "Accesso non autorizzato" });
        }
      }
      const updated = await storage.setCustomerJourneyItemGettone(req.params.id, profile.organizationId, confirmed, profile.id);
      res.json(updated);
    } catch (error) {
      console.error("Customer journey item gettone error:", error);
      res.status(500).json({ error: "Errore nella conferma del gettone" });
    }
  });

  // Compila a mano i campi di dettaglio che BiSuite non fornisce in modo
  // affidabile: data attivazione, PDV destinazione, IMEI, RATA (Task #161).
  // Una volta salvati (`detailsManual = true`), il reconcile non li sovrascrive.
  app.patch("/api/customer-journey-items/:id/details", isAuthenticated, requireModule("customer_journey"), async (req: any, res) => {
    try {
      const profile = await storage.getProfile(req.session.userId);
      if (!profile?.organizationId) return res.status(403).json({ error: "Accesso non autorizzato" });

      const body = req.body as {
        dataAttivazione?: string | null;
        pdvDestinazione?: string | null;
        imei?: string | null;
        rata?: string | null;
      };

      const details: CjItemDetailsUpdate = {};
      if ("dataAttivazione" in body) {
        const raw = body.dataAttivazione;
        if (raw == null || raw === "") {
          details.dataAttivazione = null;
        } else {
          const d = new Date(raw);
          if (Number.isNaN(d.getTime())) {
            return res.status(400).json({ error: "Data attivazione non valida" });
          }
          details.dataAttivazione = d;
        }
      }
      const normStr = (v: string | null | undefined): string | null => {
        if (v == null) return null;
        const t = String(v).trim();
        return t === "" ? null : t;
      };
      if ("pdvDestinazione" in body) details.pdvDestinazione = normStr(body.pdvDestinazione);
      if ("imei" in body) details.imei = normStr(body.imei);
      if ("rata" in body) details.rata = normStr(body.rata);

      if (Object.keys(details).length === 0) {
        return res.status(400).json({ error: "Nessun campo da aggiornare" });
      }

      const item = await storage.getCustomerJourneyItem(req.params.id, profile.organizationId);
      if (!item) return res.status(404).json({ error: "Item non trovato" });
      if (profile.role === "operatore") {
        const mine = (profile.bisuiteAddetti ?? []).map((a) => a.toLowerCase().trim()).filter(Boolean);
        if (!mine.includes(String(item.addetto || "").toLowerCase().trim())) {
          return res.status(403).json({ error: "Accesso non autorizzato" });
        }
      }
      const updated = await storage.updateCustomerJourneyItemDetails(req.params.id, profile.organizationId, details, profile.id);
      res.json(updated);
    } catch (error) {
      console.error("Customer journey item details error:", error);
      res.status(500).json({ error: "Errore nell'aggiornamento dei dettagli" });
    }
  });

  // Salva la ragione sociale del cliente business (BiSuite non la fornisce in
  // modo strutturato): l'operatore può inserirla/correggerla a mano dal
  // dettaglio journey; il valore non viene più sovrascritto dal reconcile.
  app.patch("/api/customer-journeys/:id/ragione-sociale", isAuthenticated, requireModule("customer_journey"), async (req: any, res) => {
    try {
      const profile = await storage.getProfile(req.session.userId);
      if (!profile?.organizationId) return res.status(403).json({ error: "Accesso non autorizzato" });
      const { ragioneSociale } = req.body as { ragioneSociale?: string | null };
      const journey = await storage.getCustomerJourney(req.params.id, profile.organizationId);
      if (!journey) return res.status(404).json({ error: "Journey non trovata" });
      if (profile.role === "operatore") {
        const mine = (profile.bisuiteAddetti ?? []).map((a) => a.toLowerCase().trim()).filter(Boolean);
        const items = await storage.getCustomerJourneyItems(journey.id);
        const owns = items.some((it) => mine.includes(String(it.addetto || "").toLowerCase().trim()));
        if (!owns) return res.status(403).json({ error: "Accesso non autorizzato" });
      }
      const updated = await storage.updateCustomerJourneyRagioneSociale(
        req.params.id,
        profile.organizationId,
        ragioneSociale ?? null,
      );
      res.json(updated);
    } catch (error) {
      console.error("Customer journey ragione sociale error:", error);
      res.status(500).json({ error: "Errore nel salvataggio della ragione sociale" });
    }
  });

  // Lightweight versione delle regole BiSuite mapping. Usata dai client
  // (Dashboard Gara Reale, MappaturaBiSuite) per inserire `rulesUpdatedAt`
  // nelle queryKey React Query: così, qualunque sia la sorgente del cambio
  // regole (PUT /api/admin/bisuite-mapping, merge automatico su login admin,
  // seed di nuovi default), tutti i consumer rifetchano automaticamente
  // alla prima visualizzazione successiva senza richiedere un re-import
  // o un'invalidazione manuale per ciascuna pagina.
  app.get("/api/bisuite-mapping-version", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session.userId;
      const profile = await storage.getProfile(userId);
      if (!profile) return res.status(403).json({ error: "Accesso non autorizzato" });
      const sysMapping = await storage.getSystemConfig("bisuite_mapping");
      const savedAt = sysMapping?.updatedAt
        ? new Date(sysMapping.updatedAt).toISOString()
        : "none";
      // Combine the persisted mapping timestamp with a hash of the in-code
      // defaults so deploys that ship new defaults bust client caches even
      // when no super_admin has saved the mapping since the last deploy.
      const rulesUpdatedAt = `${savedAt}|${getDefaultRulesHash()}`;
      res.json({ rulesUpdatedAt });
    } catch (error) {
      console.error("BiSuite mapping version error:", error);
      res.status(500).json({ error: "Errore nel recupero versione mappatura" });
    }
  });

  app.get("/api/admin/bisuite-mapped-sales", isAuthenticated, requireModule(["amministrazione", "gara_dashboard"]), async (req: any, res) => {
    try {
      const userId = req.session.userId;
      const profile = await storage.getProfile(userId);
      if (!profile) {
        return res.status(403).json({ error: "Accesso non autorizzato" });
      }

      const orgId = req.query.organization_id || profile.organizationId;
      if (!orgId) return res.status(400).json({ error: "Organizzazione non specificata" });

      if (profile.role !== "super_admin" && orgId !== profile.organizationId) {
        return res.status(403).json({ error: "Accesso non autorizzato" });
      }

      const month = parseInt(req.query.month as string) || new Date().getMonth() + 1;
      const year = parseInt(req.query.year as string) || new Date().getFullYear();
      const inGaraOnly = req.query.inGaraOnly === 'true' || req.query.inGaraOnly === '1';
      const garaConfigId = (req.query.garaConfigId as string) || undefined;

      const allSales = await storage.getBisuiteSalesByItalianMonth(orgId, year, month);

      type CalendarShape = {
        weeklySchedule: { workingDays: number[] };
        specialDays?: { date: string; isOpen: boolean }[];
      };
      const calendarByPos = new Map<string, CalendarShape>();
      let calendarsAvailable = false;
      if (inGaraOnly) {
        let garaCfg = undefined as Awaited<ReturnType<typeof storage.getGaraConfigById>> | undefined;
        if (garaConfigId) {
          garaCfg = await storage.getGaraConfigById(garaConfigId);
          // Authorization: la config deve appartenere alla stessa organizzazione
          if (garaCfg && garaCfg.organizationId !== orgId) {
            return res.status(403).json({ error: "Configurazione gara non autorizzata" });
          }
        } else {
          garaCfg = await storage.getGaraConfig(orgId, month, year);
        }
        const pdvList = ((garaCfg?.config as { pdvList?: Array<{ codicePos?: string; calendar?: CalendarShape }> } | undefined)?.pdvList) || [];
        for (const p of pdvList) {
          if (p.codicePos && p.calendar?.weeklySchedule?.workingDays) {
            calendarByPos.set(p.codicePos, p.calendar);
            calendarsAvailable = true;
          }
        }
      }

      // Normalizza la data della vendita al fuso Europe/Rome per evitare
      // disallineamenti rispetto al calendario italiano (DST e mezzanotte).
      const romeDateFormatter = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Europe/Rome',
        year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short',
      });
      const WEEKDAY_MAP: Record<string, number> = {
        Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
      };
      const romeDateInfo = (d: Date): { iso: string; weekday: number } => {
        const parts = romeDateFormatter.formatToParts(d);
        const get = (t: string) => parts.find(p => p.type === t)?.value || '';
        const iso = `${get('year')}-${get('month')}-${get('day')}`;
        const weekday = WEEKDAY_MAP[get('weekday')] ?? d.getDay();
        return { iso, weekday };
      };

      const isSaleInGara = (sale: typeof allSales[number]): boolean => {
        if (!sale.dataVendita) return true;
        const cal = sale.codicePos ? calendarByPos.get(sale.codicePos) : undefined;
        if (!cal) return true; // Fallback: PDV senza calendario configurato
        const { iso, weekday } = romeDateInfo(new Date(sale.dataVendita));
        const special = cal.specialDays?.find((s) => s.date === iso);
        if (special) return special.isOpen;
        return cal.weeklySchedule.workingDays.includes(weekday);
      };

      const sales = inGaraOnly && calendarsAvailable
        ? allSales.filter(isSaleInGara)
        : allSales;
      const totalSalesUnfiltered = allSales.length;
      const salesExcludedOutOfGara = inGaraOnly ? totalSalesUnfiltered - sales.length : 0;

      const sysMapping = await storage.getSystemConfig("bisuite_mapping");
      const mappingConfig = sysMapping?.config as { rules?: BiSuiteMappingRule[] } | null;
      const { getDefaultMappingRules, mergeWithDefaultRules } = await import("../shared/bisuiteMapping");
      const rawRules = mappingConfig?.rules || getDefaultMappingRules();
      const rules = mergeWithDefaultRules(rawRules);
      const savedAt = sysMapping?.updatedAt
        ? new Date(sysMapping.updatedAt).toISOString()
        : "none";
      const rulesUpdatedAt = `${savedAt}|${getDefaultRulesHash()}`;

      type AggregatedItem = {
        pista: string;
        targetCategory: string;
        targetLabel: string;
        pezzi: number;
        canone: number;
        ruleType: 'base' | 'additional';
        descriptions?: Record<string, number>;
      };

      type AddonItem = {
        pista: string;
        targetCategory: string;
        targetLabel: string;
        occorrenze: number;
        canone: number;
      };

      type DeviceModalitaTally = { pezzi: number; descriptions: Record<string, number> };
      type DeviceTally = {
        smartphone: { finanziato: DeviceModalitaTally; rate: DeviceModalitaTally; altro: DeviceModalitaTally };
        smartDevice: { finanziato: DeviceModalitaTally; rate: DeviceModalitaTally; altro: DeviceModalitaTally };
        internetDevice: { finanziato: DeviceModalitaTally; rate: DeviceModalitaTally; altro: DeviceModalitaTally };
      };
      const newDeviceTally = (): DeviceTally => ({
        smartphone: { finanziato: { pezzi: 0, descriptions: {} }, rate: { pezzi: 0, descriptions: {} }, altro: { pezzi: 0, descriptions: {} } },
        smartDevice: { finanziato: { pezzi: 0, descriptions: {} }, rate: { pezzi: 0, descriptions: {} }, altro: { pezzi: 0, descriptions: {} } },
        internetDevice: { finanziato: { pezzi: 0, descriptions: {} }, rate: { pezzi: 0, descriptions: {} }, altro: { pezzi: 0, descriptions: {} } },
      });

      const byPdv: Record<string, {
        codicePos: string;
        nomeNegozio: string;
        ragioneSociale: string;
        items: AggregatedItem[];
        addons: AddonItem[];
        accessori: { pezzi: number; importo: number };
        servizi: { pezzi: number; importo: number };
        devices: DeviceTally;
        unmapped: number;
        totalArticoli: number;
      }> = {};

      let totalMapped = 0;
      let totalUnmapped = 0;
      let totalArticoli = 0;
      let latestSaleDate: Date | null = null;

      for (const sale of sales) {
        if (sale.dataVendita) {
          const d = new Date(sale.dataVendita);
          if (!latestSaleDate || d > latestSaleDate) latestSaleDate = d;
        }
        const raw = sale.rawData as any;
        if (!raw) continue;

        const codicePos = sale.codicePos || "UNKNOWN";
        if (!byPdv[codicePos]) {
          byPdv[codicePos] = {
            codicePos,
            nomeNegozio: sale.nomeNegozio || codicePos,
            ragioneSociale: sale.ragioneSociale || "",
            items: [],
            addons: [],
            accessori: { pezzi: 0, importo: 0 },
            servizi: { pezzi: 0, importo: 0 },
            devices: newDeviceTally(),
            unmapped: 0,
            totalArticoli: 0,
          };
        }

        const articoli = raw.articoli || [];

        const matchDomanda = (testo: string, predicate: (risp: string) => boolean): boolean => {
          for (const art of articoli) {
            const dr = art.dettaglio?.domandeRisposte || [];
            for (const qr of dr) {
              const dom = String(qr.domanda || '').toUpperCase();
              if (dom.includes(testo)) {
                const risp = String(qr.risposta || '').toUpperCase();
                if (predicate(risp)) return true;
              }
            }
          }
          return false;
        };
        const isFinanziato = matchDomanda('TELEFONO INCLUSO COMPASS', (r) => r.includes('SI'))
          || matchDomanda('TELEFONO INCLUSO FINDOMESTIC', (r) => r.includes('SI'))
          || matchDomanda('TELEFONO INCLUSO MULTI FINANZIAMENTO', (r) => r.includes('SI'))
          || matchDomanda('MIA TELEFONO FINANZIAMENTO', (r) => /\d/.test(r));
        const isRate = matchDomanda('TELEFONO INCLUSO VAR', (r) => r.includes('SI'))
          || matchDomanda('MIA TELEFONO VAR', (r) => /\d/.test(r));
        const saleModality: 'finanziato' | 'rate' | 'altro' = isFinanziato ? 'finanziato' : (isRate ? 'rate' : 'altro');
        const tallyDevice = (kind: 'smartphone' | 'smartDevice' | 'internetDevice', desc: string) => {
          const bucket = byPdv[codicePos].devices[kind][saleModality];
          bucket.pezzi += 1;
          bucket.descriptions[desc] = (bucket.descriptions[desc] || 0) + 1;
        };
        const { mapBiSuiteArticle } = await import("../shared/bisuiteMapping");
        const clienteTipo = raw.cliente?.clienteTipo || '';

        const PRODOTTI_CATS = new Set([
          'TELEFONIA', 'MODEM/ROUTER', 'SMART DEVICE', 'INTERNET DEVICE', 'SIM', 'RICARICHE',
          'ACCESSORI', 'GARANZIE', 'RICAMBI', 'RICAMBI PC', 'DEPOSITO CAUZIONALE',
          'COSTO ATTIVAZIONE', 'EPAY', 'OPZIONI', 'ARROTONDAMENTO', 'GARANTEASY',
          'DEMO TELEFONIA WIND3', 'TELEFONIA TRADE-IN', 'ALTRO',
        ]);
        const SERVIZI_CATS = new Set(['SPEDIZIONE', 'ASSISTENZA']);
        const ACCESSORI_CATS = new Set(['ACCESSORI']);
        const SERVIZI_DASHBOARD_CATS = new Set(['SPEDIZIONE', 'ASSISTENZA', 'GARANTEASY']);

        let canvassCount = 0;
        let mappedCount = 0;
        for (const art of articoli) {
          const catNome = (art.categoria?.nome || '').toUpperCase().trim();
          if (PRODOTTI_CATS.has(catNome) || SERVIZI_CATS.has(catNome)) {
            const dett = art.dettaglio || {};
            const imp = parseFloat(String(dett.importoImponibile ?? '')) || parseFloat(String(dett.prezzo ?? '')) || 0;
            const desc = ((art.descrizione || '').trim()) || '(senza descrizione)';
            if (catNome === 'TELEFONIA') {
              tallyDevice('smartphone', desc);
            } else if (catNome === 'SMART DEVICE') {
              tallyDevice('smartDevice', desc);
            } else if (catNome === 'INTERNET DEVICE' || catNome === 'MODEM/ROUTER') {
              tallyDevice('internetDevice', desc);
            }
            if (ACCESSORI_CATS.has(catNome)) {
              byPdv[codicePos].accessori.pezzi += 1;
              byPdv[codicePos].accessori.importo += imp;
            } else if (SERVIZI_DASHBOARD_CATS.has(catNome)) {
              byPdv[codicePos].servizi.pezzi += 1;
              byPdv[codicePos].servizi.importo += imp;
            }
            continue;
          }
          canvassCount++;
          const mappedResults = mapBiSuiteArticle(art, clienteTipo, rules);
          if (mappedResults.length === 0) continue;
          mappedCount++;
          const artCanone = parseFloat(art.dettaglio?.canone || '0') || 0;
          for (const m of mappedResults) {
            const effectiveRuleType = m.ruleType || 'base';
            if (effectiveRuleType === 'additional') {
              const CANONE_BASED_ADDONS = new Set([
                'CONVERGENZA', 'LINEA_ATTIVA', 'FIBRA_FTTH_ADDON',
                'VOCE_UNLIMITED', 'CONVERGENZA_LUCE_GAS', 'CONVERGENTE_ASSICUR',
              ]);
              const canoneForAddon = CANONE_BASED_ADDONS.has(m.targetCategory) ? artCanone : 0;
              const existingAddon = byPdv[codicePos].addons.find(
                (a) => a.pista === m.pista && a.targetCategory === m.targetCategory
              );
              if (existingAddon) {
                existingAddon.occorrenze++;
                existingAddon.canone += canoneForAddon;
              } else {
                byPdv[codicePos].addons.push({
                  pista: m.pista,
                  targetCategory: m.targetCategory,
                  targetLabel: m.targetLabel,
                  occorrenze: 1,
                  canone: canoneForAddon,
                });
              }
            } else {
              const canoneForThis = artCanone;
              const existing = byPdv[codicePos].items.find(
                (i) => i.pista === m.pista && i.targetCategory === m.targetCategory
              );
              if (existing) {
                existing.pezzi++;
                existing.canone += canoneForThis;
                if (m.targetCategory === 'SIM_IVA') {
                  const desc = ((art.descrizione || '').trim()) || '(senza descrizione)';
                  if (!existing.descriptions) existing.descriptions = {};
                  existing.descriptions[desc] = (existing.descriptions[desc] || 0) + 1;
                }
              } else {
                const newItem: any = {
                  pista: m.pista,
                  targetCategory: m.targetCategory,
                  targetLabel: m.targetLabel,
                  pezzi: 1,
                  canone: canoneForThis,
                  ruleType: 'base',
                };
                if (m.targetCategory === 'SIM_IVA') {
                  const desc = ((art.descrizione || '').trim()) || '(senza descrizione)';
                  newItem.descriptions = { [desc]: 1 };
                }
                byPdv[codicePos].items.push(newItem);
              }
            }
          }
        }
        totalArticoli += canvassCount;
        byPdv[codicePos].totalArticoli += canvassCount;
        totalMapped += mappedCount;
        const unmappedCount = canvassCount - mappedCount;
        totalUnmapped += unmappedCount;
        byPdv[codicePos].unmapped += unmappedCount;
      }

      const pdvList = Object.values(byPdv);

      const totaliPerPista: Record<string, Record<string, { targetCategory: string; targetLabel: string; pezzi: number; canone: number; ruleType: string }>> = {};
      const totaliAddonsPerPista: Record<string, Record<string, { targetCategory: string; targetLabel: string; occorrenze: number; canone: number }>> = {};
      for (const pdv of pdvList) {
        for (const item of pdv.items) {
          if (!totaliPerPista[item.pista]) totaliPerPista[item.pista] = {};
          if (!totaliPerPista[item.pista][item.targetCategory]) {
            totaliPerPista[item.pista][item.targetCategory] = {
              targetCategory: item.targetCategory,
              targetLabel: item.targetLabel,
              pezzi: 0,
              canone: 0,
              ruleType: item.ruleType,
            };
          }
          totaliPerPista[item.pista][item.targetCategory].pezzi += item.pezzi;
          totaliPerPista[item.pista][item.targetCategory].canone += item.canone;
        }
        for (const addon of pdv.addons) {
          if (!totaliAddonsPerPista[addon.pista]) totaliAddonsPerPista[addon.pista] = {};
          if (!totaliAddonsPerPista[addon.pista][addon.targetCategory]) {
            totaliAddonsPerPista[addon.pista][addon.targetCategory] = {
              targetCategory: addon.targetCategory,
              targetLabel: addon.targetLabel,
              occorrenze: 0,
              canone: 0,
            };
          }
          totaliAddonsPerPista[addon.pista][addon.targetCategory].occorrenze += addon.occorrenze;
          totaliAddonsPerPista[addon.pista][addon.targetCategory].canone += addon.canone;
        }
      }

      res.json({
        month,
        year,
        totalSales: sales.length,
        totalArticoli,
        totalMapped,
        totalUnmapped,
        pdvList,
        totaliPerPista,
        totaliAddonsPerPista,
        latestSaleDate: latestSaleDate ? latestSaleDate.toISOString() : null,
        inGaraOnly,
        totalSalesUnfiltered,
        salesExcludedOutOfGara,
        calendarsAvailable,
        rulesUpdatedAt,
      });
    } catch (error: unknown) {
      console.error("BiSuite mapped sales error:", error);
      const msg = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: "Errore nell'aggregazione vendite mappate", details: msg });
    }
  });

  app.get("/api/admin/bisuite-articles-summary", isAuthenticated, requireModule(["amministrazione", "mappatura_bisuite"]), async (req: any, res) => {
    try {
      const userId = req.session.userId;
      const profile = await storage.getProfile(userId);
      if (!profile || !['super_admin', 'admin'].includes(profile.role)) {
        return res.status(403).json({ error: "Accesso non autorizzato" });
      }

      const orgId = req.query.organization_id || profile.organizationId;
      if (!orgId) return res.status(400).json({ error: "Organizzazione non specificata" });

      if (profile.role !== "super_admin" && orgId !== profile.organizationId) {
        return res.status(403).json({ error: "Accesso non autorizzato" });
      }

      const month = parseInt(req.query.month as string) || new Date().getMonth() + 1;
      const year = parseInt(req.query.year as string) || new Date().getFullYear();

      const sales = await storage.getBisuiteSalesByItalianMonth(orgId, year, month);

      const sysMapping = await storage.getSystemConfig("bisuite_mapping");
      const mappingConfig = sysMapping?.config as { rules?: BiSuiteMappingRule[] } | null;
      const { getDefaultMappingRules, mapBiSuiteArticle, mergeWithDefaultRules } = await import("../shared/bisuiteMapping");
      const rawRules = mappingConfig?.rules || getDefaultMappingRules();
      const rules = mergeWithDefaultRules(rawRules);
      const savedAt = sysMapping?.updatedAt
        ? new Date(sysMapping.updatedAt).toISOString()
        : "none";
      const rulesUpdatedAt = `${savedAt}|${getDefaultRulesHash()}`;

      const PRODOTTI_CATS = new Set([
        'TELEFONIA', 'MODEM/ROUTER', 'SMART DEVICE', 'INTERNET DEVICE', 'SIM', 'RICARICHE',
        'ACCESSORI', 'GARANZIE', 'RICAMBI', 'RICAMBI PC', 'DEPOSITO CAUZIONALE',
        'COSTO ATTIVAZIONE', 'EPAY', 'OPZIONI', 'GARANTEASY',
        'DEMO TELEFONIA WIND3', 'TELEFONIA TRADE-IN', 'ALTRO',
      ]);
      const SERVIZI_CATS = new Set(['SPEDIZIONE', 'ASSISTENZA']);

      const prodotti: Record<string, { categoria: string; tipologia: string; descrizione: string; pezzi: number; importo: number }> = {};
      const servizi: Record<string, { categoria: string; tipologia: string; descrizione: string; pezzi: number; importo: number }> = {};
      const nonMappati: Record<string, { categoria: string; tipologia: string; descrizione: string; pezzi: number; clienteTipo: string }> = {};

      for (const sale of sales) {
        const raw = sale.rawData as any;
        if (!raw) continue;
        const articoli = raw.articoli || [];
        const clienteTipo = raw.cliente?.clienteTipo || '';

        for (const art of articoli) {
          const cat = (art.categoria?.nome || '').toUpperCase().trim();
          const tip = (art.tipologia?.nome || '').trim();
          const desc = (art.descrizione || '').trim();
          const importo = parseFloat(art.dettaglio?.importo || art.dettaglio?.prezzo || '0') || 0;

          if (PRODOTTI_CATS.has(cat)) {
            const key = `${cat}||${tip}||${desc}`;
            if (!prodotti[key]) prodotti[key] = { categoria: cat, tipologia: tip, descrizione: desc, pezzi: 0, importo: 0 };
            prodotti[key].pezzi++;
            prodotti[key].importo += importo;
          } else if (SERVIZI_CATS.has(cat)) {
            const key = `${cat}||${tip}||${desc}`;
            if (!servizi[key]) servizi[key] = { categoria: cat, tipologia: tip, descrizione: desc, pezzi: 0, importo: 0 };
            servizi[key].pezzi++;
            servizi[key].importo += importo;
          } else {
            const mappedResults = mapBiSuiteArticle(art, clienteTipo, rules);
            if (mappedResults.length === 0) {
              const key = `${cat}||${tip}||${desc}||${clienteTipo}`;
              if (!nonMappati[key]) nonMappati[key] = { categoria: cat, tipologia: tip, descrizione: desc, pezzi: 0, clienteTipo };
              nonMappati[key].pezzi++;
            }
          }
        }
      }

      res.json({
        month, year,
        prodotti: Object.values(prodotti).sort((a, b) => b.pezzi - a.pezzi),
        servizi: Object.values(servizi).sort((a, b) => b.pezzi - a.pezzi),
        nonMappati: Object.values(nonMappati).sort((a, b) => b.pezzi - a.pezzi),
        rulesUpdatedAt,
      });
    } catch (error: unknown) {
      console.error("BiSuite articles summary error:", error);
      const msg = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: "Errore nel riepilogo articoli", details: msg });
    }
  });

  // === Struttura Organizzativa: CRUD RS / PDV (admin/super_admin) ===
  // Scrive su organization_config.puntiVendita e propaga rinomine/eliminazioni
  // alle tabelle CdG (cdg_spese, cdg_pdv_manuali, cdg_categorie, cdg_fornitori,
  // cdg_ragioni_sociali) per mantenere la coerenza cross-modulo. Chiave PDV
  // canonica = codicePos (univoca per organizzazione).
  type StructPdv = {
    id?: string; codicePos: string; nome: string; ragioneSociale: string;
    canale?: string; tipoPosizione?: string;
    clusterMobile?: string; clusterFisso?: string; clusterCB?: string;
  };
  const structPdvSchema = z.object({
    codicePos: z.string().trim().min(1, "Codice POS obbligatorio"),
    nome: z.string().trim().min(1, "Nome obbligatorio"),
    ragioneSociale: z.string().trim().min(1, "Ragione Sociale obbligatoria"),
    canale: z.string().trim().optional().default(""),
    tipoPosizione: z.string().trim().optional().default(""),
    clusterMobile: z.string().trim().optional().default(""),
    clusterFisso: z.string().trim().optional().default(""),
    clusterCB: z.string().trim().optional().default(""),
  });

  async function readPv(orgId: string): Promise<StructPdv[]> {
    const cfg = await storage.getOrgConfig(orgId);
    const arr = ((cfg?.config as Record<string, unknown> | null)?.puntiVendita || []) as StructPdv[];
    return Array.isArray(arr) ? arr : [];
  }
  async function readRsList(orgId: string): Promise<string[]> {
    const cfg = await storage.getOrgConfig(orgId);
    const arr = ((cfg?.config as Record<string, unknown> | null)?.ragioniSociali || []) as string[];
    return Array.isArray(arr) ? arr.map(s => String(s).trim()).filter(Boolean) : [];
  }
  async function writePv(orgId: string, mutator: (pv: StructPdv[]) => StructPdv[]): Promise<void> {
    const cfg = await storage.getOrgConfig(orgId);
    const config = (cfg?.config as Record<string, unknown> | null) || {};
    const pv = ((config.puntiVendita as StructPdv[] | undefined) || []).map(p => ({ ...p }));
    const next = mutator(pv);
    const newConfig = { ...config, puntiVendita: next };
    await storage.upsertOrgConfig(orgId, newConfig, cfg?.configVersion || "2.0");
  }
  async function writeConfigKeys(orgId: string, mutator: (cfg: Record<string, unknown>) => Record<string, unknown>): Promise<void> {
    const cfg = await storage.getOrgConfig(orgId);
    const config = (cfg?.config as Record<string, unknown> | null) || {};
    const next = mutator({ ...config });
    await storage.upsertOrgConfig(orgId, next, cfg?.configVersion || "2.0");
  }
  const norm = (s: unknown) => String(s ?? "").trim();
  const normLow = (s: unknown) => norm(s).toLowerCase();
  function findCodiceClash(pv: StructPdv[], codicePos: string, exclude?: { rs: string; codice: string }): boolean {
    const target = normLow(codicePos);
    for (const p of pv) {
      const code = normLow(p.codicePos || p.nome);
      if (exclude && normLow(p.ragioneSociale) === normLow(exclude.rs) && code === normLow(exclude.codice)) continue;
      if (code === target) return true;
    }
    return false;
  }

  // POST /api/admin/struttura/pdv → crea singolo PDV
  app.post("/api/admin/struttura/pdv", isAuthenticated, async (req: any, res) => {
    const profile = await requireAdminRole(req, res);
    if (!profile) return;
    const orgId = profile.organizationId!;
    const parsed = structPdvSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0].message });
    const cur = await readPv(orgId);
    if (findCodiceClash(cur, parsed.data.codicePos)) {
      return res.status(409).json({ error: `Codice POS "${parsed.data.codicePos}" già esistente` });
    }
    const newId = `pdv-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    await writePv(orgId, (pv) => [...pv, { id: newId, ...parsed.data }]);
    res.status(201).json({ success: true, id: newId });
  });

  // POST /api/admin/struttura/pdv/bulk → crea N PDV (skip duplicati)
  app.post("/api/admin/struttura/pdv/bulk", isAuthenticated, async (req: any, res) => {
    const profile = await requireAdminRole(req, res);
    if (!profile) return;
    const orgId = profile.organizationId!;
    const parsed = z.object({ pdvs: z.array(structPdvSchema).min(1) }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0].message });
    const cur = await readPv(orgId);
    const existing = new Set(cur.map(p => normLow(p.codicePos || p.nome)));
    const added: string[] = [];
    const skipped: string[] = [];
    const toAdd: StructPdv[] = [];
    for (const p of parsed.data.pdvs) {
      const k = normLow(p.codicePos);
      if (existing.has(k)) { skipped.push(p.codicePos); continue; }
      existing.add(k);
      toAdd.push({ id: `pdv-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, ...p });
      added.push(p.codicePos);
    }
    if (toAdd.length > 0) {
      await writePv(orgId, (pv) => [...pv, ...toAdd]);
    }
    res.json({ success: true, added, skipped });
  });

  // PUT /api/admin/struttura/pdv → modifica per (oldRagioneSociale, oldCodicePos)
  app.put("/api/admin/struttura/pdv", isAuthenticated, async (req: any, res) => {
    const profile = await requireAdminRole(req, res);
    if (!profile) return;
    const orgId = profile.organizationId!;
    const schema = z.object({
      oldRagioneSociale: z.string().trim().min(1),
      oldCodicePos: z.string().trim().min(1),
      codicePos: z.string().trim().min(1).optional(),
      nome: z.string().trim().min(1).optional(),
      ragioneSociale: z.string().trim().min(1).optional(),
      canale: z.string().trim().optional(),
      tipoPosizione: z.string().trim().optional(),
      clusterMobile: z.string().trim().optional(),
      clusterFisso: z.string().trim().optional(),
      clusterCB: z.string().trim().optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0].message });
    const { oldRagioneSociale, oldCodicePos } = parsed.data;
    const cur = await readPv(orgId);
    const idx = cur.findIndex(p =>
      normLow(p.ragioneSociale) === normLow(oldRagioneSociale) &&
      normLow(p.codicePos || p.nome) === normLow(oldCodicePos)
    );
    if (idx < 0) return res.status(404).json({ error: "PDV non trovato" });
    const oldEntry = cur[idx];
    const newCodice = parsed.data.codicePos ?? oldEntry.codicePos;
    const newRs = parsed.data.ragioneSociale ?? oldEntry.ragioneSociale;
    if (normLow(newCodice) !== normLow(oldCodicePos)) {
      if (findCodiceClash(cur, newCodice, { rs: oldRagioneSociale, codice: oldCodicePos })) {
        return res.status(409).json({ error: `Codice POS "${newCodice}" già esistente` });
      }
    }
    await writePv(orgId, (pv) => pv.map((p, i) => i === idx ? {
      ...p,
      codicePos: newCodice,
      nome: parsed.data.nome ?? p.nome,
      ragioneSociale: newRs,
      canale: parsed.data.canale ?? p.canale,
      tipoPosizione: parsed.data.tipoPosizione ?? p.tipoPosizione,
      clusterMobile: parsed.data.clusterMobile ?? p.clusterMobile,
      clusterFisso: parsed.data.clusterFisso ?? p.clusterFisso,
      clusterCB: parsed.data.clusterCB ?? p.clusterCB,
    } : p));
    // Propagazione su CdG: rename codicePos e/o ragioneSociale
    if (normLow(newCodice) !== normLow(oldCodicePos) || normLow(newRs) !== normLow(oldRagioneSociale)) {
      try {
        await db.execute(sql`
          UPDATE cdg_spese
             SET pdv_codice = ${newCodice}, ragione_sociale = ${newRs}
           WHERE organization_id = ${orgId}
             AND ragione_sociale = ${oldRagioneSociale}
             AND pdv_codice = ${oldCodicePos}
        `);
        // cdg_pdv_manuali: stesso (org, rs, codice) → aggiorna a nuovi valori
        await db.execute(sql`
          UPDATE cdg_pdv_manuali
             SET codice = ${newCodice}, ragione_sociale = ${newRs}
           WHERE organization_id = ${orgId}
             AND ragione_sociale = ${oldRagioneSociale}
             AND codice = ${oldCodicePos}
        `);
        // bisuite_sales: rinomina codicePos sulle vendite storiche dell'org
        if (normLow(newCodice) !== normLow(oldCodicePos)) {
          await db.execute(sql`
            UPDATE bisuite_sales SET codice_pos = ${newCodice}
             WHERE organization_id = ${orgId} AND codice_pos = ${oldCodicePos}
          `);
          // Best-effort: rinomina codicePos anche dentro i blob jsonb di
          // gara_config.config e preventivi.data (campi stringa vari come
          // "codicePos", "pdvCodice", ecc.). Limitiamo il pattern alle
          // occorrenze come valore JSON ("OLD") per evitare match parziali.
          // Cast jsonb→text→jsonb con replace su match esatto della stringa.
          const oldQuoted = JSON.stringify(oldCodicePos);
          const newQuoted = JSON.stringify(newCodice);
          try {
            await db.execute(sql`
              UPDATE gara_config
                 SET config = REPLACE(config::text, ${oldQuoted}, ${newQuoted})::jsonb
               WHERE organization_id = ${orgId}
                 AND config::text LIKE ${'%' + oldQuoted + '%'}
            `);
          } catch (e) { console.error("[struttura] propagate gara_config jsonb failed", e); }
          try {
            await db.execute(sql`
              UPDATE preventivi
                 SET data = REPLACE(data::text, ${oldQuoted}, ${newQuoted})::jsonb
               WHERE organization_id = ${orgId}
                 AND data::text LIKE ${'%' + oldQuoted + '%'}
            `);
          } catch (e) { console.error("[struttura] propagate preventivi jsonb failed", e); }
        }
      } catch (e) { console.error("[struttura] propagate cdg_spese/manuali/bisuite failed", e); }
    }
    res.json({ success: true });
  });

  // POST /api/admin/struttura/ragione-sociale → crea RS vuota (name-only)
  // Persistenza: aggiunge la RS in `organization_config.config.ragioniSociali[]`
  // (lista canonica delle RS senza PDV figli). Materializza anche in
  // `cdg_ragioni_sociali` per visibilità immediata nel CdG.
  app.post("/api/admin/struttura/ragione-sociale", isAuthenticated, async (req: any, res) => {
    const profile = await requireAdminRole(req, res);
    if (!profile) return;
    const orgId = profile.organizationId!;
    const parsed = z.object({ nome: z.string().trim().min(1, "Nome obbligatorio") }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0].message });
    const nome = parsed.data.nome;
    const cur = await readPv(orgId);
    const rsList = await readRsList(orgId);
    if (cur.some(p => normLow(p.ragioneSociale) === normLow(nome)) || rsList.some(r => normLow(r) === normLow(nome))) {
      return res.status(409).json({ error: `Ragione Sociale "${nome}" già esistente` });
    }
    await writeConfigKeys(orgId, (c) => ({ ...c, ragioniSociali: [...rsList, nome] }));
    try {
      await db.execute(sql`INSERT INTO cdg_ragioni_sociali (organization_id, nome) VALUES (${orgId}, ${nome}) ON CONFLICT DO NOTHING`);
    } catch (e) { console.error("[struttura] create RS cdg insert failed", e); }
    res.status(201).json({ success: true, nome });
  });

  // DELETE /api/admin/struttura/pdv?ragioneSociale=&codicePos=
  app.delete("/api/admin/struttura/pdv", isAuthenticated, async (req: any, res) => {
    const profile = await requireAdminRole(req, res);
    if (!profile) return;
    const orgId = profile.organizationId!;
    const ragioneSociale = norm(req.query.ragioneSociale);
    const codicePos = norm(req.query.codicePos);
    if (!ragioneSociale || !codicePos) return res.status(400).json({ error: "ragioneSociale e codicePos obbligatori" });
    const cur = await readPv(orgId);
    const exists = cur.some(p =>
      normLow(p.ragioneSociale) === normLow(ragioneSociale) &&
      normLow(p.codicePos || p.nome) === normLow(codicePos)
    );
    if (!exists) return res.status(404).json({ error: "PDV non trovato" });
    await writePv(orgId, (pv) => pv.filter(p =>
      !(normLow(p.ragioneSociale) === normLow(ragioneSociale) &&
        normLow(p.codicePos || p.nome) === normLow(codicePos))
    ));
    res.json({ success: true });
  });

  // PUT /api/admin/struttura/ragione-sociale/:nome → rinomina RS
  // (sia nei puntiVendita figli, sia nella lista canonica ragioniSociali[])
  app.put("/api/admin/struttura/ragione-sociale/:nome", isAuthenticated, async (req: any, res) => {
    const profile = await requireAdminRole(req, res);
    if (!profile) return;
    const orgId = profile.organizationId!;
    const oldName = decodeURIComponent(req.params.nome).trim();
    const parsed = z.object({ nome: z.string().trim().min(1) }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0].message });
    const newName = parsed.data.nome;
    const cur = await readPv(orgId);
    const rsList = await readRsList(orgId);
    const existsInPv = cur.some(p => normLow(p.ragioneSociale) === normLow(oldName));
    const existsInRs = rsList.some(r => normLow(r) === normLow(oldName));
    if (!existsInPv && !existsInRs) return res.status(404).json({ error: "Ragione Sociale non trovata" });
    if (normLow(newName) !== normLow(oldName)) {
      const dup = cur.some(p => normLow(p.ragioneSociale) === normLow(newName)) ||
                  rsList.some(r => normLow(r) === normLow(newName));
      if (dup) return res.status(409).json({ error: `Ragione Sociale "${newName}" già esistente` });
    }
    await writeConfigKeys(orgId, (c) => {
      const pv = ((c.puntiVendita as StructPdv[] | undefined) || []).map(p =>
        normLow(p.ragioneSociale) === normLow(oldName) ? { ...p, ragioneSociale: newName } : p
      );
      const rs = (((c.ragioniSociali as string[] | undefined) || [])
        .map(r => normLow(r) === normLow(oldName) ? newName : r));
      return { ...c, puntiVendita: pv, ragioniSociali: rs };
    });
    if (normLow(newName) !== normLow(oldName)) {
      try {
        await db.execute(sql`
          UPDATE cdg_categorie
             SET ragioni_sociali = array_replace(ragioni_sociali, ${oldName}, ${newName}),
                 ragione_sociale = CASE WHEN ragione_sociale = ${oldName} THEN ${newName} ELSE ragione_sociale END
           WHERE organization_id = ${orgId} AND ${oldName} = ANY(ragioni_sociali)
        `);
        await db.execute(sql`
          UPDATE cdg_fornitori
             SET ragioni_sociali = array_replace(ragioni_sociali, ${oldName}, ${newName}),
                 ragione_sociale = CASE WHEN ragione_sociale = ${oldName} THEN ${newName} ELSE ragione_sociale END
           WHERE organization_id = ${orgId} AND ${oldName} = ANY(ragioni_sociali)
        `);
        await db.execute(sql`UPDATE cdg_pdv_manuali SET ragione_sociale = ${newName} WHERE organization_id = ${orgId} AND ragione_sociale = ${oldName}`);
        await db.execute(sql`UPDATE cdg_spese SET ragione_sociale = ${newName} WHERE organization_id = ${orgId} AND ragione_sociale = ${oldName}`);
        await db.execute(sql`UPDATE cdg_ragioni_sociali SET nome = ${newName} WHERE organization_id = ${orgId} AND nome = ${oldName}`);
      } catch (e) { console.error("[struttura] propagate rename RS failed", e); }
    }
    res.json({ success: true, nome: newName });
  });

  // DELETE /api/admin/struttura/ragione-sociale/:nome → elimina RS + tutti i PDV
  app.delete("/api/admin/struttura/ragione-sociale/:nome", isAuthenticated, async (req: any, res) => {
    const profile = await requireAdminRole(req, res);
    if (!profile) return;
    const orgId = profile.organizationId!;
    const nome = decodeURIComponent(req.params.nome).trim();
    if (!nome) return res.status(400).json({ error: "Nome obbligatorio" });
    await writeConfigKeys(orgId, (c) => {
      const pv = ((c.puntiVendita as StructPdv[] | undefined) || []).filter(p => normLow(p.ragioneSociale) !== normLow(nome));
      const rs = ((c.ragioniSociali as string[] | undefined) || []).filter(r => normLow(r) !== normLow(nome));
      return { ...c, puntiVendita: pv, ragioniSociali: rs };
    });
    try {
      await db.execute(sql`DELETE FROM cdg_spese WHERE organization_id = ${orgId} AND ragione_sociale = ${nome}`);
      await db.execute(sql`DELETE FROM cdg_pdv_manuali WHERE organization_id = ${orgId} AND ragione_sociale = ${nome}`);
      await db.execute(sql`UPDATE cdg_categorie SET ragioni_sociali = array_remove(ragioni_sociali, ${nome}) WHERE organization_id = ${orgId} AND ${nome} = ANY(ragioni_sociali)`);
      await db.execute(sql`DELETE FROM cdg_categorie WHERE organization_id = ${orgId} AND COALESCE(array_length(ragioni_sociali, 1), 0) = 0`);
      await db.execute(sql`UPDATE cdg_fornitori SET ragioni_sociali = array_remove(ragioni_sociali, ${nome}) WHERE organization_id = ${orgId} AND ${nome} = ANY(ragioni_sociali)`);
      await db.execute(sql`DELETE FROM cdg_fornitori WHERE organization_id = ${orgId} AND COALESCE(array_length(ragioni_sociali, 1), 0) = 0`);
      await db.execute(sql`DELETE FROM cdg_ragioni_sociali WHERE organization_id = ${orgId} AND nome = ${nome}`);
    } catch (e) { console.error("[struttura] cascade delete RS failed", e); }
    res.json({ success: true });
  });

  // === Controllo di Gestione ===
  registerCdgRoutes(app, isAuthenticated, requireModule);

  return httpServer;
}
