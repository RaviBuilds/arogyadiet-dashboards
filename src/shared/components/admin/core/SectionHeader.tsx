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
      className={`flex items-center justify-between gap-4 mb-5 ${className}`}
    >
      <h2 className="text-lg font-bold text-foreground flex items-center gap-2">
        {Icon && <Icon className="h-5 w-5 text-muted-foreground" />}
        {title}
      </h2>
      {action && <div className="flex items-center gap-3">{action}</div>}
    </div>
  );
}
