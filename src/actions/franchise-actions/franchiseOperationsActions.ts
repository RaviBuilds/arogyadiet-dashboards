"use server";

// Franchise-scoped wrappers around the core operations actions.
//
// These let a FRANCHISE_ADMIN perform the SAME operations the head-office admin
// performs on the Operations Control page (update order status, mark batch
// pickup, approve/reject failed deliveries) — but strictly limited to records
// belonging to the caller's own franchise.
//
// Ownership is verified against the record's franchise_id using the securely
// resolved franchise context (NOT the spoofable cookie). The underlying mutation
// logic is reused verbatim from operationsActions so behavior stays identical.

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveFranchiseContext } from "@/lib/franchise/context";
import {
  updateAdminOrderStatusAction,
  markAdminBatchPickedUpAction,
  approveFailedDeliveryAction,
  rejectFailedDeliveryAction,
  fetchPendingFailureApprovals,
  reconcileDeliveryBatchStatusesAction,
  type PendingFailureApprovalRow,
} from "@/actions/admin-actions/operationsActions";

type ActionResult = {
  success: boolean;
  error?: string;
  ordersUpdated?: number;
};

/**
 * Resolves the calling franchise admin's franchise_id from their session.
 * Rejects anyone who is not a FRANCHISE_ADMIN with an assigned franchise.
 */
async function resolveCallerFranchiseId(): Promise<
  { success: true; franchiseId: string } | { success: false; error: string }
> {
  const ctx = await resolveFranchiseContext();

  if (!ctx) {
    return { success: false, error: "Unable to resolve franchise context." };
  }
  if (ctx.role !== "FRANCHISE_ADMIN") {
    return {
      success: false,
      error: "You are not authorized to perform franchise operations.",
    };
  }
  if (!ctx.franchise_id) {
    return { success: false, error: "No franchise is assigned to your account." };
  }

  return { success: true, franchiseId: ctx.franchise_id };
}

async function assertOrderInFranchise(
  orderId: string,
  franchiseId: string,
): Promise<ActionResult> {
  const supabase = createAdminClient();
  const { data: order, error } = await supabase
    .from("delivery_orders")
    .select("id, franchise_id")
    .eq("id", orderId)
    .maybeSingle();

  if (error) return { success: false, error: error.message };
  if (!order) return { success: false, error: "Delivery order not found." };
  if (order.franchise_id !== franchiseId) {
    return {
      success: false,
      error: "This order does not belong to your franchise.",
    };
  }
  return { success: true };
}

async function assertBatchInFranchise(
  batchId: string,
  franchiseId: string,
): Promise<ActionResult> {
  if (!batchId || batchId === "UNBATCHED") {
    return { success: false, error: "Invalid batch." };
  }

  // Verify ownership via the batch's orders rather than the batch's own
  // franchise_id column. Orders are franchise-stamped at creation, and a
  // batch is rider-homogeneous, so every order in a franchise batch shares
  // the franchise. This avoids depending on the core route engine stamping
  // delivery_batches.franchise_id.
  const supabase = createAdminClient();
  const { data: orders, error } = await supabase
    .from("delivery_orders")
    .select("franchise_id")
    .eq("batch_id", batchId);

  if (error) return { success: false, error: error.message };
  if (!orders || orders.length === 0) {
    return { success: false, error: "Batch not found." };
  }
  if (!orders.every((o) => o.franchise_id === franchiseId)) {
    return {
      success: false,
      error: "This batch does not belong to your franchise.",
    };
  }
  return { success: true };
}

/**
 * Advance a delivery order to its next status (franchise-scoped).
 */
export async function franchiseUpdateOrderStatusAction(
  orderId: string,
): Promise<ActionResult> {
  const caller = await resolveCallerFranchiseId();
  if (!caller.success) return caller;

  const owns = await assertOrderInFranchise(orderId, caller.franchiseId);
  if (!owns.success) return owns;

  const result = await updateAdminOrderStatusAction(orderId);
  revalidatePath("/franchise/operations");
  return result;
}

/**
 * Mark a batch as picked up (franchise-scoped).
 */
export async function franchiseMarkBatchPickedUpAction(
  batchId: string,
  deliveryDate: string,
): Promise<ActionResult> {
  const caller = await resolveCallerFranchiseId();
  if (!caller.success) return caller;

  const owns = await assertBatchInFranchise(batchId, caller.franchiseId);
  if (!owns.success) return owns;

  const result = await markAdminBatchPickedUpAction(batchId, deliveryDate);
  revalidatePath("/franchise/operations");
  return result;
}

/**
 * Approve a rider's failed-delivery request (franchise-scoped).
 */
export async function franchiseApproveFailedDeliveryAction(
  orderId: string,
): Promise<ActionResult> {
  const caller = await resolveCallerFranchiseId();
  if (!caller.success) return caller;

  const owns = await assertOrderInFranchise(orderId, caller.franchiseId);
  if (!owns.success) return owns;

  const result = await approveFailedDeliveryAction(orderId);
  revalidatePath("/franchise/operations");
  return result;
}

/**
 * Reject a rider's failed-delivery request (franchise-scoped).
 */
export async function franchiseRejectFailedDeliveryAction(
  orderId: string,
): Promise<ActionResult> {
  const caller = await resolveCallerFranchiseId();
  if (!caller.success) return caller;

  const owns = await assertOrderInFranchise(orderId, caller.franchiseId);
  if (!owns.success) return owns;

  const result = await rejectFailedDeliveryAction(orderId);
  revalidatePath("/franchise/operations");
  return result;
}

/**
 * Reconcile batch statuses and refresh the franchise operations page.
 */
export async function revalidateFranchiseOperationsPage(): Promise<void> {
  await reconcileDeliveryBatchStatusesAction();
  revalidatePath("/franchise/operations");
}

/**
 * Fetch the failed-delivery approval requests raised by THIS franchise's riders.
 * The head-office admin never sees these (they are core-scoped on the admin page).
 */
export async function fetchFranchisePendingFailureApprovals(): Promise<
  PendingFailureApprovalRow[]
> {
  const caller = await resolveCallerFranchiseId();
  if (!caller.success) return [];

  return fetchPendingFailureApprovals(caller.franchiseId);
}
