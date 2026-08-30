import "server-only";

// src/lib/auth/sharedCustomerActor.ts
//
// Authorization for the CROSS-PORTAL customer actions — the ones invoked from
// `Customer360Dashboard` and its children, which BOTH the admin portal and the
// franchise portal render.
//
// WHY THIS EXISTS
// `CourierForm`, `CustomerHistoryTab`, `KitEligibilityBadge` and `SendNewKitForm`
// all live in `src/shared/components/admin/customers/` and import their server
// actions DIRECTLY. Because the franchise portal renders the same dashboard,
// those server-action ids are compiled into the FRANCHISE client bundle and are
// directly invocable from it. Consequences found while building franchise KIT
// parity:
//
//   1. `saveShippingInfoAction` had NO authorization gate of any kind. It
//      validated its schema, confirmed the subscription was KIT, then wrote
//      `kit_shipping_info` with the service-role client. Any session reaching
//      either bundle could write courier data for ANY subscription.
//   2. `getAdminKitHistoryAction` / `getAdminMealSubscriptionHistoryAction` /
//      `getAdminStayHistoryAction` admit `FRANCHISE_ADMIN` (see `ALLOWED_ROLES`)
//      but performed NO tenancy check, so a franchise admin could pass any
//      `customerProfileId` and read another tenant's history.
//
// Neither could be fixed from the franchise side: wrapping an ungated action
// leaves the ungated action still invocable. The gate has to live on the action
// itself, which is what this module supplies.
//
// DESIGN: the CORE branch of each action is left EXACTLY as it was — this module
// is only consulted for a `FRANCHISE_ADMIN` caller. That keeps Core_Business
// behaviour on the admin dashboard unchanged, which is a hard constraint of this
// work, while giving the franchise portal the tenancy it never had. The one
// deliberate exception is `saveShippingInfoAction`, which had no core gate to
// preserve; it gains a read-capable `customers` check so an admin who can open
// the KIT tab at all keeps working.

import { createAdminClient } from "@/lib/supabase/admin";
import {
  getCurrentAdminContext,
  checkFranchiseCustomersRead,
  checkFranchiseGroupManage,
} from "@/lib/auth/adminAccess";

const FRANCHISE_ROLE_CODE = "FRANCHISE_ADMIN";

/** Shown when a franchise caller names a customer outside their own tenant. */
const NOT_YOUR_CUSTOMER = "This customer does not belong to your franchise.";

/**
 * Shown when a Franchise Dietitian names a customer of their own tenant who is
 * not assigned to them. Deliberately identical to {@link NOT_YOUR_CUSTOMER} so
 * the response cannot be used to probe which customers exist in the franchise.
 */
const NOT_ASSIGNED_TO_YOU = NOT_YOUR_CUSTOMER;

/**
 * Is the current caller a franchise user?
 *
 * Used by the shared actions to decide whether to run their ORIGINAL core gate
 * or the franchise branch. Returns `false` for everyone else, including an
 * unauthenticated caller, so the core gate stays the thing that rejects them and
 * its exact message is preserved.
 */
export async function isFranchiseCaller(): Promise<boolean> {
  const { roleCode } = await getCurrentAdminContext();
  return roleCode === FRANCHISE_ROLE_CODE;
}

type Authorized = { ok: true } | { ok: false; error: string };

/**
 * Authorize a franchise caller against ONE customer record.
 *
 * Three independent checks, all required:
 *
 *   1. PERMISSION — `customers` access at the requested level. `"read"` admits a
 *      view-only user and a Dietitian; `"manage"` admits neither.
 *   2. TENANCY — `customer_profiles.franchise_id` must equal the caller's own
 *      franchise. This is the check that was missing entirely.
 *   3. THE DIETITIAN_LINK — when the caller is a Franchise Dietitian, the record
 *      must additionally be assigned to them (`dietitian_id = their user id`).
 *      Tenancy alone is NOT sufficient: a franchise may now run a team of
 *      Dietitians (`scripts/allow-multiple-franchise-dietitians.sql`), so
 *      without this one Dietitian could read a colleague's customer's history.
 *      Mirrors `dietitian_can_read_customer` and
 *      `scopeFranchiseCustomersForDietitian`.
 */
export async function authorizeFranchiseCustomerAccess(
  customerProfileId: string,
  mode: "read" | "manage",
): Promise<Authorized> {
  const gate =
    mode === "manage"
      ? await checkFranchiseGroupManage("customers")
      : await checkFranchiseCustomersRead();

  if (!gate.ok) return { ok: false, error: gate.error };

  // `checkFranchiseGroupManage` never returns a Dietitian (manage is false for
  // that level), so the flag is only meaningful on the read path.
  const isDietitian = "isDietitian" in gate ? gate.isDietitian : false;
  const { franchiseId, userId } = gate.ctx;

  const trimmed = customerProfileId?.trim() ?? "";
  if (trimmed.length === 0) {
    return { ok: false, error: "Customer profile ID is required." };
  }

  const supabase = createAdminClient();
  const { data: profile, error } = await supabase
    .from("customer_profiles")
    .select("id, franchise_id, dietitian_id")
    .eq("id", trimmed)
    .maybeSingle();

  if (error) return { ok: false, error: error.message };
  // Absent and out-of-tenant are reported identically, so the response cannot be
  // used to test whether a given profile id exists.
  if (!profile) return { ok: false, error: NOT_YOUR_CUSTOMER };

  if ((profile.franchise_id as string | null) !== franchiseId) {
    return { ok: false, error: NOT_YOUR_CUSTOMER };
  }

  if (isDietitian && (profile.dietitian_id as string | null) !== userId) {
    return { ok: false, error: NOT_ASSIGNED_TO_YOU };
  }

  return { ok: true };
}

/**
 * Authorize a franchise caller against one SUBSCRIPTION, by resolving the
 * customer record behind it and delegating to
 * {@link authorizeFranchiseCustomerAccess}.
 *
 * Needed by the shipping action, whose input names a `subscription_id` rather
 * than a customer profile. Resolving the owner server-side matters: the action's
 * input also carries a `customer_profile_id`, and trusting that instead would let
 * a caller pair their own profile id with another tenant's subscription.
 */
export async function authorizeFranchiseSubscriptionAccess(
  subscriptionId: string,
  mode: "read" | "manage",
): Promise<Authorized> {
  const trimmed = subscriptionId?.trim() ?? "";
  if (trimmed.length === 0) {
    return { ok: false, error: "Subscription ID is required." };
  }

  const supabase = createAdminClient();
  const { data: subscription, error } = await supabase
    .from("subscriptions")
    .select("id, customer_profile_id")
    .eq("id", trimmed)
    .maybeSingle();

  if (error) return { ok: false, error: error.message };
  if (!subscription?.customer_profile_id) {
    return { ok: false, error: NOT_YOUR_CUSTOMER };
  }

  return authorizeFranchiseCustomerAccess(
    subscription.customer_profile_id as string,
    mode,
  );
}
