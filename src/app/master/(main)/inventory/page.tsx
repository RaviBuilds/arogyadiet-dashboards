import { Suspense } from "react";
import InventoryIntelligenceShell from "./InventoryIntelligenceShell";

export const revalidate = 0;

export default function InventoryIntelligencePage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
          Inventory Intelligence
        </h1>
        <p className="text-sm text-slate-500 mt-1">
          Warehouse valuation, stock health, expiry risk, and shop product
          catalog analytics — raw materials, finished goods, and Browse Shop
          listings in one place.
        </p>
      </div>
      <Suspense fallback={<InventorySkeleton />}>
        <InventoryIntelligenceShell />
      </Suspense>
    </div>
  );
}

function InventorySkeleton() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
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
      <div className="h-80 rounded-2xl bg-slate-100 border border-slate-200" />
      <div className="h-96 rounded-2xl bg-slate-100 border border-slate-200" />
    </div>
  );
}
