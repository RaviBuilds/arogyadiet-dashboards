import { Sprout } from "lucide-react";
import { IconChip } from "@/shared/components/customer/profile-ui/IconChip";

/**
 * OnboardingHero — the premium opening beat of the "New Subscription"
 * checkout wizard. Replaces the plain "New Subscription" title with the
 * same wellness-hero language already established on /meals and
 * /subscription (soft gradient wash, faint botanical line art, one-time
 * morning-light sweep), so beginning checkout feels like starting a
 * journey rather than filling out a form.
 *
 * Purely presentational — no data dependency, so it can never drift out of
 * sync with the wizard's checkout logic/state.
 */
export function OnboardingHero() {
  return (
    <section
      className="reveal-rise relative isolate overflow-hidden rounded-3xl border border-emerald-900/10 bg-gradient-to-br from-emerald-50 via-white to-amber-50/40 shadow-sm"
      style={{ ["--reveal-delay" as string]: "0ms" }}
    >
      <div className="pointer-events-none absolute -right-24 -top-28 h-72 w-72 rounded-full bg-emerald-200/40 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-24 left-1/4 h-56 w-56 rounded-full bg-amber-100/40 blur-3xl" />

      <BotanicalBackdrop />
      <SproutIllustration />

      {/* One-time morning-light sweep on app open (shared hero motion). */}
      <div className="hero-sheen pointer-events-none absolute inset-y-0 -left-1/3 z-10 w-1/3 bg-gradient-to-r from-transparent via-white/50 to-transparent" />

      <div className="relative z-20 p-7 text-center sm:p-9 lg:p-10">
        <div className="flex items-center justify-center gap-2.5">
          <IconChip icon={Sprout} tone="green" />
          <span className="text-[0.7rem] font-semibold uppercase tracking-[0.2em] text-emerald-700/90">
            Begin Your Journey
          </span>
        </div>

        <h1 className="mx-auto mt-4 max-w-xl text-3xl font-semibold leading-[1.1] tracking-tight text-slate-900 sm:text-[2.25rem]">
          Start Your Wellness Journey
        </h1>

        <p className="mx-auto mt-3 max-w-md text-[0.95rem] leading-relaxed text-slate-600">
          Every healthy meal is another step toward a healthier, happier you.
        </p>
        <p className="mx-auto mt-1.5 max-w-md text-sm leading-relaxed text-slate-400">
          Today&apos;s choices become tomorrow&apos;s transformation.
        </p>
      </div>
    </section>
  );
}

/** Faint leaf/sprig line art, felt more than seen — same family as the
 * botanical backdrops on MealsHero / SubscriptionHero. Decorative → aria-hidden. */
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
      <path d="M-10 40 C 40 20, 80 60, 130 30" />
      <path d="M30 33c-6-6-14-4-18 2 8 3 15 1 18-2Z" fill="currentColor" stroke="none" />
      <path d="M70 47c7-5 8-13 3-19-6 6-6 14-3 19Z" fill="currentColor" stroke="none" />

      <path d="M300 170 C 320 120, 370 110, 400 130" />
      <path d="M340 132c14-10 18-28 8-40-13 12-14 30-8 40Z" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** A small sprouting-seed illustration bleeding off the bottom-right edge,
 * low opacity — mirrors the technique used in MealsHero/SubscriptionHero so
 * this hero reads as a sibling rather than a new visual language. */
function SproutIllustration() {
  return (
    <svg
      aria-hidden="true"
      className="pointer-events-none absolute -bottom-8 -right-4 hidden h-56 w-56 text-emerald-700/[0.09] sm:block sm:h-64 sm:w-64"
      viewBox="0 0 120 120"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M60 100V60" />
      <path d="M60 68c-14-4-22-16-20-30 14 2 24 12 26 26" fill="currentColor" opacity={0.5} />
      <path d="M60 60c14-4 22-16 20-30-14 2-24 12-26 26" fill="currentColor" opacity={0.5} />
      <path d="M40 100h40" opacity={0.6} />
      <circle cx={30} cy={78} r={3} fill="currentColor" stroke="none" opacity={0.4} />
      <circle cx={92} cy={82} r={3} fill="currentColor" stroke="none" opacity={0.4} />
    </svg>
  );
}
