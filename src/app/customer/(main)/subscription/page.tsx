import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { AlertCircle, ArrowRight, Check } from "lucide-react";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
  CardFooter,
} from "@/shared/components/ui/card";
import { Button } from "@/shared/components/ui/button";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/shared/components/ui/alert";

export default async function StorefrontPage() {
  const supabase = await createClient();

  // 1. Authenticate
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: appUser } = await supabase
    .from("users")
    .select("id")
    .eq("auth_user_id", user.id)
    .maybeSingle();
  if (!appUser) redirect("/login");

  // 2. Fetch Profile & Active Subscriptions
  const { data: profile } = await supabase
    .from("customer_profiles")
    .select("*")
    .eq("user_id", appUser.id)
    .maybeSingle();

  const { data: activeSubs } = await supabase
    .from("subscriptions")
    .select("id")
    .eq("customer_profile_id", profile?.id)
    .in("status", ["ACTIVE", "QUEUED"]);

  // 3. Fetch Plans
  const { data: plansData } = await supabase
    .from("subscription_plans")
    .select("*")
    .eq("is_active", true)
    .order("price");

    const customOrder = [30, 90, 60];

    const plans = plansData?.sort((a, b) => {
      return (
        customOrder.indexOf(a.duration_days) -
        customOrder.indexOf(b.duration_days)
      );
    });

  // PROFILE GATE LOGIC
  const isProfileComplete = !!profile?.dietary_preference;

  // PIPELINE LIMIT LOGIC (Max 1 Active, 1 Queued)
  const hasMaxSubscriptions = (activeSubs?.length || 0) >= 2;

  return (
    <div className="max-w-6xl mx-auto space-y-8 animate-in fade-in slide-in-from-bottom-4">
      <div>
        <h1 className="text-3xl font-bold text-zinc-900">Choose Your Plan</h1>
        <p className="text-muted-foreground mt-2">
          Select a meal plan that fits your lifestyle. Healthy, chef-prepared
          meals delivered daily.
        </p>
      </div>

      {/* THE PROFILE GATE WARNING */}
      {!isProfileComplete && (
        <Alert className="bg-amber-50 border-amber-200 text-amber-900">
          <AlertCircle className="h-5 w-5 stroke-amber-600" />
          <AlertTitle className="font-bold text-base">
            Profile Incomplete
          </AlertTitle>
          <AlertDescription className="mt-2 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <p>
              Please update your dietary preferences in your profile before
              initiating a plan customization and purchase.
            </p>
            <Button
              asChild
              size="sm"
              className="bg-amber-600 hover:bg-amber-700 text-white shrink-0"
            >
              <Link href="/profile">
                Update Profile Now <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {/* THE PIPELINE LIMIT WARNING */}
      {hasMaxSubscriptions && (
        <Alert className="bg-blue-50 border-blue-200 text-blue-900">
          <AlertCircle className="h-5 w-5 stroke-blue-600" />
          <AlertTitle className="font-bold text-base">
            Subscription Limit Reached
          </AlertTitle>
          <AlertDescription>
            You currently have active and queued subscriptions. You cannot
            purchase another plan until your current pipeline clears.
          </AlertDescription>
        </Alert>
      )}

      {/* RENDER PLANS */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-4">
        {plans?.map((plan) => {
          // Highlight the middle plan as "Popular" automatically if there are 3 plans
          const isPopular = plan.duration_days === 90; // Adjust based on your strategy

          return (
            <Card
              key={plan.id}
              className={`flex flex-col relative overflow-hidden transition-all hover:shadow-md ${isPopular ? "border-secondary border-2 shadow-lg scale-105 z-10" : ""}`}
            >
              {isPopular && (
                <div className="bg-secondary text-secondary-foreground text-[10px] font-bold uppercase tracking-widest py-1 px-12 absolute top-4 -right-8 rotate-45 shadow-sm">
                  Best Value
                </div>
              )}
              <CardHeader>
                <CardTitle className="text-xl font-bold">{plan.name}</CardTitle>
                <CardDescription>
                  Perfect for {plan.duration_days} days of healthy meals
                </CardDescription>
              </CardHeader>
              <CardContent className="flex-1 space-y-6">
                <div className="flex items-baseline gap-1">
                  <span className="text-4xl font-bold">
                    ₹{plan.price.toLocaleString("en-IN")}
                  </span>
                  <span className="text-muted-foreground text-sm">
                    /{plan.duration_days} days
                  </span>
                </div>

                <ul className="space-y-3 text-sm">
                  <li className="flex items-center gap-2">
                    <Check className="h-4 w-4 text-secondary shrink-0" />
                    <span>{plan.duration_days} Premium Meals</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <Check className="h-4 w-4 text-secondary shrink-0" />
                    <span>{plan.pause_credits} Pause Credits</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <Check className="h-4 w-4 text-secondary shrink-0" />
                    <span>Free Delivery in Hyderabad</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <Check className="h-4 w-4 text-secondary shrink-0" />
                    <span>Customizable Planner</span>
                  </li>
                </ul>
              </CardContent>
              <CardFooter>
                <Button
                  className="w-full font-bold h-11 text-base"
                  variant={isPopular ? "default" : "outline"}
                  disabled={!isProfileComplete || hasMaxSubscriptions}
                  asChild={isProfileComplete && !hasMaxSubscriptions}
                >
                  {isProfileComplete && !hasMaxSubscriptions ? (
                    <Link href={`/subscription/checkout?plan=${plan.id}`}>
                      Subscribe Now
                    </Link>
                  ) : (
                    <span>Subscribe Now</span>
                  )}
                </Button>
              </CardFooter>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
