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
