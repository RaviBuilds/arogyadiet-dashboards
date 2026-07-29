// src/shared/components/customer/health-report/Sparkline.tsx
//
// A dependency-free inline SVG trend line for the vitals tiles and the trend
// card. Recharts is already in the bundle for the dietitian's Report_Card, but a
// customer-facing tile only needs a shape — an SVG path costs nothing to ship and
// renders identically on the server.
//
// Pure presentational: it scales the given readings into the viewBox and draws a
// soft area, the line, and a dot on the most recent point.

const TONE_STROKE: Record<string, string> = {
  emerald: "#10b981",
  amber: "#f59e0b",
  sky: "#0ea5e9",
  violet: "#8b5cf6",
};

interface SparklineProps {
  /** Chronological readings, oldest first. Needs at least two to draw. */
  values: readonly number[];
  tone?: keyof typeof TONE_STROKE;
  className?: string;
  height?: number;
  width?: number;
}

export function Sparkline({
  values,
  tone = "emerald",
  className,
  height = 30,
  width = 88,
}: SparklineProps) {
  if (values.length < 2) return null;

  const stroke = TONE_STROKE[tone] ?? TONE_STROKE.emerald;
  const gradientId = `spark-${tone}-${values.length}-${Math.round(values[0])}`;

  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const padY = 3;

  const points = values.map((value, index) => {
    const x = (index / (values.length - 1)) * width;
    const y = padY + (1 - (value - min) / span) * (height - padY * 2);
    return { x, y };
  });

  const line = points
    .map((point, index) => `${index === 0 ? "M" : "L"}${point.x.toFixed(1)} ${point.y.toFixed(1)}`)
    .join(" ");
  const area = `${line} L${width} ${height} L0 ${height} Z`;
  const last = points[points.length - 1];

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      className={className}
      role="presentation"
      aria-hidden="true"
      preserveAspectRatio="none"
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity="0.22" />
          <stop offset="100%" stopColor={stroke} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gradientId})`} />
      <path
        d={line}
        fill="none"
        stroke={stroke}
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
      <circle cx={last.x} cy={last.y} r="2.4" fill={stroke} />
    </svg>
  );
}
