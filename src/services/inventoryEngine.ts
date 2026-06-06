import { createAdminClient } from "@/lib/supabase/admin";
import {
  INVENTORY_PRODUCT_BUCKET,
  validateInventoryProductImage,
  type AddProductInput,
  type InventoryProduct,
  mapInventoryProductRow,
} from "@/lib/inventory/product-schema";

export async function uploadInventoryProductImage(file: File): Promise<string> {
  const validationError = validateInventoryProductImage(file);
  if (validationError) {
    throw new Error(validationError);
  }

  const supabase = createAdminClient();
  const extension = file.name.split(".").pop() || "jpg";
  const filename = `${Date.now()}-${crypto.randomUUID()}.${extension}`;

  const { data, error } = await supabase.storage
    .from(INVENTORY_PRODUCT_BUCKET)
    .upload(filename, file, { cacheControl: "3600", upsert: false });

  if (error) {
    throw new Error(error.message);
  }

  return data.path;
}

export async function createInventoryProduct(
  data: AddProductInput,
): Promise<InventoryProduct> {
  const supabase = createAdminClient();

  const { data: row, error } = await supabase
    .from("inventory_products")
    .insert({
      name: data.name.trim(),
      category: data.category.trim(),
      image_url: data.imageUrl.trim(),
      type: data.type,
      base_uom: data.baseUom,
      min_stock_threshold: data.minStockThreshold,
      default_durability_days: data.defaultDurabilityDays,
    })
    .select(
      "id, name, image_url, category, type, base_uom, min_stock_threshold, default_durability_days, created_at, updated_at",
    )
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return mapInventoryProductRow(row);
}
