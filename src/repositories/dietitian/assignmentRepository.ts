// src/repositories/dietitian/assignmentRepository.ts
// Data-access layer for the Dietitian_Link (`customer_profiles.dietitian_id`).
//
// LAYERING: Data-access ONLY. No business validation (that lives in
// `src/services/AssignmentService.ts`) and no 'use server' wrappers (those live
// in `src/actions/admin-actions/dietitianAssignmentActions.ts`, the onboarding
// Server Actions that create a Customer_Record, and
// `src/actions/dietitian-actions/dietitianCustomerActions.ts`). Uses the
// service-role admin client, mirroring
// `src/repositories/clinic/clinicRepository.ts`.
//
// Responsibilities (design.md §9, "Repositories"):
//   * read/write `customer_profiles.dietitian_id`
//   * verify a candidate `users` row is a Dietitian (Req 6.4)
//   * clear every Dietitian_Link referencing a deleted Dietitian (Req 6.5)
//   * read the scoped Log Customer list rows and one customer's full detail
//     row for `dietitianCustomerActions` (Req 15.3, 16.2, 16.6)
//
// _Requirements: 6.1, 6.2, 6.4, 6.5, 15.3, 16.2, 16.6_

import { createAdminClient } from "@/lib/supabase/admin";
import { isDietitianLevel, resolveAccessLevel } from "@/lib/auth/adminAccessCore";
import { applyDietitianScope, type DietitianScope } from "@/lib/dietitian/scope";
import type { CustomerCategory } from "@/types/dietitian";

// ─── Read ────────────────────────────────────────────────────────────────────

/**
 * Read the current Dietitian_Link of a Customer_Record. Returns `null` when
 * the Customer_Record has no linked Dietitian (Req 6.2) or does not exist —
 * the caller (AssignmentService) treats a missing profile the same as an
 * empty link rather than throwing, since this is a pure read.
 */
export async function getDietitianLink(
  customerProfileId: string,
): Promise<string | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("customer_profiles")
    .select("dietitian_id")
    .eq("id", customerProfileId)
    .maybeSingle();

  if (error) {
    throw new Error(
      `Failed to read dietitian link for customer ${customerProfileId}: ${error.message}`,
    );
  }
  return (data?.dietitian_id as string | null) ?? null;
}

/**
 * List every Customer_Record id currently linked to a Dietitian. Supports the
 * Master_Portal Dietitians section and any caller that needs the pre-clear set
 * without also performing the clear (e.g. a dependency count before an
 * account delete).
 */
export async function listCustomerProfileIdsLinkedToDietitian(
  dietitianUserId: string,
): Promise<string[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("customer_profiles")
    .select("id")
    .eq("dietitian_id", dietitianUserId);

  if (error) {
    throw new Error(
      `Failed to list customers linked to dietitian ${dietitianUserId}: ${error.message}`,
    );
  }
  return (data ?? []).map((row) => row.id as string);
}

// ─── Write ───────────────────────────────────────────────────────────────────

/**
 * Write the Dietitian_Link of a Customer_Record. `dietitianUserId` of `null`
 * clears the link — every Customer_Category may hold an empty link (Req 6.2).
 *
 * Returns the value stored immediately before the write alongside the new
 * value, so the caller (AssignmentService) can record both endpoints in
 * `admin_activity_logs` (Req 6.8) without a separate round trip.
 *
 * Writing the same value twice yields the same stored state (idempotence,
 * Req 6.6); reading the returned `dietitianId` back and writing it again
 * leaves the stored value unchanged (round-trip, Req 6.7) — both properties
 * fall out of a plain column update with no derived state.
 *
 * Validity of `dietitianUserId` (Req 6.4) and scope/clinic-membership checks
 * (Req 6.4, 7.8) are the caller's responsibility via {@link isDietitianUser};
 * this function performs the write only.
 */
export async function setDietitianLink(
  customerProfileId: string,
  dietitianUserId: string | null,
): Promise<{ previousDietitianId: string | null; dietitianId: string | null }> {
  const previousDietitianId = await getDietitianLink(customerProfileId);

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("customer_profiles")
    .update({ dietitian_id: dietitianUserId })
    .eq("id", customerProfileId)
    .select("dietitian_id")
    .single();

  if (error || !data) {
    throw new Error(
      `Failed to write dietitian link for customer ${customerProfileId}: ${
        error?.message ?? "unknown error"
      }`,
    );
  }

  return {
    previousDietitianId,
    dietitianId: (data.dietitian_id as string | null) ?? null,
  };
}

/**
 * Clear every Dietitian_Link that references `dietitianUserId`, retaining
 * every referencing Customer_Record (Req 6.5). Returns the ids of the
 * Customer_Records that were cleared, so the caller can write one
 * `admin_activity_logs` entry per affected Customer_Record naming the deleted
 * Dietitian as the previous value and an empty link as the new value.
 *
 * Idempotent: once no Customer_Record references the Dietitian, calling this
 * again returns an empty array rather than erroring.
 *
 * Note: `customer_profiles.dietitian_id` also carries `ON DELETE SET NULL`, so
 * a hard delete of the `users` row clears these links at the database layer
 * regardless. This function exists for the explicit, audited path — it is
 * called by `DietitianAccountService` before the `users` row is removed, so
 * the affected Customer_Record ids are available for the audit entries.
 */
export async function clearDietitianLinksForUser(
  dietitianUserId: string,
): Promise<string[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("customer_profiles")
    .update({ dietitian_id: null })
    .eq("dietitian_id", dietitianUserId)
    .select("id");

  if (error) {
    throw new Error(
      `Failed to clear dietitian links for dietitian ${dietitianUserId}: ${error.message}`,
    );
  }
  return (data ?? []).map((row) => row.id as string);
}

// ─── Candidate verification ──────────────────────────────────────────────────

/**
 * Verify that a candidate `users` row is a Dietitian, i.e. its resolved
 * Access_Level is `dietitian` (Req 6.4). Returns `false` — never throws — when
 * the user does not exist, which the caller (AssignmentService) maps to the
 * pinned message `Selected user is not a dietitian`.
 *
 * Resolution goes through `resolveAccessLevel`/`isDietitianLevel` so a NULL or
 * unrecognised stored value is treated exactly as the rest of the Access
 * Control Layer treats it (Req 1.4), rather than by a second ad hoc check that
 * could drift from `adminAccessCore`.
 */
export async function isDietitianUser(userId: string): Promise<boolean> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("users")
    .select("admin_access_level")
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to verify dietitian candidate ${userId}: ${error.message}`);
  }
  if (!data) return false;

  return isDietitianLevel(resolveAccessLevel(data.admin_access_level));
}

// ─── Log Customer list + customer detail reads ───────────────────────────────
//
// These reads back `dietitianCustomerActions.ts` (task 9.4): the scoped list
// row shape needed by the Log Customer list (Req 15.3, 16.6) and the fuller
// detail row needed by the read-only Customer_360 view a Dietitian sees
// (Req 16.2). Both resolve the Customer_Category from the customer's most
// recently created `subscriptions` row, mirroring
// `cadenceRepository.getGoverningRecords` and
// `DietitianReportService.resolveGoverningCategory` — every surface that
// reports a Customer_Category must agree with the Cadence_Engine on which
// subscription governs it.

/** One row of the Log Customer list, before cadence values are attached (Req 15.3, 16.6). */
export interface DietitianCustomerListRow {
  customerProfileId: string;
  customerCode: string | null;
  name: string;
  mobile: string | null;
  category: CustomerCategory;
  assignedDietitianName: string | null;
}

/** One address on a Customer_Record, as shown in the read-only Dietitian view (Req 16.2). */
export interface DietitianCustomerAddress {
  id: string;
  tag: string;
  street1: string;
  street2: string | null;
  landmark: string | null;
  city: string;
  state: string;
  pincode: string;
  isPrimary: boolean;
}

/** The governing subscription summary shown in the read-only Dietitian view (Req 16.2). */
export interface DietitianGoverningSubscriptionSummary {
  id: string;
  status: string;
  customerCategory: CustomerCategory;
  startsOn: string | null;
  endsOn: string | null;
  effectiveEndOn: string | null;
  planName: string | null;
}

/** The full customer detail row read by `getDietitianCustomerDetail` (Req 16.2). */
export interface DietitianCustomerDetailRow {
  customerProfileId: string;
  customerCode: string | null;
  name: string;
  mobile: string | null;
  email: string | null;
  category: CustomerCategory;
  assignedDietitianName: string | null;
  addresses: DietitianCustomerAddress[];
  governingSubscription: DietitianGoverningSubscriptionSummary | null;
}

interface CustomerListSubscriptionEmbed {
  customer_category: string;
  created_at: string;
}

interface CustomerListRawRow {
  id: string;
  customer_code: string | null;
  dietitian_id: string | null;
  users: { full_name: string | null; mobile: string | null } | { full_name: string | null; mobile: string | null }[] | null;
  subscriptions: CustomerListSubscriptionEmbed[] | null;
}

/** Extracts the single-row shape of a Supabase `users` embed (object or one-element array). */
function extractUserEmbed<T>(embed: T | T[] | null): T | null {
  if (embed === null) return null;
  return Array.isArray(embed) ? embed[0] ?? null : embed;
}

/** Resolves the Customer_Category from the most recently created subscription row, defaulting to `MEAL` when none exists. */
function resolveCategoryFromEmbed(
  subscriptions: readonly CustomerListSubscriptionEmbed[] | null,
): CustomerCategory {
  const rows = subscriptions ?? [];
  let latest: CustomerListSubscriptionEmbed | null = null;
  for (const row of rows) {
    if (!latest || row.created_at > latest.created_at) latest = row;
  }
  const category = latest?.customer_category;
  return category === "ACCOMMODATION" || category === "KIT" || category === "MEAL"
    ? category
    : "MEAL";
}

/**
 * Resolve `dietitian_id → dietitian full_name` for a batch of ids in one
 * query. Returns an empty map for an empty input (no round trip).
 */
async function resolveDietitianNamesForCustomers(
  admin: ReturnType<typeof createAdminClient>,
  dietitianIds: readonly string[],
): Promise<Map<string, string>> {
  const distinct = Array.from(new Set(dietitianIds));
  if (distinct.length === 0) return new Map();

  const { data, error } = await admin
    .from("users")
    .select("id, full_name")
    .in("id", distinct);

  if (error) {
    throw new Error(`Failed to resolve dietitian names: ${error.message}`);
  }

  const map = new Map<string, string>();
  for (const row of (data ?? []) as Array<{ id: string; full_name: string | null }>) {
    if (row.full_name) map.set(row.id, row.full_name);
  }
  return map;
}

/**
 * List every Customer_Record inside `scope` for the Log Customer list
 * (Req 15.3, 16.6), joined with the assigned Dietitian's name. Cadence values
 * are attached by the caller (`CadenceService`) — this read is scope + identity
 * only.
 */
export async function listInScopeCustomerListRows(
  scope: DietitianScope,
): Promise<DietitianCustomerListRow[]> {
  const admin = createAdminClient();

  const query = admin
    .from("customer_profiles")
    .select(
      "id, customer_code, dietitian_id, users!customer_profiles_user_id_fkey(full_name, mobile), subscriptions(customer_category, created_at)",
    );

  const { data, error } = await applyDietitianScope(query, scope);

  if (error) {
    throw new Error(`Failed to list in-scope customers: ${error.message}`);
  }

  const rows = (data ?? []) as unknown as CustomerListRawRow[];
  const dietitianIds = rows
    .map((row) => row.dietitian_id)
    .filter((id): id is string => id !== null);
  const dietitianNames = await resolveDietitianNamesForCustomers(admin, dietitianIds);

  return rows.map((row) => {
    const user = extractUserEmbed(row.users);
    return {
      customerProfileId: row.id,
      customerCode: row.customer_code,
      name: user?.full_name?.trim() || "Customer",
      mobile: user?.mobile ?? null,
      category: resolveCategoryFromEmbed(row.subscriptions),
      assignedDietitianName: row.dietitian_id
        ? dietitianNames.get(row.dietitian_id) ?? null
        : null,
    };
  });
}

interface CustomerDetailAddressEmbed {
  id: string;
  tag: string | null;
  street_1: string | null;
  street_2: string | null;
  landmark: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  is_primary: boolean | null;
}

interface CustomerDetailSubscriptionEmbed {
  id: string;
  status: string;
  starts_on: string | null;
  ends_on: string | null;
  effective_end_on: string | null;
  customer_category: string;
  created_at: string;
  subscription_plans: { name: string | null } | { name: string | null }[] | null;
}

interface CustomerDetailRawRow {
  id: string;
  customer_code: string | null;
  dietitian_id: string | null;
  users:
    | { full_name: string | null; mobile: string | null; email: string | null }
    | { full_name: string | null; mobile: string | null; email: string | null }[]
    | null;
  addresses: CustomerDetailAddressEmbed[] | null;
  subscriptions: CustomerDetailSubscriptionEmbed[] | null;
}

/**
 * Read the full detail row for one Customer_Record, for the read-only
 * Dietitian Customer_360 view (Req 16.2): profile identity, addresses and the
 * governing subscription summary. The caller (`dietitianCustomerActions`) is
 * responsible for the scope check via `checkDietitianScope` before calling
 * this — this read applies no scope filter of its own so it can be reused for
 * a customer id already proven in-scope.
 *
 * Returns `null` when the Customer_Record does not exist.
 */
export async function getCustomerDetailRow(
  customerProfileId: string,
): Promise<DietitianCustomerDetailRow | null> {
  const admin = createAdminClient();

  const { data, error } = await admin
    .from("customer_profiles")
    .select(
      "id, customer_code, dietitian_id, users!customer_profiles_user_id_fkey(full_name, mobile, email), addresses(id, tag, street_1, street_2, landmark, city, state, pincode, is_primary), subscriptions(id, status, starts_on, ends_on, effective_end_on, customer_category, created_at, subscription_plans(name))",
    )
    .eq("id", customerProfileId)
    .maybeSingle();

  if (error) {
    throw new Error(
      `Failed to load customer detail ${customerProfileId}: ${error.message}`,
    );
  }
  if (!data) return null;

  const row = data as unknown as CustomerDetailRawRow;
  const user = extractUserEmbed(row.users);

  const dietitianName = row.dietitian_id
    ? (await resolveDietitianNamesForCustomers(admin, [row.dietitian_id])).get(
        row.dietitian_id,
      ) ?? null
    : null;

  const subscriptions = row.subscriptions ?? [];
  let governingSub: CustomerDetailSubscriptionEmbed | null = null;
  for (const sub of subscriptions) {
    if (!governingSub || sub.created_at > governingSub.created_at) governingSub = sub;
  }

  const governingSubscription: DietitianGoverningSubscriptionSummary | null = governingSub
    ? {
        id: governingSub.id,
        status: governingSub.status,
        customerCategory:
          governingSub.customer_category === "ACCOMMODATION" ||
          governingSub.customer_category === "KIT" ||
          governingSub.customer_category === "MEAL"
            ? governingSub.customer_category
            : "MEAL",
        startsOn: governingSub.starts_on,
        endsOn: governingSub.ends_on,
        effectiveEndOn: governingSub.effective_end_on,
        planName: extractUserEmbed(governingSub.subscription_plans)?.name ?? null,
      }
    : null;

  return {
    customerProfileId: row.id,
    customerCode: row.customer_code,
    name: user?.full_name?.trim() || "Customer",
    mobile: user?.mobile ?? null,
    email: user?.email ?? null,
    category: resolveCategoryFromEmbed(
      subscriptions.map((s) => ({
        customer_category: s.customer_category,
        created_at: s.created_at,
      })),
    ),
    assignedDietitianName: dietitianName,
    addresses: (row.addresses ?? []).map((a) => ({
      id: a.id,
      tag: a.tag ?? "Home",
      street1: a.street_1 ?? "",
      street2: a.street_2,
      landmark: a.landmark,
      city: a.city ?? "",
      state: a.state ?? "",
      pincode: a.pincode ?? "",
      isPrimary: a.is_primary ?? false,
    })),
    governingSubscription,
  };
}
