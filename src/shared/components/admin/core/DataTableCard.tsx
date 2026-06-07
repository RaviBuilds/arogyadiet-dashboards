import { ReactNode } from "react";
import { Card, CardContent, CardHeader } from "@/shared/components/ui/card";

interface DataTableCardProps {
  header: ReactNode; // Typically a SectionHeader component
  controls?: ReactNode; // Left side controls (e.g. DataSearchFilter)
  actions?: ReactNode; // Right side controls (e.g. RefreshButton)
  children: ReactNode; // The actual Table goes here
  footer?: ReactNode; // Totals, pagination, etc.
}

export function DataTableCard({
  header,
  controls,
  actions,
  children,
  footer,
}: DataTableCardProps) {
  return (
    <Card className="animate-in fade-in slide-in-from-bottom-4 rounded-xl border border-slate-200 bg-white shadow-sm duration-500">
      <CardHeader className="border-b border-slate-200 bg-slate-50/50 p-6 pb-4">
        {header}
      </CardHeader>

      <CardContent className="p-6">
        {(controls || actions) && (
          <div className="mb-6 flex flex-col items-start justify-between gap-4 xl:flex-row xl:items-center">
            <div className="flex w-full flex-wrap items-center gap-4 xl:w-auto">
              {controls}
            </div>
            <div className="flex w-full flex-wrap items-center justify-end gap-3 xl:w-auto">
              {actions}
            </div>
          </div>
        )}

        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          {children}
        </div>

        {footer && (
          <div className="flex items-center justify-between pb-1 pt-6">
            {footer}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
