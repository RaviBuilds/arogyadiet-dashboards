"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { fetchCatalogProducts } from "@/lib/products/catalog-queries";
import { checkGroupManage } from "@/lib/auth/adminAccess";
import { revalidatePath } from "next/cache";
import { z } from "zod";

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
}

const upsertProductSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(1, "Name is required"),
  sku: z.string().min(1, "SKU is required"),
  category: z.string().optional(),
  originalPrice: z.number().min(0, "Original price must be 0 or greater"),
  salePrice: z.number().min(0).optional().nullable(),
  stockQuantity: z
    .number()
    .int()
    .min(0, "Stock quantity must be 0 or greater"),
  taxPercent: z.number().min(0).max(100).optional().nullable(),
  description: z.string().optional(),
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
  const gate = await checkGroupManage("shop_products");
  if (!gate.ok) return { success: false, error: gate.error };

  const idValue = getFormString(formData, "id");

  const parsed = upsertProductSchema.safeParse({
    id: idValue || undefined,
    name: getFormString(formData, "name"),
    sku: getFormString(formData, "sku"),
    category: getFormString(formData, "category") || undefined,
    originalPrice: Number(getFormString(formData, "originalPrice")),
    salePrice: getOptionalFormNumber(formData, "salePrice"),
    stockQuantity: Number(getFormString(formData, "stockQuantity")),
    taxPercent: getOptionalFormNumber(formData, "taxPercent"),
    description: getFormString(formData, "description") || undefined,
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
      .select("short_description, deleted_at")
      .eq("id", data.id)
      .maybeSingle();

    if (existingProduct?.deleted_at) {
      return {
        success: false,
        error: "This product has been archived and can no longer be edited.",
      };
    }

    short_description = existingProduct?.short_description ?? null;
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
    stock_quantity: data.stockQuantity,
    tax_percent: data.taxPercent ?? null,
    short_description,
    description: data.description?.trim() || null,
    image_urls,
    banner_image_url,
    in_stock: data.stockQuantity > 0,
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
  const gate = await checkGroupManage("shop_products");
  if (!gate.ok) return { success: false, error: gate.error };

  const supabaseAdmin = createAdminClient();

  const { error } = await supabaseAdmin
    .from("products")
    .update({
      deleted_at: new Date().toISOString(),
      is_active: false,
      in_stock: false,
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
  const gate = await checkGroupManage("shop_products");
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
