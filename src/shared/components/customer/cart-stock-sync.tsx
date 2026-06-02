"use client";

import { Product } from "@/types/product";
import { useSyncCartStockFromProducts } from "@/shared/hooks/use-sync-cart-stock";

interface CartStockSyncProps {
  products: Pick<Product, "id" | "in_stock">[];
}

export function CartStockSync({ products }: CartStockSyncProps) {
  useSyncCartStockFromProducts(products);
  return null;
}
