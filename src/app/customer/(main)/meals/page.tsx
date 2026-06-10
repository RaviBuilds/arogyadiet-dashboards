import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { redirect } from "next/navigation";
import { format, parseISO } from "date-fns";
import Link from "next/link";
import {
  MapPin,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Package,
  Utensils,
  PauseCircle,
  Clock,
} from "lucide-react";
import { Card, CardContent } from "@/shared/components/ui/card";
import { Button } from "@/shared/components/ui/button";
import { Badge } from "@/shared/components/ui/badge";
import { ShopOrdersTracker } from "@/shared/components/customer/shop-orders-tracker";

export const revalidate = 0;

type AddonProductLine = {
  name: string;
  quantity: number;
};

function buildAddonLinesFromDeliveryOrder(order: any): AddonProductLine[] {
  const addonOrders = order?.addon_orders;
  if (!Array.isArray(addonOrders) || addonOrders.length === 0) return [];

  const lines: AddonProductLine[] = [];

  for (const addonOrder of addonOrders) {
    const items = addonOrder?.addon_order_items;
    if (!Array.isArray(items)) continue;

    for (const item of items) {
      const name = item?.products?.name;
      const quantity = item?.quantity;
      if (typeof name !== "string" || !name) continue;
      if (typeof quantity !== "number") continue;
      lines.push({ name, quantity });
    }
  }

  return lines;
}

function formatAddonLines(lines: AddonProductLine[]) {
  if (!lines.length) return "";
  return lines.map((l) => `${l.name} (x${l.quantity})`).join(", ");
}

export default async function MyMealsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const { page } = await searchParams;
  const currentPage = parseInt(page || "1", 10);
  const pageSize = 10;

  const supabase = await createClient();

  // 1. Authenticate & Get Profile
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: appUser } = await supabase
    .from("users")
    .select("id")
    .eq("auth_user_id", user.id)
    .single();

  const { data: profile } = await supabase
    .from("customer_profiles")
    .select("id")
    .eq("user_id", appUser?.id)
    .single();

  if (!profile) redirect("/dashboard");

  const customerProfileId = profile.id;

  // Track Shop Orders (Standalone Addons)
  const { data: shopOrders } = await supabase
    .from("addon_orders")
    .select(
      `
  id, 
  created_at, 
  total_amount, 
  status,
  delivery_order_id,
  delivery_orders (delivery_date, status),
  addon_order_items ( quantity, unit_price, products (name) )
`,
    )
    .eq("customer_profile_id", customerProfileId)
    .eq("status", "PAID")
    .order("created_at", { ascending: false });

  // 2. Fetch Active Subscription
  const { data: activeSub } = await supabase
    .from("subscriptions")
    .select("id, total_days, consumed_days, starts_on")
    .eq("customer_profile_id", customerProfileId)
    .eq("status", "ACTIVE")
    .single();

  const todayStr = format(new Date(), "yyyy-MM-dd");

  // 3. SECTION 1: Fetch Today's Order & Preference
  let todaysOrder = null;
  let todaysPreference = null;

  if (activeSub) {
    const [orderRes, prefRes] = await Promise.all([
      supabase
        .from("delivery_orders")
        .select(
          "id, status, batch_id, route_sequence, addon_orders(*, addon_order_items(*, products(name)))",
        )
        .eq("customer_profile_id", customerProfileId)
        .eq("delivery_date", todayStr)
        .maybeSingle(),
      supabase
        .from("subscription_daily_preferences")
        .select("is_paused")
        .eq("subscription_id", activeSub.id)
        .eq("preference_date", todayStr)
        .maybeSingle(),
    ]);
    todaysOrder = orderRes.data;
    todaysPreference = prefRes.data;
  }

  // Live Queue Tracker (secure, service-role): how many pending drops are ahead of the customer.
  let stopsAway = 0;
  const todaysStatus = todaysOrder?.status as string | undefined;
  const shouldComputeStopsAway =
    todaysStatus === "OUT_FOR_DELIVERY" ||
    todaysStatus === "REACHING_TO_LOCATION";

  if (
    shouldComputeStopsAway &&
    todaysOrder?.batch_id &&
    typeof todaysOrder?.route_sequence === "number"
  ) {
    const supabaseAdmin = createAdminClient();
    const { count } = await supabaseAdmin
      .from("delivery_orders")
      .select("id", { count: "exact", head: true })
      .eq("batch_id", todaysOrder.batch_id)
      .lt("route_sequence", todaysOrder.route_sequence)
      .not("status", "in", "(DELIVERED,FAILED)");

    stopsAway = count || 0;
  }

  // 4. SECTION 2: Fetch Paginated History
  let historyData: any[] = [];
  let totalCount = 0;

  if (activeSub) {
    const from = (currentPage - 1) * pageSize;
    const to = from + pageSize - 1;

    // Fetch the daily rows (includes all days + paused days)
    const { data: preferences, count } = await supabase
      .from("subscription_daily_preferences")
      .select("preference_date, is_paused, meal_categories(name)", {
        count: "exact",
      })
      .eq("subscription_id", activeSub.id)
      .order("preference_date", { ascending: true }) // chronological from day 1
      .range(from, to);

    totalCount = count || 0;

    // Fetch delivery statuses for this specific paginated window
    const dates = preferences?.map((p) => p.preference_date) || [];
    const { data: orders } = await supabase
      .from("delivery_orders")
      .select(
        "delivery_date, status, addon_orders(*, addon_order_items(*, products(name)))",
      )
      .eq("customer_profile_id", customerProfileId)
      .in("delivery_date", dates);

    // Map them together
    const orderStatusMap: Record<string, string> = {};
    const orderAddonsMap: Record<string, AddonProductLine[]> = {};
    orders?.forEach((o) => {
      orderStatusMap[o.delivery_date] = o.status;
      orderAddonsMap[o.delivery_date] = buildAddonLinesFromDeliveryOrder(o);
    });

    historyData =
      preferences?.map((p: any) => ({
        date: p.preference_date,
        is_paused: p.is_paused,
        meal_name: Array.isArray(p.meal_categories)
          ? p.meal_categories[0]?.name
          : p.meal_categories?.name,
        status: orderStatusMap[p.preference_date] || "PENDING",
        addons: orderAddonsMap[p.preference_date] || [],
      })) || [];
  }

  const totalPages = Math.ceil(totalCount / pageSize);

  // Format Helper
  const formatStatus = (status: string) => status.replaceAll("_", " ");

  return (
    <div className="max-w-5xl mx-auto space-y-8 animate-in fade-in slide-in-from-bottom-4">
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 sm:gap-6">
        <div>
          <h1 className="text-2xl sm:text-3xl font-semibold text-slate-900 tracking-tight">
            My Meals
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Track today's delivery and view your entire subscription history.
          </p>
        </div>

        <div className="shrink-0 self-start sm:self-auto">
          <ShopOrdersTracker shopOrders={shopOrders || []} />
        </div>
      </div>

      {!activeSub ? (
        <Card className="border border-dashed border-slate-200 bg-white shadow-sm py-12 text-center">
          <p className="text-sm text-slate-500 font-medium">
            You don't have an active subscription right now.
          </p>
        </Card>
      ) : (
        <>
          {/* ========================================== */}
          {/* SECTION 1: TODAY'S MEAL                  */}
          {/* ========================================== */}
          <section className="space-y-6">
            <h2 className="text-lg font-semibold text-slate-900 tracking-tight flex items-center gap-2">
              <Package className="h-5 w-5 text-primary" /> Today's Meal
            </h2>

            {todaysPreference?.is_paused ? (
              <Card className="border border-dashed border-slate-200 bg-slate-50/80 shadow-sm">
                <CardContent className="p-6 flex items-center gap-4">
                  <PauseCircle className="h-8 w-8 text-slate-400 shrink-0" />
                  <div>
                    <p className="font-semibold text-lg text-slate-700">
                      Meal Paused
                    </p>
                    <p className="text-sm text-slate-500">
                      You have paused your delivery for today.
                    </p>
                  </div>
                </CardContent>
              </Card>
            ) : todaysOrder?.status === "DELIVERED" ? (
              <Card className="border border-emerald-200 bg-emerald-50/50 shadow-sm">
                <CardContent className="p-6 text-center flex flex-col items-center">
                  <div className="bg-emerald-100 p-4 rounded-full mb-4">
                    <CheckCircle2 className="h-10 w-10 text-emerald-600" />
                  </div>
                  <h3 className="text-2xl font-semibold text-emerald-900 tracking-tight">
                    Today's meal delivered!
                  </h3>
                  <p className="text-sm text-emerald-700 mt-2">
                    Eat nutrition-rich food and be healthy. Enjoy your meal!
                  </p>
                  {(() => {
                    const lines = buildAddonLinesFromDeliveryOrder(todaysOrder);
                    if (!lines.length) return null;
                    return (
                      <p className="text-sm text-slate-500 mt-3">
                        📦 Includes: {formatAddonLines(lines)}
                      </p>
                    );
                  })()}
                </CardContent>
              </Card>
            ) : todaysOrder?.status === "REACHING_TO_LOCATION" ||
              todaysOrder?.status === "OUT_FOR_DELIVERY" ? (
              <Card className="border border-blue-200 bg-white shadow-sm overflow-hidden relative">
                <div className="absolute top-0 left-0 w-full h-1 bg-blue-500 animate-pulse" />
                <CardContent className="p-6 flex flex-col md:flex-row justify-between items-center gap-6">
                  <div className="flex items-center gap-4">
                    <div className="bg-blue-100 p-4 rounded-full shrink-0">
                      <MapPin className="h-8 w-8 text-blue-600" />
                    </div>
                    <div>
                      <h3 className="text-xl font-semibold text-slate-900 tracking-tight">
                        {todaysOrder?.status === "REACHING_TO_LOCATION"
                          ? "Rider is arriving"
                          : "Delivery in progress"}
                      </h3>

                      {todaysOrder?.status === "REACHING_TO_LOCATION" ? (
                        <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
                          <p className="text-sm font-semibold text-amber-900">
                            Get ready to collect your package. Rider is arriving
                            at your location.
                          </p>
                        </div>
                      ) : null}

                      {todaysOrder?.status === "OUT_FOR_DELIVERY" ? (
                        <p className="text-sm text-slate-500 mt-1">
                          Rider is currently out for delivery.
                        </p>
                      ) : null}

                      {(() => {
                        const lines =
                          buildAddonLinesFromDeliveryOrder(todaysOrder);
                        if (!lines.length) return null;
                        return (
                          <p className="text-xs text-slate-500 mt-2">
                            📦 Includes: {formatAddonLines(lines)}
                          </p>
                        );
                      })()}
                    </div>
                  </div>
                  <Button
                    asChild
                    size="lg"
                    className="w-full md:w-auto transition-all duration-200"
                  >
                    {/* Links to the Tracking Component we will build next! */}
                    <Link href={`/tracking/${todaysOrder.id}`}>
                      See Rider Location{" "}
                      <ChevronRight className="ml-2 h-5 w-5" />
                    </Link>
                  </Button>
                </CardContent>
              </Card>
            ) : todaysOrder ? (
              <Card className="border border-slate-200 bg-white shadow-sm">
                <CardContent className="p-6 flex items-center justify-between gap-4">
                  <div className="flex items-center gap-4">
                    <div className="bg-orange-50 p-3 rounded-full shrink-0">
                      <Utensils className="h-6 w-6 text-orange-600" />
                    </div>
                    <div>
                      <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">
                        Current Status
                      </p>
                      <p className="text-lg font-semibold text-slate-900 capitalize">
                        {formatStatus(todaysOrder.status)}
                      </p>
                      {(() => {
                        const lines =
                          buildAddonLinesFromDeliveryOrder(todaysOrder);
                        if (!lines.length) return null;
                        return (
                          <p className="text-xs text-slate-500 mt-1">
                            📦 Includes: {formatAddonLines(lines)}
                          </p>
                        );
                      })()}
                    </div>
                  </div>
                  <div className="text-sm text-slate-500 flex items-center gap-2 shrink-0">
                    <Clock className="h-4 w-4" /> Awaiting Dispatch
                  </div>
                </CardContent>
              </Card>
            ) : (
              <Card className="border border-dashed border-slate-200 bg-white shadow-sm py-12 text-center">
                <p className="text-sm text-slate-500 font-medium">
                  No delivery scheduled for today.
                </p>
              </Card>
            )}
          </section>

          {/* ========================================== */}
          {/* SECTION 2: DAY-WISE HISTORY (PAGINATED)  */}
          {/* ========================================== */}
          <section className="space-y-6 pt-2">
            <h2 className="text-lg font-semibold text-slate-900 tracking-tight flex items-center gap-2">
              <Utensils className="h-5 w-5 text-primary" /> Subscription History
            </h2>

            <Card className="border border-slate-200 bg-white shadow-sm overflow-hidden">
              <div className="hidden md:grid grid-cols-4 bg-slate-50/50 border-b border-slate-100 px-6 py-4 text-xs font-medium text-slate-500 uppercase tracking-wider">
                <div>Date</div>
                <div>Meal/Action</div>
                <div>Status</div>
                <div className="text-right">Day #</div>
              </div>

              <div className="divide-y divide-slate-100">
                {historyData.map((row, idx) => {
                  const absoluteDayNumber =
                    (currentPage - 1) * pageSize + idx + 1;
                  const dateObj = parseISO(row.date);

                  return (
                    <div
                      key={idx}
                      className="px-4 md:px-6 py-4 md:py-5 grid grid-cols-1 md:grid-cols-4 items-center gap-2 md:gap-0 hover:bg-slate-50 transition-colors duration-200"
                    >
                      {/* Date */}
                      <div className="font-medium text-slate-900">
                        {format(dateObj, "MMM do, yyyy")}
                        <span className="md:hidden text-slate-400 text-xs ml-2">
                          (Day {absoluteDayNumber})
                        </span>
                      </div>

                      {/* Meal Type / Paused */}
                      <div>
                        {row.is_paused ? (
                          <Badge
                            variant="outline"
                            className="rounded-full bg-slate-100 text-slate-600 border-slate-200 uppercase"
                          >
                            <PauseCircle className="h-3 w-3" /> Paused
                          </Badge>
                        ) : (
                          <div>
                            <Badge
                              variant="outline"
                              className="rounded-full bg-orange-50 text-orange-700 border-orange-200 uppercase"
                            >
                              {row.meal_name || "Meal"}
                            </Badge>
                            {Array.isArray(row.addons) &&
                              row.addons.length > 0 && (
                                <div className="text-xs text-slate-500 mt-1 space-y-0.5">
                                  {row.addons.map(
                                    (a: AddonProductLine, i: number) => (
                                      <div key={`${a.name}-${i}`}>
                                        + {a.name} (x{a.quantity})
                                      </div>
                                    ),
                                  )}
                                </div>
                              )}
                          </div>
                        )}
                      </div>

                      {/* Execution Status */}
                      <div>
                        {row.is_paused ? (
                          <span className="text-slate-400 text-sm italic">
                            -
                          </span>
                        ) : row.status === "DELIVERED" ? (
                          <Badge
                            variant="outline"
                            className="rounded-full bg-emerald-50 text-emerald-700 border-emerald-200"
                          >
                            <CheckCircle2 className="h-3.5 w-3.5" /> Delivered
                          </Badge>
                        ) : row.status === "PENDING" &&
                          new Date(row.date) > new Date() ? (
                          <Badge
                            variant="outline"
                            className="rounded-full bg-slate-50 text-slate-500 border-slate-200"
                          >
                            Upcoming
                          </Badge>
                        ) : (
                          <Badge
                            variant="outline"
                            className="rounded-full bg-blue-50 text-blue-700 border-blue-200 capitalize"
                          >
                            {formatStatus(row.status)}
                          </Badge>
                        )}
                      </div>

                      {/* Day Number (Desktop) */}
                      <div className="hidden md:block text-right font-mono text-sm text-slate-400">
                        {absoluteDayNumber}
                      </div>
                    </div>
                  );
                })}

                {historyData.length === 0 && (
                  <div className="p-10 text-center text-sm text-slate-500">
                    No history found.
                  </div>
                )}
              </div>

              {/* PAGINATION CONTROLS */}
              {totalPages > 1 && (
                <div className="border-t border-slate-100 bg-slate-50/50 px-6 py-4 flex items-center justify-between">
                  <Button
                    variant="outline"
                    disabled={currentPage <= 1}
                    asChild={currentPage > 1}
                    className="transition-all duration-200"
                  >
                    {currentPage > 1 ? (
                      <Link href={`/meals?page=${currentPage - 1}`}>
                        <ChevronLeft className="h-4 w-4 mr-2" /> Previous
                      </Link>
                    ) : (
                      <span>
                        <ChevronLeft className="h-4 w-4 mr-2" /> Previous
                      </span>
                    )}
                  </Button>

                  <span className="text-sm font-medium text-slate-500 transition-all duration-200">
                    Page {currentPage} of {totalPages}
                  </span>

                  <Button
                    variant="outline"
                    disabled={currentPage >= totalPages}
                    asChild={currentPage < totalPages}
                    className="transition-all duration-200"
                  >
                    {currentPage < totalPages ? (
                      <Link href={`/meals?page=${currentPage + 1}`}>
                        Next <ChevronRight className="h-4 w-4 ml-2" />
                      </Link>
                    ) : (
                      <span>
                        Next <ChevronRight className="h-4 w-4 ml-2" />
                      </span>
                    )}
                  </Button>
                </div>
              )}
            </Card>
          </section>
        </>
      )}
    </div>
  );
}
