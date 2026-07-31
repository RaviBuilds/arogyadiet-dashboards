// src/services/AssistedOrderService.ts
//
// Feature: admin-place-shop-order-for-customer.
//
// Server-side orchestration for the assisted (admin / franchise) shop-order
// flow. This service is portal-agnostic: it uses `createAdminClient`
// (service-role) and takes an already-resolved, server-trusted
// `OperatorContext`. The thin per-portal action wrappers (admin / franchise)
// resolve and enforce the operator context from the authenticated session and
// delegate to this service — module boundaries forbid cross-portal imports, so
// this single shared service keeps behavior identical across both portals.
//
// It REUSES the proven building blocks rather than re-implementing them:
//   - pure decision logic (`src/lib/shop/assisted-order/core.ts`):
//     `validateSearchQuery`, `isCustomerEligible`, `isTargetInScope`,
//   - the pricing adapter (`src/lib/shop/assisted-order/pricing.ts`):
//     `buildPricedLines`, `computeAssistedOrderPricing`,
//   - the catalog resolution helpers (`src/lib/products/catalog-queries.ts`):
//     `fetchProductForCheckout`, `isProductUnavailable`,
//   - the IST "today" basis (`getISTDateString`).
//
// This file implements `searchCustomers`, `checkEligibility`, `priceCart`
// (task 5.1) and `placeOrder` (task 6.3). `placeOrder` additionally reuses the
// target-delivery-date resolver (`resolveTargetDeliveryDate`), the atomic
// `place_assisted_addon_order` RPC, the franchise-stock failsafe
// (`evaluateFranchiseStockOutcome` / `decrement_franchise_product_stock`), the
// linking flow (`runProductLinkingAction`), and admin notifications
// (`notifyAdmins`).
//
// Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 3.5, 3.6, 4.1, 4.2,
//               4.3, 4.4, 4.5, 4.6, 5.1, 5.3, 5.6, 6.1, 6.2, 6.3, 6.4, 6.5,
//               6.6, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 8.3, 8.4

import type { SupabaseClient } from "@supabase/supabase-js";

import { createAdminClient } from "@/lib/supabase/admin";
import { getISTDateString } from "@/lib/dates/ist";
import {
  fetchProductForCheckout,
  isProductUnavailable,
} from "@/lib/products/catalog-queries";
import {
  canPlaceOrder,
  isCustomerEligible,
  isTargetInScope,
  validateSearchQuery,
  type CartLine,
  type OperatorRole,
  type OperatorScope,
} from "@/lib/shop/assisted-order/core";
import {
  buildPricedLines,
  computeAssistedOrderPricing,
  type AssistedCatalogProduct,
  type AssistedOrderPricing,
  type PricedLine,
} from "@/lib/shop/assisted-order/pricing";
import { resolveTargetDeliveryDate } from "@/lib/shop/assisted-order/delivery-date";
import {
  validateWalkInCustomer,
  type WalkInCustomerInput,
} from "@/lib/shop/assisted-order/walkin";
import {
  evaluateFranchiseStockOutcome,
  UNFULFILLABLE_STOCK_STATUS,
  type ItemDecrementResult,
} from "@/lib/shop/franchiseStockFailsafe";
import { runProductLinkingAction } from "@/actions/admin-actions/systemActions";
import { notifyAdmins, buildPushPayload } from "@/lib/notifications";
import type { ShopOrderDiscount } from "@/lib/pricing/inclusive-tax";
import { listClinicOverlays } from "@/repositories/clinic/clinicProductRepository";
import {
  resolveEffectiveOverlay,
  evaluateSaleSubmission,
} from "@/lib/shop/clinicStock";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * The server-trusted operator identity + scope. Resolved from the authenticated
 * session by the per-portal action wrapper and passed to every service method;
 * the client never supplies role, franchise, or scope.
 */
export type OperatorContext = {
  /** `public.users.id` — persisted as `placed_by_user_id` on the addon order. */
  userId: string;
  role: OperatorRole;
  scope: OperatorScope;
};

/** The kind of customer search the operator submitted. */
export type CustomerSearchKind = "MOBILE" | "NAME";

/** A single shaped customer search result presented to the operator (Req 2.4). */
export type CustomerSearchResult = {
  customerProfileId: string;
  fullName: string;
  mobile: string;
  /** Req 3: has an ACTIVE subscription whose Effective_End_Date > today (IST). */
  eligible: boolean;
  /** e.g. "No active subscription", "Expiring today". */
  ineligibleReason?: string;
};

/** Generic discriminated result used by the service methods that can fail. */
export type Result<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

/** The successful outcome of a placement (Req 6.1, 7.5). */
export type PlaceOrderOutcome = {
  /** The id of the newly created `addon_orders` row. */
  addonOrderId: string;
  /**
   * `true` when a franchise stock decrement could not be honored for one or more
   * items, so the order was flagged `UNFULFILLABLE_STOCK` (it stays PAID). Always
   * `false` for a core (non-franchise) order. See Req 7.5.
   */
  unfulfillable: boolean;
  /**
   * The resolved delivery day the order will ride along with — the customer's
   * earliest upcoming non-paused active day (ISO `YYYY-MM-DD`). Surfaced so the
   * operator can be shown the concrete dispatch date on confirmation (Req 6.2).
   * For a clinic pickup this is the pickup date (today).
   */
  targetDeliveryDate: string;
  /**
   * `true` when the order was placed as a clinic pickup — created already
   * DELIVERED (fulfillment `CLINIC_PICKUP`) and excluded from routing.
   */
  clinicPickup: boolean;
  /**
   * `true` when the order was sold to a walk-in (non-subscriber) buyer recorded
   * by name on the order itself instead of a `customer_profile_id`. A walk-in
   * sale is always an immediate counter handover, so `clinicPickup` is also
   * `true` and the order never enters routing.
   */
  walkIn?: boolean;
};

/**
 * The result of an eligibility check at customer-selection time. When the
 * customer is eligible, `nextDeliveryDate` carries the resolved next non-paused
 * delivery day for a live preview; it is `null` when the customer is eligible
 * (active subscription) but has NO upcoming non-paused day (every upcoming day
 * is paused), in which case placement must be blocked (Req 6.2, 6.4).
 */
export type EligibilityResult = {
  eligible: boolean;
  reason?: string;
  nextDeliveryDate?: string | null;
};

/** At most this many customer results are returned (Req 2.4). */
export const MAX_SEARCH_RESULTS = 50;

const NOT_PAID_ERROR =
  "Payment must be marked as paid before the order can be placed.";
const EMPTY_CART_ERROR = "At least one product is required to place the order.";
const NO_DELIVERY_DAY_ERROR =
  "The customer has no upcoming active delivery days.";
/** Req 10.6, 15.11: a CORE order with no resolved fulfilling clinic. */
const NO_FULFILLING_CLINIC_ERROR =
  "A fulfilling clinic must be selected before the order can be placed.";

const NO_ACTIVE_SUBSCRIPTION_REASON = "No active subscription";
const EXPIRING_TODAY_REASON = "Expiring today (no next delivery day)";
const NOT_ELIGIBLE_REASON = "Customer is not eligible";
const CUSTOMER_NOT_FOUND_REASON = "Customer not found";

// ---------------------------------------------------------------------------
// Internal row shapes
// ---------------------------------------------------------------------------

type CustomerProfileSearchRow = {
  id: string;
  franchise_id: string | null;
  users: { full_name: string | null; mobile: string | null } | null;
};

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class AssistedOrderService {
  private readonly supabase: SupabaseClient;

  constructor(client?: SupabaseClient) {
    this.supabase = client ?? createAdminClient();
  }

  /**
   * Search customers by mobile number or name, scoped to the operator (Req 2).
   *
   * - The query is validated/normalized by kind first (Req 2.1–2.3); a too-short
   *   query performs NO lookup and returns an error.
   * - The scope filter is applied IN SQL (Req 2.6, 2.7, 8.3, 8.4): an Admin
   *   (CORE) sees only `franchise_id IS NULL`; a Franchise_Admin sees only their
   *   own `franchise_id`.
   * - At most {@link MAX_SEARCH_RESULTS} rows are returned, ordered by closest
   *   match (Req 2.4); each result carries the full name and full mobile.
   * - Per-row eligibility is computed against IST today (Req 3).
   */
  async searchCustomers(
    ctx: OperatorContext,
    query: string,
    kind: CustomerSearchKind,
  ): Promise<Result<CustomerSearchResult[]>> {
    const validation = validateSearchQuery(query, kind);
    if (!validation.ok) {
      return { ok: false, error: validation.error };
    }

    const normalized = validation.normalized;
    const column = kind === "MOBILE" ? "mobile" : "full_name";

    let dbQuery = this.supabase
      .from("customer_profiles")
      .select("id, franchise_id, users!customer_profiles_user_id_fkey!inner ( full_name, mobile )")
      .ilike(`users.${column}`, `%${normalized}%`);

    // Scope filter applied in SQL (Req 2.6, 2.7, 8.3, 8.4).
    if (ctx.scope.kind === "CORE") {
      dbQuery = dbQuery.is("franchise_id", null);
    } else {
      dbQuery = dbQuery.eq("franchise_id", ctx.scope.franchiseId);
    }

    // `column` lives on the embedded `users` resource, which cannot reorder the
    // parent rows; order by a stable parent column so the 50-row cap is
    // deterministic, then re-rank by closest match in memory below (Req 2.4).
    const { data, error } = await dbQuery
      .order("id", { ascending: true })
      .limit(MAX_SEARCH_RESULTS);

    if (error) {
      return { ok: false, error: error.message };
    }

    const rows = (data ?? []) as unknown as CustomerProfileSearchRow[];

    // Order by closest match: exact/prefix matches first, then by match
    // position, then alphabetically — then cap to MAX_SEARCH_RESULTS (Req 2.4).
    const needle = normalized.toLowerCase();
    const shaped = rows
      .map((row) => {
        const fullName = row.users?.full_name ?? "";
        const mobile = row.users?.mobile ?? "";
        const haystack = (kind === "MOBILE" ? mobile : fullName).toLowerCase();
        const matchIndex = haystack.indexOf(needle);
        return {
          row,
          fullName,
          mobile,
          matchIndex: matchIndex === -1 ? Number.MAX_SAFE_INTEGER : matchIndex,
          haystack,
        };
      })
      .sort((a, b) => {
        if (a.matchIndex !== b.matchIndex) return a.matchIndex - b.matchIndex;
        if (a.haystack.length !== b.haystack.length)
          return a.haystack.length - b.haystack.length;
        return a.haystack.localeCompare(b.haystack);
      })
      .slice(0, MAX_SEARCH_RESULTS);

    if (shaped.length === 0) {
      return { ok: true, value: [] };
    }

    // Compute per-row eligibility in a single follow-up query (Req 3).
    const profileIds = shaped.map((s) => s.row.id);
    const endDates = await this.fetchActiveEffectiveEndDates(profileIds);
    const today = getISTDateString(0);

    const results: CustomerSearchResult[] = shaped.map((s) => {
      const effectiveEndDate = endDates.get(s.row.id) ?? null;
      const eligible = isCustomerEligible(effectiveEndDate, today);
      return {
        customerProfileId: s.row.id,
        fullName: s.fullName,
        mobile: s.mobile,
        eligible,
        ineligibleReason: eligible
          ? undefined
          : reasonForIneligibility(effectiveEndDate, today),
      };
    });

    return { ok: true, value: results };
  }

  /**
   * Re-evaluate a target customer's eligibility at selection time (Req 3.5, 3.6)
   * using the same criterion as search (Effective_End_Date strictly after IST
   * today). The customer must be within the operator's scope (Req 8.3, 8.4);
   * an out-of-scope or unknown customer is reported as not eligible without
   * leaking whether the account exists.
   */
  async checkEligibility(
    ctx: OperatorContext,
    customerProfileId: string,
  ): Promise<EligibilityResult> {
    const { data: profile, error } = await this.supabase
      .from("customer_profiles")
      .select("id, franchise_id")
      .eq("id", customerProfileId)
      .maybeSingle();

    if (error || !profile) {
      return { eligible: false, reason: CUSTOMER_NOT_FOUND_REASON };
    }

    // Scope enforcement (Req 8.3, 8.4): treat out-of-scope as not found.
    if (!isTargetInScope(ctx.scope, profile.franchise_id ?? null)) {
      return { eligible: false, reason: CUSTOMER_NOT_FOUND_REASON };
    }

    const endDates = await this.fetchActiveEffectiveEndDates([customerProfileId]);
    const effectiveEndDate = endDates.get(customerProfileId) ?? null;
    const today = getISTDateString(0);
    const eligible = isCustomerEligible(effectiveEndDate, today);

    if (!eligible) {
      return {
        eligible: false,
        reason: reasonForIneligibility(effectiveEndDate, today),
      };
    }

    // Eligible: resolve the concrete next non-paused delivery day so the UI can
    // preview it. `null` means the customer is eligible but every upcoming day
    // is paused, so there is no day to ride along with — placement must be
    // blocked until an open day exists (Req 6.2, 6.4).
    const nextDeliveryDate = await resolveTargetDeliveryDate(
      this.supabase,
      customerProfileId,
      today,
    );

    return { eligible: true, nextDeliveryDate };
  }

  /**
   * Price the operator-built cart using the customer-checkout breakdown with the
   * delivery fee forced to 0 (Req 4). Unit prices are resolved from the
   * server-side catalog (`sale_price ?? original_price`), ignoring any
   * client-supplied price (Req 4.5). Returns an error for an empty cart or when
   * any product's catalog price cannot be resolved (Req 4.6).
   */
  async priceCart(
    ctx: OperatorContext,
    cart: CartLine[],
    discount?: ShopOrderDiscount,
  ): Promise<Result<AssistedOrderPricing>> {
    if (cart.length === 0) {
      return {
        ok: false,
        error: "At least one product is required to price the order.",
      };
    }

    const catalog = await this.resolveCatalog(cart);

    const linesResult = buildPricedLines(cart, catalog);
    if (!linesResult.ok) {
      return { ok: false, error: linesResult.error };
    }

    const pricingResult = computeAssistedOrderPricing(linesResult.lines, discount);
    if (!pricingResult.ok) {
      return { ok: false, error: pricingResult.error };
    }

    return { ok: true, value: pricingResult.pricing };
  }

  /**
   * Place the assisted order for the Target_Customer (Req 5, 6, 7). This is the
   * authoritative server-side placement path; every guard is re-enforced here,
   * independent of any UI-level restriction (Req 8.7), and NO exception is ever
   * allowed to escape — all failures are returned as `{ ok: false, error }`.
   *
   * Sequence (mirrors the design):
   *  1. Gate on a PAID payment status (Req 5.7) — placement is enabled solely by
   *     a PAID status via {@link canPlaceOrder}.
   *  2. Reject an empty cart (Req 1.11).
   *  3. Re-check authorization + scope: the target must be within the operator's
   *     scope (Req 8.3, 8.4) and must be eligible (Req 3.7); both are re-validated
   *     here rather than trusted from a prior step.
   *  4. Re-price from the server catalog with the delivery fee forced to 0
   *     (Req 4.5) — client-supplied prices are never trusted.
   *  5. Resolve the Next_Available_Delivery date; reject when none exists
   *     (Req 6.4).
   *  6. Persist atomically via the `place_assisted_addon_order` RPC — order +
   *     items + payment either all commit or all roll back (Req 6.5), with the
   *     operator id stamped (Req 6.6) and `franchise_id` from scope (Req 7.2).
   *  7. For a franchise order only, decrement franchise stock per item and apply
   *     the all-or-nothing failsafe: on any un-honored item, flag the order
   *     `UNFULFILLABLE_STOCK` (keep it PAID) and notify admins (Req 7.3–7.6). A
   *     core order performs no decrement (Req 7.7).
   *  8. Run the linking flow so the order links identically to a customer-placed
   *     PAID order (Req 6.3).
   *
   * @param paymentStatus The operator-marked payment status; placement is gated
   *   on this being PAID (Req 5.7). The per-portal action wrapper passes the
   *   status recorded by the explicit Mark_Paid_Action.
   * @param fulfillingClinicId The Core_Clinic resolved by the action layer to
   *   fulfil this order (Req 10.3, 10.4, 10.5) — `null` for a FRANCHISE order
   *   (franchise orders never touch clinic stock) and REQUIRED for a CORE
   *   order (Req 10.6): a CORE order with no resolved clinic is rejected
   *   before any pricing/RPC work (Req 15.11).
   */
  async placeOrder(
    ctx: OperatorContext,
    cart: CartLine[],
    customerProfileId: string,
    paymentStatus: string,
    discount?: ShopOrderDiscount,
    clinicPickup: boolean = false,
    fulfillingClinicId: string | null = null,
  ): Promise<Result<PlaceOrderOutcome>> {
    try {
      // 1. PAID-only placement gate (Req 5.7). Enforced before any read/write.
      if (!canPlaceOrder(paymentStatus)) {
        return { ok: false, error: NOT_PAID_ERROR };
      }

      // 2. Empty cart (Req 1.11).
      if (cart.length === 0) {
        return { ok: false, error: EMPTY_CART_ERROR };
      }

      // 2b. A CORE order requires a resolved fulfilling clinic (Req 10.6,
      //     15.11). A FRANCHISE order never carries one — that concept does
      //     not apply to franchise orders — so this check is CORE-only.
      if (ctx.scope.kind === "CORE" && !fulfillingClinicId) {
        return { ok: false, error: NO_FULFILLING_CLINIC_ERROR };
      }

      // 3. Re-check authorization + scope and re-validate eligibility (Req 3.7,
      //    8.3, 8.4). `checkEligibility` also enforces scope (out-of-scope /
      //    unknown customers are reported not eligible), so it covers both.
      const eligibility = await this.checkEligibility(ctx, customerProfileId);
      if (!eligibility.eligible) {
        return {
          ok: false,
          error: eligibility.reason ?? "Customer is not eligible.",
        };
      }

      // 4. Re-price from the server catalog; delivery fee forced to 0 (Req 4.5).
      const catalog = await this.resolveCatalog(cart);

      const linesResult = buildPricedLines(cart, catalog);
      if (!linesResult.ok) {
        return { ok: false, error: linesResult.error };
      }
      const lines = linesResult.lines;

      // 4b. Clinic presentation + stock validation (Req 15.9, 15.10, 10.7),
      //     early — before pricing was consumed further and before the RPC —
      //     mirroring how the other early-rejection checks are ordered.
      if (ctx.scope.kind === "CORE" && fulfillingClinicId) {
        const clinicCheck = await this.validateClinicFulfillment(
          fulfillingClinicId,
          lines,
        );
        if (!clinicCheck.ok) {
          return { ok: false, error: clinicCheck.error };
        }
      }

      const pricingResult = computeAssistedOrderPricing(lines, discount);
      if (!pricingResult.ok) {
        return { ok: false, error: pricingResult.error };
      }
      const pricing = pricingResult.pricing;

      // 5. Resolve the delivery date.
      //    - Clinic pickup: the customer collects at the clinic, so the order
      //      does not ride a delivery. It is recorded against today's IST date
      //      and the "no upcoming delivery day" block does not apply.
      //    - Normal: resolve the Next_Available_Delivery day; reject when none
      //      exists (Req 6.4).
      let targetDate: string;
      if (clinicPickup) {
        targetDate = getISTDateString(0);
      } else {
        const resolved = await resolveTargetDeliveryDate(
          this.supabase,
          customerProfileId,
        );
        if (!resolved) {
          return { ok: false, error: NO_DELIVERY_DAY_ERROR };
        }
        targetDate = resolved;
      }

      // franchise_id stamped from the operator scope: a franchise id for a
      // Franchise_Admin, null for an Admin (core) order (Req 7.2).
      const franchiseId =
        ctx.scope.kind === "FRANCHISE" ? ctx.scope.franchiseId : null;

      // clinic_id / movement_source are set ONLY for a CORE order with a
      // resolved fulfilling clinic (Req 10.3, 10.4, 10.5); a FRANCHISE order
      // never carries these — its own stock failsafe (step 7) applies instead.
      const clinicId = ctx.scope.kind === "CORE" ? fulfillingClinicId : null;

      // 6. Atomic persistence via the SECURITY DEFINER RPC (Req 6.1, 6.5, 6.6,
      //    7.2). Any write failure raises inside the function and rolls back the
      //    whole order/items/payment transaction. When `clinic_id` is set, the
      //    RPC also performs the clinic decrement + ledger write inline, in the
      //    same transaction (Req 10.8, 10.9, 10.10, 11.1, 11.2, 11.3).
      const payload = {
        customer_profile_id: customerProfileId,
        franchise_id: franchiseId,
        placed_by_user_id: ctx.userId,
        target_delivery_date: targetDate,
        total: pricing.total,
        base_amount: pricing.subtotal,
        tax_amount: pricing.tax,
        discount_amount: pricing.discount,
        is_clinic_pickup: clinicPickup,
        items: lines.map((line: PricedLine) => ({
          product_id: line.productId,
          quantity: line.quantity,
          unit_price: line.unitPrice,
        })),
        ...(clinicId
          ? { clinic_id: clinicId, movement_source: "ASSISTED_SALE" }
          : {}),
      };

      const { data: addonOrderId, error: rpcError } = await this.supabase.rpc(
        "place_assisted_addon_order",
        { payload },
      );

      if (rpcError || !addonOrderId) {
        return {
          ok: false,
          error:
            rpcError?.message ??
            "Failed to place the order. No records were created.",
        };
      }

      const newAddonOrderId = addonOrderId as string;

      // 7. Franchise stock failsafe (Req 7.3–7.7). Core orders skip this entirely
      //    (no decrement via this path — clinic decrement, when applicable,
      //    already happened inline inside the RPC above — Req 7.7).
      let unfulfillable = false;
      if (franchiseId) {
        unfulfillable = await this.applyFranchiseStockFailsafe(
          newAddonOrderId,
          franchiseId,
          lines,
        );
      }

      // 8. Link the placed order to the customer's next available delivery,
      //    identically to a customer-placed PAID order (Req 6.3). This is a
      //    best-effort post-step: the order is already placed and PAID, and the
      //    nightly linking cron will link it if it cannot be linked now (e.g. the
      //    target day is beyond the linking window), so a linking failure must
      //    NOT roll back or fail the successful placement.
      //    A clinic-pickup order is already DELIVERED and never rides a
      //    delivery, so linking is skipped entirely.
      if (!clinicPickup) {
        try {
          await runProductLinkingAction(targetDate);
        } catch (linkError) {
          console.error(
            "Assisted order placed but linking attempt failed:",
            linkError,
            { addon_order_id: newAddonOrderId, target_delivery_date: targetDate },
          );
        }
      }

      return {
        ok: true,
        value: {
          addonOrderId: newAddonOrderId,
          unfulfillable,
          targetDeliveryDate: targetDate,
          clinicPickup,
        },
      };
    } catch (error: unknown) {
      // No exception escapes to the caller (Req 6.5 / error-handling contract).
      const message =
        error instanceof Error
          ? error.message
          : "An unexpected error occurred while placing the order.";
      return { ok: false, error: message };
    }
  }

  /**
   * Place a WALK-IN shop order — a counter sale to a buyer who has no customer
   * profile (they bought only a shop product, not a meal / kit / accommodation
   * subscription).
   *
   * This exists so no unit ever leaves shop stock without an order row behind
   * it. It deliberately reuses the exact same pricing, atomic RPC, and franchise
   * stock failsafe as {@link placeOrder}; only the buyer identity and the
   * fulfillment shape differ:
   *
   *   - there is no `customer_profile_id`; the buyer's name (required) plus an
   *     optional mobile and address are recorded on the `addon_orders` row,
   *   - eligibility and the next-delivery-day resolution do not apply — a
   *     walk-in has no subscription and no delivery to ride along with, so the
   *     order is recorded against today (IST) and created already DELIVERED
   *     (`CLINIC_PICKUP`), which keeps it permanently out of routing.
   *
   * Every guard is re-enforced here and NO exception escapes: all failures come
   * back as `{ ok: false, error }`.
   *
   * @param paymentStatus The operator-marked payment status; placement is gated
   *   on this being PAID, exactly as for a profile-backed order.
   * @param fulfillingClinicId The Core_Clinic resolved by the action layer to
   *   fulfil this walk-in sale (Req 10.4, 10.5) — `null` for a FRANCHISE order
   *   and REQUIRED for a CORE order (Req 10.6, 15.11), rejected before any
   *   pricing/RPC work when absent.
   */
  async placeWalkInOrder(
    ctx: OperatorContext,
    cart: CartLine[],
    walkIn: WalkInCustomerInput,
    paymentStatus: string,
    discount?: ShopOrderDiscount,
    fulfillingClinicId: string | null = null,
  ): Promise<Result<PlaceOrderOutcome>> {
    try {
      // 1. PAID-only placement gate, before any read/write.
      if (!canPlaceOrder(paymentStatus)) {
        return { ok: false, error: NOT_PAID_ERROR };
      }

      // 2. Empty cart.
      if (cart.length === 0) {
        return { ok: false, error: EMPTY_CART_ERROR };
      }

      // 2b. A CORE walk-in sale requires a resolved fulfilling clinic (Req
      //     10.6, 15.11); a FRANCHISE order never carries one.
      if (ctx.scope.kind === "CORE" && !fulfillingClinicId) {
        return { ok: false, error: NO_FULFILLING_CLINIC_ERROR };
      }

      // 3. Buyer details — server-side validation is authoritative; the client
      //    form only mirrors it for inline feedback.
      const validated = validateWalkInCustomer(walkIn);
      if (!validated.ok) {
        return { ok: false, error: validated.error };
      }
      const buyer = validated.value;

      // 4. Re-price from the server catalog; delivery fee forced to 0. Any
      //    client-supplied price is ignored.
      const catalog = await this.resolveCatalog(cart);

      const linesResult = buildPricedLines(cart, catalog);
      if (!linesResult.ok) {
        return { ok: false, error: linesResult.error };
      }
      const lines = linesResult.lines;

      // 4b. Clinic presentation + stock validation (Req 15.9, 15.10, 10.7),
      //     early — before the RPC call.
      if (ctx.scope.kind === "CORE" && fulfillingClinicId) {
        const clinicCheck = await this.validateClinicFulfillment(
          fulfillingClinicId,
          lines,
        );
        if (!clinicCheck.ok) {
          return { ok: false, error: clinicCheck.error };
        }
      }

      const pricingResult = computeAssistedOrderPricing(lines, discount);
      if (!pricingResult.ok) {
        return { ok: false, error: pricingResult.error };
      }
      const pricing = pricingResult.pricing;

      // A counter sale happens now: record it against today's IST date.
      const targetDate = getISTDateString(0);

      const franchiseId =
        ctx.scope.kind === "FRANCHISE" ? ctx.scope.franchiseId : null;

      const clinicId = ctx.scope.kind === "CORE" ? fulfillingClinicId : null;

      // 5. Atomic persistence via the same SECURITY DEFINER RPC. The walk-in
      //    branch writes customer_profile_id NULL + the buyer details, and
      //    creates the order DELIVERED / CLINIC_PICKUP. When `clinic_id` is
      //    set, the RPC also performs the clinic decrement + ledger write
      //    inline, in the same transaction (Req 10.8, 10.9, 10.10).
      const payload = {
        customer_profile_id: null,
        walkin_name: buyer.name,
        walkin_mobile: buyer.mobile,
        walkin_address: buyer.address,
        franchise_id: franchiseId,
        placed_by_user_id: ctx.userId,
        target_delivery_date: targetDate,
        total: pricing.total,
        base_amount: pricing.subtotal,
        tax_amount: pricing.tax,
        discount_amount: pricing.discount,
        is_clinic_pickup: true,
        items: lines.map((line: PricedLine) => ({
          product_id: line.productId,
          quantity: line.quantity,
          unit_price: line.unitPrice,
        })),
        ...(clinicId
          ? { clinic_id: clinicId, movement_source: "WALKIN_SALE" }
          : {}),
      };

      const { data: addonOrderId, error: rpcError } = await this.supabase.rpc(
        "place_assisted_addon_order",
        { payload },
      );

      if (rpcError || !addonOrderId) {
        return {
          ok: false,
          error:
            rpcError?.message ??
            "Failed to place the order. No records were created.",
        };
      }

      const newAddonOrderId = addonOrderId as string;

      // 6. Franchise stock failsafe, identical to a profile-backed order. Core
      //    orders perform no decrement via this path (the clinic decrement,
      //    when applicable, already happened inline inside the RPC above).
      let unfulfillable = false;
      if (franchiseId) {
        unfulfillable = await this.applyFranchiseStockFailsafe(
          newAddonOrderId,
          franchiseId,
          lines,
        );
      }

      // No linking step: the order is already DELIVERED and never rides a
      // delivery.
      return {
        ok: true,
        value: {
          addonOrderId: newAddonOrderId,
          unfulfillable,
          targetDeliveryDate: targetDate,
          clinicPickup: true,
          walkIn: true,
        },
      };
    } catch (error: unknown) {
      const message =
        error instanceof Error
          ? error.message
          : "An unexpected error occurred while placing the order.";
      return { ok: false, error: message };
    }
  }

  // -------------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------------

  /**
   * Decrement franchise stock for every ordered item and apply the all-or-nothing
   * failsafe (Req 7.3–7.6), reusing the pure `evaluateFranchiseStockOutcome` so
   * the oversell decision remains a single source of truth.
   *
   * The `decrement_franchise_product_stock` RPC is the source of atomicity: it
   * returns `false` (without decrementing) when franchise stock is insufficient.
   * When any item cannot be decremented, the order is flagged
   * `UNFULFILLABLE_STOCK` (Req 7.5) — kept PAID (the customer was charged) — and
   * admins are notified for manual payment-versus-stock resolution (Req 7.6).
   *
   * @returns `true` when the order was flagged unfulfillable, `false` otherwise.
   */
  private async applyFranchiseStockFailsafe(
    addonOrderId: string,
    franchiseId: string,
    lines: PricedLine[],
  ): Promise<boolean> {
    const decrementResults: ItemDecrementResult[] = [];

    for (const line of lines) {
      const { data: decremented, error: decError } = await this.supabase.rpc(
        "decrement_franchise_product_stock",
        {
          p_franchise_id: franchiseId,
          p_product_id: line.productId,
          p_quantity: line.quantity,
        },
      );

      const ok = !decError && decremented !== false;

      if (!ok) {
        // Keep logging for ops visibility; the order-level decision below stops
        // the order from being silently completed.
        console.error(
          "Franchise stock decrement issue:",
          decError?.message ?? "insufficient stock",
          { product_id: line.productId },
        );
      }

      decrementResults.push({
        product_id: line.productId,
        quantity: line.quantity,
        decremented: ok,
      });
    }

    const outcome = evaluateFranchiseStockOutcome(decrementResults);
    if (outcome.fulfillable) {
      return false;
    }

    // Flag the order unfulfillable, scoped to this order id. Keep status PAID and
    // leave franchise stock unchanged (the RPC declined every un-honored item).
    const { error: flagError } = await this.supabase
      .from("addon_orders")
      .update({ fulfillment_status: UNFULFILLABLE_STOCK_STATUS })
      .eq("id", addonOrderId);

    if (flagError) {
      console.error(
        "Failed to flag franchise assisted order as unfulfillable:",
        flagError.message,
        { addon_order_id: addonOrderId },
      );
    }

    // Notify admins that the order needs manual payment-versus-stock resolution.
    const title = "Franchise stock oversell — action needed";
    const message = `An assisted franchise shop order (${addonOrderId}) was paid but stock could not be reserved for ${outcome.unfulfillableProductIds.length} item(s). Review for refund or restock.`;

    await notifyAdmins({
      title,
      message,
      actionUrl: "/admin/customers",
      sendEmail: false,
      ...buildPushPayload(title, message, `assisted-oversell-${addonOrderId}`),
    });

    return true;
  }

  /**
   * Validate an assisted/walk-in sale's lines against the fulfilling Core
   * Clinic before any pricing/RPC work runs (Req 15.9, 15.10, 15.11).
   *
   * Two categories, in order — the first with any failure decides the verdict,
   * naming every offending product rather than just the first:
   *   1. Presented: the product must exist, not be soft-deleted, carry
   *      Global_Visibility (`products.is_active`), and be Effective_Clinic_
   *      Visibility "shown" for this clinic. A product failing any of those is
   *      reported "unavailable at the Admin's clinic" (Req 15.9).
   *   2. Stock: every line's quantity must not exceed the clinic's current
   *      Effective_Clinic_Stock for that product (Req 15.10, 10.7), reusing the
   *      pure `evaluateSaleSubmission` so this decision matches the RPC's own
   *      guard and the property-tested reference model.
   *
   * This is a defense-in-depth pre-check: `clinic_shop_apply_sale` (invoked
   * inline by `place_assisted_addon_order`) re-validates and enforces the same
   * rule under a row lock as the final backstop (Req 11.2, 11.4). This check
   * exists so a rejection carries a clear, product-naming message instead of
   * relying solely on the RPC's generic exception text.
   */
  private async validateClinicFulfillment(
    clinicId: string,
    lines: PricedLine[],
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    const productIds = Array.from(new Set(lines.map((line) => line.productId)));

    const [overlays, productsResult] = await Promise.all([
      listClinicOverlays(clinicId),
      this.supabase
        .from("products")
        .select("id, is_active, deleted_at")
        .in("id", productIds),
    ]);

    if (productsResult.error) {
      return {
        ok: false,
        error: "Failed to verify clinic product availability.",
      };
    }

    const overlayByProduct = new Map(
      overlays.map((overlay) => [overlay.product_id, overlay]),
    );
    const productMeta = new Map(
      (productsResult.data ?? []).map((p) => [
        p.id as string,
        {
          isActive: p.is_active as boolean,
          deletedAt: (p.deleted_at as string | null) ?? null,
        },
      ]),
    );

    // 1. Presented check (Req 15.9): not visible, not globally active, soft
    //    deleted, or missing entirely are all "unavailable at the clinic".
    const unavailable: string[] = [];
    for (const productId of productIds) {
      const meta = productMeta.get(productId);
      const overlay = resolveEffectiveOverlay(overlayByProduct.get(productId));
      const presented =
        meta !== undefined &&
        meta.deletedAt === null &&
        meta.isActive === true &&
        overlay.isVisible;
      if (!presented) {
        unavailable.push(productId);
      }
    }
    if (unavailable.length > 0) {
      return {
        ok: false,
        error: `The following product(s) are unavailable at the Admin's clinic: ${unavailable.join(", ")}.`,
      };
    }

    // 2. Stock check (Req 15.10, 10.7): reuse the pure evaluator so this
    //    matches the RPC's own guard exactly.
    const verdict = evaluateSaleSubmission({
      clinicId,
      lines: lines.map((line) => ({
        productId: line.productId,
        quantity: line.quantity,
      })),
      products: productIds.map((productId) => ({
        productId,
        overlay: overlayByProduct.get(productId),
      })),
    });

    if (!verdict.ok) {
      if (verdict.code === "INSUFFICIENT_CLINIC_STOCK") {
        const detail = verdict.rejections
          .map(
            (r) =>
              `${r.productId} (requested ${String(r.requested)}, available ${r.available})`,
          )
          .join("; ");
        return {
          ok: false,
          error: `Insufficient clinic stock for: ${detail}.`,
        };
      }
      return {
        ok: false,
        error: "The requested quantity is not valid for the fulfilling clinic.",
      };
    }

    return { ok: true };
  }

  /**
   * Resolve the server catalog for the cart's products into the map shape the
   * pricing adapter consumes. Unavailable (soft-deleted / missing) products are
   * intentionally omitted so `buildPricedLines` reports an unresolvable price.
   */
  private async resolveCatalog(
    cart: CartLine[],
  ): Promise<Map<string, AssistedCatalogProduct>> {
    const uniqueIds = Array.from(new Set(cart.map((line) => line.productId)));
    const catalog = new Map<string, AssistedCatalogProduct>();

    await Promise.all(
      uniqueIds.map(async (productId) => {
        const { data: product, error } = await fetchProductForCheckout(
          this.supabase,
          productId,
        );

        if (isProductUnavailable(product, error)) {
          return;
        }

        catalog.set(productId, {
          productId,
          salePrice: product!.sale_price,
          originalPrice: product!.original_price,
          taxPercent: product!.tax_percent,
        });
      }),
    );

    return catalog;
  }

  /**
   * For the given customer profile ids, return a map of
   * `customer_profile_id -> latest Effective_End_Date` across the customer's
   * ACTIVE subscriptions. Customers with no ACTIVE subscription are absent from
   * the map (and therefore ineligible).
   */
  private async fetchActiveEffectiveEndDates(
    customerProfileIds: string[],
  ): Promise<Map<string, string>> {
    const result = new Map<string, string>();
    if (customerProfileIds.length === 0) {
      return result;
    }

    const { data, error } = await this.supabase
      .from("subscriptions")
      .select("customer_profile_id, effective_end_on")
      .eq("status", "ACTIVE")
      .in("customer_profile_id", customerProfileIds);

    if (error || !data) {
      return result;
    }

    for (const row of data as Array<{
      customer_profile_id: string;
      effective_end_on: string | null;
    }>) {
      if (!row.effective_end_on) {
        continue;
      }
      const existing = result.get(row.customer_profile_id);
      // Keep the latest Effective_End_Date (ISO dates compare lexicographically).
      if (!existing || row.effective_end_on > existing) {
        result.set(row.customer_profile_id, row.effective_end_on);
      }
    }

    return result;
  }
}

/**
 * Describe why a customer is ineligible, given their latest ACTIVE
 * Effective_End_Date (or null when there is no ACTIVE subscription) relative to
 * IST today.
 */
function reasonForIneligibility(
  effectiveEndDate: string | null,
  today: string,
): string {
  if (!effectiveEndDate) {
    return NO_ACTIVE_SUBSCRIPTION_REASON;
  }
  if (effectiveEndDate === today) {
    return EXPIRING_TODAY_REASON;
  }
  return NOT_ELIGIBLE_REASON;
}
