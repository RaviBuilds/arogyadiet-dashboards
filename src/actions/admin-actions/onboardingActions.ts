// src/actions/admin-actions/onboardingActions.ts
//
// Admin-only Server Actions (orchestration layer) for the customer
// mobile-onboarding feature. These are the `'use server'` entry points the
// admin Quick_Onboarding_Form wizard and the Customers dashboard sections call;
// they own request-scoped concerns ONLY — authentication/authorization, admin
// identity + franchise-scope resolution, Zod re-validation, the runtime
// preconditions (PAID, start-date cutoff), and cache revalidation — then
// delegate the business work to the services and repositories:
//
//   onboardCustomerAction         → OnboardingService.onboard (Req 4.6/4.7/6.1/
//                                    6.4/6.5/7.7/8.1/8.2/14.6)
//   listOnboardedCustomersAction  → repo.listByOnboardingStatus('IN_PROGRESS')  (Req 6.9)
//   listCompletedCustomersAction  → repo.listByOnboardingStatus('COMPLETED')    (Req 6.10)
//   activateAddOnCategoryAction   → OnboardingService.activateAddOnCategory     (Req 13.7)
//
// Security: every export re-verifies the caller is an admin who may manage (or,
// for the reads, at least view) the "customers" operations group, because a
// Server Function is reachable via a direct POST and must not trust the UI
// (Next.js 16 mutating-data guidance). Franchise-scoped admins are constrained
// to their own franchise for both the serviceable-pincode gate and the list
// reads; global ADMIN/MASTER_ADMIN see the whole network.
//
// Requirements: 4.6, 4.7, 6.1, 6.4, 6.5, 6.9, 6.10, 7.7, 8.1, 8.2, 13.7, 14.6

"use server";

import { revalidatePath } from "next/cache";

import { createAdminClient } from "@/lib/supabase/admin";
import {
  assertGroupAccess,
  checkGroupManage,
  getCurrentAdminContext,
  GroupAccessDeniedError,
} from "@/lib/auth/adminAccess";
import { resolveFranchiseContext } from "@/lib/franchise/context";
import { normalizePincode } from "@/lib/address/validatePincode";
import {
  isStartDateAllowed,
  isPastStartDateValid,
  pastDayStatusBoundary,
  PAST_DATE_MAX_DAYS,
} from "@/lib/onboarding/cutoff";
import { istDateStringOf, addDaysToISODate } from "@/lib/dates/ist";
import type { PastDayStatus } from "@/types/onboarding";
import {
  isValidCategory,
  type CustomerCategory,
} from "@/lib/onboarding/category";
import { createQuickOnboardingSchema } from "@/validations/onboardingSchema";
import {
  listByOnboardingStatus,
  type CustomerRow,
  type OnboardIds,
  type OnboardingScope,
} from "@/repositories/customerOnboardingRepository";
import {
  activateAddOnCategory as serviceActivateAddOnCategory,
  onboard as serviceOnboard,
  type ActivateAddOnResult,
  type AddOnActivationPayment,
  type DeliveryChargeContext,
  type DiscountContext,
  type MiscChargeContext,
  type PaymentCollectionContext,
} from "@/services/OnboardingService";
import { isValidPinFormat } from "@/lib/pin/pinUtils";
import {
  MISC_CHARGE_MAX,
  MISC_CHARGE_LABEL_MAX_LENGTH,
} from "@/lib/onboarding/miscCharge";
import {
  DISCOUNT_MAX,
  isDiscountableCategory,
} from "@/lib/onboarding/discount";
import { hashPin } from "@/services/PinService";
import { logAdminAction } from "@/lib/logger";

// ---------------------------------------------------------------------------
// Action result types
// ---------------------------------------------------------------------------

/**
 * Result of {@link onboardCustomerAction}. On failure the action returns a
 * top-level `error` plus optional per-field `fieldErrors` so the wizard can
 * flag each invalid input and retain the admin's entered values (Req 4.6).
 */
export type OnboardCustomerActionResult =
  | {
      success: true;
      ids: OnboardIds;
      /**
       * The customer WAS created, but a post-commit step needs admin attention.
       * Shown as a warning rather than a success so nothing is silently wrong.
       */
      warning?: string;
    }
  | { success: false; error: string; fieldErrors?: Record<string, string> };

/** Result of the dashboard list reads (Req 6.9/6.10). */
export type ListCustomersActionResult =
  | { success: true; customers: CustomerRow[] }
  | { success: false; error: string };

/** Result of {@link activateAddOnCategoryAction} (Req 13.7). */
export type ActivateAddOnCategoryActionResult =
  | { success: true; subscriptionId?: string }
  | { success: false; error: string; fieldErrors?: Record<string, string> };

// The admin Customers dashboard path revalidated after a successful onboarding
// so the Onboarded / Completed sections reflect the new record immediately.
const ADMIN_CUSTOMERS_PATH = "/admin/customers";

// ---------------------------------------------------------------------------
// onboardCustomerAction — Quick_Onboarding_Form submission
// ---------------------------------------------------------------------------

/**
 * Onboard a customer from the admin Quick_Onboarding_Form payload.
 *
 * Request-scoped orchestration (business rules live in the OnboardingService):
 *   1. Authorize: the caller must be an admin who may MANAGE the "customers"
 *      group — this is a write (Req 6.1). Reject a direct/unauthorized POST.
 *   2. Resolve the admin identity (audit `created_by`) and the admin's franchise
 *      scope so the address is validated against the correct service area.
 *   3. Build the Quick_Onboarding_Form schema bound to the resolved franchise's
 *      serviceable pincodes and Zod re-validate the payload server-side — never
 *      trust the client's validation (Req 4.6). Return per-field errors on fail.
 *   4. Assert Payment_Status == PAID (Req 8.1/8.2) — reject before any write.
 *   5. Assert the start date is on/after the earliest selectable date for the
 *      current instant vs the 5 PM IST cutoff (Req 7.7).
 *   6. Delegate the atomic, all-or-nothing write to OnboardingService.onboard,
 *      passing the resolved AdminContext. Map its typed failure reasons to a
 *      top-level message + field errors.
 *   7. On success, revalidate the admin Customers path so the new IN_PROGRESS
 *      record shows in the Onboarded section (Req 6.9).
 *
 * @param payload the raw Quick_Onboarding_Form input (validated here)
 */
export async function onboardCustomerAction(
  payload: unknown,
): Promise<OnboardCustomerActionResult> {
  // (1) Authorization — writing a Customer_Record requires manage on customers.
  const gate = await checkGroupManage("customers");
  if (!gate.ok) {
    return { success: false, error: gate.error };
  }

  // (2) Resolve admin identity + franchise scope.
  const { userId: adminUserId } = await getCurrentAdminContext();
  const franchiseId = await resolveScopedFranchiseId();
  
  // (2b) Pre-parse to determine category for conditional serviceability validation
  const rawInput = payload as Record<string, unknown>;
  const primaryCategory = rawInput.primaryCategory as string | undefined;
  
  // (2c) For KIT category, skip PIN serviceability check (Req 3.1, 3.2)
  // For MEAL category, enforce serviceability (Req 3.3)
  const skipServiceabilityCheck = primaryCategory === "KIT";
  const serviceAreaPincodes = skipServiceabilityCheck 
    ? [] // Empty array when skipping serviceability
    : await resolveServiceablePincodes(franchiseId);

  // (3) Zod re-validate against the franchise-bound schema (Req 4.6).
  const schema = createQuickOnboardingSchema(serviceAreaPincodes, skipServiceabilityCheck);
  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    return {
      success: false,
      error: "Some fields are invalid or missing. Please correct them and try again.",
      fieldErrors: zodFieldErrors(parsed.error.issues),
    };
  }
  const input = parsed.data;

  // (3b) Extract and validate the temporary PIN (Req 6.4, 6.5, 6.6).
  // The tempPin is not part of the Zod schema — it's passed alongside the form
  // data and hashed server-side before being sent to the onboard_customer RPC.
  const rawPayload = payload as Record<string, unknown>;
  const tempPin = typeof rawPayload.tempPin === "string" ? rawPayload.tempPin : "";
  if (!isValidPinFormat(tempPin)) {
    return {
      success: false,
      error: "Temporary PIN must be exactly 6 digits.",
      fieldErrors: { tempPin: "Enter a valid 6-digit temporary PIN." },
    };
  }

  // Hash the temp PIN server-side (bcryptjs cost 10) — never send plaintext
  // PIN to the database. The hash + is_temp_pin flag are passed to the service.
  let pinHash: string;
  try {
    pinHash = await hashPin(tempPin);
  } catch {
    return {
      success: false,
      error: "Failed to process the temporary PIN. Please try again.",
    };
  }

  // (4) PAID precondition (Req 8.1/8.2) — no record is persisted otherwise.
  if (input.paymentStatus !== "PAID") {
    return {
      success: false,
      error: "Payment must be marked done (PAID) before onboarding can proceed.",
      fieldErrors: { paymentStatus: "Payment must be marked PAID." },
    };
  }

  // (5) Start date validation — past-date-aware (Req 7.1–7.7).
  // When pastDateEnabled is true, bypass the existing cutoff check and run
  // past-date-specific validations instead. When false, enforce the cutoff as
  // before, rejecting past dates that lack the pastDateEnabled flag.
  const now = new Date();
  const istToday = istDateStringOf(now);

  if (input.startDate) {
    if (input.pastDateEnabled) {
      // ── Past-date mode is ON ─────────────────────────────────────────────

      // (5a) Validate start date is within the 30-day past range (Req 7.2).
      if (!isPastStartDateValid(input.startDate, now)) {
        // Could be: date is not actually in the past, or > 30 days back
        if (input.startDate < addDaysToISODate(istToday, -PAST_DATE_MAX_DAYS)) {
          return {
            success: false,
            error: "Date exceeds maximum 30-day past range.",
            fieldErrors: {
              startDate: "Start date cannot be more than 30 days in the past.",
            },
          };
        }
        return {
          success: false,
          error: "The selected start date is not a valid past date.",
          fieldErrors: {
            startDate: "Start date must be earlier than today and within 30 days.",
          },
        };
      }

      // (5b) pastDayStatuses must be present and non-empty (Req 7.3).
      const pastDayStatuses: PastDayStatus[] = input.pastDayStatuses ?? [];
      if (pastDayStatuses.length === 0) {
        return {
          success: false,
          error: "Past day statuses are required.",
          fieldErrors: {
            pastDayStatuses: "Past day statuses are required when past-date mode is enabled.",
          },
        };
      }

      // (5c) Entry count must match calendar days from startDate to boundary (Req 7.4).
      const boundaryDate = pastDayStatusBoundary(now);
      const expectedDays = calendarDayCount(input.startDate, boundaryDate);
      if (pastDayStatuses.length !== expectedDays) {
        return {
          success: false,
          error: `Day count mismatch: expected ${expectedDays} entries, got ${pastDayStatuses.length}.`,
          fieldErrors: {
            pastDayStatuses: `Expected ${expectedDays} entries (from ${input.startDate} to ${boundaryDate}), got ${pastDayStatuses.length}.`,
          },
        };
      }

      // (5d) Validate each entry: Delivered must have mealType + deliveryAddress (Req 7.5).
      const fieldErrors: Record<string, string> = {};
      const seenDates = new Set<string>();

      for (let i = 0; i < pastDayStatuses.length; i++) {
        const entry = pastDayStatuses[i];

        // Check for date outside valid range or duplicates (Req 7.6).
        if (entry.date < input.startDate || entry.date > boundaryDate) {
          fieldErrors[`pastDayStatuses.${i}.date`] =
            `Date ${entry.date} is outside the valid range [${input.startDate}, ${boundaryDate}].`;
        } else if (seenDates.has(entry.date)) {
          fieldErrors[`pastDayStatuses.${i}.date`] =
            `Duplicate date entry: ${entry.date}.`;
        }
        seenDates.add(entry.date);

        // Check Delivered entry completeness (Req 7.5).
        if (entry.mealStatus === "Delivered") {
          if (!entry.mealType) {
            fieldErrors[`pastDayStatuses.${i}.mealType`] =
              "Meal type required for delivered days.";
          }
          if (!entry.deliveryAddress) {
            fieldErrors[`pastDayStatuses.${i}.deliveryAddress`] =
              "Address required for delivered days.";
          }
        }
      }

      if (Object.keys(fieldErrors).length > 0) {
        // Determine the top-level error message based on error types
        const hasDateErrors = Object.keys(fieldErrors).some((k) => k.endsWith(".date"));
        const topError = hasDateErrors
          ? "Invalid date entry found."
          : "Some past day status entries are incomplete.";
        return { success: false, error: topError, fieldErrors };
      }
    } else {
      // ── Past-date mode is OFF ────────────────────────────────────────────

      // (5e) If the start date is in the past but pastDateEnabled is false → reject (Req 7.1).
      if (input.startDate < istToday) {
        return {
          success: false,
          error: "Past-date mode must be enabled.",
          fieldErrors: {
            pastDateEnabled: "Enable past-date mode to use a past start date.",
            startDate: "Past-date mode must be enabled for past start dates.",
          },
        };
      }

      // (5f) Standard cutoff validation for future/present dates (Req 7.7).
      if (!isStartDateAllowed(input.startDate, now)) {
        return {
          success: false,
          error: "The selected subscription start date is not permitted for the current cutoff.",
          fieldErrors: {
            startDate: "Select an allowed start date (respecting the 5 PM cutoff).",
          },
        };
      }
    }
  }

  // (6) Delegate the atomic write to the service (Req 6.1-6.6).
  // Extract delivery charge from the raw payload (not part of Zod schema,
  // handled like tempPin). Delivery-charges-management Req 6.1–6.5.
  const rawDeliveryCharge = typeof rawPayload.deliveryCharge === "number"
    ? rawPayload.deliveryCharge
    : typeof rawPayload.deliveryCharge === "string"
      ? Number(rawPayload.deliveryCharge)
      : 0;
  const rawCalculatedDeliveryCharge = typeof rawPayload.calculatedDeliveryCharge === "number"
    ? rawPayload.calculatedDeliveryCharge
    : typeof rawPayload.calculatedDeliveryCharge === "string"
      ? Number(rawPayload.calculatedDeliveryCharge)
      : null;

  // (6a-i) MEAL: the delivery charge must be ANSWERED, not merely defaulted
  // (meal-subscription-partial-payment, Phase 2.6). A blank field is rejected;
  // an explicit 0 is accepted — "free delivery" is a decision, an empty box is
  // an oversight, and silently defaulting to 0 hid the difference.
  //
  // Safe to enforce here: QuickOnboardingForm is the only caller of this action
  // (bulk migration goes through addSubscription instead).
  if (input.primaryCategory === "MEAL") {
    const deliveryProvided =
      rawPayload.deliveryCharge !== undefined &&
      rawPayload.deliveryCharge !== null &&
      String(rawPayload.deliveryCharge).trim() !== "";

    if (!deliveryProvided) {
      return {
        success: false,
        error: "Enter the delivery charge (enter 0 if delivery is free).",
        fieldErrors: {
          deliveryCharge: "Delivery charge is required. Enter 0 if not charged.",
        },
      };
    }

    if (!Number.isFinite(rawDeliveryCharge) || rawDeliveryCharge < 0) {
      return {
        success: false,
        error: "Enter a valid delivery charge (0 or more).",
        fieldErrors: { deliveryCharge: "Enter a valid delivery charge." },
      };
    }
  }

  const deliveryChargeAmount = isNaN(rawDeliveryCharge) || rawDeliveryCharge < 0
    ? 0
    : rawDeliveryCharge;

  const deliveryContext: DeliveryChargeContext | undefined =
    deliveryChargeAmount > 0
      ? {
          deliveryCharge: deliveryChargeAmount,
          calculatedDeliveryCharge: rawCalculatedDeliveryCharge,
        }
      : undefined;

  // (6a) Miscellaneous charge — an optional, ad-hoc amount (additional
  // products, one-off services) with an admin-supplied name that the invoice
  // prints verbatim. Read from the raw payload like `deliveryCharge`/`tempPin`.
  const rawMiscCharge = typeof rawPayload.miscCharge === "number"
    ? rawPayload.miscCharge
    : typeof rawPayload.miscCharge === "string" && rawPayload.miscCharge.trim() !== ""
      ? Number(rawPayload.miscCharge)
      : 0;
  const rawMiscChargeLabel = typeof rawPayload.miscChargeLabel === "string"
    ? rawPayload.miscChargeLabel.trim()
    : "";

  if (!Number.isFinite(rawMiscCharge) || rawMiscCharge < 0) {
    return {
      success: false,
      error: "Enter a valid miscellaneous charge amount (0 or more).",
    };
  }
  if (rawMiscCharge > MISC_CHARGE_MAX) {
    return {
      success: false,
      error: `Miscellaneous charge cannot exceed ₹${MISC_CHARGE_MAX.toLocaleString("en-IN")}.`,
    };
  }
  if (rawMiscCharge > 0 && rawMiscChargeLabel === "") {
    return {
      success: false,
      error: "Enter a name for the miscellaneous charge (e.g. Additional product charges).",
    };
  }
  if (rawMiscChargeLabel.length > MISC_CHARGE_LABEL_MAX_LENGTH) {
    return {
      success: false,
      error: `The miscellaneous charge name must be at most ${MISC_CHARGE_LABEL_MAX_LENGTH} characters.`,
    };
  }

  const miscContext: MiscChargeContext | undefined =
    rawMiscCharge > 0
      ? { miscCharge: rawMiscCharge, miscChargeLabel: rawMiscChargeLabel }
      : undefined;

  // (6a-ii) Manual discount — an optional admin concession on the subscription
  // charge (admin-manual-onboarding-discount). Read from the raw payload like
  // `deliveryCharge` / `miscCharge` / `tempPin`.
  //
  // Only SHAPE and CATEGORY are checked here. The ceiling ("cannot exceed the
  // subscription charge") is deliberately NOT enforced at this layer, because it
  // depends on the plan / kit price, which only the service resolves from the
  // database. Validating it here against a client-supplied figure would be
  // theatre — the same reason the advance amount is left to the service.
  const rawDiscount = typeof rawPayload.discountAmount === "number"
    ? rawPayload.discountAmount
    : typeof rawPayload.discountAmount === "string" &&
        rawPayload.discountAmount.trim() !== ""
      ? Number(rawPayload.discountAmount)
      : 0;

  if (!Number.isFinite(rawDiscount) || rawDiscount < 0) {
    return {
      success: false,
      error: "Enter a valid discount amount (0 or more).",
      fieldErrors: { discountAmount: "Enter a valid discount amount." },
    };
  }
  if (rawDiscount > DISCOUNT_MAX) {
    return {
      success: false,
      error: `Discount cannot exceed ₹${DISCOUNT_MAX.toLocaleString("en-IN")}.`,
      fieldErrors: { discountAmount: "Discount is too large." },
    };
  }
  // Money carries at most 2 decimals; anything finer is a typo or a tampered
  // payload, and would not survive the NUMERIC(10,2) column anyway.
  if (Math.round(rawDiscount * 100) !== Number((rawDiscount * 100).toFixed(4))) {
    return {
      success: false,
      error: "The discount cannot have more than 2 decimal places.",
      fieldErrors: { discountAmount: "Use at most 2 decimal places." },
    };
  }
  if (rawDiscount > 0 && !isDiscountableCategory(input.primaryCategory)) {
    return {
      success: false,
      error: "A discount can only be applied to MEAL and KIT onboarding.",
      fieldErrors: {
        discountAmount: "Discounts are not available for this category.",
      },
    };
  }

  const discountContext: DiscountContext | undefined =
    rawDiscount > 0 ? { discountAmount: rawDiscount } : undefined;

  // (6b) Payment collection — full amount, or an advance with a balance left
  // (meal-subscription-partial-payment, Phase 2.6).
  //
  // `customerPaidFullAmount` mirrors the "Customer paid full amount" checkbox,
  // which is CHECKED by default. Absent from the payload therefore means "paid in
  // full", preserving the previous behaviour for any caller that never learns
  // about this field.
  //
  // The advance is NOT validated against a client-supplied total here — the
  // service recomputes Total_Payable from server-resolved plan pricing and
  // validates against that, so a tampered total cannot activate a subscription
  // for a rupee. This block only parses.
  const paidFullRaw = rawPayload.customerPaidFullAmount;
  const paidInFull =
    paidFullRaw === undefined || paidFullRaw === null
      ? true
      : paidFullRaw === true || paidFullRaw === "true";

  let collectionContext: PaymentCollectionContext | undefined;

  if (!paidInFull) {
    if (input.primaryCategory !== "MEAL") {
      return {
        success: false,
        error: "Partial payment is only available for MEAL subscriptions.",
      };
    }

    const rawAdvance =
      typeof rawPayload.advanceAmountPaid === "number"
        ? rawPayload.advanceAmountPaid
        : typeof rawPayload.advanceAmountPaid === "string" &&
            rawPayload.advanceAmountPaid.trim() !== ""
          ? Number(rawPayload.advanceAmountPaid)
          : NaN;

    if (!Number.isFinite(rawAdvance) || rawAdvance <= 0) {
      return {
        success: false,
        error: "Enter the advance amount collected from the customer.",
        fieldErrors: {
          advanceAmountPaid: "The advance amount must be greater than ₹0.",
        },
      };
    }

    // Money carries at most 2 decimals; anything finer is a typo or a tampered
    // payload, and would not survive the NUMERIC(10,2) column anyway.
    if (Math.round(rawAdvance * 100) !== Number((rawAdvance * 100).toFixed(4))) {
      return {
        success: false,
        error: "The advance amount cannot have more than 2 decimal places.",
        fieldErrors: {
          advanceAmountPaid: "Use at most 2 decimal places.",
        },
      };
    }

    collectionContext = { paidInFull: false, advanceAmount: rawAdvance };
  }

  const outcome = await serviceOnboard(
    input,
    { adminUserId },
    { pinHash, isTempPin: true },
    deliveryContext,
    miscContext,
    collectionContext,
    discountContext,
  );
  if (!outcome.ok) {
    return {
      success: false,
      error: outcome.message,
      fieldErrors: outcome.fieldErrors,
    };
  }

  // (6b) Audit: log admin override if the delivery charge differs from the
  // system-calculated value (delivery-charges-management Req 12.4).
  if (
    deliveryContext &&
    deliveryContext.calculatedDeliveryCharge != null &&
    deliveryContext.deliveryCharge !== deliveryContext.calculatedDeliveryCharge
  ) {
    await logAdminAction("UPDATE", "delivery_charge_override", outcome.ids.subscription_id, {
      calculatedAmount: deliveryContext.calculatedDeliveryCharge,
      overriddenAmount: deliveryContext.deliveryCharge,
      surface: "quick_onboarding",
    });
  }

  // (6b-ii) Audit: a manual discount is a financial concession granted at an
  // admin's discretion, so record who granted it and against what.
  //
  // Read from `outcome.ids`, which echoes what the RPC actually committed — not
  // from the request, which the service may have rejected or clamped.
  if (
    outcome.ids.discount_amount != null &&
    Number(outcome.ids.discount_amount) > 0
  ) {
    await logAdminAction("CREATE", "subscription_discount", outcome.ids.subscription_id, {
      discountAmount: Number(outcome.ids.discount_amount),
      totalPayable: outcome.ids.total_payable,
      category: input.primaryCategory,
      planId: input.primaryCategory === "MEAL" ? input.planId : null,
      kitProductId: input.primaryCategory === "KIT" ? input.kitProductId : null,
      surface: "quick_onboarding",
    });
  }

  // (6c) Audit: activating a subscription against a part payment is a financial
  // concession, so record who granted it and how much was left outstanding.
  // Read from `outcome.ids`, which echoes what the RPC actually committed —
  // not from the request, which may have been collapsed to a full payment when
  // the advance equalled the total.
  if (outcome.ids.payment_status === "PARTIALLY_PAID") {
    await logAdminAction("CREATE", "subscription_advance_payment", outcome.ids.subscription_id, {
      totalPayable: outcome.ids.total_payable,
      amountPaid: outcome.ids.amount_paid,
      balanceDue: outcome.ids.balance_due,
      paymentId: outcome.ids.payment_id,
      advanceTransactionId: outcome.ids.advance_transaction_id,
      surface: "quick_onboarding",
    });
  }

  // (7) Refresh the Customers dashboard sections (Req 6.9).
  revalidatePath(ADMIN_CUSTOMERS_PATH);

  return { success: true, ids: outcome.ids, warning: outcome.warning };
}

// ---------------------------------------------------------------------------
// listOnboardedCustomersAction / listCompletedCustomersAction — dashboard reads
// ---------------------------------------------------------------------------

/**
 * List Customer_Records still IN_PROGRESS for the admin's scope — the
 * "onboarded customer" dashboard section (Req 6.9). Read access requires at
 * least view on the "customers" group; results are franchise-scoped for a
 * franchise-scoped admin and network-wide for a global admin.
 */
export async function listOnboardedCustomersAction(): Promise<ListCustomersActionResult> {
  return listCustomersByStatus("IN_PROGRESS");
}

/**
 * List Customer_Records that are COMPLETED for the admin's scope — the
 * "onboarding completed customer" dashboard section (Req 6.10). Same access and
 * scoping rules as {@link listOnboardedCustomersAction}.
 */
export async function listCompletedCustomersAction(): Promise<ListCustomersActionResult> {
  return listCustomersByStatus("COMPLETED");
}

/** Shared implementation for the two status-scoped dashboard reads. */
async function listCustomersByStatus(
  status: "IN_PROGRESS" | "COMPLETED",
): Promise<ListCustomersActionResult> {
  // View access to the customers group is sufficient for a read.
  try {
    await assertGroupAccess("customers");
  } catch (err) {
    if (err instanceof GroupAccessDeniedError) {
      return {
        success: false,
        error: "You do not have permission to view customers.",
      };
    }
    throw err;
  }

  const franchiseId = await resolveScopedFranchiseId();
  const scope: OnboardingScope = franchiseId ? { franchiseId } : {};

  try {
    const customers = await listByOnboardingStatus(status, scope);
    return { success: true, customers };
  } catch (err) {
    return { success: false, error: describeError(err) };
  }
}

// ---------------------------------------------------------------------------
// activateAddOnCategoryAction — add a paid Add_On_Category later (Req 13.7)
// ---------------------------------------------------------------------------

/**
 * Activate an Add_On_Category for an existing customer (Req 13.7). Requires
 * manage on the "customers" group (this creates a paid subscription). The
 * payment gating, at-most-one-active-per-category rule, and isolation of the
 * customer's existing subscriptions are owned by the SubscriptionService, which
 * OnboardingService.activateAddOnCategory delegates to.
 *
 * @param customerId the target `customer_profiles.id`
 * @param category   the Add_On_Category to activate (validated here)
 * @param payment    the payment context passed through to the SubscriptionService
 */
export async function activateAddOnCategoryAction(
  customerId: string,
  category: string,
  payment: AddOnActivationPayment,
): Promise<ActivateAddOnCategoryActionResult> {
  const gate = await checkGroupManage("customers");
  if (!gate.ok) {
    return { success: false, error: gate.error };
  }

  if (!customerId || customerId.trim().length === 0) {
    return {
      success: false,
      error: "A customer must be selected to activate an add-on category.",
      fieldErrors: { customerId: "Customer is required." },
    };
  }

  if (!isValidCategory(category)) {
    return {
      success: false,
      error: "Select a valid add-on category (MEAL, KIT, or ACCOMMODATION).",
      fieldErrors: { category: "Invalid category." },
    };
  }
  const validCategory: CustomerCategory = category;

  const result: ActivateAddOnResult = await serviceActivateAddOnCategory(
    customerId,
    validCategory,
    payment,
  );

  if (!result.ok) {
    return { success: false, error: result.message };
  }

  revalidatePath(ADMIN_CUSTOMERS_PATH);
  return { success: true, subscriptionId: result.subscriptionId };
}

// ---------------------------------------------------------------------------
// checkMobileUniqueAction — early duplicate-mobile check (Step 1 gate)
// ---------------------------------------------------------------------------

export type CheckMobileUniqueResult =
  | { available: true }
  | { available: false; message: string };

/**
 * Check whether a mobile number is already used by any user in the system.
 * Called when the admin clicks "Next" on Step 1 of the Quick Onboarding form
 * to catch duplicates early (before reaching the final onboarding RPC).
 *
 * @param mobile the raw 10-digit mobile number entered by the admin
 */
export async function checkMobileUniqueAction(
  mobile: string,
): Promise<CheckMobileUniqueResult> {
  // Basic format check
  if (!/^[6-9]\d{9}$/.test(mobile)) {
    return { available: false, message: "Enter a valid 10-digit mobile number." };
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("users")
    .select("id")
    .eq("mobile", mobile)
    .maybeSingle();

  if (error) {
    // On DB errors, let the onboarding proceed — the RPC will catch duplicates.
    return { available: true };
  }

  if (data) {
    return {
      available: false,
      message: "This mobile number is already registered in the system.",
    };
  }

  return { available: true };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Resolve the franchise the caller is scoped to, or `null` for a global admin
 * (ADMIN / MASTER_ADMIN see the whole network). A franchise-scoped admin
 * (FRANCHISE_ADMIN) is constrained to their assigned franchise for both the
 * serviceable-pincode gate and the dashboard list reads (Req 6.9/6.10).
 */
async function resolveScopedFranchiseId(): Promise<string | null> {
  const context = await resolveFranchiseContext();
  if (context && context.is_franchise_scoped && context.franchise_id) {
    return context.franchise_id;
  }
  return null;
}

/**
 * Resolve the serviceable pincodes used to build the address-serviceability
 * refinement in the Quick_Onboarding_Form schema (Req 5.6). Scoped to the
 * admin's franchise when franchise-scoped; otherwise the full set of served
 * pincodes. Returns a deduplicated, normalized list.
 */
async function resolveServiceablePincodes(
  franchiseId: string | null,
): Promise<string[]> {
  const admin = createAdminClient();

  let query = admin.from("rider_service_areas").select("pincode");
  if (franchiseId) {
    query = query.eq("franchise_id", franchiseId);
  }

  const { data, error } = await query;
  if (error) {
    // A serviceable-pincode lookup failure should not crash the action; the
    // schema simply treats no pincodes as "none serviceable" and the address
    // refinement will reject, surfacing a clear field error to the admin.
    return [];
  }

  return Array.from(
    new Set(
      (data ?? [])
        .map((row) =>
          typeof row.pincode === "string" ? normalizePincode(row.pincode) : "",
        )
        .filter((p): p is string => p.length > 0),
    ),
  );
}

/**
 * Flatten Zod issues into a `{ field → message }` map keyed by the dotted path
 * (e.g. `address.pincode`), mirroring the wizard's nested field structure so
 * each invalid input can be flagged in place (Req 4.6).
 */
function zodFieldErrors(
  issues: ReadonlyArray<{ path: PropertyKey[]; message: string }>,
): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const issue of issues) {
    const key = issue.path.map((segment) => String(segment)).join(".") || "_";
    if (!(key in errors)) {
      errors[key] = issue.message;
    }
  }
  return errors;
}

/** Extract a human-readable message from an unknown thrown value. */
function describeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  return typeof err === "string" ? err : "An unexpected error occurred.";
}

/**
 * Compute the number of calendar days from `startDate` to `endDate` inclusive.
 * Both must be YYYY-MM-DD strings. Returns 0 if startDate > endDate.
 * Pure over its inputs — uses UTC arithmetic to avoid timezone edge cases.
 */
function calendarDayCount(startDate: string, endDate: string): number {
  const [sy, sm, sd] = startDate.split("-").map(Number);
  const [ey, em, ed] = endDate.split("-").map(Number);
  const start = Date.UTC(sy, sm - 1, sd);
  const end = Date.UTC(ey, em - 1, ed);
  const diffMs = end - start;
  if (diffMs < 0) return 0;
  return Math.round(diffMs / (24 * 60 * 60 * 1000)) + 1;
}
