import { createClient as createAdminClient } from "@supabase/supabase-js";
import { AdminPageHeader } from "@/shared/components/admin/core/AdminPageHeader";
import { AdminSubscriptionsWrapper } from "./AdminSubscriptionsWrapper";
import { guardAdminGroup, getCurrentAdminContext } from "@/lib/auth/adminAccess";

export const revalidate = 0;

export default async function SubscriptionsPage() {
  await guardAdminGroup("subscriptions");
  // Clinic-scope confinement (Clinic_Scoped_Admin, e.g. a frontdesk user
  // assigned to one Core Clinic): `clinicId` is `null` for an unscoped admin.
  const { clinicId } = await getCurrentAdminContext();
  const supabaseAdmin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // 1. Fetch Subscription Plans
  const { data: plans } = await supabaseAdmin
    .from("subscription_plans")
    .select("*")
    .order("duration_days", { ascending: true });

  // 2. Fetch all user subscriptions for modeling/analytics.
  // Clinic-scope confinement: when the admin is confined to a Core Clinic,
  // join `customer_profiles` with `!inner` (only when scoped, to avoid
  // changing the query shape for every unscoped admin) so the embedded
  // `customer_profiles.clinic_id` filter below can apply at the DB level.
  let activeSubsQuery = supabaseAdmin.from("subscriptions").select(
    clinicId
      ? "id, status, starts_on, ends_on, plan_id, franchise_id, subscription_plans(name), customer_profiles!inner(clinic_id)"
      : "id, status, starts_on, ends_on, plan_id, franchise_id, subscription_plans(name)",
  ).in("status", ["ACTIVE", "PENDING"]);
  if (clinicId) {
    activeSubsQuery = activeSubsQuery.eq("customer_profiles.clinic_id", clinicId);
  }
  const { data: activeSubs } = await activeSubsQuery;

  // 3. Fetch global discount coupons (not tied to any customer)
  const { data: globalCoupons } = await supabaseAdmin
    .from("coupons")
    .select(
      "id, code, discount_type, discount_value_30_days, discount_value_60_days, discount_value_90_days, flat_discounts_by_plan, discount_value, max_uses, times_used, expires_at, created_at",
    )
    .is("customer_profile_id", null)
    .is("franchise_id", null)
    .order("created_at", { ascending: false });

  // 4. Fetch subscription records (active / pending / expired-stopped) for the
  // record list tabs that were moved here from the Customers portal.
  // Clinic-scope confinement: switch the `customer_profiles` embed to
  // `!inner` only when the admin is clinic-scoped, so the embedded
  // `customer_profiles.clinic_id` filter can be applied at the DB level below.
  const recordSelectFields = clinicId
    ? `
    id, starts_on, effective_end_on, ends_on, total_days, pause_credits_total, pause_credits_used, status, franchise_id,
    customer_profiles!inner ( clinic_id, users!customer_profiles_user_id_fkey ( full_name, email ) ),
    subscription_plans ( name )
  `
    : `
    id, starts_on, effective_end_on, ends_on, total_days, pause_credits_total, pause_credits_used, status, franchise_id,
    customer_profiles ( users!customer_profiles_user_id_fkey ( full_name, email ) ),
    subscription_plans ( name )
  `;

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
      franchise_id: sub.franchise_id || null,
    };
  };

  let activeRecordsQuery = supabaseAdmin
    .from("subscriptions")
    .select(recordSelectFields)
    .eq("status", "ACTIVE")
    .order("starts_on", { ascending: false });
  let pendingRecordsQuery = supabaseAdmin
    .from("subscriptions")
    .select(recordSelectFields)
    .eq("status", "PENDING")
    .order("starts_on", { ascending: true });
  let stoppedRecordsQuery = supabaseAdmin
    .from("subscriptions")
    .select(recordSelectFields)
    .in("status", ["STOPPED", "CANCELLED", "EXPIRED"])
    .order("ends_on", { ascending: false });

  if (clinicId) {
    activeRecordsQuery = activeRecordsQuery.eq("customer_profiles.clinic_id", clinicId);
    pendingRecordsQuery = pendingRecordsQuery.eq("customer_profiles.clinic_id", clinicId);
    stoppedRecordsQuery = stoppedRecordsQuery.eq("customer_profiles.clinic_id", clinicId);
  }

  const { data: rawActiveRecords } = await activeRecordsQuery;
  const { data: rawPendingRecords } = await pendingRecordsQuery;
  const { data: rawStoppedRecords } = await stoppedRecordsQuery;

  const subscriptionRecordsActive = (rawActiveRecords || []).map(mapSubRow);
  const subscriptionRecordsPending = (rawPendingRecords || []).map(mapSubRow);
  const subscriptionRecordsStopped = (rawStoppedRecords || []).map(mapSubRow);

  return (
    <div className="flex flex-col gap-6">
      <AdminPageHeader
        title="Subscription Management"
        description="Manage subscription plans, KIT products, and view analytics."
      />
      <AdminSubscriptionsWrapper
        plans={plans || []}
        activeSubscriptions={activeSubs || []}
        initialGlobalCoupons={globalCoupons || []}
        subscriptionRecordsActive={subscriptionRecordsActive}
        subscriptionRecordsPending={subscriptionRecordsPending}
        subscriptionRecordsStopped={subscriptionRecordsStopped}
        lockedClinicId={clinicId}
      />
    </div>
  );
}