// src/app/admin/(main)/log-customer/[id]/page.tsx
// Admin Portal — the Health_Log capture page a Dietitian reaches from the Log
// Customer list (dietitian-management, Req 15.5, 15.6, 15.15, 25.6).
//
// Server Component: guards the page to an active Core_Business Dietitian via
// `guardDietitianPage("/admin")`, resolves the customer + cadence data server-
// side (mirroring `getDietitianCustomerDetail`'s scope-then-read shape), and
// renders the portal-neutral `HealthLogEntryWorkspace`. The customer identity
// read reuses `checkDietitianScope` for the same scope guarantee every other
// Dietitian read applies (Req 5.8, 5.9) — a customer outside scope redirects
// to the Log Customer list with no data ever fetched.
//
// The workspace payload itself (Logging_Window, Log_Slot schedule, prefill and
// the KIT customer's own daily logs) comes from
// `loadLogWorkspaceData`, shared with the franchise counterpart so both portals
// show the same schedule (Req 23.4).

import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronLeft } from "lucide-react";

import { checkDietitianScope, guardDietitianPage } from "@/lib/auth/adminAccess";
import { AdminPageHeader } from "@/shared/components/admin/core/AdminPageHeader";
import { Button } from "@/shared/components/ui/button";
import { HealthLogEntryWorkspace } from "@/shared/components/dietitian/HealthLogEntryWorkspace";
import { KitSelfLogTrackerPanel } from "@/shared/components/dietitian/KitSelfLogTrackerPanel";
import { ReportCardHistorySection } from "@/shared/components/dietitian/ReportCardHistorySection";
import { getCustomerDetailRow } from "@/repositories/dietitian/assignmentRepository";
import { loadLogWorkspaceData } from "@/services/DietitianLogWorkspaceService";
import { getReportCardHistory } from "@/services/ReportCardService";

export const revalidate = false;

interface AdminLogCustomerDetailPageProps {
  params: Promise<{ id: string }>;
}

const LOG_CUSTOMER_LIST_HREF = "/log-customer";

export default async function AdminLogCustomerDetailPage({
  params,
}: AdminLogCustomerDetailPageProps) {
  await guardDietitianPage("/admin");
  const { id } = await params;

  const scope = await checkDietitianScope(id);
  if (!scope.ok) redirect(LOG_CUSTOMER_LIST_HREF);

  const detail = await getCustomerDetailRow(id);
  if (!detail) redirect(LOG_CUSTOMER_LIST_HREF);

  const [workspace, reportHistory] = await Promise.all([
    loadLogWorkspaceData(id, detail.category, scope.ctx.userId),
    // Every subscription/stay this customer has had, so an unfinished older
    // report stays reachable after a new period has started
    // (report-card-lifecycle Phase 2).
    getReportCardHistory(id, scope.ctx.userId),
  ]);

  // Derived from the history that was already fetched, so the notice costs no
  // extra query. The condition mirrors `HealthLogService`'s Amendment_Mode gate
  // exactly — ACTIVE and reopened at least once — so the workspace never claims
  // an edit window the server would refuse.
  const currentReport = reportHistory.entries.find(
    (entry) => entry.isCurrent,
  )?.reportCard;
  const amendmentMode =
    currentReport?.status === "ACTIVE" && currentReport.reopenCount > 0;

  return (
    <div className="flex flex-col gap-6 pb-4">
      <AdminPageHeader
        title="Log Customer"
        description="Record health logs for this customer's cadence slots."
        action={
          <Button variant="outline" asChild>
            <Link href={LOG_CUSTOMER_LIST_HREF}>
              <ChevronLeft className="h-4 w-4 mr-2" /> Back to Logs Page
            </Link>
          </Button>
        }
      />
      <HealthLogEntryWorkspace
        customerProfileId={id}
        customerName={detail.name}
        customerCode={detail.customerCode}
        mobile={detail.mobile}
        category={detail.category}
        slots={workspace.slots}
        initialSelectedDate={workspace.selectedDate}
        customParameterSuggestions={workspace.customParameterSuggestions}
        initialSelfLogs={workspace.selfLogs}
        initialValues={workspace.initialValues}
        initialEditable={workspace.initialEditable}
        slotsUnavailableReason={workspace.slotsUnavailableReason}
        amendmentMode={amendmentMode}
        selfLogTrackerPanel={
          workspace.kitSelfLog ? (
            <KitSelfLogTrackerPanel
              receivedDate={workspace.kitSelfLog.receivedDate}
              trackerEndDate={workspace.kitSelfLog.trackerEndDate}
              totalSkippedDays={workspace.kitSelfLog.totalSkippedDays}
              today={workspace.today}
              entries={workspace.kitSelfLog.entries}
            />
          ) : null
        }
      />
      <ReportCardHistorySection entries={reportHistory.entries} />
    </div>
  );
}
