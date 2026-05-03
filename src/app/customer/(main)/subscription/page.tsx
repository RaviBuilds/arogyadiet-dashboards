import { createClient } from "@/lib/supabase/server";
import { PlanCard } from "@/modules/subscription/components/checkout/plan-card";

export default async function SubscriptionPage() {
  const supabase = await createClient();

  // Fetch plans ordered by duration as per global pricing catalog[cite: 3]
  const { data: plansData , error} = await supabase
    .from("subscription_plans")
    .select("*")
    .eq("is_active", true)
    .order("duration_days", { ascending: true });

    const dashboardOrder = [30,90,60];
    const plans = plansData?.sort(
      (a, b) =>
        dashboardOrder.indexOf(a.duration_days) -
        dashboardOrder.indexOf(b.duration_days),
    );

   
    
  return (
    <div className="max-w-6xl mx-auto py-10 space-y-12">
      <div className="text-center space-y-4">
        <h1 className="text-4xl font-extrabold tracking-tight">
          Choose Your Diet Plan
        </h1>
        <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
          Fuel your body with premium nutrition. Select a subscription that fits
          your lifestyle.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-8 px-4 py-8">
        {plans?.map((plan) => (
          <PlanCard
            key={plan.id}
            plan={plan}
            isPopular={plan.duration_days === 90} // Marketing the 60-day plan as "Value Plan"[cite: 3]
          />
        ))}
      </div>
    </div>
  );
}
