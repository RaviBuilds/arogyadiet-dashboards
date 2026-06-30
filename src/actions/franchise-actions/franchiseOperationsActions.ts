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
  fetchRosterData,
  type PendingFailureApprovalRow,
} from "@/actions/admin-actions/operationsActions";
import {
  getRoutingData,
  commitRouteChanges,
} from "@/actions/admin-actions/routingActions";
import {
  getFixedAssignments,
  getAssignableRiders,
  searchCustomersForFixedAssignment,
  upsertFixedAssignment,
  removeFixedAssignment,
} from "@/actions/admin-actions/fixedAssignmentActions";
import {
  getLiveTrackingRiders,
  getAdminLiveTrackingData,
} from "@/actions/admin-actions/liveTrackingActions";
import {
  getRoutingSandboxMeta,
  getRoutingSandboxRiders,
  getRoutingSandboxRiderRoute,
} from "@/actions/admin-actions/routingSandboxActions";
import {
  deletePlannedOrder,
  updateOrderMeal,
  getAddressesForOrder,
  updateOrderAddress,
} from "@/actions/admin-actions/plannedActions";

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


// ───────────────────────────────────────────────────────────────────────────
// Ownership helpers for the remaining operations submenus
// ───────────────────────────────────────────────────────────────────────────

async function assertCustomerInFranchise(
  customerProfileId: string,
  franchiseId: string,
): Promise<ActionResult> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("customer_profiles")
    .select("id, franchise_id")
    .eq("id", customerProfileId)
    .maybeSingle();
  if (error) return { success: false, error: error.message };
  if (!data) return { success: false, error: "Customer not found." };
  if (data.franchise_id !== franchiseId) {
    return {
      success: false,
      error: "This customer does not belong to your franchise.",
    };
  }
  return { success: true };
}

async function assertRiderInFranchise(
  riderId: string,
  franchiseId: string,
): Promise<ActionResult> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("rider_profiles")
    .select("id, franchise_id")
    .eq("id", riderId)
    .maybeSingle();
  if (error) return { success: false, error: error.message };
  if (!data) return { success: false, error: "Rider not found." };
  if (data.franchise_id !== franchiseId) {
    return {
      success: false,
      error: "This rider does not belong to your franchise.",
    };
  }
  return { success: true };
}

// ───────────────────────────────────────────────────────────────────────────
// Planned (Tomorrow) — franchise-scoped order management
// ───────────────────────────────────────────────────────────────────────────

export async function franchiseDeletePlannedOrder(orderId: string) {
  const caller = await resolveCallerFranchiseId();
  if (!caller.success) return caller;
  const owns = await assertOrderInFranchise(orderId, caller.franchiseId);
  if (!owns.success) return owns;
  const result = await deletePlannedOrder(orderId);
  revalidatePath("/franchise/operations");
  return result;
}

export async function franchiseUpdateOrderMeal(
  orderId: string,
  mealCategoryName: string,
) {
  const caller = await resolveCallerFranchiseId();
  if (!caller.success) return caller;
  const owns = await assertOrderInFranchise(orderId, caller.franchiseId);
  if (!owns.success) return owns;
  const result = await updateOrderMeal(orderId, mealCategoryName);
  revalidatePath("/franchise/operations");
  return result;
}

export async function franchiseGetAddressesForOrder(orderId: string) {
  const caller = await resolveCallerFranchiseId();
  if (!caller.success) {
    return { success: false as const, error: caller.error };
  }
  const owns = await assertOrderInFranchise(orderId, caller.franchiseId);
  if (!owns.success) return { success: false as const, error: owns.error };
  return getAddressesForOrder(orderId);
}

export async function franchiseUpdateOrderAddress(
  orderId: string,
  addressId: string,
) {
  const caller = await resolveCallerFranchiseId();
  if (!caller.success) return caller;
  const owns = await assertOrderInFranchise(orderId, caller.franchiseId);
  if (!owns.success) return owns;
  const result = await updateOrderAddress(orderId, addressId);
  revalidatePath("/franchise/operations");
  return result;
}

// ───────────────────────────────────────────────────────────────────────────
// Live Routing — franchise-scoped board + commit
// ───────────────────────────────────────────────────────────────────────────

export async function franchiseGetRoutingData() {
  const caller = await resolveCallerFranchiseId();
  if (!caller.success) return { orders: [], riders: [] };
  return getRoutingData(caller.franchiseId);
}

export async function franchiseCommitRouteChanges(
  moves: { orderId: string; newRiderId: string | null }[],
): Promise<ActionResult> {
  const caller = await resolveCallerFranchiseId();
  if (!caller.success) return caller;

  const supabase = createAdminClient();

  // Every moved order must belong to this franchise.
  const orderIds = moves.map((m) => m.orderId);
  if (orderIds.length > 0) {
    const { data: orders, error } = await supabase
      .from("delivery_orders")
      .select("id, franchise_id")
      .in("id", orderIds);
    if (error) return { success: false, error: error.message };
    if (!orders || orders.some((o) => o.franchise_id !== caller.franchiseId)) {
      return {
        success: false,
        error: "One or more orders do not belong to your franchise.",
      };
    }
  }

  // Every target rider must belong to this franchise.
  const riderIds = [
    ...new Set(moves.map((m) => m.newRiderId).filter((id): id is string => !!id)),
  ];
  if (riderIds.length > 0) {
    const { data: riders, error } = await supabase
      .from("rider_profiles")
      .select("id, franchise_id")
      .in("id", riderIds);
    if (error) return { success: false, error: error.message };
    if (!riders || riders.some((r) => r.franchise_id !== caller.franchiseId)) {
      return {
        success: false,
        error: "One or more riders do not belong to your franchise.",
      };
    }
  }

  const result = await commitRouteChanges(moves, caller.franchiseId);
  revalidatePath("/franchise/operations");
  return result;
}

// ───────────────────────────────────────────────────────────────────────────
// Fixed Rider Assignments — franchise-scoped
// ───────────────────────────────────────────────────────────────────────────

export async function franchiseGetFixedAssignments() {
  const caller = await resolveCallerFranchiseId();
  if (!caller.success) return [];
  return getFixedAssignments(caller.franchiseId);
}

export async function franchiseGetAssignableRiders() {
  const caller = await resolveCallerFranchiseId();
  if (!caller.success) return [];
  return getAssignableRiders(caller.franchiseId);
}

export async function franchiseSearchCustomers(query: string) {
  const caller = await resolveCallerFranchiseId();
  if (!caller.success) return [];
  return searchCustomersForFixedAssignment(query, caller.franchiseId);
}

export async function franchiseUpsertFixedAssignment(
  customerProfileId: string,
  riderId: string,
  note?: string,
): Promise<ActionResult> {
  const caller = await resolveCallerFranchiseId();
  if (!caller.success) return caller;

  const customerOwned = await assertCustomerInFranchise(
    customerProfileId,
    caller.franchiseId,
  );
  if (!customerOwned.success) return customerOwned;

  const riderOwned = await assertRiderInFranchise(riderId, caller.franchiseId);
  if (!riderOwned.success) return riderOwned;

  const result = await upsertFixedAssignment(customerProfileId, riderId, note);
  revalidatePath("/franchise/operations");
  return result;
}

export async function franchiseRemoveFixedAssignment(
  id: string,
): Promise<ActionResult> {
  const caller = await resolveCallerFranchiseId();
  if (!caller.success) return caller;

  const supabase = createAdminClient();
  const { data: row, error } = await supabase
    .from("fixed_rider_assignments")
    .select("id, customer_profile_id")
    .eq("id", id)
    .maybeSingle();
  if (error) return { success: false, error: error.message };
  if (!row) return { success: false, error: "Assignment not found." };

  const owns = await assertCustomerInFranchise(
    row.customer_profile_id,
    caller.franchiseId,
  );
  if (!owns.success) return owns;

  const result = await removeFixedAssignment(id);
  revalidatePath("/franchise/operations");
  return result;
}

// ───────────────────────────────────────────────────────────────────────────
// Daily Meal Roster — franchise-scoped
// ───────────────────────────────────────────────────────────────────────────

export async function franchiseFetchRosterData(
  startDate: string,
  endDate: string,
) {
  const caller = await resolveCallerFranchiseId();
  if (!caller.success) return [];
  return fetchRosterData(startDate, endDate, caller.franchiseId);
}

// ───────────────────────────────────────────────────────────────────────────
// Live Tracking — franchise-scoped
// ───────────────────────────────────────────────────────────────────────────

export async function franchiseGetLiveTrackingRiders() {
  const caller = await resolveCallerFranchiseId();
  if (!caller.success) return [];
  return getLiveTrackingRiders(caller.franchiseId);
}

export async function franchiseGetLiveTrackingData(riderId: string) {
  const caller = await resolveCallerFranchiseId();
  if (!caller.success) return null;
  return getAdminLiveTrackingData(riderId, caller.franchiseId);
}

// ───────────────────────────────────────────────────────────────────────────
// Routing Sandbox — franchise-scoped
// ───────────────────────────────────────────────────────────────────────────

export async function franchiseGetSandboxMeta() {
  const caller = await resolveCallerFranchiseId();
  if (!caller.success) {
    return getRoutingSandboxMeta();
  }
  return getRoutingSandboxMeta(caller.franchiseId);
}

export async function franchiseGetSandboxRiders(targetDate: string) {
  const caller = await resolveCallerFranchiseId();
  if (!caller.success) return [];
  return getRoutingSandboxRiders(targetDate, caller.franchiseId);
}

export async function franchiseGetSandboxRiderRoute(
  riderId: string,
  targetDate: string,
  batchId?: string,
) {
  const caller = await resolveCallerFranchiseId();
  if (!caller.success) return null;
  return getRoutingSandboxRiderRoute(
    riderId,
    targetDate,
    batchId,
    caller.franchiseId,
  );
}
