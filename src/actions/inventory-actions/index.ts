"use server";

import { revalidatePath } from "next/cache";

import {
  parseAddProductFormData,
  validateInventoryProductImage,
} from "@/lib/inventory/product-schema";
import {
  createInventoryProduct,
  uploadInventoryProductImage,
} from "@/services/inventoryEngine";

const INVENTORY_PATH = "/admin/inventory";

type AddProductResult =
  | { success: true; productId: string }
  | { success: false; error: string };

export async function addProductAction(
  formData: FormData,
): Promise<AddProductResult> {
  const file = formData.get("image");

  if (!(file instanceof File)) {
    return { success: false, error: "Product image is required." };
  }

  const imageValidationError = validateInventoryProductImage(file);
  if (imageValidationError) {
    return { success: false, error: imageValidationError };
  }

  const parsed = parseAddProductFormData(formData);
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message ?? "Invalid product data.",
    };
  }

  try {
    const imagePath = await uploadInventoryProductImage(file);
    const product = await createInventoryProduct({
      ...parsed.data,
      imageUrl: imagePath,
    });
    revalidatePath(INVENTORY_PATH);
    return { success: true, productId: product.id };
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Failed to register product.";
    return { success: false, error: message };
  }
}
