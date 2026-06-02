import { createClient } from "@/lib/supabase/client";
import { CartItem, Product } from "@/types/product";

export function getOutOfStockCartItemIds(
  cartItems: CartItem[],
  products: Pick<Product, "id" | "in_stock">[],
): string[] {
  const stockByProductId = new Map(
    products.map((product) => [product.id, product.in_stock]),
  );

  return cartItems
    .filter((item) => stockByProductId.get(item.id) === false)
    .map((item) => item.id);
}

export async function fetchUnavailableCartItemIds(
  cartItemIds: string[],
): Promise<string[]> {
  if (cartItemIds.length === 0) {
    return [];
  }

  const supabase = createClient();
  const { data, error } = await supabase
    .from("products")
    .select("id, in_stock")
    .in("id", cartItemIds);

  if (error) {
    throw new Error("Failed to verify product availability.");
  }

  const foundProducts = data ?? [];
  const foundIds = new Set(foundProducts.map((product) => product.id));

  const outOfStockIds = foundProducts
    .filter((product) => !product.in_stock)
    .map((product) => product.id);

  const missingProductIds = cartItemIds.filter((id) => !foundIds.has(id));

  return [...outOfStockIds, ...missingProductIds];
}
