// src/app/admin/(main)/customers/[id]/report-card/page.tsx
// Admin Portal — the per-customer Report_Card page (dietitian-management —
// Task 12.1, Req 5.4, 19.1).
//
// Server Component: guards the page to an active Core_Business Dietitian via
// `guardDietitianPage("/admin")`, then reads the Report_Card view model via
// the Dietitian-scoped `getReportCard` (self-gating through
// `checkDietitianScope`, and restricted to KIT/ACCOMMODATION — Req 19.1) and
// renders the shared, portal-neutral `ReportCardView`.

import { guardDietitianPage } from "@/lib/auth/adminAccess";
import { AdminPageHeader } from "@/shared/components/admin/core/AdminPageHeader";
import { getReportCard } from "@/actions/dietitian-actions/reportCardActions";
import { ReportCardView } from "@/shared/components/dietitian/ReportCardView";

export const revalidate = false;

interface AdminReportCardPageProps {
  params: Promise<{ id: string }>;
}

export default async function AdminReportCardPage({
  params,
}: AdminReportCardPageProps) {
  await guardDietitianPage("/admin");
  const { id } = await params;

  const result = await getReportCard(id);

  return (
    <div className="flex flex-col gap-6 pb-4">
      <AdminPageHeader
        title="Report Card"
        description="Health log history, trends and adherence for this customer."
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
