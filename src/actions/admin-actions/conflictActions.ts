"use server";

// src/actions/admin-actions/conflictActions.ts
// Admin-portal read model for the Conflict Clinic flow
// (core-clinic-architecture, task 8.2).
//
// The Conflict_Clinic_List for a delivery day is a DERIVED, read-only view — no
// table backs it. After order creation each `delivery_orders` row carries its
// delivery-address clinic stamp (Req 19.2 / 22.3). A conflict exists for a
// customer wherever that order stamp differs from the customer's current
// (Primary_Address) clinic, OR is null (the delivery address resolved to no
// clinic). The customer always stays anchored to their Primary_Address clinic —
// surfacing a conflict NEVER moves the customer (Req 22.2, 22.8).
//
// The underlying query (per the design's Conflict Clinic Flow section) is:
//
//   SELECT o.customer_profile_id, cp.clinic_id AS primary_clinic_id,
//          o.clinic_id AS delivery_clinic_id, o.delivery_date
//     FROM public.delivery_orders o
//     JOIN public.customer_profiles cp ON cp.id = o.customer_profile_id
//    WHERE o.delivery_date = :target_date
//      AND o.clinic_id IS DISTINCT FROM cp.clinic_id;  -- mismatch AND unresolved(null)
//
// The Supabase JS client cannot express `IS DISTINCT FROM` as a filter, so we
// fetch that day's orders with their owning customer's primary clinic and apply
// the null-safe inequality in code, then resolve clinic display names.
//
// LAYERING: data reads use `createAdminClient`; authorization resolves the
// caller via the SSR server client (`createClient`), mirroring
// `serviceAreaActions.ts`. Restricted to ADMIN / MASTER_ADMIN (Req 22.7).

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ActionResult } from "@/types/clinic";
import type { ConflictClinicEntry } from "@/lib/clinic/conflict";

// Roles permitted to view the Conflict_Clinic_List (Req 22.7).
const ALLOWED_ROLES = new Set(["ADMIN", "MASTER_ADMIN"]);

// ─── Authorization ───────────────────────────────────────────────────────────

/**
 * Resolve the calling user and confirm they hold an ADMIN or MASTER_ADMIN role.
 * Mirrors `assertCallerCanManageServiceAreas` in `serviceAreaActions.ts`.
 */
async function assertCallerCanViewConflicts(): Promise<
  { ok: true; userId: string } | { ok: false; error: string }
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
  const roleCode = Array.isArray(rolesData)
    ? rolesData[0]?.code
    : rolesData?.code;

  if (!roleCode || !ALLOWED_ROLES.has(roleCode)) {
    return {
      ok: false,
      error: "Only an Admin or Master Admin can view the conflict clinic list",
    };
  }

  return { ok: true, userId: userRecord.id };
}

// ─── Internal row shapes ─────────────────────────────────────────────────────

type ConflictOrderRow = {
  customer_profile_id: string | null;
  clinic_id: string | null; // delivery-address order stamp (Req 19.2 / 22.3)
  delivery_date: string;
  customer_profiles:
    | {
        clinic_id?: string | null; // Primary_Address clinic (Req 6.3)
        users?: { full_name?: string | null } | { full_name?: string | null }[] | null;
      }
    | {
        clinic_id?: string | null;
        users?: { full_name?: string | null } | { full_name?: string | null }[] | null;
      }[]
    | null;
};

// ─── Conflict_Clinic_List read model (Task 8.2) ──────────────────────────────

/**
 * Return the Conflict_Clinic_List for a single delivery day, restricted to
 * ADMIN / MASTER_ADMIN (Req 22.7).
 *
 * Each entry corresponds to a customer whose delivery-address order stamp for
 * `deliveryDate` differs from (or is absent against) their Primary_Address
 * clinic:
 *   - `reason = "unresolved"` when the order `clinic_id` is null — the delivery
 *     address resolved to no clinic; the order was not blocked (Req 19.8, 22.5).
 *   - `reason = "mismatch"`   when the order `clinic_id` is non-null and differs
 *     from the customer's current clinic (Req 22.2).
 *
 * The list is derived from the order stamp versus `customer_profiles.clinic_id`
 * (the Primary_Address clinic). It is read-only and never alters any customer's
 * stamp (Req 22.8); a conflict simply stops matching once the primary and
 * delivery clinics agree (Req 22.6).
 *
 * Validates: Requirements 22.2, 22.3, 22.5, 22.6, 22.7, 22.8.
 */
export async function getConflictClinicList(
  deliveryDate: string
): Promise<ActionResult<ConflictClinicEntry[]>> {
  const auth = await assertCallerCanViewConflicts();
  if (!auth.ok) return { success: false, error: auth.error };

  const trimmedDate = (deliveryDate ?? "").trim();
  if (!trimmedDate) {
    return {
      success: false,
      error: "A delivery date is required",
      field: "deliveryDate",
    };
  }

  try {
    const admin = createAdminClient();

    // Fetch that day's orders with the owning customer's Primary_Address clinic
    // and display name. We apply the null-safe `IS DISTINCT FROM` comparison in
    // code below since the JS client cannot express it as a filter.
    const { data, error } = await admin
      .from("delivery_orders")
      .select(
        "customer_profile_id, clinic_id, delivery_date, customer_profiles(clinic_id, users(full_name))"
      )
      .eq("delivery_date", trimmedDate);

    if (error) throw error;

    const rows = (data ?? []) as ConflictOrderRow[];

    // Keep only genuine conflicts: order stamp IS DISTINCT FROM primary clinic.
    type Conflict = {
      customerId: string;
      customerName: string;
      primaryClinicId: string | null;
      deliveryClinicId: string | null;
    };

    const conflicts: Conflict[] = [];
    const clinicIds = new Set<string>();

    for (const row of rows) {
      const customerId = row.customer_profile_id;
      if (!customerId) continue;

      const profileRel = row.customer_profiles;
      const profile = Array.isArray(profileRel) ? profileRel[0] : profileRel;

      const primaryClinicId = profile?.clinic_id ?? null;
      const deliveryClinicId = row.clinic_id ?? null;

      // Null-safe inequality: equivalent to `o.clinic_id IS DISTINCT FROM cp.clinic_id`.
      if (deliveryClinicId === primaryClinicId) continue;

      const userRel = profile?.users;
      const userObj = Array.isArray(userRel) ? userRel[0] : userRel;

      if (primaryClinicId) clinicIds.add(primaryClinicId);
      if (deliveryClinicId) clinicIds.add(deliveryClinicId);

      conflicts.push({
        customerId,
        customerName: userObj?.full_name ?? "Unknown",
        primaryClinicId,
        deliveryClinicId,
      });
    }

    // Resolve clinic display names for every referenced clinic in one query.
    const clinicNameById = new Map<string, string>();
    if (clinicIds.size > 0) {
      const { data: clinicRows, error: clinicError } = await admin
        .from("clinics")
        .select("id, name")
        .in("id", Array.from(clinicIds));

      if (clinicError) throw clinicError;

      for (const clinic of (clinicRows ?? []) as { id: string; name: string }[]) {
        clinicNameById.set(clinic.id, clinic.name);
      }
    }

    const entries: ConflictClinicEntry[] = conflicts.map((c) => ({
      customerId: c.customerId,
      customerName: c.customerName,
      primaryClinicId: c.primaryClinicId,
      primaryClinicName: c.primaryClinicId
        ? clinicNameById.get(c.primaryClinicId) ?? null
        : null,
      deliveryClinicId: c.deliveryClinicId,
      deliveryClinicName: c.deliveryClinicId
        ? clinicNameById.get(c.deliveryClinicId) ?? null
        : null,
      deliveryDate: trimmedDate,
      // `unresolved` when the delivery address resolved to no clinic (null stamp),
      // otherwise a `mismatch` against the Primary_Address clinic (Req 22.2, 22.5).
      reason: c.deliveryClinicId === null ? "unresolved" : "mismatch",
    }));

    return { success: true, data: entries };
  } catch (error) {
    console.error("getConflictClinicList error:", error);
    const message =
      error instanceof Error
        ? error.message
        : "Failed to load the conflict clinic list";
    return { success: false, error: message };
  }
}
