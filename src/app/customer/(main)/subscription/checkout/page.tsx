import { getCustomerSession } from "@/lib/customer/get-session";
import { redirect } from "next/navigation";
import { CheckoutWizard } from "@/shared/components/customer/subscription/checkout/checkout-wizard.tsx";
import { fetchHolidaysInRange } from "@/actions/admin-actions/holidayActions";
import { addYears, format } from "date-fns";

export default async function CheckoutPage() {
  const { supabase, user, customerProfileId, error } =
    await getCustomerSession();
  if (error || !user) redirect("/login");

  //fetch the plan and profile in parallel
  const todayStr = format(new Date(), "yyyy-MM-dd");
  const holidaysEndStr = format(addYears(new Date(), 2), "yyyy-MM-dd");

  const [
    profileResponse,
    plansResponse,
    latestSubscriptionResponse,
    categoriesResponse,
  ] = await Promise.all([
    customerProfileId
      ? supabase
          .from("customer_profiles")
          .select("dietary_preference, id, franchise_id")
          .eq("id", customerProfileId)
          .maybeSingle()
      : Promise.resolve({ data: null as any }),
    supabase
      .from("subscription_plans")
      .select("*")
      .eq("is_active", true)
      .order("duration_days", { ascending: true }),
    customerProfileId
      ? supabase
          .from("subscriptions")
          .select("id, ends_on, effective_end_on, status")
          .eq("customer_profile_id", customerProfileId)
          .in("status", ["ACTIVE", "PENDING"])
          .order("ends_on", { ascending: false })
          .limit(1)
          .maybeSingle()
      : Promise.resolve({ data: null as any }),
    supabase
      .from("meal_categories")
      .select("id, code, name")
      .order("code", { ascending: true }),
  ]);

  const holidaysByDate = await fetchHolidaysInRange(
    todayStr,
    holidaysEndStr,
    profileResponse.data?.franchise_id ?? null,
  );

  return (
    <div className="bg-slate-50/50 min-h-screen">
      <CheckoutWizard
        plans={plansResponse.data || []}
        profile={profileResponse.data}
        latestSubscription={latestSubscriptionResponse.data}
        mealCategories={categoriesResponse.data || []}
        holidaysByDate={holidaysByDate}
      />
    </div>
  );
}
