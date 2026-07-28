"use server";

// src/actions/admin-actions/dietitianAssignmentActions.ts
// Admin-portal Server Actions for the Dietitian_Link write path
// (dietitian-management, Task 9.7).
//
// LAYERING: Action layer ONLY. Authorization
// (`checkGroupManage("customers")`) lives here; every business rule
// (dietitian-validity check, clinic-membership check, the
// `admin_activity_logs` write naming both endpoints) lives in
// `src/services/AssignmentService.ts`. This is the admin-only write path used
// by the Customer_360 Clinic Assignment card — unlike
// `src/actions/dietitian-actions/*`, which is portal-neutral and self-gating
// via `checkDietitianScope`, this file is gated exclusively by the ADMIN
// operations-group model, mirroring every other write in
// `customerActions.ts` (Req 8.2, 8.9).
//
// `AssignmentService.reconcileOnClinicChange` — the per-Customer_Category
// clinic-change reconciliation table (Req 8.4, 8.5, 8.6) — is NOT called from
// this file. It is invoked from the existing `adminAssignCustomerClinic`
// action in `customerActions.ts`, so there is a single place where a Clinic
// change can touch a Dietitian_Link (see that file for the call site).
//
// Requirements: 6.4, 6.8, 8.2, 8.4, 8.5, 8.6, 8.9, 9.5

import { revalidatePath } from "next/cache";

import { checkGroupManage, getCurrentAdminContext } from "@/lib/auth/adminAccess";
import {
  setDietitianLink,
  type SetDietitianLinkResult,
} from "@/services/AssignmentService";
import { listActiveDietitiansForClinic } from "@/repositories/dietitian/dietitianRepository";
import type { DietitianAccount } from "@/types/dietitian";

/**
 * Discriminated union returned by every action in this file, matching the
 * `{ success, error, field? }` shape used across `customerActions.ts` and the
 * rest of the admin-actions surface.
 */
type ActionResult<T = void> =
  | { success: true; data: T }
  | { success: false; error: string; field?: string };

/** Uniform authorization-denied response for a missing operator identity. */
const UNAUTHORIZED_ERROR = "You do not have permission to perform this action.";

/**
 * Assign or clear a Customer_Record's Dietitian_Link from the Customer_360
 * Clinic Assignment card (Req 8.2, 8.9). Gated by
 * `checkGroupManage("customers")` — the same admin operations-group model
 * every other write in `customerActions.ts` uses.
 *
 * Delegates to `AssignmentService.setDietitianLink`, which performs the
 * dietitian-validity check (Req 6.4) and records both endpoints of the change
 * in `admin_activity_logs` (Req 6.8). `dietitianUserId === null` clears the
 * link and always succeeds (Req 6.2).
 *
 * The write is unscoped (no `requiredClinicId`): the Customer_360 dropdown
 * already limits its options to Dietitians linked to the customer's Clinic
 * (Req 8.2), so this action trusts the submitted id the same way the
 * onboarding Server Actions trust `validateDietitianForClinic`'s prior check
 * rather than re-deriving the Clinic here.
 */
export async function assignCustomerDietitian(
  customerProfileId: string,
  dietitianUserId: string | null,
): Promise<ActionResult<SetDietitianLinkResult>> {
  const gate = await checkGroupManage("customers");
  if (!gate.ok) return { success: false, error: gate.error };

  const { userId } = await getCurrentAdminContext();
  if (!userId) {
    return { success: false, error: UNAUTHORIZED_ERROR };
  }

  const result = await setDietitianLink({
    customerProfileId,
    dietitianUserId,
    actingUserId: userId,
  });

  if (!result.ok) {
    return { success: false, error: result.message };
  }

  revalidatePath(`/admin/customers/${customerProfileId}`);
  return { success: true, data: result };
}

/**
 * List every active Dietitian linked to a Clinic, for the Customer_360
 * Clinic Assignment card's Dietitian dropdown (Req 8.2). Gated by
 * `checkGroupManage("customers")`.
 *
 * A thin pass-through — this listing carries no business logic beyond the
 * authorization gate, so it is read directly from the repository rather than
 * via a service wrapper, mirroring
 * `listClinicsForDietitianAssignment` in `master-actions/dietitianActions.ts`.
 */
export async function listDietitiansForClinic(
  clinicId: string,
): Promise<ActionResult<DietitianAccount[]>> {
  const gate = await checkGroupManage("customers");
  if (!gate.ok) return { success: false, error: gate.error };

  try {
    const dietitians = await listActiveDietitiansForClinic(clinicId);
    return { success: true, data: dietitians };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to list dietitians",
    };
  }
}
