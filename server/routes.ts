import type { Express, RequestHandler } from "express";
import { type Server } from "http";
import { storage } from "./storage";
import session from "express-session";
import connectPg from "connect-pg-simple";
import bcrypt from "bcryptjs";
import { z } from "zod";

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
      if (role && profile.role === "super_admin") updateData.role = role;
      const updated = await storage.updateProfile(targetId, updateData);
      res.json(updated);
    } catch (error) {
      res.status(500).json({ error: "Error updating user" });
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

  app.post("/api/admin/bisuite-api", isAuthenticated, async (_req: any, res) => {
    res.status(501).json({ error: "BiSuite API not configured" });
  });

  app.get("/api/admin/bisuite-credentials", isAuthenticated, async (_req: any, res) => {
    res.json([]);
  });

  app.post("/api/admin/bisuite-credentials", isAuthenticated, async (_req: any, res) => {
    res.status(501).json({ error: "BiSuite credentials not configured" });
  });

  app.put("/api/admin/bisuite-credentials", isAuthenticated, async (_req: any, res) => {
    res.status(501).json({ error: "BiSuite credentials not configured" });
  });

  return httpServer;
}
