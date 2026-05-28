import { createAdminClient } from "@/lib/supabase/admin";
import CustomerDashboard from "@/shared/components/admin/customers/CustomerDashboard";
import { AdminPageHeader } from "@/shared/components/admin/core/AdminPageHeader";

export const revalidate = false;

export default async function CustomersPage() {
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
      users!inner ( id, full_name, email, mobile, is_active ),
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

    // Determine status and active plan name with priority: Active > Pending > Stopped > Expired > No Plan
    const activeSub = customer.subscriptions?.find((s: any) => s.status === "ACTIVE");
    const pendingSub = customer.subscriptions?.find((s: any) => s.status === "PENDING");
    const stoppedSub = customer.subscriptions?.find(
      (s: any) => s.status === "STOPPED" || s.status === "CANCELLED",
    );
    const expiredSub = customer.subscriptions?.find((s: any) => s.status === "EXPIRED");

    let displayStatus: string;
    let activePlanName: string | null = null;

    if (activeSub) {
      displayStatus = "Active";
      activePlanName = activeSub.subscription_plans?.name || "Custom Plan";
    } else if (pendingSub) {
      displayStatus = "Pending";
      activePlanName = pendingSub.subscription_plans?.name || "Custom Plan";
    } else if (stoppedSub) {
      displayStatus = "Stopped";
    } else if (expiredSub) {
      displayStatus = "Expired";
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

  // Fetch all shop (addon) orders across all customers, newest first
  const { data: rawShopOrders } = await supabaseAdmin
    .from("addon_orders")
    .select(
      `
      id,
      created_at,
      total_amount,
      status,
      target_delivery_date,
      delivery_order_id,
      customer_profile_id,
      delivery_orders (delivery_date),
      addon_order_items (
        quantity,
        unit_price,
        products (name)
      ),
      customer_profiles (
        users (full_name)
      )
    `,
    )
    .order("created_at", { ascending: false });

  const shopOrders = (rawShopOrders || []).map((o: any) => {
    const profile = Array.isArray(o.customer_profiles)
      ? o.customer_profiles[0]
      : o.customer_profiles;
    const user = Array.isArray(profile?.users) ? profile?.users[0] : profile?.users;
    const delivery = Array.isArray(o.delivery_orders)
      ? o.delivery_orders[0]
      : o.delivery_orders;
    const items = (Array.isArray(o.addon_order_items) ? o.addon_order_items : [])
      .filter(Boolean)
      .map((item: any) => ({
        product_name: item?.products?.name ?? "Product",
        quantity: item?.quantity ?? 1,
        unit_price: item?.unit_price ?? 0,
      }));
    return {
      id: o.id as string,
      created_at: o.created_at as string,
      customer_profile_id: o.customer_profile_id as string,
      customer_name: (user?.full_name as string) || "N/A",
      total_amount: o.total_amount as number | null,
      status: o.status as string | null,
      target_delivery_date: o.target_delivery_date as string | null,
      delivery_order_id: o.delivery_order_id as string | null,
      scheduled_delivery_date: (delivery?.delivery_date as string) ?? null,
      items,
    };
  });

  return (
    <div className="space-y-6 flex flex-col">
      <AdminPageHeader
        title="Customers"
        description="Manage your subscriber base and account statuses."
      />

      <CustomerDashboard
        customers={customers}
        activeSubscriptions={activeSubs}
        pendingSubscriptions={pendingSubs}
        stoppedSubscriptions={stoppedSubs}
        shopOrders={shopOrders}
      />
    </div>
  );
}
