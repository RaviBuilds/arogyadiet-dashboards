import type { SupabaseClient } from "@supabase/supabase-js";

type SupabaseError = {
  code?: string;
  message?: string;
};

export function isMissingColumnError(
  error: SupabaseError | null,
  column: string,
): boolean {
  if (!error) {
    return false;
  }

  const message = error.message?.toLowerCase() ?? "";
  return (
    message.includes(column.toLowerCase()) ||
    error.code === "42703" ||
    error.code === "PGRST204"
  );
}

export async function fetchCatalogProducts(
  supabase: SupabaseClient,
  options: { activeOnly?: boolean } = {},
) {
  const { activeOnly = true } = options;

  let query = supabase.from("products").select("*").is("deleted_at", null);

  if (activeOnly) {
    query = query.eq("is_active", true);
  }

  const result = await query.order("created_at", { ascending: false });

  if (isMissingColumnError(result.error, "deleted_at")) {
    let fallbackQuery = supabase.from("products").select("*");

    if (activeOnly) {
      fallbackQuery = fallbackQuery.eq("is_active", true);
    }

    return fallbackQuery.order("created_at", { ascending: false });
  }

  return result;
}

/**
 * Returns the products a customer should see in the shop.
 *
 * - Core customer (franchiseId null): existing behaviour — all active catalog
 *   products.
 * - Franchise customer: only catalog products that the franchise has marked
 *   visible AND has stock for. The franchise's own stock overrides the
 *   catalog stock so the customer sees franchise-specific availability.
 */
export async function fetchShopProductsForCustomer(
  supabase: SupabaseClient,
  franchiseId: string | null,
) {
  if (!franchiseId) {
    return fetchCatalogProducts(supabase);
  }

  const { data: settings, error: settingsError } = await supabase
    .from("franchise_product_settings")
    .select("product_id, stock_quantity, is_visible")
    .eq("franchise_id", franchiseId)
    .eq("is_visible", true)
    .gt("stock_quantity", 0);

  if (settingsError) {
    return { data: [], error: settingsError };
  }

  const ids = (settings ?? []).map((s) => s.product_id);
  if (ids.length === 0) {
    return { data: [], error: null };
  }

  const { data: products, error } = await supabase
    .from("products")
    .select("*")
    .is("deleted_at", null)
    .eq("is_active", true)
    .in("id", ids)
    .order("created_at", { ascending: false });

  if (error) {
    return { data: products ?? [], error };
  }

  const stockMap = new Map(
    (settings ?? []).map((s) => [s.product_id, s.stock_quantity]),
  );

  const merged = (products ?? []).map((p) => ({
    ...p,
    stock_quantity: stockMap.get(p.id) ?? p.stock_quantity,
    in_stock: true,
  }));

  return { data: merged, error: null };
}

export async function fetchProductForCheckout(
  supabase: SupabaseClient,
  productId: string,
) {
  const withSoftDelete = await supabase
    .from("products")
    .select("id, original_price, sale_price, tax_percent, deleted_at")
    .eq("id", productId)
    .single();

  if (isMissingColumnError(withSoftDelete.error, "deleted_at")) {
    return supabase
      .from("products")
      .select("id, original_price, sale_price, tax_percent")
      .eq("id", productId)
      .single();
  }

  return withSoftDelete;
}

export function isProductUnavailable(
  product: { deleted_at?: string | null; id?: string } | null,
  error: SupabaseError | null,
): product is null {
  if (error || !product) {
    return true;
  }

  return Boolean(product.deleted_at);
}
