import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { format } from "date-fns";
import {
  IndianRupee,
  TrendingUp,
  Calendar,
  Wallet,
  CheckCircle2,
} from "lucide-react";
import { Card, CardContent } from "@/shared/components/ui/card";

export const revalidate = 0;

export default async function RiderEarningsPage() {
  const supabase = await createClient();

  // 1. Verify Authentication
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // 2. Fetch App User & Rider Profile
  const { data: appUser } = await supabase
    .from("users")
    .select("id")
    .eq("auth_user_id", user.id)
    .single();

  if (!appUser) redirect("/login");

  const { data: riderProfile } = await supabase
    .from("rider_profiles")
    .select("id")
    .eq("user_id", appUser.id)
    .single();

  if (!riderProfile) {
    return <div className="p-4 text-center">Rider profile not found.</div>;
  }

  // 3. Fetch ONLY Delivered Orders to calculate actual earnings
  const { data: completedOrders, error } = await supabase
    .from("delivery_orders")
    .select("id, delivery_date, payout_amount, delivered_at")
    .eq("assigned_rider_id", riderProfile.id)
    .eq("status", "DELIVERED")
    .order("delivered_at", { ascending: false });

  if (error) {
    return (
      <div className="p-4 text-center text-red-500">
        Failed to load earnings.
      </div>
    );
  }

  // 4. Calculate Metrics
  const todayStr = format(new Date(), "yyyy-MM-dd");
  const safeOrders = completedOrders || [];

  const todayEarnings = safeOrders
    .filter((order) => order.delivery_date === todayStr)
    .reduce((sum, order) => sum + Number(order.payout_amount || 0), 0);

  const totalEarnings = safeOrders.reduce(
    (sum, order) => sum + Number(order.payout_amount || 0),
    0,
  );

  const thisMonthStr = format(new Date(), "yyyy-MM");
  const monthEarnings = safeOrders
    .filter((order) => order.delivery_date.startsWith(thisMonthStr))
    .reduce((sum, order) => sum + Number(order.payout_amount || 0), 0);

  return (
    <div className="p-4 space-y-6 animate-in fade-in slide-in-from-bottom-4 mb-20">
      {/* Header */}
      <div className="pt-2 pb-2">
        <h1 className="text-2xl font-black text-zinc-900">Your Earnings</h1>
        <p className="text-zinc-500 font-medium">
          Track your daily and total payouts
        </p>
      </div>

      {/* Primary Highlight: Today's Earnings */}
      <Card className="border-none shadow-md bg-gradient-to-br from-green-500 to-emerald-600 text-white rounded-2xl overflow-hidden">
        <CardContent className="p-6 relative">
          <Wallet className="absolute right-[-20px] bottom-[-20px] h-32 w-32 text-white/10" />
          <p className="font-bold text-green-50 uppercase tracking-wider text-xs mb-1">
            Today's Earnings
          </p>
          <div className="flex items-baseline gap-1">
            <span className="text-2xl font-bold">₹</span>
            <span className="text-5xl font-black tracking-tight">
              {todayEarnings}
            </span>
          </div>
          <p className="text-sm font-medium text-green-100 mt-2">
            {format(new Date(), "EEEE, do MMMM")}
          </p>
        </CardContent>
      </Card>

      {/* Secondary Metrics */}
      <div className="grid grid-cols-2 gap-4">
        <Card className="border-2 border-zinc-100 shadow-sm rounded-2xl">
          <CardContent className="p-5">
            <div className="bg-blue-50 w-10 h-10 rounded-full flex items-center justify-center mb-3">
              <Calendar className="h-5 w-5 text-blue-600" />
            </div>
            <p className="text-xs font-bold text-zinc-400 uppercase tracking-wider mb-1">
              This Month
            </p>
            <h3 className="text-2xl font-black text-zinc-900">
              ₹{monthEarnings}
            </h3>
          </CardContent>
        </Card>

        <Card className="border-2 border-zinc-100 shadow-sm rounded-2xl">
          <CardContent className="p-5">
            <div className="bg-orange-50 w-10 h-10 rounded-full flex items-center justify-center mb-3">
              <TrendingUp className="h-5 w-5 text-orange-600" />
            </div>
            <p className="text-xs font-bold text-zinc-400 uppercase tracking-wider mb-1">
              Total All Time
            </p>
            <h3 className="text-2xl font-black text-zinc-900">
              ₹{totalEarnings}
            </h3>
          </CardContent>
        </Card>
      </div>

      {/* Recent Transactions / History */}
      <div>
        <h3 className="text-sm font-bold text-zinc-400 uppercase tracking-wider mb-3 px-1">
          Recent Completed Deliveries
        </h3>

        {safeOrders.length === 0 ? (
          <div className="bg-zinc-50 border-2 border-dashed border-zinc-200 rounded-2xl p-8 text-center text-zinc-500 font-medium">
            No completed deliveries yet.
          </div>
        ) : (
          <div className="space-y-3">
            {safeOrders.slice(0, 10).map((order) => (
              <Card key={order.id} className="border-none shadow-sm rounded-xl">
                <CardContent className="p-4 flex justify-between items-center">
                  <div className="flex gap-3 items-center">
                    <div className="bg-green-100 h-10 w-10 rounded-full flex items-center justify-center shrink-0">
                      <CheckCircle2 className="h-5 w-5 text-green-600" />
                    </div>
                    <div>
                      <p className="font-bold text-zinc-900 text-sm">
                        Delivery Payout
                      </p>
                      <p className="text-xs font-medium text-zinc-500">
                        {order.delivered_at
                          ? format(
                              new Date(order.delivered_at),
                              "MMM dd, h:mm a",
                            )
                          : format(
                              new Date(order.delivery_date),
                              "MMM dd, yyyy",
                            )}
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <span className="font-black text-green-600">
                      +₹{order.payout_amount}
                    </span>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
