"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { fetchCatalogProducts } from "@/lib/products/catalog-queries";
import { checkWarehouseAccess } from "@/lib/auth/adminAccess";
import { computeAggregateStock } from "@/lib/shop/clinicStock";
import { listOverlaysForProduct } from "@/repositories/clinic/clinicProductRepository";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ActionResult as DataActionResult } from "@/types/clinic";

export interface AdminInventoryProduct {
  id: string;
  sku: string | null;
  name: string;
  category: string | null;
  original_price: number;
  sale_price: number | null;
  stock_quantity: number | null;
  tax_percent: number | null;
  short_description: string | null;
  description: string | null;
  image_urls: string[] | null;
  banner_image_url: string | null;
  is_active: boolean;
  deleted_at: string | null;
  created_at: string;
  /** Product_Link — the linked Master_Catalog_Product id, or `null` when unlinked. */
  inventory_product_id: string | null;
}

const upsertProductSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(1, "Name is required"),
  sku: z.string().min(1, "SKU is required"),
  category: z.string().optional(),
  originalPrice: z.number().min(0, "Original price must be 0 or greater"),
  salePrice: z.number().min(0).optional().nullable(),
  taxPercent: z.number().min(0).max(100).optional().nullable(),
  description: z.string().optional(),
  inventoryProductId: z
    .string()
    .uuid("Invalid Master Catalog Product ID")
    .optional()
    .nullable(),
});

type ActionResult = { success: boolean; error?: string };

const INVENTORY_PATH = "/admin/kitchen-shop/inventory";
const INVENTORY_SHOP_PRODUCTS_PATH = "/admin/inventory/shop-products";

function getFormString(formData: FormData, key: string): string {
  const value = formData.get(key);
  return value?.toString().trim() ?? "";
}

function getOptionalFormNumber(
  formData: FormData,
  key: string,
): number | null {
  const raw = getFormString(formData, key);
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isNaN(parsed) ? null : parsed;
}

function getFormFiles(formData: FormData): File[] {
  const fromImages = formData.getAll("images");
  const fromImage = formData.getAll("image");

  return [...fromImages, ...fromImage].filter(
    (entry): entry is File => entry instanceof File && entry.size > 0,
  );
}

export async function adminGetProducts(): Promise<AdminInventoryProduct[]> {
  const supabase = createAdminClient();

  const { data, error } = await fetchCatalogProducts(supabase, {
    activeOnly: false,
  });

  if (error) {
    console.error("Error fetching products:", error.message, error.code);
    return [];
  }

  return (data ?? []) as AdminInventoryProduct[];
}

export async function adminUpsertProduct(
  formData: FormData,
): Promise<ActionResult> {
  const gate = await checkWarehouseAccess("product_management");
  if (!gate.ok) return { success: false, error: gate.error };

  const idValue = getFormString(formData, "id");
  const inventoryProductIdValue = getFormString(formData, "inventoryProductId");

  const parsed = upsertProductSchema.safeParse({
    id: idValue || undefined,
    name: getFormString(formData, "name"),
    sku: getFormString(formData, "sku"),
    category: getFormString(formData, "category") || undefined,
    originalPrice: Number(getFormString(formData, "originalPrice")),
    salePrice: getOptionalFormNumber(formData, "salePrice"),
    taxPercent: getOptionalFormNumber(formData, "taxPercent"),
    description: getFormString(formData, "description") || undefined,
    inventoryProductId: inventoryProductIdValue || null,
  });

  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0].message };
  }

  const data = parsed.data;
  const supabaseAdmin = createAdminClient();

  const image_urls = formData
    .getAll("existingImageUrls")
    .map((url) => url.toString().trim())
    .filter(Boolean);

  const bannerImageUrl = getFormString(formData, "bannerImageUrl");
  const bannerNewFileIndex = Number(getFormString(formData, "bannerNewFileIndex"));

  let short_description: string | null = null;

  if (data.id) {
    const { data: existingProduct } = await supabaseAdmin
      .from("products")
      .select("short_description, deleted_at, inventory_product_id")
      .eq("id", data.id)
      .maybeSingle();

    if (existingProduct?.deleted_at) {
      return {
        success: false,
        error: "This product has been archived and can no longer be edited.",
      };
    }

    short_description = existingProduct?.short_description ?? null;

    const nextInventoryProductId = data.inventoryProductId ?? null;
    const existingInventoryProductId =
      existingProduct?.inventory_product_id ?? null;

    if (nextInventoryProductId !== existingInventoryProductId) {
      let overlays;
      try {
        overlays = await listOverlaysForProduct(data.id);
      } catch {
        return {
          success: false,
          error: "The product's clinic stock could not be verified.",
        };
      }

      if (computeAggregateStock(overlays) > 0) {
        return {
          success: false,
          error:
            "The Product Link can be changed only while every clinic holds 0 stock of this product.",
        };
      }
    }
  }

  if (data.inventoryProductId) {
    const { data: linkedProduct, error: linkedError } = await supabaseAdmin
      .from("inventory_products")
      .select("id")
      .eq("id", data.inventoryProductId)
      .is("deleted_at", null)
      .maybeSingle();

    if (linkedError) {
      return {
        success: false,
        error: "The selected Master Catalog Product could not be verified.",
      };
    }
    if (!linkedProduct) {
      return {
        success: false,
        error: "The selected Master Catalog Product was not found.",
      };
    }
  }

  const files = getFormFiles(formData);
  const uploadedUrls: string[] = [];

  for (const [index, file] of files.entries()) {
    const extension = file.name.split(".").pop() || "jpg";
    const filename = `${Date.now()}-${index}.${extension}`;

    const { error: uploadError } = await supabaseAdmin.storage
      .from("product-images")
      .upload(filename, file);

    if (uploadError) {
      console.error("Error uploading product image:", uploadError);
      return { success: false, error: uploadError.message };
    }

    const {
      data: { publicUrl },
    } = supabaseAdmin.storage.from("product-images").getPublicUrl(filename);

    uploadedUrls.push(publicUrl);
    image_urls.push(publicUrl);
  }

  let banner_image_url: string | null = null;

  if (
    Number.isInteger(bannerNewFileIndex) &&
    bannerNewFileIndex >= 0 &&
    uploadedUrls[bannerNewFileIndex]
  ) {
    banner_image_url = uploadedUrls[bannerNewFileIndex];
  } else if (bannerImageUrl) {
    banner_image_url = bannerImageUrl;
  } else if (uploadedUrls[0]) {
    banner_image_url = uploadedUrls[0];
  } else if (image_urls[0]) {
    banner_image_url = image_urls[0];
  }

  const record: Record<string, unknown> = {
    name: data.name,
    sku: data.sku,
    category: data.category?.trim() || null,
    original_price: data.originalPrice,
    sale_price: data.salePrice ?? null,
    tax_percent: data.taxPercent ?? null,
    short_description,
    description: data.description?.trim() || null,
    image_urls,
    banner_image_url,
    inventory_product_id: data.inventoryProductId ?? null,
    updated_at: new Date().toISOString(),
  };

  if (data.id) {
    record.id = data.id;
  }

  const { error } = await supabaseAdmin
    .from("products")
    .upsert(record, { onConflict: "id" });

  if (error) {
    console.error("Error upserting product:", error);
    return { success: false, error: error.message };
  }

  revalidatePath(INVENTORY_PATH);
  revalidatePath(INVENTORY_SHOP_PRODUCTS_PATH);
  return { success: true };
}

export async function adminDeleteProduct(id: string): Promise<ActionResult> {
  const gate = await checkWarehouseAccess("product_management");
  if (!gate.ok) return { success: false, error: gate.error };

  const supabaseAdmin = createAdminClient();

  const { error } = await supabaseAdmin
    .from("products")
    .update({
      deleted_at: new Date().toISOString(),
      is_active: false,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .is("deleted_at", null);

  if (error) {
    console.error("Error archiving product:", error);
    return { success: false, error: error.message };
  }

  revalidatePath(INVENTORY_PATH);
  revalidatePath(INVENTORY_SHOP_PRODUCTS_PATH);
  return { success: true };
}

export async function adminToggleProductVisibility(
  id: string,
  currentStatus: boolean,
): Promise<ActionResult> {
  const gate = await checkWarehouseAccess("product_management");
  if (!gate.ok) return { success: false, error: gate.error };

  const supabaseAdmin = createAdminClient();

  const { error } = await supabaseAdmin
    .from("products")
    .update({ is_active: !currentStatus, updated_at: new Date().toISOString() })
    .eq("id", id);

  if (error) {
    console.error("Error toggling product visibility:", error);
    return { success: false, error: error.message };
  }

  revalidatePath(INVENTORY_PATH);
  revalidatePath(INVENTORY_SHOP_PRODUCTS_PATH);
  return { success: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// getMasterCatalogProductOptionsAction — Requirement 3.2, 3.3, 3.4
// ─────────────────────────────────────────────────────────────────────────────

/** One selectable Master_Catalog_Product option for `MasterCatalogProductSelector`. */
export interface MasterCatalogProductOption {
  id: string;
  name: string;
  base_uom: string;
}

/**
 * List every Master_Catalog_Product (`inventory_products`, not deleted) by
 * name and base unit of measure, for the Master_Catalog_Product selector
 * offered when creating or editing a Shop_Product (Req 3.2). An empty list is
 * a valid success result — the selector renders its own empty-state copy and
 * offers only the "Not linked" option (Req 3.3); a load failure is
 * distinguished via `success: false` so the selector can show the
 * load-failure copy instead and leave any existing Product_Link untouched
 * (Req 3.4).
 */
export async function getMasterCatalogProductOptionsAction(): Promise<
  DataActionResult<MasterCatalogProductOption[]>
> {
  const gate = await checkWarehouseAccess("product_management");
  if (!gate.ok) return { success: false, error: gate.error };

  const supabaseAdmin = createAdminClient();

  const { data, error } = await supabaseAdmin
    .from("inventory_products")
    .select("id, name, base_uom")
    .is("deleted_at", null)
    .order("name", { ascending: true });

  if (error) {
    return {
      success: false,
      error: "The Master Catalog Product list could not be loaded.",
    };
  }

  return {
    success: true,
    data: (data ?? []).map((row) => ({
      id: row.id,
      name: row.name,
      base_uom: row.base_uom,
    })),
  };
}
