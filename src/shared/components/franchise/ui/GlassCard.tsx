import { cn } from "@/lib/utils";

interface GlassCardProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Adds hover lift interaction */
  interactive?: boolean;
}

/**
 * Premium glass-edged card: soft diffused shadow, white inner ring,
 * generous rounding. Replaces harsh 1px-bordered cards.
 */
export function GlassCard({ className, interactive, children, ...props }: GlassCardProps) {
  return (
    <div
      className={cn(
        "rounded-2xl bg-white/70 p-6 shadow-[0_8px_30px_rgb(0,0,0,0.04)] ring-1 ring-inset ring-white/60 backdrop-blur-xl",
        interactive &&
          "transition-all duration-300 hover:-translate-y-0.5 hover:shadow-[0_12px_40px_rgb(0,0,0,0.08)]",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

interface StatCardProps {
  icon: React.ElementType;
  label: string;
  value: React.ReactNode;
  sub?: string;
  /** tailwind text color class, e.g. "text-emerald-600" */
  accent?: string;
  /** tailwind bg color class, e.g. "bg-emerald-50" */
  accentBg?: string;
}

/**
 * Premium metric tile with uppercase wide-tracking label and
 * tight-tracking large value.
 */
export function StatCard({
  icon: Icon,
  label,
  value,
  sub,
  accent = "text-primary",
  accentBg = "bg-primary/10",
}: StatCardProps) {
  return (
    <GlassCard interactive className="p-5">
      <div className="flex items-start justify-between">
        <div className="space-y-2.5">
          <p className="text-xs font-medium uppercase tracking-wider text-slate-400">
            {label}
          </p>
          <p className={cn("text-3xl font-semibold tracking-tight", accent)}>
            {value}
          </p>
          {sub && <p className="text-xs text-slate-400">{sub}</p>}
        </div>
        <div
          className={cn(
            "flex h-11 w-11 items-center justify-center rounded-xl ring-1 ring-inset ring-white/60",
            accentBg,
          )}
        >
          <Icon className={cn("h-5 w-5", accent)} />
        </div>
      </div>
    </GlassCard>
  );
}

interface SectionCardProps {
  icon: React.ElementType;
  title: string;
  /** Small uppercase subtitle shown under the title */
  subtitle?: string;
  /** Right-aligned content such as search, filters, actions */
  actions?: React.ReactNode;
  /** Optional secondary note line shown below the header row */
  note?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

/**
 * Premium section card with a consistent header strip:
 * icon-tile + title + uppercase subtitle, optional right-aligned actions.
 * Body has consistent padding. Used for all data tables / content panels.
 */
export function SectionCard({
  icon: Icon,
  title,
  subtitle,
  actions,
  note,
  children,
  className,
}: SectionCardProps) {
  return (
    <GlassCard className={cn("overflow-hidden p-0", className)}>
      <div className="border-b border-slate-100/80 p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 ring-1 ring-inset ring-white/60">
              <Icon className="h-4 w-4 text-primary" />
            </div>
            <div>
              <h2 className="text-sm font-semibold tracking-tight text-slate-800">
                {title}
              </h2>
              {subtitle && (
                <p className="text-xs uppercase tracking-wider text-slate-400">
                  {subtitle}
                </p>
              )}
            </div>
          </div>
          {actions && (
            <div className="flex flex-wrap items-center gap-3">{actions}</div>
          )}
        </div>
        {note && <div className="mt-3">{note}</div>}
      </div>
      <div className="p-6 pt-4">{children}</div>
    </GlassCard>
  );
}
