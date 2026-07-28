// src/app/franchise/(main)/dietitian-activity/page.tsx
// Franchise Portal — the Franchise_Owner's Dietitian Activity page
// (dietitian-management — Task 13.1, Req 24.1, 24.2, 24.3, 24.4).
//
// Server Component: gated by `guardFranchiseGroupAccess("customers")` (Req
// 24.3) — a Franchise user whose Access_Level does not grant the customers
// group is redirected before this page renders anything. Fetches the
// Franchise-scoped Dietitian_Activity_Report via
// `getFranchiseDietitianActivityReport` and renders the shared, portal-neutral
// `DietitianActivityReport`, or the `No dietitian is assigned to this
// franchise` message (Req 24.4) when the Franchise has no active Dietitian.
//
// Imports nothing from `src/app/admin` (Req 23.7).

import { guardFranchiseGroupAccess } from "@/lib/auth/adminAccess";
import { PageHeader } from "@/shared/components/franchise/ui/PageHeader";
import { getFranchiseDietitianActivityReport } from "@/actions/franchise-actions/franchiseDietitianActivityActions";
import { DietitianActivityReport } from "@/shared/components/dietitian/DietitianActivityReport";
import { NO_DIETITIAN_FOR_FRANCHISE } from "@/lib/dietitian/messages";
import { Activity } from "lucide-react";

export const revalidate = false;

export default async function FranchiseDietitianActivityPage() {
  await guardFranchiseGroupAccess("customers");

  const result = await getFranchiseDietitianActivityReport();

  return (
    <div className="flex flex-col gap-6 pb-4">
      <PageHeader
        title="Dietitian Activity"
        subtitle="Track your dietitian's logging cadence and pending customers."
        icon={Activity}
      />
      {!result.success ? (
        <div className="rounded-2xl border border-dashed border-slate-200 bg-white/50 py-16 text-center">
          <p className="text-sm font-medium text-slate-500">{result.error}</p>
        </div>
      ) : result.data === null ? (
        <div className="rounded-2xl border border-dashed border-slate-200 bg-white/50 py-16 text-center">
          <p className="text-sm font-medium text-slate-500">{NO_DIETITIAN_FOR_FRANCHISE}</p>
        </div>
      ) : (
        <DietitianActivityReport
          summary={result.data}
          reportCardHrefFor={(customerProfileId) =>
            `/dietitian-activity/${customerProfileId}/report-card`
          }
        />
      )}
    </div>
  );
}
