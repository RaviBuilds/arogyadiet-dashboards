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

  // 3. Fetch Plans
  const { data: plans } = await supabase
    .from("subscription_plans")
    .select("*")
    .eq("is_active", true)
    .order("price");

    // const customOrder = [30, 90, 60];

    // const plans = plansData?.sort((a, b) => {
    //   return (
    //     customOrder.indexOf(a.duration_days) -
    //     customOrder.indexOf(b.duration_days)
    //   );
    // });

  const isProfileComplete = !!profile?.dietary_preference;

  return (
    <div className="max-w-6xl mx-auto space-y-10 animate-in fade-in slide-in-from-bottom-4">
      <div>
        <h1 className="text-2xl sm:text-3xl font-semibold text-slate-900 tracking-tight">
          Choose Your Plan
        </h1>
        <p className="text-sm text-slate-500 mt-1">
          Select a meal plan that fits your lifestyle. Healthy, chef-prepared
          meals delivered daily.
        </p>
      </div>

      {/* THE PROFILE GATE WARNING */}
      {!isProfileComplete && (
        <Alert className="bg-amber-50/80 border-amber-200 text-amber-900 shadow-sm">
          <AlertCircle className="h-5 w-5 stroke-amber-600" />
          <AlertTitle className="font-semibold text-amber-900">
            Profile Incomplete
          </AlertTitle>
          <AlertDescription className="mt-2 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <p className="text-sm text-amber-800/90 leading-relaxed">
              Please update your dietary preferences in your profile before
              initiating a plan customization and purchase.
            </p>
            <Button
              asChild
              size="sm"
              className="bg-amber-600 hover:bg-amber-700 text-white shrink-0 transition-all duration-200"
            >
              <Link href="/profile">
                Update Profile Now <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {/* RENDER PLANS */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {plans?.map((plan) => {
          // Highlight the middle plan as "Popular" automatically if there are 3 plans
          const isPopular = plan.recommended; // Adjust based on your strategy

          return (
            <Card
              key={plan.id}
              className={`border border-slate-200 bg-white shadow-sm flex flex-col relative overflow-hidden transition-all duration-200 hover:shadow-md hover:border-slate-300 ${isPopular ? "border-secondary border-2 shadow-lg z-10 md:scale-[1.02]" : ""}`}
            >
              {isPopular && (
                <div className="absolute top-0 left-0 right-0 bg-secondary/10 text-secondary border-b border-secondary/20 text-xs font-semibold uppercase tracking-wider py-2 text-center pointer-events-none">
                  Best Value
                </div>
              )}
              <CardHeader
                className={`border-b border-slate-100 bg-slate-50/50 px-6 py-4 ${isPopular ? "pt-10" : ""}`}
              >
                <CardTitle className="text-lg font-semibold text-slate-900 tracking-tight">
                  {plan.name}
                </CardTitle>
                <CardDescription className="text-sm text-slate-500">
                  Perfect for {plan.duration_days} days of healthy meals
                </CardDescription>
              </CardHeader>
              <CardContent className="flex-1 p-6 space-y-6">
                <div className="flex items-baseline gap-1">
                  <span className="text-4xl font-bold text-slate-900 tracking-tight">
                    ₹{plan.price.toLocaleString("en-IN")}
                  </span>
                  <span className="text-sm text-slate-500">
                    /{plan.duration_days} days
                  </span>
                </div>

                <ul className="space-y-3.5 text-sm text-slate-600">
                  <li className="flex items-center gap-2 transition-colors duration-200">
                    <Check className="h-4 w-4 text-emerald-600 shrink-0" />
                    <span>{plan.duration_days} Premium Meals</span>
                  </li>
                  <li className="flex items-center gap-2 transition-colors duration-200">
                    <Check className="h-4 w-4 text-emerald-600 shrink-0" />
                    <span>{plan.pause_credits} Pause Credits</span>
                  </li>
                  <li className="flex items-center gap-2 transition-colors duration-200">
                    <Check className="h-4 w-4 text-emerald-600 shrink-0" />
                    <span>Dedicated Delivery Team</span>
                  </li>
                  <li className="flex items-center gap-2 transition-colors duration-200">
                    <Check className="h-4 w-4 text-emerald-600 shrink-0" />
                    <span>Customizable Planner</span>
                  </li>
                </ul>
              </CardContent>
              <CardFooter className="p-6 pt-0 border-0 bg-transparent">
                <Button
                  className="w-full font-bold h-11 text-base transition-all duration-200"
                  variant={isPopular ? "default" : "outline"}
                  disabled={!isProfileComplete}
                  asChild={isProfileComplete}
                >
                  {isProfileComplete ? (
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
