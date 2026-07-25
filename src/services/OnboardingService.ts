// src/services/OnboardingService.ts
// Server-side orchestration for admin-initiated customer onboarding
// (customer-mobile-onboarding, Requirements 4, 5, 6, 8, 9, 10, 13, 14).
//
// LAYERING: Business service. It composes pure decision logic (`src/lib`),
// the data-access layer (`src/repositories/customerOnboardingRepository`), and
// the clinic-scope resolver (`src/lib/clinic`). It performs the ONE side effect
// the atomic RPC cannot: creating the Supabase Auth identity BEFORE the DB
// transaction, and compensating (deleting it) if the transaction rolls back —
// preserving the observable "no partial Customer_Record" invariant (Req 6.6).
// It holds NO `'use server'` wrappers (those live in `src/actions/*`) and does
// NO HTTP/auth-context work; the admin server action re-validates input with
// Zod and passes a resolved AdminContext.
//
// The public entry points mirror the design's OnboardingService:
//   onboard(payload, admin)          — the atomic quick-onboarding write
//   completeProfile(profileId, ...)  — validate + persist completable profile
//                                      fields, replace Test_Email, and optionally
//                                      transition to COMPLETED (Req 9, 10.6-10.8)
//   shouldShowProfileCompletionDialog(status) — read-side dialog gate (Req 9.5)
//   activateAddOnCategory(...)       — delegate to the SubscriptionService
//
// Requirements: 4.6, 4.7, 5.5, 6.1, 6.2, 6.3, 6.5, 6.6, 8.1, 8.2, 9.3, 9.4,
//               10.1, 10.6, 10.7, 10.8, 13.1, 13.2, 13.3, 13.4, 14.2, 14.5,
//               14.6, 14.7, 14.8

import { addDays, format, startOfDay } from "date-fns";
import { z } from "zod";

import { createAdminClient } from "@/lib/supabase/admin";
import { normalizeMobile } from "@/lib/mobile/normalizeMobile";
import { resolveClinicForPincode } from "@/lib/clinic/pincode-resolver";
import {
  assertValidCategory,
  type CustomerCategory,
} from "@/lib/onboarding/category";
import { placeholderEmailFor } from "@/lib/onboarding/testEmail";
import {
  generateUniqueCustomerCode,
  onboardCustomerAtomic,
  replaceTestEmailWithReal,
  setOnboardingCompleted,
  updateProfileFields,
  type OnboardCustomerRpcInput,
  type OnboardIds,
  type ProfileFieldPatch,
} from "@/repositories/customerOnboardingRepository";
import type { QuickOnboardingInput } from "@/validations/onboardingSchema";
import {
  profileCompletionSchema,
  type ProfileCompletionInput,
} from "@/validations/profileCompletionSchema";
import { pastDayStatusBoundary } from "@/lib/onboarding/cutoff";
import {
  generateDailyPreferences,
  RecordCountMismatchError,
  type DailyPreferencesContext,
} from "@/lib/onboarding/dailyPreferences";
import type { PastDayStatus } from "@/types/onboarding";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * The resolved admin context passed by the server action. `adminUserId` is
 * recorded as `created_by` on the new `users` row; the customer's own
 * `franchise_id`/`clinic_id` are resolved from the Primary_Address pincode
 * (Req 14.5), NOT taken from the admin.
 */
export interface AdminContext {
  /** `users.id` of the admin performing the onboarding (audit `created_by`). */
  adminUserId?: string | null;
}

/**
 * Why an onboarding attempt was rejected. Each maps to a specific, non-generic
 * message the action/UI layer surfaces (Req 4.6/4.7/8.1/13/14.6).
 */
export type OnboardFailureReason =
  | "PAYMENT_NOT_PAID" // Req 8.1: Payment_Status must be PAID
  | "INVALID_MOBILE" // Req 4.1/3.2: mobile not a valid 10-digit number
  | "INVALID_CATEGORY" // Req 13.1: Primary_Category outside the allowed set
  | "SCOPE_UNRESOLVED" // Req 14.6: franchise_id/clinic_id could not be resolved
  | "PLAN_NOT_FOUND" // selected subscription plan does not exist
  | "DUPLICATE_MOBILE" // Req 4.7/12.4: mobile already used by a Customer_Record
  | "EMAIL_IN_USE" // Req 10.7: email already belongs to another user
  | "AUTH_FAILED" // Supabase Auth identity creation failed
  | "ERROR"; // any other failure; nothing was persisted (Req 6.6)

/**
 * The outcome of {@link onboard}. On success it carries the ids created by the
 * atomic RPC plus the Supabase Auth `authUserId`. On failure nothing was
 * persisted (the auth identity, if it was created, has been compensated away).
 */
export type OnboardOutcome =
  | { ok: true; ids: OnboardIds; authUserId: string }
  | {
      ok: false;
      reason: OnboardFailureReason;
      message: string;
      /** Field → message, for form-level rejection (Req 4.6). */
      fieldErrors?: Record<string, string>;
    };

/**
 * Options for {@link completeProfile}.
 */
export interface CompleteProfileOptions {
  /**
   * Transition Onboarding_Status IN_PROGRESS → COMPLETED after persisting the
   * provided fields — the "mark completed onboarding" action (Req 9.4/14.3).
   * The customer may complete with any subset of fields provided (Req 9.2).
   */
  markCompleted?: boolean;
  /**
   * `users.id` for the customer. Required ONLY when a real `email` is provided
   * in the patch, so the Test_Email can be replaced (Req 10.6/10.7/10.8).
   */
  userId?: string | null;
  /**
   * Enforce the mandatory medical-history rule server-side for MEAL/KIT
   * mandatory completion (Requirement 1.2/1.3). When set, the submission is
   * rejected with a `VALIDATION` result and a `medicalHistoryNotes` field error
   * — persisting nothing and leaving Onboarding_Status unchanged — unless
   * {@link medicalHistoryConfirmed} is `true` OR `input.medicalHistoryNotes`
   * has non-whitespace content. This backs up the client-side disabled button
   * so the rule holds even against a direct action invocation.
   */
  requireMedicalHistory?: boolean;
  /**
   * The "I have no medical history" confirmation (Requirement 1.2). When `true`
   * the persisted `medical_history_notes` is cleared to `null` and
   * `medical_history_confirmed` is set to `true`; otherwise the trimmed notes
   * are persisted and `medical_history_confirmed` is set to `false`. Mirrors
   * `completeAccommodationProfileAction`.
   */
  medicalHistoryConfirmed?: boolean;
  /**
   * Medical-document references to persist to the `customer_profiles`
   * `medical_documents` JSONB field (Requirements 4.2/4.5). An empty or absent
   * array persists an empty field.
   */
  medicalDocuments?: Array<{ name: string; url: string; type: string }>;
}

/**
 * The outcome of {@link completeProfile}.
 *   - success carries `completed` = whether the record was transitioned to
 *     COMPLETED in this call (Req 9.4).
 *   - `VALIDATION` — one or more provided fields failed format validation
 *     (Req 9.7); `fieldErrors` identifies each, values are retained by the UI.
 *   - `EMAIL_IN_USE` — the submitted real email already belongs to another user
 *     (Req 10.7); the existing Test_Email is retained unchanged.
 *   - `PERSISTENCE` — a persistence step failed; no partial profile change is
 *     surfaced as success (Req 9.8).
 */
export type CompleteProfileResult =
  | { ok: true; completed: boolean }
  | {
      ok: false;
      reason: "VALIDATION" | "EMAIL_IN_USE" | "PERSISTENCE";
      message: string;
      /** Field (camelCase, matching the dialog inputs) → message (Req 9.7). */
      fieldErrors?: Record<string, string>;
    };

/**
 * Payment context for an add-on activation. The concrete shape is owned by the
 * SubscriptionService (task 6.6, built in parallel); this permissive type keeps
 * the delegation boundary decoupled without importing that module's internals.
 */
export interface AddOnActivationPayment {
  amount: number;
  status?: string;
  paymentMethod?: string | null;
  paymentReference?: string | null;
  [key: string]: unknown;
}

/** The outcome of {@link activateAddOnCategory}. */
export type ActivateAddOnResult =
  | { ok: true; subscriptionId?: string }
  | { ok: false; reason: string; message: string };

/**
 * The interface the OnboardingService expects from the SubscriptionService.
 * Declared locally so onboarding type-checks independently of the parallel
 * SubscriptionService implementation (task 6.6).
 */
export interface SubscriptionServiceLike {
  activateAddOnCategory(
    customerId: string,
    category: CustomerCategory,
    payment: AddOnActivationPayment
  ): Promise<ActivateAddOnResult>;
}

/**
 * Optional PIN context passed by the server action when an admin sets a
 * temporary PIN during onboarding (Req 6.4, 6.5, 6.6, 14.1, 14.2).
 */
export interface PinContext {
  /** The bcrypt hash of the temporary PIN (already hashed by the action). */
  pinHash: string;
  /** Whether this is a temporary PIN (always true at onboarding). */
  isTempPin: boolean;
}

/**
 * Optional delivery charge context passed by the server action when a delivery
 * charge is included in the onboarding (delivery-charges-management, Req 6.1–6.5).
 */
export interface DeliveryChargeContext {
  /** The final delivery charge amount (admin-confirmed or auto-calculated). */
  deliveryCharge: number;
  /** The system-calculated delivery charge (null if calculation failed/not attempted). */
  calculatedDeliveryCharge?: number | null;
}

// ---------------------------------------------------------------------------
// onboard — the atomic quick-onboarding write
// ---------------------------------------------------------------------------

/**
 * Onboard a customer from a validated Quick_Onboarding_Form payload.
 *
 * Order of operations (mirrors the design's Onboarding Transaction Flow):
 *   1. Gate on `Payment_Status == PAID` (Req 8.1/8.2) — reject before any work.
 *   2. Validate exactly-one valid Primary_Category (Req 13.1-13.4).
 *   3. Normalize the mobile (Req 3.2) — reject an invalid number.
 *   4. Resolve `clinic_id`/`franchise_id` from the Primary_Address pincode and
 *      REJECT if the pincode maps to no clinic (Req 14.5/14.6). Nothing is
 *      persisted on an unresolved scope.
 *   5. Determine the email + `is_test_email`: a real admin-entered email, an
 *      admin-entered placeholder Test_Email, or a deterministic placeholder
 *      derived from the mobile when none is supplied (Req 10.1/10.2/10.3).
 *   6. Generate a unique `customer_code` (Req 14.7/14.8) and resolve the plan
 *      pricing for the invoice amount.
 *   7. Create the Supabase Auth phone identity FIRST (the only step outside the
 *      DB transaction).
 *   8. Invoke the atomic `onboard_customer` RPC (Req 6.6). If it fails, COMPENSATE
 *      by deleting the just-created auth identity and return an error, so no
 *      partial Customer_Record is ever observable.
 *
 * @param payload the Zod-validated Quick_Onboarding_Form input
 * @param admin   the resolved admin context (audit `created_by`)
 * @param pin     optional PIN context for setting a temp PIN at onboarding
 */
export async function onboard(
  payload: QuickOnboardingInput,
  admin: AdminContext = {},
  pin?: PinContext,
  delivery?: DeliveryChargeContext,
): Promise<OnboardOutcome> {
  // (1) PAID precondition (Req 8.1/8.2). No customer record is persisted while
  //     Payment_Status is anything other than PAID.
  if (payload.paymentStatus !== "PAID") {
    return {
      ok: false,
      reason: "PAYMENT_NOT_PAID",
      message: "Payment must be marked done (PAID) before onboarding can proceed.",
      fieldErrors: { paymentStatus: "Payment must be marked PAID." },
    };
  }

  // (2) Exactly one valid Primary_Category (Req 13.1-13.4). The schema already
  //     constrains this to the enum, but re-assert defensively at the service
  //     boundary since services are a trust boundary of their own.
  try {
    assertValidCategory(payload.primaryCategory);
  } catch {
    return {
      ok: false,
      reason: "INVALID_CATEGORY",
      message: "Select exactly one valid Primary_Category (MEAL, KIT, or ACCOMMODATION).",
      fieldErrors: { primaryCategory: "Invalid Primary_Category." },
    };
  }
  const category: CustomerCategory = payload.primaryCategory;

  // (3) Normalize the mobile (Req 3.2). Reject a syntactically invalid number.
  const normalized = normalizeMobile(payload.mobile);
  if (!normalized.ok) {
    return {
      ok: false,
      reason: "INVALID_MOBILE",
      message: "Enter a valid 10-digit mobile number.",
      fieldErrors: { mobile: "Invalid mobile number." },
    };
  }
  const mobile = normalized.value;

  // (4) Resolve clinic_id/franchise_id from the Primary_Address pincode
  //     (Req 14.5). Reject if the pincode maps to no clinic (Req 14.6) —
  //     nothing is persisted on an unresolved scope.
  //     Exception: KIT category bypasses serviceability — any pincode is accepted.
  //     For KIT customers, if the admin manually selected a clinic, use that.
  const resolution = await resolveClinicForPincode(payload.address.pincode);
  let clinicId: string | null = null;
  let franchiseId: string | null = null;

  if (resolution.type === "resolved") {
    clinicId = resolution.clinic_id;
    franchiseId = await resolveFranchiseIdForClinic(clinicId);
  } else if (category !== "KIT") {
    // Only reject for non-KIT categories; KIT can ship anywhere
    return {
      ok: false,
      reason: "SCOPE_UNRESOLVED",
      message:
        "The selected address could not be matched to a serviceable clinic. Onboarding was not completed.",
      fieldErrors: { "address.pincode": "This area is not served by any clinic." },
    };
  }

  // For KIT customers, allow manually assigned clinic from admin form
  if (category === "KIT" && !clinicId && payload.clinicId) {
    clinicId = payload.clinicId;
    franchiseId = await resolveFranchiseIdForClinic(clinicId);
  }

  // (5) Determine the email + Test_Email flag (Req 10.1/10.2/10.3).
  const { email, isTestEmail } = resolveEmail(payload, mobile);

  // (6) Unique customer_code (Req 14.7/14.8) + plan pricing for the invoice.
  let customerCode: string;
  try {
    customerCode = await generateUniqueCustomerCode();
  } catch (err) {
    return { ok: false, reason: "ERROR", message: describeError(err) };
  }

  const roleId = await resolveCustomerRoleId();
  if (!roleId) {
    return {
      ok: false,
      reason: "ERROR",
      message: "System configuration error: CUSTOMER role not found.",
    };
  }

  // Category-based subscription field validation and pricing resolution
  let plan: PlanPricing | null = null;
  let kitProduct: KitProductPricing | null = null;

  if (category === "KIT") {
    // KIT category: requires kitProductId and kitDurationDays (Req 2.1, 2.2, 2.3)
    if (!payload.kitProductId || !payload.kitDurationDays) {
      const fieldErrors: Record<string, string> = {};
      if (!payload.kitProductId) {
        fieldErrors.kitProductId = "Select a KIT product.";
      }
      if (!payload.kitDurationDays) {
        fieldErrors.kitDurationDays = "Enter kit duration in days.";
      }
      return {
        ok: false,
        reason: "ERROR",
        message: "KIT category requires a product selection and duration.",
        fieldErrors,
      };
    }
    kitProduct = await resolveKitProductPricing(payload.kitProductId);
    if (!kitProduct) {
      return {
        ok: false,
        reason: "ERROR",
        message: "The selected KIT product could not be found.",
        fieldErrors: { kitProductId: "Select a valid KIT product." },
      };
    }
  } else if (category === "MEAL") {
    // MEAL category: requires planId (Req 4.4)
    if (!payload.planId) {
      return {
        ok: false,
        reason: "PLAN_NOT_FOUND",
        message: "MEAL category requires a subscription plan selection.",
        fieldErrors: { planId: "Select a subscription plan." },
      };
    }
    plan = await resolvePlanPricing(payload.planId);
    if (!plan) {
      return {
        ok: false,
        reason: "PLAN_NOT_FOUND",
        message: "The selected subscription plan could not be found.",
        fieldErrors: { planId: "Select a valid subscription plan." },
      };
    }
  }

  const start = startOfDay(new Date(payload.startDate || new Date()));
  const startsOn = format(start, "yyyy-MM-dd");
  
  // Calculate end date based on category
  let endsOn: string | null = null;
  if (category === "KIT" && kitProduct && payload.kitDurationDays) {
    endsOn = format(addDays(start, payload.kitDurationDays - 1), "yyyy-MM-dd");
  } else if (category === "MEAL" && plan) {
    endsOn = plan.totalDays > 0
      ? format(addDays(start, plan.totalDays - 1), "yyyy-MM-dd")
      : null;
  }
  
  const nowIso = new Date().toISOString();

  // (6a) Resolve meal category ID for initial meal preference
  const mealCategoryId = await resolveMealCategoryId(payload.initialMealPreference);
  if (!mealCategoryId) {
    return {
      ok: false,
      reason: "ERROR",
      message: "System configuration error: Meal category not found.",
      fieldErrors: { initialMealPreference: "Invalid meal preference." },
    };
  }

  // (7) Create the Supabase Auth phone identity FIRST — the only step outside
  //     the DB transaction (compensated by deletion on RPC failure below).
  const admin_client = createAdminClient();
  const { data: authData, error: authError } =
    await admin_client.auth.admin.createUser({
      email,
      password: process.env.CUSTOMER_SERVER_PASSWORD!,
      phone: `+91${mobile}`,
      email_confirm: true,
      phone_confirm: true,
      user_metadata: { full_name: payload.fullName, onboarded_by_admin: true },
    });

  if (authError || !authData?.user) {
    return {
      ok: false,
      reason: "AUTH_FAILED",
      message: authError?.message ?? "Failed to create the authentication identity.",
    };
  }
  const authUserId = authData.user.id;

  // (8) Atomic, all-or-nothing DB write (Req 6.6).
  const rpcInput: OnboardCustomerRpcInput = {
    user: {
      auth_user_id: authUserId,
      role_id: roleId,
      full_name: payload.fullName,
      email,
      mobile,
      is_test_email: isTestEmail,
      franchise_id: franchiseId,
      created_by: admin.adminUserId ?? null,
      // PIN auth columns (Req 6.4, 6.5, 6.6, 14.1, 14.2) — included when
      // the admin sets a temporary PIN during onboarding.
      ...(pin ? { pin_hash: pin.pinHash, is_temp_pin: pin.isTempPin } : {}),
    },
    profile: {
      customer_code: customerCode,
      gender: payload.gender,
      dietary_preference: payload.dietaryPreference,
      allergies: payload.allergies ?? null,
      source: "QUICK_ONBOARDING",
      franchise_id: franchiseId,
      clinic_id: clinicId,
    },
    subscription: {
      // Category-specific fields (Req 2.1, 2.2, 2.3, 4.4, 7.1)
      plan_id: category === "MEAL" ? (payload.planId ?? null) : null,
      kit_product_id: category === "KIT" ? (payload.kitProductId ?? null) : null,
      kit_duration_days: category === "KIT" ? (payload.kitDurationDays ?? null) : null,
      customer_category: category,
      starts_on: startsOn,
      ends_on: endsOn,
      effective_end_on: endsOn,
      status: "ACTIVE",
      total_days: category === "MEAL" && plan ? plan.totalDays : (payload.kitDurationDays ?? 0),
      pause_credits_total: category === "MEAL" && plan ? plan.pauseCredits : 0,
      delivery_charge: delivery?.deliveryCharge ?? 0,
      franchise_id: franchiseId,
      initial_meal_category_id: mealCategoryId,  // For daily preferences generation
    },
    payment: {
      amount: (category === "MEAL" && plan ? plan.totalAmount : (kitProduct?.totalAmount ?? 0)) + (delivery?.deliveryCharge ?? 0),
      base_amount: category === "MEAL" && plan ? plan.baseAmount : (kitProduct?.baseAmount ?? 0),
      tax_percent: category === "MEAL" && plan ? plan.taxPercent : (kitProduct?.taxPercent ?? 5),
      tax_amount: category === "MEAL" && plan ? plan.taxAmount : (kitProduct?.taxAmount ?? 0),
      delivery_charge: delivery?.deliveryCharge ?? 0,
      paid_at: nowIso,
      payment_method: "COUNTER",
      franchise_id: franchiseId,
    },
    address: {
      tag: payload.address.tag,
      street_1: buildStreet1(payload.address),
      street_2: payload.address.streetAddress || payload.address.searchText || null,
      city: payload.address.city,
      state: payload.address.state,
      pincode: payload.address.pincode,
      lat: payload.address.lat,
      lng: payload.address.lng,
      franchise_id: franchiseId,
      clinic_id: clinicId,
    },
  };

  const result = await onboardCustomerAtomic(rpcInput);

  if (!result.ok) {
    // COMPENSATE: the transaction rolled back, so delete the pre-created auth
    // identity to keep the "no partial Customer_Record" invariant (Req 6.6).
    await safeDeleteAuthUser(authUserId);

    if (result.reason === "DUPLICATE_MOBILE") {
      return {
        ok: false,
        reason: "DUPLICATE_MOBILE",
        message: result.message,
        fieldErrors: { mobile: "This mobile number is already registered." },
      };
    }
    if (result.reason === "EMAIL_IN_USE") {
      return {
        ok: false,
        reason: "EMAIL_IN_USE",
        message: result.message,
        fieldErrors: { email: "This email address is already in use." },
      };
    }
    return { ok: false, reason: "ERROR", message: result.message };
  }

  // ─── Past-Date Daily Preferences Generation ──────────────────────────────
  // When pastDateEnabled is true and pastDayStatuses are present, generate
  // daily preference records for the entire subscription period:
  //   - Past days use the captured statuses (Delivered/Skipped)
  //   - Future days use the initial meal preference and primary address
  //   - Skipped days extend effective_end_on and increment pause_credits_used
  // (Requirements 3.3, 4.1–4.6, 6.1–6.7)
  if (
    payload.pastDateEnabled &&
    payload.pastDayStatuses &&
    payload.pastDayStatuses.length > 0 &&
    category === "MEAL" &&
    plan &&
    endsOn
  ) {
    try {
      const pastDayStatuses = payload.pastDayStatuses as PastDayStatus[];

      // Resolve meal category IDs for all meal types (VEG, EGG, CHICKEN).
      const mealCategoryMap = await resolveMealCategoryMap();

      // Resolve secondary address ID if one of the past days references it.
      const hasSecondaryAddress = pastDayStatuses.some(
        (s) => s.deliveryAddress === "Secondary",
      );
      let secondaryAddressId: string | null = null;
      if (hasSecondaryAddress) {
        secondaryAddressId = await resolveSecondaryAddressId(
          result.ids.profile_id,
          result.ids.address_id,
        );
      }

      // Compute the boundary date for past/future day separation.
      const boundaryDate = pastDayStatusBoundary(new Date());

      // Generate daily preference records (pure computation).
      const prefsResult = generateDailyPreferences({
        subscriptionId: result.ids.subscription_id,
        customerProfileId: result.ids.profile_id,
        startsOn,
        originalEndsOn: endsOn,
        totalDays: plan.totalDays,
        initialMealCategoryId: mealCategoryId,
        primaryAddressId: result.ids.address_id,
        secondaryAddressId,
        mealCategoryMap,
        boundaryDate,
        pastDayStatuses,
      });

      // Persist the generated daily preference records.
      const admin_db = createAdminClient();
      const { error: prefsError } = await admin_db
        .from("subscription_daily_preferences")
        .insert(prefsResult.records);

      if (prefsError) {
        // Daily preferences insertion failed — compensate the entire onboarding.
        await safeDeleteAuthUser(authUserId);
        return {
          ok: false,
          reason: "ERROR",
          message: "Failed to generate daily preferences. No changes were saved. Please try again.",
        };
      }

      // Update the subscription with effective_end_on and pause_credits_used
      // if there were skipped days.
      if (prefsResult.skippedCount > 0) {
        const { error: subUpdateError } = await admin_db
          .from("subscriptions")
          .update({
            effective_end_on: prefsResult.effectiveEndOn,
            pause_credits_used: prefsResult.skippedCount,
          })
          .eq("id", result.ids.subscription_id);

        if (subUpdateError) {
          // Subscription update failed — compensate.
          await safeDeleteAuthUser(authUserId);
          return {
            ok: false,
            reason: "ERROR",
            message: "Failed to update subscription end date. No changes were saved. Please try again.",
          };
        }
      }
    } catch (err) {
      if (err instanceof RecordCountMismatchError) {
        // Record count validation failed — this is a logic error, not a DB error.
        await safeDeleteAuthUser(authUserId);
        return {
          ok: false,
          reason: "ERROR",
          message: err.message,
        };
      }
      // Unexpected error during daily preferences generation.
      await safeDeleteAuthUser(authUserId);
      return {
        ok: false,
        reason: "ERROR",
        message: describeError(err),
      };
    }
  }

  return { ok: true, ids: result.ids, authUserId };
}

// ---------------------------------------------------------------------------
// completeProfile — persist completable profile fields
// ---------------------------------------------------------------------------

/**
 * Persist the customer-supplied profile-completion fields to a Customer_Record
 * and, optionally, transition it to COMPLETED (Req 9). Behaviour:
 *
 *   1. Validate every provided field for format via `profileCompletionSchema`
 *      (Req 9.2/9.3). All fields are optional, so a zero-field submission is
 *      valid; each populated field is validated independently.
 *   2. On ANY format failure, reject WITHOUT persisting anything and return
 *      per-field messages so the dialog retains the entered values and flags
 *      each invalid field (Req 9.7).
 *   3. If a real `email` is provided, replace the placeholder Test_Email first
 *      (Req 10.6). A rejected email — already in use (Req 10.7) — aborts the
 *      whole submission before any profile write, so the existing Test_Email is
 *      retained unchanged and no partial change occurs. Email format is already
 *      guaranteed by step 1 (Req 10.8). Requires `options.userId`.
 *   4. Persist the provided profile fields as a single atomic UPDATE — either
 *      all provided fields persist or none do (Req 9.8). An empty patch is a
 *      no-op, so a zero-field "mark completed" still succeeds (Req 9.2).
 *   5. When `options.markCompleted` is set, transition IN_PROGRESS → COMPLETED
 *      (Req 9.4/14.3). Onboarding_Status is constrained to the {IN_PROGRESS,
 *      COMPLETED} enumeration by construction here and by the DB CHECK
 *      constraint (Req 14.1); this path can only ever write COMPLETED.
 *
 * Ordering note: the email replacement (a `users` write) and the profile-field
 * write (a `customer_profiles` write) are separate single-row operations. Email
 * is applied first because an already-in-use email is a deterministic business
 * rejection that must abort the submission with no partial change. Format
 * validation up front (step 1) removes the only input-driven partial-write path.
 *
 * @param profileId the `customer_profiles.id` to update
 * @param input     the profile-completion fields (all optional, camelCase)
 * @param options   `markCompleted` transitions to COMPLETED; `userId` enables
 *                  Test_Email replacement when an `email` is provided
 */
export async function completeProfile(
  profileId: string,
  input: ProfileCompletionInput,
  options: CompleteProfileOptions = {}
): Promise<CompleteProfileResult> {
  // (1) Validate every provided field for format (Req 9.2/9.3/9.7). On any
  //     failure, reject before persisting anything and surface per-field
  //     messages; the dialog retains the entered values.
  const parsed = profileCompletionSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      reason: "VALIDATION",
      message: "Some fields are invalid. Please correct them and try again.",
      fieldErrors: zodFieldErrors(parsed.error),
    };
  }

  const { email, ...profileFields } = parsed.data;

  // (1a) Server-side mandatory medical-history check (Req 1.2/1.3), ordered
  //      BEFORE any persistence (email replacement + profile write) so a
  //      rejection persists nothing and leaves Onboarding_Status unchanged.
  //      Accepted iff the confirmation is checked OR the notes contain
  //      non-whitespace content. Mirrors `completeAccommodationProfileAction`.
  if (options.requireMedicalHistory) {
    const hasNotes =
      typeof profileFields.medicalHistoryNotes === "string" &&
      profileFields.medicalHistoryNotes.trim().length > 0;
    if (options.medicalHistoryConfirmed !== true && !hasNotes) {
      return {
        ok: false,
        reason: "VALIDATION",
        message:
          "Please provide medical history notes or confirm you have no medical history to share.",
        fieldErrors: {
          medicalHistoryNotes:
            "Either fill in your medical history or check the confirmation box.",
        },
      };
    }
  }

  // (2) Mobile-first email replacement (Req 10.6/10.7/10.8), applied BEFORE the
  //     profile write so a rejected email aborts the whole submission with no
  //     partial change and the existing Test_Email is retained unchanged.
  if (email !== undefined) {
    if (!options.userId) {
      return {
        ok: false,
        reason: "PERSISTENCE",
        message: "Cannot update the email address: the customer identity is unknown.",
      };
    }
    const emailResult = await replaceTestEmailWithReal(options.userId, email);
    if (!emailResult.ok) {
      if (emailResult.reason === "EMAIL_IN_USE") {
        return {
          ok: false,
          reason: "EMAIL_IN_USE",
          message: "This email address is already in use.",
          fieldErrors: { email: "This email address is already in use." },
        };
      }
      return {
        ok: false,
        reason: "PERSISTENCE",
        message: emailResult.message,
      };
    }
  }

  // (3) Persist the provided profile fields (Req 9.3). A single-row UPDATE is
  //     atomic — all provided fields persist or none do (Req 9.8). An empty
  //     patch is a no-op, so a zero-field submission still succeeds (Req 9.2).
  const patch = toProfileFieldPatch(profileFields);

  // Medical-completion persistence (MEAL/KIT mandatory flow), mirroring the
  // accommodation data model (Req 4.2/4.3/4.5). Applied only when a medical
  // payload is in play so the legacy optional flow is unchanged.
  const hasMedicalCompletion =
    options.requireMedicalHistory === true ||
    options.medicalHistoryConfirmed !== undefined ||
    options.medicalDocuments !== undefined;
  if (hasMedicalCompletion) {
    if (options.medicalHistoryConfirmed === true) {
      // Confirmation clears notes (Req 4.3, mirror of accommodation Req 6.4).
      patch.medical_history_notes = null;
      patch.medical_history_confirmed = true;
    } else {
      const trimmed =
        typeof profileFields.medicalHistoryNotes === "string"
          ? profileFields.medicalHistoryNotes.trim()
          : "";
      patch.medical_history_notes = trimmed.length > 0 ? trimmed : null;
      patch.medical_history_confirmed = false;
    }
    // An empty/absent array persists an empty field (Req 4.5).
    patch.medical_documents = options.medicalDocuments ?? [];
  }

  try {
    await updateProfileFields(profileId, patch);
  } catch (err) {
    return { ok: false, reason: "PERSISTENCE", message: describeError(err) };
  }

  // (4) Optionally transition IN_PROGRESS → COMPLETED (Req 9.4/14.3). Only
  //     COMPLETED can ever be written here, satisfying the status enumeration
  //     guard (Req 14.1) by construction.
  if (options.markCompleted) {
    try {
      await setOnboardingCompleted(profileId);
    } catch (err) {
      return { ok: false, reason: "PERSISTENCE", message: describeError(err) };
    }
  }

  return { ok: true, completed: options.markCompleted === true };
}

/**
 * Pure read-side gate for the profile-completion dialog (Req 9.5). The dialog
 * is presented only while a Customer_Record is IN_PROGRESS; once COMPLETED it
 * must not be shown on subsequent logins. The UI/action calls this with the
 * record's stored `onboarding_status`.
 */
export function shouldShowProfileCompletionDialog(
  onboardingStatus: string | null | undefined
): boolean {
  return onboardingStatus === "IN_PROGRESS";
}

// ---------------------------------------------------------------------------
// activateAddOnCategory — delegate to the SubscriptionService
// ---------------------------------------------------------------------------

/**
 * Activate an Add_On_Category for an existing customer by delegating to the
 * SubscriptionService (Req 13.7-13.11), which owns the payment gating,
 * at-most-one-active-per-category rule, and isolation of existing subscriptions.
 *
 * The concrete SubscriptionService is built in parallel (task 6.6); it can be
 * injected via `deps.subscriptionService` (used by tests and the server action)
 * or is loaded lazily from `@/services/SubscriptionService` at call time.
 *
 * @param customerId the target `customer_profiles.id`
 * @param category   the Add_On_Category to activate (validated here, Req 13.1)
 * @param payment    the payment context passed through to the SubscriptionService
 * @param deps       optional injected SubscriptionService (defaults to the module)
 */
export async function activateAddOnCategory(
  customerId: string,
  category: CustomerCategory,
  payment: AddOnActivationPayment,
  deps: { subscriptionService?: SubscriptionServiceLike } = {}
): Promise<ActivateAddOnResult> {
  try {
    assertValidCategory(category);
  } catch {
    return {
      ok: false,
      reason: "INVALID_CATEGORY",
      message: "Invalid Customer_Category for add-on activation.",
    };
  }

  let service: SubscriptionServiceLike;
  try {
    service = deps.subscriptionService ?? (await loadSubscriptionService());
  } catch (err) {
    return {
      ok: false,
      reason: "SERVICE_UNAVAILABLE",
      message: describeError(err),
    };
  }

  return service.activateAddOnCategory(customerId, category, payment);
}

/**
 * Namespaced export mirroring the design's `OnboardingService.xxx(...)`
 * interface, for callers that prefer the object form.
 */
export const OnboardingService = {
  onboard,
  completeProfile,
  shouldShowProfileCompletionDialog,
  activateAddOnCategory,
};

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Plan pricing/duration resolved for the onboarding invoice + subscription. */
interface ResolvedPlanPricing {
  totalAmount: number;
  baseAmount: number;
  taxAmount: number;
  taxPercent: number;
  totalDays: number;
  pauseCredits: number;
}

/** KIT product pricing resolved for the onboarding invoice + subscription. */
interface ResolvedKitProductPricing {
  totalAmount: number;
  baseAmount: number;
  taxAmount: number;
  taxPercent: number;
  productName: string;
}

// Type aliases for clarity in the onboard function
type PlanPricing = ResolvedPlanPricing;
type KitProductPricing = ResolvedKitProductPricing;

/**
 * Resolve the invoice amount, tax breakdown, duration, and pause credits for a
 * subscription plan, mirroring the existing admin subscription logic: prefer
 * the stored `base_price`/`tax_amount`, otherwise reverse-calculate at 5% from
 * `price`. Returns `null` when the plan does not exist.
 */
async function resolvePlanPricing(
  planId: string
): Promise<ResolvedPlanPricing | null> {
  const admin = createAdminClient();
  const { data: plan, error } = await admin
    .from("subscription_plans")
    .select("price, base_price, tax_amount, duration_days, pause_credits")
    .eq("id", planId)
    .maybeSingle();

  if (error || !plan) {
    return null;
  }

  let baseAmount: number;
  let taxAmount: number;
  let taxPercent: number;
  let totalAmount: number;

  if (plan.base_price != null && plan.tax_amount != null) {
    baseAmount = Number(plan.base_price);
    taxAmount = Number(plan.tax_amount);
    taxPercent = baseAmount > 0 ? (taxAmount / baseAmount) * 100 : 5;
    totalAmount = baseAmount + taxAmount;
  } else {
    totalAmount = Number(plan.price ?? 0);
    baseAmount = totalAmount / 1.05;
    taxAmount = totalAmount - baseAmount;
    taxPercent = 5;
  }

  return {
    totalAmount,
    baseAmount,
    taxAmount,
    taxPercent,
    totalDays: Number(plan.duration_days ?? 0),
    pauseCredits: Number(plan.pause_credits ?? 0),
  };
}

/**
 * Resolve the invoice amount and tax breakdown for a KIT product, using
 * the stored base_price (which is the INCLUSIVE price) and fixed 5% tax rate.
 * The base_price in the database is already inclusive of tax, so we reverse-
 * calculate the exclusive base and tax portion.
 * 
 * Example: base_price = ₹10,400 (inclusive of 5% tax)
 *   exclusive base = 10400 / 1.05 = ₹9,904.76
 *   tax = 10400 - 9904.76 = ₹495.24
 *   total = ₹10,400
 * 
 * Returns `null` when the product does not exist or is inactive.
 */
async function resolveKitProductPricing(
  kitProductId: string
): Promise<ResolvedKitProductPricing | null> {
  const admin = createAdminClient();
  const { data: product, error } = await admin
    .from("kit_products")
    .select("name, base_price, tax_rate, is_active")
    .eq("id", kitProductId)
    .eq("is_active", true)
    .maybeSingle();

  if (error || !product) {
    return null;
  }

  const inclusivePrice = Number(product.base_price ?? 0);
  const taxRate = Number(product.tax_rate ?? 0.05);
  const taxPercent = taxRate * 100; // Convert to percentage
  // Reverse-calculate: base_price is inclusive, so exclusive = inclusive / (1 + rate)
  const baseAmount = inclusivePrice / (1 + taxRate);
  const taxAmount = inclusivePrice - baseAmount;
  const totalAmount = inclusivePrice; // Total is the stored price itself

  return {
    totalAmount: Number(totalAmount.toFixed(2)),
    baseAmount: Number(baseAmount.toFixed(2)),
    taxAmount: Number(taxAmount.toFixed(2)),
    taxPercent,
    productName: product.name as string,
  };
}

/**
 * Resolve the `franchise_id` for a resolved clinic. A Core clinic legitimately
 * has a `null` franchise_id (not an unresolved scope), so `null` is a valid
 * result here — only a missing CLINIC (handled by the caller) rejects onboarding
 * (Req 14.5/14.6).
 */
async function resolveFranchiseIdForClinic(
  clinicId: string
): Promise<string | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("clinics")
    .select("franchise_id")
    .eq("id", clinicId)
    .maybeSingle();

  return (data?.franchise_id as string | null) ?? null;
}

/** Resolve the CUSTOMER role id (mirrors the legacy customer-creation flow). */
async function resolveCustomerRoleId(): Promise<string | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("roles")
    .select("id")
    .eq("code", "CUSTOMER")
    .maybeSingle();

  return (data?.id as string | null) ?? null;
}

/**
 * Resolve the meal_category_id for a meal preference code (VEG, EGG, CHICKEN).
 * Returns null if the category doesn't exist.
 */
async function resolveMealCategoryId(code: string): Promise<string | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("meal_categories")
    .select("id")
    .eq("code", code)
    .maybeSingle();

  return (data?.id as string | null) ?? null;
}

/**
 * Decide the stored email and `is_test_email` flag (Req 10.1/10.2/10.3):
 *   - a real admin-entered email with the checkbox unchecked → stored verbatim,
 *     `is_test_email = false`.
 *   - an admin-entered placeholder with the "test email" checkbox checked →
 *     stored as-is, `is_test_email = true`.
 *   - no email supplied → a deterministic placeholder derived from the unique
 *     mobile, `is_test_email = true` (never collides, hidden from the customer).
 */
function resolveEmail(
  payload: QuickOnboardingInput,
  mobile: string
): { email: string; isTestEmail: boolean } {
  const provided = payload.email?.trim();
  if (provided && provided.length > 0) {
    return { email: provided, isTestEmail: payload.isTestEmail === true };
  }
  return { email: placeholderEmailFor(mobile), isTestEmail: true };
}

/**
 * Compose `addresses.street_1` from the captured flat/floor inputs. Flat number
 * is required by the Address_Capture schema (Req 5.4/5.8); floor and the
 * auto-filled area are appended when present.
 */
function buildStreet1(address: QuickOnboardingInput["address"]): string {
  const parts = [address.flatNumber];
  if (address.floorNumber && address.floorNumber.trim().length > 0) {
    parts.push(`Floor ${address.floorNumber.trim()}`);
  }
  if (address.area && address.area.trim().length > 0) {
    parts.push(address.area.trim());
  }
  return parts.join(", ");
}

/**
 * Best-effort deletion of a pre-created Supabase Auth identity used to
 * compensate a rolled-back onboarding transaction (Req 6.6). Swallows its own
 * error: the DB write already rolled back, so the worst case is an orphaned
 * auth identity, which must never mask the original onboarding failure.
 */
async function safeDeleteAuthUser(authUserId: string): Promise<void> {
  try {
    const admin = createAdminClient();
    await admin.auth.admin.deleteUser(authUserId);
  } catch {
    // Intentionally ignored — see doc comment.
  }
}

/**
 * Lazily load the SubscriptionService (task 6.6, built in parallel). The module
 * specifier is held in a variable so this file type-checks independently of the
 * parallel implementation; the module is resolved at runtime when it exists.
 */
async function loadSubscriptionService(): Promise<SubscriptionServiceLike> {
  const specifier: string = "@/services/SubscriptionService";
  const mod = (await import(specifier)) as unknown as {
    SubscriptionService?: SubscriptionServiceLike;
    activateAddOnCategory?: SubscriptionServiceLike["activateAddOnCategory"];
  };

  if (mod.SubscriptionService) {
    return mod.SubscriptionService;
  }
  if (typeof mod.activateAddOnCategory === "function") {
    return { activateAddOnCategory: mod.activateAddOnCategory };
  }
  throw new Error("SubscriptionService is not available.");
}

/** Extract a human-readable message from an unknown thrown value. */
function describeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  return typeof err === "string" ? err : "An unexpected error occurred.";
}

/**
 * Map the validated, camelCase profile-completion fields to the repository's
 * snake_case {@link ProfileFieldPatch}. Only keys explicitly present in the
 * validated input are carried over, so omitted fields are left unchanged on the
 * Customer_Record (Req 9.3). `email` is handled separately (it lives on `users`).
 */
function toProfileFieldPatch(
  fields: Omit<ProfileCompletionInput, "email">
): ProfileFieldPatch {
  const patch: ProfileFieldPatch = {};
  if (fields.gender !== undefined) patch.gender = fields.gender;
  if (fields.dietaryPreference !== undefined)
    patch.dietary_preference = fields.dietaryPreference;
  if (fields.allergies !== undefined) patch.allergies = fields.allergies;
  if (fields.dateOfBirth !== undefined) patch.date_of_birth = fields.dateOfBirth;
  if (fields.medicalHistoryNotes !== undefined)
    patch.medical_history_notes = fields.medicalHistoryNotes;
  return patch;
}

/**
 * Flatten a Zod validation error into a `{ field → message }` map keyed by the
 * top-level (camelCase) field name, so the dialog can flag each invalid field
 * (Req 9.7). The first issue per field wins.
 */
function zodFieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.length > 0 ? String(issue.path[0]) : "_form";
    if (!(key in out)) {
      out[key] = issue.message;
    }
  }
  return out;
}

// ─── Past-Date Onboarding Helpers ──────────────────────────────────────────────

/**
 * Resolve a map from meal type codes (VEG, EGG, CHICKEN) to their
 * `meal_categories.id` UUIDs. Used to map the captured PastDayStatus.mealType
 * to the correct meal_category_id for daily preference records.
 */
async function resolveMealCategoryMap(): Promise<Record<string, string>> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("meal_categories")
    .select("id, code")
    .in("code", ["VEG", "EGG", "CHICKEN"]);

  const map: Record<string, string> = {};
  if (data) {
    for (const row of data) {
      const record = row as { id: string; code: string };
      map[record.code] = record.id;
    }
  }
  return map;
}

/**
 * Resolve the secondary (non-primary) address ID for a customer profile.
 * Returns null when no secondary address exists. Used for past-date onboarding
 * where a delivered day's deliveryAddress is "Secondary".
 *
 * Note: At onboarding time, the customer typically only has ONE address (the
 * just-created primary address). If the admin captured "Secondary" in the
 * PastDayStatus popup, but no secondary address exists, the generation logic
 * falls back to the primary address. This edge case is documented in the
 * design's resolveDeliveryAddress function.
 */
async function resolveSecondaryAddressId(
  customerProfileId: string,
  primaryAddressId: string,
): Promise<string | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("addresses")
    .select("id")
    .eq("customer_profile_id", customerProfileId)
    .neq("id", primaryAddressId)
    .limit(1)
    .maybeSingle();

  return (data?.id as string | null) ?? null;
}
