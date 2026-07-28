// src/app/franchise/(main)/customers/[id]/report-card/page.tsx
// Franchise Portal — the per-customer Report_Card page (dietitian-management —
// Task 13.1, Req 23.6).
//
// Server Component: guards the page to an active Franchise Dietitian via
// `guardDietitianPage("/franchise")`, then reads the Report_Card view model
// via the Dietitian-scoped `getReportCard` (self-gating through
// `checkDietitianScope`, restricted to KIT/ACCOMMODATION — Req 19.1) and
// renders the shared, portal-neutral `ReportCardView`. Identical wiring to
// the admin Report_Card page — `getReportCard`/`exportReportCardPdf` are
// portal-neutral by design, so no franchise-specific action is needed here
// (unlike the Dietitian Activity page, which is opened by the Franchise
// Owner rather than the Dietitian themselves).
//
// Imports nothing from `src/app/admin` (Req 23.7).

import { guardDietitianPage } from "@/lib/auth/adminAccess";
import { PageHeader } from "@/shared/components/franchise/ui/PageHeader";
import { getReportCard } from "@/actions/dietitian-actions/reportCardActions";
import { ReportCardView } from "@/shared/components/dietitian/ReportCardView";
import { FileText } from "lucide-react";

export const revalidate = false;

interface FranchiseReportCardPageProps {
  params: Promise<{ id: string }>;
}

export default async function FranchiseReportCardPage({
  params,
}: FranchiseReportCardPageProps) {
  await guardDietitianPage("/franchise");
  const { id } = await params;

  const result = await getReportCard(id);

  return (
    <div className="flex flex-col gap-6 pb-4">
      <PageHeader
        title="Report Card"
        subtitle="Health log history, trends and adherence for this customer."
        icon={FileText}
      />
      {result.success ? (
        <ReportCardView report={result.data} customerProfileId={id} />
      ) : (
        <div className="rounded-2xl border border-dashed border-slate-200 bg-white/50 py-16 text-center">
          <p className="text-sm font-medium text-slate-500">{result.error}</p>
        </div>
      )}
    </div>
  );
}
