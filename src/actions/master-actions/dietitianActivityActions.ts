"use server";

// src/actions/master-actions/dietitianActivityActions.ts
// Master-portal Server Actions backing the Master dashboard's Dietitian
// dropdown and Dietitian_Activity_Report, plus the Log_Audit_Trail viewer
// (dietitian-management — Task 9.2).
//
// LAYERING: Action layer ONLY. Orchestrates authorization (ADMIN /
// MASTER_ADMIN, mirroring `clinicActions.assertCallerCanManageClinics`),
// scope resolution (`dietitianScopeFromUser`/`dietitianCanRead` from
// `src/lib/dietitian/scope.ts`), cadence computation (delegated entirely to
// `CadenceService` — Req 20.8), and data access via the `dietitian`
// repositories and `customer_profiles`/`users`. This file performs no direct
// business validation of its own beyond input shape checks.
//
// `getDietitianActivityReport` builds the per-customer table from EVERY
// Customer_Record the Dietitian may read (Req 20.2–20.5): for a core
// Dietitian that is every Customer_Record linked via `dietitian_id` plus (if
// assigned) every Customer_Record at the linked Clinic; for a Franchise
// Dietitian it is every Customer_Record in that Franchise (Req 21.8, 22.8).
// This mirrors the same scope predicate `checkDietitianScope` enforces for a
// Dietitian's own reads, so the Master report and the Franchise report agree
// with what the Dietitian can see (Req 24.6) — the two reports differ only in
// whether the Franchise Owner's report is additionally restricted to a single
// Franchise (Req 24.2), which is a filter on the same underlying scope, not a
// different computation.
//
// Requirements: 18.8, 20.1, 20.2, 20.3, 20.4, 20.5, 20.7, 20.8

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { listActiveDietitians as listActiveDietitianAccounts } from "@/repositories/dietitian/dietitianRepository";
import { listAuditEntriesForCustomer } from "@/repositories/dietitian/auditRepository";
import { getLastDietitianLogDates, getGoverningRecords } from "@/repositories/dietitian/cadenceRepository";
import { computeCadenceForCustomers } from "@/services/CadenceService";
import {
  getReportCard as getReportCardService,
  generateReportCardPdf as generateReportCardPdfService,
  type ReportCardViewModel,
} from "@/services/DietitianReportService";
import {
  dietitianScopeFromUser,
  type DietitianScope,
} from "@/lib/dietitian/scope";
import type {
  ActionResult,
} from "@/types/clinic";
import type {
  AuditEntry,
  CustomerCategory,
  DietitianActivitySummary,
  DietitianAccount,
  DietitianCustomerRow,
} from "@/types/dietitian";

// ─── Authorization ───────────────────────────────────────────────────────────

/**
 * Resolve the calling user and confirm they hold an ADMIN or MASTER_ADMIN
 * role. Mirrors `assertCallerCanManageClinics` in `clinicActions.ts` — the
 * Master dashboard's Dietitian dropdown and activity report are a
 * master/admin concern (Req 20.1).
 */
async function assertCallerCanViewDietitianActivity(): Promise<
  { ok: true } | { ok: false; error: string }
> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { ok: false, error: "Unauthorized" };

  const { data: userRecord } = await supabase
    .from("users")
    .select("id, roles(code)")
    .eq("auth_user_id", user.id)
    .single();

  if (!userRecord) return { ok: false, error: "User record not found" };

  const rolesData = userRecord.roles as
    | { code?: string }
    | { code?: string }[]
    | null;
  const roleCode = Array.isArray(rolesData) ? rolesData[0]?.code : rolesData?.code;

  if (roleCode !== "ADMIN" && roleCode !== "MASTER_ADMIN") {
    return {
      ok: false,
      error: "Only an Admin or Master Admin can view dietitian activity",
    };
  }

  return { ok: true };
}

// ─── listActiveDietitians ────────────────────────────────────────────────────

/**
 * List every active Dietitian, clinic-independently, for the Master
 * dashboard's Dietitian dropdown (Req 20.1). Each option carries the assigned
 * Clinic name (`null` renders as `Unassigned` by the caller, mirroring
 * `DietitianAccount.clinicName`).
 */
export async function listActiveDietitians(): Promise<
  ActionResult<DietitianAccount[]>
> {
  const auth = await assertCallerCanViewDietitianActivity();
  if (!auth.ok) return { success: false, error: auth.error };

  try {
    const dietitians = await listActiveDietitianAccounts();
    return { success: true, data: dietitians };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to list dietitians",
    };
  }
}

// ─── getDietitianActivityReport ──────────────────────────────────────────────

/** Raw `customer_profiles` row selected while building the per-customer table. */
interface ScopedCustomerRow {
  id: string;
  clinic_id: string | null;
  franchise_id: string | null;
  dietitian_id: string | null;
  customer_code: string | null;
  users: { full_name: string | null; mobile: string | null } | { full_name: string | null; mobile: string | null }[] | null;
}

/**
 * Resolve every Customer_Record readable by the given Dietitian's scope
 * (Req 20.2–20.5), i.e. the same set `checkDietitianScope` would admit for
 * that Dietitian's own reads:
 *   - franchise scope  → every Customer_Record whose `franchise_id` matches
 *   - core scope        → every Customer_Record linked via `dietitian_id`,
 *                          plus (if a Clinic is assigned) every Customer_Record
 *                          at that Clinic
 *
 * A franchise scope is expressed as a single `.eq` filter; a core scope
 * without a Clinic is a single `.eq`; a core scope with a Clinic is an `.or`
 * over both disjuncts — mirroring `applyDietitianScope` without importing a
 * live Supabase query builder type into this module.
 */
async function listScopedCustomers(
  admin: ReturnType<typeof createAdminClient>,
  scope: DietitianScope,
): Promise<ScopedCustomerRow[]> {
  const columns =
    "id, clinic_id, franchise_id, dietitian_id, customer_code, users(full_name, mobile)";

  let query = admin.from("customer_profiles").select(columns);

  if (scope.kind === "franchise") {
    query = query.eq("franchise_id", scope.franchiseId);
  } else if (scope.clinicId === null) {
    query = query.eq("dietitian_id", scope.dietitianUserId);
  } else {
    query = query.or(
      `dietitian_id.eq.${scope.dietitianUserId},clinic_id.eq.${scope.clinicId}`,
    );
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(`Failed to list scoped customers: ${error.message}`);
  }
  return (data ?? []) as unknown as ScopedCustomerRow[];
}

/** Resolve the governing Customer_Category for a batch of customers in one query. */
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

/** Resolve a single Dietitian's `users` row for scope construction. */
async function resolveDietitianUserRow(
  admin: ReturnType<typeof createAdminClient>,
  dietitianUserId: string,
): Promise<{ id: string; franchise_id: string | null; dietitian_clinic_id: string | null; full_name: string } | null> {
  const { data, error } = await admin
    .from("users")
    .select("id, full_name, franchise_id, dietitian_clinic_id")
    .eq("id", dietitianUserId)
    .eq("admin_access_level", "dietitian")
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to resolve dietitian ${dietitianUserId}: ${error.message}`);
  }
  if (!data) return null;

  return {
    id: data.id as string,
    franchise_id: (data.franchise_id as string | null) ?? null,
    dietitian_clinic_id: (data.dietitian_clinic_id as string | null) ?? null,
    full_name: (data.full_name as string | null) ?? "",
  };
}

/**
 * Resolve `users.full_name` for a batch of Dietitian ids in one query. A
 * customer reached through the Clinic disjunct of a core Dietitian's scope
 * may carry a `dietitian_id` different from (or empty relative to) the
 * Dietitian whose report is being built, so each row's
 * `assignedDietitianName` reflects that customer's own Dietitian_Link
 * (mirroring `DietitianReportService.resolveDietitianName`), not the report
 * target.
 */
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

/** Resolve the assigned Clinic's name for a Dietitian, or `null` when unassigned. */
async function resolveClinicName(
  admin: ReturnType<typeof createAdminClient>,
  clinicId: string | null,
): Promise<string | null> {
  if (!clinicId) return null;
  const { data, error } = await admin
    .from("clinics")
    .select("name")
    .eq("id", clinicId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to resolve clinic ${clinicId}: ${error.message}`);
  }
  return (data as { name: string | null } | null)?.name ?? null;
}

/**
 * Build the Dietitian_Activity_Report for one Dietitian (Req 20.2–20.5,
 * 20.8): resolve the Dietitian's read scope, find every Customer_Record in
 * that scope, compute cadence for all of them through `CadenceService` — the
 * single Cadence_Engine every activity report and list uses (Req 20.8) — and
 * aggregate the per-customer table into the three headline counts:
 *   - `customersWithPendingLogs` = count of rows with `pendingLogCount > 0`
 *     (Req 20.2, bounds invariant Req 20.9)
 *   - `maxDaysNotLogged` = max `daysNotLogged` across rows (Req 20.3,
 *     consistency invariant Req 20.10)
 *   - `customersMissingSelfLog` = count of rows with
 *     `datesWithoutSelfLogCount > 0` (Req 20.4)
 *
 * Returns `rows: []` and zeroed headline counts when the Dietitian has no
 * linked Customer_Record — the caller renders `No customers are assigned to
 * this dietitian` for that outcome (Req 20.7).
 */
export async function getDietitianActivityReport(
  dietitianUserId: string,
): Promise<ActionResult<DietitianActivitySummary>> {
  const auth = await assertCallerCanViewDietitianActivity();
  if (!auth.ok) return { success: false, error: auth.error };

  if (!dietitianUserId || dietitianUserId.trim().length === 0) {
    return { success: false, error: "Dietitian id is required" };
  }

  const admin = createAdminClient();

  try {
    const dietitianRow = await resolveDietitianUserRow(admin, dietitianUserId);
    if (!dietitianRow) {
      return { success: false, error: "Dietitian not found" };
    }

    const scope = dietitianScopeFromUser(dietitianRow);
    const clinicName = await resolveClinicName(admin, dietitianRow.dietitian_clinic_id);

    const customers = await listScopedCustomers(admin, scope);

    if (customers.length === 0) {
      return {
        success: true,
        data: {
          dietitianUserId,
          dietitianName: dietitianRow.full_name,
          clinicName,
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
        dietitianUserId,
        dietitianName: dietitianRow.full_name,
        clinicName,
        customersWithPendingLogs,
        maxDaysNotLogged,
        customersMissingSelfLog,
        rows,
      },
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to build dietitian activity report",
    };
  }
}

// ─── listHealthLogAuditEntries ───────────────────────────────────────────────

/**
 * List the Log_Audit_Trail entries for a Customer_Record, in reverse
 * chronological order (Req 18.8), for the Master audit viewer.
 */
export async function listHealthLogAuditEntries(
  customerProfileId: string,
): Promise<ActionResult<AuditEntry[]>> {
  const auth = await assertCallerCanViewDietitianActivity();
  if (!auth.ok) return { success: false, error: auth.error };

  if (!customerProfileId || customerProfileId.trim().length === 0) {
    return { success: false, error: "Customer id is required" };
  }

  try {
    const entries = await listAuditEntriesForCustomer(customerProfileId);
    return { success: true, data: entries };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to list audit entries",
    };
  }
}

// ─── Master-scoped Report_Card (Req 20.6) ────────────────────────────────────
//
// The Master dashboard's activity report links each per-customer row to that
// customer's Report_Card (Req 20.6). `reportCardActions.ts`'s
// `getReportCard`/`exportReportCardPdf` self-gate via `checkDietitianScope`,
// which only resolves for an authenticated Dietitian — a master admin is not
// one, so those actions would always reject a master-admin caller. These
// master-scoped equivalents apply the same ADMIN/MASTER_ADMIN authorization
// this file already uses instead, and the same Req 19.1 KIT/ACCOMMODATION
// category gate `reportCardActions.ts` applies, then delegate to the same
// `DietitianReportService` so the two portals' Report_Cards agree on content
// by construction.

const REPORT_CARD_NOT_AVAILABLE_FOR_CATEGORY =
  "Report Card is available only for KIT and Accommodation customers.";

/** The base64-encoded PDF payload, mirroring `reportCardActions.ts`'s `ReportCardPdfExport`. */
export interface MasterReportCardPdfExport {
  base64: string;
  filename: string;
}

async function assertMasterReportCardEligible(
  customerProfileId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const governingRecords = await getGoverningRecords([customerProfileId]);
  const category = governingRecords.get(customerProfileId)?.category;
  if (!category || (category !== "KIT" && category !== "ACCOMMODATION")) {
    return { ok: false, error: REPORT_CARD_NOT_AVAILABLE_FOR_CATEGORY };
  }
  return { ok: true };
}

/**
 * Master-scoped Report_Card read, for the Master dashboard's per-customer
 * Report_Card navigation (Req 20.6). Gated by
 * {@link assertCallerCanViewDietitianActivity}, not `checkDietitianScope` —
 * a master admin may read any Customer_Record's Report_Card, mirroring the
 * unrestricted read scope the rest of this file already grants for the
 * activity report itself.
 */
export async function getMasterReportCard(
  customerProfileId: string,
): Promise<ActionResult<ReportCardViewModel>> {
  const auth = await assertCallerCanViewDietitianActivity();
  if (!auth.ok) return { success: false, error: auth.error };

  const eligible = await assertMasterReportCardEligible(customerProfileId);
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

/**
 * Master-scoped Report_Card PDF export, matching
 * `reportCardActions.exportReportCardPdf`'s base64 return shape so
 * `ReportCardView.tsx`'s `exportAction` prop accepts either interchangeably.
 */
export async function exportMasterReportCardPdf(
  customerProfileId: string,
): Promise<ActionResult<MasterReportCardPdfExport>> {
  const auth = await assertCallerCanViewDietitianActivity();
  if (!auth.ok) return { success: false, error: auth.error };

  const eligible = await assertMasterReportCardEligible(customerProfileId);
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
