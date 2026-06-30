import type { LucideIcon } from "lucide-react";

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  icon?: LucideIcon;
  /** Optional right-aligned content such as actions or badges */
  actions?: React.ReactNode;
}

/**
 * Premium page header with gradient title text, an ambient glow behind
 * the icon, and a refined subtitle. Designed for an enterprise SaaS feel.
 */
export function PageHeader({ title, subtitle, icon: Icon, actions }: PageHeaderProps) {
  return (
    <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="relative flex items-start gap-4">
        {Icon && (
          <div className="relative mt-0.5 hidden sm:block">
            {/* Ambient glow behind the icon */}
            <div className="absolute inset-0 -z-10 animate-pulse rounded-2xl bg-primary/20 blur-xl" />
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-primary/10 to-secondary/10 ring-1 ring-inset ring-white/60 shadow-[0_8px_30px_rgb(0,0,0,0.06)] backdrop-blur-sm">
              <Icon className="h-6 w-6 text-primary" />
            </div>
          </div>
        )}

        <div className="space-y-1.5">
          <h1 className="bg-gradient-to-r from-slate-900 via-slate-800 to-slate-600 bg-clip-text text-2xl font-bold tracking-tight text-transparent sm:text-3xl">
            {title}
          </h1>
          {subtitle && (
            <p className="max-w-2xl text-sm font-medium tracking-wide text-slate-500">
              {subtitle}
            </p>
          )}
        </div>
      </div>

      {actions && <div className="flex items-center gap-3">{actions}</div>}
    </div>
  );
}
