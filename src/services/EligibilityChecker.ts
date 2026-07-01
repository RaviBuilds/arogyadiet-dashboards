// src/services/EligibilityChecker.ts
// Server-side pre-PIN eligibility decision for the customer mobile-onboarding
// flow (customer-mobile-onboarding, Requirements 3, 9.6, 9.9, 12).
//
// LAYERING: Thin business service. It composes the pure `normalizeMobile`
// helper (`src/lib/mobile`) with the data-access `findCustomerByMobile`
// (`src/repositories/customerOnboardingRepository`) and applies a single
// policy: reveal the PIN entry screen ONLY when the submitted mobile maps to
// exactly one CUSTOMER record in an allowed onboarding state. It performs no
// side effects — critically it NEVER sends an OTP nor establishes a session —
// so a non-eligible result cannot leak any access (Req 12.1/12.2).
//
// Decision table (Property 2 — exactly-one-allowed-customer):
//   - input not a syntactically valid mobile        → INVALID_FORMAT (Req 3.2)
//   - no CUSTOMER record for the mobile              → NOT_REGISTERED (Req 3.4, 12.1)
//   - CUSTOMER record(s) exist but none IN_PROGRESS
//     or COMPLETED                                   → BAD_STATUS     (Req 3.4)
//   - more than one allowed CUSTOMER record          → AMBIGUOUS      (Req 3.6, 12.4)
//   - exactly one allowed CUSTOMER record            → eligible       (Req 3.1, 3.3)
//
// Requirements: 3.1, 3.4, 3.5, 9.6, 9.9, 12.1, 12.2, 12.3, 12.4

import { normalizeMobile } from "@/lib/mobile/normalizeMobile";
import {
  findCustomerByMobile,
  type CustomerLookup,
} from "@/repositories/customerOnboardingRepository";

/**
 * The role code that identifies a Customer_Record. Records with any other role
 * are excluded from the eligibility association check entirely (Req 3.5).
 */
const CUSTOMER_ROLE_CODE = "CUSTOMER";

/**
 * The onboarding states for which login may proceed: an admin-created but
 * not-yet-completed customer (`IN_PROGRESS`) or a fully onboarded customer
 * (`COMPLETED`). Any other status is not eligible (Req 3.1).
 */
const ALLOWED_STATUSES = ["IN_PROGRESS", "COMPLETED"] as const;

type AllowedStatus = (typeof ALLOWED_STATUSES)[number];

/**
 * The reason a mobile number is not eligible for the PIN entry screen:
 *   - `INVALID_FORMAT`  — not a syntactically valid mobile number (Req 3.2).
 *   - `NOT_REGISTERED`  — no CUSTOMER record is associated (Req 3.4, 12.1).
 *   - `BAD_STATUS`      — a CUSTOMER record exists but is in neither
 *                         `IN_PROGRESS` nor `COMPLETED` (Req 3.4).
 *   - `AMBIGUOUS`       — more than one allowed CUSTOMER record shares the
 *                         mobile and must be resolved first (Req 3.6, 12.4).
 */
export type EligibilityReason =
  | "INVALID_FORMAT"
  | "NOT_REGISTERED"
  | "BAD_STATUS"
  | "AMBIGUOUS";

/**
 * The outcome of an eligibility check.
 *
 *   - `{ eligible: true; profileId; status }` — exactly one allowed CUSTOMER
 *      record was found; the caller may reveal the PIN entry screen for that
 *      mobile (Req 3.3).
 *   - `{ eligible: false; reason }`           — the PIN entry screen must NOT
 *      be revealed and no OTP/session is created (Req 12.1/12.2).
 */
export type EligibilityResult =
  | { eligible: true; profileId: string; status: AllowedStatus }
  | { eligible: false; reason: EligibilityReason };

/**
 * Narrowing type guard: is a lookup's onboarding status one of the allowed
 * login states?
 */
function isAllowedStatus(status: string | null): status is AllowedStatus {
  return (
    status !== null && (ALLOWED_STATUSES as readonly string[]).includes(status)
  );
}

/**
 * Determine whether a submitted mobile number may proceed to PIN entry.
 *
 * The check normalizes the mobile (Req 2.11/3.2), looks up all associated
 * records, restricts the set to CUSTOMER records only (Req 3.5), and then
 * applies the exactly-one-allowed-customer rule (Property 2). It has no side
 * effects: on every non-eligible outcome nothing is sent and no session is
 * established (Req 12.1/12.2), and the caller is responsible for surfacing the
 * appropriate message ("please contact admin", etc.) from the returned reason.
 *
 * Validates: Requirements 3.1, 3.4, 3.5, 9.6, 9.9, 12.1, 12.2, 12.3, 12.4.
 *
 * @param mobile the raw, human-entered mobile number
 */
export async function check(mobile: string): Promise<EligibilityResult> {
  // (1) Syntactic validation via the pure normalizer (Req 3.2). An invalid
  //     format short-circuits BEFORE any data access, so a malformed value
  //     never triggers a lookup, an OTP, or a session.
  const normalized = normalizeMobile(mobile);
  if (!normalized.ok) {
    return { eligible: false, reason: "INVALID_FORMAT" };
  }

  // (2) Look up every record for the canonical mobile (0..n).
  const records: CustomerLookup[] = await findCustomerByMobile(
    normalized.value
  );

  // (3) Restrict to Customer_Records only — exclude every non-CUSTOMER role
  //     (Req 3.5).
  const customerRecords = records.filter(
    (r) => r.roleCode === CUSTOMER_ROLE_CODE
  );

  // No CUSTOMER record at all → the mobile is not registered (Req 3.4, 12.1).
  if (customerRecords.length === 0) {
    return { eligible: false, reason: "NOT_REGISTERED" };
  }

  // (4) Among CUSTOMER records, keep only those in an allowed onboarding state
  //     with a resolvable profile id.
  const allowed = customerRecords.filter(
    (r) => isAllowedStatus(r.onboardingStatus) && r.profileId !== null
  );

  // More than one allowed CUSTOMER record → ambiguous, needs resolution
  // (Req 3.6, 12.4).
  if (allowed.length > 1) {
    return { eligible: false, reason: "AMBIGUOUS" };
  }

  // CUSTOMER record(s) exist but none is in an allowed state → bad status
  // (Req 3.4).
  if (allowed.length === 0) {
    return { eligible: false, reason: "BAD_STATUS" };
  }

  // (5) Exactly one allowed CUSTOMER record → eligible (Req 3.1, 3.3).
  const record = allowed[0];
  return {
    eligible: true,
    // `profileId` is guaranteed non-null by the filter above.
    profileId: record.profileId as string,
    status: record.onboardingStatus as AllowedStatus,
  };
}

/**
 * Namespaced export mirroring the design's `EligibilityChecker.check(...)`
 * interface, for callers that prefer the object form.
 */
export const EligibilityChecker = { check };
