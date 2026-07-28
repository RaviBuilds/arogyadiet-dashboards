"use server";

// src/actions/dietitian-actions/dietitianCustomerActions.ts
// Feature: dietitian-management — Server Actions for the Log Customer list
// and the read-only Dietitian Customer_360 view (task 9.4).
//
// LAYERING: `'use server'` wrapper only. This module composes the pure scope
// resolution (`@/lib/dietitian/scope`), the batched cadence computation
// (`@/services/CadenceService`), the pure filter/sort functions
// (`@/lib/dietitian/listFilters`) and the data-access reads
// (`@/repositories/dietitian/*`). It performs no business validation of its
// own beyond the scope gate — every rule already lives in one of those
// modules.
//
// PORTAL-NEUTRAL: this file imports nothing from `src/app/admin` or
// `src/app/franchise`. Both `src/app/admin/(main)/log-customer/page.tsx` and
// its franchise counterpart call the same three functions below (design
// "Server Actions": "`dietitian-actions` are portal-neutral and self-gating
// via `checkDietitianScope`").
//
// SELF-GATING: every exported function resolves its own authorization —
// `listDietitianCustomers` through `guardDietitianPage()` (no `base`, so it
// accepts a Dietitian from either portal) and `getDietitianCustomerDetail` /
// `getCustomParameterSuggestions` through `checkDietitianScope(id)`, which is
// the single choke point for Req 5.8/5.9. No caller may reach a Customer_Record
// through this module without passing one of those two gates.
//
// _Requirements: 4.4, 5.8, 5.9, 12.9, 15.3, 15.4, 16.2, 16.6, 17.1, 17.2, 17.3,
// 17.4, 17.5, 17.6_

import {
  checkDietitianScope,
  dietitianScopeFromContext,
  guardDietitianPage,
} from "@/lib/auth/adminAccess";
import { NO_CLINIC_ASSIGNED_NOTICE } from "@/lib/dietitian/messages";
import {
  applyDietitianFilters,
  DEFAULT_DIETITIAN_SORT,
  sortDietitianRows,
  type DietitianFilters,
  type DietitianSortKey,
  type SortDirection,
} from "@/lib/dietitian/listFilters";
import {
  getCustomerDetailRow,
  listInScopeCustomerListRows,
  type DietitianCustomerAddress,
  type DietitianGoverningSubscriptionSummary,
} from "@/repositories/dietitian/assignmentRepository";
import { getLastDietitianLogDates } from "@/repositories/dietitian/cadenceRepository";
import { getCustomParameterLabelSuggestions } from "@/repositories/dietitian/healthLogRepository";
import {
  computeCadenceForCustomers,
  getCadenceForCustomer,
} from "@/services/CadenceService";
import type { DietitianCustomerRow } from "@/types/dietitian";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ActionSuccess<T> = { success: true; data: T };
type ActionError = { success: false; error: string };
type ActionResult<T> = ActionSuccess<T> | ActionError;

/** The sort the Log Customer list applies, defaulting to `DEFAULT_DIETITIAN_SORT` (Req 17.4, 17.5, 17.6). */
export interface DietitianCustomerSort {
  key: DietitianSortKey;
  direction: SortDirection;
}

/** The Log Customer list payload: the rows plus the empty-clinic notice (Req 4.4). */
export interface DietitianCustomerListResult {
  rows: DietitianCustomerRow[];
  /** `NO_CLINIC_ASSIGNED_NOTICE` for a core Dietitian with no linked Clinic, otherwise `null`. */
  clinicNotice: string | null;
}

/** The full detail view for one Customer_Record in a Dietitian's read-only workspace (Req 16.2). */
export interface DietitianCustomerDetail {
  customerProfileId: string;
  customerCode: string | null;
  name: string;
  mobile: string | null;
  email: string | null;
  category: DietitianCustomerRow["category"];
  assignedDietitianName: string | null;
  addresses: DietitianCustomerAddress[];
  governingSubscription: DietitianGoverningSubscriptionSummary | null;
  cadence: {
    lastDietitianLogDate: string | null;
    daysNotLogged: number;
    pendingLogCount: number;
    pausedDaysCount: number;
    skippedSelfLogCount: number;
    datesWithoutSelfLogCount: number;
  };
}

// ---------------------------------------------------------------------------
// 9.4 — listDietitianCustomers
// ---------------------------------------------------------------------------

/**
 * List the signed-in Dietitian's Log Customer rows (Req 15.3, 16.6), with
 * cadence values attached, the requested filters applied and the requested
 * sort applied — or `DEFAULT_DIETITIAN_SORT` when `sort` is omitted (Req 17.6).
 *
 * Self-gating: resolves the caller via `guardDietitianPage()`, which redirects
 * a non-Dietitian to `/unauthorized` rather than returning an error — this
 * mirrors every other Dietitian page-level read. The readable scope (Req 5.5,
 * 5.6) is derived from that resolved context and used both to read the rows
 * and to compute the `No clinic assigned` notice (Req 4.4).
 *
 * Req 4.4, 15.3, 15.4, 16.6, 17.1, 17.2, 17.3, 17.4, 17.5, 17.6
 */
export async function listDietitianCustomers(
  filters: DietitianFilters = {},
  sort: DietitianCustomerSort = DEFAULT_DIETITIAN_SORT,
): Promise<ActionResult<DietitianCustomerListResult>> {
  try {
    const ctx = await guardDietitianPage();
    const scope = dietitianScopeFromContext(ctx);

    const listRows = await listInScopeCustomerListRows(scope);
    const customerProfileIds = listRows.map((row) => row.customerProfileId);

    // `effectiveLastLogDate` (from CadenceService) substitutes `windowStart -
    // 1 day` per customer when there is no Dietitian_Log, which varies row to
    // row and would break the null-as-earliest sort invariant (Req 17.6). The
    // list needs the true, possibly-null Last_Dietitian_Log_Date instead, so
    // it is read directly here alongside the cadence computation.
    const [cadenceByCustomer, lastLogDates] = await Promise.all([
      computeCadenceForCustomers(customerProfileIds),
      getLastDietitianLogDates(customerProfileIds),
    ]);

    const rows: DietitianCustomerRow[] = listRows.map((row) => {
      const cadence = cadenceByCustomer.get(row.customerProfileId);
      return {
        customerProfileId: row.customerProfileId,
        customerCode: row.customerCode,
        name: row.name,
        mobile: row.mobile,
        category: row.category,
        assignedDietitianName: row.assignedDietitianName,
        lastDietitianLogDate: lastLogDates.get(row.customerProfileId) ?? null,
        daysNotLogged: cadence?.daysNotLogged ?? 0,
        pendingLogCount: cadence?.pendingLogCount ?? 0,
        pausedDaysCount: cadence?.pausedDaysCount ?? 0,
        skippedSelfLogCount: cadence?.skippedSelfLogCount ?? 0,
        datesWithoutSelfLogCount: cadence?.datesWithoutSelfLogCount ?? 0,
      };
    });

    const filtered = applyDietitianFilters(rows, filters);
    const sorted = sortDietitianRows(filtered, sort.key, sort.direction);

    const clinicNotice =
      scope.kind === "core" && scope.clinicId === null ? NO_CLINIC_ASSIGNED_NOTICE : null;

    return { success: true, data: { rows: sorted, clinicNotice } };
  } catch (err) {
    console.error("listDietitianCustomers error:", err);
    return { success: false, error: "Failed to load the customer list." };
  }
}

// ---------------------------------------------------------------------------
// 9.4 — getDietitianCustomerDetail
// ---------------------------------------------------------------------------

/**
 * Read one Customer_Record's full detail for the read-only Dietitian
 * Customer_360 view (Req 16.2): profile identity, addresses, the governing
 * subscription summary and the cadence/adherence numbers.
 *
 * Self-gating via `checkDietitianScope` — a customer outside the caller's
 * readable scope, or a caller who is not an active Dietitian, yields
 * `{ success: false, error: "Customer is not in your scope" }` (Req 5.8, 5.9)
 * without a second round trip to fetch the row.
 *
 * Req 5.8, 5.9, 16.2
 */
export async function getDietitianCustomerDetail(
  customerProfileId: string,
): Promise<ActionResult<DietitianCustomerDetail>> {
  const gate = await checkDietitianScope(customerProfileId);
  if (!gate.ok) return { success: false, error: gate.error };

  try {
    const [detail, cadence, lastLogDates] = await Promise.all([
      getCustomerDetailRow(customerProfileId),
      getCadenceForCustomer(customerProfileId),
      getLastDietitianLogDates([customerProfileId]),
    ]);

    if (!detail) {
      return { success: false, error: "Customer not found." };
    }

    return {
      success: true,
      data: {
        customerProfileId: detail.customerProfileId,
        customerCode: detail.customerCode,
        name: detail.name,
        mobile: detail.mobile,
        email: detail.email,
        category: detail.category,
        assignedDietitianName: detail.assignedDietitianName,
        addresses: detail.addresses,
        governingSubscription: detail.governingSubscription,
        cadence: {
          lastDietitianLogDate: lastLogDates.get(customerProfileId) ?? null,
          daysNotLogged: cadence.daysNotLogged,
          pendingLogCount: cadence.pendingLogCount,
          pausedDaysCount: cadence.pausedDaysCount,
          skippedSelfLogCount: cadence.skippedSelfLogCount,
          datesWithoutSelfLogCount: cadence.datesWithoutSelfLogCount,
        },
      },
    };
  } catch (err) {
    console.error("getDietitianCustomerDetail error:", err);
    return { success: false, error: "Failed to load the customer detail." };
  }
}

// ---------------------------------------------------------------------------
// 9.4 — getCustomParameterSuggestions
// ---------------------------------------------------------------------------

/**
 * List the Custom_Parameter labels previously used on a customer's
 * Dietitian_Logs, for the Add Parameter suggestion list (Req 12.9).
 *
 * Self-gating via `checkDietitianScope`, identical to
 * {@link getDietitianCustomerDetail} — a customer outside scope yields the
 * pinned scope-miss message rather than the suggestion list.
 *
 * Req 5.8, 5.9, 12.9
 */
export async function getCustomParameterSuggestions(
  customerProfileId: string,
): Promise<ActionResult<string[]>> {
  const gate = await checkDietitianScope(customerProfileId);
  if (!gate.ok) return { success: false, error: gate.error };

  try {
    const labels = await getCustomParameterLabelSuggestions(customerProfileId);
    return { success: true, data: labels };
  } catch (err) {
    console.error("getCustomParameterSuggestions error:", err);
    return { success: false, error: "Failed to load parameter suggestions." };
  }
}
