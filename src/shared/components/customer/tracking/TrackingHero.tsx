"use client";

import { cn } from "@/lib/utils";
import { IconChip } from "@/shared/components/customer/profile-ui/IconChip";
import {
  getTrackingHeroContent,
  type TrackingHeroTone,
} from "./tracking-hero-status";

const TONE_WASH: Record<TrackingHeroTone, string> = {
  amber: "from-amber-50 via-white to-orange-50/40",
  green: "from-emerald-50 via-white to-amber-50/30",
  slate: "from-slate-50 via-white to-slate-50/60",
};

const TONE_BORDER: Record<TrackingHeroTone, string> = {
  amber: "border-amber-900/10",
  green: "border-emerald-900/10",
  slate: "border-slate-900/10",
};

const TONE_CHIP: Record<TrackingHeroTone, "green" | "amber" | "slate"> = {
  amber: "amber",
  green: "green",
  slate: "slate",
};

const TONE_EYEBROW: Record<TrackingHeroTone, string> = {
  amber: "text-amber-700/90",
  green: "text-emerald-700/90",
  slate: "text-slate-500",
};

/**
 * TrackingHero — the "Uber Eats moment" that opens Live Tracking.
 *
 * Replaces the plain "Live Tracking" heading with an emotional beat: where
 * is my breakfast, and how do I feel about it right now. Content comes from
 * tracking-hero-status.ts, keyed off the SAME real `delivery_orders.status`
 * this page always received — no new fields, no invented state.
 */
export function TrackingHero({
  status,
  hasRiderAssigned,
  isLocationFresh,
  freshnessText,
}: {
  status: string | null;
  hasRiderAssigned: boolean;
  /** True while the rider's GPS ping is recent — drives the "Live" pulse. */
  isLocationFresh: boolean;
  /** e.g. "Updated 4s ago" — purely presentational, never invented if null. */
  freshnessText: string | null;
}) {
  const content = getTrackingHeroContent(status, { hasRiderAssigned });
  const showLivePulse = content.isLive && isLocationFresh;

  return (
    <section
      className={cn(
        "reveal-rise relative isolate overflow-hidden rounded-3xl border bg-gradient-to-br p-6 shadow-sm sm:p-8",
        TONE_WASH[content.tone],
        TONE_BORDER[content.tone],
      )}
      style={{ ["--reveal-delay" as string]: "0ms" }}
    >
      {/* Soft ambient light wells, matching MealsHero's depth language. */}
      <div className="pointer-events-none absolute -right-20 -top-24 h-64 w-64 rounded-full bg-emerald-200/30 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-24 left-1/4 h-56 w-56 rounded-full bg-amber-100/30 blur-3xl" />
      <div className="hero-sheen pointer-events-none absolute inset-y-0 -left-1/3 z-10 w-1/3 bg-gradient-to-r from-transparent via-white/50 to-transparent" />

      {content.tone === "green" && !content.isLive ? (
        <SoftSparkles />
      ) : null}

      <div className="relative z-20 flex items-start gap-4">
        <IconChip
          icon={content.icon}
          tone={TONE_CHIP[content.tone]}
          size="lg"
          className="mt-0.5"
        />
        <div className="min-w-0 flex-1">
          <p
            className={cn(
              "text-[0.7rem] font-semibold uppercase tracking-[0.18em]",
              TONE_EYEBROW[content.tone],
            )}
          >
            {content.eyebrow}
          </p>
          <h1 className="mt-1.5 text-2xl font-semibold leading-[1.15] tracking-tight text-slate-900 sm:text-[1.85rem]">
            {content.headline}
          </h1>
          <p className="mt-2 max-w-md text-sm leading-relaxed text-slate-600">
            {content.body}
          </p>

          {content.isLive ? (
            <div className="mt-3 flex items-center gap-2 text-xs font-semibold text-slate-500">
              <span className="relative flex h-2.5 w-2.5">
                {showLivePulse ? (
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                ) : null}
                <span
                  className={cn(
                    "relative inline-flex h-2.5 w-2.5 rounded-full",
                    showLivePulse ? "bg-emerald-500" : "bg-slate-300",
                  )}
                />
              </span>
              <span className={showLivePulse ? "text-emerald-700" : "text-slate-400"}>
                {showLivePulse ? "Live" : "Connecting…"}
              </span>
              {freshnessText ? (
                <span className="text-slate-400">· {freshnessText}</span>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}

/** A few quiet sparkles for the Delivered moment — no confetti, just a soft
 *  celebratory shimmer, disabled under reduced motion via the shared
 *  journey-sparkle-* animation classes. */
function SoftSparkles() {
  return (
    <div className="pointer-events-none absolute inset-0 z-10" aria-hidden="true">
      <span className="journey-sparkle-1 absolute right-16 top-8 text-amber-400">
        <SparkleGlyph />
      </span>
      <span className="journey-sparkle-2 absolute right-28 top-20 text-emerald-400">
        <SparkleGlyph small />
      </span>
      <span className="journey-sparkle-1 absolute right-8 top-24 text-amber-300">
        <SparkleGlyph small />
      </span>
    </div>
  );
}

function SparkleGlyph({ small = false }: { small?: boolean }) {
  const size = small ? 10 : 14;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 0l2.6 9.4L24 12l-9.4 2.6L12 24l-2.6-9.4L0 12l9.4-2.6Z" />
    </svg>
  );
}
