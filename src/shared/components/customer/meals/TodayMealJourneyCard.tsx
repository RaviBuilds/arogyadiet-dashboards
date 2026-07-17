import Link from "next/link";
import { ArrowRight, PauseCircle, CalendarClock } from "lucide-react";
import { cn } from "@/lib/utils";
import { StatusPill } from "@/shared/components/customer/profile-ui/StatusPill";
import { JourneyIllustration } from "./journey-illustrations";
import {
  getMealJourneyStageIndex,
  getMealJourneyVisual,
} from "./meal-journey-status";
import { MealJourneyStepper } from "./MealJourneyStepper";
import { MealDetailsToggle } from "./MealDetailsToggle";
import type { AddonProductLine } from "./SubscriptionTimeline";

/**
 * TodayMealJourneyCard — the emotional highlight of My Meals.
 *
 * Answers one question: "where is my breakmealfast right now?" Every real
 * status resolves (via meal-journey-status.ts) to a human headline +
 * reassuring body copy + a full-bleed illustrated scene + a quiet stage
 * indicator; the raw backend status is demoted to a small secondary pill —
 * supporting the story, never telling it.
 *
 * The illustration and the text share one continuous background wash
 * (rather than a hard-edged icon panel butted against a plain white text
 * panel) so the two halves read as a single composition — the scene bleeds
 * its tone in behind the copy instead of stopping dead at a border.
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
  const stageIndex = getMealJourneyStageIndex(status);

  const borderTone =
    visual.tone === "amber"
      ? "border-amber-200"
      : visual.tone === "green"
        ? "border-emerald-200"
        : visual.tone === "orange"
          ? "border-orange-200"
          : "border-slate-200";

  const washTone =
    visual.tone === "amber"
      ? "from-amber-50/80"
      : visual.tone === "green"
        ? "from-emerald-50/80"
        : visual.tone === "orange"
          ? "from-orange-50/80"
          : "from-slate-50/80";

  const ctaButton =
    cta?.kind === "expand" ? (
      <MealDetailsToggle />
    ) : cta?.kind === "external" ? (
      <a
        href={cta.href}
        target="_blank"
        rel="noopener noreferrer"
        className="group mt-2 inline-flex w-fit items-center justify-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground shadow-sm transition-all duration-200 hover:shadow-md hover:brightness-105 active:scale-[0.98]"
      >
        {cta.label}
        <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5" />
      </a>
    ) : cta?.kind === "link" ? (
      <Link
        href={cta.href}
        className="group mt-2 inline-flex w-fit items-center justify-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground shadow-sm transition-all duration-200 hover:shadow-md hover:brightness-105 active:scale-[0.98]"
      >
        {cta.label}
        <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5" />
      </Link>
    ) : null;

  return (
    <section
      className={cn(
        "reveal-rise relative overflow-hidden rounded-3xl border bg-white shadow-sm",
        borderTone,
      )}
      style={{ ["--reveal-delay" as string]: "550ms" }}
    >
      {/* Shared wash bleeding from the illustration into the text panel, so
          both halves read as one scene rather than two disconnected blocks. */}
      <div
        className={cn(
          "pointer-events-none absolute inset-0 bg-gradient-to-r to-transparent sm:to-70%",
          washTone,
        )}
      />

      <div className="relative flex flex-col sm:flex-row sm:min-h-[18rem]">
        <div className="h-48 w-full shrink-0 sm:h-auto sm:w-[45%]">
          <JourneyIllustration id={visual.illustration} tone={visual.tone} />
        </div>

        <div className="relative flex flex-1 flex-col justify-center gap-3 p-6 sm:p-8">
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

          {stageIndex !== null ? (
            <div className="mt-3 pt-3">
              <MealJourneyStepper stageIndex={stageIndex} />
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
