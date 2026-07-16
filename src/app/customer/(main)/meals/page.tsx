import { getCustomerSession } from "@/lib/customer/get-session";
import { createAdminClient } from "@/lib/supabase/admin";
import { redirect } from "next/navigation";
import { format, parseISO, differenceInCalendarDays } from "date-fns";
import Link from "next/link";
import {
  MapPin,
  CheckCircle2,
  ChevronRight,
  Package,
  Utensils,
  PauseCircle,
  Clock,
  TrendingUp,
  CalendarCheck,
} from "lucide-react";
import { Card, CardContent } from "@/shared/components/ui/card";
import { Button } from "@/shared/components/ui/button";
import { ShopOrdersTracker } from "@/shared/components/customer/shop-orders-tracker";
import { MealsHero } from "@/shared/components/customer/meals/MealsHero";
import { TransformationStories } from "@/shared/components/customer/meals/TransformationStories";
import {
  SubscriptionTimeline,
  type HistoryRow,
} from "@/shared/components/customer/meals/SubscriptionTimeline";
import { SectionCard } from "@/shared/components/customer/profile-ui/SectionCard";
import { RotatingFoodImage } from "@/shared/components/customer/dashboard/RotatingFoodImage";
import {
  MomentumStrip,
  type MomentumStat,
} from "@/shared/components/customer/dashboard/MomentumStrip";

export const revalidate = 0;

// Real ArogyaDiet meal photography — same assets/component the Dashboard
// uses for its Today's Focus rotation.
const MEAL_IMAGES = [
  "/food%20image1.jpg",
  "/food%20image2.jpg",
  "/food%20image3.jpg",
  "/food%20image4.jpg",
  "/food%20image5.jpg",
];

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

  // 1. Authenticate & Get Profile via unified session helper
  const { supabase, user, customerProfileId, error } = await getCustomerSession();
  if (error || !user) redirect("/login");
  if (!customerProfileId) redirect("/dashboard");

  // Track Shop Orders & Active Subscription in parallel (both depend only on customerProfileId)
  const [shopOrdersRes, activeSubRes] = await Promise.all([
    supabase
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
      .order("created_at", { ascending: false }),
    supabase
      .from("subscriptions")
      .select(
        "id, total_days, consumed_days, starts_on, effective_end_on, pause_credits_total, pause_credits_used",
      )
      .eq("customer_profile_id", customerProfileId)
      .eq("status", "ACTIVE")
      .single(),
  ]);

  const shopOrders = shopOrdersRes.data;
  const activeSub = activeSubRes.data;

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
  let historyData: HistoryRow[] = [];
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

  // --- Journey math (same derivation as the Dashboard's JourneyHeader, so
  // "Day X of Y" and "days nourished" mean the same thing on every customer
  // page) — all from real subscription fields, nothing invented. ---
  const journeyStart = activeSub?.starts_on ? parseISO(activeSub.starts_on) : null;
  const journeyEnd = activeSub?.effective_end_on
    ? parseISO(activeSub.effective_end_on)
    : null;
  const now = new Date();
  const totalJourneyDays = activeSub
    ? journeyStart && journeyEnd
      ? Math.max(1, differenceInCalendarDays(journeyEnd, journeyStart) + 1)
      : activeSub.total_days || 1
    : null;
  const rawJourneyDay = journeyStart
    ? differenceInCalendarDays(now, journeyStart) + 1
    : 1;
  const journeyDay =
    totalJourneyDays != null
      ? Math.max(1, Math.min(rawJourneyDay, totalJourneyDays))
      : null;
  const daysCompleted = journeyDay != null ? Math.max(0, journeyDay - 1) : 0;
  const pauseCreditsRemaining = activeSub
    ? Math.max(
        0,
        (activeSub.pause_credits_total ?? 0) - (activeSub.pause_credits_used ?? 0),
      )
    : 0;

  const momentumStats: MomentumStat[] = activeSub
    ? [
        {
          icon: CalendarCheck,
          value: daysCompleted,
          label: "days nourished",
          tone: "green",
        },
        {
          icon: Utensils,
          value: activeSub.total_days ?? totalJourneyDays ?? 0,
          label: "meals in your plan",
          tone: "coral",
        },
        {
          icon: PauseCircle,
          value: pauseCreditsRemaining,
          label: "pauses in reserve",
          tone: "amber",
        },
      ]
    : [];

  return (
    <div className="max-w-5xl mx-auto space-y-6 sm:space-y-8">
      <div className="flex justify-end">
        <ShopOrdersTracker shopOrders={shopOrders || []} />
      </div>

      <MealsHero
        dayCurrent={journeyDay}
        dayTotal={totalJourneyDays}
        mealsCompleted={activeSub ? daysCompleted : null}
      />

      {!activeSub ? (
        <Card className="border border-dashed border-slate-200 bg-white shadow-sm py-12 text-center">
          <p className="text-sm text-slate-500 font-medium">
            You don't have an active subscription right now.
          </p>
        </Card>
      ) : (
        <>
          {/* ========================================== */}
          {/* TODAY'S MEAL                              */}
          {/* ========================================== */}
          <section
            className="reveal-rise space-y-4"
            style={{ ["--reveal-delay" as string]: "550ms" }}
          >
            <h2 className="text-lg font-semibold text-slate-900 tracking-tight flex items-center gap-2">
              <Package className="h-5 w-5 text-primary" /> Today&apos;s Meal
            </h2>

            {todaysPreference?.is_paused ? (
              <Card className="border border-dashed border-slate-200 bg-slate-50/80 shadow-sm">
                <CardContent className="p-6 flex items-center gap-4">
                  <PauseCircle className="h-8 w-8 text-slate-400 shrink-0" />
                  <div>
                    <p className="font-semibold text-lg text-slate-700">
                      Resting today
                    </p>
                    <p className="text-sm text-slate-500">
                      Your delivery is paused for today. It'll resume automatically on schedule.
                    </p>
                  </div>
                </CardContent>
              </Card>
            ) : todaysOrder?.status === "DELIVERED" ? (
              <Card className="overflow-hidden rounded-3xl border border-emerald-200 bg-white shadow-sm">
                <div className="flex flex-col sm:flex-row">
                  <div className="relative h-44 w-full shrink-0 overflow-hidden sm:h-auto sm:min-h-[13rem] sm:w-2/5">
                    <RotatingFoodImage
                      images={MEAL_IMAGES}
                      alt="Today's freshly prepared meal"
                    />
                    <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/30 to-transparent" />
                  </div>
                  <div className="flex flex-1 flex-col justify-center gap-3 p-6 sm:p-7 bg-emerald-50/40">
                    <div className="flex items-center gap-3">
                      <div className="bg-emerald-100 p-2.5 rounded-full shrink-0">
                        <CheckCircle2 className="h-6 w-6 text-emerald-600" />
                      </div>
                      <p className="text-xs font-semibold uppercase tracking-wider text-emerald-700">
                        Congratulations
                      </p>
                    </div>
                    <h3 className="text-2xl font-semibold text-slate-900 tracking-tight">
                      Today&apos;s nutrition is ready
                    </h3>
                    <p className="text-sm text-slate-600 leading-relaxed">
                      Enjoy your freshly prepared meal — every healthy choice brings you closer to your goal.
                    </p>
                    {(() => {
                      const lines = buildAddonLinesFromDeliveryOrder(todaysOrder);
                      if (!lines.length) return null;
                      return (
                        <p className="text-xs text-slate-500">
                          📦 Includes: {formatAddonLines(lines)}
                        </p>
                      );
                    })()}
                  </div>
                </div>
              </Card>
            ) : todaysOrder?.status === "REACHING_TO_LOCATION" ||
              todaysOrder?.status === "OUT_FOR_DELIVERY" ? (
              <Card className="overflow-hidden rounded-3xl border border-blue-200 bg-white shadow-sm relative">
                <div className="absolute top-0 left-0 w-full h-1 bg-blue-500 animate-pulse z-10" />
                <div className="flex flex-col sm:flex-row">
                  <div className="relative h-40 w-full shrink-0 overflow-hidden sm:h-auto sm:min-h-[12rem] sm:w-2/5">
                    <RotatingFoodImage
                      images={MEAL_IMAGES}
                      alt="Today's freshly prepared meal"
                    />
                    <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/30 to-transparent" />
                  </div>
                  <div className="flex flex-1 flex-col justify-center gap-4 p-6 sm:p-7">
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
                      className="w-full sm:w-fit transition-all duration-200"
                    >
                      <Link href={`/tracking/${todaysOrder.id}`}>
                        See Rider Location
                        <ChevronRight className="ml-2 h-5 w-5" />
                      </Link>
                    </Button>
                  </div>
                </div>
              </Card>
            ) : todaysOrder ? (
              <Card className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
                <div className="flex flex-col sm:flex-row">
                  <div className="relative h-36 w-full shrink-0 overflow-hidden sm:h-auto sm:min-h-[10rem] sm:w-1/3">
                    <RotatingFoodImage
                      images={MEAL_IMAGES}
                      alt="Today's meal, being prepared"
                    />
                    <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/25 to-transparent" />
                  </div>
                  <div className="flex flex-1 items-center justify-between gap-4 p-6 flex-wrap">
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
                  </div>
                </div>
              </Card>
            ) : (
              <Card className="border border-dashed border-slate-200 bg-white shadow-sm py-12 text-center">
                <p className="text-sm text-slate-500 font-medium">
                  No delivery scheduled for today. Enjoy your day!
                </p>
              </Card>
            )}
          </section>

          {/* ========================================== */}
          {/* PROGRESS + REAL TRANSFORMATION           */}
          {/* ========================================== */}
          <div
            className="reveal-rise grid grid-cols-1 gap-4 sm:gap-5 lg:grid-cols-2"
            style={{ ["--reveal-delay" as string]: "900ms" }}
          >
            <SectionCard icon={TrendingUp} iconTone="green" title="Your Progress">
              <MomentumStrip
                stats={momentumStats}
                caption={`You've stayed nourished for ${daysCompleted} ${daysCompleted === 1 ? "day" : "days"} — every meal is a step forward.`}
              />
            </SectionCard>

            <TransformationStories />
          </div>

          {/* ========================================== */}
          {/* MY NUTRITION JOURNAL (HISTORY)            */}
          {/* ========================================== */}
          <section
            className="reveal-rise space-y-4"
            style={{ ["--reveal-delay" as string]: "1300ms" }}
          >
            <h2 className="text-lg font-semibold text-slate-900 tracking-tight flex items-center gap-2">
              <Utensils className="h-5 w-5 text-primary" /> My Nutrition Journal
            </h2>

            <SubscriptionTimeline
              historyData={historyData}
              currentPage={currentPage}
              pageSize={pageSize}
              totalPages={totalPages}
            />
          </section>
        </>
      )}
    </div>
  );
}
