import { createClient } from "@/lib/supabase/server";
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
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/shared/components/ui/card";
import { Button } from "@/shared/components/ui/button";
import { cn } from "@/lib/utils";

export const revalidate = 0;

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

  // 2. Fetch Active Subscription
  const { data: activeSub } = await supabase
    .from("subscriptions")
    .select("id, total_days, consumed_days, starts_on")
    .eq("customer_profile_id", profile.id)
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
        .select("id, status")
        .eq("customer_profile_id", profile.id)
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
      .select("delivery_date, status")
      .eq("customer_profile_id", profile.id)
      .in("delivery_date", dates);

    // Map them together
    const orderStatusMap: Record<string, string> = {};
    orders?.forEach((o) => {
      orderStatusMap[o.delivery_date] = o.status;
    });

    historyData =
      preferences?.map((p:any) => ({
        date: p.preference_date,
        is_paused: p.is_paused,
        meal_name: Array.isArray(p.meal_categories)
          ? p.meal_categories[0]?.name
          : p.meal_categories?.name,
        status: orderStatusMap[p.preference_date] || "PENDING",
      })) || [];
  }

  const totalPages = Math.ceil(totalCount / pageSize);

  // Format Helper
  const formatStatus = (status: string) => status.replaceAll("_", " ");

  return (
    <div className="max-w-5xl mx-auto space-y-8 animate-in fade-in slide-in-from-bottom-4">
      <div>
        <h1 className="text-3xl font-bold text-zinc-900">My Meals</h1>
        <p className="text-muted-foreground mt-1">
          Track today's delivery and view your entire subscription history.
        </p>
      </div>

      {!activeSub ? (
        <Card className="border-dashed border-2 bg-zinc-50/50 py-10 text-center">
          <p className="text-zinc-500 font-medium">
            You don't have an active subscription right now.
          </p>
        </Card>
      ) : (
        <>
          {/* ========================================== */}
          {/* SECTION 1: TODAY'S MEAL                  */}
          {/* ========================================== */}
          <section className="space-y-4">
            <h2 className="text-xl font-bold text-zinc-900 flex items-center gap-2">
              <Package className="h-5 w-5 text-primary" /> Today's Meal
            </h2>

            {todaysPreference?.is_paused ? (
              <Card className="border-none shadow-sm bg-zinc-50">
                <CardContent className="p-6 flex items-center gap-4 text-zinc-500">
                  <PauseCircle className="h-8 w-8" />
                  <div>
                    <p className="font-bold text-lg text-zinc-700">
                      Meal Paused
                    </p>
                    <p className="text-sm">
                      You have paused your delivery for today.
                    </p>
                  </div>
                </CardContent>
              </Card>
            ) : todaysOrder?.status === "DELIVERED" ? (
              <Card className="border-none shadow-md bg-green-50 border border-green-200">
                <CardContent className="p-8 text-center flex flex-col items-center">
                  <div className="bg-green-100 p-4 rounded-full mb-4">
                    <CheckCircle2 className="h-10 w-10 text-green-600" />
                  </div>
                  <h3 className="text-2xl font-black text-green-900">
                    Today's meal delivered!
                  </h3>
                  <p className="text-green-700 mt-2 font-medium">
                    Eat nutrition-rich food and be healthy. Enjoy your meal!
                  </p>
                </CardContent>
              </Card>
            ) : todaysOrder?.status === "ON_THE_WAY" ? (
              <Card className="border-none shadow-md bg-white border-2 border-blue-500 overflow-hidden relative">
                <div className="absolute top-0 left-0 w-full h-1 bg-blue-500 animate-pulse" />
                <CardContent className="p-6 md:p-8 flex flex-col md:flex-row justify-between items-center gap-6">
                  <div className="flex items-center gap-4">
                    <div className="bg-blue-100 p-4 rounded-full">
                      <MapPin className="h-8 w-8 text-blue-600" />
                    </div>
                    <div>
                      <h3 className="text-xl font-black text-zinc-900">
                        Rider is on the way!
                      </h3>
                      <p className="text-zinc-500 mt-1">
                        Your meal is picked up and out for delivery.
                      </p>
                    </div>
                  </div>
                  <Button
                    asChild
                    size="lg"
                    className="bg-blue-600 hover:bg-blue-700 text-white w-full md:w-auto h-14 rounded-xl text-lg shadow-lg shadow-blue-200"
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
              <Card className="border-none shadow-sm bg-white">
                <CardContent className="p-6 flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className="bg-orange-50 p-3 rounded-full">
                      <Utensils className="h-6 w-6 text-orange-600" />
                    </div>
                    <div>
                      <p className="text-sm font-bold text-zinc-400 uppercase tracking-wider">
                        Current Status
                      </p>
                      <p className="text-lg font-black text-zinc-900 capitalize">
                        {formatStatus(todaysOrder.status)}
                      </p>
                    </div>
                  </div>
                  <div className="text-sm text-zinc-500 flex items-center gap-2">
                    <Clock className="h-4 w-4" /> Awaiting Dispatch
                  </div>
                </CardContent>
              </Card>
            ) : (
              <Card className="border-dashed border-2 bg-zinc-50/50 py-6 text-center">
                <p className="text-zinc-500 font-medium">
                  No delivery scheduled for today.
                </p>
              </Card>
            )}
          </section>

          {/* ========================================== */}
          {/* SECTION 2: DAY-WISE HISTORY (PAGINATED)  */}
          {/* ========================================== */}
          <section className="space-y-4 pt-4">
            <h2 className="text-xl font-bold text-zinc-900 flex items-center gap-2">
              <Utensils className="h-5 w-5 text-primary" /> Subscription History
            </h2>

            <div className="bg-white rounded-2xl shadow-sm border overflow-hidden">
              <div className="hidden md:grid grid-cols-4 bg-zinc-50 border-b p-4 text-xs font-bold text-zinc-500 uppercase tracking-wider">
                <div>Date</div>
                <div>Meal/Action</div>
                <div>Status</div>
                <div className="text-right">Day #</div>
              </div>

              <div className="divide-y divide-zinc-100">
                {historyData.map((row, idx) => {
                  const absoluteDayNumber =
                    (currentPage - 1) * pageSize + idx + 1;
                  const dateObj = parseISO(row.date);

                  return (
                    <div
                      key={idx}
                      className="p-4 grid grid-cols-1 md:grid-cols-4 items-center gap-2 md:gap-0 hover:bg-zinc-50 transition-colors"
                    >
                      {/* Date */}
                      <div className="font-medium text-zinc-900">
                        {format(dateObj, "MMM do, yyyy")}
                        <span className="md:hidden text-zinc-400 text-xs ml-2">
                          (Day {absoluteDayNumber})
                        </span>
                      </div>

                      {/* Meal Type / Paused */}
                      <div>
                        {row.is_paused ? (
                          <span className="inline-flex items-center gap-1.5 bg-zinc-100 text-zinc-600 px-2.5 py-1 rounded-md text-xs font-bold uppercase">
                            <PauseCircle className="h-3 w-3" /> Paused
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 bg-orange-50 text-orange-700 px-2.5 py-1 rounded-md text-xs font-bold uppercase">
                            {row.meal_name || "Meal"}
                          </span>
                        )}
                      </div>

                      {/* Execution Status */}
                      <div>
                        {row.is_paused ? (
                          <span className="text-zinc-400 text-sm italic">
                            -
                          </span>
                        ) : row.status === "DELIVERED" ? (
                          <span className="text-green-600 font-bold text-sm flex items-center gap-1">
                            <CheckCircle2 className="h-4 w-4" /> Delivered
                          </span>
                        ) : row.status === "PENDING" &&
                          new Date(row.date) > new Date() ? (
                          <span className="text-zinc-400 font-medium text-sm">
                            Upcoming
                          </span>
                        ) : (
                          <span className="text-blue-600 font-medium text-sm capitalize">
                            {formatStatus(row.status)}
                          </span>
                        )}
                      </div>

                      {/* Day Number (Desktop) */}
                      <div className="hidden md:block text-right font-mono text-sm text-zinc-400">
                        {absoluteDayNumber}
                      </div>
                    </div>
                  );
                })}

                {historyData.length === 0 && (
                  <div className="p-8 text-center text-zinc-500">
                    No history found.
                  </div>
                )}
              </div>

              {/* PAGINATION CONTROLS */}
              {totalPages > 1 && (
                <div className="p-4 border-t bg-zinc-50 flex items-center justify-between">
                  <Button
                    variant="outline"
                    disabled={currentPage <= 1}
                    asChild={currentPage > 1}
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

                  <span className="text-sm font-medium text-zinc-500">
                    Page {currentPage} of {totalPages}
                  </span>

                  <Button
                    variant="outline"
                    disabled={currentPage >= totalPages}
                    asChild={currentPage < totalPages}
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
            </div>
          </section>
        </>
      )}
    </div>
  );
}
