import { LucideIcon } from "lucide-react";
import { ReactNode } from "react";

interface SectionHeaderProps {
  title: string;
  /** Optional one-line explanation shown under the title. */
  description?: ReactNode;
  icon?: LucideIcon;
  action?: ReactNode; // For a toggle switch or button
  className?: string;
}

export function SectionHeader({
  title,
  description,
  icon: Icon,
  action,
  className = "",
}: SectionHeaderProps) {
  return (
    <div
      className={`flex items-start justify-between gap-4 ${className}`}
    >
      <div className="min-w-0">
        <h2 className="flex items-center gap-2.5 text-lg font-semibold tracking-tight text-slate-900">
          {Icon && <Icon className="h-5 w-5 text-emerald-600" />}
          {title}
        </h2>
        {description && (
          <p className="mt-1 text-sm text-slate-500">{description}</p>
        )}
      </div>
      {action && (
        <div className="flex shrink-0 items-center gap-3 transition-all duration-200">
          {action}
        </div>
      )}
    </div>
  );
}
