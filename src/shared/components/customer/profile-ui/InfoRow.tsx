import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * InfoRow — read-mode "label above value" row, formalized from the pattern
 * already used ad hoc on the dashboard (Start Date / End Date, delivery
 * info). Used in profile view mode so fields read as a summary rather than
 * disabled form inputs.
 */
export function InfoRow({
  icon: Icon,
  label,
  value,
  className,
}: {
  icon?: LucideIcon;
  label: string;
  value: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex items-start gap-2.5", className)}>
      {Icon ? (
        <Icon className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
      ) : null}
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium uppercase tracking-wider text-slate-500">
          {label}
        </p>
        <p className="mt-0.5 truncate text-sm font-semibold text-slate-900">
          {value || <span className="font-normal text-slate-400">Not set</span>}
        </p>
      </div>
    </div>
  );
}
