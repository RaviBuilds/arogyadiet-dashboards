import { Button } from "@/shared/components/ui/button";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import CustomerDashboard from "@/shared/components/admin/customers/CustomerDashboard";
import { AdminPageHeader } from "@/shared/components/admin/core/AdminPageHeader";

export const revalidate = 0;

export default async function CustomersPage() {
  const supabase = await createClient();
  const supabaseAdmin = createAdminClient();

  const { data: rawCustomers, error } = await supabase.from("customer_profiles")
    .select(`
      id,
      is_active,
      dietary_preference,
      gender,
      date_of_birth,
      allergies,
      has_medical_history,
      users!inner ( id, full_name, email, mobile ),
      addresses ( pincode, is_primary ),
      subscriptions ( status, subscription_plans ( name ) )
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

    // Find Active Plan
    const activeSub = customer.subscriptions?.find(
      (sub: any) => sub.status === "ACTIVE" || sub.status === "PENDING",
    );
    const activePlanName = activeSub?.subscription_plans?.name || null;

    return {
      id: customer.id,
      userId: customer.users?.id || "",
      fullName: customer.users?.full_name || "N/A",
      email: customer.users?.email || "N/A",
      mobile: customer.users?.mobile || "N/A",
      dietary_preference: customer.dietary_preference || "N/A",
      primary_pincode: primaryAddress?.pincode || "N/A",
      status: activePlanName ? "Active" : "Expired",
      gender: customer.gender || "N/A",
      dateOfBirth: customer.date_of_birth || "",
      age: age,
      allergies: customer.allergies || null,
      hasMedicalHistory: customer.has_medical_history || false,
      activePlanName: activePlanName,
    };
  });

  const { data: rawActiveSubs } = await supabaseAdmin
    .from("subscriptions")
    .select(
      `
      id, starts_on, effective_end_on, ends_on, total_days, pause_credits_total, pause_credits_used,
      customer_profiles ( users ( full_name, email ) ),
      subscription_plans ( name )
    `,
    )
    .eq("status", "ACTIVE")
    .order("starts_on", { ascending: false });

  const activeSubs = (rawActiveSubs || []).map((sub: any) => {
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
      plan_name: sub.subscription_plans?.name || "N/A",
      total_days: sub.total_days || 0,
      starts_on: sub.starts_on,
      ends_on: sub.effective_end_on || sub.ends_on,
      pause_credits_total: sub.pause_credits_total || 0,
      pause_credits_used: sub.pause_credits_used || 0,
    };
  });

  return (
    <div className="space-y-6 flex flex-col">
      <AdminPageHeader
        title="Customers"
        description="Manage your subscriber base and account statuses."
        action={<Button>Create Customer</Button>}
      />

      <CustomerDashboard
        customers={customers}
        activeSubscriptions={activeSubs}
      />
    </div>
  );
}
