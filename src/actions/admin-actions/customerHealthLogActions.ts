"use server";

// src/actions/admin-actions/customerHealthLogActions.ts
// Admin-portal Server Action backing the ACCOMMODATION Dietitian dropdown on
// `Customer360Dashboard.tsx` (dietitian-management — Req 8.2, 9.2, 9.5).
//
// LAYERING: Action layer ONLY. This is an ADMIN-scoped read — gated by
// `assertGroupAccess("customers")` (view is enough to read) — NOT
// Dietitian-scoped, so every admin who may view the "customers" group can
// populate the dropdown regardless of Access_Level. This is deliberately
// different from `src/actions/dietitian-actions/*`, whose `checkDietitianScope`
// gate would reject a non-Dietitian admin outright.
//
// `listActiveDietitiansForAdmin` returns an unscoped list of every active
// Dietitian, independent of Clinic (Req 9.2, 9.5). The KIT dropdown reuses the
// already-existing `listDietitiansForClinic`/`assignCustomerDietitian` in
// `dietitianAssignmentActions.ts` (Task 9.7) unchanged.
//
// The admin Health_Log read (`getCustomerHealthLogView`) was removed along with
// the Customer_360 "Health Log" tab it served. Health_Log history is now read
// only through the Dietitian portal's own scoped path
// (`src/actions/dietitian-actions/healthLogActions.ts`). The underlying tables
// and the `v_health_log_timeline` read model are untouched.
//
// Requirements: 8.2, 9.2, 9.5

import { assertGroupAccess, GroupAccessDeniedError } from "@/lib/auth/adminAccess";
import { listActiveDietitians } from "@/repositories/dietitian/dietitianRepository";
import type { DietitianAccount } from "@/types/dietitian";

type ActionResult<T> =
  | { success: true; data: T }
  | { success: false; error: string };

async function assertCanViewCustomers(): Promise<
  { ok: true } | { ok: false; error: string }
> {
  try {
    await assertGroupAccess("customers");
    return { ok: true };
  } catch (err) {
    if (err instanceof GroupAccessDeniedError) {
      return {
        ok: false,
        error: "You do not have permission to view this customer.",
      };
    }
    throw err;
  }
}

/**
 * List every active Dietitian, independent of Clinic (Req 9.2, 9.5) — the
 * ACCOMMODATION Customer_360 Dietitian dropdown.
 */
export async function listActiveDietitiansForAdmin(): Promise<
  ActionResult<DietitianAccount[]>
> {
  const auth = await assertCanViewCustomers();
  if (!auth.ok) return { success: false, error: auth.error };

  try {
    const dietitians = await listActiveDietitians();
    return { success: true, data: dietitians };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to list dietitians",
    };
  }
}
