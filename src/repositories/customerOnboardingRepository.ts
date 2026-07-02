// src/repositories/customerOnboardingRepository.ts
// Data-access layer for the customer mobile-onboarding feature.
//
// LAYERING: Data-access ONLY. This is the single module that talks to Supabase
// for onboarding reads/writes. It performs NO business validation (that lives
// in `src/lib/onboarding/*`, `src/validations/*`, and the services in
// `src/services/*`) and contains NO `'use server'` wrappers (those live in
// `src/actions/*`). It uses the service-role admin client, mirroring the
// franchise/clinic data-access pattern (see clinicRepository.ts).
//
// Its one domain-aware responsibility is translating raw Postgres failures into
// the specific, meaningful outcomes the callers reason about — a duplicate
// mobile (Req 4.7 / 12.4) and an email already in use (Req 10.7) — rather than
// leaking constraint names or SQL error text up the stack.
//
// Requirements: 3.1, 6.6, 9.3, 9.4, 10.6, 10.7, 12.4, 14.7, 14.8

import { createAdminClient } from "@/lib/supabase/admin";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * A single record associated with a mobile number, flattened from the
 * `users` ← `roles` / `customer_profiles` relationships. Zero, one, or many of
 * these may share a mobile; the {@link EligibilityChecker} (and the duplicate
 * check at onboarding) interpret the set — this repository only reports it
 * (Req 3.1, 12.4).
 */
export interface CustomerLookup {
  /** `users.id`. */
  userId: string;
  /** The role code (e.g. `"CUSTOMER"`), or `null` when the role is missing. */
  roleCode: string | null;
  /** The canonical mobile stored on `users.mobile`. */
  mobile: string | null;
  /** The linked `customer_profiles.id`, or `null` when no profile exists. */
  profileId: string | null;
  /** `customer_profiles.onboarding_status`, or `null` when no profile exists. */
  onboardingStatus: string | null;
  /** The stored email (may be a placeholder Test_Email). */
  email: string | null;
  /** Whether `users.email` is a placeholder Test_Email (Req 10.3/10.4). */
  isTestEmail: boolean;
}

/** The `user` block of the {@link onboard_customer} RPC payload. */
export interface OnboardUserInput {
  auth_user_id?: string | null;
  role_id?: string | null;
  full_name: string;
  email: string;
  mobile: string;
  is_test_email?: boolean;
  franchise_id?: string | null;
  created_by?: string | null;
  /** Bcrypt hash of the temporary PIN set by the admin at onboarding (Req 6.4). */
  pin_hash?: string | null;
  /** Whether the PIN is a temporary admin-set PIN (Req 6.6). */
  is_temp_pin?: boolean;
}

/** The `profile` block of the RPC payload. */
export interface OnboardProfileInput {
  customer_code: string;
  gender?: string | null;
  dietary_preference?: string | null;
  allergies?: string | null;
  date_of_birth?: string | null;
  medical_history_notes?: string | null;
  has_medical_history?: boolean;
  source?: string | null;
  franchise_id?: string | null;
  clinic_id?: string | null;
}

/** The `subscription` block of the RPC payload. */
export interface OnboardSubscriptionInput {
  plan_id: string;
  subscription_code?: string | null;
  customer_category: string;
  starts_on: string;
  ends_on?: string | null;
  effective_end_on?: string | null;
  status?: string | null;
  total_days?: number | null;
  pause_credits_total?: number | null;
  franchise_id?: string | null;
}

/** The `payment` block of the RPC payload. */
export interface OnboardPaymentInput {
  amount: number;
  base_amount?: number | null;
  tax_percent?: number | null;
  tax_amount?: number | null;
  discount_amount?: number | null;
  payment_method?: string | null;
  paid_at?: string | null;
  payment_reference?: string | null;
  payment_notes?: string | null;
  franchise_id?: string | null;
}

/** The `address` block of the RPC payload. */
export interface OnboardAddressInput {
  tag?: string | null;
  street_1: string;
  street_2?: string | null;
  landmark?: string | null;
  city?: string | null;
  state?: string | null;
  pincode: string;
  lat?: number | null;
  lng?: number | null;
  franchise_id?: string | null;
  clinic_id?: string | null;
}

/**
 * The full payload passed to the `onboard_customer` RPC (matches the shape
 * documented in `scripts/create-onboard-customer-rpc.sql`).
 */
export interface OnboardCustomerRpcInput {
  user: OnboardUserInput;
  profile: OnboardProfileInput;
  subscription: OnboardSubscriptionInput;
  payment: OnboardPaymentInput;
  address: OnboardAddressInput;
}

/** The ids returned by a successful atomic onboarding write. */
export interface OnboardIds {
  user_id: string;
  profile_id: string;
  subscription_id: string;
  payment_id: string;
  address_id: string;
}

/**
 * Outcome of {@link onboardCustomerAtomic}. Business-meaningful failures are
 * modeled explicitly instead of surfaced as raw Postgres errors (Req 6.6):
 *   - `DUPLICATE_MOBILE` — the mobile already belongs to a user (Req 4.7/12.4).
 *   - `EMAIL_IN_USE`     — the email already belongs to a user (Req 10.7).
 *   - `ERROR`            — any other failure; the transaction rolled back whole.
 */
export type OnboardResult =
  | { ok: true; ids: OnboardIds }
  | {
      ok: false;
      reason: "DUPLICATE_MOBILE" | "EMAIL_IN_USE" | "ERROR";
      message: string;
    };

/**
 * Franchise/clinic scoping for the dashboard list reads. A `null`/omitted value
 * means "do not filter on that column" (network-wide / clinic-agnostic).
 */
export interface OnboardingScope {
  franchiseId?: string | null;
  clinicId?: string | null;
}

/** A row rendered in the admin Onboarded / Completed dashboard sections. */
export interface CustomerRow {
  profileId: string;
  userId: string | null;
  customerCode: string | null;
  fullName: string | null;
  mobile: string | null;
  email: string | null;
  isTestEmail: boolean;
  onboardingStatus: string;
  franchiseId: string | null;
  clinicId: string | null;
  createdAt: string | null;
}

/** The completable `customer_profiles` fields a customer may fill in later. */
export interface ProfileFieldPatch {
  gender?: string | null;
  dietary_preference?: string | null;
  allergies?: string | null;
  date_of_birth?: string | null;
  medical_history_notes?: string | null;
}

/**
 * Outcome of {@link replaceTestEmailWithReal}. An email already used by another
 * user is reported as `EMAIL_IN_USE` (Req 10.7) rather than a raw DB error.
 */
export type ReplaceEmailResult =
  | { ok: true }
  | { ok: false; reason: "EMAIL_IN_USE" | "ERROR"; message: string };

// ---------------------------------------------------------------------------
// Error classification helpers
// ---------------------------------------------------------------------------

/** Postgres SQLSTATE for a unique_violation. */
const PG_UNIQUE_VIOLATION = "23505";

/** The subset of a PostgrestError this module inspects to classify failures. */
interface PgErrorLike {
  code?: string | null;
  message?: string | null;
  details?: string | null;
  hint?: string | null;
}

/**
 * Returns which unique column a failure collided on, or `null` when the error
 * is not a recognizable unique violation on `mobile`/`email`. Inspects the
 * SQLSTATE plus the message/details text (constraint or column name), which is
 * how Postgres surfaces the offending column for a UNIQUE conflict.
 */
function classifyUniqueViolation(
  error: PgErrorLike | null | undefined
): "mobile" | "email" | null {
  if (!error) return null;

  const haystack = `${error.message ?? ""} ${error.details ?? ""} ${
    error.hint ?? ""
  }`.toLowerCase();

  const isUnique =
    error.code === PG_UNIQUE_VIOLATION || haystack.includes("duplicate key");
  if (!isUnique) return null;

  // Order matters: prefer the most specific column match.
  if (haystack.includes("mobile")) return "mobile";
  if (haystack.includes("email")) return "email";
  return null;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/**
 * Find every record associated with a (canonical) mobile number. Returns 0..n
 * lookups joining `users` to its role and (optional) customer profile. Callers
 * derive eligibility and duplicate-mobile decisions from the returned set
 * (Req 3.1, 12.4) — this function applies no policy of its own.
 *
 * The mobile is expected to already be normalized to the 10-digit
 * `users.mobile` form via `normalizeMobile`.
 */
export async function findCustomerByMobile(
  mobile: string
): Promise<CustomerLookup[]> {
  const admin = createAdminClient();

  const { data, error } = await admin
    .from("users")
    .select(
      "id, mobile, email, is_test_email, roles(code), customer_profiles(id, onboarding_status)"
    )
    .eq("mobile", mobile);

  if (error) {
    throw new Error(
      `Failed to look up customers by mobile: ${error.message}`
    );
  }

  return (data ?? []).map((row) => {
    const record = row as Record<string, unknown>;

    // `roles` is a to-one embed but supabase-js may type it as object|array.
    const role = extractOne(record.roles) as
      | { code?: string | null }
      | null;
    // `customer_profiles.user_id` is UNIQUE, so this is effectively to-one.
    const profile = extractOne(record.customer_profiles) as
      | { id?: string | null; onboarding_status?: string | null }
      | null;

    return {
      userId: String(record.id),
      roleCode: role?.code ?? null,
      mobile: (record.mobile as string | null) ?? null,
      profileId: profile?.id ?? null,
      onboardingStatus: profile?.onboarding_status ?? null,
      email: (record.email as string | null) ?? null,
      isTestEmail: Boolean(record.is_test_email),
    };
  });
}

/**
 * List Customer_Records in the given onboarding status, optionally scoped to a
 * franchise and/or clinic, for the admin dashboard sections (Req 6.9/6.10).
 * Newest first.
 */
export async function listByOnboardingStatus(
  status: "IN_PROGRESS" | "COMPLETED",
  scope: OnboardingScope = {}
): Promise<CustomerRow[]> {
  const admin = createAdminClient();

  let query = admin
    .from("customer_profiles")
    .select(
      "id, customer_code, onboarding_status, franchise_id, clinic_id, created_at, users(id, full_name, mobile, email, is_test_email)"
    )
    .eq("onboarding_status", status);

  if (scope.franchiseId != null) {
    query = query.eq("franchise_id", scope.franchiseId);
  }
  if (scope.clinicId != null) {
    query = query.eq("clinic_id", scope.clinicId);
  }

  const { data, error } = await query.order("created_at", { ascending: false });

  if (error) {
    throw new Error(
      `Failed to list customers with status ${status}: ${error.message}`
    );
  }

  return (data ?? []).map((row) => {
    const record = row as Record<string, unknown>;
    const user = extractOne(record.users) as
      | {
          id?: string | null;
          full_name?: string | null;
          mobile?: string | null;
          email?: string | null;
          is_test_email?: boolean | null;
        }
      | null;

    return {
      profileId: String(record.id),
      userId: user?.id ?? null,
      customerCode: (record.customer_code as string | null) ?? null,
      fullName: user?.full_name ?? null,
      mobile: user?.mobile ?? null,
      email: user?.email ?? null,
      isTestEmail: Boolean(user?.is_test_email),
      onboardingStatus: String(record.onboarding_status),
      franchiseId: (record.franchise_id as string | null) ?? null,
      clinicId: (record.clinic_id as string | null) ?? null,
      createdAt: (record.created_at as string | null) ?? null,
    };
  });
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

/**
 * Perform the atomic, all-or-nothing onboarding write by invoking the
 * `onboard_customer` PL/pgSQL RPC via the service-role admin client. The RPC
 * inserts the users / customer_profiles / subscriptions / payments / addresses
 * rows in a single transaction and rolls the whole thing back on any failure
 * (Req 6.6). Raw Postgres failures are mapped to specific outcomes here so the
 * service/action layer never has to parse SQL error text.
 */
export async function onboardCustomerAtomic(
  input: OnboardCustomerRpcInput
): Promise<OnboardResult> {
  const admin = createAdminClient();

  const { data, error } = await admin.rpc("onboard_customer", {
    payload: input,
  });

  if (error) {
    const collided = classifyUniqueViolation(error);
    if (collided === "mobile") {
      return {
        ok: false,
        reason: "DUPLICATE_MOBILE",
        message: "This mobile number is already registered to a customer.",
      };
    }
    if (collided === "email") {
      return {
        ok: false,
        reason: "EMAIL_IN_USE",
        message: "This email address is already in use.",
      };
    }
    return {
      ok: false,
      reason: "ERROR",
      message: error.message ?? "Onboarding failed.",
    };
  }

  const ids = (data ?? null) as OnboardIds | null;
  if (!ids || !ids.profile_id) {
    return {
      ok: false,
      reason: "ERROR",
      message: "Onboarding did not return the created records.",
    };
  }

  return { ok: true, ids };
}

/**
 * Generate a Customer_Code that is unique in `customer_profiles.customer_code`
 * (Req 14.7/14.8). Retries on the (rare) collision, and — since generation and
 * the eventual insert race — the DB UNIQUE constraint remains the final
 * guarantee. Throws if a unique code cannot be found within `maxAttempts`.
 */
export async function generateUniqueCustomerCode(
  maxAttempts = 10
): Promise<string> {
  const admin = createAdminClient();

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const candidate = buildCustomerCode();

    const { data, error } = await admin
      .from("customer_profiles")
      .select("id")
      .eq("customer_code", candidate)
      .maybeSingle();

    if (error) {
      throw new Error(
        `Failed to check customer_code uniqueness: ${error.message}`
      );
    }

    if (!data) {
      return candidate;
    }
  }

  throw new Error(
    `Could not generate a unique customer_code after ${maxAttempts} attempts.`
  );
}

/**
 * Transition a Customer_Record to COMPLETED (Req 9.4/14.3). Idempotent: setting
 * an already-COMPLETED record to COMPLETED is a harmless no-op write.
 */
export async function setOnboardingCompleted(profileId: string): Promise<void> {
  const admin = createAdminClient();

  const { error } = await admin
    .from("customer_profiles")
    .update({ onboarding_status: "COMPLETED" })
    .eq("id", profileId);

  if (error) {
    throw new Error(
      `Failed to mark onboarding completed for profile ${profileId}: ${error.message}`
    );
  }
}

/**
 * Persist a partial patch of completable profile fields to a Customer_Record
 * (Req 9.3). Only keys explicitly present in `patch` are written, so omitted
 * fields are left unchanged. A single-row UPDATE is atomic — either all
 * provided fields persist or none do (no partial update; supports Req 9.8).
 * A patch with no keys is a no-op.
 */
export async function updateProfileFields(
  profileId: string,
  patch: ProfileFieldPatch
): Promise<void> {
  const payload: Record<string, unknown> = {};
  if (patch.gender !== undefined) payload.gender = patch.gender;
  if (patch.dietary_preference !== undefined)
    payload.dietary_preference = patch.dietary_preference;
  if (patch.allergies !== undefined) payload.allergies = patch.allergies;
  if (patch.date_of_birth !== undefined)
    payload.date_of_birth = patch.date_of_birth;
  if (patch.medical_history_notes !== undefined)
    payload.medical_history_notes = patch.medical_history_notes;

  // Nothing to write — avoid an empty UPDATE.
  if (Object.keys(payload).length === 0) {
    return;
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from("customer_profiles")
    .update(payload)
    .eq("id", profileId);

  if (error) {
    throw new Error(
      `Failed to update profile fields for ${profileId}: ${error.message}`
    );
  }
}

/**
 * Replace a customer's placeholder Test_Email with a real email and clear the
 * Test_Email flag (Req 10.6). If the email already belongs to another user the
 * UNIQUE constraint fails and this returns `EMAIL_IN_USE` (Req 10.7) with the
 * existing Test_Email left untouched, rather than surfacing a raw DB error.
 */
export async function replaceTestEmailWithReal(
  userId: string,
  email: string
): Promise<ReplaceEmailResult> {
  const admin = createAdminClient();

  const { error } = await admin
    .from("users")
    .update({ email, is_test_email: false })
    .eq("id", userId);

  if (error) {
    if (classifyUniqueViolation(error) === "email") {
      return {
        ok: false,
        reason: "EMAIL_IN_USE",
        message: "This email address is already in use.",
      };
    }
    return {
      ok: false,
      reason: "ERROR",
      message: error.message ?? "Failed to update email.",
    };
  }

  return { ok: true };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Normalizes a supabase-js embedded relation that may be returned as a single
 * object, a single-element array, or null/undefined into a single record (or
 * `null`). To-one embeds are sometimes typed/returned as arrays by the client.
 */
function extractOne(value: unknown): unknown {
  if (value == null) return null;
  if (Array.isArray(value)) return value.length > 0 ? value[0] : null;
  return value;
}

/**
 * Builds a candidate Customer_Code: the `CUST-` prefix plus 8 crockford-style
 * base32 characters (no ambiguous I/L/O/U), giving a large, human-readable
 * space with a negligible collision probability that {@link
 * generateUniqueCustomerCode} still guards against.
 */
function buildCustomerCode(): string {
  const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
  let suffix = "";
  for (let i = 0; i < 8; i++) {
    suffix += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  }
  return `CUST-${suffix}`;
}
