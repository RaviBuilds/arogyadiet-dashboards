// ============================================================================
// DIETITIAN MANAGEMENT — PURE SEED PLAN (CONFLICT RESOLUTION)
// ============================================================================
// Feature: dietitian-management
// Requirements: 4.1, 4.2, 4.3, 4.6
//
// The decision half of `scripts/seed-dietitians.mjs`, extracted so it can be
// exercised directly by the property test for Property 37 without touching a
// database. Given the seed list and the `users` rows that already carry one of
// the seeded emails or mobiles, this module decides — per Dietitian, in seed
// order — whether to create the account or to skip and report it (Req 4.6).
//
// This module is pure: it reads the rows it is handed and never mutates them,
// which is exactly the "row left unchanged" half of Requirement 4.6.
// ============================================================================

/**
 * @typedef {{ fullName: string, mobile: string, email: string }} SeedDietitian
 * @typedef {{ id: string, email?: string | null, mobile?: string | null }} ExistingUserRow
 * @typedef {{ action: "create", dietitian: SeedDietitian, email: string }} CreateDecision
 * @typedef {{ action: "skip", dietitian: SeedDietitian, email: string, reason: string, existingUserId: string }} SkipDecision
 * @typedef {CreateDecision | SkipDecision} SeedDecision
 * @typedef {{ decisions: SeedDecision[], toCreate: CreateDecision[], skipped: SkipDecision[] }} SeedPlan
 */

/** The four Dietitians to seed (Req 4.1). */
export const DIETITIANS = [
  { fullName: "Avinash", mobile: "9154850031", email: "arogyadiet.avinashd@gmail.com" },
  { fullName: "Nandini", mobile: "9154850030", email: "nandini.dt03.arogyadiet@gmail.com" },
  { fullName: "Divya", mobile: "9154850029", email: "divya.dt03.arogyadiet@gmail.com" },
  { fullName: "Joshitha", mobile: "9059410172", email: "joshitha.dt04.arogyadiet@gmail.com" },
];

/** Reported reason when the conflict is on the email address (Req 4.6). */
export const CONFLICT_REASON_EMAIL = "email already exists";

/** Reported reason when the conflict is on the mobile number (Req 4.6). */
export const CONFLICT_REASON_MOBILE = "mobile already exists";

/** Emails are compared case-insensitively; `users.email` is stored lowercased. */
export function normalizeEmail(email) {
  return String(email ?? "").toLowerCase();
}

/**
 * The lookup values for the single conflict query: every seeded email
 * (lowercased) and every seeded mobile.
 *
 * @param {SeedDietitian[]} [dietitians]
 * @returns {{ emails: string[], mobiles: string[] }}
 */
export function seedLookupValues(dietitians = DIETITIANS) {
  return {
    emails: dietitians.map((d) => normalizeEmail(d.email)),
    mobiles: dietitians.map((d) => d.mobile),
  };
}

/**
 * Indexes the pre-existing rows by lowercased email and by mobile. Rows are
 * only read, never written.
 *
 * @param {ExistingUserRow[]} [existingRows]
 */
export function indexExistingRows(existingRows = []) {
  const byEmail = new Map();
  const byMobile = new Map();
  for (const row of existingRows ?? []) {
    if (row?.email) byEmail.set(normalizeEmail(row.email), row);
    if (row?.mobile) byMobile.set(String(row.mobile), row);
  }
  return { byEmail, byMobile };
}

/**
 * Decides, in seed order, which Dietitians to create and which to skip.
 *
 * A Dietitian whose email or mobile is already present on a `users` row is
 * skipped, reported with the conflicting field and the existing user id, and
 * the existing row is left completely untouched (Req 4.6). Everyone else is
 * created.
 *
 * @param {SeedDietitian[]} [dietitians]
 * @param {ExistingUserRow[]} [existingRows]
 * @returns {SeedPlan}
 */
export function planDietitianSeed(dietitians = DIETITIANS, existingRows = []) {
  const { byEmail, byMobile } = indexExistingRows(existingRows);

  /** @type {SeedDecision[]} */
  const decisions = [];

  for (const dietitian of dietitians) {
    const email = normalizeEmail(dietitian.email);
    const conflict = byEmail.get(email) ?? byMobile.get(dietitian.mobile);

    if (conflict) {
      decisions.push({
        action: "skip",
        dietitian,
        email,
        reason: byEmail.has(email) ? CONFLICT_REASON_EMAIL : CONFLICT_REASON_MOBILE,
        existingUserId: conflict.id,
      });
      continue;
    }

    decisions.push({ action: "create", dietitian, email });
  }

  return {
    decisions,
    toCreate: /** @type {CreateDecision[]} */ (decisions.filter((d) => d.action === "create")),
    skipped: /** @type {SkipDecision[]} */ (decisions.filter((d) => d.action === "skip")),
  };
}
