import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { api } from "@shared/routes";
import { z } from "zod";
import { setupAuth, registerAuthRoutes } from "./replit_integrations/auth";
import { users } from "@shared/schema";
import { db } from "./db";

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  // Set up Replit Auth
  await setupAuth(app);
  registerAuthRoutes(app);

  // Products List
  app.get(api.products.list.path, async (req, res) => {
    const products = await storage.getProducts();
    res.json(products);
  });

  // Get Product Details
  app.get(api.products.get.path, async (req, res) => {
    const id = parseInt(req.params.id);
    const product = await storage.getProduct(id);
    
    if (!product) {
      return res.status(404).json({ message: "Product not found" });
    }

    const bids = await storage.getBidsForProduct(id);
    res.json({ ...product, bids });
  });

  // Create Product (Protected)
  app.post(api.products.create.path, async (req, res) => {
    if (!req.isAuthenticated()) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    try {
      const input = api.products.create.input.parse(req.body);
      // User is authenticated, so req.user.claims.sub is the user ID
      const user = req.user as any;
      const sellerId = user.claims.sub;
      
      const product = await storage.createProduct({
        ...input,
        sellerId,
        currentPrice: input.startPrice,
        isActive: true,
      });
      
      res.status(201).json(product);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({
          message: err.errors[0].message,
          field: err.errors[0].path.join('.'),
        });
      }
      throw err;
    }
  });

  // Place Bid (Protected)
  app.post(api.bids.create.path, async (req, res) => {
    if (!req.isAuthenticated()) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const productId = parseInt(req.params.id);
    const user = req.user as any;
    const bidderId = user.claims.sub;

    try {
      const { amount } = req.body;
      
      // Validation: Check if product exists and is active
      const product = await storage.getProduct(productId);
      if (!product || !product.isActive) {
        return res.status(404).json({ message: "Product not found or inactive" });
      }

      // Validation: Check if auction ended
      if (new Date() > new Date(product.endsAt)) {
        return res.status(400).json({ message: "Auction has ended" });
      }

      // Validation: Check if bid is higher than current price
      if (amount <= product.currentPrice) {
        return res.status(400).json({ message: "Bid must be higher than current price" });
      }

      const bid = await storage.createBid({
        amount,
        productId,
        bidderId,
      });

      res.status(201).json(bid);
    } catch (err) {
      res.status(500).json({ message: "Internal server error" });
    }
  });
  
  // Seed data is skipped here because we need a user to assign products to.
  // In a real scenario, we might create a system user or wait for first login.

  return httpServer;
}
