// src/repositories/dietitian/dietitianRepository.ts
// Data-access layer for Dietitian `users` rows (dietitian-management — Task 6.1).
//
// LAYERING: Data-access ONLY. No business validation (role/franchise
// derivation, franchise-uniqueness handling, auth-account compensation — all
// of that lives in `src/services/DietitianAccountService.ts`) and no
// 'use server' wrappers (those live in `src/actions/master-actions/*`). Uses
// the service-role admin client, mirroring `src/repositories/clinic/clinicRepository.ts`.
//
// A Dietitian is a `users` row with `admin_access_level = 'dietitian'`. The
// Dietitian_Clinic_Link is `users.dietitian_clinic_id` (0..1 per Dietitian,
// Req 6.1 design). This module resolves the owning Clinic and Franchise names
// with follow-up queries rather than nested PostgREST embeds, mirroring the
// multi-step resolution pattern in `clinicRepository.resolveBusinessForClinic`
// — that keeps the joins correct without depending on an inferred/guessed
// foreign-key constraint name.
//
// Requirements: 2.3, 3.1, 3.3, 3.4, 3.5, 7.1, 8.2, 9.2, 10.1, 10.3, 20.1, 21.1

import { createAdminClient } from "@/lib/supabase/admin";
import type { DietitianAccount } from "@/types/dietitian";

/** The role codes a Dietitian account may carry (Req 2.9, 2.10, 22.3). */
export type DietitianRoleCode = "ADMIN" | "FRANCHISE_ADMIN";

const DIETITIAN_LEVEL = "dietitian" as const;

const DIETITIAN_USER_COLUMNS =
  "id, auth_user_id, full_name, email, mobile, franchise_id, dietitian_clinic_id, is_active, created_at, roles(code)";

/** Shape of a `users` row selected with `DIETITIAN_USER_COLUMNS` (snake_case). */
interface DietitianUserRow {
  id: string;
  auth_user_id: string;
  full_name: string;
  email: string;
  mobile: string;
  franchise_id: string | null;
  dietitian_clinic_id: string | null;
  is_active: boolean;
  created_at: string;
  roles: { code: string } | { code: string }[] | null;
}

/**
 * A Clinic joined with the name of its owning Franchise, `null` for a
 * Core_Business Clinic (Req 2.3, 3.5, 3.6).
 */
export interface ClinicWithFranchiseName {
  id: string;
  name: string;
  franchiseId: string | null;
  franchiseName: string | null;
}

/**
 * Input for inserting a new Dietitian `users` row. `roleCode` and
 * `franchiseId` are derived from the assigned Clinic by
 * `DietitianAccountService` (Req 2.9, 2.10) — this layer resolves `roleCode`
 * to a `role_id` but performs no derivation of its own.
 */
export interface DietitianInsertInput {
  authUserId: string;
  roleCode: DietitianRoleCode;
  fullName: string;
  email: string;
  mobile: string;
  franchiseId: string | null;
  clinicId: string | null;
}

/**
 * Fields that may be updated on an existing Dietitian `users` row. Only
 * supplied keys are written. `email` and the role are intentionally absent —
 * neither is editable on this surface (Req 3.5).
 */
export interface DietitianUpdateInput {
  fullName?: string;
  mobile?: string;
  clinicId?: string | null;
  franchiseId?: string | null;
  isActive?: boolean;
  /**
   * The role a Dietitian must carry for its (possibly reassigned) Clinic
   * (Req 3.6, Property 5). Supplied by `DietitianAccountService` whenever
   * `clinicId` changes, so a reassignment across the Core_Business/Franchise
   * boundary re-stamps `role_id` alongside `franchise_id` rather than leaving
   * a stale role on the `users` row.
   */
  roleCode?: DietitianRoleCode;
}

/**
 * Extract a single role code from the `roles(code)` embed, which Supabase may
 * return as an object or a one-element array depending on the relationship
 * cardinality it infers.
 */
function extractRoleCode(roles: DietitianUserRow["roles"]): DietitianRoleCode {
  const code = Array.isArray(roles) ? roles[0]?.code : roles?.code;
  return code === "FRANCHISE_ADMIN" ? "FRANCHISE_ADMIN" : "ADMIN";
}

/**
 * Resolve `franchise_id → franchise name` for a batch of ids in one query.
 * Returns an empty map for an empty input (no round trip).
 */
async function resolveFranchiseNames(
  admin: ReturnType<typeof createAdminClient>,
  franchiseIds: readonly string[]
): Promise<Map<string, string>> {
  const distinct = Array.from(new Set(franchiseIds));
  if (distinct.length === 0) return new Map();

  const { data, error } = await admin
    .from("franchises")
    .select("id, name")
    .in("id", distinct);

  if (error) {
    throw new Error(`Failed to resolve franchise names: ${error.message}`);
  }

  const map = new Map<string, string>();
  for (const row of data ?? []) {
    map.set(row.id as string, row.name as string);
  }
  return map;
}

/**
 * Resolve `clinic_id → clinic name` for a batch of ids in one query.
 * Returns an empty map for an empty input (no round trip).
 */
async function resolveClinicNames(
  admin: ReturnType<typeof createAdminClient>,
  clinicIds: readonly string[]
): Promise<Map<string, string>> {
  const distinct = Array.from(new Set(clinicIds));
  if (distinct.length === 0) return new Map();

  const { data, error } = await admin
    .from("clinics")
    .select("id, name")
    .in("id", distinct);

  if (error) {
    throw new Error(`Failed to resolve clinic names: ${error.message}`);
  }

  const map = new Map<string, string>();
  for (const row of data ?? []) {
    map.set(row.id as string, row.name as string);
  }
  return map;
}

/**
 * Join a batch of raw Dietitian `users` rows with their Clinic and Franchise
 * names via two follow-up batched queries (never one query per row).
 */
async function buildDietitianAccounts(
  admin: ReturnType<typeof createAdminClient>,
  rows: readonly DietitianUserRow[]
): Promise<DietitianAccount[]> {
  const clinicIds = rows
    .map((r) => r.dietitian_clinic_id)
    .filter((id): id is string => id !== null);
  const franchiseIds = rows
    .map((r) => r.franchise_id)
    .filter((id): id is string => id !== null);

  const [clinicNames, franchiseNames] = await Promise.all([
    resolveClinicNames(admin, clinicIds),
    resolveFranchiseNames(admin, franchiseIds),
  ]);

  return rows.map((row) => ({
    id: row.id,
    authUserId: row.auth_user_id,
    fullName: row.full_name,
    email: row.email,
    mobile: row.mobile,
    roleCode: extractRoleCode(row.roles),
    clinicId: row.dietitian_clinic_id,
    clinicName: row.dietitian_clinic_id
      ? clinicNames.get(row.dietitian_clinic_id) ?? null
      : null,
    franchiseId: row.franchise_id,
    franchiseName: row.franchise_id
      ? franchiseNames.get(row.franchise_id) ?? null
      : null,
    isActive: row.is_active,
    createdAt: row.created_at,
  }));
}

/**
 * Resolve the `role_id` for a Dietitian role code. Throws when the `roles`
 * table has no matching row — a system configuration error, not a user error.
 */
async function resolveRoleId(
  admin: ReturnType<typeof createAdminClient>,
  roleCode: DietitianRoleCode
): Promise<string> {
  const { data, error } = await admin
    .from("roles")
    .select("id")
    .eq("code", roleCode)
    .single();

  if (error || !data) {
    throw new Error(
      `Failed to resolve role id for code ${roleCode}: ${error?.message ?? "role not found"}`
    );
  }
  return data.id as string;
}

/**
 * List every Dietitian `users` row (Access_Level `dietitian`), ordered by
 * created date descending, joined with the assigned Clinic name and the
 * owning Franchise name (Req 3.1, 3.3, 3.4).
 */
export async function listDietitians(): Promise<DietitianAccount[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("users")
    .select(DIETITIAN_USER_COLUMNS)
    .eq("admin_access_level", DIETITIAN_LEVEL)
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(`Failed to list dietitians: ${error.message}`);
  }
  return buildDietitianAccounts(admin, (data ?? []) as DietitianUserRow[]);
}

/**
 * Fetch a single Dietitian by its `users.id`. Returns `null` when not found or
 * when the row's Access_Level is not `dietitian`.
 */
export async function getDietitianById(
  id: string
): Promise<DietitianAccount | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("users")
    .select(DIETITIAN_USER_COLUMNS)
    .eq("id", id)
    .eq("admin_access_level", DIETITIAN_LEVEL)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to fetch dietitian ${id}: ${error.message}`);
  }
  if (!data) return null;

  const [account] = await buildDietitianAccounts(admin, [
    data as DietitianUserRow,
  ]);
  return account;
}

/**
 * Insert a new Dietitian `users` row. Always sets `admin_access_level =
 * 'dietitian'`, `is_active = true`, `force_password_change = true` and
 * `is_email_verified = true`, matching the seeded-Dietitian shape (Req 4.2)
 * and the existing admin-creation pattern. Franchise uniqueness (Req 2.11,
 * 2.12) is enforced by the database partial unique index; a violation surfaces
 * as a Postgres error for the service layer to map to its pinned message.
 */
export async function insertDietitian(
  input: DietitianInsertInput
): Promise<DietitianAccount> {
  const admin = createAdminClient();
  const roleId = await resolveRoleId(admin, input.roleCode);

  const { data, error } = await admin
    .from("users")
    .insert({
      auth_user_id: input.authUserId,
      role_id: roleId,
      full_name: input.fullName,
      email: input.email,
      mobile: input.mobile,
      admin_access_level: DIETITIAN_LEVEL,
      franchise_id: input.franchiseId,
      dietitian_clinic_id: input.clinicId,
      is_active: true,
      is_email_verified: true,
      force_password_change: true,
    })
    .select(DIETITIAN_USER_COLUMNS)
    .single();

  if (error || !data) {
    throw new Error(
      `Failed to insert dietitian: ${error?.message ?? "unknown error"}`
    );
  }

  const [account] = await buildDietitianAccounts(admin, [
    data as DietitianUserRow,
  ]);
  return account;
}

/**
 * Update an existing Dietitian `users` row. Only supplied keys are written.
 * `clinicId` and `franchiseId` are updated together by the service layer when
 * the assigned Clinic changes (Req 3.6); this layer writes whichever of the
 * two keys is supplied without inferring one from the other. Returns the
 * updated record.
 */
export async function updateDietitian(
  id: string,
  input: DietitianUpdateInput
): Promise<DietitianAccount> {
  const admin = createAdminClient();

  const payload: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (input.fullName !== undefined) payload.full_name = input.fullName;
  if (input.mobile !== undefined) payload.mobile = input.mobile;
  if (input.clinicId !== undefined) payload.dietitian_clinic_id = input.clinicId;
  if (input.franchiseId !== undefined) payload.franchise_id = input.franchiseId;
  if (input.isActive !== undefined) payload.is_active = input.isActive;
  if (input.roleCode !== undefined) {
    payload.role_id = await resolveRoleId(admin, input.roleCode);
  }

  const { data, error } = await admin
    .from("users")
    .update(payload)
    .eq("id", id)
    .eq("admin_access_level", DIETITIAN_LEVEL)
    .select(DIETITIAN_USER_COLUMNS)
    .single();

  if (error || !data) {
    throw new Error(
      `Failed to update dietitian ${id}: ${error?.message ?? "unknown error"}`
    );
  }

  const [account] = await buildDietitianAccounts(admin, [
    data as DietitianUserRow,
  ]);
  return account;
}

/**
 * Read a Dietitian's Dietitian_Clinic_Link (Req 3.4). Returns `null` when the
 * Dietitian has no assigned Clinic or the user does not exist.
 */
export async function getDietitianClinicId(
  userId: string
): Promise<string | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("users")
    .select("dietitian_clinic_id")
    .eq("id", userId)
    .eq("admin_access_level", DIETITIAN_LEVEL)
    .maybeSingle();

  if (error) {
    throw new Error(
      `Failed to read dietitian_clinic_id for ${userId}: ${error.message}`
    );
  }
  return (data?.dietitian_clinic_id as string | null) ?? null;
}

/**
 * Write a Dietitian's Dietitian_Clinic_Link in isolation, without touching any
 * other field. Used by callers that only need to move a Dietitian between
 * Clinics (e.g. reassignment flows that resolve `franchise_id` separately).
 */
export async function setDietitianClinicId(
  userId: string,
  clinicId: string | null
): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin
    .from("users")
    .update({
      dietitian_clinic_id: clinicId,
      updated_at: new Date().toISOString(),
    })
    .eq("id", userId)
    .eq("admin_access_level", DIETITIAN_LEVEL);

  if (error) {
    throw new Error(
      `Failed to set dietitian_clinic_id for ${userId}: ${error.message}`
    );
  }
}

/**
 * List every Clinic recorded in the `clinics` table, joined with the name of
 * its owning Franchise (`null` for a Core_Business Clinic), ordered by name
 * (Req 2.3, 3.5).
 */
export async function listClinicsWithFranchiseName(): Promise<
  ClinicWithFranchiseName[]
> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("clinics")
    .select("id, name, franchise_id")
    .order("name", { ascending: true });

  if (error) {
    throw new Error(`Failed to list clinics: ${error.message}`);
  }

  const rows = data ?? [];
  const franchiseIds = rows
    .map((r) => r.franchise_id as string | null)
    .filter((id): id is string => id !== null);
  const franchiseNames = await resolveFranchiseNames(admin, franchiseIds);

  return rows.map((row) => ({
    id: row.id as string,
    name: row.name as string,
    franchiseId: (row.franchise_id as string | null) ?? null,
    franchiseName: row.franchise_id
      ? franchiseNames.get(row.franchise_id as string) ?? null
      : null,
  }));
}

/**
 * Count active Dietitians (`is_active = true`, Access_Level `dietitian`)
 * linked to a given Franchise (Req 10.1, 10.3, 10.4). The at-most-one
 * cardinality invariant (Req 10.5, 10.6) is enforced by the database partial
 * unique index; this count supports UI-level checks (e.g. Req 3.7, 22.5) and
 * property tests, not the enforcement itself.
 */
export async function countActiveDietitiansForFranchise(
  franchiseId: string
): Promise<number> {
  const admin = createAdminClient();
  const { count, error } = await admin
    .from("users")
    .select("id", { count: "exact", head: true })
    .eq("admin_access_level", DIETITIAN_LEVEL)
    .eq("franchise_id", franchiseId)
    .eq("is_active", true);

  if (error) {
    throw new Error(
      `Failed to count active dietitians for franchise ${franchiseId}: ${error.message}`
    );
  }
  return count ?? 0;
}

/**
 * List every active Dietitian linked to a given Clinic via
 * `dietitian_clinic_id` (Req 7.1, 8.2), ordered by name.
 */
export async function listActiveDietitiansForClinic(
  clinicId: string
): Promise<DietitianAccount[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("users")
    .select(DIETITIAN_USER_COLUMNS)
    .eq("admin_access_level", DIETITIAN_LEVEL)
    .eq("dietitian_clinic_id", clinicId)
    .eq("is_active", true)
    .order("full_name", { ascending: true });

  if (error) {
    throw new Error(
      `Failed to list active dietitians for clinic ${clinicId}: ${error.message}`
    );
  }
  return buildDietitianAccounts(admin, (data ?? []) as DietitianUserRow[]);
}

/**
 * List every active Dietitian for a Franchise (Req 7.6, 8.8) — at most one by
 * the `users_one_active_dietitian_per_franchise` cardinality constraint, but
 * returned as a list so the caller (the Franchise-session onboarding path)
 * can treat "none" and "one" uniformly without a separate existence check.
 */
export async function listActiveDietitiansForFranchise(
  franchiseId: string
): Promise<DietitianAccount[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("users")
    .select(DIETITIAN_USER_COLUMNS)
    .eq("admin_access_level", DIETITIAN_LEVEL)
    .eq("franchise_id", franchiseId)
    .eq("is_active", true)
    .order("full_name", { ascending: true });

  if (error) {
    throw new Error(
      `Failed to list active dietitians for franchise ${franchiseId}: ${error.message}`
    );
  }
  return buildDietitianAccounts(admin, (data ?? []) as DietitianUserRow[]);
}

/**
 * List every active Dietitian, independent of Clinic (Req 9.2, 20.1) — used by
 * the Accommodation onboarding dropdown (any active Dietitian) and the master
 * dashboard Dietitian dropdown (labelled with the assigned Clinic name).
 * Ordered by name.
 */
export async function listActiveDietitians(): Promise<DietitianAccount[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("users")
    .select(DIETITIAN_USER_COLUMNS)
    .eq("admin_access_level", DIETITIAN_LEVEL)
    .eq("is_active", true)
    .order("full_name", { ascending: true });

  if (error) {
    throw new Error(`Failed to list active dietitians: ${error.message}`);
  }
  return buildDietitianAccounts(admin, (data ?? []) as DietitianUserRow[]);
}
