// src/actions/admin-actions/assistedOrderActions.ts
//
// Feature: admin-place-shop-order-for-customer — ADMIN portal action wrapper.
//
// Thin `'use server'` entry points the admin assisted-order UI calls. These
// wrappers own request-scoped concerns ONLY: they resolve and enforce the
// operator's identity + scope from the authenticated session, then delegate the
// business work to the portal-agnostic `AssistedOrderService`. Module-boundary
// rules forbid importing admin-actions into the franchise portal (and vice
// versa), so both portals keep identical behavior through the shared service —
// only the resolved `OperatorContext` differs.
//
// For the admin portal the operator is always an ADMIN acting for CORE (non-
// franchise) customers:
//   - authorization uses the same operations-group model as other admin shop /
//     customer actions (`checkGroupManage("customers")`), so an admin lacking
//     that access — and any non-admin / session-less caller — is rejected with a
//     uniform authorization error before any service call (Req 8.1, 8.2, 8.5,
//     8.8);
//   - scope is always `{ kind: "CORE" }`, so the service only ever touches
//     customers with `franchise_id IS NULL` (Req 8.4, 8.6);
//   - `userId` is the resolved admin's `public.users.id`, stamped as
//     `placed_by_user_id` on the placed order (Req 6.6).
//
// Every guard is re-enforced on the server here (and again inside the service),
// independent of any client/UI restriction (Req 8.7). No exception escapes to
// the client: each action returns a discriminated `{ success }` result.
//
// Requirements: 8.1, 8.2, 8.5, 8.6, 8.7

"use server";

import {
  checkGroupManage,
  getCurrentAdminContext,
} from "@/lib/auth/adminAccess";
import {
  AssistedOrderService,
  type CustomerSearchKind,
  type CustomerSearchResult,
  type EligibilityResult,
  type OperatorContext,
  type PlaceOrderOutcome,
} from "@/services/AssistedOrderService";
import type { AssistedOrderPricing } from "@/lib/shop/assisted-order/pricing";
import type { CartLine } from "@/lib/shop/assisted-order/core";
import type { WalkInCustomerInput } from "@/lib/shop/assisted-order/walkin";
import type { ShopOrderDiscount } from "@/lib/pricing/inclusive-tax";
import { revalidatePath } from "next/cache";

// ---------------------------------------------------------------------------
// Action result shape (consistent with existing admin/shop action conventions)
// ---------------------------------------------------------------------------

export type AssistedOrderActionResult<T> =
  | { success: true; data: T }
  | { success: false; error: string };

/** Uniform authorization-denied response (Req 8.1, 8.2, 8.8). */
const UNAUTHORIZED_ERROR =
  "You do not have permission to perform this action.";

// ---------------------------------------------------------------------------
// Operator context resolution + authorization (server-side, never trusted from
// the client — Req 8.5, 8.7)
// ---------------------------------------------------------------------------

/**
 * Resolve the admin `OperatorContext` from the authenticated session and enforce
 * authorization before any service call.
 *
 * Authorization mirrors other admin customer/shop actions: the caller must be an
 * ADMIN (or MASTER_ADMIN) with manage access to the "customers" operations
 * group. A non-admin, an admin lacking that access, and a session-less request
 * are all rejected with the same authorization-denied response and NO service
 * call is made (Req 8.1, 8.2, 8.8). The resolved scope is always CORE (Req 8.4).
 */
async function resolveAdminOperatorContext(): Promise<
  { ok: true; ctx: OperatorContext } | { ok: false; error: string }
> {
  // Enforce operations-group access first (covers non-admin, view-only admin,
  // and no-session — all mapped to a denial). Reject before any service call.
  const gate = await checkGroupManage("customers");
  if (!gate.ok) {
    return { ok: false, error: gate.error };
  }

  // Resolve the operator identity for audit stamping (Req 6.6). Defense in
  // depth: a passing gate implies an authenticated admin, but guard against a
  // missing user id rather than proceeding without an operator identity.
  const { userId } = await getCurrentAdminContext();
  if (!userId) {
    return { ok: false, error: UNAUTHORIZED_ERROR };
  }

  return {
    ok: true,
    ctx: {
      userId,
      role: "ADMIN",
      scope: { kind: "CORE" },
    },
  };
}

// ---------------------------------------------------------------------------
// Server actions
// ---------------------------------------------------------------------------

/**
 * Search core customers by mobile number or name, scoped to the admin (CORE).
 * Delegates to {@link AssistedOrderService.searchCustomers} (Req 2).
 */
export async function searchCustomersAction(
  query: string,
  kind: CustomerSearchKind,
): Promise<AssistedOrderActionResult<CustomerSearchResult[]>> {
  const resolved = await resolveAdminOperatorContext();
  if (!resolved.ok) {
    return { success: false, error: resolved.error };
  }

  const service = new AssistedOrderService();
  const result = await service.searchCustomers(resolved.ctx, query, kind);
  if (!result.ok) {
    return { success: false, error: result.error };
  }
  return { success: true, data: result.value };
}

/**
 * Re-evaluate a target customer's eligibility at selection time, scoped to the
 * admin (CORE). Delegates to {@link AssistedOrderService.checkEligibility}
 * (Req 3.5, 3.6).
 */
export async function checkEligibilityAction(
  customerProfileId: string,
): Promise<AssistedOrderActionResult<EligibilityResult>> {
  const resolved = await resolveAdminOperatorContext();
  if (!resolved.ok) {
    return { success: false, error: resolved.error };
  }

  const service = new AssistedOrderService();
  const eligibility = await service.checkEligibility(
    resolved.ctx,
    customerProfileId,
  );
  return { success: true, data: eligibility };
}

/**
 * Price the operator-built cart using the customer-checkout breakdown with the
 * delivery fee forced to 0. Delegates to
 * {@link AssistedOrderService.priceCart} (Req 4).
 */
export async function priceCartAction(
  cart: CartLine[],
  discount?: ShopOrderDiscount,
): Promise<AssistedOrderActionResult<AssistedOrderPricing>> {
  const resolved = await resolveAdminOperatorContext();
  if (!resolved.ok) {
    return { success: false, error: resolved.error };
  }

  const service = new AssistedOrderService();
  const result = await service.priceCart(resolved.ctx, cart, discount);
  if (!result.ok) {
    return { success: false, error: result.error };
  }
  return { success: true, data: result.value };
}

/**
 * Mark the order PAID (the explicit manual Mark_Paid_Action — there is no online
 * charge) and place it. The PAID payment status gates placement (Req 5.2, 5.7);
 * this wrapper records that the operator marked the order paid and delegates to
 * {@link AssistedOrderService.placeOrder} with `paymentStatus = "PAID"`. The
 * service creates the MANUAL/PAID payment atomically with the order and gates
 * placement on that status server-side (Req 5.3, 5.6, 6.x).
 */
export async function markPaidAndPlaceOrderAction(
  cart: CartLine[],
  customerProfileId: string,
  discount?: ShopOrderDiscount,
  clinicPickup: boolean = false,
): Promise<AssistedOrderActionResult<PlaceOrderOutcome>> {
  const resolved = await resolveAdminOperatorContext();
  if (!resolved.ok) {
    return { success: false, error: resolved.error };
  }

  // The explicit Mark_Paid_Action: the operator marks the order PAID (no online
  // payment). Placement is gated on this PAID status, which the service records
  // as a MANUAL/PAID payment atomically with the order (Req 5.3, 5.6, 5.7).
  // When `clinicPickup` is set, the order is created already DELIVERED (clinic
  // pickup) and never enters routing.
  const paymentStatus = "PAID";

  const service = new AssistedOrderService();
  const result = await service.placeOrder(
    resolved.ctx,
    cart,
    customerProfileId,
    paymentStatus,
    discount,
    clinicPickup,
  );
  if (!result.ok) {
    return { success: false, error: result.error };
  }

  revalidatePath("/admin/customers/shop-orders");
  revalidatePath("/admin/operations");
  return { success: true, data: result.value };
}

/**
 * Mark PAID and place a WALK-IN shop order — a counter sale to a buyer who has
 * no customer profile (they purchased only a shop product, with no meal / kit /
 * accommodation subscription).
 *
 * Same authorization and PAID gating as {@link markPaidAndPlaceOrderAction}; the
 * buyer is identified by the recorded name (plus an optional mobile and address)
 * instead of a `customer_profile_id`, so every unit that leaves shop stock still
 * has exactly one auditable order behind it. The service validates the buyer
 * details server-side and creates the sale already delivered (counter handover),
 * so it never enters delivery routing.
 */
export async function markPaidAndPlaceWalkInOrderAction(
  cart: CartLine[],
  walkIn: WalkInCustomerInput,
  discount?: ShopOrderDiscount,
): Promise<AssistedOrderActionResult<PlaceOrderOutcome>> {
  const resolved = await resolveAdminOperatorContext();
  if (!resolved.ok) {
    return { success: false, error: resolved.error };
  }

  const service = new AssistedOrderService();
  const result = await service.placeWalkInOrder(
    resolved.ctx,
    cart,
    walkIn,
    "PAID",
    discount,
  );
  if (!result.ok) {
    return { success: false, error: result.error };
  }

  revalidatePath("/admin/customers/shop-orders");
  revalidatePath("/admin/operations");
  return { success: true, data: result.value };
}
