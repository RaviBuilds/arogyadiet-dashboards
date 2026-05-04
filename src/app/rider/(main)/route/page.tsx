import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { format } from "date-fns";
import { Package, ChevronRight, AlertCircle, PowerOff } from "lucide-react";
import { Card, CardContent } from "@/shared/components/ui/card";
import { Button } from "@/shared/components/ui/button";
import { markBatchPickedUpAction } from "@/actions/rider-actions/routeActions";
import Link from "next/link";

export const revalidate = 0;

export default async function RiderRoutePage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // 1. Fetch App User
  const { data: appUsers, error: appUserError } = await supabase
    .from("users")
    .select("id")
    .eq("auth_user_id", user.id)
    .limit(1);

  const appUser = appUsers?.[0];

  if (appUserError || !appUser) {
    return (
      <div className="p-10 text-center space-y-4">
        <AlertCircle className="h-12 w-12 text-red-500 mx-auto" />
        <h1 className="text-xl font-bold text-red-600">
          Failed to load App User
        </h1>
        <p className="text-zinc-600 text-sm">
          {appUserError?.message || "User not found. Check users table RLS."}
        </p>
      </div>
    );
  }

  // 2. Fetch Rider Profile
  const { data: riderProfiles, error: riderProfileError } = await supabase
    .from("rider_profiles")
    .select("id, is_online")
    .eq("user_id", appUser.id)
    .limit(1);

  const riderProfile = riderProfiles?.[0];

  if (riderProfileError || !riderProfile) {
    return (
      <div className="p-10 text-center space-y-4">
        <AlertCircle className="h-12 w-12 text-red-500 mx-auto" />
        <h1 className="text-xl font-bold text-red-600">
          Rider Profile Missing
        </h1>
        <p className="text-zinc-600 text-sm">
          {riderProfileError?.message ||
            "No profile found. Check rider_profiles table RLS."}
        </p>
      </div>
    );
  }

  // Enforce duty status before showing route
  if (!riderProfile.is_online) {
    return (
      <div className="p-4 space-y-6 animate-in fade-in slide-in-from-bottom-4">
        <div className="pt-2 pb-2">
          <h1 className="text-2xl font-black text-zinc-900">
            Today&apos;s Route
          </h1>
          <p className="text-zinc-500 font-medium">Route sync is paused</p>
        </div>

        <Card className="border-dashed border-2 border-zinc-200 shadow-none bg-white rounded-2xl">
          <CardContent className="p-6 text-center">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-zinc-100 text-zinc-500">
              <PowerOff className="h-7 w-7" />
            </div>
            <h2 className="text-xl font-black text-zinc-900">
              You are offline
            </h2>
            <p className="mt-2 text-sm font-medium text-zinc-500">
              Toggle On Duty from the dashboard to sync today&apos;s assigned
              route.
            </p>
            <Button asChild className="mt-5 w-full rounded-xl">
              <Link href="/dashboard">Go to Dashboard</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // 3. Fetch Today's Orders with Lifecycle Statuses
  const todayStr = format(new Date(), "yyyy-MM-dd");

  const { data: orders, error } = await supabase
    .from("delivery_orders")
    .select(
      `
      id, 
      status, 
      payout_amount,
      meal_category:meal_categories ( name ),
      delivery_address:addresses ( street_1, street_2, landmark, city, pincode ),
      customer_profile:customer_profiles ( users ( full_name, mobile ) )
    `,
    )
    .eq("assigned_rider_id", riderProfile.id)
    .eq("delivery_date", todayStr)
    .in("status", [
      "ORDER_CREATED",
      "MEAL_PREPARED",
      "ASSIGNED",
      "PICKED",
      "ON_THE_WAY",
    ]);

  if (error) {
    return (
      <div className="p-10 text-center space-y-4">
        <AlertCircle className="h-12 w-12 text-red-500 mx-auto" />
        <h1 className="text-xl font-bold text-red-600">Database Error</h1>
        <p className="text-zinc-600 text-sm">{error.message}</p>
      </div>
    );
  }

  const safeOrders = (orders as any[]) || [];

  // Grouping logic based on updated lifecycle
  const pendingPickup = safeOrders.filter((o) =>
    ["ORDER_CREATED", "MEAL_PREPARED", "ASSIGNED"].includes(o.status),
  );

  const onTheRoad = safeOrders.filter((o) =>
    ["PICKED", "ON_THE_WAY"].includes(o.status),
  );

  const manifest = pendingPickup.reduce(
    (acc: Record<string, number>, order) => {
      const mealCat = Array.isArray(order.meal_category)
        ? order.meal_category[0]
        : order.meal_category;
      const mealName = mealCat?.name || "Unknown Meal";
      acc[mealName] = (acc[mealName] || 0) + 1;
      return acc;
    },
    {},
  );

  const handleBatchPickup = async () => {
    "use server";
    await markBatchPickedUpAction(riderProfile.id, todayStr);
  };

  return (
    <div className="p-4 space-y-6 animate-in fade-in slide-in-from-bottom-4">
      <div className="pt-2 pb-2 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black text-zinc-900">Today's Route</h1>
          <p className="text-zinc-500 font-medium">
            {safeOrders.length} total deliveries
          </p>
        </div>
      </div>

      {safeOrders.length === 0 && (
        <div className="flex flex-col items-center justify-center text-center p-10 bg-white rounded-2xl border border-dashed border-zinc-300 mt-10 shadow-sm">
          <div className="bg-zinc-100 p-4 rounded-full mb-4">
            <Package className="h-8 w-8 text-zinc-400" />
          </div>
          <h2 className="text-lg font-bold text-zinc-900">No deliveries yet</h2>
          <p className="text-sm text-zinc-500 mt-2">
            Check back after 5:15 PM when the daily routes are generated.
          </p>
        </div>
      )}

      {pendingPickup.length > 0 && (
        <div className="space-y-4">
          <div className="bg-blue-50 border border-blue-200 p-4 rounded-2xl shadow-sm">
            <div className="flex items-center gap-3 mb-4">
              <AlertCircle className="h-6 w-6 text-blue-600" />
              <h3 className="font-bold text-blue-900 text-lg">
                Kitchen Pickup Required
              </h3>
            </div>

            <div className="bg-white rounded-xl p-4 shadow-sm mb-4">
              <p className="text-xs font-bold text-zinc-400 uppercase tracking-wider mb-3">
                Manifest Checklist
              </p>
              <div className="space-y-3">
                {Object.entries(manifest).map(([meal, count]) => (
                  <div
                    key={meal}
                    className="flex justify-between items-center border-b border-zinc-100 pb-2 last:border-0 last:pb-0"
                  >
                    <span className="font-semibold text-zinc-700">{meal}</span>
                    <span className="bg-zinc-100 text-zinc-800 font-black px-3 py-1 rounded-lg">
                      x {count}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <form action={handleBatchPickup}>
              <Button
                type="submit"
                size="lg"
                className="w-full bg-blue-600 hover:bg-blue-700 text-white rounded-xl h-14 text-lg font-bold shadow-lg shadow-blue-200"
              >
                Mark Batch Picked Up
              </Button>
            </form>
          </div>
        </div>
      )}

      {onTheRoad.length > 0 && (
        <div>
          <h3 className="text-sm font-bold text-zinc-400 uppercase tracking-wider mb-3 px-1">
            Pending Drops
          </h3>
          <div className="space-y-3">
            {onTheRoad.map((order, index) => {
              const address = Array.isArray(order.delivery_address)
                ? order.delivery_address[0]
                : order.delivery_address;
              const profile = Array.isArray(order.customer_profile)
                ? order.customer_profile[0]
                : order.customer_profile;
              const customerUser = Array.isArray(profile?.users)
                ? profile.users[0]
                : profile?.users;
              const mealCategory = Array.isArray(order.meal_category)
                ? order.meal_category[0]
                : order.meal_category;
              const addressLine = [
                address?.street_1,
                address?.street_2,
                address?.landmark,
                address?.pincode,
              ]
                .filter(Boolean)
                .join(", ");

              return (
                <Link
                  key={order.id}
                  href={`/route/${order.id}`}
                  className="block"
                >
                  <Card className="border-none shadow-sm bg-white rounded-2xl overflow-hidden active:scale-[0.98] transition-transform">
                    <div className="bg-zinc-900 w-full h-1.5" />
                    <CardContent className="p-4">
                      <div className="flex justify-between items-start">
                        <div className="flex gap-4">
                          <div className="bg-zinc-100 h-10 w-10 rounded-full flex items-center justify-center font-black text-zinc-600 shrink-0">
                            {index + 1}
                          </div>
                          <div>
                            <h4 className="font-bold text-zinc-900 text-lg">
                              {customerUser?.full_name || "Customer"}
                            </h4>
                            <p className="text-sm text-zinc-500 line-clamp-1">
                              {addressLine || "Address pending..."}
                            </p>
                            <div className="mt-2 inline-flex items-center gap-1.5 bg-orange-50 text-orange-700 px-2.5 py-1 rounded-md text-xs font-bold uppercase tracking-wide">
                              {mealCategory?.name || "Meal"}
                            </div>
                          </div>
                        </div>
                        <ChevronRight className="h-6 w-6 text-zinc-300 mt-2" />
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
