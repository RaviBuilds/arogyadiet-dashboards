import { cn } from "@/lib/utils";

/**
 * ProgressRing — a reusable circular progress indicator for journey/momentum
 * visualisations across all customer types (Meal, KIT, Accommodation).
 *
 * Pure server component (SVG only, no client JS). Progress is expressed as a
 * 0–100 percentage so callers can map any domain value (days elapsed, meals
 * enjoyed, program completion) onto the same visual primitive.
 */
type ProgressRingProps = {
  /** Completion percentage, 0–100. Values are clamped. */
  value: number;
  /** Outer diameter in pixels. */
  size?: number;
  /** Stroke thickness in pixels. */
  strokeWidth?: number;
  /** Track (unfilled) colour. */
  trackClassName?: string;
  /** Progress (filled) colour. */
  progressClassName?: string;
  /** Centre content (e.g. the day number). */
  children?: React.ReactNode;
  className?: string;
};

export function ProgressRing({
  value,
  size = 132,
  strokeWidth = 10,
  trackClassName = "text-white/25",
  progressClassName = "text-white",
  children,
  className,
}: ProgressRingProps) {
  const clamped = Math.max(0, Math.min(100, value));
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference * (1 - clamped / 100);

  return (
    <div
      className={cn("relative shrink-0", className)}
      style={{ width: size, height: size }}
    >
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className="-rotate-90"
        role="img"
        aria-label={`${Math.round(clamped)} percent complete`}
      >
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={strokeWidth}
          className={trackClassName}
          stroke="currentColor"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
          className={progressClassName}
          stroke="currentColor"
          style={{ transition: "stroke-dashoffset 700ms ease-out" }}
        />
      </svg>
      {children ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center leading-none">
          {children}
        </div>
      ) : null}
    </div>
  );
}
