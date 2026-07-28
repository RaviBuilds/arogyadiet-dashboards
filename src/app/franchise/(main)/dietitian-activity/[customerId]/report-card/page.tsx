// src/app/franchise/(main)/dietitian-activity/[customerId]/report-card/page.tsx
// Franchise Owner's Report_Card page (dietitian-management — Task 13.1, Req
// 20.6, 23.6, 24.1).
//
// The Franchise_Owner gate lives in the parent Dietitian Activity page's own
// `guardFranchiseGroupAccess("customers")` call; this page re-applies the
// same gate (defense in depth for a direct navigation) and fetches the
// franchise-scoped Report_Card view model (`getFranchiseReportCard`), wiring
// `ReportCardView`'s `exportAction` prop to `exportFranchiseReportCardPdf`
// since the Franchise_Owner is not necessarily a Dietitian and the default
// `exportReportCardPdf` would reject them via `checkDietitianScope`.
//
// Imports nothing from `src/app/admin` (Req 23.7).

import { guardFranchiseGroupAccess } from "@/lib/auth/adminAccess";
import { PageHeader } from "@/shared/components/franchise/ui/PageHeader";
import {
  getFranchiseReportCard,
  exportFranchiseReportCardPdf,
} from "@/actions/franchise-actions/franchiseDietitianActivityActions";
import { ReportCardView } from "@/shared/components/dietitian/ReportCardView";
import { FileText } from "lucide-react";

export const revalidate = false;

interface FranchiseActivityReportCardPageProps {
  params: Promise<{ customerId: string }>;
}

export default async function FranchiseActivityReportCardPage({
  params,
}: FranchiseActivityReportCardPageProps) {
  await guardFranchiseGroupAccess("customers");
  const { customerId } = await params;

  const result = await getFranchiseReportCard(customerId);

  return (
    <div className="flex flex-col gap-6 pb-4">
      <PageHeader
        title="Report Card"
        subtitle="Health log history, trends and adherence for this customer."
        icon={FileText}
      />
      {result.success ? (
        <ReportCardView
          report={result.data}
          customerProfileId={customerId}
          exportAction={exportFranchiseReportCardPdf}
        />
      ) : (
        <div className="rounded-2xl border border-dashed border-slate-200 bg-white/50 py-16 text-center">
          <p className="text-sm font-medium text-slate-500">{result.error}</p>
        </div>
      )}
    </div>
  );
}
