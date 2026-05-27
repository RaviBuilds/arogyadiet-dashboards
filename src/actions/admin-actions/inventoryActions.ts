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

export type UpsertProductPayload = z.infer<typeof upsertProductSchema>;

type ActionResult = { success: boolean; error?: string };

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
  payload: UpsertProductPayload,
): Promise<ActionResult> {
  const parsed = upsertProductSchema.safeParse(payload);

  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0].message };
  }

  const data = parsed.data;
  const supabase = createAdminClient();

  const image_urls = (data.imageUrls ?? "")
    .split(",")
    .map((url) => url.trim())
    .filter(Boolean);

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

  const { error } = await supabase
    .from("products")
    .upsert(record, { onConflict: "id" });

  if (error) {
    console.error("Error upserting product:", error);
    return { success: false, error: error.message };
  }

  revalidatePath("/admin/kitchen-shop/inventory");
  return { success: true };
}
