"use server";

// src/actions/franchise-actions/franchiseDietitianAssignmentActions.ts
//
// Feature: franchise-scoped-access — Task 10.
//
// The Franchise_Portal's Dietitian_Link surface: list the franchise's active
// Dietitians, and assign one to (or clear one from) a Customer_Record.
//
// WHY THIS EXISTS SEPARATELY FROM THE ADMIN EQUIVALENT:
// `admin-actions/dietitianAssignmentActions.assignCustomerDietitian` is gated by
// the admin group gate, which admits only ADMIN / MASTER_ADMIN — the same reason
// every franchise customer write used to fail (see
// `services/customerManagementCore.ts`). So the franchise portal gets its own
// entry point with its own gate, over the SAME `AssignmentService.setDietitianLink`
// used by admin. That service already handles candidate validation, the audit
// entry, and clearing.
//
// WHY THIS MUST LAND BEFORE THE READ-SCOPE NARROWING (Task 11):
// once a Franchise Dietitian reads only the Customer_Records linked to them,
// assignment is the ONLY way they can see anything. Shipping the narrowing first
// would leave franchises with no way to populate those links.
//
// TWO INDEPENDENT CHECKS ON EVERY ASSIGNMENT:
//   1. the target customer belongs to the caller's Franchise, and
//   2. the candidate Dietitian belongs to the SAME Franchise, is active, and
//      actually carries the `dietitian` Access_Level.
// (2) matters because `setDietitianLink` verifies only that the candidate IS a
// Dietitian — not that they are in the caller's tenant. Without it, a franchise
// could link its customers to another franchise's Dietitian, handing that
// Dietitian read access to rows outside their own tenant once Task 11's
// predicate keys off `dietitian_id`.

import { revalidatePath } from "next/cache";

import { createAdminClient } from "@/lib/supabase/admin";
import { checkFranchiseGroupManage } from "@/lib/auth/adminAccess";
import { setDietitianLink } from "@/services/AssignmentService";
import { listActiveDietitiansForFranchise } from "@/repositories/dietitian/dietitianRepository";
import { assignDietitianSchema } from "@/validations/dietitianSchema";
import { DIETITIAN_ACCESS_LEVEL } from "@/lib/auth/adminAccessCore";
import type { ActionResult } from "@/types/franchise";
import type { DietitianAccount } from "@/types/dietitian";

/** A candidate outside the caller's tenant reads the same as "not a dietitian". */
const DIETITIAN_NOT_IN_FRANCHISE =
  "That dietitian does not belong to your franchise.";

const CUSTOMER_NOT_IN_FRANCHISE =
  "This customer does not belong to your franchise.";

/**
 * Every active Dietitian of the caller's own Franchise, for the Customer_360
 * assignment dropdown.
 *
 * Gated on `customers` MANAGE rather than mere view: the only consumer is the
 * assignment control, and a view-only user has nothing to do with this list.
 */
export async function franchiseListDietitians(): Promise<
  ActionResult<DietitianAccount[]>
> {
  const gate = await checkFranchiseGroupManage("customers");
  if (!gate.ok) return { success: false, error: gate.error };

  try {
    const dietitians = await listActiveDietitiansForFranchise(
      gate.ctx.franchiseId,
    );
    return { success: true, data: dietitians };
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error ? error.message : "Failed to load dietitians.",
    };
  }
}

/**
 * Set or clear a Customer_Record's Dietitian_Link within the caller's Franchise.
 *
 * `dietitianUserId === null` clears the link, which is always legitimate — a
 * Customer_Record may have no assigned Dietitian.
 */
export async function franchiseAssignCustomerDietitian(
  customerProfileId: string,
  dietitianUserId: string | null,
): Promise<ActionResult<{ dietitianId: string | null }>> {
  const gate = await checkFranchiseGroupManage("customers");
  if (!gate.ok) return { success: false, error: gate.error };

  const parsed = assignDietitianSchema.safeParse({
    customerProfileId,
    dietitianUserId,
  });
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message ?? "Invalid assignment.",
    };
  }

  const { franchiseId, userId: actingUserId } = gate.ctx;
  const admin = createAdminClient();

  // ── Check 1: the customer is in the caller's Franchise ────────────────────
  const { data: profile } = await admin
    .from("customer_profiles")
    .select("id, franchise_id, clinic_id")
    .eq("id", parsed.data.customerProfileId)
    .maybeSingle();

  if (!profile) {
    return { success: false, error: "Customer not found." };
  }
  if ((profile.franchise_id as string | null) !== franchiseId) {
    return { success: false, error: CUSTOMER_NOT_IN_FRANCHISE };
  }

  // ── Check 2: the candidate Dietitian is in the SAME Franchise ─────────────
  if (parsed.data.dietitianUserId !== null) {
    const { data: candidate } = await admin
      .from("users")
      .select("id, franchise_id, admin_access_level, is_active")
      .eq("id", parsed.data.dietitianUserId)
      .maybeSingle();

    const isEligible =
      candidate !== null &&
      (candidate.franchise_id as string | null) === franchiseId &&
      candidate.admin_access_level === DIETITIAN_ACCESS_LEVEL &&
      candidate.is_active === true;

    // A non-existent, inactive, non-dietitian or out-of-tenant candidate all
    // report identically — no existence disclosure across tenants.
    if (!isEligible) {
      return { success: false, error: DIETITIAN_NOT_IN_FRANCHISE };
    }
  }

  // Delegate the write. `actingUserId` here is `public.users.id` (what
  // FranchiseAccessContext carries); `setDietitianLink` records it as the acting
  // user on the audit entry.
  const result = await setDietitianLink({
    customerProfileId: parsed.data.customerProfileId,
    dietitianUserId: parsed.data.dietitianUserId,
    actingUserId,
  });

  if (!result.ok) {
    return { success: false, error: result.message };
  }

  revalidatePath("/franchise/customers");
  revalidatePath(`/franchise/customers/${parsed.data.customerProfileId}`);

  return { success: true, data: { dietitianId: result.dietitianId } };
}
