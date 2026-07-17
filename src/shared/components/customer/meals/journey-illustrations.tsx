import { cn } from "@/lib/utils";

/**
 * journey-illustrations — full-bleed, handcrafted SVG *scenes* for My Meals'
 * "Today's Meal Journey" card.
 *
 * Design intent: this is the emotional highlight of /meals, answering "where
 * is my meal right now?" with a small piece of storytelling, not a
 * status icon. Every state below is staged as a scene — sky/ground, a
 * couple of environmental details, a simple flat human figure where a person
 * belongs in the story (a chef, a delivery partner), and one focal object —
 * built from soft organic shapes (rounded, hand-drawn-feeling curves, no
 * sharp corporate corners) so it reads as "designed for ArogyaDiet" rather
 * than a stock icon pack. A few elements carry very slow, low-amplitude
 * idle loops (steam, wheels, a drifting cloud, a pulsing pin, a twinkling
 * sparkle) — see the `.journey-*` animation classes in globals.css — so the
 * card feels like meal is actually in motion, without ever being busy.
 * All motion is disabled under `prefers-reduced-motion: reduce`, resting on
 * a fully-formed static pose.
 *
 * Deliberately NOT the Dashboard's food photography and NOT generic icon-pack
 * glyphs — every shape here is hand-built for this page.
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

type Tone = "orange" | "green" | "amber" | "slate";

const PANEL_GRADIENTS: Record<Tone, string> = {
  orange: "from-orange-100 via-amber-50/70 to-white",
  green: "from-emerald-100 via-teal-50/60 to-white",
  amber: "from-amber-100 via-orange-50/50 to-white",
  slate: "from-slate-100 via-slate-50/80 to-white",
};

const BLOB_TONES: Record<Tone, string> = {
  orange: "bg-orange-200/50",
  green: "bg-emerald-200/50",
  amber: "bg-amber-200/50",
  slate: "bg-slate-300/40",
};

/** Line-art stroke color for each tone's scene. */
const LINE_TONES: Record<Tone, string> = {
  orange: "text-orange-700",
  green: "text-emerald-700",
  amber: "text-amber-700",
  slate: "text-slate-500",
};

/** Solid "sticker" accent fill (leaf, sun, badge) for each tone's scene. */
const ACCENT_TONES: Record<Tone, string> = {
  orange: "text-orange-400",
  green: "text-emerald-400",
  amber: "text-amber-400",
  slate: "text-slate-300",
};

const line = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

/** Simple flat figure: round head + soft rounded body, arms as strokes. Kept
 *  intentionally abstract (no facial detail beyond a warm little smile) so
 *  it reads as "a person" without needing illustration-grade rendering. */
function Figure({
  x,
  y,
  tone,
  wave = false,
  flip = false,
}: {
  x: number;
  y: number;
  tone: Tone;
  wave?: boolean;
  flip?: boolean;
}) {
  const s = flip ? -1 : 1;
  return (
    <g transform={`translate(${x} ${y})`} className={LINE_TONES[tone]}>
      <circle cx={0} cy={-24} r={7} fill="currentColor" opacity={0.85} />
      <path d={`M -9 2 Q -9 -16 0 -16 Q 9 -16 9 2 Z`} fill="currentColor" opacity={0.85} />
      {wave ? (
        <path d={`M ${6 * s} -14 Q ${16 * s} -20 ${15 * s} -30`} {...line} strokeWidth={2.4} />
      ) : (
        <path d={`M ${-6 * s} -8 Q ${-13 * s} -2 ${-11 * s} 6`} {...line} strokeWidth={2.4} />
      )}
      <path d={`M 4 -8 Q 11 -2 9 6`} {...line} strokeWidth={2.4} />
    </g>
  );
}

function Scene({ id, tone }: { id: JourneyIllustrationId; tone: Tone }) {
  const gradId = `jg-${id}`;
  const lineCls = LINE_TONES[tone];
  const accentCls = ACCENT_TONES[tone];

  switch (id) {
    // Kitchen at work — pot on the counter with rising steam, a fresh leaf +
    // vegetable board, a chef figure leaning in to check on things, sunrise
    // glow through the "window" up top.
    case "planned":
      return (
        <svg viewBox="0 0 240 190" className="h-full w-full" preserveAspectRatio="xMidYMax slice">
          <defs>
            <radialGradient id={gradId} cx="78%" cy="18%" r="55%">
              <stop offset="0%" stopColor="currentColor" stopOpacity={0.35} />
              <stop offset="100%" stopColor="currentColor" stopOpacity={0} />
            </radialGradient>
          </defs>
          <circle cx={188} cy={34} r={70} className={accentCls} fill={`url(#${gradId})`} />
          <circle
            cx={188}
            cy={34}
            r={16}
            className={cn(accentCls, "journey-glow-breathe")}
            fill="currentColor"
            opacity={0.55}
          />

          {/* counter / ground */}
          <path d="M0 152h240" className={lineCls} {...line} strokeWidth={2.5} opacity={0.5} />

          {/* pot */}
          <g className={lineCls}>
            <path d="M52 118h56l-4 30a10 10 0 0 1-10 9H66a10 10 0 0 1-10-9l-4-30Z" {...line} />
            <path d="M46 118h68" {...line} />
            <path d="M60 118v-7a20 20 0 0 1 40 0v7" {...line} />
            <path d="M40 106h10M150 106h-10" {...line} opacity={0.7} />
          </g>
          {/* steam */}
          <path
            d="M68 100c0-5 4-7 4-12s-4-7-4-11"
            className={cn(lineCls, "journey-steam-1")}
            {...line}
          />
          <path
            d="M92 96c0-5 4-7 4-12s-4-7-4-11"
            className={cn(lineCls, "journey-steam-2")}
            {...line}
          />

          {/* chopping board + vegetables */}
          <g transform="translate(150 128)">
            <rect x={-2} y={0} width={62} height={16} rx={6} className={lineCls} {...line} />
            <circle cx={16} cy={-3} r={9} className={accentCls} fill="currentColor" opacity={0.7} />
            <path d="M16 -12c3-4 8-5 11-3" className={lineCls} {...line} strokeWidth={1.6} opacity={0.7} />
            <path
              d="M40 -2c4-6 12-7 16-3-4 7-12 8-16 3Z"
              className={accentCls}
              fill="currentColor"
              opacity={0.75}
            />
          </g>

          <Figure x={196} y={150} tone={tone} />
        </svg>
      );

    // Delivery partner assigned — scooter with the meal bag secured, rider
    // giving a friendly wave, a calm "ready" badge overhead.
    case "assigned":
      return (
        <svg viewBox="0 0 240 190" className="h-full w-full" preserveAspectRatio="xMidYMax slice">
          <defs>
            <radialGradient id={gradId} cx="80%" cy="15%" r="55%">
              <stop offset="0%" stopColor="currentColor" stopOpacity={0.3} />
              <stop offset="100%" stopColor="currentColor" stopOpacity={0} />
            </radialGradient>
          </defs>
          <circle cx={190} cy={30} r={70} className={accentCls} fill={`url(#${gradId})`} />

          <path d="M0 158h240" className={lineCls} {...line} strokeWidth={2.5} opacity={0.45} />

          {/* scooter */}
          <g className={lineCls}>
            <g className="journey-wheel-spin" transform="translate(58 148)">
              <circle r={13} {...line} />
              <path d="M0 -7v14M-7 0h14" {...line} strokeWidth={1.4} opacity={0.6} />
            </g>
            <g className="journey-wheel-spin" transform="translate(122 148)">
              <circle r={13} {...line} />
              <path d="M0 -7v14M-7 0h14" {...line} strokeWidth={1.4} opacity={0.6} />
            </g>
            <path d="M58 148h20l12 -30h28" {...line} />
            <path d="M98 118h14l10 20h-13" {...line} />
            <path d="M78 118h20" {...line} />
            {/* meal bag on the rack */}
            <rect x={128} y={94} width={26} height={24} rx={5} {...line} />
            <path d="M134 94v-5a4 4 0 0 1 8 0v5" {...line} strokeWidth={1.6} />
          </g>

          {/* ready badge */}
          <g transform="translate(184 78)" className={lineCls}>
            <circle
              r={17}
              className={cn(accentCls, "journey-pin-pulse")}
              fill="currentColor"
              opacity={0.18}
            />
            <circle r={17} {...line} />
            <path d="M-7 0l5 5 10 -11" {...line} strokeWidth={2.2} />
          </g>

          <Figure x={40} y={150} tone={tone} wave flip />
        </svg>
      );

    // Out for delivery — scooter moving through morning streets: sunrise,
    // trees, drifting cloud, spinning wheels, a light trail of motion lines.
    case "out_for_delivery":
      return (
        <svg viewBox="0 0 240 190" className="h-full w-full" preserveAspectRatio="xMidYMax slice">
          <defs>
            <radialGradient id={gradId} cx="30%" cy="18%" r="55%">
              <stop offset="0%" stopColor="currentColor" stopOpacity={0.32} />
              <stop offset="100%" stopColor="currentColor" stopOpacity={0} />
            </radialGradient>
          </defs>
          <circle cx={70} cy={38} r={72} className={accentCls} fill={`url(#${gradId})`} />
          <path d="M30 40a24 24 0 0 1 48 0" className={accentCls} {...line} opacity={0.7} />

          {/* drifting cloud */}
          <g className={cn(lineCls, "journey-cloud-drift")} transform="translate(150 30)">
            <path
              d="M0 10a10 10 0 0 1 19-4 8 8 0 0 1 1 16H4a7 7 0 0 1-4-12Z"
              fill="currentColor"
              opacity={0.35}
            />
          </g>

          {/* trees */}
          <g className={accentCls} opacity={0.8}>
            <circle cx={26} cy={110} r={16} fill="currentColor" />
            <circle cx={214} cy={100} r={14} fill="currentColor" />
          </g>
          <g className={lineCls} opacity={0.6}>
            <path d="M26 122v20" {...line} />
            <path d="M214 112v22" {...line} />
          </g>

          {/* road */}
          <path d="M0 158h240" className={lineCls} {...line} strokeWidth={2.5} opacity={0.45} />
          <path d="M64 158h14M96 158h14M128 158h14" className={lineCls} {...line} strokeWidth={2} opacity={0.3} />

          {/* motion lines */}
          <g className={accentCls} opacity={0.7}>
            <path d="M18 128h20" {...line} />
            <path d="M10 138h16" {...line} />
            <path d="M22 118h14" {...line} />
          </g>

          {/* scooter in motion */}
          <g className={lineCls} transform="translate(30 0)">
            <g className="journey-wheel-spin" transform="translate(90 148)">
              <circle r={13} {...line} />
              <path d="M0 -7v14M-7 0h14" {...line} strokeWidth={1.4} opacity={0.6} />
            </g>
            <g className="journey-wheel-spin" transform="translate(154 148)">
              <circle r={13} {...line} />
              <path d="M0 -7v14M-7 0h14" {...line} strokeWidth={1.4} opacity={0.6} />
            </g>
            <path d="M90 148h20l12 -30h28" {...line} />
            <path d="M130 118h14l10 20h-13" {...line} />
            <path d="M110 118h20" {...line} />
            <rect x={160} y={94} width={24} height={22} rx={5} {...line} />
          </g>
        </svg>
      );

    // Reaching location — the house is right there: scooter closing in, a
    // location pin dropping in above the door with a gentle pulse.
    case "reaching":
      return (
        <svg viewBox="0 0 240 190" className="h-full w-full" preserveAspectRatio="xMidYMax slice">
          <defs>
            <radialGradient id={gradId} cx="72%" cy="20%" r="55%">
              <stop offset="0%" stopColor="currentColor" stopOpacity={0.3} />
              <stop offset="100%" stopColor="currentColor" stopOpacity={0} />
            </radialGradient>
          </defs>
          <circle cx={182} cy={40} r={70} className={accentCls} fill={`url(#${gradId})`} />

          <path d="M0 158h240" className={lineCls} {...line} strokeWidth={2.5} opacity={0.45} />

          {/* house */}
          <g className={lineCls} transform="translate(150 0)">
            <path d="M8 96l38 -30 38 30" {...line} />
            <path d="M18 92v46h56V92" {...line} />
            <path d="M32 138v-22h24v22" {...line} />
            <rect x={64} y={104} width={12} height={12} rx={2} {...line} opacity={0.7} />
          </g>
          {/* welcoming glow at the door */}
          <circle cx={194} cy={132} r={4} className={accentCls} fill="currentColor" opacity={0.6} />

          {/* pin dropping above the house, pulsing */}
          <g transform="translate(196 58)" className={cn(lineCls, "journey-pin-pulse")}>
            <path
              d="M0 -26c-9 0-16 7-16 16 0 12 16 28 16 28s16-16 16-28c0-9-7-16-16-16Z"
              fill="currentColor"
              opacity={0.16}
            />
            <path d="M0 -26c-9 0-16 7-16 16 0 12 16 28 16 28s16-16 16-28c0-9-7-16-16-16Z" {...line} />
            <circle r={5.5} cy={-10} {...line} />
          </g>

          {/* scooter approaching */}
          <g className={lineCls}>
            <g className="journey-wheel-spin" transform="translate(48 148)">
              <circle r={12} {...line} />
              <path d="M0 -6v12M-6 0h12" {...line} strokeWidth={1.3} opacity={0.6} />
            </g>
            <g className="journey-wheel-spin" transform="translate(104 148)">
              <circle r={12} {...line} />
              <path d="M0 -6v12M-6 0h12" {...line} strokeWidth={1.3} opacity={0.6} />
            </g>
            <path d="M48 148h18l11 -27h24" {...line} />
            <path d="M83 121h12l9 18h-11" {...line} />
            <path d="M66 121h17" {...line} />
          </g>
          <g className={accentCls} opacity={0.7}>
            <path d="M16 130h16" {...line} />
            <path d="M10 140h12" {...line} />
          </g>
        </svg>
      );

    // Under review — calm, unhurried clock with a gentle checking badge.
    // Deliberately quiet: no alarm colors, no urgent motion.
    case "reviewing":
      return (
        <svg viewBox="0 0 240 190" className="h-full w-full" preserveAspectRatio="xMidYMax slice">
          <defs>
            <radialGradient id={gradId} cx="50%" cy="30%" r="55%">
              <stop offset="0%" stopColor="currentColor" stopOpacity={0.22} />
              <stop offset="100%" stopColor="currentColor" stopOpacity={0} />
            </radialGradient>
          </defs>
          <circle cx={120} cy={82} r={78} className={accentCls} fill={`url(#${gradId})`} />

          <g className={lineCls}>
            <circle cx={112} cy={90} r={38} {...line} />
            <path d="M112 68v22l17 12" {...line} />
          </g>
          <path d="M164 60a48 48 0 0 1 6 26" className={accentCls} {...line} opacity={0.6} />
          <path d="M54 90a48 48 0 0 1 6 -26" className={accentCls} {...line} opacity={0.6} />

          <g transform="translate(166 128)" className={cn(lineCls, "journey-glow-breathe")}>
            <circle r={20} className={accentCls} fill="currentColor" opacity={0.14} />
          </g>
          <g transform="translate(166 128)" className={lineCls}>
            <circle r={20} {...line} />
            <path d="M-8 0l6 6 12 -13" {...line} strokeWidth={2.2} />
          </g>
        </svg>
      );

    // Delivered — meal served, steam, sunlight and a little sparkle of
    // celebration. This is the payoff moment of the whole story.
    case "delivered":
      return (
        <svg viewBox="0 0 240 190" className="h-full w-full" preserveAspectRatio="xMidYMax slice">
          <defs>
            <radialGradient id={gradId} cx="72%" cy="15%" r="60%">
              <stop offset="0%" stopColor="currentColor" stopOpacity={0.35} />
              <stop offset="100%" stopColor="currentColor" stopOpacity={0} />
            </radialGradient>
          </defs>
          <circle cx={176} cy={34} r={78} className={accentCls} fill={`url(#${gradId})`} />

          <path d="M0 158h240" className={lineCls} {...line} strokeWidth={2.5} opacity={0.4} />

          {/* bowl */}
          <g className={lineCls} transform="translate(56 78)">
            <path d="M0 40a40 40 0 0 0 80 0Z" {...line} />
            <path d="M-6 40h92" {...line} />
            <path d="M18 40a22 22 0 0 1 44 0" opacity={0.55} {...line} />
          </g>
          {/* leaf garnish, gently floating */}
          <path
            d="M92 74c6-7 17-8 22-2-5 7-15 8-22 2Z"
            className={cn(accentCls, "journey-leaf-float")}
            fill="currentColor"
            opacity={0.7}
          />
          {/* steam */}
          <path d="M78 66c0-5 4-7 4-12s-4-7-4-11" className={cn(lineCls, "journey-steam-1")} {...line} />
          <path d="M106 62c0-5 4-7 4-12s-4-7-4-11" className={cn(lineCls, "journey-steam-2")} {...line} />

          {/* sparkles */}
          <path
            d="M184 60l3 7 7 3-7 3-3 7-3-7-7-3 7-3Z"
            className={cn(lineCls, "journey-sparkle-1")}
            fill="currentColor"
            opacity={0.85}
          />
          <path
            d="M204 96l2 5 5 2-5 2-2 5-2-5-5-2 5-2Z"
            className={cn(accentCls, "journey-sparkle-2")}
            fill="currentColor"
            opacity={0.85}
          />
        </svg>
      );

    // We hit a snag — a calm, supportive scene: someone is already on it.
    // Neutral tones only, no red, no alarm iconography.
    case "failed":
      return (
        <svg viewBox="0 0 240 190" className="h-full w-full" preserveAspectRatio="xMidYMax slice">
          <defs>
            <radialGradient id={gradId} cx="50%" cy="26%" r="55%">
              <stop offset="0%" stopColor="currentColor" stopOpacity={0.2} />
              <stop offset="100%" stopColor="currentColor" stopOpacity={0} />
            </radialGradient>
          </defs>
          <circle cx={120} cy={78} r={76} className={accentCls} fill={`url(#${gradId})`} />

          <g className={lineCls} transform="translate(120 92)">
            <path d="M-34 0a34 34 0 0 1 68 0" {...line} />
            <path d="M-34 0v16a9 9 0 0 0 9 9h3V6h-3a9 9 0 0 0-9 10Z" {...line} />
            <path d="M34 0v16a9 9 0 0 1-9 9h-3V6h3a9 9 0 0 1 9 10Z" {...line} />
            <path d="M25 25c0 7-8 12-18 12" {...line} />
          </g>
          <g transform="translate(168 46)" className={cn(lineCls, "journey-glow-breathe")}>
            <path
              d="M-13 6c0-7 5-13 13-13s13 6 13 13c0 8-13 18-13 18s-13-10-13-18Z"
              fill="currentColor"
              opacity={0.16}
            />
          </g>
          <g transform="translate(168 46)" className={lineCls}>
            <path d="M-6 -1l4 4 8 -8" {...line} strokeWidth={2.2} />
          </g>
        </svg>
      );

    // Empty / nothing scheduled — a single resting leaf, gently floating.
    case "empty":
      return (
        <svg viewBox="0 0 240 190" className="h-full w-full" preserveAspectRatio="xMidYMax slice">
          <defs>
            <radialGradient id={gradId} cx="50%" cy="35%" r="50%">
              <stop offset="0%" stopColor="currentColor" stopOpacity={0.16} />
              <stop offset="100%" stopColor="currentColor" stopOpacity={0} />
            </radialGradient>
          </defs>
          <circle cx={120} cy={90} r={70} className={accentCls} fill={`url(#${gradId})`} />
          <g className={cn(lineCls, "journey-leaf-float")}>
            <path d="M96 118c-16-32-6-80 51-96 42 48 32 90 0 106-16 8-35 0-51-10Z" {...line} />
            <path d="M104 110c16-26 32-48 67-74" {...line} opacity={0.55} />
          </g>
        </svg>
      );

    // Paused / resting crescent — quiet, no motion.
    case "paused":
    default:
      return (
        <svg viewBox="0 0 240 190" className="h-full w-full" preserveAspectRatio="xMidYMax slice">
          <defs>
            <radialGradient id={gradId} cx="50%" cy="35%" r="50%">
              <stop offset="0%" stopColor="currentColor" stopOpacity={0.16} />
              <stop offset="100%" stopColor="currentColor" stopOpacity={0} />
            </radialGradient>
          </defs>
          <circle cx={120} cy={90} r={70} className={accentCls} fill={`url(#${gradId})`} />
          <path
            d="M136 46a58 58 0 1 0 0 88 47 47 0 1 1 0-88Z"
            className={lineCls}
            {...line}
          />
        </svg>
      );
  }
}

/**
 * A full-bleed scene panel — the SVG story fills the entire illustration
 * space (no floating icon in empty gradient) with a couple of soft blurred
 * light wells behind it for depth, matching the rest of the app's
 * illustration language (see MealsHero's mealBowlIllustration).
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
  return (
    <div
      className={cn(
        "relative h-full w-full overflow-hidden bg-gradient-to-br",
        PANEL_GRADIENTS[tone],
        className,
      )}
    >
      <div
        className={cn(
          "pointer-events-none absolute -right-10 -top-12 h-40 w-40 rounded-full blur-3xl",
          BLOB_TONES[tone],
        )}
      />
      <div
        className={cn(
          "pointer-events-none absolute -bottom-12 -left-10 h-40 w-40 rounded-full blur-3xl",
          BLOB_TONES[tone],
        )}
      />
      <Scene id={id} tone={tone} />
    </div>
  );
}
