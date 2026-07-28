"use server";

// src/actions/admin-actions/customerHealthLogActions.ts
// Admin-portal Server Actions backing the Health_Log timeline, adherence
// panel and Dietitian dropdowns on `Customer360Dashboard.tsx`
// (dietitian-management — Task 12.5, Req 8.2, 9.2, 9.5, 16.2, 16.3, 16.4).
//
// LAYERING: Action layer ONLY. These are ADMIN-scoped reads — gated by
// `assertGroupAccess("customers")` (view is enough to read) — NOT
// Dietitian-scoped: every admin viewing a Customer_360 page sees this
// customer's Health_Log history and adherence numbers (Req 16.2), regardless
// of whether the viewing admin is a Dietitian. This is deliberately
// different from `src/actions/dietitian-actions/healthLogActions.ts`, whose
// `checkDietitianScope` gate would reject a non-Dietitian admin outright —
// that module stays the write/self-service path for a Dietitian's own
// scoped reads; this module is the admin Customer_360's read path for
// EVERY admin regardless of Access_Level.
//
// `listActiveDietitiansForAdmin` supports the ACCOMMODATION Dietitian
// dropdown (Req 9.2, 9.5) — an unscoped list of every active Dietitian,
// independent of Clinic. The KIT dropdown reuses the already-existing
// `listDietitiansForClinic`/`assignCustomerDietitian` in
// `dietitianAssignmentActions.ts` (Task 9.7) unchanged.
//
// Requirements: 8.2, 9.2, 9.5, 16.2, 16.3, 16.4

import { assertGroupAccess, GroupAccessDeniedError } from "@/lib/auth/adminAccess";
import { createAdminClient } from "@/lib/supabase/admin";
import { getHealthLogTimeline } from "@/repositories/dietitian/healthLogRepository";
import { getGoverningRecords } from "@/repositories/dietitian/cadenceRepository";
import { getCadenceForCustomer } from "@/services/CadenceService";
import { listActiveDietitians } from "@/repositories/dietitian/dietitianRepository";
import { deserializeCustomParameters } from "@/lib/dietitian/customParameters";
import { istDateStringOf } from "@/lib/dates/ist";
import type {
  CustomerCategory,
  DietitianAccount,
  HealthLog,
} from "@/types/dietitian";

type ActionResult<T> =
  | { success: true; data: T }
  | { success: false; error: string };

/** The Health_Log timeline plus the adherence numbers for one Customer_Record (Req 16.2, 16.3, 16.4). */
export interface CustomerHealthLogView {
  category: CustomerCategory;
  logs: HealthLog[];
  selfLogs: HealthLog[];
  skippedSelfLogCount: number;
  datesWithoutSelfLogCount: number;
  pausedDaysCount: number;
}

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
 * Read a Customer_Record's Health_Log timeline and Self_Log adherence
 * numbers for the Customer_360 view (Req 16.2, 16.3, 16.4). Available to
 * every admin who may at least view the "customers" group — not restricted
 * to a Dietitian.
 */
export async function getCustomerHealthLogView(
  customerProfileId: string,
): Promise<ActionResult<CustomerHealthLogView>> {
  const auth = await assertCanViewCustomers();
  if (!auth.ok) return { success: false, error: auth.error };

  try {
    const [timeline, governingRecords, cadence] = await Promise.all([
      getHealthLogTimeline(customerProfileId),
      getGoverningRecords([customerProfileId]),
      getCadenceForCustomer(customerProfileId),
    ]);

    const category = governingRecords.get(customerProfileId)?.category ?? "MEAL";

    const authorIds = Array.from(
      new Set(
        timeline
          .map((row) => row.author_user_id)
          .filter((id): id is string => id !== null),
      ),
    );
    const authorNames = await resolveAuthorNames(authorIds);

    const logs: HealthLog[] = timeline.map((row) => ({
      id: row.id,
      customerProfileId: row.customer_profile_id,
      logDate: row.log_date,
      authorType: row.author_type,
      authorUserId: row.author_user_id,
      authorName: row.author_user_id ? authorNames.get(row.author_user_id) ?? null : null,
      category,
      parameters: row.parameters ?? {},
      customParameters: deserializeCustomParameters(row.custom_parameters),
      closingComment: row.closing_comment,
      submittedAt: row.submitted_at,
      submissionDateIst: istDateStringOf(new Date(row.submitted_at)),
      source: row.source,
    }));

    const selfLogs = logs.filter((log) => log.authorType === "CUSTOMER");

    return {
      success: true,
      data: {
        category,
        logs,
        selfLogs,
        skippedSelfLogCount: cadence.skippedSelfLogCount,
        datesWithoutSelfLogCount: cadence.datesWithoutSelfLogCount,
        pausedDaysCount: cadence.pausedDaysCount,
      },
    };
  } catch (err) {
    console.error("getCustomerHealthLogView error:", err);
    return { success: false, error: "Failed to load the health log history." };
  }
}

/**
 * List every active Dietitian, independent of Clinic (Req 9.2, 9.5) — the
 * ACCOMMODATION Customer_360 Dietitian dropdown. Gated the same way as the
 * rest of this file.
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

async function resolveAuthorNames(
  authorUserIds: readonly string[],
): Promise<Map<string, string>> {
  if (authorUserIds.length === 0) return new Map();
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("users")
    .select("id, full_name")
    .in("id", authorUserIds);

  if (error) {
    throw new Error(`Failed to resolve author names: ${error.message}`);
  }

  const map = new Map<string, string>();
  for (const row of (data ?? []) as Array<{ id: string; full_name: string | null }>) {
    if (row.full_name) map.set(row.id, row.full_name);
  }
  return map;
}
