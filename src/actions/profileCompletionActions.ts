"use server";

// src/actions/profileCompletionActions.ts
//
// Customer-portal server actions for the profile-completion flow
// (customer-mobile-onboarding, Requirements 9 and 10). These are the thin
// orchestration layer between the client ProfileCompletionDialog and the
// OnboardingService: they authenticate the request from the session, resolve
// the authenticated customer's own `customer_profiles.id` + `users.id` (NEVER
// trusting client-supplied ids), then delegate the business rules to
// `OnboardingService.completeProfile`.
//
//   saveProfileCompletionAction(input)   — persist provided profile fields
//                                           WITHOUT marking onboarding complete
//                                           (Req 9.3/9.7; email path 10.7/10.8)
//   markOnboardingCompletedAction(input) — persist + transition IN_PROGRESS →
//                                           COMPLETED, then revalidate the
//                                           dashboard (Req 9.4/9.8)
//   submitRealEmailAction(email)         — replace an admin-entered Test_Email
//                                           with a customer-supplied real email
//                                           (Req 10.6/10.7/10.8)
//
// Requirements: 9.3, 9.4, 9.7, 9.8, 10.6, 10.7, 10.8

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { completeProfile } from "@/services/OnboardingService";
import type { ProfileCompletionInput } from "@/validations/profileCompletionSchema";
import { realEmailSchema } from "@/validations/realEmailSchema";

// ---------------------------------------------------------------------------
// Result type
// ---------------------------------------------------------------------------

/**
 * Uniform result the ProfileCompletionDialog consumes. On success the dialog
 * closes (and, for "mark completed", stops reappearing). On failure it retains
 * the entered values and surfaces `error` plus any per-field `fieldErrors`
 * (camelCase keys matching the dialog inputs) so it can flag each invalid field
 * (Req 9.7/10.7/10.8).
 */
export type ProfileCompletionActionResult =
  | { success: true; completed: boolean }
  | { error: string; fieldErrors?: Record<string, string> };

/**
 * Optional medical payload threaded into `markOnboardingCompletedAction` for
 * MEAL/KIT mandatory completion (mandatory-profile-completion-popup,
 * Requirements 4.1–4.3). The medical documents are uploaded client-side to the
 * `medical_records` bucket first; only lightweight `{ name, url, type }`
 * references cross to the server here. Omitting the argument preserves the
 * legacy optional-completion behavior for existing callers.
 */
export interface MarkCompletedMedicalExtras {
  /** The "I have no medical history" confirmation (Requirement 1.2). */
  medicalHistoryConfirmed?: boolean;
  /** References to medical documents already uploaded to `medical_records`. */
  medicalDocuments?: Array<{ name: string; url: string; type: string }>;
}

// ---------------------------------------------------------------------------
// Session → identity resolution (server-trusted, never client-supplied)
// ---------------------------------------------------------------------------

/**
 * The authenticated customer's own record ids, resolved entirely from the
 * session cookie. The client never supplies these — that is the whole point
 * of resolving them here (a Server Function is reachable via direct POST, so
 * any client-provided id would be a trust hole).
 */
interface ResolvedCustomer {
  /** `users.id` — needed to replace a Test_Email on the `users` row. */
  userId: string;
  /** `customer_profiles.id` — the record whose fields are being completed. */
  profileId: string;
}

/**
 * Resolve `{ userId, profileId }` for the currently authenticated customer.
 *
 * Mirrors the established customer-portal pattern (see `profileActions.ts` and
 * the customer dashboard/subscription pages): read the Supabase Auth user from
 * the session, map it to the internal `users` row via `auth_user_id`, then map
 * that to the `customer_profiles` row via `user_id`.
 *
 * Returns a `{ error }` result when the caller is unauthenticated or has no
 * customer profile, so every action fails closed.
 */
async function resolveAuthenticatedCustomer(): Promise<
  ResolvedCustomer | { error: string }
> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: "Unauthorized" };
  }

  // Map the auth identity to the internal `users` row (Req access is scoped to
  // the session's own identity).
  const { data: dbUser } = await supabase
    .from("users")
    .select("id")
    .eq("auth_user_id", user.id)
    .maybeSingle();
  if (!dbUser) {
    return { error: "User record not found." };
  }

  // Map to the customer profile that owns the completable fields.
  const { data: profile } = await supabase
    .from("customer_profiles")
    .select("id")
    .eq("user_id", dbUser.id)
    .maybeSingle();
  if (!profile) {
    return { error: "Customer profile not found." };
  }

  return { userId: dbUser.id as string, profileId: profile.id as string };
}

/** Map an OnboardingService completeProfile failure to the action result. */
function toActionError(result: {
  message: string;
  fieldErrors?: Record<string, string>;
}): { error: string; fieldErrors?: Record<string, string> } {
  return result.fieldErrors
    ? { error: result.message, fieldErrors: result.fieldErrors }
    : { error: result.message };
}

// ---------------------------------------------------------------------------
// saveProfileCompletionAction — persist provided fields (no completion)
// ---------------------------------------------------------------------------

/**
 * Persist the customer-supplied profile-completion fields WITHOUT transitioning
 * onboarding to COMPLETED (the customer is filling in details at their own pace,
 * Req 9.3). Every field is optional and independently validated by the service
 * via `profileCompletionSchema`; on any format failure the submission is
 * rejected with per-field messages and nothing is persisted (Req 9.7). If a
 * real `email` is included it replaces an admin-entered Test_Email, which is
 * rejected when already in use (Req 10.7).
 *
 * The target profile/user ids come from the session, not from `input`.
 */
export async function saveProfileCompletionAction(
  input: ProfileCompletionInput
): Promise<ProfileCompletionActionResult> {
  const resolved = await resolveAuthenticatedCustomer();
  if ("error" in resolved) {
    return { error: resolved.error };
  }

  const result = await completeProfile(resolved.profileId, input, {
    userId: resolved.userId,
    markCompleted: false,
  });

  if (!result.ok) {
    return toActionError(result);
  }

  // Reflect any persisted changes in the dashboard on next render.
  revalidatePath("/dashboard");
  return { success: true, completed: false };
}

// ---------------------------------------------------------------------------
// markOnboardingCompletedAction — persist + transition to COMPLETED
// ---------------------------------------------------------------------------

/**
 * Persist any provided fields and transition the Customer_Record from
 * IN_PROGRESS to COMPLETED — the "mark completed onboarding" action (Req 9.4).
 * A zero-field submission is valid, so the customer can complete without
 * providing anything (Req 9.2). Persistence is all-or-nothing (Req 9.8). After
 * a successful transition the dashboard is revalidated so the profile-completion
 * dialog no longer appears (Req 9.5).
 *
 * The target profile/user ids come from the session, not from `input`.
 *
 * The optional `medical` payload carries the MEAL/KIT mandatory-completion
 * data (mandatory-profile-completion-popup, Requirements 4.1–4.3): the "no
 * medical history" confirmation and references to medical documents already
 * uploaded to the `medical_records` bucket. When supplied, it is threaded into
 * `completeProfile` along with `requireMedicalHistory: true`, which enforces
 * the mandatory medical-history rule server-side (Req 1.2) and persists the
 * medical fields alongside the profile update. Existing callers that omit the
 * argument keep the legacy optional-completion behavior unchanged.
 */
export async function markOnboardingCompletedAction(
  input: ProfileCompletionInput,
  medical?: MarkCompletedMedicalExtras
): Promise<ProfileCompletionActionResult> {
  const resolved = await resolveAuthenticatedCustomer();
  if ("error" in resolved) {
    return { error: resolved.error };
  }

  const result = await completeProfile(resolved.profileId, input, {
    userId: resolved.userId,
    markCompleted: true,
    medicalHistoryConfirmed: medical?.medicalHistoryConfirmed,
    medicalDocuments: medical?.medicalDocuments,
    requireMedicalHistory: true,
  });

  if (!result.ok) {
    return toActionError(result);
  }

  // The record is now COMPLETED — refresh the dashboard so the dialog is gone.
  revalidatePath("/dashboard");
  return { success: true, completed: result.completed };
}

// ---------------------------------------------------------------------------
// submitRealEmailAction — replace a Test_Email with a real email
// ---------------------------------------------------------------------------

/**
 * Replace the admin-entered Test_Email with a customer-supplied real email
 * (Req 10.6). The email is format/length validated up front with
 * `realEmailSchema` (Req 10.8) before delegating to the service, which performs
 * the replacement and rejects an address already in use (Req 10.7), leaving the
 * existing Test_Email unchanged in that case.
 *
 * The target user id comes from the session, not from the caller.
 */
export async function submitRealEmailAction(
  email: string
): Promise<ProfileCompletionActionResult> {
  // (1) Validate format/length before any work (Req 10.8).
  const parsed = realEmailSchema.safeParse(email);
  if (!parsed.success) {
    return {
      error: "Enter a valid email address.",
      fieldErrors: {
        email: parsed.error.issues[0]?.message ?? "Enter a valid email address.",
      },
    };
  }

  const resolved = await resolveAuthenticatedCustomer();
  if ("error" in resolved) {
    return { error: resolved.error };
  }

  // (2) Delegate the replacement to the service (Req 10.6/10.7). Passing only
  //     `email` leaves all profile fields untouched.
  const result = await completeProfile(
    resolved.profileId,
    { email: parsed.data },
    { userId: resolved.userId, markCompleted: false }
  );

  if (!result.ok) {
    return toActionError(result);
  }

  revalidatePath("/dashboard");
  return { success: true, completed: false };
}
