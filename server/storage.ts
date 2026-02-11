import { db } from "./db";
import { products, bids, users, type Product, type InsertProduct, type Bid, type InsertBid, type User } from "@shared/schema";
import { eq, desc, lt, and } from "drizzle-orm";

export interface IStorage {
  // Products
  getProducts(): Promise<Product[]>;
  getProduct(id: number): Promise<Product | undefined>;
  createProduct(product: InsertProduct): Promise<Product>;
  
  // Bids
  createBid(bid: InsertBid): Promise<Bid>;
  getBidsForProduct(productId: number): Promise<(Bid & { bidder: User })[]>;
  getLatestBid(productId: number): Promise<Bid | undefined>;
  
  // Users (Basic lookup)
  getUser(id: string): Promise<User | undefined>;
}

export class DatabaseStorage implements IStorage {
  async getProducts(): Promise<Product[]> {
    return await db.select().from(products).orderBy(desc(products.createdAt));
  }

  async getProduct(id: number): Promise<Product | undefined> {
    const [product] = await db.select().from(products).where(eq(products.id, id));
    return product;
  }

  async createProduct(product: InsertProduct): Promise<Product> {
    const [newProduct] = await db.insert(products).values(product).returning();
    return newProduct;
  }

  async createBid(bid: InsertBid): Promise<Bid> {
    const [newBid] = await db.insert(bids).values(bid).returning();
    
    // Update product current price
    await db.update(products)
      .set({ currentPrice: bid.amount })
      .where(eq(products.id, bid.productId));
      
    return newBid;
  }

  async getBidsForProduct(productId: number): Promise<(Bid & { bidder: User })[]> {
    return await db.query.bids.findMany({
      where: eq(bids.productId, productId),
      with: {
        bidder: true
      },
      orderBy: desc(bids.amount)
    });
  }

  async getLatestBid(productId: number): Promise<Bid | undefined> {
    const [bid] = await db.select()
      .from(bids)
      .where(eq(bids.productId, productId))
      .orderBy(desc(bids.amount))
      .limit(1);
    return bid;
  }

  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }
}

export const storage = new DatabaseStorage();
