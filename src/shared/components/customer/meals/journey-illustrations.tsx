import { cn } from "@/lib/utils";

/**
 * journey-illustrations — premium, organic SVG scenes for My Meals' "Today's
 * Meal Journey" card.
 *
 * Craftsmanship pass: earlier versions rendered a single small centered
 * glyph inside a flat pale rectangle — it read as broken/empty at the sizes
 * this card needs. This version builds each state as a small *scene*
 * (layered soft gradient blobs + a route/ground motif + a larger line-art
 * focal icon with a few solid gradient-filled accents, like a sticker
 * rather than a bare outline) so the illustration panel earns its share of
 * the card instead of looking like a placeholder.
 *
 * Deliberately NOT the Dashboard's food photography and NOT generic icon-pack
 * glyphs — every shape here is hand-built for this page, kept organic/soft
 * (rounded, hand-drawn-feeling curves, no sharp corporate corners) to read as
 * "designed for ArogyaDiet" rather than a stock icon.
 */
export type JourneyIllustrationId =
  | "planned"
  | "assigned"
  | "out_for_delivery"
  | "reaching"
  | "reviewing"
  | "delivered"
  | "failed"
  | "paused"
  | "empty";

type Tone = "orange" | "blue" | "green" | "amber" | "slate";

const PANEL_GRADIENTS: Record<Tone, string> = {
  orange: "from-orange-50 via-amber-50/70 to-white",
  blue: "from-blue-50 via-sky-50/70 to-white",
  green: "from-emerald-50 via-teal-50/60 to-white",
  amber: "from-amber-50 via-orange-50/50 to-white",
  slate: "from-slate-100 via-slate-50/80 to-white",
};

const BLOB_TONES: Record<Tone, string> = {
  orange: "bg-orange-200/50",
  blue: "bg-blue-200/50",
  green: "bg-emerald-200/50",
  amber: "bg-amber-200/50",
  slate: "bg-slate-300/40",
};

const GLYPH_TONES: Record<Tone, string> = {
  orange: "text-orange-600",
  blue: "text-blue-600",
  green: "text-emerald-600",
  amber: "text-amber-600",
  slate: "text-slate-400",
};

const ACCENT_TONES: Record<Tone, string> = {
  orange: "text-orange-400",
  blue: "text-blue-400",
  green: "text-emerald-400",
  amber: "text-amber-400",
  slate: "text-slate-300",
};

/** A trio of soft, differently-sized route/travel dots — used for the
 *  delivery-in-motion states to hint at a journey without literal text. */
function RouteDots({ tone }: { tone: Tone }) {
  return (
    <div className="absolute bottom-6 left-1/2 flex -translate-x-1/2 items-center gap-2">
      <span className={cn("h-1.5 w-1.5 rounded-full opacity-70", BLOB_TONES[tone])} />
      <span className={cn("h-2 w-2 rounded-full opacity-80", BLOB_TONES[tone])} />
      <span className={cn("h-1.5 w-1.5 rounded-full opacity-70", BLOB_TONES[tone])} />
    </div>
  );
}

function Glyph({ id, tone }: { id: JourneyIllustrationId; tone: Tone }) {
  const gradId = `g-${id}`;
  const line = {
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.6,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };

  switch (id) {
    // Kitchen — pot with fresh herb sprig + rising steam, warm sticker badge.
    case "planned":
      return (
        <svg viewBox="0 0 64 64" className="h-20 w-20 sm:h-28 sm:w-28">
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="currentColor" stopOpacity={0.22} />
              <stop offset="100%" stopColor="currentColor" stopOpacity={0.06} />
            </linearGradient>
          </defs>
          <circle cx="32" cy="34" r="24" className={GLYPH_TONES[tone]} fill={`url(#${gradId})`} />
          <g className={GLYPH_TONES[tone]}>
            <path d="M17 32h30l-2.5 15a5 5 0 0 1-5 4.2H24.5a5 5 0 0 1-5-4.2L17 32Z" {...line} />
            <path d="M14 32h36" {...line} />
            <path d="M23 32v-4a9 9 0 0 1 18 0v4" {...line} />
          </g>
          <g className={ACCENT_TONES[tone]}>
            <path d="M25 16c0-2 1.4-2.8 1.4-4.8S25 8 25 8" {...line} opacity={0.8} />
            <path d="M32 14c0-2 1.4-2.8 1.4-4.8S32 6 32 6" {...line} opacity={0.6} />
            <path d="M39 16c0-2 1.4-2.8 1.4-4.8S39 8 39 8" {...line} opacity={0.8} />
          </g>
          {/* small leaf sprig — the one recurring ArogyaDiet motif across states */}
          <path
            d="M45 44c3-1 5-4 4-7-3 1-5 3-4 7Z"
            className={GLYPH_TONES[tone]}
            fill="currentColor"
            opacity={0.5}
          />
        </svg>
      );

    // Delivery partner assigned — scooter + meal bag, route-planning pin badge.
    case "assigned":
      return (
        <svg viewBox="0 0 64 64" className="h-20 w-20 sm:h-28 sm:w-28">
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="currentColor" stopOpacity={0.22} />
              <stop offset="100%" stopColor="currentColor" stopOpacity={0.06} />
            </linearGradient>
          </defs>
          <circle cx="30" cy="34" r="24" className={GLYPH_TONES[tone]} fill={`url(#${gradId})`} />
          <g className={GLYPH_TONES[tone]}>
            <circle cx="20" cy="46" r="5" {...line} />
            <circle cx="42" cy="46" r="5" {...line} />
            <path d="M20 46h8l5-13h10" {...line} />
            <path d="M33 33h7l4 8h-5" {...line} />
            <path d="M25 33h8" {...line} />
          </g>
          {/* sticker-style assignment badge */}
          <circle cx="46" cy="18" r="9" className={GLYPH_TONES[tone]} fill="currentColor" opacity={0.14} />
          <g className={GLYPH_TONES[tone]}>
            <circle cx="46" cy="18" r="9" {...line} />
            <path d="M42.5 18l2.3 2.5L50 15" {...line} />
          </g>
          <path
            d="M12 20c2.5-1 4.5-3 4-5.6-2.4.8-4.2 2.7-4 5.6Z"
            className={ACCENT_TONES[tone]}
            fill="currentColor"
            opacity={0.6}
          />
        </svg>
      );

    // Out for delivery — scooter in motion, sunrise + motion lines + road.
    case "out_for_delivery":
      return (
        <svg viewBox="0 0 64 64" className="h-20 w-20 sm:h-28 sm:w-28">
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="currentColor" stopOpacity={0.22} />
              <stop offset="100%" stopColor="currentColor" stopOpacity={0.06} />
            </linearGradient>
          </defs>
          <circle cx="32" cy="30" r="24" className={GLYPH_TONES[tone]} fill={`url(#${gradId})`} />
          {/* sunrise arc */}
          <path
            d="M18 22a14 14 0 0 1 28 0"
            className={ACCENT_TONES[tone]}
            {...line}
            opacity={0.7}
          />
          <g className={GLYPH_TONES[tone]}>
            <circle cx="22" cy="46" r="5" {...line} />
            <circle cx="44" cy="46" r="5" {...line} />
            <path d="M22 46h8l5-11.5h11.5" {...line} />
            <path d="M35.5 34.5h8l4 7.5h-5.5" {...line} />
            <path d="M27 34.5h8" {...line} />
          </g>
          <g className={ACCENT_TONES[tone]} opacity={0.75}>
            <path d="M4 30h9" {...line} />
            <path d="M2 36h6" {...line} />
            <path d="M6 24h7" {...line} />
          </g>
          {/* ground line */}
          <path d="M8 54h48" className={GLYPH_TONES[tone]} {...line} opacity={0.3} />
        </svg>
      );

    // Reaching location — house with a welcoming glow + location pin above.
    case "reaching":
      return (
        <svg viewBox="0 0 64 64" className="h-20 w-20 sm:h-28 sm:w-28">
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="currentColor" stopOpacity={0.22} />
              <stop offset="100%" stopColor="currentColor" stopOpacity={0.06} />
            </linearGradient>
          </defs>
          <circle cx="32" cy="32" r="24" className={GLYPH_TONES[tone]} fill={`url(#${gradId})`} />
          <g className={GLYPH_TONES[tone]}>
            <path d="M16 34l16-13 16 13" {...line} />
            <path d="M20 32v18h24V32" {...line} />
            <path d="M27 50v-9h10v9" {...line} />
          </g>
          {/* welcoming glow at the door */}
          <circle cx="32" cy="44" r="3" className={ACCENT_TONES[tone]} fill="currentColor" opacity={0.5} />
          {/* location pin arriving from above */}
          <g className={GLYPH_TONES[tone]}>
            <path d="M46 8c-4 0-7 3-7 7 0 5.2 7 12 7 12s7-6.8 7-12c0-4-3-7-7-7Z" {...line} />
            <circle cx="46" cy="15" r="2.4" {...line} />
          </g>
        </svg>
      );

    // Under review — calm clock with a gentle checking arc, no alarm colors.
    case "reviewing":
      return (
        <svg viewBox="0 0 64 64" className="h-20 w-20 sm:h-28 sm:w-28">
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="currentColor" stopOpacity={0.18} />
              <stop offset="100%" stopColor="currentColor" stopOpacity={0.05} />
            </linearGradient>
          </defs>
          <circle cx="32" cy="32" r="24" className={GLYPH_TONES[tone]} fill={`url(#${gradId})`} />
          <g className={GLYPH_TONES[tone]}>
            <circle cx="30" cy="32" r="15" {...line} />
            <path d="M30 23v9l6.5 5" {...line} />
          </g>
          <path
            d="M48 22a19 19 0 0 1 2.5 10"
            className={ACCENT_TONES[tone]}
            {...line}
            opacity={0.6}
          />
          <path
            d="M12 32a19 19 0 0 1 2.5-10"
            className={ACCENT_TONES[tone]}
            {...line}
            opacity={0.6}
          />
          {/* gentle checkmark badge — "being looked after", not an alert */}
          <circle cx="47" cy="44" r="8" className={GLYPH_TONES[tone]} fill="currentColor" opacity={0.12} />
          <path d="M43.5 44l2.3 2.4L51 41" className={GLYPH_TONES[tone]} {...line} />
        </svg>
      );

    // Delivered — breakfast bowl with steam + a small celebratory sparkle.
    case "delivered":
      return (
        <svg viewBox="0 0 64 64" className="h-20 w-20 sm:h-28 sm:w-28">
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="currentColor" stopOpacity={0.22} />
              <stop offset="100%" stopColor="currentColor" stopOpacity={0.06} />
            </linearGradient>
          </defs>
          <circle cx="30" cy="34" r="24" className={GLYPH_TONES[tone]} fill={`url(#${gradId})`} />
          <g className={GLYPH_TONES[tone]}>
            <path d="M14 34a16 16 0 0 0 32 0Z" {...line} />
            <path d="M14 34h32" {...line} />
          </g>
          <g className={ACCENT_TONES[tone]} opacity={0.75}>
            <path d="M24 26c0-2 1.6-2.8 1.6-5.2S24 17 24 17" {...line} />
            <path d="M32 24c0-2 1.6-2.8 1.6-5.2S32 15 32 15" {...line} />
          </g>
          {/* small celebration sparkle */}
          <path
            d="M48 16l1.8 3.8L54 21.6l-4.2 1.8L48 27.2l-1.8-3.8L42 21.6l4.2-1.8L48 16Z"
            className={GLYPH_TONES[tone]}
            fill="currentColor"
            opacity={0.75}
          />
        </svg>
      );

    // Failed — neutral, calm support illustration (headset), never alarming.
    case "failed":
      return (
        <svg viewBox="0 0 64 64" className="h-20 w-20 sm:h-28 sm:w-28">
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="currentColor" stopOpacity={0.18} />
              <stop offset="100%" stopColor="currentColor" stopOpacity={0.05} />
            </linearGradient>
          </defs>
          <circle cx="32" cy="32" r="24" className={GLYPH_TONES[tone]} fill={`url(#${gradId})`} />
          <g className={GLYPH_TONES[tone]}>
            <path d="M17 32a15 15 0 0 1 30 0" {...line} />
            <path d="M14 32v7a4 4 0 0 0 4 4h1.5V28H18a4 4 0 0 0-4 4Z" {...line} />
            <path d="M50 32v7a4 4 0 0 1-4 4h-1.5V28H46a4 4 0 0 1 4 4Z" {...line} />
            <path d="M46 43c0 3-3.6 5.5-8 5.5" {...line} />
          </g>
          <path
            d="M14 16c2.6-.8 4.8-2.6 4.6-5.4-2.7.6-4.8 2.4-4.6 5.4Z"
            className={ACCENT_TONES[tone]}
            fill="currentColor"
            opacity={0.55}
          />
        </svg>
      );

    // Empty / no delivery scheduled — a resting leaf.
    case "empty":
      return (
        <svg viewBox="0 0 64 64" className="h-16 w-16 sm:h-20 sm:w-20">
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="currentColor" stopOpacity={0.16} />
              <stop offset="100%" stopColor="currentColor" stopOpacity={0.04} />
            </linearGradient>
          </defs>
          <circle cx="32" cy="32" r="22" className={GLYPH_TONES[tone]} fill={`url(#${gradId})`} />
          <g className={GLYPH_TONES[tone]}>
            <path d="M19 42c-5-10-2-25 16-30 13 15 10 28 0 33-5 2.5-11 0-16-3Z" {...line} />
            <path d="M22 40c5-8 10-15 21-23" {...line} opacity={0.6} />
          </g>
        </svg>
      );

    // Paused / resting crescent.
    case "paused":
    default:
      return (
        <svg viewBox="0 0 64 64" className="h-16 w-16 sm:h-20 sm:w-20">
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="currentColor" stopOpacity={0.16} />
              <stop offset="100%" stopColor="currentColor" stopOpacity={0.04} />
            </linearGradient>
          </defs>
          <circle cx="32" cy="32" r="22" className={GLYPH_TONES[tone]} fill={`url(#${gradId})`} />
          <path
            d="M40 13a19 19 0 1 0 0 38 15.5 15.5 0 1 1 0-38Z"
            className={GLYPH_TONES[tone]}
            {...line}
          />
        </svg>
      );
  }
}

/**
 * A full-bleed soft gradient scene panel with the glyph centered inside,
 * plus quiet decorative accents (blurred blobs, and route dots for the
 * "in motion" states) so the panel reads as a designed illustration
 * rather than an icon floating in empty space.
 */
export function JourneyIllustration({
  id,
  tone = "slate",
  className,
}: {
  id: JourneyIllustrationId;
  tone?: Tone;
  className?: string;
}) {
  const showRoute = id === "assigned" || id === "out_for_delivery" || id === "reaching";

  return (
    <div
      className={cn(
        "relative flex h-full w-full items-center justify-center overflow-hidden bg-gradient-to-br",
        PANEL_GRADIENTS[tone],
        className,
      )}
    >
      <div
        className={cn(
          "pointer-events-none absolute -right-8 -top-10 h-36 w-36 rounded-full blur-3xl",
          BLOB_TONES[tone],
        )}
      />
      <div
        className={cn(
          "pointer-events-none absolute -bottom-10 -left-10 h-40 w-40 rounded-full blur-3xl",
          BLOB_TONES[tone],
        )}
      />
      <div
        className={cn(
          "pointer-events-none absolute left-1/2 top-1/2 h-44 w-44 -translate-x-1/2 -translate-y-1/2 rounded-full blur-2xl opacity-40",
          BLOB_TONES[tone],
        )}
      />

      <div className="relative">
        <Glyph id={id} tone={tone} />
      </div>

      {showRoute ? <RouteDots tone={tone} /> : null}
    </div>
  );
}
