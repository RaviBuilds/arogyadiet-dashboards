"use server";

// src/actions/stayActions.ts
//
// Server Actions for stay lifecycle management.
// Handles stay extension, new stay creation, expiration marking,
// checkout, Save_Stay_Details (Recalculate_Stay), and active/history stay
// retrieval.
//
// Requirements: 4.4, 7.1, 7.2, 7.3, 7.4, 7.5, 8.1, 8.2, 8.3, 11.1, 11.2,
//   11.4, 12.1, 12.2, 12.3, 12.4, 12.5, 12.6, 12.8, 12.9, 12.10, 12.14,
//   12.16, 14.1, 14.2, 14.3, 14.4, 14.5

import { getCurrentAdminContext } from "@/lib/auth/adminAccess";
import { getISTDateString } from "@/lib/dates/ist";
import * as stayRepository from "@/repositories/stayRepository";
import * as AccommodationService from "@/services/AccommodationService";
import {
  validatePaymentHost,
  resolveCustomerMobile,
} from "@/services/AccommodationPaymentHostService";
import { setDietitianLink } from "@/services/AssignmentService";
import {
  extendStaySchema,
  createStaySchema,
  createRecalculateStaySchema,
  type ExtendStayInput,
} from "@/validations/accommodationSchema";
import type {
  StayEntry,
  StayBalanceSnapshot,
  SaveStayDetailsOutcome,
} from "@/types/accommodation";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Maps a StayEntryRow (snake_case DB row) to a StayEntry (camelCase domain type)
 * including the computed endDate and all payment-lifecycle columns.
 */
function mapRowToStayEntry(
  row: stayRepository.StayEntryRow
): StayEntry {
  const endDate = AccommodationService.computeEndDate(
    row.start_date,
    row.total_nights
  );

  return {
    id: row.id,
    customerProfileId: row.customer_profile_id,
    startDate: row.start_date,
    totalNights: row.total_nights,
    stayType: row.stay_type as StayEntry["stayType"],
    occupancyType: row.occupancy_type as StayEntry["occupancyType"],
    status: row.status as StayEntry["status"],
    paymentAmount: row.payment_amount,
    baseAmount: row.base_amount,
    taxAmount: row.tax_amount,
    taxPercentage: row.tax_percentage,
    paymentHostProfileId: row.payment_host_profile_id,
    mealPreference: row.meal_preference as StayEntry["mealPreference"],
    endDate,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    isBackdated: row.is_backdated,
    earlyCheckoutApplied: row.early_checkout_applied,
    actualNightsStayed: row.actual_nights_stayed,
    originalTotalNights: row.original_total_nights,
    originalTotalAmount: row.original_total_amount,
    recalculationApplied: row.recalculation_applied,
    checkedOutAt: row.checked_out_at,
    finalInvoicePaymentId: row.final_invoice_payment_id,
    finalInvoiceGeneratedAt: row.final_invoice_generated_at,
    finalInvoiceError: row.final_invoice_error,
  };
}

// ---------------------------------------------------------------------------
// Action result types
// ---------------------------------------------------------------------------

type ActionSuccess<T> = { success: true; data: T };
type ActionError = { error: string; fieldErrors?: Record<string, string> };
type ActionResult<T> = ActionSuccess<T> | ActionError;

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

/**
 * Extends an active stay by adding additional nights with an additional cost amount.
 *
 * Business rules:
 * - Admin auth required
 * - Stay must exist
 * - Stay must be in ACTIVE status
 * - No Payment_Transaction is created for the extension cost (Req 11.2)
 * - Returns the new end date and the updated balance snapshot (Req 11.4)
 *
 * Req 11.1, 11.2, 11.4, 14.1, 14.2, 14.6
 */
export async function extendStayAction(
  stayId: string,
  input: ExtendStayInput
): Promise<ActionResult<{ newEndDate: string; balance: StayBalanceSnapshot }>> {
  // 1. Admin-group authorisation
  const ctx = await getCurrentAdminContext();
  if (ctx.roleCode !== "ADMIN" && ctx.roleCode !== "MASTER_ADMIN") {
    return { error: "Unauthorized" };
  }

  // 2. Validate input
  const parsed = extendStaySchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const { additionalNights, paymentAmount } = parsed.data;

  // 3. Verify stay exists and is ACTIVE
  const stay = await stayRepository.getStayById(stayId);
  if (!stay) {
    return { error: "Stay entry not found" };
  }

  if (stay.status !== "ACTIVE") {
    return { error: "Only active stays can be extended" };
  }

  // 4. Delegate to service layer — returns newEndDate + balance snapshot
  const { newEndDate, balance } = await AccommodationService.extendStay(
    stayId,
    additionalNights,
    paymentAmount,
    ctx.userId
  );

  return { success: true, data: { newEndDate, balance } };
}

/**
 * Marks a stay as checked out (FINISHED).
 *
 * Applies to an ACTIVE stay and to an Awaiting_Checkout one — FINISHED by the
 * daily cron because its end date passed, but never closed by an admin, so its
 * money is still unsettled. For that second case `finalize_stay_checkout`
 * records the checkout at the stay's end date rather than at now(), because that
 * is the day the guest actually left; only the paperwork is late.
 *
 * Server-side gate: rejects an outstanding balance and a stay that is not
 * checkout-eligible, regardless of client-side button state.
 *
 * Flow: admin auth → call AccommodationService.checkoutStay → map reason
 * to user-facing error or return the outcome.
 *
 * Req 7.1, 7.2, 7.3, 7.4, 7.5
 */
export async function markStayCheckedOutAction(
  stayId: string
): Promise<
  ActionResult<{
    status: "FINISHED";
    invoiceStatus: "GENERATED" | "PENDING_RETRY" | "NOT_APPLICABLE";
  }>
> {
  // 1. Admin-group authorisation
  const ctx = await getCurrentAdminContext();
  if (ctx.roleCode !== "ADMIN" && ctx.roleCode !== "MASTER_ADMIN") {
    return { error: "Unauthorized" };
  }

  // 2. End-date gate (Req 12.13). A checkout may only be actioned once the stay
  //    has reached its inclusive end date. Leaving early is no longer a checkout
  //    variant: the admin first runs Recalculate Stay
  //    (`saveStayDetailsAction`), which moves the stay's end date in and
  //    recalculates Total_Stay_Amount for the nights actually stayed, then
  //    settles the balance, and only then presses Mark as Checked Out. Because
  //    the gate below reads the end date computed from `total_nights` — the very
  //    column Save_Stay_Details replaces — the recalculated date flows into it
  //    with no extra branch. Kept in the action rather than inside
  //    AccommodationService.checkoutStay so the service stays a single
  //    balance-and-status gate.
  const stayForDateGate = await stayRepository.getStayById(stayId);
  if (!stayForDateGate) {
    return { error: "Stay entry not found." };
  }

  const endDate = AccommodationService.computeEndDate(
    stayForDateGate.start_date,
    stayForDateGate.total_nights
  );
  const todayIST = getISTDateString(0);

  // YYYY-MM-DD strings compare correctly lexicographically.
  if (todayIST < endDate) {
    return {
      error: `This stay runs until ${endDate}. Checkout opens on that date — use Early Checkout to close it sooner and recalculate the amount.`,
    };
  }

  // 3. Delegate to service orchestration
  const result = await AccommodationService.checkoutStay(stayId);

  if (!result.ok) {
    // Map RPC reasons to user-facing messages
    switch (result.reason) {
      case "BALANCE_OUTSTANDING":
        return {
          error: `The full balance must be paid before checkout. Outstanding: ₹${result.remainingBalance ?? 0}.`,
        };
      case "NOT_ACTIVE":
        return {
          error:
            "This stay cannot be checked out — it has already been closed, or it never started.",
        };
      case "NOT_FOUND":
        return { error: "Stay entry not found." };
      default:
        return { error: "Checkout failed." };
    }
  }

  return {
    success: true,
    data: { status: result.status, invoiceStatus: result.invoiceStatus },
  };
}

/**
 * Saves recalculated stay details against an ACTIVE stay: replaces the stay's
 * Computed_End_Date (and with it Recalculated_Total_Nights, derived from the
 * date) and Total_Stay_Amount, and reports the single money follow-up the
 * Accommodation tab must render.
 *
 * **REPLACES the retired `earlyCheckoutStayAction`.** The old contract is gone
 * from this module entirely — no caller can reach it, and neither
 * `createEarlyCheckoutSchema` nor `EarlyCheckoutOutcome` is imported any more.
 * The behavioural difference that matters: this action performs **no status
 * transition and no invoice generation** (Req 12.9). The returned
 * `SaveStayDetailsOutcome` cannot express a checkout — `status` is the literal
 * `"ACTIVE"` and `nextAction` is always a money follow-up. Mark as Checked Out
 * stays the sole path to FINISHED, and it becomes available on its own once the
 * recalculated end date is reached and the balance is exactly zero.
 *
 * Repeatable any number of times while the stay is ACTIVE (Req 12.10);
 * rejected on any other status (Req 12.14).
 *
 * Flow: admin auth → fetch the stay for its `start_date` and *currently booked*
 * end date → validate through `createRecalculateStaySchema(startDate,
 * bookedEndDate)`, the same schema the dialog uses so acceptance is identical
 * on both sides (Req 12.5) → delegate the whole write to
 * `AccommodationService.saveStayDetails`, which is one `save_stay_details()`
 * RPC in one transaction (Req 12.16) → return the `SaveStayDetailsOutcome`.
 *
 * Failure reasons arrive from the service already mapped to their pinned
 * messages and field errors — `INVALID_END_DATE` naming the breached bound,
 * `AMOUNT_OUT_OF_RANGE` naming the valid 1–9,999,999 whole-number range, and
 * `NOT_ACTIVE` — and are passed through unchanged so the form can bind them
 * per field. No raw SQL error is ever surfaced.
 *
 * Req 12.5, 12.8, 12.9, 12.10, 12.14, 12.16
 */
export async function saveStayDetailsAction(
  stayId: string,
  input: unknown
): Promise<ActionResult<SaveStayDetailsOutcome>> {
  // 1. Admin-group authorisation, before any DB access
  const ctx = await getCurrentAdminContext();
  if (ctx.roleCode !== "ADMIN" && ctx.roleCode !== "MASTER_ADMIN") {
    return { error: "Unauthorized" };
  }

  // 2. Fetch the stay for the schema's inclusive bounds: its start date and the
  //    end date currently implied by `total_nights`. Both bounds are selectable
  //    — the start date itself yields exactly 1 night — so for a 1-night stay
  //    the range collapses to that single date rather than being empty.
  const stay = await stayRepository.getStayById(stayId);
  if (!stay) {
    return { error: "Stay entry not found." };
  }

  const bookedEndDate = AccommodationService.endDateFromNights(
    stay.start_date,
    stay.total_nights
  );

  // 3. Validate through the stay-bounded schema (Req 12.3, 12.4, 12.5)
  const schema = createRecalculateStaySchema(stay.start_date, bookedEndDate);
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const field = issue.path[0]?.toString();
      if (field && !(field in fieldErrors)) {
        fieldErrors[field] = issue.message;
      }
    }
    return {
      error: parsed.error.issues[0]?.message ?? "Invalid input",
      fieldErrors,
    };
  }

  const { recalculatedEndDate, recalculatedStayAmount } = parsed.data;

  // 4. Delegate to service orchestration — one RPC, one transaction
  const result = await AccommodationService.saveStayDetails(
    stayId,
    recalculatedEndDate,
    recalculatedStayAmount,
    ctx.userId
  );

  // The outcome type has no `ok` member, so its presence discriminates the
  // failure shape. The service has already mapped every reason
  // (NOT_FOUND / NOT_ACTIVE / INVALID_END_DATE / AMOUNT_OUT_OF_RANGE) to its
  // pinned message and field error; pass both through untouched.
  if ("ok" in result) {
    return result.fieldErrors
      ? { error: result.error, fieldErrors: result.fieldErrors }
      : { error: result.error };
  }

  return { success: true, data: result };
}

/**
 * Creates a new stay entry for a RETURNING accommodation customer, from the
 * Customer_360 Accommodation tab's Add New Stay dialog.
 *
 * Performs every operation the Quick_Onboard accommodation flow performs EXCEPT
 * the ones that belong to creating a customer (Supabase Auth identity, `users`
 * row, `customer_profiles` row, ACCOMMODATION subscription, temp PIN, medical
 * history) — this customer already has all of those. What it does share with
 * onboarding, through the very same code:
 *
 * - `createStaySchema`, whose payment-split and start-date refinements are
 *   literally the same functions the onboarding schema uses.
 * - `validatePaymentHost` for a Shared_Payment stay (Req 2.3, 2.4, 2.5), so
 *   host eligibility cannot drift between the two surfaces.
 * - `AccommodationService.createStay`, which derives the initial Stay_Status
 *   from the dates (a Backdated_Stay whose end date has passed is born
 *   FINISHED), computes the 18% GST breakup from Total_Stay_Amount, skips
 *   billing entirely for a Shared_Payment stay, and inserts exactly one ADVANCE
 *   ledger row when an advance was collected.
 *
 * Two things are specific to this path:
 * - Total nights are DERIVED from the submitted inclusive `endDate`, not typed.
 * - `dietitianUserId`, when provided, updates the CUSTOMER's `dietitian_id` —
 *   a Stay_Entry has no dietitian of its own. Omitted/empty leaves the existing
 *   assignment untouched.
 *
 * Business rules: the customer must have no stay occupying the Current Stay
 * surface — nothing ACTIVE, nothing PENDING, and nothing Awaiting_Checkout (a
 * stay the cron finished but no admin closed, whose money is still unsettled).
 * The dialog hides the button in all three cases; this is the server-side gate
 * for a direct POST.
 *
 * Req 2.1, 2.3, 2.4, 2.5, 3.4, 3.5, 4.2, 4.3, 4.5, 13.5, 14.3, 14.4
 */
export async function createNewStayAction(
  customerProfileId: string,
  input: unknown
): Promise<
  | {
      success: true;
      data: {
        stayId: string;
        /**
         * Set only when the stay committed but the Dietitian_Link write did
         * not. The stay exists either way — this is a warning, not a failure.
         */
        dietitianWarning?: string;
      };
    }
  | { error: string; fieldErrors?: Record<string, string> }
> {
  // 1. Admin-group authorisation, before any DB access. Server Actions are
  //    reachable by direct POST, so this gate is not a formality.
  const ctx = await getCurrentAdminContext();
  if (ctx.roleCode !== "ADMIN" && ctx.roleCode !== "MASTER_ADMIN") {
    return { error: "Unauthorized" };
  }

  // 2. Validate input
  const parsed = createStaySchema.safeParse(input);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const field = issue.path[0]?.toString();
      if (field && !(field in fieldErrors)) {
        fieldErrors[field] = issue.message;
      }
    }
    return {
      error: parsed.error.issues[0]?.message ?? "Invalid input",
      fieldErrors,
    };
  }

  const data = parsed.data;

  // 3. Nothing may already occupy the Current Stay surface.
  const activeStay = await stayRepository.getActiveStay(customerProfileId);
  if (activeStay) {
    return {
      error: "Current stay must be finished or expired before a new one can be created",
    };
  }

  const pendingStays = await stayRepository.getPendingStays(customerProfileId);
  if (pendingStays.length > 0) {
    return {
      error: "Current stay must be finished or expired before a new one can be created",
    };
  }

  // A stay the cron marked FINISHED on its end date but that no admin has
  // closed is financially OPEN. Stacking a new stay on top of it is how an
  // unsettled balance gets forgotten.
  const allStays = await stayRepository.getStaysByCustomer(customerProfileId);
  const awaitingCheckout = allStays.some((row) =>
    AccommodationService.isAwaitingCheckout({
      status: row.status,
      checkedOutAt: row.checked_out_at,
      isBackdated: row.is_backdated,
    })
  );
  if (awaitingCheckout) {
    return {
      error:
        "The previous stay is still awaiting checkout. Settle its balance and mark it as checked out before starting a new stay.",
    };
  }

  // 4. Shared_Payment host resolution (Req 2.1, 2.3, 2.4, 2.5). The
  //    self-reference check compares mobiles, so this customer's own mobile has
  //    to be resolved first.
  let paymentHostProfileId: string | null = null;

  if (data.isSharedPayment && data.paymentHostMobile) {
    const customerMobile = await resolveCustomerMobile(customerProfileId);
    if (!customerMobile) {
      return { error: "Customer record not found." };
    }

    const hostValidation = await validatePaymentHost(
      data.paymentHostMobile,
      customerMobile
    );

    if (!("success" in hostValidation)) {
      return hostValidation;
    }

    paymentHostProfileId = hostValidation.paymentHostProfileId;
  }

  // 5. Derive total nights from the inclusive end date (Req 12.3's inverse:
  //    `end − start + 1`), so the persisted `total_nights` and the submitted
  //    calendar date can never disagree.
  const totalNights = AccommodationService.nightsFromEndDate(
    data.startDate,
    data.endDate
  );

  // 6. Create the stay. Status, GST breakup, shared-payment billing skip, and
  //    the ADVANCE ledger row are all the service's business.
  let newStay: Awaited<ReturnType<typeof AccommodationService.createStay>>;
  try {
    newStay = await AccommodationService.createStay({
      customerProfileId,
      startDate: data.startDate,
      totalNights,
      stayType: data.stayType,
      occupancyType: data.occupancyType,
      mealPreference: data.mealPreference,
      paymentAmount: null, // deprecated — totalStayAmount takes precedence
      paymentHostProfileId,
      totalStayAmount: data.isSharedPayment ? null : (data.totalStayAmount ?? null),
      advanceAmountPaid: data.isSharedPayment ? 0 : (data.advanceAmountPaid ?? 0),
      backdatedStayEnabled: data.backdatedStayEnabled,
      createdBy: ctx.userId ?? null,
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to create stay entry.";
    return { error: `The stay could not be created: ${message}` };
  }

  // 7. Dietitian_Link, last and deliberately non-fatal. The stay row is
  //    already committed, so a failure here must not read as "the stay was not
  //    created". It is reported as a warning the admin can act on from the
  //    Profile tab instead.
  //
  //    Unscoped (no `requiredClinicId`), matching the Accommodation dropdown's
  //    all-Dietitians listing (Req 9.2), and routed through AssignmentService so
  //    the dietitian-validity check and the `admin_activity_logs` entry naming
  //    both endpoints happen here exactly as they do on every other assignment
  //    path. An empty string means "leave the existing assignment alone", which
  //    is why this is gated on a truthy value rather than on `!= null`.
  let dietitianWarning: string | undefined;

  if (data.dietitianUserId) {
    try {
      const linkResult = await setDietitianLink({
        customerProfileId,
        dietitianUserId: data.dietitianUserId,
        actingUserId: ctx.userId,
      });
      if (!linkResult.ok) {
        dietitianWarning = `Stay created, but the dietitian was not assigned: ${linkResult.message}`;
      }
    } catch {
      dietitianWarning =
        "Stay created, but the dietitian could not be assigned. Set it from the Profile tab.";
    }
  }

  return {
    success: true,
    data: { stayId: newStay.id, dietitianWarning },
  };
}

/**
 * Marks a PENDING stay as expired (no-show).
 *
 * Req 4.4, 4.6
 */
export async function markStayExpiredAction(
  stayId: string
): Promise<{ success: true } | { error: string }> {
  const result = await AccommodationService.markExpired(stayId);

  if ("error" in result) {
    return { error: result.error };
  }

  return { success: true };
}

/**
 * Gets the active stay for a customer. If no active stay exists,
 * returns the earliest pending stay. Returns null if neither exists.
 *
 * Req 8.1, 8.2
 */
export async function getActiveStayAction(
  customerProfileId: string
): Promise<{ success: true; data: StayEntry | null } | { error: string }> {
  try {
    // Try to get the active stay first
    const activeRow = await stayRepository.getActiveStay(customerProfileId);
    if (activeRow) {
      return { success: true, data: mapRowToStayEntry(activeRow) };
    }

    // Fall back to earliest pending stay
    const pendingStays = await stayRepository.getPendingStays(customerProfileId);
    if (pendingStays.length > 0) {
      return { success: true, data: mapRowToStayEntry(pendingStays[0]) };
    }

    return { success: true, data: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to fetch active stay";
    return { error: message };
  }
}

/**
 * Gets the stay history (FINISHED and EXPIRED) for a customer.
 *
 * Req 8.3, 14.5
 */
export async function getStayHistoryAction(
  customerProfileId: string
): Promise<{ success: true; data: StayEntry[] } | { error: string }> {
  try {
    const rows = await stayRepository.getStayHistory(customerProfileId);
    const stays = rows.map(mapRowToStayEntry);
    return { success: true, data: stays };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to fetch stay history";
    return { error: message };
  }
}

/**
 * Gets ALL stays for a customer (every Stay_Status), ordered by start_date
 * descending (most recent first). Used by the Accommodation_Tab so a
 * Backdated_Stay — FINISHED immediately at creation — is still selectable
 * and reachable for its payment panel and invoice action (Req 9.1, 9.2).
 *
 * Req 9.1, 9.2
 */
export async function getAllStaysAction(
  customerProfileId: string
): Promise<{ success: true; data: StayEntry[] } | { error: string }> {
  try {
    const rows = await stayRepository.getStaysByCustomer(customerProfileId);
    const stays = rows.map(mapRowToStayEntry);
    return { success: true, data: stays };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to fetch stays";
    return { error: message };
  }
}
