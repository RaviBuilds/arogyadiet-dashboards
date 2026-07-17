import { Sprout } from "lucide-react";
import { IconChip } from "@/shared/components/customer/profile-ui/IconChip";

/**
 * MealsHero — the emotional "landing hero" that opens My Meals.
 *
 * This is NOT today's delivery status (that's the next card). Its only job is
 * to establish context and feeling: where the customer is in their journey,
 * which day they're on, and why continuing matters. Think Apple Health / Oura
 * / Headspace opening screen — premium, calm, confident — rather than a white
 * card with a heading.
 *
 * Consistency: stays inside the Dashboard/Profile design language (forest
 * green → mint → warm cream, faint orange accent, no blue). It reuses the
 * shared IconChip primitive and the Dashboard's own animation vocabulary
 * (`reveal-rise`, `hero-sheen` morning-light sweep, `journey-bar-anim`
 * progress fill) rather than inventing new motion — so it reads as a sibling
 * of the Dashboard's JourneyHeader without duplicating its progress ring or
 * analytics (the Dashboard owns metrics; this hero owns emotion).
 */
export function MealsHero({
  dayCurrent,
  dayTotal,
}: {
  dayCurrent?: number | null;
  dayTotal?: number | null;
}) {
  const showJourney =
    typeof dayCurrent === "number" &&
    typeof dayTotal === "number" &&
    dayTotal > 0;

  const progress = showJourney
    ? Math.max(0, Math.min(100, Math.round((dayCurrent! / dayTotal!) * 100)))
    : 0;

  return (
    <section
      className="reveal-rise relative isolate overflow-hidden rounded-3xl border border-emerald-900/10 bg-gradient-to-br from-emerald-50 via-white to-amber-50/40 shadow-sm"
      style={{ ["--reveal-delay" as string]: "150ms" }}
    >
      {/* ── Depth layer 1: soft light wells (large, near-invisible) ───────── */}
      <div className="pointer-events-none absolute -right-24 -top-28 h-72 w-72 rounded-full bg-emerald-200/40 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-28 left-1/3 h-64 w-64 rounded-full bg-amber-100/40 blur-3xl" />

      {/* ── Depth layer 2: botanical line art, Apple-wallpaper faint ──────── */}
      <BotanicalBackdrop />

      {/* ── Depth layer 3: the breakfast-bowl illustration, bleeding off the
             bottom-right edge at low opacity so it blends into the hero
             rather than sitting on top like clipart. ──────────────────────── */}
      <BreakfastBowlIllustration />

      {/* One-time morning-light sweep on app open (shared dashboard motion). */}
      <div className="hero-sheen pointer-events-none absolute inset-y-0 -left-1/3 z-10 w-1/3 bg-gradient-to-r from-transparent via-white/50 to-transparent" />

      <div className="relative z-20 grid grid-cols-1 gap-8 p-7 sm:p-9 lg:grid-cols-[1.35fr_1fr] lg:items-center lg:gap-10 lg:p-10">
        {/* ── LEFT: the emotional narrative ──────────────────────────────── */}
        <div>
          <div className="flex items-center gap-2.5">
            <IconChip icon={Sprout} tone="green" />
            <span className="text-[0.7rem] font-semibold uppercase tracking-[0.2em] text-emerald-700/90">
              Your Nutrition Journey
            </span>
          </div>

          <h1 className="mt-4 text-3xl font-semibold leading-[1.1] tracking-tight text-slate-900 sm:text-[2.5rem]">
            Today&apos;s Nutrition Journey
          </h1>

          <p className="mt-3 max-w-md text-[0.95rem] leading-relaxed text-slate-600">
            Every healthy meal is another quiet step toward a stronger,
            lighter, more energised you.
          </p>

          <p className="mt-2 max-w-md text-sm leading-relaxed text-slate-400">
            Consistency is what transforms — and today is part of that.
          </p>

          {showJourney ? (
            <div className="mt-6 inline-flex items-center gap-2 rounded-full bg-white/70 px-4 py-2 text-sm font-medium text-emerald-800 ring-1 ring-emerald-900/10 backdrop-blur-sm">
              <Sprout className="h-4 w-4 text-emerald-600" />
              Day {dayCurrent} of your transformation
            </div>
          ) : null}
        </div>

        {/* ── RIGHT: the journey indicator (visual focal point, not a badge) ── */}
        {showJourney ? (
          <div className="lg:pl-8 lg:border-l lg:border-emerald-900/10">
            <div className="flex items-end justify-between gap-3">
              <div>
                <p className="text-xs font-medium uppercase tracking-widest text-slate-400">
                  Day
                </p>
                <p className="mt-1 flex items-baseline gap-1.5 leading-none">
                  <span className="text-5xl font-semibold tracking-tight text-emerald-700 sm:text-6xl">
                    {dayCurrent}
                  </span>
                  <span className="text-lg font-medium text-slate-400">
                    / {dayTotal}
                  </span>
                </p>
              </div>
              <p className="pb-1 text-right">
                <span className="text-2xl font-semibold tracking-tight text-slate-900">
                  {progress}
                  <span className="text-base font-medium text-slate-400">%</span>
                </span>
                <span className="block text-xs font-medium text-slate-400">
                  complete
                </span>
              </p>
            </div>

            {/* Elegant progress track — reuses the dashboard's journey-bar
                fill animation on app open, resting at final width otherwise. */}
            <div
              className="mt-4 h-2.5 w-full overflow-hidden rounded-full bg-emerald-900/10"
              role="progressbar"
              aria-valuenow={progress}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={`Nutrition journey: day ${dayCurrent} of ${dayTotal}, ${progress}% complete`}
            >
              <div
                className="journey-bar-anim h-full rounded-full bg-gradient-to-r from-emerald-500 to-emerald-600"
                style={{ width: `${progress}%` }}
              >
                <div className="h-full w-full bg-[linear-gradient(90deg,transparent,rgba(255,255,255,0.35),transparent)] bg-[length:200%_100%]" />
              </div>
            </div>

            <p className="mt-3 text-xs leading-relaxed text-slate-500">
              You&apos;re {progress >= 50 ? "past the halfway mark" : "building real momentum"} —
              keep going, one nourishing morning at a time.
            </p>
          </div>
        ) : null}
      </div>
    </section>
  );
}

/**
 * BotanicalBackdrop — large, calm leaf/sprig line art at very low opacity,
 * meant to be felt more than seen (Apple-wallpaper approach). Purely
 * decorative → aria-hidden. `currentColor` inherits the emerald tint.
 */
function BotanicalBackdrop() {
  return (
    <svg
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 h-full w-full text-emerald-700/[0.05]"
      viewBox="0 0 400 200"
      preserveAspectRatio="xMidYMid slice"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.2}
      strokeLinecap="round"
    >
      {/* trailing vine, upper-left */}
      <path d="M-10 40 C 40 20, 80 60, 130 30" />
      <path d="M30 33c-6-6-14-4-18 2 8 3 15 1 18-2Z" fill="currentColor" stroke="none" />
      <path d="M70 47c7-5 8-13 3-19-6 6-6 14-3 19Z" fill="currentColor" stroke="none" />
      <path d="M105 34c-6-6-14-5-18 1 7 4 15 2 18-1Z" fill="currentColor" stroke="none" />

      {/* wheat stalk, mid */}
      <path d="M210 190 C 205 150, 205 120, 210 95" />
      <path d="M210 120c8-4 12-11 10-18-7 3-11 11-10 18Z" fill="currentColor" stroke="none" />
      <path d="M210 132c-8-4-12-11-10-18 7 3 11 11 10 18Z" fill="currentColor" stroke="none" />
      <path d="M210 146c8-4 12-11 10-18-7 3-11 11-10 18Z" fill="currentColor" stroke="none" />
      <path d="M210 158c-8-4-12-11-10-18 7 3 11 11 10 18Z" fill="currentColor" stroke="none" />

      {/* large calm leaf, lower-right area */}
      <path d="M300 170 C 320 120, 370 110, 400 130" />
      <path d="M340 132c14-10 18-28 8-40-13 12-14 30-8 40Z" fill="currentColor" stroke="none" />
    </svg>
  );
}

/**
 * BreakfastBowlIllustration — a single elegant line-art breakfast bowl with a
 * rising steam sprig, anchored to the bottom-right and bleeding off the edge.
 * Low opacity so it integrates into the hero as texture, not a sticker.
 * Decorative → aria-hidden.
 */
function BreakfastBowlIllustration() {
  return (
    <svg
      aria-hidden="true"
      className="pointer-events-none absolute -bottom-6 -right-4 h-52 w-52 text-emerald-700/[0.10] sm:h-64 sm:w-64"
      viewBox="0 0 120 120"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {/* bowl */}
      <path d="M20 58h80a40 40 0 0 1-80 0Z" />
      <path d="M14 58h92" />
      {/* fresh contents mound */}
      <path d="M34 58a26 26 0 0 1 52 0" opacity={0.7} />
      {/* leaf garnish */}
      <path d="M60 40c8-8 20-8 26-2-6 8-18 10-26 2Z" fill="currentColor" stroke="none" opacity={0.5} />
      <path d="M60 40C54 30 56 20 62 15c4 9 2 19-2 25Z" fill="currentColor" stroke="none" opacity={0.5} />
      {/* rising steam */}
      <path d="M46 34c0-5 4-7 4-12s-4-7-4-11" opacity={0.6} />
      <path d="M74 32c0-5 4-7 4-12s-4-7-4-11" opacity={0.6} />
    </svg>
  );
}
