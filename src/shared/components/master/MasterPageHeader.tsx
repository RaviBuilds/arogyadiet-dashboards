import { ReactNode } from "react";

interface MasterPageHeaderProps {
  title: string;
  description: string;
  action?: ReactNode;
}

/**
 * MasterPageHeader — Unique page header for the Master BI Command Center.
 * 
 * Design: Clean, minimal, data-first. No gradients, no cards.
 * Uses a subtle bottom border with a thin accent line for visual separation.
 * Matches the "command center" aesthetic — professional, focused, no decoration.
 */
export function MasterPageHeader({
  title,
  description,
  action,
}: MasterPageHeaderProps) {
  return (
    <div className="pb-5 mb-1 border-b border-slate-200/70">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-[1.65rem] font-bold tracking-tight text-slate-900 leading-tight">
            {title}
          </h1>
          <p className="mt-1.5 max-w-2xl text-[13px] leading-relaxed text-slate-500">
            {description}
          </p>
        </div>
        {action && (
          <div className="flex shrink-0 items-center gap-3">
            {action}
          </div>
        )}
      </div>
    </div>
  );
}
