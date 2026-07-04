"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { logAdminAction } from "@/lib/logger";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { KitProduct, KitProductRow } from "@/types/kitProduct";
import { transformKitProductRow } from "@/types/kitProduct";

/**
 * KIT Product Management Actions
 * 
 * Server actions for managing KIT products (ready-to-eat meal packages).
 * KIT products are one-time purchase items separate from recurring meal subscriptions.
 * 
 * Requirements: 1.3, 1.5, 9.1
 * Task: 3.2
 */

type ActionResult<T = void> = { success: true; data?: T } | { success: false; error: string };

// Validation schema for KIT product creation
const createKitProductSchema = z.object({
  name: z.string().min(1, "Product name is required").max(100, "Product name must be 100 characters or less"),
  price: z.number().positive("Price must be greater than 0").max(1000000, "Price exceeds maximum allowed value"),
});

/**
 * Create a new KIT product with server-side validation
 * 
 * Requirements: 1.3, 9.1
 * 
 * @param name - The name of the KIT product
 * @param price - The base price of the KIT product
 * @returns Action result with created product data or error message
 */
export async function createKitProductAction(
  name: string,
  price: number,
): Promise<ActionResult<KitProduct>> {
  // Server-side validation
  const parsed = createKitProductSchema.safeParse({ name, price });
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0].message,
    };
  }

  try {
    const supabase = createAdminClient();

    // Insert new KIT product with default 5% tax rate
    const { data, error } = await supabase
      .from("kit_products")
      .insert({
        name: parsed.data.name,
        base_price: parsed.data.price,
        tax_rate: 0.05,
        is_active: true,
      })
      .select()
      .single();

    if (error) {
      console.error("createKitProductAction database error:", error);
      return {
        success: false,
        error: "Failed to create KIT product. Please try again.",
      };
    }

    if (!data) {
      return {
        success: false,
        error: "Failed to retrieve created product data.",
      };
    }

    // Transform database row to KitProduct type
    const product = transformKitProductRow(data as KitProductRow);

    // Log admin action
    await logAdminAction("CREATE", "kit_products", product.id, {
      name: product.name,
      base_price: product.base_price,
    });

    // Revalidate relevant paths
    revalidatePath("/admin/subscriptions/kits");
    revalidatePath("/admin/customers/quick-onboard");

    return {
      success: true,
      data: product,
    };
  } catch (error) {
    console.error("createKitProductAction unexpected error:", error);
    return {
      success: false,
      error: "An unexpected error occurred while creating the product.",
    };
  }
}

/**
 * List all active KIT products for admin views
 * 
 * Requirements: 1.3, 2.2
 * 
 * @returns Array of active KIT products ordered by name
 */
export async function listKitProductsAction(): Promise<ActionResult<KitProduct[]>> {
  try {
    const supabase = createAdminClient();

    const { data, error } = await supabase
      .from("kit_products")
      .select("*")
      .eq("is_active", true)
      .order("name", { ascending: true });

    if (error) {
      console.error("listKitProductsAction database error:", error);
      return {
        success: false,
        error: "Failed to fetch KIT products.",
      };
    }

    // Transform database rows to KitProduct types
    const products = (data ?? []).map((row) => 
      transformKitProductRow(row as KitProductRow)
    );

    return {
      success: true,
      data: products,
    };
  } catch (error) {
    console.error("listKitProductsAction unexpected error:", error);
    return {
      success: false,
      error: "An unexpected error occurred while fetching products.",
    };
  }
}


/**
 * Update an existing KIT product
 * 
 * @param id - The KIT product UUID
 * @param name - Updated product name
 * @param price - Updated base price
 * @returns Action result
 */
export async function updateKitProductAction(
  id: string,
  name: string,
  price: number,
): Promise<ActionResult<KitProduct>> {
  const parsed = createKitProductSchema.safeParse({ name, price });
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0].message };
  }

  try {
    const supabase = createAdminClient();

    const { data, error } = await supabase
      .from("kit_products")
      .update({
        name: parsed.data.name,
        base_price: parsed.data.price,
      })
      .eq("id", id)
      .select()
      .single();

    if (error) {
      console.error("updateKitProductAction database error:", error);
      return { success: false, error: "Failed to update KIT product. Please try again." };
    }

    const product = transformKitProductRow(data as KitProductRow);

    await logAdminAction("UPDATE", "kit_products", product.id, {
      name: product.name,
      base_price: product.base_price,
    });

    revalidatePath("/admin/subscriptions/kits");
    revalidatePath("/admin/customers/quick-onboard");

    return { success: true, data: product };
  } catch (error) {
    console.error("updateKitProductAction unexpected error:", error);
    return { success: false, error: "An unexpected error occurred while updating the product." };
  }
}

/**
 * Soft-delete a KIT product (sets is_active = false)
 * 
 * @param id - The KIT product UUID
 * @returns Action result
 */
export async function deleteKitProductAction(
  id: string,
): Promise<ActionResult> {
  if (!id) {
    return { success: false, error: "Product ID is required." };
  }

  try {
    const supabase = createAdminClient();

    const { error } = await supabase
      .from("kit_products")
      .update({ is_active: false })
      .eq("id", id);

    if (error) {
      console.error("deleteKitProductAction database error:", error);
      return { success: false, error: "Failed to delete KIT product. Please try again." };
    }

    await logAdminAction("DELETE", "kit_products", id, { soft_delete: true });

    revalidatePath("/admin/subscriptions/kits");
    revalidatePath("/admin/customers/quick-onboard");

    return { success: true };
  } catch (error) {
    console.error("deleteKitProductAction unexpected error:", error);
    return { success: false, error: "An unexpected error occurred while deleting the product." };
  }
}
