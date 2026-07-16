import { getCustomerSession } from "@/lib/customer/get-session";
import { redirect } from "next/navigation";
import {
  format,
  parseISO,
  addDays,
  isToday,
  differenceInCalendarDays,
} from "date-fns";
import Link from "next/link";
import {
  CalendarDays,
  Utensils,
  PauseCircle,
  CheckCircle2,
  CalendarCheck,
  ArrowRight,
  AlertCircle,
  ShoppingBag,
} from "lucide-react";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/shared/components/ui/card";
import { Button } from "@/shared/components/ui/button";
import { Badge } from "@/shared/components/ui/badge";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/shared/components/ui/alert";
import { cn } from "@/lib/utils";
import { repairOverLimitPauseCredits } from "@/actions/manageMealActions";
import { shouldShowProfileCompletionDialog } from "@/services/OnboardingService";
import {
  ProfileCompletionDialog,
  type CompletableField,
} from "@/shared/components/customer/ProfileCompletionDialog";
import { KitDashboard } from "./KitDashboard";
import { AccommodationDashboard } from "./AccommodationDashboard";
import { JourneyHeader } from "@/shared/components/customer/dashboard/JourneyHeader";
import {
  TodayFocusCard,
  type TodayFocusState,
} from "@/shared/components/customer/dashboard/TodayFocusCard";
import {
  MomentumStrip,
  type MomentumStat,
} from "@/shared/components/customer/dashboard/MomentumStrip";
import { TransformationSpotlight } from "@/shared/components/customer/dashboard/TransformationSpotlight";
import { AppReadyBeacon } from "@/shared/components/loader/AppReadyBeacon";
import {
  UpcomingDeliveries,
  type DeliveryItem,
} from "@/shared/components/customer/dashboard/UpcomingDeliveries";
import { MEAL_THEMES } from "@/shared/components/customer/dashboard/meal-theme";
import { getShippingInfoAction } from "@/actions/admin-actions/shippingActions";
import { getActiveStayAction } from "@/actions/stayActions";
import * as kitLifecycleRepo from "@/repositories/kitLifecycleRepository";

export const revalidate = 0;

/** Shape of a row from the upcoming `subscription_daily_preferences` query.
 *  Supabase returns embedded relations as either an object or an array. */
type UpcomingMealAddress = {
  tag: string | null;
  street_1: string | null;
  city: string | null;
};
type UpcomingMealCategory = { code: string | null };
type UpcomingMeal = {
  preference_date: string;
  is_paused: boolean;
  meal_categories: UpcomingMealCategory | UpcomingMealCategory[] | null;
  addresses: UpcomingMealAddress | UpcomingMealAddress[] | null;
};

export default async function CustomerDashboard() {
  const { supabase, user, profile: appUser, error } =
    await getCustomerSession();
  if (error || !user) redirect("/login");
  if (!appUser) redirect("/login");

  const { data: profile, error: profileError } = await supabase
    .from("customer_profiles")
    .select(
      "id, dietary_preference, onboarding_status, date_of_birth, gender, allergies, medical_history_notes",
    )
    .eq("user_id", appUser.id)
    .maybeSingle();

  if (profileError || !profile) {
    return (
      <div className="p-6">
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Profile Error</AlertTitle>
          <AlertDescription>Failed to load customer profile.</AlertDescription>
        </Alert>
      </div>
    );
  }

  const customerProfileId = profile.id;

  // --- Profile-completion dialog gating (Req 9.1/9.5, 10.5) ---
  // The dialog is presented only while onboarding is IN_PROGRESS; once
  // COMPLETED it must never reappear. The set of inputs offered is exactly the
  // Customer_Record fields that are still empty, plus a real-email input when
  // the current email is an admin-entered Test_Email.
  const showProfileDialog = shouldShowProfileCompletionDialog(
    profile.onboarding_status,
  );

  const profileDialogEmptyFields: CompletableField[] = [];
  let profileDialogIsTestEmail = false;
  let profileDialogSubscription: {
    category: string | null;
    planName: string | null;
    startDate: string | null;
    endDate: string | null;
  } | null = null;
  let profileDialogCustomerCategory: string | null = null;
  let profileDialogAccommodationStay: {
    stayType: string;
    occupancyType: string;
    startDate: string | null;
    endDate: string | null;
  } | null = null;

  if (showProfileDialog) {
    const isEmpty = (v: unknown) =>
      v === null || v === undefined || (typeof v === "string" && v.trim() === "");

    if (isEmpty(profile.date_of_birth)) profileDialogEmptyFields.push("dateOfBirth");
    if (isEmpty(profile.gender)) profileDialogEmptyFields.push("gender");
    if (isEmpty(profile.dietary_preference))
      profileDialogEmptyFields.push("dietaryPreference");
    if (isEmpty(profile.allergies)) profileDialogEmptyFields.push("allergies");
    if (isEmpty(profile.medical_history_notes))
      profileDialogEmptyFields.push("medicalHistoryNotes");

    const { data: userEmailRow } = await supabase
      .from("users")
      .select("is_test_email")
      .eq("id", appUser.id)
      .maybeSingle();
    profileDialogIsTestEmail = userEmailRow?.is_test_email === true;

    // Query active subscription details for the dialog
    const { data: dialogSub } = await supabase
      .from("subscriptions")
      .select("customer_category, starts_on, effective_end_on, subscription_plans(name), kit_products(name)")
      .eq("customer_profile_id", profile.id)
      .eq("status", "ACTIVE")
      .maybeSingle();

    if (dialogSub) {
      const plan = Array.isArray(dialogSub.subscription_plans)
        ? dialogSub.subscription_plans[0]
        : dialogSub.subscription_plans;
      const dialogSubKit = dialogSub as typeof dialogSub & {
        kit_products?:
          | { name: string | null }
          | { name: string | null }[]
          | null;
      };
      const kitProduct = Array.isArray(dialogSubKit.kit_products)
        ? dialogSubKit.kit_products[0]
        : dialogSubKit.kit_products;
      
      // For KIT subscriptions, show the kit product name as the plan name
      const planName = dialogSub.customer_category === "KIT"
        ? (kitProduct?.name ?? null)
        : (plan?.name ?? null);

      profileDialogSubscription = {
        category: dialogSub.customer_category,
        planName,
        startDate: dialogSub.starts_on,
        endDate: dialogSub.effective_end_on,
      };
      profileDialogCustomerCategory = dialogSub.customer_category;
    }

    // For accommodation customers, the popup shows stay details instead of
    // the Meal/KIT subscription block (Req 6.1) — fetch the active/pending
    // stay via the same fallback logic used on the Stay Tracker page.
    if (profileDialogCustomerCategory === "ACCOMMODATION") {
      const stayResult = await getActiveStayAction(customerProfileId);
      if ("data" in stayResult && stayResult.data) {
        profileDialogAccommodationStay = {
          stayType: stayResult.data.stayType,
          occupancyType: stayResult.data.occupancyType,
          startDate: stayResult.data.startDate,
          endDate: stayResult.data.endDate,
        };
      }
    }
  }

  const [
    { data: addonOrders },
    { data: subscriptions, error: subError },
    { data: upcomingSubscriptions },
  ] = await Promise.all([
    supabase
      .from("addon_orders")
      .select(`id, delivery_order_id, delivery_orders(status)`)
      .eq("customer_profile_id", customerProfileId)
      .eq("status", "PAID"),
    supabase
      .from("subscriptions")
      .select(`*, subscription_plans ( name, duration_days )`)
      .eq("customer_profile_id", profile.id)
      .order("created_at", { ascending: false }),
    supabase
      .from("subscriptions")
      .select(
        `id, starts_on, effective_end_on, status, subscription_code, subscription_plans ( name, duration_days )`,
      )
      .eq("customer_profile_id", customerProfileId)
      .in("status", ["PENDING"])
      .order("starts_on", { ascending: true }),
  ]);

  // Filter for active/pending shop deliveries
  const activeAddonOrders =
    addonOrders?.filter((order) => {
      const delivery = Array.isArray(order.delivery_orders)
        ? order.delivery_orders[0]
        : order.delivery_orders;

      return (
        !order.delivery_order_id ||
        (delivery &&
          delivery.status !== "DELIVERED" &&
          delivery.status !== "CANCELLED")
      );
    }) || [];

  const pendingSubscriptions = upcomingSubscriptions ?? [];

  if (subError) {
    return (
      <div className="relative z-10 max-w-4xl mx-auto mt-1 p-4">
        <Alert variant="destructive" className="bg-red-50 border-red-200">
          <AlertCircle className="h-4 w-4 stroke-red-600" />
          <AlertTitle className="font-bold text-red-900">
            Database Query Failed
          </AlertTitle>
          <AlertDescription className="text-red-800 mt-2">
            {subError.message}
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  const activeSub = subscriptions?.find((s) => s.status === "ACTIVE");

  // Rendered wherever the dashboard exits, so an IN_PROGRESS customer always
  // gets the completion popup regardless of subscription state (Req 9.1).
  const profileDialog = showProfileDialog ? (
    <ProfileCompletionDialog
      emptyFields={profileDialogEmptyFields}
      isTestEmail={profileDialogIsTestEmail}
      subscription={profileDialogSubscription}
      customerCategory={profileDialogCustomerCategory}
      accommodationStay={profileDialogAccommodationStay}
      customerProfileId={customerProfileId}
    />
  ) : null;

  // Category-based view selection (Req 8.1, 8.4)
  // If customer has a KIT subscription, show KIT-specific dashboard
  if (activeSub && activeSub.customer_category === "KIT") {
    // Fetch KIT-specific data
    const { data: kitSubscription } = await supabase
      .from("subscriptions")
      .select(
        `
        id,
        subscription_code,
        starts_on,
        kit_duration_days,
        customer_category,
        status,
        kit_products (
          name,
          base_price,
          tax_rate
        )
      `
      )
      .eq("id", activeSub.id)
      .single();

    if (!kitSubscription) {
      return (
        <div className="p-6">
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Subscription Error</AlertTitle>
            <AlertDescription>
              Failed to load KIT subscription details.
            </AlertDescription>
          </Alert>
        </div>
      );
    }

    // Fetch shipping information
    const shippingResult = await getShippingInfoAction(customerProfileId);
    const shippingInfo = shippingResult.success ? (shippingResult.data ?? null) : null;

    // Render KIT-specific dashboard (Req 8.1, 8.3)
    return (
      <>
        {profileDialog}
        <KitDashboard
          subscription={kitSubscription}
          shippingInfo={shippingInfo}
        />
      </>
    );
  }

  // If customer has an ACCOMMODATION subscription, show the accommodation
  // stay dashboard instead of the generic meal dashboard (Req 8.1, 8.2).
  if (activeSub && activeSub.customer_category === "ACCOMMODATION") {
    const stayResult = await getActiveStayAction(customerProfileId);
    const stay = "data" in stayResult ? stayResult.data : null;

    return (
      <>
        {profileDialog}
        <AccommodationDashboard stay={stay} />
      </>
    );
  }

  if (!activeSub) {
    // Check if customer has an EXPIRED KIT and a newer PENDING subscription (Req 5.1, 5.2)
    const kitSubscriptions = await kitLifecycleRepo.getCustomerKitSubscriptions(customerProfileId);
    const expiredKit = kitSubscriptions.find((s) => s.status === "EXPIRED");
    const pendingKit = kitSubscriptions.find((s) => s.status === "PENDING");

    if (expiredKit && pendingKit) {
      // Fetch the PENDING subscription's product info and shipping info
      const { data: pendingKitSubscription } = await supabase
        .from("subscriptions")
        .select(
          `
          id,
          subscription_code,
          starts_on,
          kit_duration_days,
          customer_category,
          status,
          kit_products (
            name,
            base_price,
            tax_rate
          )
        `
        )
        .eq("id", pendingKit.id)
        .single();

      const pendingShippingInfo = await kitLifecycleRepo.getShippingInfo(pendingKit.id);

      if (pendingKitSubscription) {
        // Transform shipping info to match ShippingInfo type expected by ShippingTracker
        let shippingInfo = null;
        if (pendingShippingInfo) {
          const { transformShippingInfoRow } = await import("@/types/kitShipping");
          shippingInfo = transformShippingInfoRow({
            id: pendingShippingInfo.id,
            customer_profile_id: pendingShippingInfo.customer_profile_id,
            subscription_id: pendingShippingInfo.subscription_id,
            courier_partner: pendingShippingInfo.courier_partner as "OTHER" | "APSRTC" | "TGSRTC" | "DTDC",
            tracking_number: pendingShippingInfo.tracking_number,
            tracking_url: pendingShippingInfo.tracking_url,
            shipped_at: pendingShippingInfo.shipped_at,
            delivered_at: pendingShippingInfo.delivered_at,
            created_at: pendingShippingInfo.created_at,
            updated_at: pendingShippingInfo.created_at, // Use created_at as fallback
          });
        }

        return (
          <>
            {profileDialog}
            <KitDashboard
              subscription={pendingKitSubscription}
              shippingInfo={shippingInfo}
              isNewKitPending
            />
          </>
        );
      }
    }

    return (
      <div className="relative z-10 max-w-4xl mx-auto mt-1 animate-in fade-in slide-in-from-bottom-4">
        {profileDialog}
        <Card className="border border-dashed border-slate-200 bg-white shadow-sm text-center py-16">
          <CardContent className="flex flex-col items-center space-y-4">
            <div className="h-20 w-20 bg-slate-100 rounded-full flex items-center justify-center mb-4">
              <Utensils className="h-10 w-10 text-slate-400" />
            </div>
            <h2 className="text-xl font-semibold text-slate-900 tracking-tight">
              No Active Subscription
            </h2>
            <p className="text-sm text-slate-500 max-w-md mx-auto">
              You don&apos;t have an active meal plan yet. Subscribe today to
              get healthy, chef-prepared meals delivered daily.
            </p>
            <Button asChild size="lg" className="mt-6">
              <Link href="/subscription">
                Explore Plans <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const planDetails = Array.isArray(activeSub.subscription_plans)
    ? activeSub.subscription_plans[0]
    : activeSub.subscription_plans;
  const planName = planDetails?.name || "Custom Plan";
  const safeTotal = activeSub.pause_credits_total || 1;

  const todayStr = format(new Date(), "yyyy-MM-dd");
  const nextWeekStr = format(addDays(new Date(), 7), "yyyy-MM-dd");

  const [
    { count: initialPauseCount },
    { data: upcomingMeals },
    { data: todaysDeliveryOrder },
  ] = await Promise.all([
    supabase
      .from("subscription_daily_preferences")
      .select("*", { count: "exact", head: true })
      .eq("subscription_id", activeSub.id)
      .eq("is_paused", true),
    supabase
      .from("subscription_daily_preferences")
      .select(
        `
      preference_date,
      is_paused,
      meal_categories ( code ),
      addresses ( tag, street_1, city )
    `,
      )
      .eq("subscription_id", activeSub.id)
      .gte("preference_date", todayStr)
      .lte("preference_date", nextWeekStr)
      .order("preference_date", { ascending: true }),
    // Today's real delivery order — drives the status-aware Today's Meal
    // card (see delivery-status.ts) so it never shows stale "on its way"
    // copy once the meal has already been delivered.
    supabase
      .from("delivery_orders")
      .select("id, status")
      .eq("customer_profile_id", customerProfileId)
      .eq("delivery_date", todayStr)
      .maybeSingle(),
  ]);

  let actualPauseCreditsUsed = initialPauseCount;

  if ((actualPauseCreditsUsed ?? 0) > safeTotal) {
    await repairOverLimitPauseCredits(activeSub.id);
    const { count: repairedCount } = await supabase
      .from("subscription_daily_preferences")
      .select("*", { count: "exact", head: true })
      .eq("subscription_id", activeSub.id)
      .eq("is_paused", true);
    actualPauseCreditsUsed = repairedCount;
  }

  const rawPauseCreditsUsed =
    actualPauseCreditsUsed ?? activeSub.pause_credits_used ?? 0;
  const pauseCreditsUsed = Math.min(rawPauseCreditsUsed, safeTotal);
  const pausePercentage = Math.round((pauseCreditsUsed / safeTotal) * 100);
  const pauseCreditsRemaining = Math.max(
    0,
    activeSub.pause_credits_total - pauseCreditsUsed,
  );

  // --- Zone 1: Journey math (derived purely from existing subscription fields) ---
  const journeyStart = activeSub.starts_on ? parseISO(activeSub.starts_on) : null;
  const journeyEnd = activeSub.effective_end_on
    ? parseISO(activeSub.effective_end_on)
    : null;
  const now = new Date();
  const totalJourneyDays =
    journeyStart && journeyEnd
      ? Math.max(1, differenceInCalendarDays(journeyEnd, journeyStart) + 1)
      : activeSub.total_days || 1;
  const rawJourneyDay = journeyStart
    ? differenceInCalendarDays(now, journeyStart) + 1
    : 1;
  const journeyDay = Math.max(1, Math.min(rawJourneyDay, totalJourneyDays));
  const journeyProgress = Math.round((journeyDay / totalJourneyDays) * 100);
  const daysCompleted = Math.max(0, journeyDay - 1);
  const daysRemaining = Math.max(0, totalJourneyDays - journeyDay);
  const firstName = appUser.full_name?.trim().split(/\s+/)[0] || null;
  const greetingHour = now.getHours();
  const timeGreeting =
    greetingHour < 12
      ? "Good morning"
      : greetingHour < 17
        ? "Good afternoon"
        : "Good evening";
  const journeyGreeting = firstName
    ? `${timeGreeting}, ${firstName}`
    : timeGreeting;

  const journeyMotivation =
    journeyProgress < 15
      ? "Every healthy choice you make today is building a stronger, healthier you."
      : journeyProgress < 50
        ? "You're building real momentum. Keep going, one nourishing meal at a time."
        : journeyProgress < 85
          ? "You're past the halfway mark — your consistency is truly paying off."
          : "You're in the final stretch of this journey. Finish strong!";

  // --- Zone 2: Today's focus (from the existing 7-day preferences query) ---
  const todayMeal = upcomingMeals?.find((m: UpcomingMeal) =>
    isToday(parseISO(m.preference_date)),
  );
  let todayState: TodayFocusState = "empty";
  let todayTagLabel: string | null = null;
  let todayTagClass = "";
  let todayAddressTag: string | null = null;
  let todayAddressLine: string | null = null;
  if (todayMeal) {
    if (todayMeal.is_paused) {
      todayState = "paused";
    } else {
      todayState = "active";
      const cat = Array.isArray(todayMeal.meal_categories)
        ? todayMeal.meal_categories[0]
        : todayMeal.meal_categories;
      const addr = Array.isArray(todayMeal.addresses)
        ? todayMeal.addresses[0]
        : todayMeal.addresses;
      const theme = MEAL_THEMES[cat?.code || "VEG"] || MEAL_THEMES.VEG;
      todayTagLabel = theme.label;
      todayTagClass = cn(theme.bg, theme.text, theme.border);
      todayAddressTag = addr?.tag ?? null;
      todayAddressLine = addr?.street_1 ?? null;
    }
  }

  // --- Zone 3: Momentum stats (all from data already loaded above) ---
  const momentumStats: MomentumStat[] = [
    {
      icon: CalendarCheck,
      value: daysCompleted,
      label: "days nourished",
      tone: "green",
    },
    {
      icon: Utensils,
      value: activeSub.total_days ?? totalJourneyDays,
      label: "meals in your plan",
      tone: "coral",
    },
    {
      icon: PauseCircle,
      value: pauseCreditsRemaining,
      label: "pauses in reserve",
      tone: "amber",
    },
  ];

  // Real ArogyaDiet meal photography for the Today's Focus rotation. The card
  // cross-fades gently between these every few seconds.
  const mealImages = [
    "/food%20image1.jpg",
    "/food%20image2.jpg",
    "/food%20image3.jpg",
    "/food%20image4.jpg",
    "/food%20image5.jpg",
  ];

  // --- Delivery roster (Zone 5): flatten for the schedule component ---
  const deliveryItems: DeliveryItem[] = (upcomingMeals ?? []).map(
    (m: UpcomingMeal) => {
      const cat = Array.isArray(m.meal_categories)
        ? m.meal_categories[0]
        : m.meal_categories;
      const addr = Array.isArray(m.addresses) ? m.addresses[0] : m.addresses;
      return {
        date: m.preference_date,
        isPaused: m.is_paused,
        mealCode: cat?.code ?? null,
        addressTag: addr?.tag ?? null,
        addressLine: addr?.street_1 ?? null,
      };
    },
  );

  return (
    <div className="relative z-10 mx-auto max-w-5xl space-y-6 sm:space-y-8">
      {profileDialog}

      {/* ZONE 1 — Wellness journey */}
      <JourneyHeader
        greeting={journeyGreeting}
        planName={planName}
        dayCurrent={journeyDay}
        dayTotal={totalJourneyDays}
        progress={journeyProgress}
        daysRemaining={daysRemaining}
        motivation={journeyMotivation}
        code={activeSub.subscription_code}
      />

      {activeAddonOrders.length > 0 && (
        <Link href="/meals" className="block transition-all duration-200">
          <Card className="rounded-2xl border border-amber-200 bg-amber-50/50 shadow-sm transition-all duration-200 hover:border-amber-300 hover:shadow-md">
            <CardContent className="p-6 flex items-center gap-4">
              <div className="rounded-full bg-amber-100 text-amber-700 p-3 shrink-0">
                <ShoppingBag className="h-5 w-5" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-amber-900">
                  Active Shop Orders
                </p>
                <p className="text-sm text-amber-800/90 mt-1 leading-relaxed">
                  You have {activeAddonOrders.length} pending shop order
                  {activeAddonOrders.length === 1 ? "" : "s"}. Tap to track in
                  <span className="font-bold"> My Meals</span>.
                </p>
              </div>
              <ArrowRight className="h-5 w-5 text-amber-700 shrink-0" />
            </CardContent>
          </Card>
        </Link>
      )}

      {/* ZONE 2 — Today's focus */}
      <TodayFocusCard
        state={todayState}
        dateLabel={format(now, "EEEE, dd MMM")}
        title="Today's meal"
        tagLabel={todayTagLabel}
        tagClassName={todayTagClass}
        addressTag={todayAddressTag}
        addressLine={todayAddressLine}
        deliveryStatus={
          todayState === "active" ? todaysDeliveryOrder?.status ?? null : undefined
        }
        orderId={todaysDeliveryOrder?.id ?? null}
        images={mealImages}
        ctaHref="/meals"
        ctaLabel="View meal plan"
      />

      {/* ZONE 3 — Momentum */}
      <MomentumStrip
        stats={momentumStats}
        caption={`You've stayed nourished for ${daysCompleted} ${daysCompleted === 1 ? "day" : "days"} — every meal is a step forward.`}
      />

      {/* ZONE 4 — Real transformation (aspiration, right after momentum) */}
      <TransformationSpotlight
        imageSrc="/Transformation%20image.jpeg"
        imageWidth={1200}
        imageHeight={450}
        headline="Real people. Real results."
        subtext="Thousands have transformed their lives through ArogyaDiet. Your journey is one of them."
        ctaLabel="Watch Full Journey"
        youtubeId="yzqZ-yTll8M"
        youtubeStart={8}
      />

      {/* ZONE 5 — Your week ahead (compact delivery schedule) */}
      <div
        className="reveal-rise"
        style={{ ["--reveal-delay" as string]: "1600ms" }}
      >
        <div className="mb-3 flex items-center gap-3">
          <h2 className="text-lg font-semibold tracking-tight text-slate-900">
            Your week ahead
          </h2>
          <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-700">
            Next 7 days
          </span>
        </div>
        <UpcomingDeliveries items={deliveryItems} />
      </div>

      {/* ZONE 6 — Manage your plan */}
      <div
        className="reveal-rise space-y-4"
        style={{ ["--reveal-delay" as string]: "1750ms" }}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold tracking-tight text-slate-900">
            Manage your plan
          </h2>
          <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-emerald-700">
            <CheckCircle2 className="h-3.5 w-3.5" /> Active
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 sm:gap-5">
        <Card className="md:col-span-2 rounded-2xl border border-slate-200 bg-white shadow-sm">
          <CardHeader className="border-b border-slate-100 bg-emerald-50/40 px-6 py-4">
            <CardTitle className="text-base font-semibold text-slate-900 flex items-center gap-2">
              <CalendarDays className="h-5 w-5 text-emerald-600" />
              Plan Timeline
            </CardTitle>
          </CardHeader>
          <CardContent className="p-6">
            <div className="flex flex-col sm:flex-row justify-between sm:items-end gap-6">
              <div>
                <h3 className="text-xl font-semibold text-slate-900 mb-1">
                  {planName}
                </h3>
                <p className="text-sm text-slate-500">
                  {activeSub.total_days} Meals Total
                </p>
              </div>
              <div className="flex gap-6 sm:gap-8 text-sm">
                <div className="space-y-1">
                  <p className="text-xs font-medium uppercase tracking-wider text-slate-500">
                    Start Date
                  </p>
                  <p className="font-semibold text-slate-900">
                    {activeSub.starts_on
                      ? format(parseISO(activeSub.starts_on), "MMM do, yyyy")
                      : "N/A"}
                  </p>
                </div>
                <div className="space-y-1">
                  <p className="text-xs font-medium uppercase tracking-wider text-slate-500">
                    Est. End Date
                  </p>
                  <p className="font-semibold text-slate-900">
                    {activeSub.effective_end_on
                      ? format(
                          parseISO(activeSub.effective_end_on),
                          "MMM do, yyyy",
                        )
                      : "N/A"}
                  </p>
                </div>
              </div>
            </div>
            <div className="mt-8 pt-6 border-t border-slate-100 flex items-center gap-4">
              <div className="rounded-full bg-orange-50 p-3 text-orange-600 shrink-0">
                <Utensils className="h-5 w-5" />
              </div>
              <div>
                <p className="text-sm text-slate-500">
                  Base Diet Preference
                </p>
                <p className="font-semibold text-slate-900">
                  {profile.dietary_preference || "Standard"}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-2xl border border-slate-200 bg-white shadow-sm flex flex-col">
          <CardHeader className="border-b border-slate-100 bg-emerald-50/40 px-6 py-4">
            <CardTitle className="text-base font-semibold text-slate-900 flex items-center gap-2">
              <PauseCircle className="h-5 w-5 text-emerald-600" />
              Flexibility
            </CardTitle>
          </CardHeader>
          <CardContent className="p-6 flex-1 flex flex-col justify-center">
            <div className="flex items-end justify-between mb-2">
              <span className="text-3xl font-semibold text-slate-900">
                {pauseCreditsRemaining}
              </span>
              <span className="mb-1 text-sm font-semibold text-slate-500">
                of {activeSub.pause_credits_total} pauses left
              </span>
            </div>
            <div className="mt-4 h-2.5 w-full overflow-hidden rounded-full bg-slate-100">
              <div
                className={`h-full rounded-full transition-all duration-500 ${pauseCreditsRemaining === 0 ? "bg-amber-400" : "bg-emerald-500"}`}
                style={{ width: `${Math.max(100 - pausePercentage, 0)}%` }}
              />
            </div>
            <p className="mt-4 text-xs leading-relaxed text-slate-500">
              Life happens. Pause any delivery and we&apos;ll extend your end
              date automatically — your meals are never lost.
            </p>
          </CardContent>
        </Card>
        </div>
      </div>

      {pendingSubscriptions.length > 0 && (
        <section className="space-y-4">
          <h3 className="text-lg font-semibold text-slate-900 tracking-tight">
            Upcoming Subscriptions
          </h3>
          <div className="grid grid-cols-1 gap-4">
            {pendingSubscriptions.map((sub) => {
              const upcomingPlan = Array.isArray(sub.subscription_plans)
                ? sub.subscription_plans[0]
                : sub.subscription_plans;
              const upcomingPlanName = upcomingPlan?.name || "Custom Plan";
              const durationLabel = upcomingPlan?.duration_days
                ? ` (${upcomingPlan.duration_days} Days)`
                : "";
              const isPending = sub.status === "PENDING";

              return (
                <Card
                  key={sub.id}
                  className="rounded-2xl border border-slate-200 bg-white shadow-sm transition-all duration-200 hover:shadow-md"
                >
                  <CardContent className="p-6">
                    <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
                      <div className="space-y-2 min-w-0">
                        <h4 className="font-semibold text-slate-900">
                          {upcomingPlanName}
                          {durationLabel}
                        </h4>
                        <p className="text-sm text-slate-500">
                          <span className="font-medium">Starts:</span>{" "}
                          {sub.starts_on
                            ? format(
                                parseISO(sub.starts_on),
                                "MMM do, yyyy",
                              )
                            : "N/A"}
                          <span className="text-slate-400 mx-2">→</span>
                          <span className="font-medium">Est. End:</span>{" "}
                          {sub.effective_end_on
                            ? format(
                                parseISO(sub.effective_end_on),
                                "MMM do, yyyy",
                              )
                            : "N/A"}
                        </p>
                        <p className="text-xs text-slate-500 leading-relaxed">
                          Activates automatically 1 day before the start date.
                        </p>
                      </div>
                      <Badge
                        variant="outline"
                        className={cn(
                          "shrink-0 self-start rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wider",
                          isPending
                            ? "bg-amber-50 text-amber-700 border-amber-200"
                            : "bg-slate-50 text-slate-700 border-slate-200",
                        )}
                      >
                        {sub.status}
                      </Badge>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </section>
      )}

      {/* Signals the loader that the full dashboard is mounted, so it dissolves
          into a real, present page and the choreography plays in sync. */}
      <AppReadyBeacon />
    </div>
  );
}
