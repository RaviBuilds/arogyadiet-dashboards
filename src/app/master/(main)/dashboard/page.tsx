import { Suspense } from "react";
import OverviewShell from "./OverviewShell";

export const revalidate = 0;

export default function MasterOverviewPage() {
  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div>
        <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
          Command Center
        </h1>
        <p className="text-sm text-slate-500 mt-1">
          Real-time business intelligence across all ArogyaDiet operations.
        </p>
      </div>
      <Suspense fallback={<OverviewSkeleton />}>
        <OverviewShell />
      </Suspense>
    </div>
  );
}

function OverviewSkeleton() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-5">
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="h-28 rounded-2xl bg-slate-100 border border-slate-200" />
        ))}
      </div>
      <div className="h-[400px] rounded-2xl bg-slate-100 border border-slate-200" />
    </div>
  );
}
