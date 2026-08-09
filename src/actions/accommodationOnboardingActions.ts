"use server";

// src/actions/accommodationOnboardingActions.ts
//
// Server Actions for accommodation-specific customer onboarding and
// profile completion. Handles the ACCOMMODATION onboarding flow from the
// admin Quick Onboard form (with shared payment validation and transactional
// rollback) and the customer-facing profile completion with medical history.
//
// Requirements: 1.1, 1.9, 2.1, 2.3, 2.4, 2.5, 2.6, 3.1, 3.2, 3.3, 3.4, 3.5,
//               6.3, 6.4, 6.5

import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentAdminContext } from "@/lib/auth/adminAccess";
import * as AccommodationService from "@/services/AccommodationService";
import { validatePaymentHost } from "@/services/AccommodationPaymentHostService";
import {
  accommodationOnboardingSchema,
  type AccommodationOnboardingInput,
} from "@/validations/accommodationSchema";
import { placeholderEmailFor } from "@/lib/onboarding/testEmail";
import { hashPin } from "@/services/PinService";

// ---------------------------------------------------------------------------
// Result Types
// ---------------------------------------------------------------------------

export type OnboardAccommodationResult =
  | { success: true; data: { customerId: string; stayId: string } }
  | { error: string; fieldErrors?: Record<string, string> };

export type ProfileCompletionActionResult =
  | { success: true }
  | { error: string; fieldErrors?: Record<string, string> };

// `validatePaymentHost` used to live here as a private helper. It now sits in
// `@/services/AccommodationPaymentHostService` so the Add-New-Stay dialog for a
// returning guest resolves a Payment_Host through the exact same rules.

// ---------------------------------------------------------------------------
// onboardAccommodationCustomerAction
// ---------------------------------------------------------------------------

/**
 * Onboard a new accommodation customer from the admin Quick Onboard form.
 *
 * Flow:
 * 1. Validate input against accommodationOnboardingSchema
 * 2. Check duplicate mobile number in customer_profiles
 * 3. If shared payment: validate payment host
 * 4. Create customer_profile record (using createAdminClient)
 * 5. Create stay entry via AccommodationService.createStay()
 * 6. If stay creation fails, delete the just-created customer_profile (rollback)
 * 7. Return { success: true, data: { customerId, stayId } }
 *
 * Req 1.1, 1.9, 2.1, 2.3, 2.4, 2.5, 2.6, 3.1, 3.2, 3.3, 3.4, 3.5
 */
export async function onboardAccommodationCustomerAction(
  input: AccommodationOnboardingInput
): Promise<OnboardAccommodationResult> {
  // (1) Validate input against schema
  const parsed = accommodationOnboardingSchema.safeParse(input);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const field = issue.path[0]?.toString();
      if (field && !fieldErrors[field]) {
        fieldErrors[field] = issue.message;
      }
    }
    return {
      error: "Validation failed. Please check the form fields.",
      fieldErrors,
    };
  }

  const data = parsed.data;
  const admin = createAdminClient();

  // (2) Check if mobile number already exists in customer_profiles (Req 3.3)
  const { data: existingUser } = await admin
    .from("users")
    .select("id, customer_profiles!customer_profiles_user_id_fkey(id)")
    .eq("mobile", data.mobile)
    .maybeSingle();

  if (existingUser) {
    const profiles = existingUser.customer_profiles as
      | Array<{ id: string }>
      | { id: string }
      | null;
    const hasProfile = Array.isArray(profiles)
      ? profiles.length > 0
      : profiles !== null;

    if (hasProfile) {
      return {
        error: "This mobile number is already registered.",
        fieldErrors: {
          mobile: "This mobile number is already registered to a customer.",
        },
      };
    }
  }

  // (3) Shared payment host validation (Req 2.1, 2.3, 2.4, 2.5)
  let paymentHostProfileId: string | null = null;

  if (data.isSharedPayment && data.paymentHostMobile) {
    const hostValidation = await validatePaymentHost(
      data.paymentHostMobile,
      data.mobile
    );

    if (!("success" in hostValidation)) {
      return hostValidation;
    }

    paymentHostProfileId = hostValidation.paymentHostProfileId;
  }

  // (4) Create the Supabase Auth identity FIRST — required for the PIN-based
  // login flow, which establishes a session via signInWithPassword() using
  // this email + CUSTOMER_SERVER_PASSWORD (see pinAuthActions.ts). Without
  // this auth user, "Set New PIN" fails with a generic error after
  // onboarding succeeds. Mirrors OnboardingService.ts's pattern exactly.
  //
  // `users.email` is NOT NULL + UNIQUE (see scripts/add-test-email-flag-to-users.sql).
  // When the admin leaves email blank, generate the same deterministic
  // placeholder used by the generic onboarding flow so accommodation
  // customers without an email don't violate that constraint, and flag the
  // row with is_test_email so it's hidden from customer-facing views and can
  // be replaced with a real email later.
  const hasRealEmail = Boolean(data.email && data.email.trim() !== "");
  const userEmail = hasRealEmail
    ? (data.email as string)
    : placeholderEmailFor(data.mobile);

  const { data: authData, error: authError } = await admin.auth.admin.createUser({
    email: userEmail,
    password: process.env.CUSTOMER_SERVER_PASSWORD!,
    phone: `+91${data.mobile}`,
    email_confirm: true,
    phone_confirm: true,
    user_metadata: { full_name: data.fullName, onboarded_by_admin: true },
  });

  if (authError || !authData?.user) {
    return {
      error: authError?.message ?? "Failed to create the authentication identity.",
    };
  }
  const authUserId = authData.user.id;

  // Hash the admin-set temporary PIN — the customer will be prompted to set
  // a permanent PIN on first login (mirrors the generic onboarding flow's
  // pin_hash/is_temp_pin handling).
  let pinHash: string;
  try {
    pinHash = await hashPin(data.tempPin);
  } catch (err) {
    await admin.auth.admin.deleteUser(authUserId);
    const message = err instanceof Error ? err.message : "Invalid temporary PIN.";
    return {
      error: message,
      fieldErrors: { tempPin: message },
    };
  }

  // (5) Create user + customer_profile record
  const { data: newUser, error: userError } = await admin
    .from("users")
    .insert({
      auth_user_id: authUserId,
      full_name: data.fullName,
      mobile: data.mobile,
      email: userEmail,
      is_test_email: !hasRealEmail,
      pin_hash: pinHash,
      is_temp_pin: true,
      pin_set_at: new Date().toISOString(),
      role_id: null, // Will be set to CUSTOMER role if needed
    })
    .select("id")
    .single();

  if (userError) {
    // Compensate: remove the auth identity since the DB row failed.
    await admin.auth.admin.deleteUser(authUserId);

    // Check for duplicate mobile constraint violation
    if (
      userError.code === "23505" &&
      userError.message?.toLowerCase().includes("mobile")
    ) {
      return {
        error: "This mobile number is already registered.",
        fieldErrors: {
          mobile: "This mobile number is already registered to a customer.",
        },
      };
    }
    return {
      error: `Failed to create user record: ${userError.message}`,
    };
  }

  // Assign the CUSTOMER role
  const { data: customerRole } = await admin
    .from("roles")
    .select("id")
    .eq("code", "CUSTOMER")
    .maybeSingle();

  if (customerRole) {
    await admin
      .from("users")
      .update({ role_id: customerRole.id })
      .eq("id", newUser.id);
  }

  // Create the customer profile — includes the Dietitian_Link selected in
  // the Category & Plan step (dietitian-management, Req 9.4), persisted in
  // this SAME insert as the rest of the Customer_Record for atomicity.
  const { data: newProfile, error: profileError } = await admin
    .from("customer_profiles")
    .insert({
      user_id: newUser.id,
      is_active: true,
      gender: data.gender,
      dietary_preference: data.dietaryPreference,
      allergies: data.allergies || null,
      onboarding_status: "IN_PROGRESS",
      dietitian_id: data.dietitianUserId ?? null,
    })
    .select("id")
    .single();

  if (profileError) {
    // Rollback user + auth identity on profile creation failure
    await admin.from("users").delete().eq("id", newUser.id);
    await admin.auth.admin.deleteUser(authUserId);
    return {
      error: `Failed to create customer profile: ${profileError.message}`,
    };
  }

  // Create an ACCOMMODATION subscription record to track the category
  const { data: newSub, error: subError } = await admin.from("subscriptions").insert({
    customer_profile_id: newProfile.id,
    customer_category: "ACCOMMODATION",
    status: "ACTIVE",
    starts_on: data.startDate,
  }).select("id").single();

  if (subError) {
    // Rollback profile, user, and auth identity
    await admin.from("customer_profiles").delete().eq("id", newProfile.id);
    await admin.from("users").delete().eq("id", newUser.id);
    await admin.auth.admin.deleteUser(authUserId);
    return {
      error: `Failed to create subscription record: ${subError.message}`,
    };
  }

  // (5) Create stay entry via AccommodationService (Req 3.4)
  // Resolve admin identity for the createdBy attribution on the ADVANCE
  // ledger row. If context resolution fails (unlikely at this stage), fall
  // back to null rather than aborting the entire onboarding.
  let createdByUserId: string | null = null;
  try {
    const ctx = await getCurrentAdminContext();
    createdByUserId = ctx.userId ?? null;
  } catch {
    // Non-fatal — proceed without attribution.
  }

  try {
    const stay = await AccommodationService.createStay({
      customerProfileId: newProfile.id,
      startDate: data.startDate,
      totalNights: data.totalNights,
      stayType: data.stayType,
      occupancyType: data.occupancyType,
      mealPreference: data.mealPreference,
      paymentAmount: null, // deprecated — totalStayAmount takes precedence
      paymentHostProfileId,
      subscriptionId: newSub.id,
      totalStayAmount: data.isSharedPayment ? null : (data.totalStayAmount ?? null),
      advanceAmountPaid: data.isSharedPayment ? 0 : (data.advanceAmountPaid ?? 0),
      backdatedStayEnabled: data.backdatedStayEnabled,
      createdBy: createdByUserId,
    });

    return {
      success: true,
      data: { customerId: newProfile.id, stayId: stay.id },
    };
  } catch (err) {
    // (6) Rollback: delete subscription, customer_profile, user, and auth
    // identity if stay creation fails (Req 3.5)
    await admin
      .from("subscriptions")
      .delete()
      .eq("customer_profile_id", newProfile.id);
    await admin.from("customer_profiles").delete().eq("id", newProfile.id);
    await admin.from("users").delete().eq("id", newUser.id);
    await admin.auth.admin.deleteUser(authUserId);

    const message =
      err instanceof Error
        ? err.message
        : "Failed to create stay entry.";
    return {
      error: `Onboarding could not be completed: ${message}`,
    };
  }
}

// ---------------------------------------------------------------------------
// completeAccommodationProfileAction
// ---------------------------------------------------------------------------

/**
 * Input for the profile completion action with medical history data.
 */
export interface AccommodationProfileCompletionInput {
  customerProfileId: string;
  medicalHistoryNotes?: string | null;
  medicalHistoryConfirmed: boolean;
  medicalDocuments?: Array<{ name: string; url: string; type: string }>;
}

/**
 * Complete an accommodation customer's profile with medical history information.
 *
 * Validation:
 * - Either medicalHistoryNotes has content OR medicalHistoryConfirmed is checked (Req 6.3)
 * - Upload medical documents if provided (stored in medical_documents JSONB)
 * - Update customer_profiles: medical_history_notes, medical_history_confirmed,
 *   medical_documents, onboarding_status = 'COMPLETED'
 *
 * Req 6.3, 6.4, 6.5
 */
export async function completeAccommodationProfileAction(
  input: AccommodationProfileCompletionInput
): Promise<ProfileCompletionActionResult> {
  const {
    customerProfileId,
    medicalHistoryNotes,
    medicalHistoryConfirmed,
    medicalDocuments,
  } = input;

  // Validate: either notes has content OR confirmation checkbox is checked (Req 6.3)
  const hasNotes =
    medicalHistoryNotes !== null &&
    medicalHistoryNotes !== undefined &&
    medicalHistoryNotes.trim().length > 0;

  if (!hasNotes && !medicalHistoryConfirmed) {
    return {
      error:
        "Please provide medical history notes or confirm you have no medical history to share.",
      fieldErrors: {
        medicalHistoryNotes:
          "Either fill in your medical history or check the confirmation box.",
      },
    };
  }

  const admin = createAdminClient();

  // Verify the customer profile exists
  const { data: profile, error: fetchError } = await admin
    .from("customer_profiles")
    .select("id, onboarding_status")
    .eq("id", customerProfileId)
    .maybeSingle();

  if (fetchError || !profile) {
    return { error: "Customer profile not found." };
  }

  // Build the update payload
  const updatePayload: Record<string, unknown> = {
    medical_history_confirmed: medicalHistoryConfirmed,
    onboarding_status: "COMPLETED",
  };

  // If confirmation checkbox is checked, clear notes (Req 6.4)
  if (medicalHistoryConfirmed) {
    updatePayload.medical_history_notes = null;
  } else {
    updatePayload.medical_history_notes = medicalHistoryNotes?.trim() || null;
  }

  // Store medical documents if provided
  if (medicalDocuments && medicalDocuments.length > 0) {
    updatePayload.medical_documents = medicalDocuments;
  }

  // Update the customer profile
  const { error: updateError } = await admin
    .from("customer_profiles")
    .update(updatePayload)
    .eq("id", customerProfileId);

  if (updateError) {
    return {
      error: `Failed to update profile: ${updateError.message}`,
    };
  }

  return { success: true };
}
