import { LucideIcon } from "lucide-react";
import { ReactNode } from "react";

interface SectionHeaderProps {
  title: string;
  icon?: LucideIcon;
  action?: ReactNode; // For a toggle switch or button
  className?: string;
}

export function SectionHeader({
  title,
  icon: Icon,
  action,
  className = "",
}: SectionHeaderProps) {
  return (
    <div
      className={`flex items-center justify-between gap-4 ${className}`}
    >
      <h2 className="flex items-center gap-2.5 text-lg font-semibold tracking-tight text-slate-900">
        {Icon && <Icon className="h-5 w-5 text-emerald-600" />}
        {title}
      </h2>
      {action && (
        <div className="flex items-center gap-3 transition-all duration-200">
          {action}
        </div>
      )}
    </div>
  );
}
