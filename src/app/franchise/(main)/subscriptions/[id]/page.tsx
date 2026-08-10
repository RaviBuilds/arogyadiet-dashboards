import { cookies } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, CreditCard } from "lucide-react";

import { createAdminClient } from "@/lib/supabase/admin";
import { PageHeader } from "@/shared/components/franchise/ui/PageHeader";
import { Button } from "@/shared/components/ui/button";
import { Subscription360Dashboard } from "@/shared/components/admin/subscriptions/Subscription360Dashboard";

import {
  franchiseManagePendingSubscription,
  franchiseUpdateActiveSubscriptionDates,
  franchiseStopActiveSubscription,
  franchiseRecalculateSubscriptionTenure,
  franchiseBulkUpdatePausePreferences,
  franchiseBulkUpdateMealPreferences,
  franchiseBulkUpdateAddressPreferences,
} from "@/actions/franchise-actions/franchiseSubscriptionActions";

export const revalidate = 0;

export default async function FranchiseSubscription360Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const cookieStore = await cookies();
  const franchiseId = cookieStore.get("x-franchise-id")?.value ?? "";

  if (!franchiseId) {
    notFound();
  }

  const supabase = createAdminClient();

  // ── 1. Subscription (scoped to the calling franchise) ──────────────────────
  const { data: subData, error: subError } = await supabase
    .from("subscriptions")
    .select(
      `
      *,
      subscription_plans (*),
      customer_profiles (
        id, dietary_preference,
        users!customer_profiles_user_id_fkey ( full_name, email, mobile ),
        addresses (*)
      )
      `,
    )
    .eq("id", id)
    .eq("franchise_id", franchiseId)
    .single();

  if (subError || !subData) notFound();

  // ── 2. Daily preferences ───────────────────────────────────────────────────
  const { data: dailyPrefs } = await supabase
    .from("subscription_daily_preferences")
    .select(`*, meal_categories(id, name)`)
    .eq("subscription_id", id)
    .order("preference_date", { ascending: true });

  // ── 3. Delivery orders (for meal planner addon context) ────────────────────
  const { data: deliveryOrders } = await supabase
    .from("delivery_orders")
    .select(
      `
      id, delivery_date, status,
      addon_orders(
        id, total_amount,
        addon_order_items(product_id, quantity, products(name))
      )
      `,
    )
    .eq("customer_profile_id", subData.customer_profile_id);

  // ── 4. All subscriptions for this customer (lifecycle & history) ───────────
  const { data: allCustomerSubs } = await supabase
    .from("subscriptions")
    .select(`*, subscription_plans(name, duration_days)`)
    .eq("customer_profile_id", subData.customer_profile_id)
    .order("created_at", { ascending: false });

  // ── 5. Meal categories ─────────────────────────────────────────────────────
  const { data: mealCategories } = await supabase
    .from("meal_categories")
    .select("id, code, name")
    .order("code", { ascending: true });

  // meal-subscription-early-closure: see the admin page's equivalent comment.
  const { data: invoicePayment } = await supabase
    .from("payments")
    .select("id, base_amount, tax_amount, delivery_charge, misc_charge, misc_charge_label, amount, amount_paid, balance_due, status")
    .eq("subscription_id", id)
    .eq("invoice_type", "SUBSCRIPTION")
    .maybeSingle();

  const customerUser = Array.isArray(subData.customer_profiles?.users)
    ? subData.customer_profiles.users[0]
    : subData.customer_profiles?.users;

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title={`${customerUser?.full_name || "Customer"}'s Subscription`}
        subtitle={`Manage plan: ${
          subData.subscription_code ||
          subData.id.split("-")[0].toUpperCase()
        }`}
        icon={CreditCard}
        actions={
          <Button variant="outline" asChild>
            <Link href="/subscriptions">
              <ChevronLeft className="h-4 w-4 mr-2" /> Back to Subscriptions
            </Link>
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
        actions={{
          managePendingSubscription: franchiseManagePendingSubscription as any,
          updateActiveSubscriptionDates:
            franchiseUpdateActiveSubscriptionDates as any,
          stopActiveSubscription: franchiseStopActiveSubscription as any,
          recalculateSubscriptionTenure:
            franchiseRecalculateSubscriptionTenure as any,
          bulkUpdatePausePreferences: franchiseBulkUpdatePausePreferences,
          bulkUpdateMealPreferences: franchiseBulkUpdateMealPreferences,
          bulkUpdateAddressPreferences: franchiseBulkUpdateAddressPreferences,
        }}
      />
    </div>
  );
}
