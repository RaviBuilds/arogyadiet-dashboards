import { createAdminClient } from "@/lib/supabase/admin";
import { Users } from "lucide-react";
import { PageHeader } from "@/shared/components/franchise/ui/PageHeader";
import {
  guardFranchiseCustomersWorkspace,
  getCurrentDietitianContext,
} from "@/lib/auth/adminAccess";
import { scopeFranchiseCustomersForDietitian } from "@/lib/dietitian/franchiseCustomerScope";
import FranchiseCustomerDashboard from "./FranchiseCustomerDashboard";

export const revalidate = 0;

export default async function FranchiseCustomersPage() {
  // Single authorization + identity resolution for this workspace
  // (franchise-scoped-access Task 5). Replaces an ad-hoc `x-franchise-id`
  // cookie read plus a separate `admin_access_level` query, neither of which
  // checked the caller's Operations_Group at all — the page relied entirely on
  // the middleware route gate.
  //
  // `franchiseId` comes from the caller's own `users` row rather than a cookie,
  // and the guard also rejects a suspended franchise. It admits a Dietitian
  // explicitly; see the guard's own comment for why the plain group guard would
  // infinitely redirect one.
  const { franchiseId, canManage, isDietitian } =
    await guardFranchiseCustomersWorkspace();

  const supabase = createAdminClient();

  // Fetch customers belonging to this franchise with full details
  const { data: rawCustomers, error } = await supabase
    .from("customer_profiles")
    .select(`
      id,
      is_active,
      dietary_preference,
      gender,
      date_of_birth,
      allergies,
      has_medical_history,
      franchise_id,
      clinic_id,
      dietitian_id,
      clinics ( name ),
      users!customer_profiles_user_id_fkey!inner ( id, full_name, email, mobile, is_active ),
      dietitian:users!customer_profiles_dietitian_id_fkey ( full_name ),
      addresses ( pincode, is_primary, lat, lng ),
      subscriptions ( status, customer_category, subscription_plans ( name ), kit_products ( name ) )
    `)
    .eq("franchise_id", franchiseId);

  if (error) console.error("Error fetching franchise customers:", error);

  const customers = (rawCustomers || []).map((customer: any) => {
    // Falls back to the first address when none is flagged primary, matching the
    // admin directory — otherwise a customer with only a non-primary address
    // showed "N/A" for a pincode that is actually on file.
    const primaryAddress =
      customer.addresses?.find((addr: any) => addr.is_primary) ??
      customer.addresses?.[0];

    let age = null;
    if (customer.date_of_birth) {
      const birthDate = new Date(customer.date_of_birth);
      const today = new Date();
      age = today.getFullYear() - birthDate.getFullYear();
      const m = today.getMonth() - birthDate.getMonth();
      if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) age--;
    }

    // Priority order: Active > Pending > Stopped > Expired > No Plan
    const subs = customer.subscriptions || [];
    const activeSub = subs.find((s: any) => s.status === "ACTIVE");
    const pendingSub = subs.find((s: any) => s.status === "PENDING");
    const stoppedSub = subs.find((s: any) => s.status === "STOPPED" || s.status === "CANCELLED");
    const expiredSub = subs.find((s: any) => s.status === "EXPIRED");

    let displayStatus: string;
    let activePlanName: string | null = null;
    let customerCategory: string | null = null;

    // Determine highest-priority subscription for status + category
    const prioritySub = activeSub || pendingSub || stoppedSub || expiredSub;

    if (activeSub) {
      displayStatus = "Active";
      customerCategory = activeSub.customer_category || null;
      activePlanName =
        activeSub.customer_category === "KIT"
          ? activeSub.kit_products?.name || "KIT Plan"
          : activeSub.subscription_plans?.name || "Custom Plan";
    } else if (pendingSub) {
      displayStatus = "Pending";
      customerCategory = pendingSub.customer_category || null;
      activePlanName =
        pendingSub.customer_category === "KIT"
          ? pendingSub.kit_products?.name || "KIT Plan"
          : pendingSub.subscription_plans?.name || "Custom Plan";
    } else if (stoppedSub) {
      displayStatus = "Stopped";
      customerCategory = stoppedSub.customer_category || null;
    } else if (expiredSub) {
      displayStatus = "Expired";
      customerCategory = expiredSub.customer_category || null;
    } else {
      displayStatus = "No Plan";
    }

    return {
      id: customer.id,
      userId: customer.users?.id || "",
      fullName: customer.users?.full_name || "N/A",
      email: customer.users?.email || "N/A",
      mobile: customer.users?.mobile || "N/A",
      isActive: (customer.is_active ?? true) && (customer.users?.is_active ?? true),
      dietary_preference: customer.dietary_preference || "N/A",
      primary_pincode: primaryAddress?.pincode || "N/A",
      status: displayStatus,
      gender: customer.gender || "N/A",
      dateOfBirth: customer.date_of_birth || "",
      age,
      allergies: customer.allergies || null,
      hasMedicalHistory: customer.has_medical_history || false,
      activePlanName,
      customerCategory,
      clinic_id: customer.clinic_id || null,
      clinicName: customer.clinics?.name || null,
      dietitianId: customer.dietitian_id || null,
      // Drives the Dietitian column + filter. `matchesDietitian` compares on
      // NAME, not id, so both are needed.
      dietitianName: customer.dietitian?.full_name || null,
      // Data-quality flag behind the Location column's "No GPS" toggle.
      hasCoords: Boolean(primaryAddress?.lat && primaryAddress?.lng),
    };
  });

  // ─── Dietitian read-scope enforcement (SECURITY) ───────────────────────────
  // This page reads through the service-role client, which BYPASSES RLS, so the
  // `dietitian_select_customer_profiles` policy never engages here. The tenant
  // filter above (`franchise_id`) is therefore the ONLY narrowing that had been
  // applied — which meant a Franchise Dietitian saw every customer of the
  // franchise, not just the ones assigned to them.
  //
  // `scripts/allow-multiple-franchise-dietitians.sql` narrowed the DATABASE
  // predicate to `franchise_id = d.franchise_id AND dietitian_id = d.user_id`
  // precisely so a franchise can run a team of Dietitians without each seeing
  // their colleagues' customers. This is the application-layer half of that
  // change: without it, the narrowing has no effect on any surface that uses the
  // service-role client.
  //
  // The rule itself lives in `scopeFranchiseCustomersForDietitian` so it can be
  // unit-tested directly, including the FAIL-CLOSED case: a user flagged as a
  // Dietitian whose Dietitian context cannot be resolved gets an empty list
  // rather than the whole tenant.
  const scopedCustomers = scopeFranchiseCustomersForDietitian(
    customers,
    franchiseId,
    isDietitian,
    isDietitian ? await getCurrentDietitianContext() : null,
  );

  // ── Active subscription windows ────────────────────────────────────────────
  // Powers the "Expiring in N days" filter and the Meal table's Plan Period
  // column. The franchise directory fetched no subscription dates at all before,
  // which is why it had neither.
  //
  // Correlated by customer EMAIL, matching the admin directory. Tenancy is
  // enforced by the `.eq("franchise_id")` below AND by intersecting with the
  // already-scoped customer set — so a Dietitian cannot see a window belonging to
  // a customer they are not assigned to, which a tenant-only filter would leak.
  const { data: rawActiveSubs } = await supabase
    .from("subscriptions")
    .select(
      `
      id, starts_on, effective_end_on, ends_on, status,
      customer_profiles!inner ( franchise_id, users!customer_profiles_user_id_fkey ( email ) )
    `,
    )
    .eq("status", "ACTIVE")
    .eq("customer_profiles.franchise_id", franchiseId);

  const visibleEmails = new Set(scopedCustomers.map((c) => c.email));

  // Shapes the embed can hand back: a to-one relation may arrive as an object or
  // as a single-element array depending on how PostgREST resolves it.
  type EmbeddedUser = { email: string | null } | { email: string | null }[] | null;
  type ActiveSubRow = {
    starts_on: string | null;
    effective_end_on: string | null;
    ends_on: string | null;
    customer_profiles:
      | { users: EmbeddedUser }
      | { users: EmbeddedUser }[]
      | null;
  };

  const unwrap = <T,>(value: T | T[] | null): T | null =>
    Array.isArray(value) ? (value[0] ?? null) : value;

  const activeSubscriptions = ((rawActiveSubs ?? []) as ActiveSubRow[])
    .map((sub) => {
      const profile = unwrap(sub.customer_profiles);
      const user = unwrap(profile?.users ?? null);
      return {
        email: user?.email ?? "",
        starts_on: sub.starts_on ?? null,
        ends_on: sub.effective_end_on ?? sub.ends_on ?? null,
      };
    })
    .filter((sub) => sub.email !== "" && visibleEmails.has(sub.email));

  return (
    <div className="flex flex-col gap-8 animate-in fade-in duration-500">
      <FranchiseCustomerDashboard
        customers={scopedCustomers}
        activeSubscriptions={activeSubscriptions}
        franchiseId={franchiseId}
        isDietitian={isDietitian}
        canManage={canManage}
      />
    </div>
  );
}
