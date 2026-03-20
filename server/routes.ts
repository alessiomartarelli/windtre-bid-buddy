import type { Express, RequestHandler } from "express";
import { type Server } from "http";
import { storage } from "./storage";
import session from "express-session";
import connectPg from "connect-pg-simple";
import bcrypt from "bcryptjs";
import { z } from "zod";
import type { BiSuiteMappingRule } from "../shared/bisuiteMapping";

function italianDateRange(from: Date, to: Date): { from: Date; to: Date } {
  return {
    from: new Date(from.getTime() - 2 * 60 * 60 * 1000),
    to: new Date(to.getTime() + 2 * 60 * 60 * 1000),
  };
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

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  setupSession(app);

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
      if (profile.organizationId) {
        organization = await storage.getOrganization(profile.organizationId);
      }

      res.json({ ...profile, passwordHash: undefined, organization });
    } catch (error) {
      console.error("Error fetching user:", error);
      res.status(500).json({ message: "Failed to fetch user" });
    }
  });

  // === PREVENTIVI ===
  app.get("/api/preventivi", isAuthenticated, async (req: any, res) => {
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

  app.post("/api/preventivi", isAuthenticated, async (req: any, res) => {
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

  app.put("/api/preventivi/:id", isAuthenticated, async (req: any, res) => {
    try {
      const { name, data } = req.body;
      const preventivo = await storage.updatePreventivo(req.params.id, name, data);
      res.json(preventivo);
    } catch (error) {
      res.status(500).json({ message: "Error updating preventivo" });
    }
  });

  app.delete("/api/preventivi/:id", isAuthenticated, async (req: any, res) => {
    try {
      await storage.deletePreventivo(req.params.id);
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ message: "Error deleting preventivo" });
    }
  });

  app.get("/api/preventivi/:id", isAuthenticated, async (req: any, res) => {
    try {
      const preventivo = await storage.getPreventivo(req.params.id);
      if (!preventivo) {
        return res.status(404).json({ message: "Not found" });
      }
      res.json(preventivo);
    } catch (error) {
      res.status(500).json({ message: "Error loading preventivo" });
    }
  });

  // === ORGANIZATION CONFIG ===
  app.get("/api/organization-config", isAuthenticated, async (req: any, res) => {
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

  app.put("/api/organization-config", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session.userId;
      const profile = await storage.getProfile(userId);
      if (!profile?.organizationId) {
        return res.status(400).json({ message: "User has no organization" });
      }
      const { config, configVersion } = req.body;
      const result = await storage.upsertOrgConfig(profile.organizationId, config, configVersion || "2.0");
      res.json(result);
    } catch (error) {
      res.status(500).json({ message: "Error saving config" });
    }
  });

  // === SYSTEM CONFIG (super admin calculation defaults) ===
  app.get("/api/system-config", isAuthenticated, async (req: any, res) => {
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

  app.get("/api/system-config/:key", isAuthenticated, async (req: any, res) => {
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

  // === PDV CONFIGURATIONS ===
  app.get("/api/pdv-configurations", isAuthenticated, async (req: any, res) => {
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

  app.get("/api/pdv-configurations/:id", isAuthenticated, async (req: any, res) => {
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

  app.post("/api/pdv-configurations", isAuthenticated, async (req: any, res) => {
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

  app.put("/api/pdv-configurations/:id", isAuthenticated, async (req: any, res) => {
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

  app.delete("/api/pdv-configurations/:id", isAuthenticated, async (req: any, res) => {
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

  app.get("/api/gara-config", isAuthenticated, async (req: any, res) => {
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

  app.get("/api/gara-config/list", isAuthenticated, async (req: any, res) => {
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

  app.put("/api/gara-config", isAuthenticated, async (req: any, res) => {
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

  app.delete("/api/gara-config/:id", isAuthenticated, async (req: any, res) => {
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

  app.get("/api/gara-config/history", isAuthenticated, async (req: any, res) => {
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

  app.post("/api/gara-config/import-from-simulator", isAuthenticated, async (req: any, res) => {
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

  app.get("/api/gara-config/pdv-from-sales", isAuthenticated, async (req: any, res) => {
    try {
      const profile = await requireAdminRole(req, res);
      if (!profile) return;
      const month = parseInt(req.query.month as string);
      const year = parseInt(req.query.year as string);
      if (isNaN(month) || isNaN(year) || month < 1 || month > 12) {
        return res.status(400).json({ message: "Parametri month/year non validi" });
      }
      const { from, to } = italianDateRange(new Date(year, month - 1, 1), new Date(year, month, 0, 23, 59, 59));
      const sales = await storage.getBisuiteSales(profile.organizationId!, from, to);
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

  // === ADMIN: Import RS/PDV from BiSuite sales ===
  app.get("/api/admin/bisuite-rs-pdv", isAuthenticated, async (req: any, res) => {
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
        if (sale.ragioneSociale) rsSet.add(sale.ragioneSociale.trim());
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
      if (profile.organizationId) {
        organization = await storage.getOrganization(profile.organizationId);
      }
      res.json({ ...profile, passwordHash: undefined, organization });
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

      const existing = await storage.getProfileByEmail(resolvedEmail);
      if (existing) {
        return res.status(400).json({ error: "Esiste già un utente con questa email" });
      }

      let resolvedOrgId = organizationId || organization_id || adminProfile.organizationId;

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
  app.get("/api/admin/bisuite-credentials", isAuthenticated, async (req: any, res) => {
    try {
      const profile = await storage.getProfile(req.session.userId);
      if (!profile || profile.role !== "super_admin") {
        return res.status(403).json({ error: "Solo il super admin può accedere alle credenziali BiSuite" });
      }

      const orgId = req.query.org_id as string;
      if (!orgId) return res.status(400).json({ error: "org_id è obbligatorio" });

      const orgConfig = await storage.getOrgConfig(orgId);
      const cfg = orgConfig?.config as Record<string, unknown> | undefined;
      const creds = cfg?.bisuiteCredentials as Record<string, string> | undefined;

      if (!creds) return res.json(null);

      res.json({
        api_url: creds.api_url || "",
        client_id: creds.client_id || "",
        client_secret: creds.client_secret || "",
      });
    } catch (error) {
      console.error("Error loading BiSuite credentials:", error);
      res.status(500).json({ error: "Errore nel caricamento delle credenziali" });
    }
  });

  // ── POST credentials (create) ──────────────────────────────────
  app.post("/api/admin/bisuite-credentials", isAuthenticated, async (req: any, res) => {
    try {
      const profile = await storage.getProfile(req.session.userId);
      if (!profile || profile.role !== "super_admin") {
        return res.status(403).json({ error: "Solo il super admin può gestire le credenziali BiSuite" });
      }

      const { organization_id, api_url, client_id, client_secret } = req.body;
      if (!organization_id || !client_id || !client_secret) {
        return res.status(400).json({ error: "organization_id, client_id e client_secret sono obbligatori" });
      }
      if (api_url && !validateBisuiteUrl(api_url)) {
        return res.status(400).json({ error: "URL API non consentito. Utilizzare un host BiSuite valido." });
      }

      const orgConfig = await storage.getOrgConfig(organization_id);
      const existingConfig = (orgConfig?.config as Record<string, unknown>) || {};

      const updatedConfig = {
        ...existingConfig,
        bisuiteCredentials: { api_url: api_url || "", client_id, client_secret },
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
  app.put("/api/admin/bisuite-credentials", isAuthenticated, async (req: any, res) => {
    try {
      const profile = await storage.getProfile(req.session.userId);
      if (!profile || profile.role !== "super_admin") {
        return res.status(403).json({ error: "Solo il super admin può gestire le credenziali BiSuite" });
      }

      const { organization_id, api_url, client_id, client_secret } = req.body;
      if (!organization_id || !client_id || !client_secret) {
        return res.status(400).json({ error: "organization_id, client_id e client_secret sono obbligatori" });
      }
      if (api_url && !validateBisuiteUrl(api_url)) {
        return res.status(400).json({ error: "URL API non consentito. Utilizzare un host BiSuite valido." });
      }

      const orgConfig = await storage.getOrgConfig(organization_id);
      const existingConfig = (orgConfig?.config as Record<string, unknown>) || {};

      const updatedConfig = {
        ...existingConfig,
        bisuiteCredentials: { api_url: api_url || "", client_id, client_secret },
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

  // ── POST bisuite-api (proxy) ────────────────────────────────────
  app.post("/api/admin/bisuite-api", isAuthenticated, async (req: any, res) => {
    try {
      const profile = await storage.getProfile(req.session.userId);
      if (!profile || profile.role !== "super_admin") {
        return res.status(403).json({ error: "Solo il super admin può utilizzare l'API BiSuite" });
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
        const orgConfig = await storage.getOrgConfig(organization_id);
        const cfg = orgConfig?.config as Record<string, unknown> | undefined;
        const creds = cfg?.bisuiteCredentials as Record<string, string> | undefined;
        if (!creds || !creds.client_id || !creds.client_secret) {
          return res.status(400).json({ error: "Credenziali BiSuite non configurate per questa organizzazione" });
        }
        apiUrlStr = creds.api_url || "https://db1.bisuite.app";
        cId = creds.client_id;
        cSecret = creds.client_secret;
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
    const dataVendita = dataVenditaStr ? new Date(dataVenditaStr) : null;

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

  app.post("/api/admin/bisuite-import", isAuthenticated, async (req: any, res) => {
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

      const orgConfig = await storage.getOrgConfig(organization_id);
      const config = orgConfig?.config as Record<string, any> | undefined;
      const creds = config?.bisuiteCredentials;
      if (!creds?.client_id || !creds?.client_secret) {
        return res.status(400).json({ error: "Credenziali BiSuite non configurate" });
      }

      const apiUrlStr = creds.api_url || "https://db1.bisuite.app";
      const tokenUrl = deriveTokenEndpoint(apiUrlStr);
      const token = await getBisuiteToken(tokenUrl, creds.client_id, creds.client_secret);

      const salesUrl = new URL(deriveSalesEndpoint(apiUrlStr));
      if (start_date) salesUrl.searchParams.set("from", start_date);
      if (end_date) salesUrl.searchParams.set("to", end_date);

      const salesResp = await fetch(salesUrl.toString(), {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
        },
      });

      if (!salesResp.ok) {
        const errorBody = await salesResp.text();
        return res.status(salesResp.status).json({ error: `BiSuite API error (${salesResp.status})`, details: errorBody });
      }

      const salesData = await salesResp.json();

      let sales: any[] = [];
      if (Array.isArray(salesData)) {
        sales = salesData;
      } else if (salesData?.data && Array.isArray(salesData.data)) {
        sales = salesData.data;
      } else if (salesData?.vendite && Array.isArray(salesData.vendite)) {
        sales = salesData.vendite;
      } else if (salesData?.sales && Array.isArray(salesData.sales)) {
        sales = salesData.sales;
      }

      const records = sales.map((sale: any) => extractSaleFields(sale, organization_id));

      await storage.deleteBisuiteSalesByOrg(organization_id);
      const inserted = await storage.upsertBisuiteSales(records);

      res.json({
        success: true,
        message: `Importate ${inserted} vendite nel database`,
        count: inserted,
        totalFromApi: sales.length,
      });
    } catch (error: unknown) {
      console.error("BiSuite import error:", error);
      const msg = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: "Errore durante l'importazione", details: msg });
    }
  });

  app.get("/api/bisuite-credentials-status", isAuthenticated, async (req: any, res) => {
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

  app.post("/api/bisuite-fetch", isAuthenticated, async (req: any, res) => {
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

      const apiUrlStr = creds.api_url || "https://db1.bisuite.app";
      const tokenUrl = deriveTokenEndpoint(apiUrlStr);
      const token = await getBisuiteToken(tokenUrl, creds.client_id, creds.client_secret);

      const salesUrl = new URL(deriveSalesEndpoint(apiUrlStr));
      if (start_date) salesUrl.searchParams.set("from", start_date);
      if (end_date) salesUrl.searchParams.set("to", end_date);

      const salesResp = await fetch(salesUrl.toString(), {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
        },
      });

      if (!salesResp.ok) {
        const errorBody = await salesResp.text();
        return res.status(salesResp.status).json({ error: `Errore API BiSuite (${salesResp.status})`, details: errorBody });
      }

      const salesData = await salesResp.json();

      let sales: any[] = [];
      if (Array.isArray(salesData)) {
        sales = salesData;
      } else if (salesData?.data && Array.isArray(salesData.data)) {
        sales = salesData.data;
      } else if (salesData?.vendite && Array.isArray(salesData.vendite)) {
        sales = salesData.vendite;
      } else if (salesData?.sales && Array.isArray(salesData.sales)) {
        sales = salesData.sales;
      }

      const records = sales.map((sale: any) => extractSaleFields(sale, orgId));

      await storage.deleteBisuiteSalesByOrg(orgId);
      const inserted = await storage.upsertBisuiteSales(records);

      res.json({
        success: true,
        message: `Importate ${inserted} vendite`,
        count: inserted,
        totalFromApi: sales.length,
      });
    } catch (error: unknown) {
      console.error("BiSuite fetch error:", error);
      const msg = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: "Errore durante l'importazione", details: msg });
    }
  });

  app.get("/api/bisuite-sales", isAuthenticated, async (req: any, res) => {
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

      const fromRaw = req.query.from ? new Date(req.query.from as string) : undefined;
      const toRaw = req.query.to ? new Date(req.query.to as string) : undefined;
      let from = fromRaw;
      let to = toRaw;
      if (fromRaw && toRaw) {
        const adj = italianDateRange(fromRaw, toRaw);
        from = adj.from;
        to = adj.to;
      } else if (fromRaw) {
        from = new Date(fromRaw.getTime() - 2 * 60 * 60 * 1000);
      } else if (toRaw) {
        to = new Date(toRaw.getTime() + 2 * 60 * 60 * 1000);
      }

      const sales = await storage.getBisuiteSales(orgId, from, to);
      res.json({ sales, count: sales.length });
    } catch (error: unknown) {
      console.error("BiSuite sales read error:", error);
      const msg = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: "Errore nel recupero vendite", details: msg });
    }
  });

  app.get("/api/admin/bisuite-mapping", isAuthenticated, async (req: any, res) => {
    try {
      const profile = await storage.getProfile(req.session.userId);
      if (!profile || profile.role !== "super_admin") {
        return res.status(403).json({ error: "Accesso non autorizzato" });
      }

      const sysConfig = await storage.getSystemConfig("bisuite_mapping");
      const mapping = sysConfig?.config || null;
      res.json(mapping);
    } catch (error) {
      console.error("Error loading BiSuite mapping:", error);
      res.status(500).json({ error: "Errore nel caricamento della mappatura" });
    }
  });

  app.put("/api/admin/bisuite-mapping", isAuthenticated, async (req: any, res) => {
    try {
      const profile = await storage.getProfile(req.session.userId);
      if (!profile || profile.role !== "super_admin") {
        return res.status(403).json({ error: "Accesso non autorizzato" });
      }

      const { mapping } = req.body;
      if (!mapping || !Array.isArray(mapping.rules)) {
        return res.status(400).json({ error: "mapping con rules è obbligatorio" });
      }

      await storage.upsertSystemConfig("bisuite_mapping", mapping, profile.id);
      res.json({ success: true, mapping });
    } catch (error) {
      console.error("Error saving BiSuite mapping:", error);
      res.status(500).json({ error: "Errore nel salvataggio della mappatura" });
    }
  });

  app.get("/api/bisuite-sales/:id", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session.userId;
      const profile = await storage.getProfile(userId);
      if (!profile) return res.status(403).json({ error: "Accesso non autorizzato" });

      const sale = await storage.getBisuiteSale(req.params.id);
      if (!sale) return res.status(404).json({ error: "Vendita non trovata" });

      if (profile.role !== "super_admin" && sale.organizationId !== profile.organizationId) {
        return res.status(403).json({ error: "Accesso non autorizzato" });
      }

      res.json(sale);
    } catch (error: unknown) {
      console.error("BiSuite sale detail error:", error);
      const msg = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: "Errore nel recupero dettaglio", details: msg });
    }
  });

  app.get("/api/admin/bisuite-mapped-sales", isAuthenticated, async (req: any, res) => {
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

      const { from, to } = italianDateRange(new Date(year, month - 1, 1), new Date(year, month, 0, 23, 59, 59));

      const sales = await storage.getBisuiteSales(orgId, from, to);

      const sysMapping = await storage.getSystemConfig("bisuite_mapping");
      const mappingConfig = sysMapping?.config as { rules?: BiSuiteMappingRule[] } | null;
      const { getDefaultMappingRules } = await import("../shared/bisuiteMapping");
      const rules = mappingConfig?.rules || getDefaultMappingRules();

      type AggregatedItem = {
        pista: string;
        targetCategory: string;
        targetLabel: string;
        pezzi: number;
        canone: number;
      };

      const byPdv: Record<string, {
        codicePos: string;
        nomeNegozio: string;
        ragioneSociale: string;
        items: AggregatedItem[];
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
            unmapped: 0,
            totalArticoli: 0,
          };
        }

        const articoli = raw.articoli || [];
        const { mapBiSuiteArticle } = await import("../shared/bisuiteMapping");
        const clienteTipo = raw.cliente?.clienteTipo || '';

        const PRODOTTI_CATS = new Set([
          'TELEFONIA', 'MODEM/ROUTER', 'SMART DEVICE', 'INTERNET DEVICE', 'SIM', 'RICARICHE',
          'ACCESSORI', 'GARANZIE', 'RICAMBI', 'RICAMBI PC', 'DEPOSITO CAUZIONALE',
          'COSTO ATTIVAZIONE', 'EPAY', 'OPZIONI', 'ARROTONDAMENTO', 'GARANTEASY',
          'DEMO TELEFONIA WIND3', 'TELEFONIA TRADE-IN', 'ALTRO',
        ]);
        const SERVIZI_CATS = new Set(['SPEDIZIONE', 'ASSISTENZA']);

        let canvassCount = 0;
        let mappedCount = 0;
        for (const art of articoli) {
          const catNome = (art.categoria?.nome || '').toUpperCase().trim();
          if (PRODOTTI_CATS.has(catNome) || SERVIZI_CATS.has(catNome)) continue;
          canvassCount++;
          const mappedResults = mapBiSuiteArticle(art, clienteTipo, rules);
          if (mappedResults.length === 0) continue;
          mappedCount++;
          const artCanone = parseFloat(art.dettaglio?.canone || '0') || 0;
          for (const m of mappedResults) {
            const canoneForThis = m.ruleType === 'base' ? artCanone : 0;
            const existing = byPdv[codicePos].items.find(
              (i) => i.pista === m.pista && i.targetCategory === m.targetCategory
            );
            if (existing) {
              existing.pezzi++;
              existing.canone += canoneForThis;
            } else {
              byPdv[codicePos].items.push({
                pista: m.pista,
                targetCategory: m.targetCategory,
                targetLabel: m.targetLabel,
                pezzi: 1,
                canone: canoneForThis,
              });
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

      const totaliPerPista: Record<string, Record<string, { targetCategory: string; targetLabel: string; pezzi: number; canone: number }>> = {};
      for (const pdv of pdvList) {
        for (const item of pdv.items) {
          if (!totaliPerPista[item.pista]) totaliPerPista[item.pista] = {};
          if (!totaliPerPista[item.pista][item.targetCategory]) {
            totaliPerPista[item.pista][item.targetCategory] = {
              targetCategory: item.targetCategory,
              targetLabel: item.targetLabel,
              pezzi: 0,
              canone: 0,
            };
          }
          totaliPerPista[item.pista][item.targetCategory].pezzi += item.pezzi;
          totaliPerPista[item.pista][item.targetCategory].canone += item.canone;
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
        latestSaleDate: latestSaleDate ? latestSaleDate.toISOString() : null,
      });
    } catch (error: unknown) {
      console.error("BiSuite mapped sales error:", error);
      const msg = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: "Errore nell'aggregazione vendite mappate", details: msg });
    }
  });

  app.get("/api/admin/bisuite-articles-summary", isAuthenticated, async (req: any, res) => {
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

      const { from, to } = italianDateRange(new Date(year, month - 1, 1), new Date(year, month, 0, 23, 59, 59));

      const sales = await storage.getBisuiteSales(orgId, from, to);

      const sysMapping = await storage.getSystemConfig("bisuite_mapping");
      const mappingConfig = sysMapping?.config as { rules?: BiSuiteMappingRule[] } | null;
      const { getDefaultMappingRules, mapBiSuiteArticle } = await import("../shared/bisuiteMapping");
      const rules = mappingConfig?.rules || getDefaultMappingRules();

      const PRODOTTI_CATS = new Set([
        'TELEFONIA', 'MODEM/ROUTER', 'SMART DEVICE', 'INTERNET DEVICE', 'SIM', 'RICARICHE',
        'ACCESSORI', 'GARANZIE', 'RICAMBI', 'RICAMBI PC', 'DEPOSITO CAUZIONALE',
        'COSTO ATTIVAZIONE', 'EPAY', 'OPZIONI', 'ARROTONDAMENTO', 'GARANTEASY',
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
      });
    } catch (error: unknown) {
      console.error("BiSuite articles summary error:", error);
      const msg = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: "Errore nel riepilogo articoli", details: msg });
    }
  });

  return httpServer;
}
