import Link from "next/link";
import { ArrowRight, PauseCircle, CalendarClock } from "lucide-react";
import { cn } from "@/lib/utils";
import { StatusPill } from "@/shared/components/customer/profile-ui/StatusPill";
import { JourneyIllustration } from "./journey-illustrations";
import { getMealJourneyVisual } from "./meal-journey-status";
import type { AddonProductLine } from "./SubscriptionTimeline";

/**
 * TodayMealJourneyCard — the hero of My Meals.
 *
 * Design intent: the backend `delivery_orders.status` value must never be
 * the hero. Every real status resolves (via meal-journey-status.ts) to a
 * human headline + reassuring body copy + a full-bleed illustration scene;
 * the raw status is demoted to a small secondary pill in the corner —
 * supporting the story, never telling it.
 *
 * Craftsmanship pass: the illustration panel is now a full-height gradient
 * scene (not a bare icon in a flat rectangle) and takes a full 45% of the
 * card on desktop / a tall band on mobile, so this reads as the strongest
 * visual moment on the page rather than its thinnest.
 */
export function TodayMealJourneyCard({
  isPaused,
  status,
  orderId,
  addons,
}: {
  isPaused: boolean;
  /** Real delivery_orders.status for today, or null when no order exists yet. */
  status: string | null;
  orderId: string | null;
  addons: AddonProductLine[];
}) {
  if (isPaused) {
    return (
      <section
        className="reveal-rise overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm"
        style={{ ["--reveal-delay" as string]: "550ms" }}
      >
        <div className="flex flex-col sm:flex-row sm:min-h-[15rem]">
          <div className="h-40 w-full shrink-0 sm:h-auto sm:w-[45%]">
            <JourneyIllustration id="paused" tone="slate" />
          </div>
          <div className="flex flex-1 items-center gap-4 p-6 sm:p-8">
            <PauseCircle className="h-7 w-7 shrink-0 text-slate-400" />
            <div>
              <p className="text-lg font-semibold text-slate-700">Resting today</p>
              <p className="text-sm leading-relaxed text-slate-500">
                Your delivery is paused for today. It&apos;ll resume automatically on schedule.
              </p>
            </div>
          </div>
        </div>
      </section>
    );
  }

  if (!status) {
    return (
      <section
        className="reveal-rise overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm"
        style={{ ["--reveal-delay" as string]: "550ms" }}
      >
        <div className="flex flex-col sm:flex-row sm:min-h-[15rem]">
          <div className="h-40 w-full shrink-0 sm:h-auto sm:w-[45%]">
            <JourneyIllustration id="empty" tone="slate" />
          </div>
          <div className="flex flex-1 items-center gap-4 p-6 sm:p-8">
            <CalendarClock className="h-7 w-7 shrink-0 text-slate-400" />
            <div>
              <p className="text-lg font-semibold text-slate-700">
                Nothing scheduled today
              </p>
              <p className="text-sm leading-relaxed text-slate-500">
                No delivery scheduled for today. Enjoy your day!
              </p>
            </div>
          </div>
        </div>
      </section>
    );
  }

  const visual = getMealJourneyVisual(status);
  const cta = visual.cta?.({ orderId }) ?? null;

  const borderTone =
    visual.tone === "amber"
      ? "border-amber-200"
      : visual.tone === "green"
        ? "border-emerald-200"
        : visual.tone === "blue"
          ? "border-blue-200"
          : visual.tone === "orange"
            ? "border-orange-200"
            : "border-slate-200";

  const ctaButton = cta ? (
    cta.external ? (
      <a
        href={cta.href}
        target="_blank"
        rel="noopener noreferrer"
        className="group mt-2 inline-flex w-fit items-center justify-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground shadow-sm transition-all duration-200 hover:shadow-md hover:brightness-105 active:scale-[0.98]"
      >
        {cta.label}
        <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5" />
      </a>
    ) : (
      <Link
        href={cta.href}
        className="group mt-2 inline-flex w-fit items-center justify-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground shadow-sm transition-all duration-200 hover:shadow-md hover:brightness-105 active:scale-[0.98]"
      >
        {cta.label}
        <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5" />
      </Link>
    )
  ) : null;

  return (
    <section
      className={cn(
        "reveal-rise overflow-hidden rounded-3xl border bg-white shadow-sm",
        borderTone,
      )}
      style={{ ["--reveal-delay" as string]: "550ms" }}
    >
      <div className="flex flex-col sm:flex-row sm:min-h-[17rem]">
        <div className="h-48 w-full shrink-0 sm:h-auto sm:w-[45%]">
          <JourneyIllustration id={visual.illustration} tone={visual.tone} />
        </div>

        <div className="flex flex-1 flex-col justify-center gap-3 p-6 sm:p-8">
          <div className="flex items-start justify-between gap-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              {visual.eyebrow}
            </p>
            {/* Tiny secondary pill — the ONLY place the real workflow state
                surfaces, deliberately small and quiet. */}
            <StatusPill tone={visual.pillTone} className="shrink-0">
              {visual.pillLabel}
            </StatusPill>
          </div>

          <h3 className="text-2xl font-semibold tracking-tight text-slate-900 sm:text-[1.75rem]">
            {visual.headline}
          </h3>

          <p className="text-sm leading-relaxed text-slate-600">{visual.body}</p>

          {addons.length > 0 ? (
            <p className="text-xs text-slate-500">
              📦 Includes: {addons.map((a) => `${a.name} (x${a.quantity})`).join(", ")}
            </p>
          ) : null}

          {ctaButton}
        </div>
      </div>
    </section>
  );
}
