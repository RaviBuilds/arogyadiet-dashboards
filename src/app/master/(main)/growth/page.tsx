import { Suspense } from "react";
import GrowthShell from "./GrowthShell";

export const revalidate = 0;

export default function GrowthPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
          Growth & Subscriptions
        </h1>
        <p className="text-sm text-slate-500 mt-1">
          Customer acquisition, plan popularity, dietary preferences, and pause credit utilization.
        </p>
      </div>
      <Suspense fallback={<GrowthSkeleton />}>
        <GrowthShell />
      </Suspense>
    </div>
  );
}

function GrowthSkeleton() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="h-80 rounded-2xl bg-slate-100 border border-slate-200" />
        <div className="h-80 rounded-2xl bg-slate-100 border border-slate-200" />
        <div className="h-80 rounded-2xl bg-slate-100 border border-slate-200" />
      </div>
    </div>
  );
}
