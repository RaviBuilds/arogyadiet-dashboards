// src/lib/onboarding/sections.ts
// Pure mapping from a Customer_Record's onboarding_status to the admin
// dashboard section it belongs in.
//
// The Customers navigation splits customers into two sections:
//   - "Onboarded"          → onboarding_status = IN_PROGRESS  (Req 6.9)
//   - "Onboarding Completed" → onboarding_status = COMPLETED   (Req 6.10)
// A status transition moves a customer from one section to the other, and every
// customer belongs to exactly one section (Req 6.11 / Property 8).
//
// Requirements validated: 6.9, 6.10, 6.11

/** The lifecycle state of a Customer_Record. */
export const ONBOARDING_STATUSES = ["IN_PROGRESS", "COMPLETED"] as const;
export type OnboardingStatus = (typeof ONBOARDING_STATUSES)[number];

/** The two admin dashboard sections under Customers. */
export const DASHBOARD_SECTIONS = ["ONBOARDED", "ONBOARDING_COMPLETED"] as const;
export type DashboardSection = (typeof DASHBOARD_SECTIONS)[number];

/**
 * Pure total mapping from onboarding status to dashboard section:
 *   - IN_PROGRESS → "ONBOARDED"             (Req 6.9)
 *   - COMPLETED   → "ONBOARDING_COMPLETED"  (Req 6.10)
 *
 * Because the mapping is total and injective over the two statuses, every
 * Customer_Record lands in exactly one section, and a transition from
 * IN_PROGRESS to COMPLETED moves it between them (Req 6.11 / Property 8).
 */
export function sectionForStatus(status: OnboardingStatus): DashboardSection {
  switch (status) {
    case "IN_PROGRESS":
      return "ONBOARDED";
    case "COMPLETED":
      return "ONBOARDING_COMPLETED";
    default: {
      // Exhaustiveness guard: a new status must be mapped explicitly.
      const _exhaustive: never = status;
      throw new Error(`Unmapped onboarding status: ${String(_exhaustive)}`);
    }
  }
}

/**
 * Convenience partition helper: splits a list of records into the two sections.
 * Each record appears in exactly one bucket (Property 8).
 */
export function partitionBySection<T extends { onboardingStatus: OnboardingStatus }>(
  records: readonly T[]
): { onboarded: T[]; onboardingCompleted: T[] } {
  const onboarded: T[] = [];
  const onboardingCompleted: T[] = [];
  for (const record of records) {
    if (sectionForStatus(record.onboardingStatus) === "ONBOARDED") {
      onboarded.push(record);
    } else {
      onboardingCompleted.push(record);
    }
  }
  return { onboarded, onboardingCompleted };
}
