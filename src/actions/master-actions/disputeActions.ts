"use server";

// Master-portal dispute actions.
//
// These server actions handle the master admin's dispute management operations:
// updating dispute status with mandatory comments through the linear state
// machine (Open → Under_Investigation → Solved).
//
// Each action resolves the caller's Scope via the shared Scope_Resolver,
// requires full_network (MASTER_ADMIN) access, validates input with Zod,
// checks valid state transitions, delegates to the repository layer, and
// revalidates the disputes route on mutation.
//
// (franchise-dispute-management spec — Task 3.2)
// Requirements validated: 8.1, 8.2, 8.3, 8.4, 8.5, 8.7, 9.2, 9.6

import { revalidatePath } from "next/cache";
import { resolveScope } from "@/lib/auth/scope-resolver";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  updateDisputeStatusSchema,
  isValidTransition,
} from "@/validations/disputeSchema";
import { updateDisputeStatus } from "@/repositories/disputeRepository";
import type { ActionResult } from "@/types/franchise";
import type { DisputeStatus } from "@/validations/disputeSchema";

// ---------------------------------------------------------------------------
// updateDisputeStatusAction
// ---------------------------------------------------------------------------

/**
 * Updates a dispute's status with a required comment. Master Admin only.
 *
 * Flow:
 * 1. Resolve scope — require full_network (MASTER_ADMIN)
 * 2. Validate input with Zod (dispute_id, status, comment)
 * 3. Fetch the current dispute to get its current status
 * 4. Validate that the transition is permitted (linear state machine)
 * 5. Update via repository
 * 6. Revalidate disputes path
 *
 * Req 8.1, 8.2, 8.3, 8.4, 8.5, 8.7, 9.2, 9.6
 */
export async function updateDisputeStatusAction(
  formData: FormData
): Promise<ActionResult<{ id: string }>> {
  // 1. Resolve scope — reject non-master-admin callers
  const scopeResult = await resolveScope();
  if (!scopeResult.ok) {
    return {
      success: false,
      error:
        scopeResult.reason === "no_franchise"
          ? "Unauthorized. Please log in."
          : "Unauthorized. Please log in.",
    };
  }

  const { scope } = scopeResult;

  // Only full_network (MASTER_ADMIN / ADMIN) can update dispute status
  if (scope.kind !== "full_network") {
    return {
      success: false,
      error: "Insufficient permissions. Master Admin access required.",
    };
  }

  // 2. Extract and validate form data with Zod schema
  const raw = {
    dispute_id: formData.get("dispute_id") as string,
    status: formData.get("status") as string,
    comment: formData.get("comment") as string,
  };

  const parsed = updateDisputeStatusSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return {
      success: false,
      error: issue?.message ?? "Invalid input.",
      field: issue?.path[0]?.toString(),
    };
  }

  const { dispute_id, status, comment } = parsed.data;

  // 3. Fetch the current dispute to verify the transition is valid
  const admin = createAdminClient();
  const { data: currentDispute, error: fetchError } = await admin
    .from("franchise_disputes")
    .select("status")
    .eq("id", dispute_id)
    .single();

  if (fetchError || !currentDispute) {
    return {
      success: false,
      error: "Dispute not found.",
    };
  }

  // 4. Validate the status transition
  const currentStatus = currentDispute.status as DisputeStatus;
  if (!isValidTransition(currentStatus, status)) {
    return {
      success: false,
      error: "This status transition is not permitted.",
    };
  }

  // 5. Update dispute status via repository
  try {
    await updateDisputeStatus(dispute_id, status, comment);
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Could not update dispute status. Please try again.",
    };
  }

  // 6. Revalidate the disputes page
  revalidatePath("/disputes");

  return { success: true, data: { id: dispute_id } };
}
