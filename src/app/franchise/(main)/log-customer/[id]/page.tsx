// src/app/franchise/(main)/log-customer/[id]/page.tsx
// Franchise Portal — the Health_Log capture page a Franchise Dietitian
// reaches from the Log Customer list (dietitian-management, Req 15.5, 15.6,
// 15.15, 23.4, 25.6).
//
// Identical shape to the admin counterpart, reusing the same portal-neutral
// modules (`src/lib`, `src/shared`, `src/services`,
// `src/repositories/dietitian`) — no import from `src/app/admin` (Req 23.7).

import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronLeft, ClipboardList } from "lucide-react";

import { checkDietitianScope, guardDietitianPage } from "@/lib/auth/adminAccess";
import { PageHeader } from "@/shared/components/franchise/ui/PageHeader";
import { Button } from "@/shared/components/ui/button";
import { HealthLogEntryWorkspace } from "@/shared/components/dietitian/HealthLogEntryWorkspace";
import { KitSelfLogTrackerPanel } from "@/shared/components/dietitian/KitSelfLogTrackerPanel";
import { getCustomerDetailRow } from "@/repositories/dietitian/assignmentRepository";
import { loadLogWorkspaceData } from "@/services/DietitianLogWorkspaceService";

export const revalidate = false;

interface FranchiseLogCustomerDetailPageProps {
  params: Promise<{ id: string }>;
}

const LOG_CUSTOMER_LIST_HREF = "/log-customer";

export default async function FranchiseLogCustomerDetailPage({
  params,
}: FranchiseLogCustomerDetailPageProps) {
  await guardDietitianPage("/franchise");
  const { id } = await params;

  const scope = await checkDietitianScope(id);
  if (!scope.ok) redirect(LOG_CUSTOMER_LIST_HREF);

  const detail = await getCustomerDetailRow(id);
  if (!detail) redirect(LOG_CUSTOMER_LIST_HREF);

  const workspace = await loadLogWorkspaceData(
    id,
    detail.category,
    scope.ctx.userId,
  );

  return (
    <div className="flex flex-col gap-6 pb-4">
      <PageHeader
        title="Log Customer"
        subtitle="Record health logs for this customer's cadence slots."
        icon={ClipboardList}
        actions={
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
    </div>
  );
}
