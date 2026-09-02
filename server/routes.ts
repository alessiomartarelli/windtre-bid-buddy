import type { Express, RequestHandler } from "express";
import { type Server } from "http";
import { storage, type CjItemDetailsUpdate, CJ_DEFAULT_TRIGGER_DATE, formatCjTriggerDate } from "./storage";
import session from "express-session";
import connectPg from "connect-pg-simple";
import bcrypt from "bcryptjs";
import { z } from "zod";
import type { BiSuiteMappingRule } from "../shared/bisuiteMapping";
import { getEffectiveRulesForEditor, getDefaultRulesHash, patchSavedRulesWithDefaultExclusions, retargetCaringSavedRules } from "../shared/bisuiteMapping";
import { isModuleEnabled, isModuleAllowedForBrands, isModuleGrantedToUser, sanitizeGrantableModules, WINDTRE_GATED_MODULES, MODULE_KEYS } from "../shared/modules";
import { type BisuiteSale, CJ_ITEM_STATES, type CjItemState, type CjDriver, insertBrandSchema } from "@shared/schema";
import { driverFromCategory, CJ_DRIVER_ORDER, summarizeDrivers } from "@shared/customerJourney";
import { ACCENT_PRESET_IDS, DASHBOARD_STYLE_IDS, SALES_STYLE_IDS, SCHEME_IDS, THEME_IDS } from "@shared/uiPrefs";
import { AVATAR_MAX_BYTES } from "@shared/avatar";
import { normalizeConfig, buildCalendar, normN, SECTION_IDS } from "@shared/incentivazione";
import { dtsSaleCodiceEsterno } from "@shared/dtsReport";
import { normalizeTimeLabel, parseSendTimes } from "@shared/telegramSendTimes";
import {
  wouldChangePuntiVenditaAnagrafica,
  wouldChangeRagioniSociali,
  wouldMassBlankPuntiVendita,
} from "@shared/strutturaGuard";
import { broadGaraConfigResetBlocks } from "@shared/garaConfigSafety";
import { registerCdgRoutes } from "./cdgRoutes";
import { cdgStorage } from "./cdgStorage";
import { computePlafondSaldi } from "./plafondRicariche";
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
import { sendDailyReportForOrg, rescheduleTelegramReports } from "./telegramReportScheduler";
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

type AvatarDataUrlValidation =
  | { ok: true; value: string }
  | { ok: false; status: 400 | 413; error: string };

/**
 * Gli avatar vengono salvati nel campo profilo già esistente come data URL.
 * Oltre al MIME dichiarato verifichiamo la firma binaria: il solo prefisso
 * `data:image/...` sarebbe falsificabile e finirebbe poi in ogni risposta
 * autenticata che contiene il profilo.
 */
function validateAvatarDataUrl(value: unknown): AvatarDataUrlValidation {
  if (typeof value !== "string") {
    return { ok: false, status: 400, error: "Avatar non valido" };
  }

  const match = value.match(/^data:(image\/png|image\/jpeg);base64,([A-Za-z0-9+/]+={0,2})$/);
  if (!match || match[2].length % 4 !== 0) {
    return { ok: false, status: 400, error: "Formato avatar non valido: usa un file PNG o JPEG" };
  }

  const image = Buffer.from(match[2], "base64");
  // Buffer.from è tollerante con base64 malformato: il round-trip assicura
  // che non abbia scartato caratteri o padding nascosti.
  if (image.length === 0 || image.toString("base64") !== match[2]) {
    return { ok: false, status: 400, error: "Dati avatar non validi" };
  }
  if (image.length > AVATAR_MAX_BYTES) {
    return { ok: false, status: 413, error: "Immagine troppo grande: il limite è 1 MB" };
  }

  const isPng = image.length >= 8
    && image.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const isJpeg = image.length >= 3 && image[0] === 0xff && image[1] === 0xd8 && image[2] === 0xff;
  if ((match[1] === "image/png" && !isPng) || (match[1] === "image/jpeg" && !isJpeg)) {
    return { ok: false, status: 400, error: "Il contenuto dell'avatar non corrisponde a un PNG o JPEG valido" };
  }

  return { ok: true, value };
}

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

// Task #524/#525: rimuove dai brandIds dei puntiVendita in organization_config
// gli id di brand non più validi (dissociati o eliminati), altrimenti ogni
// salvataggio successivo di quei PDV fallirebbe con 400 (validateBrandIds).
// Ritorna il numero di PDV ripuliti.
async function cleanupPdvBrandRefs(
  orgId: string,
  keepBrandId: (id: string) => boolean,
  updatedBy: string | null,
): Promise<number> {
  let pdvPuliti = 0;
  const cfg = await storage.getOrgConfig(orgId);
  const config = (cfg?.config as Record<string, unknown> | null) || {};
  const pv = Array.isArray(config.puntiVendita) ? (config.puntiVendita as Record<string, unknown>[]) : [];
  const next = pv.map((p) => {
    const ids = (p as any)?.brandIds;
    if (!Array.isArray(ids)) return p;
    const kept = ids.filter((id: unknown) => typeof id === "string" && keepBrandId(id));
    if (kept.length === ids.length) return p;
    pdvPuliti++;
    return { ...p, brandIds: kept };
  });
  if (pdvPuliti > 0) {
    await storage.upsertOrgConfig(orgId, { ...config, puntiVendita: next }, cfg?.configVersion || "2.0", updatedBy);
  }
  return pdvPuliti;
}

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
      let brandNames: string[] | null = null;
      if (keys.some((k) => WINDTRE_GATED_MODULES.includes(k))) {
        brandNames = (await storage.getOrganizationBrands(profile.organizationId)).map((b) => b.name);
      }
      // Restrizione per-utente (Task #311): oltre a org e brand, il modulo
      // deve essere concesso al profilo (moduliConsentiti). Se null =>
      // nessuna restrizione (eredita l'org).
      const granted = profile.moduliConsentiti ?? null;
      const anyEnabled = keys.some(
        (k) =>
          isModuleEnabled(enabled, k) &&
          isModuleAllowedForBrands(brandNames, k) &&
          isModuleGrantedToUser(granted, k),
      );
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
      const { rules: patched, changed: patchChanged } = patchSavedRulesWithDefaultExclusions(savedRules);
      // Task #289: migrate any saved "coupon caring" rules to the dedicated
      // coupon_caring category so caring is excluded from CB totals on existing
      // installations without requiring a re-mapping.
      const { rules: migrated, changed: caringChanged } = retargetCaringSavedRules(patched);
      if (!patchChanged && !caringChanged) return;
      const updatedBy = sysMapping?.updatedBy ?? null;
      await storage.upsertSystemConfig(
        "bisuite_mapping",
        { ...(mapping || {}), rules: migrated },
        updatedBy as string,
      );
      console.log("[bisuite-mapping] backfill: patched saved rules with new default exclusions / caring retarget");
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
      let organizationBrands: { id: string; name: string }[] = [];
      if (profile.organizationId) {
        organization = await storage.getOrganization(profile.organizationId);
        organizationBrands = (await storage.getOrganizationBrands(profile.organizationId))
          .map((b) => ({ id: b.id, name: b.name }));
      }

      await new Promise<void>((resolve, reject) => {
        req.session.save((err: any) => {
          if (err) reject(err);
          else resolve();
        });
      });

      res.json({ ...profile, passwordHash: undefined, organization, organizationBrands });
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

  // Task #513: le credenziali sensibili (BiSuite, trasporto Telegram) vivono
  // nella stessa riga organization_config ma si leggono/scrivono SOLO dagli
  // endpoint admin dedicati (/api/admin/bisuite-*, /api/admin/telegram-report),
  // che restituiscono forme sanificate (has_token, secret cifrato mai in
  // chiaro). La route generica è accessibile a qualunque utente con uno dei
  // moduli ORG_CONFIG_MODULES: anche se i segreti sono cifrati, non devono
  // uscire da qui né finire nei log del middleware API.
  function sanitizeOrgConfigRow<T extends { config?: unknown } | null | undefined>(row: T): T {
    if (!row || !row.config || typeof row.config !== "object") return row;
    const cfg = { ...(row.config as Record<string, unknown>) };
    delete cfg.bisuiteCredentials;
    if (cfg.telegramReport && typeof cfg.telegramReport === "object" && !Array.isArray(cfg.telegramReport)) {
      const tg = { ...(cfg.telegramReport as Record<string, unknown>) };
      delete tg.bot_token;
      cfg.telegramReport = tg;
    }
    return { ...(row as object), config: cfg } as T;
  }

  app.get("/api/organization-config", isAuthenticated, requireModule(ORG_CONFIG_MODULES), async (req: any, res) => {
    try {
      const userId = req.session.userId;
      const profile = await storage.getProfile(userId);
      if (!profile?.organizationId) {
        return res.json(null);
      }
      const config = await storage.getOrgConfig(profile.organizationId);
      res.json(sanitizeOrgConfigRow(config) || null);
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
      const cur = await storage.getOrgConfig(profile.organizationId);
      const curCfg = (cur?.config as Record<string, unknown> | null) || {};
      // Le configurazioni sensibili vengono gestite esclusivamente dai
      // rispettivi endpoint admin dedicati. Il salvataggio generico della
      // configurazione gara sostituisce il JSON intero e non deve quindi
      // cancellarle né sovrascriverle quando riceve un payload parziale/stale.
      for (const key of ["telegramReport", "bisuiteCredentials"] as const) {
        if (Object.prototype.hasOwnProperty.call(curCfg, key)) {
          effectiveConfig[key] = curCfg[key];
        } else {
          delete effectiveConfig[key];
        }
      }
      if (!['admin', 'super_admin'].includes(profile.role)) {
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
      } else {
        // Guardia anti-distruzione anche per admin/super_admin (Task #338):
        // 1) se il payload OMETTE una chiave strutturale presente nella config
        //    corrente, re-inietto il valore corrente (la struttura si modifica
        //    dagli endpoint /api/admin/struttura/*, non per omissione qui);
        // 2) se il payload azzererebbe in massa l'anagrafica dei PDV
        //    (tutti senza nome/codicePos/RS mentre oggi almeno uno li ha),
        //    rifiuto con 409: è il pattern dell'autosave del Simulatore con
        //    PDV scheletro, mai una modifica intenzionale.
        for (const k of ["puntiVendita", "ragioniSociali"] as const) {
          const incomingHas = Object.prototype.hasOwnProperty.call(effectiveConfig, k);
          const curHas = Object.prototype.hasOwnProperty.call(curCfg, k);
          // Chiave omessa, o presente ma non-array (null/{}): mai un edit
          // strutturale intenzionale → re-inietto il valore corrente.
          if ((!incomingHas || !Array.isArray(effectiveConfig[k])) && curHas) {
            effectiveConfig[k] = curCfg[k];
          } else if (incomingHas && !Array.isArray(effectiveConfig[k]) && !curHas) {
            delete effectiveConfig[k];
          }
        }
        // Task #519/#523 — anche il PUT generico può riscrivere puntiVendita.
        // Comportamento allineato agli endpoint dedicati /api/admin/struttura/*:
        // brandIds NON associati all'org vengono RIFIUTATI con 400 (stesso
        // messaggio di validateBrandIds), mai scartati in silenzio; i brandIds
        // validi vengono deduplicati al salvataggio.
        if (Array.isArray(effectiveConfig.puntiVendita)) {
          const orgBrandIds = new Set((await storage.getOrganizationBrands(profile.organizationId)).map((b) => b.id));
          const foreign = new Set<string>();
          for (const p of effectiveConfig.puntiVendita as Record<string, unknown>[]) {
            if (!p || typeof p !== "object" || !Array.isArray(p.brandIds)) continue;
            for (const b of p.brandIds) {
              const id = String(b);
              if (!orgBrandIds.has(id)) foreign.add(id);
            }
          }
          if (foreign.size > 0) {
            return res.status(400).json({
              message: `Brand non associati all'organizzazione: ${Array.from(foreign).join(", ")}`,
            });
          }
          effectiveConfig.puntiVendita = (effectiveConfig.puntiVendita as Record<string, unknown>[]).map((p) => {
            if (!p || typeof p !== "object" || !("brandIds" in p)) return p;
            const raw = Array.isArray(p.brandIds) ? p.brandIds.map((b) => String(b)) : [];
            return { ...p, brandIds: Array.from(new Set(raw)) };
          });
        }
        if (wouldMassBlankPuntiVendita(curCfg.puntiVendita, effectiveConfig.puntiVendita)) {
          console.warn(`[org-config] BLOCKED mass-blank puntiVendita save (org=${profile.organizationId}, user=${userId})`);
          return res.status(409).json({
            message: "Salvataggio bloccato: il salvataggio azzererebbe nome, codice POS e ragione sociale di tutti i punti vendita. Modifica la struttura da Gestione organizzazione → Struttura.",
          });
        }
        // Il PUT generico del Simulatore non può mai aggiungere, rimuovere o
        // rinominare l'anagrafica canonica. In passato una riduzione del numero
        // di PDV nel wizard ha sostituito 13 negozi reali con un solo PDV di
        // test. Le modifiche strutturali intenzionali passano esclusivamente
        // dagli endpoint strutturali dedicati di Gestione organizzazione o CdG
        // (admin-gated, validati e con storico automatico).
        if (
          wouldChangePuntiVenditaAnagrafica(curCfg.puntiVendita, effectiveConfig.puntiVendita) ||
          wouldChangeRagioniSociali(curCfg.ragioniSociali, effectiveConfig.ragioniSociali)
        ) {
          console.warn(`[org-config] BLOCKED canonical structure change via generic save (org=${profile.organizationId}, user=${userId})`);
          return res.status(409).json({
            message: "Salvataggio bloccato: il Simulatore non può aggiungere, rimuovere o rinominare punti vendita e ragioni sociali. Usa la gestione Struttura dedicata.",
          });
        }
      }
      const result = await storage.upsertOrgConfig(profile.organizationId, effectiveConfig, configVersion || "2.0", userId);
      res.json(sanitizeOrgConfigRow(result));
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
      const { month, year, config, name, id, expectedUpdatedAt } = req.body;
      if (!month || !year || month < 1 || month > 12) {
        return res.status(400).json({ message: "Parametri month/year non validi" });
      }
      if (!config || typeof config !== "object" || Array.isArray(config)) {
        return res.status(400).json({ message: "Configurazione non valida" });
      }
      const configName = name || 'Configurazione';
      let result;
      if (id) {
        const existing = await storage.getGaraConfigById(id);
        if (!existing || existing.organizationId !== profile.organizationId) {
          return res.status(404).json({ message: "Configurazione non trovata" });
        }
        if (typeof expectedUpdatedAt !== "string" || !Number.isFinite(Date.parse(expectedUpdatedAt))) {
          return res.status(428).json({
            code: "GARA_CONFIG_VERSION_REQUIRED",
            message: "Ricarica la configurazione prima di salvarla.",
          });
        }
        const resetBlocks = broadGaraConfigResetBlocks(existing.config, config);
        if (resetBlocks.length >= 2) {
          return res.status(409).json({
            code: "GARA_CONFIG_MASS_RESET",
            message: "Salvataggio bloccato: azzeramento anomalo di più sezioni della configurazione.",
            blocks: resetBlocks,
          });
        }
        result = await storage.updateGaraConfig(
          id,
          config,
          configName,
          profile.id ?? null,
          new Date(expectedUpdatedAt),
        );
        if (!result) {
          return res.status(409).json({
            code: "GARA_CONFIG_STALE",
            message: "La configurazione è stata modificata dopo il caricamento. Ricarica prima di salvare.",
          });
        }
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

  // Revisioni archiviate di una configurazione gara (snapshot pre-update).
  app.get("/api/gara-config/revisions", isAuthenticated, requireModule("gara_configurazione"), async (req: any, res) => {
    try {
      const profile = await requireAdminRole(req, res);
      if (!profile) return;
      const revisionId = req.query.revisionId as string | undefined;
      if (revisionId) {
        const rev = await storage.getGaraConfigRevision(profile.organizationId!, revisionId);
        if (!rev) return res.status(404).json({ message: "Revisione non trovata" });
        return res.json(rev);
      }
      const configId = req.query.configId as string | undefined;
      if (!configId) {
        return res.status(400).json({ message: "Parametro configId richiesto" });
      }
      const existing = await storage.getGaraConfigById(configId);
      if (!existing || existing.organizationId !== profile.organizationId) {
        return res.status(404).json({ message: "Configurazione non trovata" });
      }
      const revisions = await storage.listGaraConfigRevisions(profile.organizationId!, configId);
      res.json(revisions);
    } catch (error) {
      console.error("Error fetching gara config revisions:", error);
      res.status(500).json({ message: "Errore nel recupero delle revisioni configurazione gara" });
    }
  });

  // Ripristina una revisione archiviata nella configurazione corrente.
  // Il salvataggio via updateGaraConfig archivia a sua volta la versione
  // sostituita, quindi il ripristino stesso resta annullabile.
  app.post("/api/gara-config/revisions/restore", isAuthenticated, requireModule("gara_configurazione"), async (req: any, res) => {
    try {
      const profile = await requireAdminRole(req, res);
      if (!profile) return;
      const { revisionId } = req.body ?? {};
      if (!revisionId || typeof revisionId !== "string") {
        return res.status(400).json({ message: "Parametro revisionId richiesto" });
      }
      const rev = await storage.getGaraConfigRevision(profile.organizationId!, revisionId);
      if (!rev) return res.status(404).json({ message: "Revisione non trovata" });
      const existing = await storage.getGaraConfigById(rev.garaConfigId);
      if (!existing || existing.organizationId !== profile.organizationId) {
        return res.status(404).json({ message: "Configurazione non trovata" });
      }
      const result = await storage.updateGaraConfig(
        existing.id,
        rev.config as Record<string, unknown>,
        rev.name ?? existing.name ?? "Configurazione",
        profile.id ?? null,
        new Date(existing.updatedAt ?? existing.createdAt ?? 0),
      );
      if (!result) {
        return res.status(409).json({
          code: "GARA_CONFIG_STALE",
          message: "La configurazione è cambiata durante il ripristino. Riprova dalla cronologia aggiornata.",
        });
      }
      res.json(result);
    } catch (error) {
      console.error("Error restoring gara config revision:", error);
      res.status(500).json({ message: "Errore nel ripristino della revisione configurazione gara" });
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

      // Preserva le impostazioni gara non sostituite dall'import: parti
      // dall'ultima configurazione esistente per il mese (tabelle di calcolo,
      // soglie Extra P.IVA, forecast, pesi, ecc.) e sovrascrivi SOLO le
      // chiavi effettivamente importate. L'import crea comunque un NUOVO
      // record: la configurazione precedente resta recuperabile.
      const existingForMonth = await storage.getGaraConfig(profile.organizationId!, month, year);
      const preservedBase = { ...((existingForMonth?.config as Record<string, unknown> | null) || {}) };
      // Il dataset SOS Caring è legato al file caricato sulla config di
      // origine: un import dal simulatore deve ripartire da card vuota
      // (Task SOS Caring import), quindi NON viene trascinato.
      delete preservedBase.sosCaring;
      const garaConfigData: Record<string, unknown> = {
        ...preservedBase,
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

  // === Gestione DTS (Task #321) ===
  // Lead drive-to-store: upload Excel (parsing client-side), lista lead e
  // vendite del periodo per il calcolo dell'incidenza. Upload/cancellazione
  // solo admin; lettura per chiunque abbia il modulo.
  const dtsLeadSchema = z.object({
    leadKey: z.string().min(1).max(500),
    consulente: z.string().max(255).default(""),
    campagna: z.string().max(500).default(""),
    nominativo: z.string().max(255).default(""),
    email: z.string().max(255).default(""),
    codiceFiscale: z.string().max(64).default(""),
    telefono: z.string().max(64).default(""),
    inCarico: z.string().max(255).default(""),
    stato: z.string().max(255).default(""),
    data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
    idVendita: z.number().int().positive().nullable(),
    addettoVendita: z.string().max(255).default(""),
    origineLead: z.string().max(255).default(""),
  });
  const dtsUploadSchema = z.object({
    fileName: z.string().min(1).max(255),
    leads: z.array(dtsLeadSchema).min(1).max(50000),
  });

  app.get("/api/dts/leads", isAuthenticated, requireModule("gestione_dts"), async (req: any, res) => {
    try {
      const profile = await storage.getProfile(req.session.userId);
      if (!profile?.organizationId) return res.status(403).json({ message: "Profilo senza organizzazione" });
      const leads = await storage.getDtsLeads(profile.organizationId);
      res.json(leads);
    } catch (e) {
      console.error("Error listing DTS leads:", e);
      res.status(500).json({ message: "Errore nel recupero dei lead DTS" });
    }
  });

  // Vendite del periodo (range YMD in path, vedi convenzione queryKey→path)
  // nella forma minima per il report DTS, ANNULLATA escluse.
  app.get("/api/dts/sales/:from/:to", isAuthenticated, requireModule("gestione_dts"), async (req: any, res) => {
    try {
      const profile = await storage.getProfile(req.session.userId);
      if (!profile?.organizationId) return res.status(403).json({ message: "Profilo senza organizzazione" });
      const re = /^\d{4}-\d{2}-\d{2}$/;
      const { from, to } = req.params as { from: string; to: string };
      if (!re.test(from) || !re.test(to) || from > to) {
        return res.status(400).json({ message: "Intervallo date non valido (YYYY-MM-DD)" });
      }
      const sales = await storage.getBisuiteSalesByItalianDateRange(profile.organizationId, from, to, false);
      res.json(sales.map((s) => ({
        bisuiteId: s.bisuiteId,
        // ID VENDITA del file DTS = codice esterno BiSuite (Task #324),
        // NON il bisuiteId interno.
        codiceEsterno: dtsSaleCodiceEsterno({ rawData: s.rawData }),
        stato: s.stato,
        codicePos: s.codicePos,
        nomeNegozio: s.nomeNegozio,
        nomeAddetto: s.nomeAddetto,
        rawData: s.rawData,
      })));
    } catch (e) {
      console.error("Error fetching DTS sales:", e);
      res.status(500).json({ message: "Errore nel recupero delle vendite per il report DTS" });
    }
  });

  app.post("/api/dts/upload", isAuthenticated, requireModule("gestione_dts"), async (req: any, res) => {
    try {
      const profile = await requireAdminRole(req, res);
      if (!profile) return;
      const parsed = dtsUploadSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Dati DTS non validi", errors: parsed.error.flatten() });
      }
      const { fileName, leads } = parsed.data;
      // Upload full-file (Task #324): i lead dell'org vengono RIGENERATI a
      // ogni upload (delete+insert transazionale), così le righe legacy con
      // la vecchia chiave di dedup non producono duplicati.
      const count = await storage.replaceDtsLeads(profile.organizationId!, leads.map((l) => ({
        ...l,
        organizationId: profile.organizationId!,
        fileName,
        uploadedBy: profile.id,
      })));
      res.json({ ok: true, count });
    } catch (e) {
      console.error("Error saving DTS upload:", e);
      res.status(500).json({ message: "Errore nel salvataggio dei lead DTS" });
    }
  });

  app.delete("/api/dts/leads", isAuthenticated, requireModule("gestione_dts"), async (req: any, res) => {
    try {
      const profile = await requireAdminRole(req, res);
      if (!profile) return;
      await storage.deleteDtsLeads(profile.organizationId!);
      res.json({ ok: true });
    } catch (e) {
      console.error("Error deleting DTS leads:", e);
      res.status(500).json({ message: "Errore nell'eliminazione dei lead DTS" });
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
      // Task #525: prima del delete globale, ripulisci i riferimenti residui
      // nei brandIds dei puntiVendita di TUTTE le org associate, altrimenti
      // (le associazioni org↔brand cadono in cascata via FK) ogni salvataggio
      // successivo di quei PDV fallirebbe con 400 (validateBrandIds).
      // Itera TUTTE le org (non solo quelle con associazione corrente):
      // possono esistere riferimenti residui anche in org senza associazione
      // (dati legacy o dissociazioni precedenti alla pulizia automatica).
      let pdvPuliti = 0;
      const orgs = await storage.getOrganizations();
      for (const o of orgs) {
        pdvPuliti += await cleanupPdvBrandRefs(o.id, (id) => id !== brand.id, req.session.userId ?? null);
      }
      // Le associazioni org↔brand vengono rimosse in cascata (FK).
      await storage.deleteBrand(brand.id);
      res.json({ ok: true, removedAssociations, pdvPuliti });
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
      // Task #524: alla dissociazione di un brand, ripulisci i riferimenti
      // residui nei brandIds dei puntiVendita in organization_config,
      // altrimenti ogni salvataggio successivo di quei PDV fallirebbe con
      // 400 (validateBrandIds) finché qualcuno non li ripulisce a mano.
      const allowed = new Set(saved);
      const pdvPuliti = await cleanupPdvBrandRefs(org.id, (id) => allowed.has(id), req.session.userId ?? null);
      res.json({ ok: true, brandIds: saved, pdvPuliti });
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
      const { user_id, userId: userIdAlt, full_name, fullName, email, role, moduliConsentiti } = req.body;
      const targetId = user_id || userIdAlt;
      const resolvedFullName = fullName || full_name;
      const targetProfile = await storage.getProfile(targetId);
      if (profile.role === "admin") {
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
      // Permessi moduli per-utente (Task #311): null azzera la restrizione
      // (eredita org); un array è una whitelist filtrata al perimetro
      // org ∩ brand. Vietato modificare i permessi di un super_admin.
      if (moduliConsentiti !== undefined) {
        if (!targetProfile) return res.status(404).json({ error: "Utente non trovato" });
        if (targetProfile.role === "super_admin") {
          return res.status(403).json({ error: "Non puoi modificare i permessi di un super_admin" });
        }
        if (moduliConsentiti === null) {
          updateData.moduliConsentiti = null;
        } else if (Array.isArray(moduliConsentiti) && moduliConsentiti.every((k) => typeof k === "string")) {
          const orgId = targetProfile.organizationId;
          const org = orgId ? await storage.getOrganization(orgId) : undefined;
          const enabled = org?.enabledModules ?? null;
          const brandNames = orgId
            ? (await storage.getOrganizationBrands(orgId)).map((b) => b.name)
            : null;
          updateData.moduliConsentiti = sanitizeGrantableModules(
            moduliConsentiti as string[],
            enabled,
            brandNames,
          );
        } else {
          return res.status(400).json({ error: "moduliConsentiti deve essere null o un array di stringhe" });
        }
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
      const { fullName, full_name, email, profileImageUrl } = req.body ?? {};
      const resolvedFullName = fullName ?? full_name;
      const updateData: { fullName?: string; email?: string; profileImageUrl?: string | null } = {};

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

      // Solo l'utente della sessione può aggiornare il suo avatar: l'id
      // destinazione non arriva mai dal client e updateProfile usa userId.
      if (profileImageUrl !== undefined) {
        if (profileImageUrl === null || profileImageUrl === "") {
          updateData.profileImageUrl = null;
        } else {
          const avatar = validateAvatarDataUrl(profileImageUrl);
          if (!avatar.ok) {
            return res.status(avatar.status).json({ error: avatar.error });
          }
          updateData.profileImageUrl = avatar.value;
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

  // === Profilo: preferenze UI (tema + palette + varianti pagina) ===
  app.patch("/api/auth/ui-prefs", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session.userId;
      const profile = await storage.getProfile(userId);
      if (!profile) return res.status(404).json({ error: "Profilo non trovato" });
      const { theme, accent, scheme, dashboardStyle, salesStyle } = req.body ?? {};
      // Patch parziale: solo le chiavi inviate; il merge col valore esistente
      // avviene atomicamente in SQL (jsonb ||) per evitare lost update tra
      // PATCH ravvicinate.
      const patch: { theme?: string; accent?: any; scheme?: string; dashboardStyle?: string; salesStyle?: string } = {};
      if (scheme !== undefined) {
        if (!(SCHEME_IDS as readonly string[]).includes(scheme)) {
          return res.status(400).json({ error: "scheme non valido" });
        }
        patch.scheme = scheme;
      }
      if (theme !== undefined) {
        if (!(THEME_IDS as readonly string[]).includes(theme)) {
          return res.status(400).json({ error: "theme non valido" });
        }
        patch.theme = theme;
      }
      if (accent !== undefined) {
        const okPreset = accent?.type === "preset" && typeof accent.id === "string" && (ACCENT_PRESET_IDS as readonly string[]).includes(accent.id);
        const okCustom = accent?.type === "custom" && typeof accent.hex === "string" && /^#?[0-9a-fA-F]{6}$/.test(accent.hex);
        if (!okPreset && !okCustom) {
          return res.status(400).json({ error: "accent non valido" });
        }
        patch.accent = okCustom ? { type: "custom", hex: accent.hex.startsWith("#") ? accent.hex : `#${accent.hex}` } : { type: "preset", id: accent.id };
      }
      if (dashboardStyle !== undefined) {
        if (!(DASHBOARD_STYLE_IDS as readonly string[]).includes(dashboardStyle)) {
          return res.status(400).json({ error: "dashboardStyle non valido" });
        }
        patch.dashboardStyle = dashboardStyle;
      }
      if (salesStyle !== undefined) {
        if (!(SALES_STYLE_IDS as readonly string[]).includes(salesStyle)) {
          return res.status(400).json({ error: "salesStyle non valido" });
        }
        patch.salesStyle = salesStyle;
      }
      if (Object.keys(patch).length === 0) {
        return res.status(400).json({ error: "Nessuna preferenza da aggiornare" });
      }
      const updated = await storage.mergeUiPrefs(userId, patch);
      res.json({ uiPrefs: updated.uiPrefs });
    } catch (error) {
      console.error("Error updating UI prefs:", error);
      res.status(500).json({ error: "Errore nel salvataggio delle preferenze aspetto" });
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
        send_times: parseSendTimes(tg.send_times),
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
      const { organization_id, enabled, bot_token, chat_id, clear_token, send_times } = req.body ?? {};
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
      // Orari di invio (Task #334): validati e normalizzati "HH:MM"; campi
      // invalidi o uguali fra loro ⇒ 400 (mai salvare orari ambigui).
      let sendTimes = undefined as ReturnType<typeof parseSendTimes> | undefined;
      if (send_times !== undefined) {
        const parziale = normalizeTimeLabel((send_times as Record<string, unknown>)?.parziale);
        const chiusura = normalizeTimeLabel((send_times as Record<string, unknown>)?.chiusura);
        if (!parziale || !chiusura || parziale === chiusura) {
          return res.status(400).json({
            error:
              "Orari di invio non validi: servono due orari HH:MM distinti (esclusa la fascia 02:00–02:59)",
          });
        }
        sendTimes = { parziale, chiusura };
      }
      // Il forecast/obiettivi vive ora nella Configurazione gara
      // (gara_config.config.venditeForecast), per-mese: qui restano solo
      // token, chat_id e flag di abilitazione. Un eventuale forecast già
      // salvato in questo blocco viene preservato ma non più usato.
      const existingForecast = existingTg?.forecast;
      const existingSendTimes = existingTg?.send_times;
      const updatedConfig = {
        ...existingConfig,
        telegramReport: {
          enabled: isEnabled,
          bot_token: encToken,
          chat_id: chatId,
          ...(sendTimes !== undefined
            ? { send_times: sendTimes }
            : existingSendTimes !== undefined
              ? { send_times: existingSendTimes }
              : {}),
          ...(existingForecast !== undefined ? { forecast: existingForecast } : {}),
        },
      };
      await storage.upsertOrgConfig(
        organization_id,
        updatedConfig,
        orgConfig?.configVersion || "2.0",
      );
      // Ri-arma subito il timer dello scheduler (Task #334): un nuovo orario
      // ancora futuro di OGGI vale da subito, non dal prossimo giro. No-op
      // se lo scheduler non è avviato (dev).
      rescheduleTelegramReports();
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
      const { normalizePdvView, resolveSalePdvForView } = await import("../shared/pdvView");
      const pdvView = normalizePdvView(req.query.pdvView);

      const buildPdvDirectory = async (months: Array<{ year: number; month: number }>) => {
        if (pdvView !== "destinazione") return {};
        const directory = new Map<string, { nomeNegozio: string; ragioneSociale: string }>();
        const addList = (list: unknown) => {
          if (!Array.isArray(list)) return;
          for (const raw of list) {
            if (!raw || typeof raw !== "object") continue;
            const pdv = raw as { codicePos?: unknown; nome?: unknown; ragioneSociale?: unknown };
            const codicePos = typeof pdv.codicePos === "string" ? pdv.codicePos.trim() : "";
            if (!codicePos) continue;
            directory.set(codicePos, {
              nomeNegozio: typeof pdv.nome === "string" && pdv.nome.trim() ? pdv.nome.trim() : codicePos,
              ragioneSociale: typeof pdv.ragioneSociale === "string" ? pdv.ragioneSociale.trim() : "",
            });
          }
        };

        const orgConfig = await storage.getOrgConfig(orgId);
        addList((orgConfig?.config as { puntiVendita?: unknown } | null | undefined)?.puntiVendita);
        for (const period of months) {
          const cfg = await storage.getGaraConfig(orgId, period.month, period.year);
          addList((cfg?.config as { pdvList?: unknown } | null | undefined)?.pdvList);
        }
        return Object.fromEntries(directory);
      };

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

      // Task #367: canonicalizza la Ragione Sociale in lettura (alias +
      // normalizzazione dal registro RS). I dati storici restano invariati.
      const resolveRs = await cdgStorage.getRsResolver(orgId);
      const canonRs = (sales: BisuiteSale[]): BisuiteSale[] => sales.map((s) => {
        const canon = s.ragioneSociale ? resolveRs(s.ragioneSociale) : s.ragioneSociale;
        return canon !== s.ragioneSociale ? { ...s, ragioneSociale: canon } : s;
      });

      const yearParam = req.query.year ? parseInt(req.query.year as string, 10) : NaN;
      const monthParam = req.query.month ? parseInt(req.query.month as string, 10) : NaN;
      if (Number.isFinite(yearParam) && Number.isFinite(monthParam) && monthParam >= 1 && monthParam <= 12) {
        const sales = canonRs(applyOperatorFilter(await storage.getBisuiteSalesByItalianMonth(orgId, yearParam, monthParam, includeAnnullate)));
        const pdvDirectory = await buildPdvDirectory([{ year: yearParam, month: monthParam }]);
        return res.json({ sales, count: sales.length, pdvDirectory });
      }

      const fromYMD = toItalianYMD(req.query.from as string | undefined);
      const toYMD = toItalianYMD(req.query.to as string | undefined);
      if (!fromYMD || !toYMD) {
        return res.status(400).json({ error: "Parametri from/to non validi (atteso YYYY-MM-DD)" });
      }
      const periods: Array<{ year: number; month: number }> = [];
      const cursor = new Date(`${fromYMD.slice(0, 7)}-01T00:00:00Z`);
      const stop = new Date(`${toYMD.slice(0, 7)}-01T00:00:00Z`);
      while (cursor <= stop && periods.length < 120) {
        periods.push({ year: cursor.getUTCFullYear(), month: cursor.getUTCMonth() + 1 });
        cursor.setUTCMonth(cursor.getUTCMonth() + 1);
      }
      const sales = canonRs(applyOperatorFilter(await storage.getBisuiteSalesByItalianDateRange(orgId, fromYMD, toYMD, includeAnnullate)));
      const pdvDirectory = await buildPdvDirectory(periods);
      res.json({ sales, count: sales.length, pdvDirectory });
    } catch (error: unknown) {
      console.error("BiSuite sales read error:", error);
      const msg = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: "Errore nel recupero vendite", details: msg });
    }
  });

  // ── Plafond ricariche per Ragione Sociale (Task #537) ─────────────
  // Il saldo NON è un contatore: è sempre DERIVATO da (operazioni append-only
  // aggiungi/imposta) + (consumo = articoli RICARICHE su vendite non annullate,
  // canonicalizzati per RS). L'ultima 'imposta' fissa il saldo assoluto a un
  // cutoff wall-time italiano: il consumo riparte da lì; le 'aggiungi'
  // successive si sommano. Sync ripetute/riallineamenti non possono produrre
  // doppie sottrazioni perché il consumo è ricalcolato dai dati, mai scalato.
  const resolveBisuiteOrg = async (req: any): Promise<{ profile: any; orgId: string } | null> => {
    const profile = await storage.getProfile(req.session.userId);
    if (!profile?.organizationId) return null;
    const orgId = (req.query.organization_id as string) || profile.organizationId;
    if (profile.role !== "super_admin" && orgId !== profile.organizationId) return null;
    return { profile, orgId };
  };

  // Calcolo saldi condiviso con il report Telegram (Task #538):
  // vedi server/plafondRicariche.ts (soglia di avviso inclusa).

  // Saldi plafond per RS + timestamp dell'ultima sincronizzazione BiSuite.
  // Lettura consentita a chiunque acceda alla pagina Vendite BiSuite.
  // Scoping per-operatore (coerente con /api/bisuite-sales, Task #158): un
  // operatore vede solo le RS su cui i suoi nominativi addetti hanno vendite;
  // senza addetti associati non vede alcun saldo/storico. Admin e super_admin
  // (ritorno null) vedono tutto. Le RS sono confrontate in forma canonica.
  // Task #544: il perimetro operatore copre sia le RS canoniche (righe legacy)
  // sia i codici POS (righe per dealer) su cui i suoi addetti hanno vendite.
  const operatorAllowedScope = async (profile: any, orgId: string): Promise<{ rs: Set<string>; pos: Set<string> } | null> => {
    if (profile.role !== "operatore") return null;
    const addetti = (profile.bisuiteAddetti ?? []).map((a: string) => a.toLowerCase().trim()).filter(Boolean);
    if (addetti.length === 0) return { rs: new Set(), pos: new Set() };
    const [rawRs, rawPos, resolveRs] = await Promise.all([
      storage.getRsForAddetti(orgId, addetti),
      storage.getPosForAddetti(orgId, addetti),
      cdgStorage.getRsResolver(orgId),
    ]);
    return {
      rs: new Set(rawRs.map((rs) => resolveRs(rs) || rs)),
      pos: new Set(rawPos.map((p) => p.trim().toUpperCase())),
    };
  };
  // Un saldo è visibile all'operatore se un suo PDV rientra nei POS degli
  // addetti (righe dealer / senza-dealer) o se la RS coincide (righe legacy).
  const saldoVisibleToOperator = (s: import("./plafondRicariche").PlafondSaldo, scope: { rs: Set<string>; pos: Set<string> }) => {
    if (s.pdv.some((p) => scope.pos.has(p.codicePos.trim().toUpperCase()))) return true;
    if (!s.codiceDealer) return scope.rs.has(s.ragioneSociale);
    return false;
  };

  app.get("/api/ricariche-plafond", isAuthenticated, requireModule("vendite_bisuite"), async (req: any, res) => {
    try {
      const ctx = await resolveBisuiteOrg(req);
      if (!ctx) return res.status(403).json({ error: "Accesso non autorizzato" });
      const [saldi, lastSync, scope] = await Promise.all([
        computePlafondSaldi(ctx.orgId),
        storage.getLastBisuiteSync(ctx.orgId),
        operatorAllowedScope(ctx.profile, ctx.orgId),
      ]);
      const visible = scope ? saldi.filter((s) => saldoVisibleToOperator(s, scope)) : saldi;
      res.json({ saldi: visible, lastSync: lastSync ? lastSync.toISOString() : null });
    } catch (error: unknown) {
      console.error("Plafond ricariche read error:", error);
      res.status(500).json({ error: "Errore nel recupero del plafond ricariche" });
    }
  });

  // Storico append-only delle operazioni amministrative (consultabile da
  // tutti gli utenti autorizzati alla pagina; nessuna modifica/cancellazione).
  app.get("/api/ricariche-plafond/storico", isAuthenticated, requireModule("vendite_bisuite"), async (req: any, res) => {
    try {
      const ctx = await resolveBisuiteOrg(req);
      if (!ctx) return res.status(403).json({ error: "Accesso non autorizzato" });
      const [ops, registry, scope, saldi] = await Promise.all([
        storage.listPlafondRicaricheOps(ctx.orgId),
        cdgStorage.listRagioniSociali(ctx.orgId, { includeAuto: true }),
        operatorAllowedScope(ctx.profile, ctx.orgId),
        // Serve solo agli operatori per derivare i dealer visibili.
        ctx.profile.role === "operatore" ? computePlafondSaldi(ctx.orgId) : Promise.resolve(null),
      ]);
      const nameById = new Map(registry.map((r) => [r.id, r.nome]));
      // Gli operatori vedono solo le operazioni dei dealer/RS di pertinenza:
      // stessa regola di visibilità dei saldi, applicata alle operazioni.
      let visibleOps = ops;
      if (scope) {
        const visibleDealers = new Set(
          (saldi ?? [])
            .filter((s) => s.codiceDealer && saldoVisibleToOperator(s, scope))
            .map((s) => s.codiceDealer.trim().toUpperCase()),
        );
        visibleOps = ops.filter((op) => {
          const dealer = String(op.codiceDealer ?? "").trim().toUpperCase();
          if (dealer) return visibleDealers.has(dealer);
          return scope.rs.has(nameById.get(op.ragioneSocialeId ?? "") ?? "");
        });
      }
      res.json({
        storico: visibleOps
          .slice()
          .reverse()
          .map((op) => ({
            id: op.id,
            ragioneSocialeId: op.ragioneSocialeId ?? "",
            codiceDealer: op.codiceDealer ?? "",
            ragioneSociale: nameById.get(op.ragioneSocialeId ?? "") ?? "",
            tipo: op.tipo,
            importo: Number(op.importo),
            saldoPrima: Number(op.saldoPrima),
            saldoDopo: Number(op.saldoDopo),
            utente: op.createdByName || op.createdBy || "N/D",
            createdAt: op.createdAt?.toISOString?.() ?? null,
          })),
      });
    } catch (error: unknown) {
      console.error("Plafond ricariche storico error:", error);
      res.status(500).json({ error: "Errore nel recupero dello storico plafond" });
    }
  });

  // Operazione amministrativa sul plafond: SOLO admin e super_admin.
  // body: { codiceDealer?: string, ragioneSociale?: string,
  //         tipo: 'aggiungi'|'imposta'|'soglia', importo: number }
  // Task #544: la chiave contabile è il codice dealer. `ragioneSociale` resta
  // accettata per compatibilità (org senza dealer configurati / righe legacy);
  // se la RS mappa su UN solo dealer l'operazione viene registrata su quel
  // dealer, così i nuovi inserimenti migrano naturalmente al modello dealer.
  app.post("/api/ricariche-plafond", isAuthenticated, requireModule("vendite_bisuite"), async (req: any, res) => {
    try {
      const ctx = await resolveBisuiteOrg(req);
      if (!ctx) return res.status(403).json({ error: "Accesso non autorizzato" });
      const { profile, orgId } = ctx;
      if (profile.role !== "admin" && profile.role !== "super_admin") {
        return res.status(403).json({ error: "Solo gli amministratori possono modificare il plafond" });
      }
      const rawDealer = typeof req.body?.codiceDealer === "string" ? req.body.codiceDealer.trim() : "";
      const rawNome = typeof req.body?.ragioneSociale === "string" ? req.body.ragioneSociale.trim() : "";
      const tipo = req.body?.tipo;
      const importo = Number(req.body?.importo);
      if (!rawDealer && !rawNome) return res.status(400).json({ error: "codiceDealer o ragioneSociale obbligatorio" });
      // Task #538: 'soglia' registra (append-only) la soglia di avviso;
      // importo 0 = soglia disattivata. Il saldo NON cambia.
      if (tipo !== "aggiungi" && tipo !== "imposta" && tipo !== "soglia") {
        return res.status(400).json({ error: "tipo non valido (atteso 'aggiungi', 'imposta' o 'soglia')" });
      }
      if (!Number.isFinite(importo) || (tipo === "aggiungi" ? importo <= 0 : importo < 0)) {
        return res.status(400).json({ error: tipo === "aggiungi" ? "importo deve essere positivo" : "importo non valido" });
      }

      const resolveRs = await cdgStorage.getRsResolver(orgId);
      const { getDealerMaps } = await import("./plafondRicariche");
      const { dealers, rsConPdv } = await getDealerMaps(orgId, resolveRs);

      let codiceDealer: string | null = null;
      let rsId: string | null = null;
      let canon = "";
      let saldi: Awaited<ReturnType<typeof computePlafondSaldi>> | null = null;
      let warning: string | null = null; // Task #549
      if (rawDealer) {
        const info = dealers.get(rawDealer.toUpperCase());
        if (!info) return res.status(400).json({ error: `Codice dealer "${rawDealer}" non presente nella Struttura PDV` });
        codiceDealer = info.codice;
        // RS descrittiva: valorizzata solo se il dealer appartiene a una sola RS.
        if (info.rsCanon.size === 1) {
          canon = Array.from(info.rsCanon)[0];
          if (canon && canon !== "N/D") rsId = await cdgStorage.ensureRsId(orgId, canon, "auto");
        }
      } else {
        // Percorso legacy per RS: canonicalizza e assicura l'anchor.
        canon = resolveRs(rawNome) || rawNome;
        // Task #549 — una RS senza PDV in Struttura non compare nel riepilogo
        // (Task #548): senza avviso l'operazione finirebbe solo nello storico,
        // invisibile. Non rifiutiamo (impostare il plafond PRIMA di censire il
        // PDV o di una rinomina/merge è un flusso legittimo), ma la risposta
        // include un avviso esplicito quando la RS non ha né PDV né una card
        // già visibile (consumo storico / operazioni pregresse).
        if (!rsConPdv.has(canon)) {
          saldi = await computePlafondSaldi(orgId);
          const visibile = saldi.some((s) => !s.codiceDealer && s.ragioneSociale === canon);
          if (!visibile) {
            warning = `La Ragione Sociale "${canon}" non ha alcun PDV in Struttura: l'operazione è registrata nello storico ma NON comparirà nel riepilogo plafond finché non aggiungi un PDV con questa Ragione Sociale (o non usi il codice dealer).`;
          }
        }
        rsId = await cdgStorage.ensureRsId(orgId, canon, "auto");
        // Se la RS mappa su UN solo dealer, registra direttamente sul dealer.
        const matches = Array.from(dealers.values()).filter((d) => d.rsCanon.has(canon));
        if (matches.length === 1) codiceDealer = matches[0].codice;
      }

      saldi ??= await computePlafondSaldi(orgId);
      const current = codiceDealer
        ? saldi.find((s) => s.codiceDealer.trim().toUpperCase() === codiceDealer!.trim().toUpperCase())
        : saldi.find((s) => !s.codiceDealer && (s.ragioneSocialeId === rsId || s.ragioneSociale === canon));
      const saldoPrima = current?.saldo ?? (current ? -current.consumoDaCutoff : 0);
      const saldoDopo = tipo === "imposta"
        ? Math.round(importo * 100) / 100
        : tipo === "soglia"
          ? Math.round(saldoPrima * 100) / 100 // la soglia non tocca il saldo
          : Math.round((saldoPrima + importo) * 100) / 100;

      const op = await storage.insertPlafondRicaricheOp({
        organizationId: orgId,
        ragioneSocialeId: rsId,
        codiceDealer,
        tipo,
        importo: importo.toFixed(2),
        saldoPrima: (Math.round(saldoPrima * 100) / 100).toFixed(2),
        saldoDopo: saldoDopo.toFixed(2),
        // Cutoff wall-time italiano (stessa convenzione di data_vendita):
        // per 'imposta' il consumo precedente è assorbito nel nuovo saldo.
        consumoCutoff: tipo === "imposta" ? toItalianWallTime(new Date()) : null,
        createdBy: profile.id,
        createdByName: profile.fullName || profile.email || null,
      });

      res.status(201).json({
        success: true,
        op: { id: op.id, tipo: op.tipo, importo: Number(op.importo), saldoPrima: Number(op.saldoPrima), saldoDopo: Number(op.saldoDopo) },
        codiceDealer: codiceDealer ?? "",
        ragioneSociale: canon,
        saldo: saldoDopo,
        ...(warning ? { warning } : {}),
      });
    } catch (error: unknown) {
      console.error("Plafond ricariche op error:", error);
      res.status(500).json({ error: "Errore nel salvataggio dell'operazione plafond" });
    }
  });

  // Task #544 — assegna a un dealer le operazioni plafond storiche registrate
  // per RS (codice_dealer NULL). Serve per le RS con PIÙ dealer, dove
  // l'attribuzione automatica in lettura sarebbe ambigua. Le stesse righe
  // vengono ripuntate (nessuna duplicazione di importi o saldi).
  app.post("/api/ricariche-plafond/assegna", isAuthenticated, requireModule("vendite_bisuite"), async (req: any, res) => {
    try {
      const ctx = await resolveBisuiteOrg(req);
      if (!ctx) return res.status(403).json({ error: "Accesso non autorizzato" });
      const { profile, orgId } = ctx;
      if (profile.role !== "admin" && profile.role !== "super_admin") {
        return res.status(403).json({ error: "Solo gli amministratori possono modificare il plafond" });
      }
      const rawNome = typeof req.body?.ragioneSociale === "string" ? req.body.ragioneSociale.trim() : "";
      const rawDealer = typeof req.body?.codiceDealer === "string" ? req.body.codiceDealer.trim() : "";
      if (!rawNome || !rawDealer) return res.status(400).json({ error: "ragioneSociale e codiceDealer obbligatori" });
      const resolveRs = await cdgStorage.getRsResolver(orgId);
      const { getDealerMaps } = await import("./plafondRicariche");
      const { dealers } = await getDealerMaps(orgId, resolveRs);
      const info = dealers.get(rawDealer.toUpperCase());
      if (!info) return res.status(400).json({ error: `Codice dealer "${rawDealer}" non presente nella Struttura PDV` });
      const canon = resolveRs(rawNome) || rawNome;
      // Guard contabile: il dealer di destinazione deve appartenere alla
      // stessa RS delle operazioni storiche, altrimenti si sposterebbe il
      // plafond di una RS su un dealer di un'altra.
      if (!info.rsCanon.has(canon)) {
        return res.status(400).json({ error: `Il dealer "${info.codice}" non appartiene alla Ragione Sociale "${rawNome}"` });
      }
      const registry = await cdgStorage.listRagioniSociali(orgId, { includeAuto: true });
      const anchor = registry.find((r) => (resolveRs(r.nome) || r.nome) === canon);
      if (!anchor) return res.status(404).json({ error: `Ragione Sociale "${rawNome}" non trovata` });
      const updated = await storage.assignPlafondOpsDealer(orgId, anchor.id, info.codice);
      if (updated === 0) return res.status(404).json({ error: "Nessuna operazione da assegnare per questa Ragione Sociale" });
      res.json({ success: true, assegnate: updated, codiceDealer: info.codice });
    } catch (error: unknown) {
      console.error("Plafond ricariche assegna error:", error);
      res.status(500).json({ error: "Errore nell'assegnazione delle operazioni plafond" });
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
      // Task #462 — vista PDV origine/destinazione: ricalcola l'intero
      // prospetto attribuendo le vendite al PDV scelto. Default 'origine'
      // (comportamento invariato). Solo questa route la supporta: tutti gli
      // altri consumer restano ancorati al PDV di origine.
      const { normalizePdvView, resolveSalePdvForView } = await import("../shared/pdvView");
      const pdvView = normalizePdvView(req.query.pdvView);

      // Task #367: canonicalizza le RS (alias + normalizzazione dal registro)
      // prima di filtri e aggregazione, come in GET /api/bisuite-sales.
      const resolveRsMapped = await cdgStorage.getRsResolver(orgId);
      const allSales = (await storage.getBisuiteSalesByItalianMonth(orgId, year, month)).map((s) => {
        const canon = s.ragioneSociale ? resolveRsMapped(s.ragioneSociale) : s.ragioneSociale;
        return canon !== s.ragioneSociale ? { ...s, ragioneSociale: canon } : s;
      });
      const lastUpdatedAt = allSales.reduce<Date | null>((latest, sale) => {
        if (!sale.fetchedAt) return latest;
        const current = new Date(sale.fetchedAt);
        return !latest || current.getTime() > latest.getTime() ? current : latest;
      }, null);
      const operatorAddetti = profile.role === "operatore" ? (profile.bisuiteAddetti ?? []) : null;
      const { filterSalesByAssignedAddetti } = await import("./bisuiteMappedSales");
      const scopedAllSales = filterSalesByAssignedAddetti(allSales, operatorAddetti);

      let garaCfg = undefined as Awaited<ReturnType<typeof storage.getGaraConfigById>> | undefined;
      if (inGaraOnly) {
        if (garaConfigId) {
          garaCfg = await storage.getGaraConfigById(garaConfigId);
          // Authorization: la config deve appartenere alla stessa organizzazione
          if (garaCfg && garaCfg.organizationId !== orgId) {
            return res.status(403).json({ error: "Configurazione gara non autorizzata" });
          }
        } else {
          garaCfg = await storage.getGaraConfig(orgId, month, year);
        }
      }

      const garaPdvList = ((garaCfg?.config as { pdvList?: Array<{
        codicePos?: string;
        nome?: string;
        ragioneSociale?: string;
      }> } | null | undefined)?.pdvList ?? []);
      const pdvDirectory = Object.fromEntries(
        garaPdvList
          .filter((p) => p.codicePos)
          .map((p) => [p.codicePos!, {
            nomeNegozio: p.nome || p.codicePos,
            ragioneSociale: p.ragioneSociale || "",
          }]),
      );

      const { selectInGaraSales } = await import("./bisuiteGaraFilter");
      const { sales: salesInGara, calendarsAvailable, totalSalesUnfiltered, salesExcludedOutOfGara } =
        selectInGaraSales(scopedAllSales, inGaraOnly, garaCfg, pdvView);

      // Task #478 — perimetro opzionale RS/PDV: liste separate da virgola.
      // Con perimetro attivo daily/totalSales/totalImporto (e tutto il resto)
      // riflettono solo le vendite del perimetro scelto.
      const parseCsv = (v: unknown): string[] =>
        typeof v === "string" ? v.split(",").map((s) => s.trim()).filter(Boolean) : [];
      const perimeterPos = parseCsv(req.query.codicePos);
      const perimeterRs = parseCsv(req.query.ragioneSociale);
      const { filterSalesByPerimeter } = await import("./bisuiteMappedSales");
      const sales = filterSalesByPerimeter(
        salesInGara,
        { codicePos: perimeterPos, ragioniSociali: perimeterRs },
        pdvView,
        pdvDirectory,
      );

      const sysMapping = await storage.getSystemConfig("bisuite_mapping");
      const mappingConfig = sysMapping?.config as { rules?: BiSuiteMappingRule[] } | null;
      const { getDefaultMappingRules, mergeWithDefaultRules } = await import("../shared/bisuiteMapping");
      const rawRules = mappingConfig?.rules || getDefaultMappingRules();
      const rules = mergeWithDefaultRules(rawRules);
      const savedAt = sysMapping?.updatedAt
        ? new Date(sysMapping.updatedAt).toISOString()
        : "none";
      const rulesUpdatedAt = `${savedAt}|${getDefaultRulesHash()}`;

      // Task #527 — org con brand Vodafone/Fastweb: passa il listino canvass
      // + regole KPI all'aggregazione per i conteggi per pista VF (luce, gas,
      // iva_mobile, iva_wireline, vas). Org WindTre/senza brand VF: invariato.
      const orgBrandsMapped = await storage.getOrganizationBrands(orgId);
      const hasCanvassBrand = orgBrandsMapped.some((b) => /vodafone|fastweb/i.test(b.name));
      let canvassIndex = null as import("../shared/canvassMapping").CanvassIndex | null;
      let canvassKpiRules = null as import("../shared/canvassKpiRules").CanvassKpiRule[] | null;
      if (hasCanvassBrand) {
        const { buildCanvassIndex } = await import("../shared/canvassMapping");
        const { sanitizeCanvassKpiRules } = await import("../shared/canvassKpiRules");
        const { reference } = await resolveCanvassReference();
        canvassIndex = buildCanvassIndex(reference.offers);
        const orgCfgMapped = await storage.getOrgConfig(orgId);
        canvassKpiRules = sanitizeCanvassKpiRules(
          (orgCfgMapped?.config as Record<string, unknown> | null)?.canvassKpiRules,
        );
      }

      const { aggregateMappedSales } = await import("./bisuiteMappedSales");
      const {
        pdvList,
        totalArticoli,
        totalMapped,
        totalUnmapped,
        totaliPerPista,
        totaliAddonsPerPista,
        totalImporto,
        latestSaleDate,
        daily,
        salesSenzaDestinazione,
        totaliPistaCanvass,
      } = aggregateMappedSales(sales, rules, { pdvView, pdvDirectory, canvassIndex, canvassKpiRules });
      const includeDetails = req.query.includeDetails === "true" || req.query.includeDetails === "1";
      const saleDetails = includeDetails
        ? sales.flatMap((sale) => {
            const effectivePdv = resolveSalePdvForView(sale, pdvView);
            // Riusa l'aggregatore canonico su una singola vendita: nel
            // drill-down entrano solo vendite con almeno un contributo reale
            // alle colonne della tabella, con la stessa mappatura dei totali.
            const single = aggregateMappedSales([sale], rules, { pdvView, pdvDirectory, canvassIndex, canvassKpiRules });
            const pdv = single.pdvList.find((entry) => entry.codicePos === effectivePdv.codicePos);
            if (!pdv) return [];
            const contributions: Array<{ key: string; label: string; value: number; unit?: "pezzi" | "euro" }> = [];
            for (const item of pdv.items) {
              contributions.push({
                key: `item:${item.pista}:${item.targetCategory}`,
                label: `${item.pista} · ${item.targetLabel}`,
                value: item.pezzi,
                unit: "pezzi",
              });
            }
            for (const addon of pdv.addons ?? []) {
              contributions.push({
                key: `addon:${addon.pista}:${addon.targetCategory}`,
                label: `${addon.pista} · ${addon.targetLabel}`,
                value: addon.occorrenze,
                unit: "pezzi",
              });
            }
            for (const [pista, value] of Object.entries(pdv.countByPistaCanvass ?? {})) {
              if (!value) continue;
              contributions.push({ key: `vf:${pista}`, label: pista, value, unit: "pezzi" });
            }
            if (pdv.pezziIva) contributions.push({ key: "extra:iva", label: "IVA", value: pdv.pezziIva, unit: "pezzi" });
            if (pdv.cbCambiPiano) contributions.push({ key: "extra:cb", label: "CB", value: pdv.cbCambiPiano, unit: "pezzi" });
            if (pdv.telefoni) contributions.push({ key: "extra:telefoni", label: "Telefoni", value: pdv.telefoni, unit: "pezzi" });
            if (pdv.accessori?.importo) contributions.push({ key: "extra:accessori", label: "Accessori netto IVA", value: pdv.accessori.importo / 1.22, unit: "euro" });
            if (pdv.servizi?.importo) contributions.push({ key: "extra:servizi", label: "Servizi netto IVA", value: pdv.servizi.importo / 1.22, unit: "euro" });
            if (contributions.length === 0) return [];
            return [{
              id: sale.id,
              bisuiteId: sale.bisuiteId,
              dataVendita: sale.dataVendita,
              codicePos: effectivePdv.codicePos,
              nomeNegozio: effectivePdv.nomeNegozio,
              nomeAddetto: sale.nomeAddetto,
              nomeCliente: sale.nomeCliente,
              totale: sale.totale,
              stato: sale.stato,
              categorieArticoli: sale.categorieArticoli,
              contributions,
            }];
          })
        : undefined;

      res.json({
        month,
        year,
        totalSales: sales.length,
        totalArticoli,
        totalMapped,
        totalUnmapped,
        totalImporto,
        pdvList,
        totaliPerPista,
        totaliAddonsPerPista,
        // Task #527 — conteggi pezzi per pista canvass VF (solo org con
        // brand Vodafone/Fastweb; assente per org WindTre/senza brand VF).
        hasCanvassBrand,
        totaliPistaCanvass: totaliPistaCanvass ?? null,
        latestSaleDate: latestSaleDate ? latestSaleDate.toISOString() : null,
        lastUpdatedAt: lastUpdatedAt ? lastUpdatedAt.toISOString() : null,
        inGaraOnly,
        totalSalesUnfiltered,
        salesExcludedOutOfGara,
        calendarsAvailable,
        rulesUpdatedAt,
        daily,
        pdvView,
        salesSenzaDestinazione,
        ...(saleDetails ? { saleDetails } : {}),
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

  // === Canvass Vodafone/Fastweb: catalogo di riferimento + categorizzazione ===
  // Modulo separato dalle regole WindTre (`bisuite_mapping`): il catalogo
  // canvass (listino offerte + step di vendita) è un lookup CODICE→pista/
  // categoria/tipologia/canone. Il default deployato è il catalogo baked
  // `shared/canvassCatalog.ts` (generato dagli Excel forniti); un super_admin
  // può "importarlo" in system_config (`canvass_reference`) per aggiornarlo
  // senza redeploy. La categorizzazione resta pura in `shared/canvassMapping.ts`.
  const CANVASS_CONFIG_KEY = "canvass_reference";

  async function resolveCanvassReference() {
    const { CANVASS_CATALOG } = await import("../shared/canvassCatalog");
    const sys = await storage.getSystemConfig(CANVASS_CONFIG_KEY);
    const saved = sys?.config as
      | { periodo?: string; offers?: unknown[]; steps?: unknown[] }
      | null
      | undefined;
    if (saved && Array.isArray(saved.offers) && saved.offers.length > 0) {
      return { reference: saved as typeof CANVASS_CATALOG, source: "saved" as const };
    }
    return { reference: CANVASS_CATALOG, source: "default" as const };
  }

  app.get("/api/admin/canvass-catalog", isAuthenticated, requireModule("mappatura_bisuite"), async (req: any, res) => {
    try {
      const profile = await storage.getProfile(req.session.userId);
      if (!profile || !["super_admin", "admin"].includes(profile.role)) {
        return res.status(403).json({ error: "Accesso non autorizzato" });
      }
      const { groupStepsByPista } = await import("../shared/canvassMapping");
      const { reference, source } = await resolveCanvassReference();
      res.json({
        periodo: reference.periodo,
        source,
        offersCount: reference.offers.length,
        stepsCount: reference.steps.length,
        offers: reference.offers,
        stepsByPista: groupStepsByPista(reference.steps),
      });
    } catch (error: unknown) {
      console.error("Canvass catalog error:", error);
      const msg = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: "Errore nel caricamento del catalogo canvass", details: msg });
    }
  });

  // Schema di validazione del listino caricato da UI. L'Excel viene letto e
  // convertito in `CanvassReference` lato browser (buildCanvassReferenceFromRows
  // in shared/canvassMapping.ts); qui si valida la forma prima del salvataggio.
  const canvassOfferSchema = z.object({
    codice: z.string(),
    offerId: z.string().nullable(),
    nomeEtichetta: z.string(),
    pista: z.string(),
    categoria: z.string(),
    tipologia: z.string(),
    canone: z.number(),
    brand: z.enum(["vodafone", "fastweb"]),
  });
  const canvassStepSchema = z.object({
    externalId: z.number().nullable(),
    pistaAssociata: z.string(),
    pistaForm: z.string(),
    domanda: z.string(),
    ordine: z.number().nullable(),
    attivo: z.boolean(),
    brand: z.string(),
  });
  const canvassReferenceSchema = z.object({
    periodo: z.string().min(1, "Periodo mancante"),
    offers: z.array(canvassOfferSchema).min(1, "Il listino non contiene offerte"),
    steps: z.array(canvassStepSchema),
  });

  app.post("/api/admin/canvass-catalog/import", isAuthenticated, requireModule("mappatura_bisuite"), async (req: any, res) => {
    try {
      const profile = await storage.getProfile(req.session.userId);
      if (!profile || profile.role !== "super_admin") {
        return res.status(403).json({ error: "Accesso non autorizzato" });
      }

      // Due modalità:
      // 1) body con `reference`: listino caricato da UI (Excel elaborato nel
      //    browser). Validato con zod, poi salvato in system_config.
      // 2) body vuoto: import idempotente del catalogo baked (default
      //    deployato). Re-import = upsert, non duplica.
      let reference;
      if (req.body && req.body.reference) {
        const parsed = canvassReferenceSchema.safeParse(req.body.reference);
        if (!parsed.success) {
          return res.status(400).json({
            error: "Listino non valido",
            details: parsed.error.issues.map((i) => i.message).join("; "),
          });
        }
        reference = parsed.data;
      } else {
        const { CANVASS_CATALOG } = await import("../shared/canvassCatalog");
        reference = CANVASS_CATALOG;
      }

      await storage.upsertSystemConfig(CANVASS_CONFIG_KEY, reference, profile.id);
      res.json({
        success: true,
        periodo: reference.periodo,
        offersCount: reference.offers.length,
        stepsCount: reference.steps.length,
      });
    } catch (error: unknown) {
      console.error("Canvass catalog import error:", error);
      const msg = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: "Errore nell'import del catalogo canvass", details: msg });
    }
  });

  // Ripristina il catalogo baked di sistema rimuovendo l'override salvato in
  // system_config. Serve al super_admin per tornare al default dopo un upload
  // sbagliato: resolveCanvassReference tornerà a leggere `shared/canvassCatalog`.
  app.post("/api/admin/canvass-catalog/reset", isAuthenticated, requireModule("mappatura_bisuite"), async (req: any, res) => {
    try {
      const profile = await storage.getProfile(req.session.userId);
      if (!profile || profile.role !== "super_admin") {
        return res.status(403).json({ error: "Accesso non autorizzato" });
      }
      await storage.deleteSystemConfig(CANVASS_CONFIG_KEY);
      const { reference, source } = await resolveCanvassReference();
      res.json({
        success: true,
        source,
        periodo: reference.periodo,
        offersCount: reference.offers.length,
        stepsCount: reference.steps.length,
      });
    } catch (error: unknown) {
      console.error("Canvass catalog reset error:", error);
      const msg = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: "Errore nel ripristino del catalogo canvass", details: msg });
    }
  });

  app.get("/api/admin/canvass-mapped-sales", isAuthenticated, requireModule("mappatura_bisuite"), async (req: any, res) => {
    try {
      const profile = await storage.getProfile(req.session.userId);
      if (!profile || !["super_admin", "admin"].includes(profile.role)) {
        return res.status(403).json({ error: "Accesso non autorizzato" });
      }

      const orgId = req.query.organization_id || profile.organizationId;
      if (!orgId) return res.status(400).json({ error: "Organizzazione non specificata" });
      if (profile.role !== "super_admin" && orgId !== profile.organizationId) {
        return res.status(403).json({ error: "Accesso non autorizzato" });
      }

      // Brand gating: la categorizzazione canvass si applica solo alle org che
      // hanno il brand Vodafone e/o Fastweb associato.
      const orgBrands = await storage.getOrganizationBrands(orgId);
      const hasCanvassBrand = orgBrands.some((b) => /vodafone|fastweb/i.test(b.name));

      const month = parseInt(req.query.month as string) || new Date().getMonth() + 1;
      const year = parseInt(req.query.year as string) || new Date().getFullYear();

      const { buildCanvassIndex, aggregateCanvassSales } = await import("../shared/canvassMapping");
      const { reference, source } = await resolveCanvassReference();
      const index = buildCanvassIndex(reference.offers);

      if (!hasCanvassBrand) {
        return res.json({
          month, year, hasCanvassBrand: false, periodo: reference.periodo, source,
          byPista: {}, unmapped: [], totalArticoli: 0, totalMapped: 0, totalUnmapped: 0,
          matchCounts: { codice: 0, offerId: 0, catTip: 0 },
        });
      }

      const sales = await storage.getBisuiteSalesByItalianMonth(orgId, year, month);
      const agg = aggregateCanvassSales(sales, index);
      res.json({
        month, year, hasCanvassBrand: true, periodo: reference.periodo, source,
        totalSales: sales.length,
        byPista: agg.byPista,
        items: agg.items,
        unmapped: agg.unmapped,
        totalArticoli: agg.totalArticoli,
        totalMapped: agg.totalMapped,
        totalUnmapped: agg.totalUnmapped,
        matchCounts: agg.matchCounts,
      });
    } catch (error: unknown) {
      console.error("Canvass mapped sales error:", error);
      const msg = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: "Errore nell'aggregazione vendite canvass", details: msg });
    }
  });

  // Task #317 — reference canvass VF per la pagina Vendite BiSuite.
  // Restituisce le offerte del listino canvass solo se l'org ha il brand
  // Vodafone/Fastweb: la pagina le usa per classificare gli articoli come
  // "canvass" (con pista dal listino) invece che come "prodotti". Gate sul
  // modulo vendite_bisuite (accessibile anche agli operatori, a differenza
  // delle route /api/admin/canvass-*).
  app.get("/api/bisuite-canvass-reference", isAuthenticated, requireModule("vendite_bisuite"), async (req: any, res) => {
    try {
      const profile = await storage.getProfile(req.session.userId);
      if (!profile) return res.status(401).json({ error: "Unauthorized" });
      const orgId = (req.query.organization_id as string) || profile.organizationId;
      if (!orgId) return res.status(400).json({ error: "Organizzazione non specificata" });
      if (profile.role !== "super_admin" && orgId !== profile.organizationId) {
        return res.status(403).json({ error: "Accesso non autorizzato" });
      }

      const orgBrands = await storage.getOrganizationBrands(orgId);
      const hasCanvassBrand = orgBrands.some((b) => /vodafone|fastweb/i.test(b.name));
      if (!hasCanvassBrand) {
        return res.json({ hasCanvassBrand: false, periodo: null, source: null, offers: [] });
      }

      const { reference, source } = await resolveCanvassReference();
      // Regole KPI per-org (associazione categorie/tipologie/descrizioni/
      // domande → piste per il conteggio KPI di Vendite BiSuite).
      const { sanitizeCanvassKpiRules } = await import("../shared/canvassKpiRules");
      const orgCfg = await storage.getOrgConfig(orgId);
      const kpiRules = sanitizeCanvassKpiRules(
        (orgCfg?.config as Record<string, unknown> | null)?.canvassKpiRules,
      );
      res.json({
        hasCanvassBrand: true,
        periodo: reference.periodo,
        source,
        offers: reference.offers,
        kpiRules,
      });
    } catch (error: unknown) {
      console.error("Bisuite canvass reference error:", error);
      const msg = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: "Errore nel caricamento del listino canvass", details: msg });
    }
  });

  // === Regole KPI canvass VF (per-org): associano categorie/tipologie/
  // descrizioni/domande BiSuite alle piste del conteggio KPI di Vendite
  // BiSuite (o escludono dal conteggio). Config in
  // organization_config.config.canvassKpiRules. Admin/super_admin.
  const canvassKpiRuleSchema = z.object({
    id: z.string().min(1),
    target: z.enum(["mobile", "fisso", "cb", "iva", "assicurazioni", "protecta", "energia", "escludi"]),
    conditions: z.object({
      codice: z.string().optional(),
      categoria: z.string().optional(),
      tipologia: z.string().optional(),
      descrizione: z.string().optional(),
      domanda: z.string().optional(),
      risposta: z.string().optional(),
    }),
    enabled: z.boolean(),
  }).refine(
    (r) => [r.conditions.codice, r.conditions.categoria, r.conditions.tipologia, r.conditions.descrizione, r.conditions.domanda]
      .some((v) => (v || "").trim() !== ""),
    { message: "Ogni regola deve avere almeno una condizione (codice, categoria, tipologia, descrizione o domanda)" },
  );

  async function resolveKpiRulesOrg(req: any, res: any): Promise<string | null> {
    const profile = await storage.getProfile(req.session.userId);
    if (!profile || !["super_admin", "admin"].includes(profile.role)) {
      res.status(403).json({ error: "Accesso non autorizzato" });
      return null;
    }
    const orgId = (req.query.organization_id as string) || (req.body?.organizationId as string) || profile.organizationId;
    if (!orgId) {
      res.status(400).json({ error: "Organizzazione non specificata" });
      return null;
    }
    if (profile.role !== "super_admin" && orgId !== profile.organizationId) {
      res.status(403).json({ error: "Accesso non autorizzato" });
      return null;
    }
    return orgId;
  }

  app.get("/api/admin/canvass-kpi-rules", isAuthenticated, requireModule("mappatura_bisuite"), async (req: any, res) => {
    try {
      const orgId = await resolveKpiRulesOrg(req, res);
      if (!orgId) return;
      const { sanitizeCanvassKpiRules } = await import("../shared/canvassKpiRules");
      const cfg = await storage.getOrgConfig(orgId);
      const rules = sanitizeCanvassKpiRules(
        (cfg?.config as Record<string, unknown> | null)?.canvassKpiRules,
      );
      res.json({ organizationId: orgId, rules });
    } catch (error: unknown) {
      console.error("Canvass KPI rules get error:", error);
      res.status(500).json({ error: "Errore nel caricamento delle regole KPI canvass" });
    }
  });

  app.post("/api/admin/canvass-kpi-rules", isAuthenticated, requireModule("mappatura_bisuite"), async (req: any, res) => {
    try {
      const orgId = await resolveKpiRulesOrg(req, res);
      if (!orgId) return;
      const parsed = z.array(canvassKpiRuleSchema).max(200).safeParse(req.body?.rules);
      if (!parsed.success) {
        return res.status(400).json({
          error: "Regole non valide",
          details: parsed.error.issues.map((i) => i.message).join("; "),
        });
      }
      const cfg = await storage.getOrgConfig(orgId);
      const config = { ...((cfg?.config as Record<string, unknown> | null) || {}), canvassKpiRules: parsed.data };
      await storage.upsertOrgConfig(orgId, config, cfg?.configVersion || "2.0");
      res.json({ success: true, organizationId: orgId, count: parsed.data.length });
    } catch (error: unknown) {
      console.error("Canvass KPI rules save error:", error);
      res.status(500).json({ error: "Errore nel salvataggio delle regole KPI canvass" });
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
    // Codice dealer "8 miliardi" (Task #544): chiave contabile del plafond
    // ricariche. Più POS possono condividere lo stesso dealer; la stessa RS
    // può contenere dealer diversi.
    codiceDealer?: string;
    // Brand associati al PDV (Task #519, report Telegram separati per brand).
    // Id dal catalogo brands, validati contro i brand dell'organizzazione.
    brandIds?: string[];
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
    codiceDealer: z.string().trim().max(40).optional().default(""),
    brandIds: z.array(z.string().trim().min(1)).max(20).optional(),
  });
  // Valida i brandIds contro i brand associati all'organizzazione: id
  // estranei vengono rifiutati (400) per non salvare associazioni orfane.
  async function validateBrandIds(orgId: string, brandIds: string[] | undefined): Promise<string | null> {
    if (!brandIds || brandIds.length === 0) return null;
    const orgBrands = await storage.getOrganizationBrands(orgId);
    const valid = new Set(orgBrands.map((b) => b.id));
    const bad = brandIds.filter((id) => !valid.has(id));
    return bad.length > 0 ? `Brand non associati all'organizzazione: ${bad.join(", ")}` : null;
  }
  const dedupBrandIds = (ids: string[] | undefined): string[] | undefined =>
    ids === undefined ? undefined : Array.from(new Set(ids));

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
  async function writePv(orgId: string, mutator: (pv: StructPdv[]) => StructPdv[], changedBy?: string | null): Promise<void> {
    const cfg = await storage.getOrgConfig(orgId);
    const config = (cfg?.config as Record<string, unknown> | null) || {};
    const pv = ((config.puntiVendita as StructPdv[] | undefined) || []).map(p => ({ ...p }));
    const next = mutator(pv);
    const newConfig = { ...config, puntiVendita: next };
    await storage.upsertOrgConfig(orgId, newConfig, cfg?.configVersion || "2.0", changedBy);
  }
  async function writeConfigKeys(orgId: string, mutator: (cfg: Record<string, unknown>) => Record<string, unknown>, changedBy?: string | null): Promise<void> {
    const cfg = await storage.getOrgConfig(orgId);
    const config = (cfg?.config as Record<string, unknown> | null) || {};
    const next = mutator({ ...config });
    await storage.upsertOrgConfig(orgId, next, cfg?.configVersion || "2.0", changedBy);
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
    const brandErr = await validateBrandIds(orgId, parsed.data.brandIds);
    if (brandErr) return res.status(400).json({ error: brandErr });
    const newId = `pdv-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    await writePv(orgId, (pv) => [...pv, { id: newId, ...parsed.data, brandIds: dedupBrandIds(parsed.data.brandIds) ?? [] }], profile.id);
    res.status(201).json({ success: true, id: newId });
  });

  // POST /api/admin/struttura/pdv/bulk → crea N PDV (skip duplicati).
  // Task #544: per i POS GIÀ esistenti aggiorna il codiceDealer quando il
  // payload ne fornisce uno diverso (import Excel della Struttura): il resto
  // dei campi esistenti non viene toccato.
  app.post("/api/admin/struttura/pdv/bulk", isAuthenticated, async (req: any, res) => {
    const profile = await requireAdminRole(req, res);
    if (!profile) return;
    const orgId = profile.organizationId!;
    const parsed = z.object({ pdvs: z.array(structPdvSchema).min(1) }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0].message });
    const allBrandIds = parsed.data.pdvs.flatMap((p) => p.brandIds ?? []);
    const bulkBrandErr = await validateBrandIds(orgId, allBrandIds);
    if (bulkBrandErr) return res.status(400).json({ error: bulkBrandErr });
    const cur = await readPv(orgId);
    const existing = new Set(cur.map(p => normLow(p.codicePos || p.nome)));
    const added: string[] = [];
    const skipped: string[] = [];
    const updated: string[] = [];
    const toAdd: StructPdv[] = [];
    const dealerByPos = new Map<string, string>();
    for (const p of parsed.data.pdvs) {
      const k = normLow(p.codicePos);
      if (existing.has(k)) {
        const curEntry = cur.find((c) => normLow(c.codicePos || c.nome) === k);
        const newDealer = norm(p.codiceDealer);
        if (newDealer && norm(curEntry?.codiceDealer) !== newDealer) {
          dealerByPos.set(k, newDealer);
          updated.push(p.codicePos);
        } else {
          skipped.push(p.codicePos);
        }
        continue;
      }
      existing.add(k);
      toAdd.push({ id: `pdv-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, ...p, brandIds: dedupBrandIds(p.brandIds) ?? [] });
      added.push(p.codicePos);
    }
    if (toAdd.length > 0 || dealerByPos.size > 0) {
      await writePv(orgId, (pv) => [
        ...pv.map((p) => {
          const d = dealerByPos.get(normLow(p.codicePos || p.nome));
          return d !== undefined ? { ...p, codiceDealer: d } : p;
        }),
        ...toAdd,
      ], profile.id);
    }
    res.json({ success: true, added, skipped, updated });
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
      codiceDealer: z.string().trim().max(40).optional(),
      brandIds: z.array(z.string().trim().min(1)).max(20).optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0].message });
    const putBrandErr = await validateBrandIds(orgId, parsed.data.brandIds);
    if (putBrandErr) return res.status(400).json({ error: putBrandErr });
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
      codiceDealer: parsed.data.codiceDealer ?? p.codiceDealer,
      brandIds: dedupBrandIds(parsed.data.brandIds) ?? p.brandIds ?? [],
    } : p), profile.id);
    // Propagazione su CdG: rename codicePos e/o ragioneSociale
    if (normLow(newCodice) !== normLow(oldCodicePos) || normLow(newRs) !== normLow(oldRagioneSociale)) {
      try {
        // Task #345: aggiorna anche il collegamento per id al registro RS.
        // Le righe figlie si selezionano per id (cache nomi possibilmente
        // stantia); il nome resta solo come fallback per righe scollegate.
        const newRsId = await cdgStorage.ensureRsId(orgId, newRs);
        const oldRsId = await cdgStorage.getRsIdByName(orgId, oldRagioneSociale);
        const oldRsPred = oldRsId
          ? sql`(ragione_sociale_id = ${oldRsId} OR (ragione_sociale_id IS NULL AND ragione_sociale = ${oldRagioneSociale}))`
          : sql`ragione_sociale = ${oldRagioneSociale}`;
        await db.execute(sql`
          UPDATE cdg_spese
             SET pdv_codice = ${newCodice}, ragione_sociale = ${newRs}, ragione_sociale_id = ${newRsId}
           WHERE organization_id = ${orgId}
             AND ${oldRsPred}
             AND pdv_codice = ${oldCodicePos}
        `);
        // cdg_pdv_manuali: stesso (org, rs, codice) → aggiorna a nuovi valori
        await db.execute(sql`
          UPDATE cdg_pdv_manuali
             SET codice = ${newCodice}, ragione_sociale = ${newRs}, ragione_sociale_id = ${newRsId}
           WHERE organization_id = ${orgId}
             AND ${oldRsPred}
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
    await writeConfigKeys(orgId, (c) => ({ ...c, ragioniSociali: [...rsList, nome] }), profile.id);
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
    ), profile.id);
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
    }, profile.id);
    if (normLow(newName) !== normLow(oldName)) {
      try {
        // Task #345: la rinomina passa dal registro RS (cdg_ragioni_sociali):
        // aggiorna l'anchor e sincronizza le tabelle CdG per ID in una
        // transazione — nessuna propagazione per nome che possa mancare righe.
        await cdgStorage.renameRsByName(orgId, oldName, newName);
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
    }, profile.id);
    try {
      // Task #345: cascade per ID via registro (fallback per nome se la RS
      // non è mai stata referenziata e non ha anchor).
      const rsId = await cdgStorage.getRsIdByName(orgId, nome);
      if (rsId) {
        await cdgStorage.deleteRagioneSociale(rsId, orgId);
      } else {
        await db.execute(sql`DELETE FROM cdg_spese WHERE organization_id = ${orgId} AND ragione_sociale = ${nome}`);
        await db.execute(sql`DELETE FROM cdg_pdv_manuali WHERE organization_id = ${orgId} AND ragione_sociale = ${nome}`);
        await db.execute(sql`UPDATE cdg_categorie SET ragioni_sociali = array_remove(ragioni_sociali, ${nome}) WHERE organization_id = ${orgId} AND ${nome} = ANY(ragioni_sociali)`);
        await db.execute(sql`DELETE FROM cdg_categorie WHERE organization_id = ${orgId} AND COALESCE(array_length(ragioni_sociali, 1), 0) = 0 AND COALESCE(array_length(ragione_sociale_ids, 1), 0) = 0`);
        await db.execute(sql`UPDATE cdg_fornitori SET ragioni_sociali = array_remove(ragioni_sociali, ${nome}) WHERE organization_id = ${orgId} AND ${nome} = ANY(ragioni_sociali)`);
        await db.execute(sql`DELETE FROM cdg_fornitori WHERE organization_id = ${orgId} AND COALESCE(array_length(ragioni_sociali, 1), 0) = 0 AND COALESCE(array_length(ragione_sociale_ids, 1), 0) = 0`);
      }
    } catch (e) { console.error("[struttura] cascade delete RS failed", e); }
    res.json({ success: true });
  });

  // === Storico struttura RS/PDV (Task #339) ===
  // Ogni upsert di organization_config che cambia puntiVendita/ragioniSociali
  // archivia automaticamente la versione precedente (vedi upsertOrgConfig).
  // Questi endpoint permettono a admin/super_admin di ispezionare lo storico
  // e ripristinare una versione in un click.

  // GET /api/admin/struttura/history → lista versioni (metadati + conteggi)
  app.get("/api/admin/struttura/history", isAuthenticated, async (req: any, res) => {
    const profile = await requireAdminRole(req, res);
    if (!profile) return;
    const orgId = profile.organizationId!;
    try {
      const rows = await storage.listOrgConfigHistory(orgId);
      // Risolvi i nomi degli utenti (changedBy) in una passata.
      const userIds = Array.from(new Set(rows.map(r => r.changedBy).filter((v): v is string => !!v)));
      const users = new Map<string, { fullName: string | null; email: string | null }>();
      for (const uid of userIds) {
        const p = await storage.getProfile(uid);
        if (p) users.set(uid, { fullName: p.fullName, email: p.email });
      }
      res.json(rows.map(r => ({
        id: r.id,
        createdAt: r.createdAt,
        changedBy: r.changedBy,
        changedByName: r.changedBy ? (users.get(r.changedBy)?.fullName ?? users.get(r.changedBy)?.email ?? null) : null,
        puntiVenditaCount: Array.isArray(r.puntiVendita) ? (r.puntiVendita as unknown[]).length : 0,
        ragioniSocialiCount: Array.isArray(r.ragioniSociali) ? (r.ragioniSociali as unknown[]).length : 0,
      })));
    } catch (e) {
      console.error("[struttura-history] list failed:", e);
      res.status(500).json({ error: "Errore nel caricamento dello storico struttura" });
    }
  });

  // GET /api/admin/struttura/history/:id → snapshot completo di una versione
  app.get("/api/admin/struttura/history/:id", isAuthenticated, async (req: any, res) => {
    const profile = await requireAdminRole(req, res);
    if (!profile) return;
    const orgId = profile.organizationId!;
    try {
      const row = await storage.getOrgConfigHistoryEntry(req.params.id, orgId);
      if (!row) return res.status(404).json({ error: "Versione non trovata" });
      res.json(row);
    } catch (e) {
      console.error("[struttura-history] get failed:", e);
      res.status(500).json({ error: "Errore nel caricamento della versione" });
    }
  });

  // POST /api/admin/struttura/history/:id/restore → ripristina la versione
  // (la struttura corrente viene a sua volta archiviata prima del ripristino,
  // quindi anche il restore è annullabile).
  app.post("/api/admin/struttura/history/:id/restore", isAuthenticated, async (req: any, res) => {
    const profile = await requireAdminRole(req, res);
    if (!profile) return;
    const orgId = profile.organizationId!;
    try {
      const row = await storage.getOrgConfigHistoryEntry(req.params.id, orgId);
      if (!row) return res.status(404).json({ error: "Versione non trovata" });
      const cfg = await storage.getOrgConfig(orgId);
      const config = { ...((cfg?.config as Record<string, unknown> | null) || {}) };
      if (row.puntiVendita === null || row.puntiVendita === undefined) delete config.puntiVendita;
      else config.puntiVendita = row.puntiVendita;
      if (row.ragioniSociali === null || row.ragioniSociali === undefined) delete config.ragioniSociali;
      else config.ragioniSociali = row.ragioniSociali;
      await storage.upsertOrgConfig(orgId, config, cfg?.configVersion || "2.0", profile.id);
      console.log(`[struttura-history] restored version ${row.id} (org=${orgId}, user=${profile.id})`);
      res.json({
        success: true,
        restoredId: row.id,
        puntiVenditaCount: Array.isArray(row.puntiVendita) ? (row.puntiVendita as unknown[]).length : 0,
        ragioniSocialiCount: Array.isArray(row.ragioniSociali) ? (row.ragioniSociali as unknown[]).length : 0,
      });
    } catch (e) {
      console.error("[struttura-history] restore failed:", e);
      res.status(500).json({ error: "Errore nel ripristino della versione" });
    }
  });

  // === Controllo di Gestione ===
  registerCdgRoutes(app, isAuthenticated, requireModule);

  return httpServer;
}
