"use server";

// src/actions/admin-actions/workloadActions.ts
// Server Action backing the admin Operations workload view, an extension of the
// Daily Meal Roster (core-clinic-architecture, tasks 15.1 & 15.2;
// Requirements 13.1–13.5).
//
// LAYERING: orchestrates authorization (pure `canAccessWorkloadView`), workload
// derivation (src/lib/clinic/workload.ts — stamp-derived per Req 19.6), and the
// clinic/kitchen repositories. Authorization is the PRIMARY guard: the action
// resolves the caller's role and refuses to return ANY workload data to a role
// that is not ADMIN/MASTER_ADMIN (Req 13.4, 13.5). RLS policies on
// `workload_snapshots` (global-roles-only) reinforce this at the database layer,
// but RLS is not currently enabled on that table, so this app-layer check is the
// authoritative gate.

import { createClient } from "@/lib/supabase/server";
import {
  canAccessWorkloadView,
  WORKLOAD_FORBIDDEN_CODE,
} from "@/lib/clinic/workload-access";
import { getISTDateString } from "@/lib/dates/ist";
import {
  computeClinicMealCounts,
  getWorkloadStatistics,
} from "@/lib/clinic/workload";
import { listClinics } from "@/repositories/clinic/clinicRepository";
import { listKitchens } from "@/repositories/clinic/kitchenRepository";
import type {
  WorkloadAggregate,
  WorkloadMealCounts,
} from "@/types/clinic";

/** Next-day meal counts for one Core Clinic. */
export interface ClinicWorkloadCount extends WorkloadMealCounts {
  clinic_id: string;
  clinic_name: string;
  kitchen_id: string;
}

/** Next-day meal counts aggregated for one Kitchen. */
export interface KitchenWorkloadCount extends WorkloadMealCounts {
  kitchen_id: string;
  kitchen_name: string;
}

/** Next-day prep workload broken down per Clinic and per Kitchen (Req 13.1). */
export interface NextDayWorkload {
  target_date: string;
  clinics: ClinicWorkloadCount[];
  kitchens: KitchenWorkloadCount[];
}

/** Full payload returned to the workload view. */
export interface ClinicWorkloadView {
  nextDay: NextDayWorkload;
  history: WorkloadAggregate[];
}

type WorkloadActionResult =
  | { success: true; data: ClinicWorkloadView }
  | { success: false; error: string; code?: string };

/**
 * Resolve the calling user's role code, or `null` when no user/role can be
 * resolved. Mirrors the auth-resolution pattern used by the master-portal
 * clinic actions (`users.select("id, roles(code)")` keyed by `auth_user_id`).
 */
async function resolveCallerRoleCode(): Promise<string | null> {
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
 * Build the admin workload view: next-day per-Clinic and per-Kitchen meal counts
 * plus the most recent 30 days of persisted-snapshot history.
 *
 * Authorization (Req 13.4, 13.5): only ADMIN and MASTER_ADMIN are served. Any
 * other role — notably a franchise admin role — receives a `forbidden` failure
 * and NO workload data whatsoever.
 *
 * Zero-count / empty state (Req 13.3): when there are no Core Clinics, no
 * scheduled meals, or no persisted snapshots in range, the action still returns
 * `success: true` with zeroed/empty structures — it never errors.
 *
 * Next-day counts are derived from the IMMUTABLE order clinic stamp via
 * `computeClinicMealCounts` (Req 19.6), never from a customer's current clinic.
 *
 * Validates: Requirements 13.1, 13.2, 13.3, 13.4, 13.5.
 */
export async function getClinicWorkloadView(): Promise<WorkloadActionResult> {
  // ── Authorization gate (primary guard) ──────────────────────────────────────
  const roleCode = await resolveCallerRoleCode();
  if (!canAccessWorkloadView(roleCode)) {
    return {
      success: false,
      error: "Access denied",
      code: WORKLOAD_FORBIDDEN_CODE,
    };
  }

  const tomorrow = getISTDateString(1);

  // ── Next-day per-Clinic counts (Core Clinics only: franchise_id IS NULL) ─────
  const allClinics = await listClinics();
  const coreClinics = allClinics.filter((c) => c.franchise_id === null);

  // Kitchen names for the per-Kitchen breakdown.
  const kitchens = await listKitchens();
  const kitchenNameById = new Map(kitchens.map((k) => [k.id, k.name]));

  const clinicCounts: ClinicWorkloadCount[] = [];
  // Accumulate per-kitchen totals as we walk the clinics.
  const kitchenAccum = new Map<string, WorkloadMealCounts>();

  for (const clinic of coreClinics) {
    const counts = await computeClinicMealCounts(clinic.id, tomorrow);

    clinicCounts.push({
      clinic_id: clinic.id,
      clinic_name: clinic.name,
      kitchen_id: clinic.kitchen_id,
      veg_count: counts.veg_count,
      non_veg_count: counts.non_veg_count,
      egg_count: counts.egg_count,
    });

    const existing = kitchenAccum.get(clinic.kitchen_id) ?? {
      veg_count: 0,
      non_veg_count: 0,
      egg_count: 0,
    };
    kitchenAccum.set(clinic.kitchen_id, {
      veg_count: existing.veg_count + counts.veg_count,
      non_veg_count: existing.non_veg_count + counts.non_veg_count,
      egg_count: existing.egg_count + counts.egg_count,
    });
  }

  const kitchenCounts: KitchenWorkloadCount[] = [...kitchenAccum.entries()]
    .map(([kitchen_id, counts]) => ({
      kitchen_id,
      kitchen_name: kitchenNameById.get(kitchen_id) ?? "Unknown Kitchen",
      veg_count: counts.veg_count,
      non_veg_count: counts.non_veg_count,
      egg_count: counts.egg_count,
    }))
    .sort((a, b) => a.kitchen_name.localeCompare(b.kitchen_name));

  // ── History: most recent 30 calendar days up to and including today ──────────
  // (Req 13.2). getWorkloadStatistics returns an empty array when no snapshots
  // fall in range, which surfaces as the zero-count state (Req 13.3).
  let history: WorkloadAggregate[] = [];
  const stats = await getWorkloadStatistics({
    startDate: getISTDateString(-29),
    endDate: getISTDateString(),
    grouping: "day",
  });
  if (stats.success) {
    history = stats.data;
  }
  // A statistics failure (e.g. transient read error) collapses to an empty
  // history rather than failing the whole view — the next-day workload and the
  // empty-state messaging still render (Req 13.3).

  return {
    success: true,
    data: {
      nextDay: {
        target_date: tomorrow,
        clinics: clinicCounts,
        kitchens: kitchenCounts,
      },
      history,
    },
  };
}
