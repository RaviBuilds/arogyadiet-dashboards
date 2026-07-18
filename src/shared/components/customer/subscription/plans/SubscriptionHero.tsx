import { Leaf, Sparkles } from "lucide-react";
import { IconChip } from "@/shared/components/customer/profile-ui/IconChip";

/**
 * SubscriptionHero — the premium opening beat of "Choose Your Plan".
 *
 * Mirrors MealsHero's design language (forest-green → mint → warm cream
 * wash, soft blurred light wells, faint botanical line art, one-time
 * morning-light sweep) so /subscription reads as a sibling of /meals rather
 * than a different product. Purely presentational — no data dependency, so
 * it can never drift out of sync with plan/subscription logic.
 */
export function SubscriptionHero() {
  return (
    <section
      className="reveal-rise relative isolate overflow-hidden rounded-3xl border border-emerald-900/10 bg-gradient-to-br from-emerald-50 via-white to-amber-50/40 shadow-sm"
      style={{ ["--reveal-delay" as string]: "0ms" }}
    >
      {/* Soft light wells, matching MealsHero's depth technique. */}
      <div className="pointer-events-none absolute -right-24 -top-28 h-72 w-72 rounded-full bg-emerald-200/40 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-28 left-1/4 h-64 w-64 rounded-full bg-amber-100/40 blur-3xl" />

      <BotanicalBackdrop />

      {/* Wellness bowl illustration, bleeding off the bottom-right edge at
          low opacity — same technique as MealsHero's BreakfastBowlIllustration
          — so the hero reads as a full composition rather than text sitting
          in an empty gradient on wide screens. */}
      <WellnessBowlIllustration />

      {/* One-time morning-light sweep on app open. */}
      <div className="hero-sheen pointer-events-none absolute inset-y-0 -left-1/3 z-10 w-1/3 bg-gradient-to-r from-transparent via-white/50 to-transparent" />

      <div className="relative z-20 p-7 sm:p-9 lg:p-10">
        <div className="flex items-center gap-2.5">
          <IconChip icon={Leaf} tone="green" />
          <span className="text-[0.7rem] font-semibold uppercase tracking-[0.2em] text-emerald-700/90">
            Your Wellness Plan
          </span>
        </div>

        <h1 className="mt-4 max-w-2xl text-3xl font-semibold leading-[1.1] tracking-tight text-slate-900 sm:text-[2.5rem]">
          Choose the plan that fits your lifestyle.
        </h1>

        <p className="mt-3 max-w-xl text-[0.95rem] leading-relaxed text-slate-600">
          Healthy, chef-prepared meals delivered every day.
        </p>
        <p className="mt-1.5 max-w-xl text-sm leading-relaxed text-slate-400">
          Small, consistent choices create lifelong transformation.
        </p>

        <div className="mt-6 inline-flex items-center gap-2 rounded-full bg-white/70 px-4 py-2 text-sm font-medium text-emerald-800 ring-1 ring-emerald-900/10 backdrop-blur-sm">
          <Sparkles className="h-4 w-4 text-emerald-600" />
          Every plan includes fresh meals, pause flexibility and dedicated delivery
        </div>
      </div>
    </section>
  );
}

/**
 * WellnessBowlIllustration — a single elegant line-art bowl with a sprouting
 * leaf, anchored to the bottom-right and bleeding off the edge. Mirrors
 * MealsHero's BreakfastBowlIllustration technique (low-opacity currentColor
 * strokes) so the two heroes read as siblings. Decorative → aria-hidden.
 */
function WellnessBowlIllustration() {
  return (
    <svg
      aria-hidden="true"
      className="pointer-events-none absolute -bottom-10 -right-6 hidden h-64 w-64 text-emerald-700/[0.09] sm:block sm:h-72 sm:w-72"
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
      <path d="M34 58a26 26 0 0 1 52 0" opacity={0.7} />
      {/* sprouting leaf pair rising from the bowl */}
      <path d="M60 40c8-8 20-8 26-2-6 8-18 10-26 2Z" fill="currentColor" stroke="none" opacity={0.5} />
      <path d="M60 40C54 30 56 20 62 15c4 9 2 19-2 25Z" fill="currentColor" stroke="none" opacity={0.5} />
      <path d="M60 40v6" opacity={0.6} />
      {/* faint orbiting seeds/berries for a little life */}
      <circle cx={38} cy={70} r={3} fill="currentColor" stroke="none" opacity={0.4} />
      <circle cx={82} cy={72} r={3} fill="currentColor" stroke="none" opacity={0.4} />
    </svg>
  );
}

/**
 * BotanicalBackdrop — faint leaf/sprig line art, felt more than seen (Apple
 * wallpaper approach). Same visual family as MealsHero's backdrop, kept
 * local to this component since it's purely decorative and presentational.
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
      <path d="M270 30 C 320 10, 360 50, 400 25" />
      <path d="M310 23c-6-6-14-4-18 2 8 3 15 1 18-2Z" fill="currentColor" stroke="none" />
      <path d="M350 37c7-5 8-13 3-19-6 6-6 14-3 19Z" fill="currentColor" stroke="none" />

      <path d="M60 190 C 55 150, 55 120, 60 95" />
      <path d="M60 120c8-4 12-11 10-18-7 3-11 11-10 18Z" fill="currentColor" stroke="none" />
      <path d="M60 132c-8-4-12-11-10-18 7 3 11 11 10 18Z" fill="currentColor" stroke="none" />
      <path d="M60 146c8-4 12-11 10-18-7 3-11 11-10 18Z" fill="currentColor" stroke="none" />

      <path d="M0 170 C 20 120, 70 110, 100 130" />
      <path d="M40 132c14-10 18-28 8-40-13 12-14 30-8 40Z" fill="currentColor" stroke="none" />
    </svg>
  );
}
