import type { Express } from "express";
import { type Server } from "http";
import { storage } from "./storage";
import { setupAuth, registerAuthRoutes, isAuthenticated } from "./replit_integrations/auth";

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  // Set up Replit Auth
  await setupAuth(app);
  registerAuthRoutes(app);

  // Get current user profile with organization
  app.get("/api/user", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      let profile = await storage.getProfile(userId);
      
      if (!profile) {
        // Auto-create profile on first login
        profile = await storage.upsertProfile({
          id: userId,
          email: req.user.claims.email,
          fullName: `${req.user.claims.first_name || ''} ${req.user.claims.last_name || ''}`.trim() || null,
          profileImageUrl: req.user.claims.profile_image_url,
          role: "operatore",
        });
      }

      let organization = null;
      if (profile.organizationId) {
        organization = await storage.getOrganization(profile.organizationId);
      }

      res.json({ ...profile, organization });
    } catch (error) {
      console.error("Error fetching user:", error);
      res.status(500).json({ message: "Failed to fetch user" });
    }
  });

  // === PREVENTIVI ===
  app.get("/api/preventivi", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
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
      const userId = req.user.claims.sub;
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
      const userId = req.user.claims.sub;
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
      const userId = req.user.claims.sub;
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

  // === ADMIN: Team Management ===
  app.get("/api/admin/team", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
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
      const userId = req.user.claims.sub;
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
      const userId = req.user.claims.sub;
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
      const userId = req.user.claims.sub;
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
      const userId = req.user.claims.sub;
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
      const userId = req.user.claims.sub;
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
      const userId = req.user.claims.sub;
      let profile = await storage.getProfile(userId);
      if (!profile) {
        profile = await storage.upsertProfile({
          id: userId,
          email: req.user.claims.email,
          fullName: `${req.user.claims.first_name || ''} ${req.user.claims.last_name || ''}`.trim() || null,
          profileImageUrl: req.user.claims.profile_image_url,
          role: "operatore",
        });
      }
      let organization = null;
      if (profile.organizationId) {
        organization = await storage.getOrganization(profile.organizationId);
      }
      res.json({ ...profile, organization });
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch user" });
    }
  });

  app.get("/api/admin/team-members", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
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
      const userId = req.user.claims.sub;
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
      const userId = req.user.claims.sub;
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
      const userId = req.user.claims.sub;
      const profile = await storage.getProfile(userId);
      if (!profile || !["super_admin", "admin"].includes(profile.role)) {
        return res.status(403).json({ message: "Forbidden" });
      }
      const { email, full_name, organization_id, role } = req.body;
      const newProfile = await storage.upsertProfile({
        id: `user_${Date.now()}`,
        email,
        fullName: full_name,
        organizationId: organization_id || profile.organizationId,
        role: role || "operatore",
      });
      res.json(newProfile);
    } catch (error) {
      res.status(500).json({ error: "Error creating user" });
    }
  });

  app.post("/api/admin/update-user", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const profile = await storage.getProfile(userId);
      if (!profile || !["super_admin", "admin"].includes(profile.role)) {
        return res.status(403).json({ message: "Forbidden" });
      }
      const { user_id, full_name, role } = req.body;
      if (profile.role === "admin") {
        const targetProfile = await storage.getProfile(user_id);
        if (!targetProfile || targetProfile.organizationId !== profile.organizationId) {
          return res.status(403).json({ message: "Cannot update users outside your organization" });
        }
      }
      const updated = await storage.updateProfile(user_id, { fullName: full_name, role });
      res.json(updated);
    } catch (error) {
      res.status(500).json({ error: "Error updating user" });
    }
  });

  app.post("/api/admin/delete-entity", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const profile = await storage.getProfile(userId);
      if (!profile || !["super_admin", "admin"].includes(profile.role)) {
        return res.status(403).json({ message: "Forbidden" });
      }
      const { entity_type, entity_id } = req.body;
      if (entity_type === "user" || entity_type === "profile") {
        if (profile.role === "admin") {
          const targetProfile = await storage.getProfile(entity_id);
          if (!targetProfile || targetProfile.organizationId !== profile.organizationId) {
            return res.status(403).json({ message: "Cannot delete users outside your organization" });
          }
        }
        await storage.deleteProfile(entity_id);
      } else if (entity_type === "organization") {
        if (profile.role !== "super_admin") {
          return res.status(403).json({ message: "Only super admins can delete organizations" });
        }
        await storage.deleteOrganization(entity_id);
      }
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Error deleting entity" });
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
