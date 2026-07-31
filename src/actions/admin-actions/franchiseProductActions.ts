"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { resolveFranchiseContext } from "@/lib/franchise/context";
import { checkWarehouseAccess } from "@/lib/auth/adminAccess";
import { logAdminAction } from "@/lib/logger";
import { revalidatePath } from "next/cache";
import { z } from "zod";

/**
 * Franchise shop-product management.
 *
 * Architecture: the `products` table is the single, admin-owned catalog.
 * Each franchise overlays its own `stock_quantity` + `is_visible` on every
 * catalog product via `franchise_product_settings`. Franchise admins can ONLY
 * edit those two fields — they cannot add/edit/delete catalog products.
 */

export interface FranchiseShopProduct {
  id: string;
  sku: string | null;
  name: string;
  category: string | null;
  original_price: number;
  sale_price: number | null;
  image_urls: string[] | null;
  banner_image_url: string | null;
  // Catalog-level admin visibility (product hidden globally when false)
  catalog_active: boolean;
  // Franchise overlay
  stock_quantity: number;
  is_visible: boolean;
  has_settings: boolean;
  // Product_Link — the linked Master_Catalog_Product id, or null when this
  // Shop_Product is unlinked. Only a linked product gets a Stock_In action
  // on the Franchise_Shop_Products_Page (Req 18.1).
  inventory_product_id: string | null;
}

type ActionResult = { success: boolean; error?: string };

const FRANCHISE_SHOP_PATH = "/franchise/shop-products";
const WAREHOUSE_SHOP_PRODUCTS_PATH = "/admin/inventory/shop-products";

/**
 * Resolves the franchise_id for the current FRANCHISE_ADMIN session.
 * Returns null when the caller is not a franchise admin or has no franchise.
 */
async function resolveCallerFranchiseId(): Promise<string | null> {
  const ctx = await resolveFranchiseContext();
  if (!ctx) return null;
  if (ctx.role !== "FRANCHISE_ADMIN") return null;
  return ctx.franchise_id;
}

/**
 * Lists the shared catalog merged with this franchise's overlay settings.
 * New catalog products automatically appear here with defaults
 * (stock 0, hidden) until the franchise admin configures them.
 */
export async function getFranchiseShopProducts(
  franchiseId: string,
): Promise<FranchiseShopProduct[]> {
  if (!franchiseId) return [];

  const supabase = createAdminClient();

  const { data: products, error } = await supabase
    .from("products")
    .select(
      "id, sku, name, category, original_price, sale_price, image_urls, banner_image_url, is_active, inventory_product_id",
    )
    .is("deleted_at", null)
    .order("name", { ascending: true });

  if (error) {
    console.error("getFranchiseShopProducts (products):", error.message);
    // Thrown (rather than returning []) so the page can distinguish a genuine
    // empty catalogue from a load failure and display the error message
    // Requirement 18.12 requires, showing no Shop_Product rows either way.
    throw new Error("The franchise shop stock could not be loaded.");
  }

  const { data: settings, error: settingsError } = await supabase
    .from("franchise_product_settings")
    .select("product_id, stock_quantity, is_visible")
    .eq("franchise_id", franchiseId);

  if (settingsError) {
    console.error("getFranchiseShopProducts (settings):", settingsError.message);
    throw new Error("The franchise shop stock could not be loaded.");
  }

  const settingsMap = new Map(
    (settings ?? []).map((s) => [s.product_id, s]),
  );

  return (products ?? []).map((p) => {
    const s = settingsMap.get(p.id);
    return {
      id: p.id,
      sku: p.sku,
      name: p.name,
      category: p.category,
      original_price: p.original_price,
      sale_price: p.sale_price,
      image_urls: p.image_urls,
      banner_image_url: p.banner_image_url,
      catalog_active: p.is_active,
      stock_quantity: s?.stock_quantity ?? 0,
      is_visible: s?.is_visible ?? false,
      has_settings: Boolean(s),
      inventory_product_id: p.inventory_product_id ?? null,
    };
  });
}

const stockSchema = z.object({
  productId: z.string().uuid(),
  stockQuantity: z.number().int().min(0, "Stock must be 0 or greater"),
});

/**
 * Sets the franchise's stock for a product (upsert). The franchise_id is
 * resolved from the authenticated session, never trusted from the client.
 */
export async function updateFranchiseProductStock(
  productId: string,
  stockQuantity: number,
): Promise<ActionResult> {
  const parsed = stockSchema.safeParse({ productId, stockQuantity });
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0].message };
  }

  const franchiseId = await resolveCallerFranchiseId();
  if (!franchiseId) {
    return { success: false, error: "No franchise assigned to your account." };
  }

  const supabase = createAdminClient();

  const { error } = await supabase.from("franchise_product_settings").upsert(
    {
      franchise_id: franchiseId,
      product_id: parsed.data.productId,
      stock_quantity: parsed.data.stockQuantity,
    },
    { onConflict: "franchise_id,product_id" },
  );

  if (error) {
    console.error("updateFranchiseProductStock:", error.message);
    return { success: false, error: error.message };
  }

  await logAdminAction("UPDATE", "franchise_product_stock", parsed.data.productId, {
    franchise_id: franchiseId,
    stock_quantity: parsed.data.stockQuantity,
  });

  revalidatePath(FRANCHISE_SHOP_PATH);
  return { success: true };
}

/**
 * Shows/hides a product on this franchise's customer shop (upsert).
 *
 * `explicitFranchiseId` (clinic-scoped-shop-inventory spec, Req 19.10) lets
 * the Warehouse_Shop_Products_Page's Franchise_Mode name the Franchise it is
 * toggling, since that request runs under an admin session with no franchise
 * context of its own. It is honoured ONLY when the caller is an authorized
 * Inventory_Admin (`checkWarehouseAccess("inventory_operations")`) — the
 * existing franchise-session path (`resolveCallerFranchiseId`) is completely
 * unchanged and still takes priority whenever a franchise session exists, so
 * a franchise admin can never use this parameter to name another franchise.
 */
export async function toggleFranchiseProductVisibility(
  productId: string,
  isVisible: boolean,
  explicitFranchiseId?: string,
): Promise<ActionResult> {
  if (!z.string().uuid().safeParse(productId).success) {
    return { success: false, error: "Invalid product." };
  }

  let franchiseId = await resolveCallerFranchiseId();

  if (!franchiseId && explicitFranchiseId) {
    if (!z.string().uuid().safeParse(explicitFranchiseId).success) {
      return { success: false, error: "Invalid franchise." };
    }
    const gate = await checkWarehouseAccess("inventory_operations");
    if (!gate.ok) return { success: false, error: gate.error };
    franchiseId = explicitFranchiseId;
  }

  if (!franchiseId) {
    return { success: false, error: "No franchise assigned to your account." };
  }

  const supabase = createAdminClient();

  const { error } = await supabase.from("franchise_product_settings").upsert(
    {
      franchise_id: franchiseId,
      product_id: productId,
      is_visible: isVisible,
    },
    { onConflict: "franchise_id,product_id" },
  );

  if (error) {
    console.error("toggleFranchiseProductVisibility:", error.message);
    return { success: false, error: error.message };
  }

  await logAdminAction(
    "UPDATE",
    "franchise_product_visibility",
    productId,
    { franchise_id: franchiseId, is_visible: isVisible },
  );

  revalidatePath(FRANCHISE_SHOP_PATH);
  if (explicitFranchiseId) {
    revalidatePath(WAREHOUSE_SHOP_PRODUCTS_PATH);
  }
  return { success: true };
}

export interface ProductFranchiseAvailability {
  franchise_id: string;
  franchise_name: string;
  status: string;
  stock_quantity: number;
  is_visible: boolean;
  configured: boolean;
}

/**
 * Admin oversight: for a single catalog product, returns every active
 * franchise's overlay (visibility + stock). Franchises that have not yet
 * configured the product appear with defaults (hidden, 0 stock).
 */
export async function getProductFranchiseAvailability(
  productId: string,
): Promise<ProductFranchiseAvailability[]> {
  const supabase = createAdminClient();

  const { data: franchises } = await supabase
    .from("franchises")
    .select("id, name, status")
    .order("name", { ascending: true });

  const { data: settings } = await supabase
    .from("franchise_product_settings")
    .select("franchise_id, stock_quantity, is_visible")
    .eq("product_id", productId);

  const settingsMap = new Map(
    (settings ?? []).map((s) => [s.franchise_id, s]),
  );

  return (franchises ?? []).map((f) => {
    const s = settingsMap.get(f.id);
    return {
      franchise_id: f.id,
      franchise_name: f.name,
      status: f.status,
      stock_quantity: s?.stock_quantity ?? 0,
      is_visible: s?.is_visible ?? false,
      configured: Boolean(s),
    };
  });
}
