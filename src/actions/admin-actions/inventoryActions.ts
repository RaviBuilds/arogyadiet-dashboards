"use server";

import { createAdminClient } from "@/lib/supabase/admin";
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
  is_active: boolean;
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
  shortDescription: z.string().optional(),
  description: z.string().optional(),
  imageUrls: z.string().optional(),
});

type ActionResult = { success: boolean; error?: string };

const INVENTORY_PATH = "/admin/kitchen-shop/inventory";

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

  const { data, error } = await supabase
    .from("products")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Error fetching products:", error);
    return [];
  }

  return (data ?? []) as AdminInventoryProduct[];
}

export async function adminUpsertProduct(
  formData: FormData,
): Promise<ActionResult> {
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
    shortDescription: getFormString(formData, "shortDescription") || undefined,
    description: getFormString(formData, "description") || undefined,
    imageUrls: getFormString(formData, "imageUrls") || undefined,
  });

  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0].message };
  }

  const data = parsed.data;
  const supabaseAdmin = createAdminClient();

  const image_urls = (data.imageUrls ?? "")
    .split(",")
    .map((url) => url.trim())
    .filter(Boolean);

  const files = getFormFiles(formData);

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

    image_urls.push(publicUrl);
  }

  const record: Record<string, unknown> = {
    name: data.name,
    sku: data.sku,
    category: data.category?.trim() || null,
    original_price: data.originalPrice,
    sale_price: data.salePrice ?? null,
    stock_quantity: data.stockQuantity,
    tax_percent: data.taxPercent ?? null,
    short_description: data.shortDescription?.trim() || null,
    description: data.description?.trim() || null,
    image_urls,
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
  return { success: true };
}

export async function adminDeleteProduct(id: string): Promise<ActionResult> {
  const supabaseAdmin = createAdminClient();

  const { error } = await supabaseAdmin.from("products").delete().eq("id", id);

  if (error) {
    console.error("Error deleting product:", error);
    return { success: false, error: error.message };
  }

  revalidatePath(INVENTORY_PATH);
  return { success: true };
}

export async function adminToggleProductVisibility(
  id: string,
  currentStatus: boolean,
): Promise<ActionResult> {
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
  return { success: true };
}
