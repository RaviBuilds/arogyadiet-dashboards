"use server";

// Franchise-portal assisted shop-order actions.
//
// Feature: admin-place-shop-order-for-customer (task 8.2).
//
// These are the thin, franchise-portal action wrappers over the shared,
// portal-agnostic `AssistedOrderService`. Module boundaries forbid importing
// admin-actions into the franchise portal, so both portals delegate to the same
// service; this wrapper's only job is to resolve and enforce the operator's
// context on the server, then delegate.
//
// Every action:
//   1. Resolves an `OperatorContext` from the authenticated session via
//      `resolveFranchiseContext()` — the client never supplies role, franchise,
//      or scope (Req 8.7).
//   2. Requires the caller to be a `FRANCHISE_ADMIN` with a non-null
//      `franchise_id`; anyone else is rejected before any service call / DB
//      write (Req 8.1, 8.8), with scope `{ kind: "FRANCHISE", franchiseId }`
//      (Req 7.2, 8.3).
//   3. Delegates to `AssistedOrderService`, which re-enforces authorization and
//      scope server-side (Req 8.6, 8.7).
//
// Requirements validated: 7.1, 7.2, 8.3, 8.6, 8.7.

import { resolveFranchiseContext } from "@/lib/franchise/context";
import { createClient } from "@/lib/supabase/server";
import {
  AssistedOrderService,
  type CustomerSearchKind,
  type CustomerSearchResult,
  type EligibilityResult,
  type OperatorContext,
  type PlaceOrderOutcome,
} from "@/services/AssistedOrderService";
import { PAID_STATUS, type CartLine } from "@/lib/shop/assisted-order/core";
import type { AssistedOrderPricing } from "@/lib/shop/assisted-order/pricing";
import type { ShopOrderDiscount } from "@/lib/pricing/inclusive-tax";
import type { ActionResult } from "@/types/franchise";

const UNAUTHORIZED_ERROR =
  "You are not authorized to place assisted shop orders.";

/**
 * Resolve the server-trusted `OperatorContext` for a franchise operator.
 *
 * Only a `FRANCHISE_ADMIN` with an assigned (non-null) `franchise_id` is
 * authorized. Any other caller — no session, a non-franchise role, or a
 * `FRANCHISE_ADMIN` without an assigned franchise — is denied with the same
 * uniform authorization error and NO service call is made (Req 8.1, 8.8).
 *
 * The scope is always `{ kind: "FRANCHISE", franchiseId }` (Req 7.2, 8.3); the
 * `userId` is the caller's `public.users.id`, persisted as `placed_by_user_id`
 * on the addon order for audit (Req 6.6).
 */
async function resolveFranchiseOperatorContext(): Promise<
  { ok: true; ctx: OperatorContext } | { ok: false; error: string }
> {
  const franchiseContext = await resolveFranchiseContext();

  if (
    !franchiseContext ||
    franchiseContext.role !== "FRANCHISE_ADMIN" ||
    !franchiseContext.franchise_id
  ) {
    return { ok: false, error: UNAUTHORIZED_ERROR };
  }

  // Resolve the caller's internal user id from the authenticated session.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, error: UNAUTHORIZED_ERROR };
  }

  const { data: userRecord } = await supabase
    .from("users")
    .select("id")
    .eq("auth_user_id", user.id)
    .single();

  if (!userRecord?.id) {
    return { ok: false, error: UNAUTHORIZED_ERROR };
  }

  return {
    ok: true,
    ctx: {
      userId: userRecord.id,
      role: "FRANCHISE_ADMIN",
      scope: { kind: "FRANCHISE", franchiseId: franchiseContext.franchise_id },
    },
  };
}

/**
 * Search customers by mobile number or name, scoped to the operator's franchise
 * (Req 2, 8.3). Unauthorized callers are rejected before any lookup (Req 8.1).
 */
export async function searchCustomersAction(
  query: string,
  kind: CustomerSearchKind,
): Promise<ActionResult<CustomerSearchResult[]>> {
  const resolved = await resolveFranchiseOperatorContext();
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
 * Re-evaluate a target customer's eligibility at selection time (Req 3.5, 3.6).
 * Enforces franchise scope (out-of-scope customers report ineligible; Req 8.3).
 */
export async function checkEligibilityAction(
  customerProfileId: string,
): Promise<ActionResult<EligibilityResult>> {
  const resolved = await resolveFranchiseOperatorContext();
  if (!resolved.ok) {
    return { success: false, error: resolved.error };
  }

  const service = new AssistedOrderService();
  const result = await service.checkEligibility(resolved.ctx, customerProfileId);

  return { success: true, data: result };
}

/**
 * Price the operator-built cart using the customer-checkout breakdown with the
 * delivery fee forced to 0 (Req 4). Unauthorized callers are rejected first.
 */
export async function priceCartAction(
  cart: CartLine[],
  discount?: ShopOrderDiscount,
): Promise<ActionResult<AssistedOrderPricing>> {
  const resolved = await resolveFranchiseOperatorContext();
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
 * Mark the order paid and place it (Req 5, 6, 7). Marking paid records a
 * MANUAL/PAID payment atomically inside the placement RPC, so this action gates
 * placement by passing the PAID status to the service (Req 5.7). The service
 * re-enforces authorization, scope, eligibility, and pricing server-side
 * (Req 8.6, 8.7). Unauthorized callers are rejected before any write (Req 8.1).
 */
export async function markPaidAndPlaceOrderAction(
  cart: CartLine[],
  customerProfileId: string,
  discount?: ShopOrderDiscount,
  clinicPickup: boolean = false,
): Promise<ActionResult<PlaceOrderOutcome>> {
  const resolved = await resolveFranchiseOperatorContext();
  if (!resolved.ok) {
    return { success: false, error: resolved.error };
  }

  const service = new AssistedOrderService();
  const result = await service.placeOrder(
    resolved.ctx,
    cart,
    customerProfileId,
    PAID_STATUS,
    discount,
    clinicPickup,
  );

  if (!result.ok) {
    return { success: false, error: result.error };
  }
  return { success: true, data: result.value };
}
