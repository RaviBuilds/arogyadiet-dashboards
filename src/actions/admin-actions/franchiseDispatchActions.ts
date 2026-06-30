"use server";

import { revalidatePath } from "next/cache";
import { getCurrentAdminContext } from "@/lib/auth/adminAccess";
import { dispatchToFranchiseInputSchema } from "@/validations/franchiseInventory";
import { dispatchToFranchise } from "@/services/franchiseInventoryEngine";

type ActionResult =
  | { success: true; transferId: string }
  | { success: false; error: string };

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
