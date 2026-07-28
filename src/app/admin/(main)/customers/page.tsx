import { createAdminClient } from "@/lib/supabase/admin";
import { AdminPageHeader } from "@/shared/components/admin/core/AdminPageHeader";
import { AdminCustomersWrapper } from "./AdminCustomersWrapper";
import {
  guardCustomersWorkspace,
  getCurrentDietitianContext,
  dietitianScopeFromContext,
} from "@/lib/auth/adminAccess";
import { dietitianCanRead } from "@/lib/dietitian/scope";

export const revalidate = false;

export default async function CustomersPage({
  searchParams,
}: {
  searchParams?: Promise<{ action?: string }>;
}) {
  const { isDietitian } = await guardCustomersWorkspace();
  const params = await searchParams;
  const autoOpenCreate = params?.action === "create";
  const supabaseAdmin = createAdminClient();

  const { data: rawCustomers, error } = await supabaseAdmin.from("customer_profiles")
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
    `);

  if (error) console.error("Error fetching customers:", error);

  const customers = (rawCustomers || []).map((customer: any) => {
    const primaryAddress = customer.addresses?.find(
      (addr: any) => addr.is_primary,
    ) ?? customer.addresses?.[0];

    // Calculate Age
    let age = null;
    if (customer.date_of_birth) {
      const birthDate = new Date(customer.date_of_birth);
      const today = new Date();
      age = today.getFullYear() - birthDate.getFullYear();
      const m = today.getMonth() - birthDate.getMonth();
      if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) age--;
    }

    // Determine status and active plan name with priority: Active > Pending > Stopped > Expired > No Plan
    const activeSub = customer.subscriptions?.find((s: any) => s.status === "ACTIVE");
    const pendingSub = customer.subscriptions?.find((s: any) => s.status === "PENDING");
    const stoppedSub = customer.subscriptions?.find(
      (s: any) => s.status === "STOPPED" || s.status === "CANCELLED",
    );
    const expiredSub = customer.subscriptions?.find((s: any) => s.status === "EXPIRED");

    let displayStatus: string;
    let activePlanName: string | null = null;
    let customerCategory: string | null = null;

    if (activeSub) {
      displayStatus = "Active";
      activePlanName = activeSub.customer_category === "KIT"
        ? activeSub.kit_products?.name || activeSub.subscription_plans?.name || "Custom Plan"
        : activeSub.subscription_plans?.name || "Custom Plan";
      customerCategory = activeSub.customer_category;
    } else if (pendingSub) {
      displayStatus = "Pending";
      activePlanName = pendingSub.customer_category === "KIT"
        ? pendingSub.kit_products?.name || pendingSub.subscription_plans?.name || "Custom Plan"
        : pendingSub.subscription_plans?.name || "Custom Plan";
      customerCategory = pendingSub.customer_category;
    } else if (stoppedSub) {
      displayStatus = "Stopped";
      customerCategory = stoppedSub.customer_category;
    } else if (expiredSub) {
      displayStatus = "Expired";
      customerCategory = expiredSub.customer_category;
    } else {
      displayStatus = "No Plan";
    }

    return {
      id: customer.id,
      userId: customer.users?.id || "",
      fullName: customer.users?.full_name || "N/A",
      email: customer.users?.email || "N/A",
      mobile: customer.users?.mobile || "N/A",
      isActive:
        (customer.is_active ?? true) && (customer.users?.is_active ?? true),
      dietary_preference: customer.dietary_preference || "N/A",
      primary_pincode: primaryAddress?.pincode || "N/A",
      status: displayStatus,
      gender: customer.gender || "N/A",
      dateOfBirth: customer.date_of_birth || "",
      age: age,
      allergies: customer.allergies || null,
      hasMedicalHistory: customer.has_medical_history || false,
      activePlanName: activePlanName,
      customerCategory: customerCategory,
      clinic_id: customer.clinic_id || null,
      clinicName: customer.clinics?.name || null,
      dietitianId: customer.dietitian_id || null,
      dietitianName: customer.dietitian?.full_name || null,
      franchiseId: customer.franchise_id || null,
      hasCoords: Boolean(primaryAddress?.lat && primaryAddress?.lng),
    };
  });

  const { data: rawActiveSubs } = await supabaseAdmin
    .from("subscriptions")
    .select(
      `
      id, starts_on, effective_end_on, ends_on, total_days, pause_credits_total, pause_credits_used, status,
      customer_profiles ( users!customer_profiles_user_id_fkey ( full_name, email ) ),
      subscription_plans ( name )
    `,
    )
    .eq("status", "ACTIVE")
    .order("starts_on", { ascending: false });

  const mapSubRow = (sub: any) => {
    const profile = Array.isArray(sub.customer_profiles)
      ? sub.customer_profiles[0]
      : sub.customer_profiles;
    const user = Array.isArray(profile?.users)
      ? profile?.users[0]
      : profile?.users;
    return {
      id: sub.id,
      customer_name: user?.full_name || "N/A",
      email: user?.email || "N/A",
      plan_name: sub.subscription_plans?.name || "Custom Plan",
      total_days: sub.total_days || 0,
      starts_on: sub.starts_on,
      ends_on: sub.effective_end_on || sub.ends_on,
      pause_credits_total: sub.pause_credits_total || 0,
      pause_credits_used: sub.pause_credits_used || 0,
      status: sub.status as string,
    };
  };

  const activeSubs = (rawActiveSubs || []).map(mapSubRow);

  const subSelectFields = `
    id, starts_on, effective_end_on, ends_on, total_days, pause_credits_total, pause_credits_used, status,
    customer_profiles ( users!customer_profiles_user_id_fkey ( full_name, email ) ),
    subscription_plans ( name )
  `;

  const { data: rawPendingSubs } = await supabaseAdmin
    .from("subscriptions")
    .select(subSelectFields)
    .eq("status", "PENDING")
    .order("starts_on", { ascending: true });

  const pendingSubs = (rawPendingSubs || []).map(mapSubRow);

  const { data: rawStoppedSubs } = await supabaseAdmin
    .from("subscriptions")
    .select(subSelectFields)
    .in("status", ["STOPPED", "CANCELLED", "EXPIRED"])
    .order("ends_on", { ascending: false });

  const stoppedSubs = (rawStoppedSubs || []).map(mapSubRow);

  // ─── Dietitian read-scope enforcement (SECURITY) ───────────────────────────
  // This page reads via the service-role admin client, which BYPASSES RLS, so
  // the RLS policy `dietitian_select_customer_profiles` never engages here. A
  // Dietitian signed into the admin portal must only ever see the customers
  // assigned to them (Req 5.5–5.7), so we re-apply the exact same read-scope
  // predicate (`dietitianCanRead`) in the application layer and fail closed if
  // the Dietitian context cannot be resolved.
  let scopedCustomers = customers;
  let scopedActiveSubs = activeSubs;
  let scopedPendingSubs = pendingSubs;
  let scopedStoppedSubs = stoppedSubs;

  if (isDietitian) {
    const dietitianCtx = await getCurrentDietitianContext();
    if (dietitianCtx) {
      const scope = dietitianScopeFromContext(dietitianCtx);
      scopedCustomers = customers.filter((c) =>
        dietitianCanRead(scope, {
          clinic_id: c.clinic_id,
          franchise_id: c.franchiseId,
          dietitian_id: c.dietitianId,
        }),
      );
      // Keep the Overview subscription lists in scope too (correlated by the
      // same customer email the wrapper uses), so no client-side scope selector
      // can surface an out-of-scope customer's subscription.
      const allowedEmails = new Set(scopedCustomers.map((c) => c.email));
      scopedActiveSubs = activeSubs.filter((s) => allowedEmails.has(s.email));
      scopedPendingSubs = pendingSubs.filter((s) => allowedEmails.has(s.email));
      scopedStoppedSubs = stoppedSubs.filter((s) => allowedEmails.has(s.email));
    } else {
      // Flagged as a Dietitian but no resolvable Dietitian context — fail closed.
      scopedCustomers = [];
      scopedActiveSubs = [];
      scopedPendingSubs = [];
      scopedStoppedSubs = [];
    }
  }

  return (
    <div className="flex animate-in fade-in flex-col gap-6 pb-2 duration-500">
      <AdminPageHeader
        title="Customers"
        description="Manage your subscriber base and account statuses."
      />

      <AdminCustomersWrapper
        customers={scopedCustomers}
        activeSubscriptions={scopedActiveSubs}
        pendingSubscriptions={scopedPendingSubs}
        stoppedSubscriptions={scopedStoppedSubs}
        autoOpenCreate={autoOpenCreate}
        isDietitian={isDietitian}
      />
    </div>
  );
}
