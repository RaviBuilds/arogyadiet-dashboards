import { Suspense } from "react";
import KitchenOpsShell from "./KitchenOpsShell";

export const revalidate = 0;

export default function KitchenOpsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
          Kitchen Operations
        </h1>
        <p className="text-sm text-slate-500 mt-1">
          Meal category distribution, 5 PM cutoff compliance, and automation health.
        </p>
      </div>
      <Suspense fallback={<KitchenOpsSkeleton />}>
        <KitchenOpsShell />
      </Suspense>
    </div>
  );
}

function KitchenOpsSkeleton() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="h-24 rounded-2xl bg-slate-100 border border-slate-200" />
        ))}
      </div>
      <div className="h-80 rounded-2xl bg-slate-100 border border-slate-200" />
      <div className="h-64 rounded-2xl bg-slate-100 border border-slate-200" />
    </div>
  );
}
