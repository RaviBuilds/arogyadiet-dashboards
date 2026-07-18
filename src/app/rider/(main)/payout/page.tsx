import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { redirect } from "next/navigation";
import { format } from "date-fns";
import {
  TrendingUp,
  Calendar,
  Wallet,
  CheckCircle2,
  Banknote,
  Clock,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/shared/components/ui/card";
import { Badge } from "@/shared/components/ui/badge";
import {
  formatPaidMonthsWindowLabel,
  formatRiderLeaderboardName,
  getLast3PaidMonthsWindow,
  yearMonthKey,
} from "@/lib/delivery/riderPaidMonthsWindow";

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

  // 4. Fetch Payment History (monthly summaries) + fleet leaderboard data
  const adminClient = createAdminClient();
  const paidMonthsWindow = getLast3PaidMonthsWindow();
  const paidMonthsWindowKeys = new Set(paidMonthsWindow.map(yearMonthKey));
  const windowLabel = formatPaidMonthsWindowLabel(paidMonthsWindow);

  const [{ data: paymentHistory }, { data: fleetPaidSummaries }] =
    await Promise.all([
      adminClient
        .from("rider_monthly_summaries")
        .select(
          "id, month, year, period_start, period_end, total_earnings, total_deliveries, status, is_custom, paid_at, paid_notes",
        )
        .eq("rider_id", riderProfile.id)
        .order("created_at", { ascending: false }),
      adminClient
        .from("rider_monthly_summaries")
        .select(
          `
          rider_id,
          year,
          month,
          net_payable,
          rider_profiles (
            users ( full_name )
          )
        `,
        )
        .eq("status", "PAID"),
    ]);

  const leaderboardTotals = new Map<
    string,
    { riderId: string; displayName: string; total: number }
  >();

  for (const row of fleetPaidSummaries ?? []) {
    if (
      !paidMonthsWindowKeys.has(
        yearMonthKey({ year: row.year, month: row.month }),
      )
    ) {
      continue;
    }

    const profile = Array.isArray(row.rider_profiles)
      ? row.rider_profiles[0]
      : row.rider_profiles;
    const users = profile?.users;
    const userRow = Array.isArray(users) ? users[0] : users;
    const fullName = userRow?.full_name ?? "Unknown";

    const existing = leaderboardTotals.get(row.rider_id);
    if (existing) {
      existing.total += Number(row.net_payable ?? 0);
    } else {
      leaderboardTotals.set(row.rider_id, {
        riderId: row.rider_id,
        displayName: formatRiderLeaderboardName(fullName),
        total: Number(row.net_payable ?? 0),
      });
    }
  }

  const topRiders = [...leaderboardTotals.values()]
    .sort((a, b) => b.total - a.total)
    .slice(0, 5);

  const maxEarnings = Math.max(...topRiders.map((r) => r.total), 1);

  // 5. Calculate Metrics
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
        <p className="font-medium text-zinc-500">
          Track your daily and total payouts
        </p>
      </div>

      {/* Primary Highlight: Today's Earnings */}
      <Card className="relative overflow-hidden rounded-2xl border-none bg-gradient-to-br from-green-500 to-emerald-600 text-white shadow-lg shadow-emerald-900/20">
        {/* Soft top sheen + oversized wallet watermark for depth. */}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/15 to-transparent"
        />
        <CardContent className="relative p-6">
          <Wallet className="absolute -bottom-5 -right-5 h-32 w-32 text-white/10" />
          <p className="mb-1 text-xs font-bold uppercase tracking-wider text-green-50/90">
            Today&apos;s Earnings
          </p>
          <div className="flex items-baseline gap-1">
            <span className="text-2xl font-bold">₹</span>
            <span className="text-5xl font-black tracking-tight">
              {todayEarnings.toFixed(2)}
            </span>
          </div>
          <p className="mt-2 text-sm font-medium text-green-100">
            {format(new Date(), "EEEE, do MMMM")}
          </p>
        </CardContent>
      </Card>

      <Card className="rounded-2xl border border-zinc-100 bg-white shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            🏆 Top Riders <span className="text-muted-foreground font-normal">· Last 3 Months</span>
          </CardTitle>
          <CardDescription>{windowLabel}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3.5">
          {topRiders.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No paid settlements in this period yet.
            </p>
          ) : (
            topRiders.map((rider, index) => (
              <div key={rider.riderId} className="flex items-center gap-3">
                <span className="flex w-24 shrink-0 items-center gap-1.5 truncate text-sm font-medium">
                  <span
                    aria-hidden="true"
                    className="text-xs tabular-nums text-zinc-400"
                  >
                    {index + 1}.
                  </span>
                  <span className="truncate">{rider.displayName}</span>
                </span>
                <div className="relative h-6 w-full flex-1 overflow-hidden rounded-full bg-zinc-100">
                  <div
                    className={`h-full rounded-full transition-all ${index === 0 ? "bg-gradient-to-r from-emerald-400 to-emerald-500" : "bg-gradient-to-r from-indigo-400 to-indigo-500"}`}
                    style={{
                      width: `${(rider.total / maxEarnings) * 100}%`,
                    }}
                  />
                </div>
                <span className="w-20 shrink-0 text-right text-sm font-semibold text-zinc-900">
                  ₹{rider.total.toFixed(2)}
                </span>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      {/* Secondary Metrics */}
      <div className="grid grid-cols-2 gap-4">
        <Card className="rounded-2xl border border-zinc-100 shadow-sm transition-transform active:scale-[0.98]">
          <CardContent className="flex flex-col items-center justify-center p-5 text-center">
            <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-blue-50 text-blue-600 ring-8 ring-blue-50/40">
              <Calendar className="h-5 w-5" />
            </div>
            <h3 className="text-2xl font-black leading-none text-zinc-900">
              ₹{monthEarnings.toFixed(2)}
            </h3>
            <p className="mt-1.5 text-xs font-bold uppercase tracking-wider text-zinc-400">
              This Month
            </p>
          </CardContent>
        </Card>

        <Card className="rounded-2xl border border-zinc-100 shadow-sm transition-transform active:scale-[0.98]">
          <CardContent className="flex flex-col items-center justify-center p-5 text-center">
            <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-orange-50 text-orange-600 ring-8 ring-orange-50/40">
              <TrendingUp className="h-5 w-5" />
            </div>
            <h3 className="text-2xl font-black leading-none text-zinc-900">
              ₹{totalEarnings.toFixed(2)}
            </h3>
            <p className="mt-1.5 text-xs font-bold uppercase tracking-wider text-zinc-400">
              Total All Time
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Payment History (Monthly Settlements) */}
      <div>
        <h3 className="mb-3 flex items-center gap-2 px-1 text-sm font-bold uppercase tracking-wider text-zinc-400">
          <span className="h-3.5 w-1 rounded-full bg-[#e74c3c]" aria-hidden="true" />
          Payment History
        </h3>

        {(!paymentHistory || paymentHistory.length === 0) ? (
          <div className="bg-zinc-50 border-2 border-dashed border-zinc-200 rounded-2xl p-8 text-center text-zinc-500 font-medium">
            No payment settlements yet.
          </div>
        ) : (
          <div className="space-y-3">
            {paymentHistory.map((payment: any) => {
              const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
              const periodLabel = payment.period_start && payment.period_end
                ? `${format(new Date(payment.period_start), "dd MMM")} — ${format(new Date(payment.period_end), "dd MMM yyyy")}`
                : `${monthNames[payment.month - 1]} ${payment.year}`;
              const isPaid = payment.status === "PAID";

              return (
                <Card key={payment.id} className="rounded-xl border border-zinc-100 shadow-sm">
                  <CardContent className="p-4">
                    <div className="flex justify-between items-start">
                      <div className="flex gap-3 items-center">
                        <div className={`h-10 w-10 rounded-full flex items-center justify-center shrink-0 ${isPaid ? "bg-emerald-100" : "bg-amber-100"}`}>
                          {isPaid ? (
                            <Banknote className="h-5 w-5 text-emerald-600" />
                          ) : (
                            <Clock className="h-5 w-5 text-amber-600" />
                          )}
                        </div>
                        <div>
                          <p className="font-bold text-zinc-900 text-sm">
                            {periodLabel}
                          </p>
                          <div className="flex items-center gap-2 mt-0.5">
                            <Badge
                              variant="outline"
                              className={`text-[10px] px-1.5 py-0 ${isPaid ? "bg-emerald-500/10 text-emerald-600 border-emerald-200" : "bg-amber-500/10 text-amber-600 border-amber-200"}`}
                            >
                              {isPaid ? "PAID" : "PENDING"}
                            </Badge>
                            {payment.is_custom && (
                              <Badge variant="outline" className="text-[10px] px-1.5 py-0 bg-violet-500/10 text-violet-600 border-violet-200">
                                Custom
                              </Badge>
                            )}
                          </div>
                          {isPaid && payment.paid_at && (
                            <p className="text-[11px] text-zinc-400 mt-1">
                              Paid on {format(new Date(payment.paid_at), "dd MMM yyyy")}
                              {payment.paid_notes && ` · ${payment.paid_notes}`}
                            </p>
                          )}
                        </div>
                      </div>
                      <div className="text-right">
                        <span className={`font-black ${isPaid ? "text-emerald-600" : "text-amber-600"}`}>
                          ₹{Number(payment.total_earnings || 0).toFixed(2)}
                        </span>
                        {payment.total_deliveries > 0 && (
                          <p className="text-[11px] text-zinc-400">
                            {payment.total_deliveries} deliveries
                          </p>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      {/* Recent Transactions / History */}
      <div>
        <h3 className="mb-3 flex items-center gap-2 px-1 text-sm font-bold uppercase tracking-wider text-zinc-400">
          <span className="h-3.5 w-1 rounded-full bg-[#e74c3c]" aria-hidden="true" />
          Recent Completed Deliveries
        </h3>

        {safeOrders.length === 0 ? (
          <div className="bg-zinc-50 border-2 border-dashed border-zinc-200 rounded-2xl p-8 text-center text-zinc-500 font-medium">
            No completed deliveries yet.
          </div>
        ) : (
          <div className="space-y-3">
            {safeOrders.slice(0, 10).map((order) => {
              // Purely presentational: a ₹0.00 payout is styled quietly (muted
              // icon + gray amount) so a run of zero-value deliveries doesn't
              // read as a wall of bold-green "earnings". Derived from the same
              // amount already being displayed — no data/logic change.
              const amount = Number(order.payout_amount || 0);
              const isPaidOut = amount > 0;

              return (
                <Card
                  key={order.id}
                  className="rounded-xl border border-zinc-100 shadow-sm transition-transform active:scale-[0.99]"
                >
                  <CardContent className="flex items-center justify-between p-4">
                    <div className="flex items-center gap-3">
                      <div
                        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${isPaidOut ? "bg-green-100 text-green-600" : "bg-zinc-100 text-zinc-400"}`}
                      >
                        <CheckCircle2 className="h-5 w-5" />
                      </div>
                      <div>
                        <p className="text-sm font-bold text-zinc-900">
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
                      <span
                        className={`font-black ${isPaidOut ? "text-green-600" : "text-zinc-400"}`}
                      >
                        {isPaidOut
                          ? `+₹${amount.toFixed(2)}`
                          : `₹${amount.toFixed(2)}`}
                      </span>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
