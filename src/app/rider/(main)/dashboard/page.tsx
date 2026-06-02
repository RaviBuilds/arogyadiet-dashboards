import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { redirect } from "next/navigation";
import { format } from "date-fns";
import {
  getRiderOperationalDeliveryDate,
  getRiderOverviewHeading,
  isRiderEveningPreviewIST,
} from "@/lib/dates/ist";
import {
  getLast3PaidMonthsWindow,
  yearMonthKey,
} from "@/lib/delivery/riderPaidMonthsWindow";
import {
  CheckCircle2,
  Clock,
  IndianRupee,
  Loader2,
  MapPin,
  ArrowRight,
  PowerOff,
} from "lucide-react";
import { RiderStatusToggle } from "@/modules/rider/components/rider-status-toggle";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/shared/components/ui/card";
import Link from "next/link";

export const revalidate = 0;

type CategoryDeliveryStats = Record<
  string,
  { assigned: number; delivered: number }
>;

function aggregateByMealCategory(
  orders: Array<{
    status: string;
    meal_category: { name?: string } | { name?: string }[] | null;
  }>,
): CategoryDeliveryStats {
  return orders.reduce<CategoryDeliveryStats>((acc, order) => {
    const mealCat = Array.isArray(order.meal_category)
      ? order.meal_category[0]
      : order.meal_category;
    const name = mealCat?.name?.trim() || "Unknown Meal";
    if (!acc[name]) acc[name] = { assigned: 0, delivered: 0 };
    acc[name].assigned += 1;
    if (order.status === "DELIVERED") acc[name].delivered += 1;
    return acc;
  }, {});
}

export default async function RiderDashboard() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: appUser, error: appUserError } = await supabase
    .from("users")
    .select("id, full_name")
    .eq("auth_user_id", user.id)
    .single();

  if (appUserError || !appUser) {
    return (
      <RiderSetupError
        title="Rider account not readable"
        message={
          appUserError?.message ||
          "Your login is valid, but your rider user row is not readable."
        }
      />
    );
  }

  // Fetch Rider Profile and operational status
  const { data: riderProfile, error: riderProfileError } = await supabase
    .from("rider_profiles")
    .select("id, is_online")
    .eq("user_id", appUser.id)
    .single();

  if (riderProfileError || !riderProfile) {
    return (
      <RiderSetupError
        title="Rider profile not readable"
        message={
          riderProfileError?.message ||
          "Your rider profile exists in the app flow, but it is not readable with the current RLS policies."
        }
      />
    );
  }

  const paidMonthsWindow = getLast3PaidMonthsWindow();
  const paidMonthsWindowKeys = new Set(paidMonthsWindow.map(yearMonthKey));

  const adminClient = createAdminClient();
  const { data: paidSummaries } = await adminClient
    .from("rider_monthly_summaries")
    .select("year, month, net_payable")
    .eq("rider_id", riderProfile.id)
    .eq("status", "PAID");

  const last3MonthsPaidTotal = (paidSummaries ?? [])
    .filter((row) =>
      paidMonthsWindowKeys.has(
        yearMonthKey({ year: row.year, month: row.month }),
      ),
    )
    .reduce((sum, row) => sum + Number(row.net_payable ?? 0), 0);
  const isOnDuty = Boolean(riderProfile.is_online);
  const operationalDate = getRiderOperationalDeliveryDate();
  const overviewHeading = getRiderOverviewHeading();
  const isEveningPreview = isRiderEveningPreviewIST();

  // Fetch today's deliveries only after the rider starts duty
  const { data: todayOrders } = isOnDuty
    ? await supabase
        .from("delivery_orders")
        .select(
          `
          id,
          status,
          payout_amount,
          meal_category:meal_categories ( name )
        `,
        )
        .eq("assigned_rider_id", riderProfile.id)
        .eq("delivery_date", operationalDate)
    : { data: [] };

  const orders = todayOrders || [];

  const assigned = orders.filter((o) =>
    ["ORDER_CREATED", "ASSIGNED"].includes(o.status),
  ).length;
  const picked = orders.filter((o) =>
    ["OUT_FOR_DELIVERY", "REACHING_TO_LOCATION"].includes(o.status),
  ).length;
  const delivered = orders.filter((o) => o.status === "DELIVERED").length;

  const pendingDrops = assigned + picked;
  const estimatedPayout = orders.reduce(
    (acc, curr) => acc + Number(curr.payout_amount || 0),
    0,
  );
  const itemsByCategory = aggregateByMealCategory(orders);
  const totalAssigned = orders.length;

  return (
    <div className="p-4 space-y-6 animate-in fade-in slide-in-from-bottom-4">
      <div className="pt-4 pb-2">
        <h1 className="text-2xl font-black text-zinc-900 flex items-center gap-2">
          Hey, {appUser.full_name.split(" ")[0]} 👋
        </h1>
        <p className="text-zinc-500 font-medium mt-1">
          {format(new Date(), "EEEE, do MMM")}
        </p>
      </div>

      <RiderStatusToggle initialStatus={isOnDuty} />

      {!isOnDuty && (
        <Card className="border-dashed border-2 border-zinc-200 shadow-none bg-white rounded-2xl">
          <CardContent className="p-6 text-center">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-zinc-100 text-zinc-500">
              <PowerOff className="h-7 w-7" />
            </div>
            <h2 className="text-xl font-black text-zinc-900">
              You are offline
            </h2>
            <p className="mt-2 text-sm font-medium text-zinc-500">
              Toggle On Duty to sync {isEveningPreview ? "tomorrow's" : "today's"}{" "}
              assigned route.
            </p>
          </CardContent>
        </Card>
      )}

      {isOnDuty && (
        <div>
          <h3 className="text-sm font-bold text-zinc-400 uppercase tracking-wider mb-3 px-1">
            {overviewHeading}
          </h3>
          <div className="grid grid-cols-2 gap-4 mb-4">
            <Card className="border-none shadow-sm bg-white rounded-2xl">
              <CardContent className="flex flex-col items-center justify-center p-4 text-center">
                <div className="mb-3 rounded-full bg-orange-50 p-3 text-orange-500">
                  <Clock className="h-6 w-6" />
                </div>
                <p className="text-2xl font-black text-zinc-900">
                  {pendingDrops}
                </p>
                <p className="mt-1 text-xs font-bold uppercase tracking-wider text-zinc-400">
                  Pending Drops
                </p>
                <span className="mt-2 rounded-full bg-zinc-50 px-2 py-1 text-[10px] text-zinc-500">
                  {totalAssigned} Assigned • {delivered} Delivered
                </span>
              </CardContent>
            </Card>

            <Card className="border-none shadow-sm bg-white rounded-2xl">
              <CardContent className="flex flex-col items-center justify-center p-4 text-center">
                <div className="mb-3 rounded-full bg-green-50 p-3 text-green-600">
                  <IndianRupee className="h-6 w-6" />
                </div>
                <p className="text-2xl font-black text-green-600">
                  ₹{estimatedPayout.toFixed(2)}
                </p>
                <p className="mt-1 text-xs font-bold uppercase tracking-wider text-zinc-400">
                  Est. Payout
                </p>
                <span className="mt-2 rounded-full bg-zinc-50 px-2 py-1 text-[10px] text-zinc-500">
                  Last 3 Months: ₹{last3MonthsPaidTotal.toFixed(2)} Paid
                </span>
              </CardContent>
            </Card>
          </div>

          <Card className="mt-4 border-none bg-white shadow-sm rounded-2xl">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold uppercase text-muted-foreground">
                Items to Deliver
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 pt-0">
              {Object.entries(itemsByCategory).length === 0 ? (
                <p className="text-sm font-medium text-zinc-500">
                  No items assigned for this shift.
                </p>
              ) : (
                Object.entries(itemsByCategory)
                  .sort(([a], [b]) => a.localeCompare(b))
                  .map(([categoryName, stats]) => (
                    <div key={categoryName} className="flex items-center">
                      {stats.delivered < stats.assigned ? (
                        <Loader2 className="mr-2 h-4 w-4 shrink-0 animate-spin text-muted-foreground" />
                      ) : stats.delivered === stats.assigned &&
                        stats.assigned > 0 ? (
                        <CheckCircle2 className="mr-2 h-4 w-4 shrink-0 text-green-600" />
                      ) : null}
                      <p className="text-sm font-medium text-zinc-800">
                        {categoryName} ({stats.assigned} assigned /{" "}
                        {stats.delivered} delivered)
                      </p>
                    </div>
                  ))
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {isOnDuty && (
        <div className="mt-8">
          <Link
            href="/route"
            className="block w-full bg-zinc-900 hover:bg-zinc-800 text-white rounded-2xl p-5 shadow-lg transition-transform"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="bg-white/20 p-2.5 rounded-full">
                  <MapPin className="h-6 w-6 text-white" />
                </div>
                <div>
                  <p className="font-bold text-lg leading-tight">Start Route</p>
                  <p className="text-sm text-zinc-400 font-medium mt-0.5">
                    Head to Central Kitchen
                  </p>
                </div>
              </div>
              <ArrowRight className="h-6 w-6 text-zinc-400" />
            </div>
          </Link>
        </div>
      )}
    </div>
  );
}

function RiderSetupError({
  title,
  message,
}: {
  title: string;
  message: string;
}) {
  return (
    <div className="p-4 space-y-6 animate-in fade-in slide-in-from-bottom-4">
      <Card className="border-dashed border-2 border-red-200 shadow-none bg-white rounded-2xl">
        <CardContent className="p-6 text-center">
          <h1 className="text-xl font-black text-red-700">{title}</h1>
          <p className="mt-2 text-sm font-medium text-zinc-600">{message}</p>
          <p className="mt-4 text-xs font-medium text-zinc-400">
            This usually means an RLS policy is blocking the rider portal from
            reading the required profile rows.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}