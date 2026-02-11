import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, buildUrl, type errorSchemas } from "@shared/routes";
import { type InsertProduct, type Product, type InsertBid, type Bid, type User } from "@shared/schema";
import { z } from "zod";

type ProductWithBids = Product & { bids: (Bid & { bidder: User })[] };

export function useProducts() {
  return useQuery({
    queryKey: [api.products.list.path],
    queryFn: async () => {
      const res = await fetch(api.products.list.path, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch products");
      return api.products.list.responses[200].parse(await res.json());
    },
  });
}

export function useProduct(id: number) {
  return useQuery({
    queryKey: [api.products.get.path, id],
    queryFn: async () => {
      const url = buildUrl(api.products.get.path, { id });
      const res = await fetch(url, { credentials: "include" });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error("Failed to fetch product");
      return api.products.get.responses[200].parse(await res.json());
    },
  });
}

export function useCreateProduct() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: InsertProduct) => {
      const validated = api.products.create.input.parse(data);
      const res = await fetch(api.products.create.path, {
        method: api.products.create.method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(validated),
        credentials: "include",
      });
      
      if (!res.ok) {
        if (res.status === 400) {
          const error = api.products.create.responses[400].parse(await res.json());
          throw new Error(error.message);
        }
        if (res.status === 401) throw new Error("Unauthorized");
        throw new Error("Failed to create product");
      }
      return api.products.create.responses[201].parse(await res.json());
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [api.products.list.path] });
    },
  });
}

export function usePlaceBid() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ productId, amount }: { productId: number, amount: number }) => {
      const url = buildUrl(api.bids.create.path, { id: productId });
      const validated = api.bids.create.input.parse({ amount });
      
      const res = await fetch(url, {
        method: api.bids.create.method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(validated),
        credentials: "include",
      });

      if (!res.ok) {
        if (res.status === 400) {
          const error = api.bids.create.responses[400].parse(await res.json());
          throw new Error(error.message);
        }
        if (res.status === 401) throw new Error("Please log in to bid");
        throw new Error("Failed to place bid");
      }
      return api.bids.create.responses[201].parse(await res.json());
    },
    onSuccess: (_, { productId }) => {
      queryClient.invalidateQueries({ queryKey: [api.products.list.path] });
      queryClient.invalidateQueries({ queryKey: [api.products.get.path, productId] });
    },
  });
}
