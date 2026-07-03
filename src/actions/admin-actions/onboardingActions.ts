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
import { isStartDateAllowed } from "@/lib/onboarding/cutoff";
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
} from "@/services/OnboardingService";
import { isValidPinFormat } from "@/lib/pin/pinUtils";
import { hashPin } from "@/services/PinService";

// ---------------------------------------------------------------------------
// Action result types
// ---------------------------------------------------------------------------

/**
 * Result of {@link onboardCustomerAction}. On failure the action returns a
 * top-level `error` plus optional per-field `fieldErrors` so the wizard can
 * flag each invalid input and retain the admin's entered values (Req 4.6).
 */
export type OnboardCustomerActionResult =
  | { success: true; ids: OnboardIds }
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

  // (5) Start date must be on/after the earliest selectable date (Req 7.7).
  if (!isStartDateAllowed(input.startDate, new Date())) {
    return {
      success: false,
      error: "The selected subscription start date is not permitted for the current cutoff.",
      fieldErrors: {
        startDate: "Select an allowed start date (respecting the 5 PM cutoff).",
      },
    };
  }

  // (6) Delegate the atomic write to the service (Req 6.1-6.6).
  const outcome = await serviceOnboard(input, { adminUserId }, { pinHash, isTempPin: true });
  if (!outcome.ok) {
    return {
      success: false,
      error: outcome.message,
      fieldErrors: outcome.fieldErrors,
    };
  }

  // (7) Refresh the Customers dashboard sections (Req 6.9).
  revalidatePath(ADMIN_CUSTOMERS_PATH);

  return { success: true, ids: outcome.ids };
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
