import { getCustomerSession } from "@/lib/customer/get-session";
import { redirect } from "next/navigation";
import { format, parseISO, differenceInCalendarDays } from "date-fns";
import { Package } from "lucide-react";
import { Card } from "@/shared/components/ui/card";
import { IconChip } from "@/shared/components/customer/profile-ui/IconChip";
import { ShopOrdersTracker } from "@/shared/components/customer/shop-orders-tracker";
import { MealsHero } from "@/shared/components/customer/meals/MealsHero";
import { TodayMealJourneyCard } from "@/shared/components/customer/meals/TodayMealJourneyCard";
import { TransformationStories } from "@/shared/components/customer/meals/TransformationStories";
import { MealHistoryHeader } from "@/shared/components/customer/meals/MealHistoryHeader";
import {
  SubscriptionTimeline,
  type HistoryRow,
} from "@/shared/components/customer/meals/SubscriptionTimeline";

export const revalidate = 0;

type AddonProductLine = {
  name: string;
  quantity: number;
};

function buildAddonLinesFromDeliveryOrder(
  order: { addon_orders?: unknown } | null | undefined,
): AddonProductLine[] {
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

export default async function MyMealsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const { page } = await searchParams;
  const pageSize = 10;

  // 1. Authenticate & Get Profile via unified session helper
  const { supabase, user, customerProfileId, error } =
    await getCustomerSession();
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

  // --- Journey math (same derivation as the Dashboard's JourneyHeader, so
  // "Day X of Y" means the same thing on every customer page) — all from
  // real subscription fields, nothing invented. Computed early (rather than
  // after the history fetch) because the default history page below needs
  // to know which day of the journey "today" is. ---
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

  // Meal History should open on whichever page contains today's entry by
  // default (not always page 1) — only an explicit ?page= in the URL (from
  // clicking Previous/Next) should override that. `journeyDay` is already
  // clamped to the subscription's real day range, so the page it maps to
  // always lands inside a valid page of the same daily-preference rows the
  // history query below fetches.
  const defaultHistoryPage =
    activeSub && journeyDay != null ? Math.floor((journeyDay - 1) / pageSize) + 1 : 1;
  const currentPage = page ? parseInt(page, 10) : defaultHistoryPage;

  // 2. SECTION 1: Fetch Today's Order & Preference
  type TodaysOrder = {
    id: string;
    status: string | null;
    batch_id: string | null;
    route_sequence: number | null;
    addon_orders?: unknown;
  };
  let todaysOrder: TodaysOrder | null = null;
  let todaysPreference: { is_paused: boolean } | null = null;

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

  // 3. SECTION 2: Fetch Paginated History
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
      preferences?.map((p) => ({
        date: p.preference_date,
        is_paused: p.is_paused,
        meal_name: Array.isArray(p.meal_categories)
          ? p.meal_categories[0]?.name
          : (p.meal_categories as { name?: string } | null)?.name,
        status: orderStatusMap[p.preference_date] || "PENDING",
        addons: orderAddonsMap[p.preference_date] || [],
      })) || [];
  }

  const totalPages = Math.ceil(totalCount / pageSize);

  return (
    <div className="max-w-5xl mx-auto space-y-6 sm:space-y-8">
      <div className="flex justify-end">
        <ShopOrdersTracker shopOrders={shopOrders || []} />
      </div>

      {/* ========================================== */}
      {/* TODAY'S STORY OPENS                        */}
      {/* ========================================== */}
      <MealsHero dayCurrent={journeyDay} dayTotal={totalJourneyDays} />

      {!activeSub ? (
        <Card className="border border-dashed border-slate-200 bg-white shadow-sm py-12 text-center">
          <p className="text-sm text-slate-500 font-medium">
            You don&apos;t have an active subscription right now.
          </p>
        </Card>
      ) : (
        <>
          {/* ========================================== */}
          {/* TODAY'S MEAL JOURNEY                       */}
          {/* ========================================== */}
          <section className="space-y-4">
            <div className="flex items-center gap-3">
              <IconChip icon={Package} tone="coral" size="lg" />
              <h2 className="text-lg font-semibold text-slate-900 tracking-tight sm:text-xl">
                Today&apos;s Meal Journey
              </h2>
            </div>

            <TodayMealJourneyCard
              isPaused={Boolean(todaysPreference?.is_paused)}
              status={todaysOrder?.status ?? null}
              orderId={todaysOrder?.id ?? null}
              addons={buildAddonLinesFromDeliveryOrder(todaysOrder)}
            />
          </section>

          {/* ========================================== */}
          {/* TRANSFORMATION STORY                       */}
          {/* ========================================== */}
          <TransformationStories />

          {/* ========================================== */}
          {/* MEAL HISTORY                               */}
          {/* ========================================== */}
          <section
            className="reveal-rise space-y-4"
            style={{ ["--reveal-delay" as string]: "1300ms" }}
          >
            <MealHistoryHeader
              dayCurrent={journeyDay}
              dayTotal={totalJourneyDays}
              pauseCreditsUsed={activeSub?.pause_credits_used}
              pauseCreditsTotal={activeSub?.pause_credits_total}
            />

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
