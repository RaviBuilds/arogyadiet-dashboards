import Link from "next/link";
import { format, parseISO, addDays, differenceInCalendarDays } from "date-fns";
import {
  Package,
  CalendarDays,
  Utensils,
  Moon,
  CalendarCheck,
  ShieldCheck,
  ArrowRight,
  CheckCircle2,
  History,
  CreditCard,
  ClipboardCheck,
  Wallet,
  Truck,
  Flame,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/shared/components/ui/card";
import type { ShippingInfo } from "@/types/kitShipping";
import { ShippingTracker } from "./ShippingTracker";
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
import {
  KitJourneyMap,
  type KitMapDay,
  type KitMapStatus,
} from "@/shared/components/customer/dashboard/KitJourneyMap";
import { PendingLogsAlert } from "@/shared/components/customer/dashboard/PendingLogsAlert";
import {
  KitQuickLog,
  type QuickLogDay,
} from "@/shared/components/customer/dashboard/KitQuickLog";

/**
 * KIT-specific customer dashboard.
 *
 * Shares the meal dashboard's design system and reveal choreography, but every
 * number is KIT data and — deliberately — every number agrees with every other
 * one. Three rules govern this page:
 *
 *  1. The hero tells the truth. It reports the real calendar day since the kit
 *     arrived and how many meals are actually logged, and its ring measures
 *     tracker *adherence* (labelled "Logged"), never kit completion. A customer
 *     who is weeks behind must not read a congratulatory hero.
 *  2. The backlog is stated twice, not seven times: once in the hero milestone
 *     chip, once in the alert that can resolve it. Repetition past that point
 *     turns urgency into wallpaper.
 *  3. Logging happens here. The alert and Today's card carry an inline logger,
 *     so a blank day is fixed where it is reported instead of sending the
 *     customer off to hunt through a calendar.
 *
 * Rest days never lose a meal: kit_tracker_end_date shifts by one for every
 * FOOD_SKIPPED day (trg_kit_daily_logs_sync).
 *
 * Requirements: 8.1, 8.3
 */

interface KitProduct {
  name: string;
  base_price: number;
  tax_rate: number;
}

interface KitSubscription {
  id: string;
  subscription_code: string | null;
  starts_on: string | null;
  kit_duration_days: number;
  customer_category: string;
  status: string;
  kit_products: KitProduct | KitProduct[] | null;
  /** Customer-confirmed package receipt date — the real kit start date. */
  kit_received_date?: string | null;
  /** received + (duration - 1) + skipped days (trigger-maintained). */
  kit_tracker_end_date?: string | null;
  kit_total_skipped_days?: number | null;
}

/** Minimal projection of a kit_daily_logs row needed by the dashboard. */
export type KitDashboardLog = {
  log_date: string;
  status: "FOOD_TAKEN" | "FOOD_SKIPPED";
};

interface KitDashboardProps {
  subscription: KitSubscription;
  shippingInfo: ShippingInfo | null;
  /** Tracker logs for this kit, ascending by log_date. */
  dailyLogs?: KitDashboardLog[];
  /** Customer's full name, used for the time-aware greeting. */
  customerName?: string | null;
  /** True when the previous KIT expired and this is the replacement on its way. */
  isNewKitPending?: boolean;
}

const KIT_MEAL_IMAGES = [
  "/food%20image1.jpg",
  "/food%20image2.jpg",
  "/food%20image3.jpg",
  "/food%20image4.jpg",
  "/food%20image5.jpg",
];

/** How many blank days the inline logger offers before deferring to the
 *  full tracker. Recent days are recalled accurately; a wall of twenty rows
 *  is not something anyone completes. */
const QUICK_LOG_LIMIT = 4;

/** A larger batch for the recovery state, where this logger is the only route. */
const QUICK_LOG_LIMIT_RECOVERY = 7;

function formatCurrency(amount: number) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 2,
  }).format(amount);
}

export function KitDashboard({
  subscription,
  shippingInfo,
  dailyLogs = [],
  customerName,
  isNewKitPending,
}: KitDashboardProps) {
  // kit_products arrives as an object or a single-element array from Supabase.
  const kitProduct = Array.isArray(subscription.kit_products)
    ? subscription.kit_products[0]
    : subscription.kit_products;

  const productName = kitProduct?.name ?? "KIT Product";
  const basePrice = kitProduct?.base_price ?? 0;
  const taxRate = kitProduct?.tax_rate ?? 0.05;
  const taxAmount = basePrice * taxRate;
  const totalPrice = basePrice + taxAmount;

  const now = new Date();
  const todayStr = format(now, "yyyy-MM-dd");

  const durationDays = Math.max(1, subscription.kit_duration_days || 1);
  const receivedDateStr = subscription.kit_received_date ?? null;
  const started = Boolean(receivedDateStr);
  const receivedDate = receivedDateStr ? parseISO(receivedDateStr) : null;

  const restDays =
    subscription.kit_total_skipped_days ??
    dailyLogs.filter((l) => l.status === "FOOD_SKIPPED").length;
  const mealsTaken = dailyLogs.filter((l) => l.status === "FOOD_TAKEN").length;
  const mealsRemaining = Math.max(0, durationDays - mealsTaken);

  // Tracker window: received → received + (duration - 1) + rest days.
  const trackerEndDate = subscription.kit_tracker_end_date
    ? parseISO(subscription.kit_tracker_end_date)
    : receivedDate
      ? addDays(receivedDate, durationDays - 1 + restDays)
      : null;
  const trackerEndStr = trackerEndDate
    ? format(trackerEndDate, "yyyy-MM-dd")
    : null;
  const windowDays =
    receivedDate && trackerEndDate
      ? differenceInCalendarDays(trackerEndDate, receivedDate) + 1
      : durationDays;

  // --- Where am I, honestly? -----------------------------------------------
  // Calendar day since the kit arrived — the number the customer can verify by
  // looking at a calendar. Meals logged is reported alongside it so the two can
  // never quietly disagree.
  const calendarDay = receivedDate
    ? Math.max(
        1,
        Math.min(windowDays, differenceInCalendarDays(now, receivedDate) + 1),
      )
    : 0;

  // --- Accountability: which tracker days are still blank? -----------------
  const logByDate = new Map<string, "FOOD_TAKEN" | "FOOD_SKIPPED">(
    dailyLogs.map((l) => [l.log_date, l.status]),
  );
  const pendingDates: string[] = [];
  if (receivedDate) {
    // Every day from arrival up to yesterday is loggable (the server action
    // accepts any date in [received, today]), so the window's nominal end date
    // must not hide days that are both blank and still fixable.
    const lastCheckStr = format(addDays(now, -1), "yyyy-MM-dd");
    let cursor = receivedDate;
    let cursorStr = format(cursor, "yyyy-MM-dd");
    let guard = 0; // hard bound against bad data
    while (cursorStr <= lastCheckStr && guard < 400) {
      if (!logByDate.has(cursorStr)) pendingDates.push(cursorStr);
      cursor = addDays(cursor, 1);
      cursorStr = format(cursor, "yyyy-MM-dd");
      guard += 1;
    }
  }
  const pendingCount = pendingDates.length;
  const todayPending = started && !logByDate.has(todayStr);
  const withinWindow = !trackerEndStr || todayStr <= trackerEndStr;

  /**
   * Lifecycle state. The critical distinction is between a kit that is finished
   * and a kit whose *window* ran out while meals were never logged.
   *
   * `kit_tracker_end_date` only extends for days logged as rest, so unlogged
   * days silently burn the window. Treating "past the end date" as "complete"
   * would congratulate a customer who still has meals in the box — the single
   * most misleading thing this page could do. So completion now requires the
   * meals to actually be accounted for, and the shortfall case gets its own
   * state with a recovery path: logging those days as rest pushes the end date
   * back out, one day at a time.
   */
  const kitState: "inTransit" | "active" | "windowEnded" | "complete" = !started
    ? "inTransit"
    : mealsRemaining === 0
      ? "complete"
      : withinWindow && subscription.status !== "EXPIRED"
        ? "active"
        : "windowEnded";

  const journeyComplete = kitState === "complete";
  const windowEnded = kitState === "windowEnded";

  // Adherence: of the tracker days that have already happened, how many did
  // the customer actually log? This is what the dietitian's guidance depends
  // on, so it is what the hero ring shows.
  const elapsedDays = started
    ? Math.max(1, Math.min(windowDays, calendarDay))
    : 0;
  const loggedDays = dailyLogs.length;
  const adherence = started
    ? Math.min(100, Math.round((loggedDays / elapsedDays) * 100))
    : 0;

  const loggedDates = dailyLogs
    .map((l) => l.log_date)
    .sort((a, b) => (a < b ? -1 : 1));
  const lastLoggedDate =
    loggedDates.length > 0 ? loggedDates[loggedDates.length - 1] : null;

  // Consecutive rest days ending at the most recent log — the other trigger
  // that makes a dietitian pick up the phone.
  let restRun = 0;
  if (lastLoggedDate) {
    let cursor = parseISO(lastLoggedDate);
    while (logByDate.get(format(cursor, "yyyy-MM-dd")) === "FOOD_SKIPPED") {
      restRun += 1;
      cursor = addDays(cursor, -1);
    }
  }

  // Consecutive logged days ending now — real momentum, and something the hero
  // ring doesn't already say.
  let streak = 0;
  if (started && receivedDateStr) {
    let cursor = logByDate.has(todayStr) ? now : addDays(now, -1);
    let cursorStr = format(cursor, "yyyy-MM-dd");
    while (cursorStr >= receivedDateStr && logByDate.has(cursorStr)) {
      streak += 1;
      cursor = addDays(cursor, -1);
      cursorStr = format(cursor, "yyyy-MM-dd");
    }
  }

  const showPendingAlert =
    (started && !journeyComplete && (pendingCount > 0 || restRun >= 3)) ||
    windowEnded;
  const hasBacklog = showPendingAlert && pendingCount > 0;

  // --- Hero copy -----------------------------------------------------------
  const firstName = customerName?.trim().split(/\s+/)[0] || null;
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

  const motivation = !started
    ? isNewKitPending
      ? "Your fresh kit is on its way. The moment it reaches you, confirm arrival and pick up right where you left off."
      : "Your kit is on its way. Confirm the day it arrives and your wellness journey begins."
    : journeyComplete
      ? "You've completed this kit. Every meal you logged is progress that stays with you."
      : windowEnded
        ? `Your kit window has ended, but ${mealsRemaining} ${mealsRemaining === 1 ? "meal is" : "meals are"} still yours. Log the days below and your end date moves back out.`
        : pendingCount >= 3
          ? "Your tracker has gaps, so your dietitian can't see how you're really doing. Fill them in below and your guidance gets accurate again."
          : pendingCount > 0
            ? "You're doing the work — your tracker just needs to catch up so your dietitian can see it."
            : adherence === 100 && mealsTaken > 0
              ? "Every single day logged. This consistency is exactly what makes a plan work."
              : "You're building real momentum. Keep going, one nourishing meal at a time.";

  const milestone = !started
    ? "Your kit is on its way"
    : journeyComplete
      ? "Kit complete — incredible work!"
      : windowEnded
        ? `${mealsRemaining} ${mealsRemaining === 1 ? "meal" : "meals"} still unlogged`
        : pendingCount > 0
          ? `${pendingCount} ${pendingCount === 1 ? "day needs" : "days need"} logging`
          : "Fully logged — beautiful consistency";

  // --- Zone: today's focus -------------------------------------------------
  const todayLog = logByDate.get(todayStr);
  let todayState: TodayFocusState = "active";
  let todayTitle = "Log today's kit meal";
  let todayEyebrow = "Your kit journey";
  let todayDescription: string | null = null;
  let todayTagLabel: string | null = null;
  let todayTagClass = "";
  let todayBadgeLabel = "Today";
  let todayCtaLabel = "Open KIT tracker";

  if (!started) {
    todayTitle = "Your kit is on its way";
    todayEyebrow = "Arriving soon";
    todayBadgeLabel = "In transit";
    todayDescription =
      "As soon as your package reaches you, confirm the arrival date. Your day-by-day tracker unlocks right after that.";
    todayTagLabel = "Confirm arrival";
    todayTagClass = "border-amber-200 bg-amber-50 text-amber-700";
    todayCtaLabel = "Confirm kit arrival";
  } else if (journeyComplete) {
    todayState = "empty";
    todayTitle = "This kit is complete";
  } else if (windowEnded) {
    todayState = "empty";
    todayTitle = "Your kit window has ended";
  } else if (todayLog === "FOOD_TAKEN") {
    todayTitle = "Today's meal logged";
    todayEyebrow = "Logged with care";
    todayDescription =
      "Beautifully done. Every logged meal brings you one step closer to your transformation.";
    todayTagLabel = "Taken";
    todayTagClass = "border-emerald-200 bg-emerald-50 text-emerald-700";
    todayCtaLabel = "View KIT tracker";
  } else if (todayLog === "FOOD_SKIPPED") {
    todayState = "paused";
  } else if (hasBacklog) {
    // Today is already listed in the alert's logger — don't offer a second,
    // competing primary action for the same task.
    todayDescription =
      "Today is included in the days waiting above. Log it there, or open the full tracker for the complete picture.";
    todayTagLabel = "To log";
    todayTagClass = "border-amber-200 bg-amber-50 text-amber-700";
  } else {
    todayDescription =
      "Enjoy today's kit meal, then log it right here. Weight and activity are optional extras.";
    todayTagLabel = "To log";
    todayTagClass = "border-amber-200 bg-amber-50 text-amber-700";
  }

  // Inline logger placement: the backlog card owns it when days are missing,
  // otherwise it belongs to Today's card. Never both.
  // In the windowEnded state this logger is the only way to recover days (the
  // full tracker shows an expiry screen), so it offers a longer batch.
  const quickLogLimit = windowEnded
    ? QUICK_LOG_LIMIT_RECOVERY
    : QUICK_LOG_LIMIT;
  const quickLogDays: QuickLogDay[] = hasBacklog
    ? [
        ...pendingDates.slice(-quickLogLimit).map((date) => ({ date })),
        ...(todayPending ? [{ date: todayStr, isToday: true }] : []),
      ]
    : [];
  const shownPending = Math.min(pendingCount, quickLogLimit);
  const showTodayInlineLog =
    started && !journeyComplete && !hasBacklog && todayPending;

  // --- Zone: momentum ------------------------------------------------------
  const momentumStats: MomentumStat[] = [
    {
      icon: CalendarCheck,
      value: mealsTaken,
      label: "meals enjoyed",
      tone: "green",
    },
    {
      icon: Flame,
      value: streak,
      label: "day logging streak",
      tone: "coral",
    },
    { icon: Moon, value: restDays, label: "rest days taken", tone: "amber" },
  ];

  const momentumCaption = !started
    ? `Your ${durationDays}-day kit is packed and on its way — your journey starts the day it arrives.`
    : streak >= 3
      ? `${streak} days logged in a row — that consistency is what your dietitian works from.`
      : `${loggedDays} of ${elapsedDays} days accounted for since your kit arrived.`;

  // --- Zone: the whole kit window as one map -------------------------------
  // A seven-day strip here would just repeat the days the alert already lists.
  // The entire window is information nothing else on the page carries.
  const mapDays: KitMapDay[] = [];
  if (receivedDate) {
    const lastMapDate =
      trackerEndStr && trackerEndStr >= todayStr ? trackerEndStr : todayStr;
    const total = Math.min(
      60,
      Math.max(1, differenceInCalendarDays(parseISO(lastMapDate), receivedDate) + 1),
    );
    for (let i = 0; i < total; i += 1) {
      const dateStr = format(addDays(receivedDate, i), "yyyy-MM-dd");
      const logged = logByDate.get(dateStr);
      const status: KitMapStatus =
        logged === "FOOD_TAKEN"
          ? "taken"
          : logged === "FOOD_SKIPPED"
            ? "rest"
            : dateStr <= todayStr
              ? "pending"
              : "upcoming";
      mapDays.push({ date: dateStr, status });
    }
  }

  const statusChip = isNewKitPending
    ? {
        label: "Pending",
        className: "border-amber-200 bg-amber-50 text-amber-700",
      }
    : journeyComplete
      ? {
          label: "Completed",
          className: "border-slate-200 bg-slate-50 text-slate-600",
        }
      : windowEnded
        ? {
            label: "Window ended",
            className: "border-rose-200 bg-rose-50 text-rose-700",
          }
        : {
            label: started ? "Active" : "Paid",
            className: "border-emerald-200 bg-emerald-50 text-emerald-700",
          };

  return (
    <div className="relative z-10 mx-auto max-w-5xl space-y-6 sm:space-y-8">
      {/* ZONE 1 — Wellness journey. Same hero as the meal dashboard; the ring
          measures how much of the tracker is filled in, so it can never
          congratulate a customer who has stopped logging. */}
      <JourneyHeader
        greeting={journeyGreeting}
        planName={`${productName} (${durationDays} Days)`}
        dayCurrent={calendarDay}
        dayTotal={windowDays}
        progress={adherence}
        daysRemaining={mealsRemaining}
        motivation={motivation}
        code={subscription.subscription_code}
        ringLabel="Logged"
        extraChip={
          started ? `${mealsTaken} of ${durationDays} meals logged` : undefined
        }
        headlinePrimary={started ? `Day ${calendarDay}` : "Arriving soon"}
        headlineSecondary={
          started
            ? "of your kit journey"
            : `— your ${durationDays}-day kit journey`
        }
        milestone={milestone}
      />

      {/* ZONE 2 — Accountability, with the fix built in. Placed before anything
          enjoyable, because a blank day is a blind spot for the dietitian. */}
      {showPendingAlert && (
        <PendingLogsAlert
          pendingDates={pendingDates}
          todayPending={todayPending}
          lastLoggedDate={lastLoggedDate}
          restRun={restRun}
          shownCount={shownPending}
          variant={windowEnded ? "windowEnded" : "backlog"}
          mealsRemaining={mealsRemaining}
          windowEndDate={trackerEndStr}
        >
          {quickLogDays.length > 0 ? (
            <KitQuickLog
              subscriptionId={subscription.id}
              days={quickLogDays}
            />
          ) : null}
        </PendingLogsAlert>
      )}

      {isNewKitPending && (
        <Link href="/kit-tracker" className="block">
          <Card className="rounded-2xl border border-amber-200 bg-amber-50/50 shadow-sm transition-all duration-200 hover:border-amber-300 hover:shadow-md">
            <CardContent className="flex items-center gap-4 p-6">
              <div className="shrink-0 rounded-full bg-amber-100 p-3 text-amber-700">
                <Package className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-amber-900">
                  A fresh kit is on the way
                </p>
                <p className="mt-1 text-sm leading-relaxed text-amber-800/90">
                  Your previous kit has finished and a new one has been ordered
                  for you. Confirm arrival in
                  <span className="font-bold"> KIT Tracker</span> to continue
                  your journey.
                </p>
              </div>
              <ArrowRight className="h-5 w-5 shrink-0 text-amber-700" />
            </CardContent>
          </Card>
        </Link>
      )}

      {/* ZONE 3 — Today's focus */}
      <TodayFocusCard
        state={todayState}
        dateLabel={format(now, "EEEE, dd MMM")}
        title={todayTitle}
        eyebrow={todayEyebrow}
        description={todayDescription}
        tagLabel={todayTagLabel}
        tagClassName={todayTagClass}
        badgeLabel={todayBadgeLabel}
        badgeIcon={started ? undefined : Truck}
        images={KIT_MEAL_IMAGES}
        ctaHref="/kit-tracker"
        ctaLabel={todayCtaLabel}
        emptyText={
          windowEnded
            ? `Your window closed with ${mealsRemaining} ${mealsRemaining === 1 ? "meal" : "meals"} unlogged. Log the days above and your end date moves back out.`
            : "You've logged every meal in this kit. Your report is ready in KIT History."
        }
        pausedHeadline="Today is a rest day"
        pausedDescription="You've marked today as a rest day. Your kit end date shifts by a day automatically — no meal is ever lost."
        pausedCtaHref="/kit-tracker"
        pausedCtaLabel="Open KIT tracker"
      >
        {showTodayInlineLog ? (
          <KitQuickLog
            subscriptionId={subscription.id}
            days={[{ date: todayStr, isToday: true }]}
            variant="single"
          />
        ) : null}
      </TodayFocusCard>

      {/* ZONE 4 — Momentum */}
      <MomentumStrip stats={momentumStats} caption={momentumCaption} />

      {/* ZONE 5 — The whole kit, one map */}
      {mapDays.length > 0 && (
        <div
          className="reveal-rise"
          style={{ ["--reveal-delay" as string]: "1450ms" }}
        >
          <div className="mb-3 flex items-center gap-3">
            <h2 className="text-lg font-semibold tracking-tight text-slate-900">
              Your kit at a glance
            </h2>
            <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-700">
              Full journey
            </span>
          </div>
          <KitJourneyMap days={mapDays} todayDate={todayStr} />
        </div>
      )}

      {/* ZONE 6 — Manage your kit */}
      <div
        className="reveal-rise space-y-4"
        style={{ ["--reveal-delay" as string]: "1600ms" }}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold tracking-tight text-slate-900">
            Manage your kit
          </h2>
          <span
            className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-wider ${statusChip.className}`}
          >
            <CheckCircle2 className="h-3.5 w-3.5" /> {statusChip.label}
          </span>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:gap-5 md:grid-cols-3">
          <Card className="rounded-2xl border border-slate-200 bg-white shadow-sm md:col-span-2">
            <CardHeader className="border-b border-slate-100 bg-emerald-50/40 px-6 py-4">
              <CardTitle className="flex items-center gap-2 text-base font-semibold text-slate-900">
                <CalendarDays className="h-5 w-5 text-emerald-600" />
                Kit Timeline
              </CardTitle>
            </CardHeader>
            <CardContent className="p-6">
              <div className="flex flex-col justify-between gap-6 sm:flex-row sm:items-end">
                <div>
                  <h3 className="mb-1 text-xl font-semibold text-slate-900">
                    {productName}
                  </h3>
                  <p className="text-sm text-slate-500">
                    {durationDays} Meals Total
                  </p>
                </div>
                <div className="flex gap-6 text-sm sm:gap-8">
                  <div className="space-y-1">
                    <p className="text-xs font-medium uppercase tracking-wider text-slate-500">
                      Start Date
                    </p>
                    <p className="font-semibold text-slate-900">
                      {receivedDate
                        ? format(receivedDate, "MMM do, yyyy")
                        : "Not started"}
                    </p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs font-medium uppercase tracking-wider text-slate-500">
                      Est. End Date
                    </p>
                    <p className="font-semibold text-slate-900">
                      {trackerEndDate
                        ? format(trackerEndDate, "MMM do, yyyy")
                        : "N/A"}
                    </p>
                  </div>
                </div>
              </div>

              <div className="mt-8 grid grid-cols-1 gap-5 border-t border-slate-100 pt-6 sm:grid-cols-2">
                <div className="flex items-center gap-4">
                  <div className="shrink-0 rounded-full bg-orange-50 p-3 text-orange-600">
                    <Utensils className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="text-sm text-slate-500">Meals enjoyed</p>
                    <p className="font-semibold text-slate-900">
                      {mealsTaken} of {durationDays}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <div className="shrink-0 rounded-full bg-slate-100 p-3 text-slate-500">
                    <Moon className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="text-sm text-slate-500">Rest days taken</p>
                    <p className="font-semibold text-slate-900">
                      {restDays}{" "}
                      <span className="text-sm font-normal text-slate-500">
                        {restDays === 1 ? "day" : "days"}
                      </span>
                    </p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Progress measured as work done, never as stock remaining — a bar
              that fills while the customer does nothing is a lie. */}
          <Card className="flex flex-col rounded-2xl border border-slate-200 bg-white shadow-sm">
            <CardHeader className="border-b border-slate-100 bg-emerald-50/40 px-6 py-4">
              <CardTitle className="flex items-center gap-2 text-base font-semibold text-slate-900">
                <Utensils className="h-5 w-5 text-emerald-600" />
                Kit Progress
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-1 flex-col justify-center p-6">
              <div className="mb-2 flex items-end justify-between">
                <span className="text-3xl font-semibold text-slate-900">
                  {mealsTaken}
                </span>
                <span className="mb-1 text-sm font-semibold text-slate-500">
                  of {durationDays} meals logged
                </span>
              </div>
              <div
                className="mt-4 h-2.5 w-full overflow-hidden rounded-full bg-slate-100"
                role="progressbar"
                aria-valuenow={mealsTaken}
                aria-valuemin={0}
                aria-valuemax={durationDays}
                aria-label="Meals logged in this kit"
              >
                <div
                  className="h-full rounded-full bg-emerald-500 transition-all duration-500"
                  style={{
                    width: `${Math.round((mealsTaken / durationDays) * 100)}%`,
                  }}
                />
              </div>
              <p className="mt-4 text-xs leading-relaxed text-slate-500">
                {journeyComplete
                  ? "Every meal in this kit is accounted for. Your full report is in KIT History."
                  : `${mealsRemaining} ${mealsRemaining === 1 ? "meal" : "meals"} still to enjoy. Rest whenever you need — every rest day you log pushes your end date out by a day, so nothing is ever lost.`}
              </p>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* ZONE 7 — Real transformation. Deliberately after the customer's own
          data: aspiration should never sit above unfinished business. */}
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

      {/* ZONE 8 — Delivery & order. Reference material: one rail, one compact
          receipt line, no full-height card for a price the customer paid once. */}
      <div
        className="reveal-rise space-y-4"
        style={{ ["--reveal-delay" as string]: "1900ms" }}
      >
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-semibold tracking-tight text-slate-900">
            Delivery &amp; order
          </h2>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-0.5 font-mono text-xs font-semibold text-slate-600">
            <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" />
            {subscription.subscription_code ?? "Pending"}
          </span>
        </div>

        <ShippingTracker
          shippingInfo={shippingInfo}
          receivedOn={receivedDateStr}
        />

        <Card className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <CardContent className="flex flex-wrap items-center gap-x-8 gap-y-4 p-5">
            <div className="flex items-center gap-3">
              <div className="shrink-0 rounded-full bg-emerald-50 p-2.5 text-emerald-600">
                <Wallet className="h-4 w-4" />
              </div>
              <div>
                <p className="text-xs font-medium uppercase tracking-wider text-slate-500">
                  Total paid
                </p>
                <p className="font-semibold text-slate-900">
                  {formatCurrency(totalPrice)}
                  <span className="ml-1.5 text-xs font-normal text-slate-500">
                    incl. {(taxRate * 100).toFixed(0)}% tax
                  </span>
                </p>
              </div>
            </div>

            <div>
              <p className="text-xs font-medium uppercase tracking-wider text-slate-500">
                Base price
              </p>
              <p className="font-semibold text-slate-900">
                {formatCurrency(basePrice)}
              </p>
            </div>

            <div>
              <p className="text-xs font-medium uppercase tracking-wider text-slate-500">
                Ordered on
              </p>
              <p className="font-semibold text-slate-900">
                {subscription.starts_on
                  ? format(parseISO(subscription.starts_on), "MMM do, yyyy")
                  : "—"}
              </p>
            </div>

            <Link
              href="/subscription/manage/billing"
              className="group ml-auto inline-flex items-center gap-1.5 text-sm font-semibold text-emerald-700 underline-offset-4 transition-colors hover:underline"
            >
              Billing
              <ArrowRight className="h-3.5 w-3.5 transition-transform duration-200 group-hover:translate-x-0.5" />
            </Link>
          </CardContent>
        </Card>
      </div>

      {/* ZONE 9 — Shortcuts */}
      <div
        className="reveal-rise grid grid-cols-1 gap-4 md:grid-cols-3"
        style={{ ["--reveal-delay" as string]: "2050ms" }}
      >
        {[
          {
            href: "/kit-tracker",
            icon: ClipboardCheck,
            title: "KIT Tracker",
            subtitle: "Your full day-by-day log",
            tone: "bg-emerald-100 text-emerald-700",
          },
          {
            href: "/kit-history",
            icon: History,
            title: "KIT History",
            subtitle: "Past kits & reports",
            tone: "bg-blue-100 text-blue-600",
          },
          {
            href: "/subscription/manage/billing",
            icon: CreditCard,
            title: "Billing",
            subtitle: "Invoices & payments",
            tone: "bg-amber-100 text-amber-700",
          },
        ].map((link) => {
          const Icon = link.icon;
          return (
            <Link key={link.href} href={link.href} className="block">
              <Card className="h-full rounded-2xl border border-slate-200 bg-white shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-emerald-200 hover:shadow-md">
                <CardContent className="flex items-center gap-3 p-5">
                  <div className={`shrink-0 rounded-full p-2.5 ${link.tone}`}>
                    <Icon className="h-5 w-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-slate-900">
                      {link.title}
                    </p>
                    <p className="text-xs text-slate-500">{link.subtitle}</p>
                  </div>
                  <ArrowRight className="h-4 w-4 shrink-0 text-slate-400" />
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
