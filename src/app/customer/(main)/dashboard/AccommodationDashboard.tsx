import Link from "next/link";
import { format, parseISO, differenceInCalendarDays } from "date-fns";
import {
  BedDouble,
  CalendarDays,
  Users,
  ArrowRight,
  Droplet,
  FileText,
  Sparkles,
  MessageCircle,
  CheckCircle2,
  Moon,
  CalendarCheck,
  Utensils,
  Hourglass,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/shared/components/ui/card";
import { Button } from "@/shared/components/ui/button";
import { JourneyHeader } from "@/shared/components/customer/dashboard/JourneyHeader";
import {
  MomentumStrip,
  type MomentumStat,
} from "@/shared/components/customer/dashboard/MomentumStrip";
import { TransformationSpotlight } from "@/shared/components/customer/dashboard/TransformationSpotlight";
import { PropertyWelcomeBanner } from "@/shared/components/customer/dashboard/PropertyWelcomeBanner";
import { MEAL_THEMES } from "@/shared/components/customer/dashboard/meal-theme";
import { cn } from "@/lib/utils";
import type { StayEntry, StayStatus } from "@/types/accommodation";

/** Same WhatsApp support surface used app-wide (FloatingSupportMenu / dashboard). */
const SUPPORT_WHATSAPP_NUMBER = "918639659020";
const BOOKING_WHATSAPP_URL = `https://wa.me/${SUPPORT_WHATSAPP_NUMBER}?text=Hi%2C%20I%27d%20like%20to%20arrange%20an%20accommodation%20stay.`;

/** Real Arogya Gramam property photography: the farmhouse entrance gate,
 *  cross-fading into an aerial view of the villas and gardens guests stay
 *  in. Gives the accommodation dashboard the same "sense of place" a meal
 *  customer gets from food photography. */
const PROPERTY_IMAGES = ["/arogya-main%20gate%20main.jpg", "/Arogya1.jpg"];

/**
 * ACCOMMODATION-specific customer dashboard component.
 *
 * Shares the meal dashboard's design system and reveal choreography — same
 * hero journey header, Today's focus card, momentum strip and
 * transformation spotlight — with every number reframed around nights of
 * stay instead of meals: "Day X of your N-night stay", nights completed /
 * remaining, and today's focus is the stay itself rather than a delivery.
 *
 * getActiveStayAction only ever returns an ACTIVE stay or the earliest
 * PENDING one (never FINISHED/EXPIRED — those live on Stay History), so this
 * component only needs to render those two states.
 *
 * Requirements: 8.1, 8.2
 */

const STATUS_CHIP_STYLES: Record<StayStatus, string> = {
  PENDING: "border-amber-200 bg-amber-50 text-amber-700",
  ACTIVE: "border-emerald-200 bg-emerald-50 text-emerald-700",
  FINISHED: "border-slate-200 bg-slate-50 text-slate-700",
  EXPIRED: "border-red-200 bg-red-50 text-red-700",
};

const MEAL_PREFERENCE_LABELS: Record<StayEntry["mealPreference"], string> = {
  VEG: "Veg",
  EGG: "Egg",
  CHICKEN: "Chicken",
};

interface AccommodationDashboardProps {
  stay: StayEntry | null;
  /** Customer's full name, used for the time-aware greeting. */
  customerName?: string | null;
}

export function AccommodationDashboard({
  stay,
  customerName,
}: AccommodationDashboardProps) {
  if (!stay) {
    return (
      <div className="relative z-10 mx-auto max-w-4xl">
        <Card
          className="reveal-rise relative overflow-hidden rounded-3xl border border-dashed border-slate-200 bg-white text-center shadow-sm"
          style={{ ["--reveal-delay" as string]: "150ms" }}
        >
          {/* Soft decorative glow, echoing the hero's light-and-nature motif
              without needing the full gradient treatment on an empty state. */}
          <div className="pointer-events-none absolute -top-16 left-1/2 h-56 w-56 -translate-x-1/2 rounded-full bg-emerald-100/60 blur-3xl" />
          <CardContent className="relative flex flex-col items-center gap-4 px-6 py-16 sm:px-10">
            <div className="mb-2 flex h-20 w-20 items-center justify-center rounded-full bg-emerald-50 text-emerald-500">
              <BedDouble className="h-10 w-10" />
            </div>
            <h2 className="text-xl font-semibold tracking-tight text-slate-900">
              No Upcoming or Active Stay
            </h2>
            <p className="max-w-md text-sm leading-relaxed text-slate-500">
              You don&apos;t have an upcoming or active stay yet. Reach out to
              our team and we&apos;ll get your accommodation booking sorted.
            </p>
            <a
              href={BOOKING_WHATSAPP_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="group mt-3 inline-flex w-fit items-center justify-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground shadow-sm transition-all duration-200 hover:shadow-md hover:brightness-105 active:scale-[0.98]"
            >
              <MessageCircle className="h-4 w-4" />
              Contact Our Team
            </a>
          </CardContent>
        </Card>
      </div>
    );
  }

  const now = new Date();
  const startDate = parseISO(stay.startDate);
  const endDate = parseISO(stay.endDate);
  const isPending = stay.status === "PENDING";

  const remainingNights = Math.max(0, differenceInCalendarDays(endDate, now));
  const currentDay = isPending
    ? 0
    : Math.min(
        stay.totalNights,
        Math.max(1, stay.totalNights - remainingNights),
      );
  const nightsCompleted = isPending ? 0 : Math.max(0, currentDay - 1);
  const progressPercent = isPending
    ? 0
    : Math.min(100, Math.round((currentDay / stay.totalNights) * 100));
  const daysUntilStart = isPending
    ? Math.max(0, differenceInCalendarDays(startDate, now))
    : 0;

  const mealLabel = MEAL_PREFERENCE_LABELS[stay.mealPreference];
  const mealTheme = MEAL_THEMES[stay.mealPreference] ?? MEAL_THEMES.VEG;

  // --- Hero copy -------------------------------------------------------
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

  const motivation = isPending
    ? daysUntilStart === 0
      ? "Today's the day! Your stay begins today — everything will be ready for your arrival."
      : `Your stay is booked and ready. Just ${daysUntilStart} ${daysUntilStart === 1 ? "day" : "days"} until you check in.`
    : progressPercent < 15
      ? "You've just settled in. Take it easy and let your wellness journey unfold."
      : progressPercent < 50
        ? "You're building real momentum. Enjoy every moment of your stay."
        : progressPercent < 85
          ? "You're past the halfway mark — your stay is truly flying by."
          : "You're in the final stretch of your stay. Make the most of it!";

  const milestone = isPending
    ? daysUntilStart === 0
      ? "Arriving today"
      : `Arriving in ${daysUntilStart} ${daysUntilStart === 1 ? "day" : "days"}`
    : progressPercent >= 100
      ? "Stay complete — hope you loved it!"
      : progressPercent >= 75
        ? `Final stretch — ${remainingNights} nights to go`
        : progressPercent >= 50
          ? "Past the halfway mark"
          : progressPercent >= 25
            ? "Great momentum — keep it up"
            : "Your stay has begun";

  // --- Momentum stats ---------------------------------------------------
  const momentumStats: MomentumStat[] = [
    {
      icon: CalendarCheck,
      value: nightsCompleted,
      label: "nights completed",
      tone: "green",
    },
    {
      icon: Moon,
      value: remainingNights,
      label: "nights remaining",
      tone: "coral",
    },
    {
      icon: BedDouble,
      value: stay.totalNights,
      label: "total nights",
      tone: "amber",
    },
  ];

  const momentumCaption = isPending
    ? `Your ${stay.totalNights}-night stay at ArogyaDiet is all set — it starts ${format(startDate, "MMM do, yyyy")}.`
    : `You've enjoyed ${nightsCompleted} of ${stay.totalNights} nights — every day here is time well spent.`;

  const statusChip = {
    label: stay.status,
    className: STATUS_CHIP_STYLES[stay.status],
  };

  return (
    <div className="relative z-10 mx-auto max-w-5xl space-y-6 sm:space-y-8">
      {/* ZONE 1 — Wellness journey hero, shared with the meal & KIT dashboards */}
      <JourneyHeader
        greeting={journeyGreeting}
        planName={`${stay.stayType} · ${stay.occupancyType} Occupancy`}
        dayCurrent={isPending ? 0 : currentDay}
        dayTotal={stay.totalNights}
        progress={progressPercent}
        daysRemaining={remainingNights}
        motivation={motivation}
        extraChip={`Meal: ${mealLabel}`}
        headlinePrimary={isPending ? "Almost there" : `Day ${currentDay}`}
        headlineSecondary={
          isPending
            ? `— your ${stay.totalNights}-night stay`
            : `of your ${stay.totalNights}-night stay`
        }
        milestone={milestone}
      />

      {/* ZONE 1B — A sense of place: real Arogya Gramam photography */}
      <PropertyWelcomeBanner
        images={PROPERTY_IMAGES}
        stayTypeLabel={stay.stayType}
      />

      {/* ZONE 2 — Today's focus */}
      <section
        className="reveal-rise relative overflow-hidden rounded-3xl border border-orange-100 bg-white shadow-sm"
        style={{ ["--reveal-delay" as string]: "1100ms" }}
      >
        <div className="relative p-6 sm:p-7">
          <div className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-orange-100/40 blur-2xl" />
          <div className="relative">
            <div className="mb-5 flex items-center justify-between">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-primary">
                {isPending ? (
                  <Hourglass className="h-3.5 w-3.5" />
                ) : (
                  <BedDouble className="h-3.5 w-3.5" />
                )}
                {isPending ? "Upcoming" : "Today"}
              </span>
              <span className="text-xs font-medium text-slate-500">
                {format(now, "EEEE, dd MMM")}
              </span>
            </div>

            <div className="flex flex-col gap-4">
              <div className="flex flex-wrap items-center gap-3">
                <h3 className="text-2xl font-semibold tracking-tight text-slate-900">
                  {isPending
                    ? `Your stay starts ${format(startDate, "MMM do")}`
                    : `Day ${currentDay} of your stay`}
                </h3>
                <span
                  className={cn(
                    "rounded-full border px-3 py-1 text-sm font-semibold tracking-wide",
                    mealTheme.bg,
                    mealTheme.text,
                    mealTheme.border,
                  )}
                >
                  {mealLabel}
                </span>
              </div>

              <p className="text-sm leading-relaxed text-slate-500">
                {isPending
                  ? `We can't wait to welcome you to our ${stay.stayType.toLowerCase()}. Everything will be ready for your arrival on ${format(startDate, "MMM do, yyyy")}.`
                  : `Enjoy your day at ArogyaDiet. Your ${mealLabel.toLowerCase()} meals are freshly prepared and your wellness team is here for you.`}
              </p>

              <div className="flex items-start gap-2 text-sm">
                <BedDouble className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                <div className="min-w-0">
                  <p className="font-semibold text-slate-700">
                    {stay.stayType} · {stay.occupancyType} Occupancy
                  </p>
                  <p className="text-slate-500">
                    {remainingNights} {remainingNights === 1 ? "night" : "nights"}{" "}
                    remaining
                  </p>
                </div>
              </div>

              <Link
                href="/stay-tracker"
                className="group mt-1 inline-flex w-fit items-center justify-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground shadow-sm transition-all duration-200 hover:shadow-md hover:brightness-105 active:scale-[0.98]"
              >
                {isPending ? "View stay details" : "Open Stay Tracker"}
                <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5" />
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* ZONE 3 — Momentum */}
      <MomentumStrip stats={momentumStats} caption={momentumCaption} />

      {/* ZONE 4 — Real transformation */}
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

      {/* ZONE 5 — Manage your stay */}
      <div
        className="reveal-rise space-y-4"
        style={{ ["--reveal-delay" as string]: "1600ms" }}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold tracking-tight text-slate-900">
            Manage your stay
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
                Stay Timeline
              </CardTitle>
            </CardHeader>
            <CardContent className="p-6">
              <div className="flex flex-col justify-between gap-6 sm:flex-row sm:items-end">
                <div>
                  <h3 className="mb-1 text-xl font-semibold text-slate-900">
                    {stay.stayType}
                  </h3>
                  <p className="text-sm text-slate-500">
                    {stay.totalNights} Nights Total
                  </p>
                </div>
                <div className="flex gap-6 text-sm sm:gap-8">
                  <div className="space-y-1">
                    <p className="text-xs font-medium uppercase tracking-wider text-slate-500">
                      Start Date
                    </p>
                    <p className="font-semibold text-slate-900">
                      {format(startDate, "MMM do, yyyy")}
                    </p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs font-medium uppercase tracking-wider text-slate-500">
                      End Date
                    </p>
                    <p className="font-semibold text-slate-900">
                      {format(endDate, "MMM do, yyyy")}
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
                    <p className="text-sm text-slate-500">Meal preference</p>
                    <p className="font-semibold text-slate-900">{mealLabel}</p>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <div className="shrink-0 rounded-full bg-slate-100 p-3 text-slate-500">
                    <Users className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="text-sm text-slate-500">Occupancy</p>
                    <p className="font-semibold text-slate-900">
                      {stay.occupancyType}
                    </p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="flex flex-col rounded-2xl border border-slate-200 bg-white shadow-sm">
            <CardHeader className="border-b border-slate-100 bg-emerald-50/40 px-6 py-4">
              <CardTitle className="flex items-center gap-2 text-base font-semibold text-slate-900">
                <Moon className="h-5 w-5 text-emerald-600" />
                Stay Progress
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-1 flex-col justify-center p-6">
              <div className="mb-2 flex items-end justify-between">
                <span className="text-3xl font-semibold text-slate-900">
                  {isPending ? 0 : currentDay}
                </span>
                <span className="mb-1 text-sm font-semibold text-slate-500">
                  of {stay.totalNights} nights
                </span>
              </div>
              <div
                className="mt-4 h-2.5 w-full overflow-hidden rounded-full bg-slate-100"
                role="progressbar"
                aria-valuenow={progressPercent}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label="Stay progress"
              >
                <div
                  className="h-full rounded-full bg-emerald-500 transition-all duration-500"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
              <p className="mt-4 text-xs leading-relaxed text-slate-500">
                {isPending
                  ? `Your stay hasn't started yet — check in on ${format(startDate, "MMM do, yyyy")}.`
                  : `${remainingNights} ${remainingNights === 1 ? "night" : "nights"} remaining. Make the most of every moment.`}
              </p>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* ZONE 6 — Quick links */}
      <div
        className="reveal-rise space-y-4"
        style={{ ["--reveal-delay" as string]: "1750ms" }}
      >
        <h2 className="text-lg font-semibold tracking-tight text-slate-900">
          Wellness & services
        </h2>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          <Link href="/health-logs" className="block">
            <Card className="h-full rounded-2xl border border-slate-200 bg-white shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md">
              <CardContent className="flex items-center gap-3 p-5">
                <div className="shrink-0 rounded-full bg-blue-100 p-2.5 text-blue-600">
                  <Droplet className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-slate-900">
                    My Health Logs
                  </p>
                  <p className="text-xs text-slate-500">Log daily activity</p>
                </div>
                <ArrowRight className="h-4 w-4 shrink-0 text-slate-400" />
              </CardContent>
            </Card>
          </Link>

          <Link href="/health-report" className="block">
            <Card className="h-full rounded-2xl border border-slate-200 bg-white shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md">
              <CardContent className="flex items-center gap-3 p-5">
                <div className="shrink-0 rounded-full bg-purple-100 p-2.5 text-purple-600">
                  <FileText className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-slate-900">
                    Health Report
                  </p>
                  <p className="text-xs text-slate-500">View checkup data</p>
                </div>
                <ArrowRight className="h-4 w-4 shrink-0 text-slate-400" />
              </CardContent>
            </Card>
          </Link>

          <Link href="/addon-services" className="block">
            <Card className="h-full rounded-2xl border border-slate-200 bg-white shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md">
              <CardContent className="flex items-center gap-3 p-5">
                <div className="shrink-0 rounded-full bg-amber-100 p-2.5 text-amber-600">
                  <Sparkles className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-slate-900">
                    Add-on Services
                  </p>
                  <p className="text-xs text-slate-500">
                    Request wellness services
                  </p>
                </div>
                <ArrowRight className="h-4 w-4 shrink-0 text-slate-400" />
              </CardContent>
            </Card>
          </Link>
        </div>

        <div className="flex justify-center pt-2">
          <Button asChild variant="outline" size="lg" className="min-h-11">
            <Link href="/stay-tracker">
              View Full Stay Tracker <ArrowRight className="ml-2 h-4 w-4" />
            </Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
