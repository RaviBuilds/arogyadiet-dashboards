import { Suspense } from "react";
import { AdminPageHeader } from "@/shared/components/admin/core/AdminPageHeader";
import DashboardShell from "./DashboardShell";

export const revalidate = 0;

export default function MasterDashboardPage() {
  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Executive Dashboard"
        description="Real-time business intelligence across subscriptions, fleet logistics, and kitchen operations."
      />
      <Suspense fallback={<DashboardSkeleton />}>
        <DashboardShell />
      </Suspense>
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="space-y-6 animate-pulse">
      {/* Date controls skeleton */}
      <div className="flex gap-2">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="h-9 w-20 rounded-lg bg-slate-200" />
        ))}
      </div>
      {/* KPI ribbon skeleton */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="h-36 rounded-2xl bg-slate-100 border border-slate-200" />
        ))}
      </div>
      {/* Tabs skeleton */}
      <div className="h-12 w-80 rounded-lg bg-slate-100" />
      {/* Content skeleton */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="h-80 rounded-2xl bg-slate-100 border border-slate-200" />
        <div className="h-80 rounded-2xl bg-slate-100 border border-slate-200" />
      </div>
    </div>
  );
}
