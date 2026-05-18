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
    <Card className="border-border shadow-sm animate-in fade-in slide-in-from-bottom-4 duration-500">
      <CardHeader className="pb-4 border-b">{header}</CardHeader>

      <CardContent className="p-4 md:px-6">
        {(controls || actions) && (
          <div className="flex flex-col xl:flex-row justify-between items-start xl:items-center gap-4 mb-5">
            <div className="w-full xl:w-auto flex items-center gap-2 flex-wrap">
              {controls}
            </div>
            <div className="w-full xl:w-auto flex items-center gap-3 flex-wrap justify-end">
              {actions}
            </div>
          </div>
        )}

        <div className="rounded-md border bg-card overflow-hidden">
          {children}
        </div>

        {footer && (
          <div className="flex items-center justify-between pt-5 pb-1">
            {footer}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
