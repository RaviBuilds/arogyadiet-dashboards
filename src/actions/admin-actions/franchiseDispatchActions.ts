"use server";

import { revalidatePath } from "next/cache";
import { getCurrentAdminContext } from "@/lib/auth/adminAccess";
import { dispatchToFranchiseInputSchema } from "@/validations/franchiseInventory";
import { dispatchToFranchise } from "@/services/franchiseInventoryEngine";
import { createAdminClient } from "@/lib/supabase/admin";

const DISPATCH_IMAGES_BUCKET = "franchise-dispatch-images";
const MAX_PACKAGE_IMAGES = 10;

type ActionResult =
  | { success: true; transferId: string }
  | { success: false; error: string };

type BulkActionResult =
  | { success: true; processed: number; totalDispatched: number }
  | { success: false; error: string; processed?: number };

export interface BulkFranchiseDispatchItem {
  dest_franchise_id: string;
  product_id: string;
  name: string;
  quantity: number;
}

/**
 * Admin action: dispatch finished-product stock from the central kitchen
 * to an active franchise. Validates destination and quantity, then delegates
 * to the dispatch RPC via the service layer.
 *
 * Requirements validated: 6.1, 6.4, 6.6, 6.7, 13.2
 */
export async function dispatchToFranchiseAction(
  formData: FormData,
): Promise<ActionResult> {
  // 1. Resolve the current user and assert admin role
  const ctx = await getCurrentAdminContext();

  if (!ctx.userId || (ctx.roleCode !== "ADMIN" && ctx.roleCode !== "MASTER_ADMIN")) {
    return { success: false, error: "Unauthorized" };
  }

  // 2. Parse and validate input
  const rawInput = {
    dest_franchise_id: formData.get("dest_franchise_id")?.toString() ?? "",
    product_id: formData.get("product_id")?.toString() ?? "",
    quantity: Number(formData.get("quantity") ?? 0),
  };

  const parsed = dispatchToFranchiseInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0].message };
  }

  // 3. Delegate to service
  const result = await dispatchToFranchise(parsed.data, ctx.userId);

  if (!result.success) {
    return { success: false, error: result.error ?? "Dispatch failed" };
  }

  // 4. Revalidate the admin inventory page
  revalidatePath("/admin/inventory");

  return { success: true, transferId: result.transferId! };
}

/**
 * Admin action: bulk dispatch finished-product stock from the central kitchen
 * to franchise destinations. Processes items sequentially via the
 * dispatch_to_franchise RPC (each item is atomic). Stops on first failure.
 *
 * Accepts FormData with:
 *   - "items": JSON string of BulkFranchiseDispatchItem[]
 *   - "packageImage-0" to "packageImage-9": optional package image files (max 10)
 *
 * Package images are uploaded to the franchise-dispatch-images bucket and
 * linked to all transfer records created in this batch.
 *
 * Used by the Operations Cart when outbound batch contains franchise items.
 */
export async function bulkDispatchToFranchiseAction(
  formData: FormData,
): Promise<BulkActionResult> {
  // 1. Resolve the current user and assert admin role
  const ctx = await getCurrentAdminContext();

  if (!ctx.userId || (ctx.roleCode !== "ADMIN" && ctx.roleCode !== "MASTER_ADMIN")) {
    return { success: false, error: "Unauthorized" };
  }

  // 2. Parse items from FormData
  const itemsJson = formData.get("items")?.toString();
  if (!itemsJson) {
    return { success: false, error: "No franchise dispatch items provided." };
  }

  let items: BulkFranchiseDispatchItem[];
  try {
    items = JSON.parse(itemsJson);
  } catch {
    return { success: false, error: "Invalid items payload." };
  }

  if (!Array.isArray(items) || items.length === 0) {
    return { success: false, error: "No franchise dispatch items provided." };
  }

  // 3. Collect package image files from FormData
  const imageFiles: File[] = [];
  for (let i = 0; i < MAX_PACKAGE_IMAGES; i++) {
    const file = formData.get(`packageImage-${i}`);
    if (file instanceof File && file.size > 0) {
      imageFiles.push(file);
    }
  }

  // 4. Process dispatches sequentially
  let processed = 0;
  let totalDispatched = 0;
  const transferIds: string[] = [];

  for (const item of items) {
    const parsed = dispatchToFranchiseInputSchema.safeParse({
      dest_franchise_id: item.dest_franchise_id,
      product_id: item.product_id,
      quantity: item.quantity,
    });

    if (!parsed.success) {
      return {
        success: false,
        processed,
        error: `${item.name}: ${parsed.error.issues[0]?.message ?? "Invalid item."}`,
      };
    }

    const result = await dispatchToFranchise(parsed.data, ctx.userId);

    if (!result.success) {
      return {
        success: false,
        processed,
        error: `${item.name}: ${result.error ?? "Dispatch to franchise failed."}`,
      };
    }

    transferIds.push(result.transferId!);
    processed += 1;
    totalDispatched += item.quantity;
  }

  // 5. Upload package images and link to all transfer records
  if (imageFiles.length > 0 && transferIds.length > 0) {
    const admin = createAdminClient();
    const uploadedPaths: string[] = [];
    const batchId = crypto.randomUUID();

    for (let i = 0; i < imageFiles.length; i++) {
      const file = imageFiles[i];
      const extension = file.name.split(".").pop() || "jpg";
      const storagePath = `${batchId}/${Date.now()}-${i}.${extension}`;

      const { error: uploadError } = await admin.storage
        .from(DISPATCH_IMAGES_BUCKET)
        .upload(storagePath, file, {
          contentType: file.type,
          upsert: false,
        });

      if (uploadError) {
        // Non-fatal: log but don't fail the entire dispatch for image issues
        console.error("Package image upload failed:", uploadError.message);
        continue;
      }

      uploadedPaths.push(storagePath);
    }

    // Link images to all transfer records in this batch
    if (uploadedPaths.length > 0) {
      for (const transferId of transferIds) {
        await admin
          .from("franchise_stock_transfers")
          .update({ package_image_paths: uploadedPaths })
          .eq("id", transferId);
      }
    }
  }

  // 6. Revalidate the admin inventory page
  revalidatePath("/admin/inventory");

  return { success: true, processed, totalDispatched };
}
