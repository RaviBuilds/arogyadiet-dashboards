import { Suspense } from "react";
import LogisticsShell from "./LogisticsShell";

export const revalidate = 0;

export default function LogisticsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
          Logistics & Fleet
        </h1>
        <p className="text-sm text-slate-500 mt-1">
          Delivery performance, pincode density, and rider fleet analytics.
        </p>
      </div>
      <Suspense fallback={<LogisticsSkeleton />}>
        <LogisticsShell />
      </Suspense>
    </div>
  );
}

function LogisticsSkeleton() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="h-24 rounded-2xl bg-slate-100 border border-slate-200" />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="h-80 rounded-2xl bg-slate-100 border border-slate-200" />
        <div className="h-80 rounded-2xl bg-slate-100 border border-slate-200" />
      </div>
    </div>
  );
}
