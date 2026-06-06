import { z } from "zod";

export const PRODUCT_TYPES = ["RAW_MATERIAL", "FINISHED_GOOD"] as const;
export const BASE_UOMS = ["KG", "LITRE", "UNIT"] as const;

export const INVENTORY_PRODUCT_BUCKET = "inventory-product";
export const MAX_IMAGE_SIZE_BYTES = 1_048_576;
export const ALLOWED_IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
] as const;

export type ProductType = (typeof PRODUCT_TYPES)[number];
export type BaseUom = (typeof BASE_UOMS)[number];
export type AllowedImageType = (typeof ALLOWED_IMAGE_TYPES)[number];

export const addProductFormSchema = z.object({
  name: z
    .string()
    .min(1, "Product name is required")
    .max(255, "Name must be 255 characters or less"),
  category: z
    .string()
    .min(1, "Category is required")
    .max(100, "Category must be 100 characters or less"),
  type: z.enum(PRODUCT_TYPES, {
    message: "Product type is required",
  }),
  baseUom: z.enum(BASE_UOMS, {
    message: "Base unit of measure is required",
  }),
  minStockThreshold: z
    .number()
    .min(0, "Minimum stock threshold must be 0 or greater"),
  defaultDurabilityDays: z
    .number()
    .int("Durability must be a whole number")
    .min(0, "Durability must be 0 or greater"),
});

export type AddProductFormValues = z.infer<typeof addProductFormSchema>;

export const addProductSchema = addProductFormSchema.extend({
  imageUrl: z
    .string()
    .min(1, "Product image is required")
    .max(512, "Image path must be 512 characters or less"),
});

export type AddProductInput = z.infer<typeof addProductSchema>;

export type InventoryProduct = {
  id: string;
  name: string;
  imageUrl: string | null;
  category: string;
  type: ProductType;
  baseUom: BaseUom;
  minStockThreshold: number;
  defaultDurabilityDays: number;
  createdAt: string;
  updatedAt: string;
};

type InventoryProductRow = {
  id: string;
  name: string;
  image_url: string | null;
  category: string;
  type: ProductType;
  base_uom: BaseUom;
  min_stock_threshold: string | number;
  default_durability_days: number;
  created_at: string;
  updated_at: string;
};

function getFormString(formData: FormData, key: string): string {
  const value = formData.get(key);
  return value?.toString().trim() ?? "";
}

export function validateInventoryProductImage(file: File): string | null {
  if (!(file instanceof File) || file.size === 0) {
    return "Product image is required.";
  }

  if (file.size > MAX_IMAGE_SIZE_BYTES) {
    return "Image must be 1 MB or smaller.";
  }

  if (!ALLOWED_IMAGE_TYPES.includes(file.type as AllowedImageType)) {
    return "Image must be JPEG, PNG, WebP, or GIF.";
  }

  return null;
}

const addProductFormDataSchema = addProductFormSchema.extend({
  minStockThreshold: z.coerce
    .number()
    .min(0, "Minimum stock threshold must be 0 or greater"),
  defaultDurabilityDays: z.coerce
    .number()
    .int("Durability must be a whole number")
    .min(0, "Durability must be 0 or greater"),
});

export function parseAddProductFormData(formData: FormData) {
  return addProductFormDataSchema.safeParse({
    name: getFormString(formData, "name"),
    category: getFormString(formData, "category"),
    type: getFormString(formData, "type"),
    baseUom: getFormString(formData, "baseUom"),
    minStockThreshold: getFormString(formData, "minStockThreshold"),
    defaultDurabilityDays: getFormString(formData, "defaultDurabilityDays"),
  });
}

export function mapInventoryProductRow(
  row: InventoryProductRow,
): InventoryProduct {
  return {
    id: row.id,
    name: row.name,
    imageUrl: row.image_url,
    category: row.category,
    type: row.type,
    baseUom: row.base_uom,
    minStockThreshold: Number(row.min_stock_threshold),
    defaultDurabilityDays: row.default_durability_days,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
