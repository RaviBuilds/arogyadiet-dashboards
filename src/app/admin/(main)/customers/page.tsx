import { createAdminClient } from "@/lib/supabase/admin";
import { AdminPageHeader } from "@/shared/components/admin/core/AdminPageHeader";
import { AdminCustomersWrapper } from "./AdminCustomersWrapper";
import { guardAdminGroup } from "@/lib/auth/adminAccess";

export const revalidate = false;

export default async function CustomersPage({
  searchParams,
}: {
  searchParams?: Promise<{ action?: string }>;
}) {
  await guardAdminGroup("customers");
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
      clinics ( name ),
      users!inner ( id, full_name, email, mobile, is_active ),
      addresses ( pincode, is_primary ),
      subscriptions ( status, customer_category, subscription_plans ( name ) )
    `);

  if (error) console.error("Error fetching customers:", error);

  const customers = (rawCustomers || []).map((customer: any) => {
    const primaryAddress = customer.addresses?.find(
      (addr: any) => addr.is_primary,
    );

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
      activePlanName = activeSub.subscription_plans?.name || "Custom Plan";
      customerCategory = activeSub.customer_category;
    } else if (pendingSub) {
      displayStatus = "Pending";
      activePlanName = pendingSub.subscription_plans?.name || "Custom Plan";
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
      franchiseId: customer.franchise_id || null,
    };
  });

  const { data: rawActiveSubs } = await supabaseAdmin
    .from("subscriptions")
    .select(
      `
      id, starts_on, effective_end_on, ends_on, total_days, pause_credits_total, pause_credits_used, status,
      customer_profiles ( users ( full_name, email ) ),
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
    customer_profiles ( users ( full_name, email ) ),
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

  return (
    <div className="flex animate-in fade-in flex-col gap-6 pb-2 duration-500">
      <AdminPageHeader
        title="Customers"
        description="Manage your subscriber base and account statuses."
      />

      <AdminCustomersWrapper
        customers={customers}
        activeSubscriptions={activeSubs}
        pendingSubscriptions={pendingSubs}
        stoppedSubscriptions={stoppedSubs}
        autoOpenCreate={autoOpenCreate}
      />
    </div>
  );
}
