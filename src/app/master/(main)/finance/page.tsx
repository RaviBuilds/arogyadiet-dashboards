import { Suspense } from "react";
import FinanceCommandCenter from "./FinanceCommandCenter";

export const revalidate = 0;

export default function MasterFinancePage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
          Finance & Payout Command Center
        </h1>
        <p className="text-sm text-slate-500 mt-1">
          Subscription revenue analytics, rider payout cycles, manual
          adjustments, and multi-channel payment tracking — all in one place.
        </p>
      </div>
      <Suspense fallback={<FinanceSkeleton />}>
        <FinanceCommandCenter />
      </Suspense>
    </div>
  );
}

function FinanceSkeleton() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="h-10 w-72 rounded-xl bg-slate-100 border border-slate-200" />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <div
            key={i}
            className="h-24 rounded-2xl bg-slate-100 border border-slate-200"
          />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            className="h-72 rounded-2xl bg-slate-100 border border-slate-200"
          />
        ))}
      </div>
      <div className="h-96 rounded-2xl bg-slate-100 border border-slate-200" />
    </div>
  );
}
