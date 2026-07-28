import { Suspense } from "react";
import Link from "next/link";
import { MessageSquareWarning } from "lucide-react";
import { createAdminClient } from "@/lib/supabase/admin";
import OverviewShell from "./OverviewShell";
import NetworkReportSection from "./NetworkReportSection";
import DietitianActivitySection from "./DietitianActivitySection";

export const revalidate = 0;

export default async function MasterOverviewPage() {
  // Fetch open dispute count for the badge
  const admin = createAdminClient();
  const { count: openDisputeCount } = await admin
    .from("franchise_disputes")
    .select("id", { count: "exact", head: true })
    .eq("status", "Open");

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
            Command Center
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Real-time business intelligence across all ArogyaDiet operations.
          </p>
        </div>
        <Link
          href="/disputes"
          className="relative inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white/95 px-4 py-2.5 text-sm font-medium text-slate-700 shadow-sm backdrop-blur-sm transition-all duration-200 hover:border-slate-300 hover:shadow-md hover:text-slate-900"
        >
          <MessageSquareWarning className="h-4 w-4 text-amber-600" />
          Manage Disputes
          {(openDisputeCount ?? 0) > 0 && (
            <span className="inline-flex items-center justify-center min-w-5 h-5 px-1.5 rounded-full bg-red-500 text-white text-xs font-semibold">
              {openDisputeCount}
            </span>
          )}
        </Link>
      </div>
      <Suspense fallback={<OverviewSkeleton />}>
        <OverviewShell />
      </Suspense>

      {/* Consolidated cross-franchise reporting (additive, Task 13.7 — Req 11.5–11.9) */}
      <NetworkReportSection />

      {/* Dietitian dropdown + activity report + audit viewer (dietitian-management — Task 11.5, Req 18.8, 20.1) */}
      <DietitianActivitySection />
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
