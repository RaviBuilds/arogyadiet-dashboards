import { Leaf } from "lucide-react";
import { ProgressRing } from "./ProgressRing";
import { cn } from "@/lib/utils";

/**
 * JourneyHeader — the emotional anchor of the wellness dashboard.
 *
 * Reusable across every customer type. Instead of reporting account status it
 * frames the customer's progress as a single ongoing wellness journey:
 * a warm greeting, "Day X of your N-day journey", a soft forest-green gradient
 * that echoes the Arogyagramam brand world, an encouraging line, and a
 * forward-looking "days to go" nudge.
 *
 * Meal, KIT and Accommodation dashboards all feed the same props; only the
 * labels differ (journey days / program days / stay days).
 */
type JourneyHeaderProps = {
  /** Warm, time-aware greeting, e.g. "Good morning". */
  greeting?: string;
  /** Plan / program name shown as a chip. */
  planName?: string | null;
  /** Current day within the journey (1-based). */
  dayCurrent: number;
  /** Total days in the journey. */
  dayTotal: number;
  /** Completion percentage 0–100 (usually dayCurrent/dayTotal). */
  progress: number;
  /** Days still remaining in the journey. */
  daysRemaining?: number;
  /** Short, warm motivational sentence. */
  motivation: string;
  /** Optional identifier chip (e.g. subscription code). */
  code?: string | null;
};

export function JourneyHeader({
  greeting,
  planName,
  dayCurrent,
  dayTotal,
  progress,
  daysRemaining,
  motivation,
  code,
}: JourneyHeaderProps) {
  return (
    <section
      className={cn(
        "relative overflow-hidden rounded-3xl border border-emerald-900/10 shadow-md shadow-emerald-900/5",
        "bg-gradient-to-br from-[#124e30] via-[#1f7d49] to-[#34a862]",
      )}
    >
      {/* Soft organic light + leaf texture, kept subtle so it supports rather
          than competes with the content. */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.10] mix-blend-soft-light"
        style={{
          backgroundImage: "url('/customer-bg.jpg')",
          backgroundSize: "300px",
          backgroundRepeat: "repeat",
        }}
      />
      <div className="pointer-events-none absolute -right-16 -top-24 h-64 w-64 rounded-full bg-white/10 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-24 -left-10 h-56 w-56 rounded-full bg-lime-300/15 blur-3xl" />
      {/* Oversized leaf watermark for organic wellness character. */}
      <Leaf
        className="pointer-events-none absolute -bottom-6 right-4 h-40 w-40 rotate-12 text-white/[0.06]"
        strokeWidth={1}
      />

      <div className="relative flex flex-col items-center gap-6 p-6 sm:flex-row sm:items-center sm:justify-between sm:gap-8 sm:p-8">
        <div className="order-2 w-full text-center sm:order-1 sm:text-left">
          <p className="flex items-center justify-center gap-1.5 text-xs font-semibold uppercase tracking-[0.18em] text-emerald-100/90 sm:justify-start">
            <Leaf className="h-3.5 w-3.5" />
            {greeting ? greeting : "Your wellness journey"}
          </p>
          <h2 className="mt-2.5 text-[1.75rem] font-semibold leading-tight tracking-tight text-white sm:text-4xl">
            Day {dayCurrent}
            <span className="block text-base font-medium text-emerald-100/80 sm:mt-0.5 sm:text-lg">
              of your {dayTotal}-day journey
            </span>
          </h2>
          <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-emerald-50/95 sm:mx-0">
            {motivation}
          </p>

          <div className="mt-4 flex flex-wrap items-center justify-center gap-2 sm:justify-start">
            {planName ? (
              <span className="inline-flex items-center rounded-full bg-white/15 px-3 py-1 text-xs font-semibold text-white ring-1 ring-inset ring-white/15">
                {planName}
              </span>
            ) : null}
            {typeof daysRemaining === "number" && daysRemaining > 0 ? (
              <span className="inline-flex items-center rounded-full bg-lime-300/20 px-3 py-1 text-xs font-semibold text-lime-50 ring-1 ring-inset ring-lime-200/25">
                {daysRemaining} {daysRemaining === 1 ? "day" : "days"} to go
              </span>
            ) : null}
            {code ? (
              <span className="inline-flex items-center rounded-full bg-white/10 px-3 py-1 font-mono text-xs font-medium text-emerald-50/90 ring-1 ring-inset ring-white/10">
                {code}
              </span>
            ) : null}
          </div>
        </div>

        <div className="order-1 sm:order-2">
          <ProgressRing value={progress} size={140} strokeWidth={11}>
            <span className="text-3xl font-semibold text-white">
              {Math.round(progress)}
              <span className="text-base font-medium text-emerald-100/80">%</span>
            </span>
            <span className="mt-1 text-[11px] font-medium uppercase tracking-wider text-emerald-100/75">
              Day {dayCurrent} / {dayTotal}
            </span>
          </ProgressRing>
        </div>
      </div>
    </section>
  );
}
