// src/shared/components/customer/health-report/HealthReportHero.tsx
//
// The Health Report's hero, in the same visual family as the dashboard's
// `JourneyHeader`: the deep forest-green gradient, layered light, nature texture,
// the one-time light sweep on open and the full-width progress bar at the foot.
//
// Deliberately lighter than the dashboard hero (no botanical line art, no
// progress ring) — the dashboard stays the biggest moment in the customer's
// journey and this reads as its sibling, not its rival.

import { HeartPulse, Stethoscope, CalendarRange } from "lucide-react";

interface HealthReportHeroProps {
  /** `27 Jul 2026 — 3 Aug 2026`, already formatted. */
  stayRangeLabel: string;
  /** `AC Villa · Single`. */
  stayTypeLabel: string;
  totalNights: number;
  /** Days the wellness team has recorded so far. */
  daysRecorded: number;
  dietitianName: string | null;
  /** `false` when showing a completed stay. */
  isActive: boolean;
  /** The download call to action, rendered top-right on desktop. */
  action?: React.ReactNode;
}

export function HealthReportHero({
  stayRangeLabel,
  stayTypeLabel,
  totalNights,
  daysRecorded,
  dietitianName,
  isActive,
  action,
}: HealthReportHeroProps) {
  const coverage =
    totalNights > 0
      ? Math.max(0, Math.min(100, Math.round((daysRecorded / totalNights) * 100)))
      : 0;

  const summary =
    daysRecorded === 0
      ? "Your wellness team hasn't recorded a reading yet. The first one will appear here."
      : isActive
        ? `${daysRecorded} of ${totalNights} days recorded so far — your readings build a picture of your progress.`
        : `${daysRecorded} ${daysRecorded === 1 ? "day" : "days"} recorded across your completed stay.`;

  return (
    <section
      className="reveal-rise relative overflow-hidden rounded-3xl border border-emerald-900/10 shadow-md bg-gradient-to-br from-[#0f5230] via-[#1f7d49] to-[#37a862]"
      style={{ ["--reveal-delay" as string]: "150ms" }}
    >
      {/* Soft radial key light from the top-left */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage:
            "radial-gradient(125% 120% at 12% -10%, rgba(255,255,255,0.20), rgba(255,255,255,0) 52%)",
        }}
      />
      {/* Cool shadow pooling into the bottom-right */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage:
            "radial-gradient(90% 95% at 100% 105%, rgba(3,38,20,0.40), rgba(3,38,20,0) 58%)",
        }}
      />
      {/* Organic nature texture */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.12] mix-blend-soft-light"
        style={{
          backgroundImage: "url('/customer-bg.jpg')",
          backgroundSize: "320px",
          backgroundRepeat: "repeat",
        }}
      />
      <div className="pointer-events-none absolute -right-16 -top-24 h-72 w-72 rounded-full bg-white/12 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-24 -left-12 h-60 w-60 rounded-full bg-lime-300/15 blur-3xl" />

      {/* The signature one-time light sweep, shared with the dashboard hero. */}
      <div className="hero-sheen pointer-events-none absolute inset-y-0 left-0 w-1/3 bg-gradient-to-r from-transparent via-white/15 to-transparent" />

      <div className="relative flex flex-col gap-6 p-6 pb-7 sm:flex-row sm:items-start sm:justify-between sm:gap-8 sm:p-8 sm:pb-8">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <HeartPulse className="h-4 w-4 shrink-0 text-lime-200/90" aria-hidden="true" />
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-50/90">
              {isActive ? "Your wellness record" : "Completed stay"}
            </p>
          </div>

          <h1 className="mt-3 text-2xl font-semibold tracking-tight text-white sm:text-[2rem] sm:leading-tight">
            Health Report{" "}
            <span className="block text-lg font-medium text-emerald-100/80 sm:mt-1 sm:text-xl">
              {stayTypeLabel} · {totalNights}{" "}
              {totalNights === 1 ? "night" : "nights"}
            </span>
          </h1>

          <p className="mt-3 max-w-md text-sm leading-relaxed text-emerald-50/90">
            {summary}
          </p>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1 text-xs font-semibold text-emerald-50 ring-1 ring-inset ring-white/15">
              <CalendarRange className="h-3.5 w-3.5" aria-hidden="true" />
              {stayRangeLabel}
            </span>
            {dietitianName && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1 text-xs font-semibold text-emerald-50 ring-1 ring-inset ring-white/15">
                <Stethoscope className="h-3.5 w-3.5" aria-hidden="true" />
                Recorded by {dietitianName}
              </span>
            )}
          </div>
        </div>

        {action && <div className="shrink-0 sm:pt-1">{action}</div>}
      </div>

      {/* Coverage bar — how much of the stay has readings, mirroring the
          dashboard hero's journey bar. */}
      <div className="relative h-1.5 w-full bg-emerald-950/25">
        <div
          className="journey-bar-anim h-full rounded-r-full bg-gradient-to-r from-lime-300 to-emerald-200"
          style={{ width: `${coverage}%` }}
          role="progressbar"
          aria-valuenow={coverage}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Days recorded during your stay"
        />
      </div>
    </section>
  );
}
