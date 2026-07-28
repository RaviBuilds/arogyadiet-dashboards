// src/lib/dietitian/scope.ts
// Feature: dietitian-management — the Dietitian read-scope predicate.
// Pure module: no I/O, no clock, no Supabase import (the query builder is
// accepted structurally so this file stays testable without a client).
//
// This module is the application-side twin of the SQL security-definer helper
// `public.dietitian_can_read_customer(uuid)` in
// `scripts/create-dietitian-management-rls.sql`. The two are load-bearing
// together: RLS is the last line of defence, this predicate is what the
// services and guards read. They MUST agree row for row, so the SQL is
// transcribed here literally, including its NULL semantics:
//
//   SELECT EXISTS (
//     SELECT 1
//     FROM public.current_dietitian() d
//     JOIN public.customer_profiles cp ON cp.id = p_profile_id
//     WHERE (d.franchise_id IS NOT NULL AND cp.franchise_id = d.franchise_id)
//        OR (d.franchise_id IS NULL AND cp.dietitian_id = d.user_id)
//   )
//
// Notes on the transcription:
//   * `DietitianScope.kind` encodes `d.franchise_id IS NOT NULL` — a
//     `franchise` scope is the first disjunct, a `core` scope is the second.
//     The two disjuncts are therefore mutually exclusive, exactly as in SQL:
//     a Franchise Dietitian reads by tenant only (Req 21.8, 21.11, 22.8), and
//     never by Dietitian_Link.
//   * A Core_Business Dietitian reads ONLY the Customer_Records assigned to
//     them via Dietitian_Link (`cp.dietitian_id = d.user_id`). The linked
//     Clinic does NOT widen the read scope — a Dietitian never sees a
//     clinic-mate's customer they were not assigned to. `d.clinic_id` is kept
//     on the scope object for other, non-read concerns but is inert here.
//   * SQL `=` on a NULL operand yields NULL, not TRUE. Because every id carried
//     by a scope is a non-null string, plain `===` reproduces that: a
//     Customer_Record with `franchise_id` or `dietitian_id` NULL simply fails
//     that comparison.
//   * `current_dietitian()` returns no rows for a non-Dietitian or a
//     deactivated Dietitian, which makes the SQL predicate false. There is no
//     `DietitianScope` value for that case by construction — callers must not
//     build a scope for a user who is not an active Dietitian.
//
// _Requirements: 4.4, 5.5, 5.6, 5.11, 21.8, 21.11, 22.8_

// ─── Types ───────────────────────────────────────────────────────────────────

/**
 * The readable-scope identity of an active Dietitian.
 *
 * `core` is a Core_Business Dietitian (`users.franchise_id IS NULL`) with zero
 * or one linked Clinic; `franchise` is a Franchise Dietitian, whose scope is
 * the whole tenant.
 */
export type DietitianScope =
  | { kind: "core"; dietitianUserId: string; clinicId: string | null }
  | { kind: "franchise"; dietitianUserId: string; franchiseId: string };

/**
 * The `customer_profiles` columns the predicate reads. snake_case on purpose:
 * these are the column names the RLS predicate and the Supabase filters use,
 * so a row can be handed over without a mapping step that could drift.
 */
export interface ScopableCustomer {
  clinic_id: string | null;
  franchise_id: string | null;
  dietitian_id: string | null;
}

/** The `users` columns `current_dietitian()` projects. */
export interface DietitianUserRow {
  id: string;
  franchise_id: string | null;
  dietitian_clinic_id: string | null;
}

// ─── Column names ────────────────────────────────────────────────────────────
//
// Declared once so the predicate, the `.eq` path and the `.or` filter string
// can never name different columns.

export const CUSTOMER_CLINIC_COLUMN = "clinic_id" as const;
export const CUSTOMER_FRANCHISE_COLUMN = "franchise_id" as const;
export const CUSTOMER_DIETITIAN_COLUMN = "dietitian_id" as const;

// ─── Scope construction ──────────────────────────────────────────────────────

/**
 * Builds the scope of an active Dietitian from their `users` row, mirroring
 * `current_dietitian()`'s projection. A non-null `franchise_id` makes a
 * Franchise Dietitian; anything else is a Core_Business Dietitian.
 */
export function dietitianScopeFromUser(user: DietitianUserRow): DietitianScope {
  if (user.franchise_id !== null && user.franchise_id !== undefined) {
    return {
      kind: "franchise",
      dietitianUserId: user.id,
      franchiseId: user.franchise_id,
    };
  }
  return {
    kind: "core",
    dietitianUserId: user.id,
    clinicId: user.dietitian_clinic_id ?? null,
  };
}

// ─── The predicate ───────────────────────────────────────────────────────────

/**
 * True when `scope`'s Dietitian may READ `customer`. Mirrors
 * `public.dietitian_can_read_customer` exactly (Req 5.5, 5.6, 5.11).
 *
 * Read-only: no caller may infer a write right from this returning true
 * (Req 5.10, 16.5) — the database grants a Dietitian no write policy at all.
 */
export function dietitianCanRead(
  scope: DietitianScope,
  customer: ScopableCustomer,
): boolean {
  // (d.franchise_id IS NOT NULL AND cp.franchise_id = d.franchise_id)
  if (scope.kind === "franchise") {
    return customer.franchise_id === scope.franchiseId;
  }

  // (d.franchise_id IS NULL AND cp.dietitian_id = d.user_id)
  //
  // A Core_Business Dietitian reads ONLY the Customer_Records explicitly linked
  // to them via Dietitian_Link. The Clinic no longer widens the read scope
  // (this previously also matched `cp.clinic_id = d.clinic_id`), so a Dietitian
  // can never see a clinic-mate's customer they were not assigned to.
  return customer.dietitian_id === scope.dietitianUserId;
}

// ─── Supabase query builders ─────────────────────────────────────────────────

/**
 * The slice of a `PostgrestFilterBuilder` this module uses. Accepted
 * structurally so `applyDietitianScope` works on any `customer_profiles` query
 * (select, count, joined select) without importing a Supabase type.
 */
interface ScopeFilterBuilder {
  eq(column: string, value: string): unknown;
  or(filters: string): unknown;
}

/** PostgREST filter strings are unquoted, so only opaque ids may be inlined. */
const UUID_PATTERN =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

function assertUuid(value: string, label: string): string {
  if (!UUID_PATTERN.test(value)) {
    throw new Error(`Invalid ${label} in dietitian scope`);
  }
  return value;
}

/**
 * The PostgREST `or` filter for a core Dietitian who has a Clinic:
 * `dietitian_id.eq.<me>,clinic_id.eq.<clinic>`.
 *
 * Exported so the repositories can reuse the exact same string on embedded
 * resources, where `.or()` needs a `referencedTable` option.
 */
export function dietitianScopeOrFilter(
  dietitianUserId: string,
  clinicId: string,
): string {
  const me = assertUuid(dietitianUserId, "dietitian id");
  const clinic = assertUuid(clinicId, "clinic id");
  return `${CUSTOMER_DIETITIAN_COLUMN}.eq.${me},${CUSTOMER_CLINIC_COLUMN}.eq.${clinic}`;
}

/**
 * Narrows a `customer_profiles` query to the Dietitian's readable scope, so the
 * application filter and the RLS policy select the same rows (Req 5.7).
 *
 * PostgREST ANDs each applied filter, so the emitted SQL is the same shape as
 * the predicate above:
 *   * franchise scope → `franchise_id = <tenant>`
 *   * core scope → `dietitian_id = <me>` (the Clinic never widens the scope)
 */
export function applyDietitianScope<Q>(query: Q, scope: DietitianScope): Q {
  const builder = query as unknown as ScopeFilterBuilder;

  if (scope.kind === "franchise") {
    return builder.eq(
      CUSTOMER_FRANCHISE_COLUMN,
      assertUuid(scope.franchiseId, "franchise id"),
    ) as Q;
  }

  // Core scope is strictly the Dietitian_Link, regardless of any linked Clinic.
  return builder.eq(
    CUSTOMER_DIETITIAN_COLUMN,
    assertUuid(scope.dietitianUserId, "dietitian id"),
  ) as Q;
}

/** Convenience: the in-scope subset of an already-fetched list. */
export function filterScopableCustomers<T extends ScopableCustomer>(
  scope: DietitianScope,
  customers: readonly T[],
): T[] {
  return customers.filter((customer) => dietitianCanRead(scope, customer));
}
