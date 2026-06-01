import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { CheckoutWizard } from "@/shared/components/customer/subscription/checkout/checkout-wizard.tsx";
import { fetchHolidaysInRange } from "@/actions/admin-actions/holidayActions";
import { addYears, format } from "date-fns";

export default async function CheckoutPage() {
  const supbase = await createClient();

  const {
    data: { user },
    error: userError,
  } = await supbase.auth.getUser();
  if (!user || userError) redirect("/login");

  const profileResponse = await supbase
    .from("customer_profiles")
    .select("dietary_preference, id, users!inner(auth_user_id)")
    .eq("users.auth_user_id", user.id)
    .maybeSingle();

  //fetch the plan and profile  in parallel
  const todayStr = format(new Date(), "yyyy-MM-dd");
  const holidaysEndStr = format(addYears(new Date(), 2), "yyyy-MM-dd");

  const [plansResponse, latestSubscriptionResponse, categoriesResponse] =
    await Promise.all([
      supbase
        .from("subscription_plans")
        .select("*")
        .eq("is_active", true)
        .order("duration_days", { ascending: true }),
      supbase
        .from("subscriptions")
        .select("id, ends_on, effective_end_on, status")
        .eq("customer_profile_id", profileResponse.data?.id)
        .in("status", ["ACTIVE", "PENDING"])
        .order("ends_on", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supbase
        .from("meal_categories")
        .select("id, code, name")
        .order("code", { ascending: true }),
    ]);

  const holidaysByDate = await fetchHolidaysInRange(todayStr, holidaysEndStr);

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
