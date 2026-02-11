import { pgTable, text, serial, integer, boolean, timestamp, varchar } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { relations } from "drizzle-orm";
import { users } from "./models/auth";

// Re-export auth models
export * from "./models/auth";

export const products = pgTable("products", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  imageUrl: text("image_url").notNull(),
  startPrice: integer("start_price").notNull(), // Stored in cents
  currentPrice: integer("current_price").notNull(), // Stored in cents
  // Seller ID references the string ID from auth users
  sellerId: varchar("seller_id").references(() => users.id).notNull(),
  endsAt: timestamp("ends_at").notNull(),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

export const bids = pgTable("bids", {
  id: serial("id").primaryKey(),
  amount: integer("amount").notNull(), // Stored in cents
  // Bidder ID references the string ID from auth users
  bidderId: varchar("bidder_id").references(() => users.id).notNull(),
  productId: integer("product_id").references(() => products.id).notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const productsRelations = relations(products, ({ one, many }) => ({
  seller: one(users, {
    fields: [products.sellerId],
    references: [users.id],
  }),
  bids: many(bids),
}));

export const bidsRelations = relations(bids, ({ one }) => ({
  bidder: one(users, {
    fields: [bids.bidderId],
    references: [users.id],
  }),
  product: one(products, {
    fields: [bids.productId],
    references: [products.id],
  }),
}));

export const insertProductSchema = createInsertSchema(products).omit({ 
  id: true, 
  currentPrice: true, 
  isActive: true, 
  createdAt: true 
});
export const insertBidSchema = createInsertSchema(bids).omit({ id: true, createdAt: true });

export type Product = typeof products.$inferSelect;
export type Bid = typeof bids.$inferSelect;
export type InsertProduct = z.infer<typeof insertProductSchema>;
export type InsertBid = z.infer<typeof insertBidSchema>;
