import { ProgressRing } from "./ProgressRing";
import { Leaf } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * JourneyHeader — the emotional anchor of the wellness dashboard.
 *
 * Reusable across every customer type. Instead of reporting account status it
 * frames the customer's progress as a single ongoing wellness journey:
 * "Day X of your N-day journey" with a soft forest-green gradient that echoes
 * the Arogyagramam brand world, a warm greeting, motivational line, a
 * celebratory milestone and a full-width journey bar.
 *
 * Meal, KIT and Accommodation dashboards all feed the same props; only the
 * labels differ (journey days / program days / stay days).
 */
type JourneyHeaderProps = {
  /** Pre-composed, time-of-day aware greeting, e.g. "Good morning, Asha". */
  greeting: string;
  /** Plan / program name shown as a chip. */
  planName?: string | null;
  /** Current day within the journey (1-based). */
  dayCurrent: number;
  /** Total days in the journey. */
  dayTotal: number;
  /** Completion percentage 0–100 (usually dayCurrent/dayTotal). */
  progress: number;
  /** Days left in the journey (drives the milestone line). */
  daysRemaining: number;
  /** Short, warm motivational sentence. */
  motivation: string;
  /** Optional identifier chip (e.g. subscription code). */
  code?: string | null;
};

/** A celebratory milestone line that changes as the journey progresses. */
function getMilestone(progress: number, daysRemaining: number) {
  if (progress >= 100) return "Journey complete — incredible work!";
  if (progress >= 75) return `Final stretch — ${daysRemaining} days to go`;
  if (progress >= 50) return "Past the halfway mark — you're glowing";
  if (progress >= 25) return "Great momentum — keep it up";
  return "Your journey has begun";
}

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
  const clampedProgress = Math.max(0, Math.min(100, progress));

  return (
    <section
      className={cn(
        "relative overflow-hidden rounded-3xl border border-emerald-900/10 shadow-md animate-in fade-in slide-in-from-bottom-2 duration-500",
        "bg-gradient-to-br from-[#0f5230] via-[#1f7d49] to-[#37a862]",
      )}
    >
      {/* Depth is built from layered light rather than illustration — closer to
          how Apple builds dimension into wallpapers than to decorative art. */}

      {/* 1. Soft radial key light from the top-left */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage:
            "radial-gradient(125% 120% at 12% -10%, rgba(255,255,255,0.20), rgba(255,255,255,0) 52%)",
        }}
      />
      {/* 2. Cool shadow pooling into the bottom-right for dimensionality */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage:
            "radial-gradient(90% 95% at 100% 105%, rgba(3,38,20,0.40), rgba(3,38,20,0) 58%)",
        }}
      />
      {/* 3. Organic nature texture */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.12] mix-blend-soft-light"
        style={{
          backgroundImage: "url('/customer-bg.jpg')",
          backgroundSize: "320px",
          backgroundRepeat: "repeat",
        }}
      />
      {/* 4. Fine film grain for a tactile, premium surface */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.05] mix-blend-overlay"
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")",
        }}
      />
      {/* 5. Blurred light spots at varied depths */}
      <div className="pointer-events-none absolute -right-16 -top-24 h-72 w-72 rounded-full bg-white/12 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-24 -left-12 h-60 w-60 rounded-full bg-lime-300/15 blur-3xl" />
      <div className="pointer-events-none absolute right-1/3 top-1/2 h-44 w-44 -translate-y-1/2 rounded-full bg-emerald-200/10 blur-3xl" />

      {/* 6. Extremely subtle nature contours + a botanical leaf-vein motif,
          layered at two depths so they read as texture, not illustration. */}
      <svg
        className="pointer-events-none absolute inset-0 h-full w-full"
        viewBox="0 0 1200 400"
        preserveAspectRatio="xMidYMid slice"
        fill="none"
        aria-hidden="true"
      >
        <g stroke="white" strokeOpacity="0.06" strokeWidth="1.5">
          <path d="M-50 120 C 200 60, 400 180, 650 110 S 1050 60, 1250 140" />
          <path d="M-50 190 C 220 130, 430 250, 680 180 S 1080 130, 1250 210" />
          <path d="M-50 270 C 240 210, 460 330, 720 260 S 1120 210, 1250 300" />
        </g>
        {/* Finer secondary contours for layered depth */}
        <g stroke="white" strokeOpacity="0.03" strokeWidth="1">
          <path d="M-50 150 C 210 95, 415 210, 665 145 S 1065 95, 1250 175" />
          <path d="M-50 235 C 230 175, 445 295, 700 225 S 1100 175, 1250 260" />
        </g>
        {/* Botanical leaf vein motif, bottom-right */}
        <g
          transform="translate(1000 250)"
          stroke="white"
          strokeOpacity="0.05"
          strokeWidth="1.5"
          strokeLinecap="round"
        >
          <path d="M0 160 C 40 90, 90 40, 160 0" />
          <path d="M40 120 L 78 96" />
          <path d="M60 96 L 100 74" />
          <path d="M82 72 L 120 52" />
          <path d="M104 50 L 138 34" />
        </g>
      </svg>

      {/* Signature: a single morning light sweep across the hero on open. */}
      <div className="hero-sheen pointer-events-none absolute inset-y-0 left-0 w-1/3 bg-gradient-to-r from-transparent via-white/15 to-transparent" />

      <div className="relative flex flex-col items-center gap-6 p-6 pb-8 sm:flex-row sm:items-center sm:justify-between sm:gap-8 sm:p-8 sm:pb-9">
        <div className="order-2 w-full text-center sm:order-1 sm:text-left">
          <div className="flex items-center justify-center gap-2 sm:justify-start">
            <Leaf className="h-4 w-4 text-lime-200/90" />
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-50/90">
              {greeting}
            </p>
          </div>

          <h2 className="mt-3 text-2xl font-semibold tracking-tight text-white sm:text-[2rem] sm:leading-tight">
            Day {dayCurrent}{" "}
            <span className="text-lg font-medium text-emerald-100/80 sm:text-xl">
              of your {dayTotal}-day journey
            </span>
          </h2>

          <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-emerald-50/90 sm:mx-0">
            {motivation}
          </p>

          <div className="mt-4 flex flex-wrap items-center justify-center gap-2 sm:justify-start">
            {planName ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1 text-xs font-semibold text-emerald-50 ring-1 ring-inset ring-white/15">
                {planName}
              </span>
            ) : null}
            {code ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-white/12 px-3 py-1 font-mono text-xs font-medium text-emerald-50/90 ring-1 ring-inset ring-white/15">
                {code}
              </span>
            ) : null}
          </div>
        </div>

        <div className="order-1 flex flex-col items-center gap-3 sm:order-2">
          <ProgressRing value={clampedProgress} size={140} strokeWidth={11}>
            <span className="text-3xl font-semibold text-white">
              {Math.round(clampedProgress)}
              <span className="text-base font-medium text-emerald-100/80">
                %
              </span>
            </span>
            <span className="mt-1 text-[11px] font-medium uppercase tracking-wider text-emerald-100/70">
              Complete
            </span>
          </ProgressRing>
          <span className="rounded-full bg-white/12 px-3 py-1 text-center text-[11px] font-medium text-emerald-50/90 ring-1 ring-inset ring-white/10">
            {getMilestone(clampedProgress, daysRemaining)}
          </span>
        </div>
      </div>

      {/* Full-width journey bar. Draws from empty using the same technique,
          delay and duration as the progress ring so both indicators fill
          together as one movement rather than two unrelated effects. */}
      <div className="relative h-1.5 w-full bg-emerald-950/25">
        <div
          className="journey-bar-anim h-full rounded-r-full bg-gradient-to-r from-lime-300 to-emerald-200"
          style={{ width: `${clampedProgress}%` }}
        />
      </div>
    </section>
  );
}
