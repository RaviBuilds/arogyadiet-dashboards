// src/app/master/(main)/dietitian-activity/[customerId]/report-card/page.tsx
// Master Report_Card page (dietitian-management — Task 11.5, Req 20.6).
//
// The MASTER_ADMIN gate lives in the parent `(main)/layout.tsx`; this page
// only fetches the master-scoped Report_Card view model
// (`getMasterReportCard`) and renders the shared, portal-neutral
// `ReportCardView`, wiring its `exportAction` prop to
// `exportMasterReportCardPdf` since a master admin is not a Dietitian and the
// default `exportReportCardPdf` would reject them via `checkDietitianScope`.

import { MasterPageHeader } from "@/shared/components/master/MasterPageHeader";
import { BackToSystem } from "@/shared/components/master/BackToSystem";
import { getMasterReportCard, exportMasterReportCardPdf } from "@/actions/master-actions/dietitianActivityActions";
import { ReportCardView } from "@/shared/components/dietitian/ReportCardView";

export const revalidate = 0;

interface MasterReportCardPageProps {
  params: Promise<{ customerId: string }>;
}

export default async function MasterReportCardPage({
  params,
}: MasterReportCardPageProps) {
  const { customerId } = await params;
  const result = await getMasterReportCard(customerId);

  return (
    <div className="space-y-6">
      <MasterPageHeader
        title="Report Card"
        description="Health log history, trends and adherence for this customer."
        action={<BackToSystem />}
      />
      {result.success ? (
        <ReportCardView
          report={result.data}
          customerProfileId={customerId}
          exportAction={exportMasterReportCardPdf}
        />
      ) : (
        <div className="rounded-2xl border border-dashed border-slate-200 bg-white/50 py-16 text-center">
          <p className="text-sm font-medium text-slate-500">{result.error}</p>
        </div>
      )}
    </div>
  );
}
