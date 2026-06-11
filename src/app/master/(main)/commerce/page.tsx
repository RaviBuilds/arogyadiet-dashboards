import { Suspense } from "react";
import CommerceShell from "./CommerceShell";

export const revalidate = 0;

export default function CommercePage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
          Commerce & Inventory
        </h1>
        <p className="text-sm text-slate-500 mt-1">
          Add-on shop revenue, inventory alerts, and manufacturing yield metrics.
        </p>
      </div>
      <Suspense fallback={<CommerceSkeleton />}>
        <CommerceShell />
      </Suspense>
    </div>
  );
}

function CommerceSkeleton() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-24 rounded-2xl bg-slate-100 border border-slate-200" />
        ))}
      </div>
      <div className="h-80 rounded-2xl bg-slate-100 border border-slate-200" />
      <div className="h-64 rounded-2xl bg-slate-100 border border-slate-200" />
    </div>
  );
}
