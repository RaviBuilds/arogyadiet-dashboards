import { createAdminClient } from "@/lib/supabase/admin";
import { AdminPageHeader } from "@/shared/components/admin/core/AdminPageHeader";
import { Subscription360Dashboard } from "@/shared/components/admin/subscriptions/Subscription360Dashboard";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Button } from "@/shared/components/ui/button";
import { ChevronLeft } from "lucide-react";
import { guardAdminGroup } from "@/lib/auth/adminAccess";

export const revalidate = 0;

export default async function Subscription360Page({ params }: { params: Promise<{ id: string }> }) {
  await guardAdminGroup("subscriptions");
  const { id } = await params;
  const supabaseAdmin = createAdminClient();

  const { data: subData, error: subError } = await supabaseAdmin
    .from("subscriptions")
    .select(`
      *,
      subscription_plans (*),
      customer_profiles (
        id, dietary_preference,
        users!customer_profiles_user_id_fkey ( full_name, email, mobile ),
        addresses (*)
      )
    `)
    .eq("id", id)
    .single();

  if (subError || !subData) notFound();

  // 1. Fetch preferences ONLY
  const { data: dailyPrefs } = await supabaseAdmin
    .from("subscription_daily_preferences")
    .select(`*, meal_categories(id, name)`)
    .eq("subscription_id", id)
    .order("preference_date", { ascending: true });

  // 2. Fetch delivery orders + shop products separately to avoid FK join errors
  const { data: deliveryOrders } = await supabaseAdmin
    .from("delivery_orders")
    .select(`
      id, delivery_date, status,
      addon_orders(
        id, total_amount,
        addon_order_items(product_id, quantity, products(name))
      )
    `)
    .eq("customer_profile_id", subData.customer_profile_id);

  const { data: allCustomerSubs } = await supabaseAdmin
    .from("subscriptions")
    .select(`*, subscription_plans(name, duration_days)`)
    .eq("customer_profile_id", subData.customer_profile_id)
    .order("created_at", { ascending: false });

  const { data: mealCategories } = await supabaseAdmin
    .from("meal_categories")
    .select("id, code, name")
    .order("code", { ascending: true });

  // meal-subscription-early-closure: the invoice breakup (base_amount,
  // tax_amount, delivery_charge as actually invoiced) lives on `payments`, not
  // `subscriptions` — needed by the Recalculate Subscription Tenure dialog to
  // show the current figures and enforce "new charge must be lower".
  const { data: invoicePayment } = await supabaseAdmin
    .from("payments")
    .select("id, base_amount, tax_amount, delivery_charge, misc_charge, misc_charge_label, amount, amount_paid, balance_due, status")
    .eq("subscription_id", id)
    .eq("invoice_type", "SUBSCRIPTION")
    .maybeSingle();

  const customerUser = Array.isArray(subData.customer_profiles?.users)
    ? subData.customer_profiles.users[0]
    : subData.customer_profiles?.users;

  return (
    <div className="flex flex-col gap-8 max-w-6xl mx-auto w-full p-4 md:p-8">
      <AdminPageHeader
        title={`${customerUser?.full_name || "Customer"}'s Subscription`}
        description={`Manage plan: ${subData.subscription_code || subData.id.split('-')[0].toUpperCase()}`}
        action={
          <Button variant="outline" asChild>
            <Link href="/customers"><ChevronLeft className="h-4 w-4 mr-2" /> Back to Customers</Link>
          </Button>
        }
      />
      <Subscription360Dashboard 
        subscription={subData} 
        dailyPrefs={dailyPrefs || []} 
        allCustomerSubs={allCustomerSubs || []}
        mealCategories={mealCategories || []}
        deliveryOrders={deliveryOrders || []}
        invoicePayment={invoicePayment ?? null}
      />
    </div>
  );
}
