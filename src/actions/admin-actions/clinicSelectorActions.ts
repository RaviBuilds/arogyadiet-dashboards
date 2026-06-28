"use server";

// src/actions/admin-actions/clinicSelectorActions.ts
// Admin-portal Server Action backing the clinic-selector-first operational
// views (core-clinic-architecture, task 13.3 — Requirements 17.1–17.9).
//
// The Live Routing Board, Live Tracking, and Routing Sandbox become
// "clinic-selector-first": they render no rider/route/tracking data until the
// Admin picks a Clinic, then show only that Clinic's riders. This action
// supplies the selector's option list — the Core Clinics (`franchise_id IS
// NULL`) — together with the set of clinic ids the caller is authorized to
// select (Req 17.9).
//
// AUTHORIZED SET: For a core ADMIN / MASTER_ADMIN the authorized set is the
// sentinel "all" — every Core Clinic is selectable. The value is returned
// explicitly (rather than assumed in the UI) so a future spec can narrow it to
// a concrete id list without touching the components, which already pass it
// through the pure `authorizedClinicOptions` helper.
//
// LAYERING: Mirrors `serviceAreaActions.ts` / `riderClinicActions.ts` —
// authorization resolves the caller via the SSR server client (`createClient`),
// while the clinic read uses the service-role admin client
// (`createAdminClient`).

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

// Roles permitted to use the operational clinic selector (admin portal).
const ALLOWED_ROLES = new Set(["ADMIN", "MASTER_ADMIN"]);

/** A single Core Clinic option for the operational clinic selector. */
export type SelectableClinic = { id: string; name: string };

/**
 * The selector payload: the Core Clinic options plus the authorized id set.
 * `authorizedClinicIds` is the sentinel `"all"` for core admins (every Core
 * Clinic is selectable); an empty array means the caller may select none
 * (also used for an unauthorized caller).
 */
export type SelectableClinicsResult = {
  clinics: SelectableClinic[];
  authorizedClinicIds: string[] | "all";
};

/**
 * Resolve the calling user and confirm they hold an ADMIN or MASTER_ADMIN role.
 */
async function resolveCallerRole(): Promise<string | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const { data: userRecord } = await supabase
    .from("users")
    .select("id, roles(code)")
    .eq("auth_user_id", user.id)
    .single();

  if (!userRecord) return null;

  const rolesData = userRecord.roles as
    | { code?: string }
    | { code?: string }[]
    | null;
  const roleCode = Array.isArray(rolesData)
    ? rolesData[0]?.code
    : rolesData?.code;

  return roleCode ?? null;
}

/**
 * List the Core Clinics (`franchise_id IS NULL`) selectable in the operational
 * clinic-selector-first views, with the caller's authorized id set.
 *
 * Returns `{ clinics: [], authorizedClinicIds: [] }` for an unauthorized caller
 * so the selector renders empty rather than leaking clinic data. For a core
 * ADMIN / MASTER_ADMIN every Core Clinic is selectable, so `authorizedClinicIds`
 * is `"all"` (Req 17.9).
 */
export async function getSelectableClinics(): Promise<SelectableClinicsResult> {
  const roleCode = await resolveCallerRole();

  if (!roleCode || !ALLOWED_ROLES.has(roleCode)) {
    return { clinics: [], authorizedClinicIds: [] };
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("clinics")
    .select("id, name")
    .is("franchise_id", null)
    .order("name", { ascending: true });

  if (error) {
    console.error("[getSelectableClinics]", error);
    return { clinics: [], authorizedClinicIds: "all" };
  }

  const clinics: SelectableClinic[] = (data ?? []).map((row) => ({
    id: (row as { id: string }).id,
    name: (row as { name: string }).name,
  }));

  // Core admins may access every Core Clinic. Returned explicitly so the
  // authorized set can later be restricted without changing the UI layer.
  return { clinics, authorizedClinicIds: "all" };
}
