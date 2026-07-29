"use server";

// src/actions/franchise-actions/franchiseDietitianActivityActions.ts
// Franchise-portal Server Actions backing the Franchise_Owner's Dietitian
// Activity page (dietitian-management — Task 13.1, Req 24.1–24.6).
//
// LAYERING: Action layer ONLY. Authorization is
// `guardFranchiseGroupAccess("customers")` (Req 24.3) — a Franchise user
// whose Access_Level does not grant the customers group is redirected before
// this module ever runs; every export below additionally re-checks that gate
// itself (not just the page) so a direct action call cannot bypass it.
//
// This module MUST NOT be imported from `src/app/admin` (portal isolation,
// Req 23.7) and MUST NOT import `src/actions/master-actions/*` (that module
// gates on ADMIN/MASTER_ADMIN, which would always reject a franchise caller,
// and duplicating its private helpers here — scoped to `franchise_id`
// instead of a Dietitian's Core/Franchise scope — is what keeps this file
// independently readable). It reuses the exact same shared, portal-neutral
// primitives the Master_Portal's equivalent module reuses:
//   - `computeCadenceForCustomers` (`@/services/CadenceService`) — the SINGLE
//     Cadence_Engine every activity report goes through (Req 24.5), which is
//     what makes Req 24.6 (franchise numbers equal master numbers for the
//     same Dietitian) a consequence of architecture rather than a thing to
//     test twice.
//   - `getReportCard`/`generateReportCardPdf` (`@/services/DietitianReportService`)
//     — the same Report_Card assembly the admin and master Report_Card pages
//     use.
//
// Requirements: 20.2, 20.3, 20.4, 20.5, 23.6, 24.1, 24.2, 24.3, 24.4, 24.5, 24.6

import { guardFranchiseGroupAccess } from "@/lib/auth/adminAccess";
import { createAdminClient } from "@/lib/supabase/admin";
import { computeCadenceForCustomers } from "@/services/CadenceService";
import {
  getReportCard as getReportCardService,
  generateReportCardPdf as generateReportCardPdfService,
  type ReportCardViewModel,
} from "@/services/DietitianReportService";
import { getGoverningRecords } from "@/repositories/dietitian/cadenceRepository";
import { getLastDietitianLogDates } from "@/repositories/dietitian/cadenceRepository";
import type {
  CustomerCategory,
  DietitianActivitySummary,
  DietitianCustomerRow,
} from "@/types/dietitian";

type ActionResult<T> =
  | { success: true; data: T }
  | { success: false; error: string };

/** Raw `customer_profiles` row selected while building the per-customer table. */
interface FranchiseScopedCustomerRow {
  id: string;
  dietitian_id: string | null;
  customer_code: string | null;
  users: { full_name: string | null; mobile: string | null } | { full_name: string | null; mobile: string | null }[] | null;
}

/**
 * Resolve the Franchise's single active Dietitian, if any (Req 10.2, 10.3 —
 * at most one active Dietitian per Franchise). Returns `null` when the
 * Franchise has no active Dietitian, so the caller can render
 * `NO_DIETITIAN_FOR_FRANCHISE` (Req 24.4) in place of the report.
 */
async function resolveFranchiseDietitian(
  admin: ReturnType<typeof createAdminClient>,
  franchiseId: string,
): Promise<{ id: string; fullName: string } | null> {
  const { data, error } = await admin
    .from("users")
    .select("id, full_name")
    .eq("admin_access_level", "dietitian")
    .eq("franchise_id", franchiseId)
    .eq("is_active", true)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to resolve the franchise dietitian: ${error.message}`);
  }
  if (!data) return null;

  return {
    id: data.id as string,
    fullName: (data.full_name as string | null)?.trim() || "Dietitian",
  };
}

/**
 * List the Customer_Records the report covers: those linked to the Franchise's
 * Dietitian via `customer_profiles.dietitian_id` (the "linked Customer_Records"
 * of Req 20.2–20.5), restricted to the caller's Franchise (Req 24.2).
 *
 * Both filters are applied so the returned set is identical to the one the
 * Master_Portal's `listLinkedCustomers` returns for the same Dietitian, which
 * is what makes Req 24.6 hold: a Franchise Dietitian's linked records all
 * carry that Franchise's `franchise_id`, so the `franchise_id` filter is a
 * defence-in-depth tenant guard rather than a widening of the set.
 */
async function listFranchiseCustomers(
  admin: ReturnType<typeof createAdminClient>,
  franchiseId: string,
  dietitianUserId: string,
): Promise<FranchiseScopedCustomerRow[]> {
  const { data, error } = await admin
    .from("customer_profiles")
    // `users` must be disambiguated: `customer_profiles` links to it via both
    // `user_id` and `dietitian_id`.
    .select(
      "id, dietitian_id, customer_code, users!customer_profiles_user_id_fkey(full_name, mobile)",
    )
    .eq("franchise_id", franchiseId)
    .eq("dietitian_id", dietitianUserId);

  if (error) {
    throw new Error(`Failed to list franchise customers: ${error.message}`);
  }
  return (data ?? []) as unknown as FranchiseScopedCustomerRow[];
}

/** Resolve the customer's governing Customer_Category for a batch, in one query. */
async function resolveGoverningCategories(
  admin: ReturnType<typeof createAdminClient>,
  customerProfileIds: readonly string[],
): Promise<Map<string, CustomerCategory>> {
  const result = new Map<string, CustomerCategory>();
  if (customerProfileIds.length === 0) return result;

  const { data, error } = await admin
    .from("subscriptions")
    .select("customer_profile_id, customer_category, created_at")
    .in("customer_profile_id", customerProfileIds)
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(`Failed to resolve customer categories: ${error.message}`);
  }

  // Rows are newest-first, so the first occurrence per customer is governing.
  for (const row of (data ?? []) as Array<{
    customer_profile_id: string;
    customer_category: string;
  }>) {
    if (result.has(row.customer_profile_id)) continue;
    const category = row.customer_category;
    result.set(
      row.customer_profile_id,
      category === "ACCOMMODATION" || category === "KIT" ? category : "MEAL",
    );
  }

  return result;
}

/** Resolve `users.full_name` for a batch of Dietitian ids in one query. */
async function resolveAssignedDietitianNames(
  admin: ReturnType<typeof createAdminClient>,
  dietitianIds: readonly (string | null)[],
): Promise<Map<string, string>> {
  const distinct = Array.from(
    new Set(dietitianIds.filter((id): id is string => id !== null)),
  );
  if (distinct.length === 0) return new Map();

  const { data, error } = await admin
    .from("users")
    .select("id, full_name")
    .in("id", distinct);

  if (error) {
    throw new Error(`Failed to resolve assigned dietitian names: ${error.message}`);
  }

  const map = new Map<string, string>();
  for (const row of (data ?? []) as Array<{ id: string; full_name: string | null }>) {
    if (row.full_name) map.set(row.id, row.full_name);
  }
  return map;
}

/**
 * Build the Franchise-scoped Dietitian_Activity_Report for the Franchise
 * Owner's Dietitian Activity page (Req 24.1, 24.2, 24.5, 24.6).
 *
 * Gated by `guardFranchiseGroupAccess("customers")` (Req 24.3). Restricted to
 * Customer_Records whose `franchise_id` equals the caller's Franchise
 * (Req 24.2), computed through the exact same `computeCadenceForCustomers`
 * the Master_Portal uses (Req 24.5), so the returned numbers equal the
 * Master_Portal's numbers for the same Dietitian (Req 24.6).
 *
 * Returns `null` when the Franchise has no active Dietitian — the caller
 * renders `NO_DIETITIAN_FOR_FRANCHISE` (Req 24.4) in that case.
 */
export async function getFranchiseDietitianActivityReport(): Promise<
  ActionResult<DietitianActivitySummary | null>
> {
  const { franchiseId } = await guardFranchiseGroupAccess("customers");
  const admin = createAdminClient();

  try {
    const dietitian = await resolveFranchiseDietitian(admin, franchiseId);
    if (!dietitian) {
      return { success: true, data: null };
    }

    const customers = await listFranchiseCustomers(admin, franchiseId, dietitian.id);

    if (customers.length === 0) {
      return {
        success: true,
        data: {
          dietitianUserId: dietitian.id,
          dietitianName: dietitian.fullName,
          clinicName: null,
          customersWithPendingLogs: 0,
          maxDaysNotLogged: 0,
          customersMissingSelfLog: 0,
          rows: [],
        },
      };
    }

    const customerProfileIds = customers.map((c) => c.id);

    const [cadenceResults, categories, lastLogDates, assignedNames] = await Promise.all([
      computeCadenceForCustomers(customerProfileIds),
      resolveGoverningCategories(admin, customerProfileIds),
      getLastDietitianLogDates(customerProfileIds),
      resolveAssignedDietitianNames(admin, customers.map((c) => c.dietitian_id)),
    ]);

    const rows: DietitianCustomerRow[] = customers.map((customer) => {
      const cadence = cadenceResults.get(customer.id);
      const usersEmbed = customer.users;
      const user = Array.isArray(usersEmbed) ? usersEmbed[0] : usersEmbed;

      return {
        customerProfileId: customer.id,
        customerCode: customer.customer_code,
        name: user?.full_name?.trim() || "Customer",
        mobile: user?.mobile ?? null,
        category: categories.get(customer.id) ?? "MEAL",
        assignedDietitianName: customer.dietitian_id
          ? assignedNames.get(customer.dietitian_id) ?? null
          : null,
        lastDietitianLogDate: lastLogDates.get(customer.id) ?? null,
        daysNotLogged: cadence?.daysNotLogged ?? 0,
        pendingLogCount: cadence?.pendingLogCount ?? 0,
        pausedDaysCount: cadence?.pausedDaysCount ?? 0,
        skippedSelfLogCount: cadence?.skippedSelfLogCount ?? 0,
        datesWithoutSelfLogCount: cadence?.datesWithoutSelfLogCount ?? 0,
      };
    });

    const customersWithPendingLogs = rows.filter((r) => r.pendingLogCount > 0).length;
    const maxDaysNotLogged = rows.reduce((max, r) => Math.max(max, r.daysNotLogged), 0);
    const customersMissingSelfLog = rows.filter(
      (r) => r.datesWithoutSelfLogCount > 0,
    ).length;

    return {
      success: true,
      data: {
        dietitianUserId: dietitian.id,
        dietitianName: dietitian.fullName,
        clinicName: null,
        customersWithPendingLogs,
        maxDaysNotLogged,
        customersMissingSelfLog,
        rows,
      },
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to build the dietitian activity report",
    };
  }
}

// ─── Franchise-scoped Report_Card (Req 23.6) ─────────────────────────────────
//
// The franchise Dietitian Activity page's per-row Report_Card navigation and
// the franchise Log Customer / Customer_360 Report_Card page both need a
// Report_Card read. The Log Customer flow reuses the portal-neutral,
// self-gating `getReportCard`/`exportReportCardPdf` from
// `dietitian-actions/reportCardActions.ts` unchanged (the signed-in caller
// IS the Dietitian there). The activity page, however, is opened by the
// Franchise_Owner, who is not necessarily a Dietitian — `checkDietitianScope`
// would reject them. These franchise-scoped equivalents apply the same
// `guardFranchiseGroupAccess("customers")` gate this file already uses,
// restricted to a Customer_Record within the caller's Franchise, and then
// delegate to the same `DietitianReportService` so every portal's
// Report_Cards agree on content by construction.

const REPORT_CARD_NOT_AVAILABLE_FOR_CATEGORY =
  "Report Card is available only for KIT and Accommodation customers.";

/** The base64-encoded PDF payload, mirroring `reportCardActions.ts`'s `ReportCardPdfExport`. */
export interface FranchiseReportCardPdfExport {
  base64: string;
  filename: string;
}

/** Verifies the Customer_Record belongs to the caller's Franchise. */
async function assertCustomerInFranchise(
  customerProfileId: string,
  franchiseId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("customer_profiles")
    .select("id, franchise_id")
    .eq("id", customerProfileId)
    .maybeSingle();

  if (error) return { ok: false, error: error.message };
  if (!data || data.franchise_id !== franchiseId) {
    return { ok: false, error: "This customer does not belong to your franchise." };
  }
  return { ok: true };
}

async function assertFranchiseReportCardEligible(
  customerProfileId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const governingRecords = await getGoverningRecords([customerProfileId]);
  const category = governingRecords.get(customerProfileId)?.category;
  if (!category || (category !== "KIT" && category !== "ACCOMMODATION")) {
    return { ok: false, error: REPORT_CARD_NOT_AVAILABLE_FOR_CATEGORY };
  }
  return { ok: true };
}

/** Franchise-scoped Report_Card read, for the Franchise Owner's activity page (Req 23.6). */
export async function getFranchiseReportCard(
  customerProfileId: string,
): Promise<ActionResult<ReportCardViewModel>> {
  const { franchiseId } = await guardFranchiseGroupAccess("customers");

  const scoped = await assertCustomerInFranchise(customerProfileId, franchiseId);
  if (!scoped.ok) return { success: false, error: scoped.error };

  const eligible = await assertFranchiseReportCardEligible(customerProfileId);
  if (!eligible.ok) return { success: false, error: eligible.error };

  try {
    const result = await getReportCardService(customerProfileId);
    if (!result.ok) return { success: false, error: result.error };
    return { success: true, data: result.report };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to load the report card",
    };
  }
}

/** Franchise-scoped Report_Card PDF export, matching `reportCardActions.exportReportCardPdf`'s return shape. */
export async function exportFranchiseReportCardPdf(
  customerProfileId: string,
): Promise<ActionResult<FranchiseReportCardPdfExport>> {
  const { franchiseId } = await guardFranchiseGroupAccess("customers");

  const scoped = await assertCustomerInFranchise(customerProfileId, franchiseId);
  if (!scoped.ok) return { success: false, error: scoped.error };

  const eligible = await assertFranchiseReportCardEligible(customerProfileId);
  if (!eligible.ok) return { success: false, error: eligible.error };

  try {
    const result = await generateReportCardPdfService(customerProfileId);
    if (!result.ok) return { success: false, error: result.error };
    return {
      success: true,
      data: {
        base64: result.pdf.toString("base64"),
        filename: `report-card-${customerProfileId}.pdf`,
      },
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to generate the report card PDF",
    };
  }
}
