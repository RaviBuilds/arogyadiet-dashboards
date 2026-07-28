// src/app/franchise/(main)/log-customer/[id]/page.tsx
// Franchise Portal — the Health_Log capture page a Franchise Dietitian
// reaches from the Log Customer list (dietitian-management, Req 15.5, 15.6,
// 15.15, 23.4, 25.6).
//
// Identical shape to the admin counterpart, reusing the same portal-neutral
// modules (`src/lib`, `src/shared`, `src/actions/dietitian-actions`,
// `src/repositories/dietitian`) — no import from `src/app/admin` (Req 23.7).

import Link from "next/link";
import { redirect } from "next/navigation";

import { checkDietitianScope, guardDietitianPage } from "@/lib/auth/adminAccess";
import { PageHeader } from "@/shared/components/franchise/ui/PageHeader";
import { Button } from "@/shared/components/ui/button";
import { HealthLogEntryWorkspace } from "@/shared/components/dietitian/HealthLogEntryWorkspace";
import { getCustomerDetailRow } from "@/repositories/dietitian/assignmentRepository";
import { getGoverningRecords, getPausedDatesSince } from "@/repositories/dietitian/cadenceRepository";
import { getCustomParameterLabelSuggestions } from "@/repositories/dietitian/healthLogRepository";
import { getSelfLogForDate } from "@/actions/dietitian-actions/healthLogActions";
import { deserializeCustomParameters } from "@/lib/dietitian/customParameters";
import { buildLogSlots, defaultSlotDate, slotDates } from "@/lib/dietitian/logSlots";
import { getISTDateString } from "@/lib/dates/ist";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ParameterValue } from "@/types/dietitian";
import { ChevronLeft, ClipboardList } from "lucide-react";

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

  const today = getISTDateString();
  const governingRecords = await getGoverningRecords([id]);
  const governing = governingRecords.get(id);

  const isActive = governing?.status === "ACTIVE";
  const windowStart = governing?.windowStart ?? today;
  const windowEnd = governing?.windowEnd ?? today;
  const pausedDates =
    governing && isActive
      ? (await getPausedDatesSince([id], windowStart)).get(id) ?? []
      : [];

  const slotInput = {
    category: detail.category,
    windowStart,
    windowEnd,
    today,
    pausedDates,
  };
  const dates = isActive ? slotDates(slotInput) : [];
  const { loggedDates, editableLoggedDates } = await getSlotLogStatuses(
    id,
    dates,
    today,
    scope.ctx.userId,
  );
  const slots = isActive
    ? buildLogSlots(slotInput, { loggedDates, editableLoggedDates })
    : [];
  const selectedDate = defaultSlotDate(slots);

  const [suggestions, selfLogResult, existingLog] = await Promise.all([
    getCustomParameterLabelSuggestions(id),
    selectedDate ? getSelfLogForDate(id, selectedDate) : Promise.resolve(null),
    selectedDate ? getExistingDietitianLog(id, selectedDate) : Promise.resolve(null),
  ]);

  const initialEditable = selectedDate
    ? existingLog
      ? editableLoggedDates.has(selectedDate)
      : true
    : true;

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
        slots={slots}
        initialSelectedDate={selectedDate}
        customParameterSuggestions={suggestions}
        initialSelfLogs={selfLogResult?.success ? selfLogResult.data : []}
        initialValues={existingLog}
        initialEditable={initialEditable}
      />
    </div>
  );
}

/**
 * Read which of `slotDates` already carry a Dietitian_Log for this customer,
 * and which of those are still inside their same-day edit window for the
 * acting Dietitian (Req 18.1, 18.2, 18.3).
 */
async function getSlotLogStatuses(
  customerProfileId: string,
  slotDatesList: string[],
  today: string,
  actorUserId: string,
): Promise<{ loggedDates: Set<string>; editableLoggedDates: Set<string> }> {
  const loggedDates = new Set<string>();
  const editableLoggedDates = new Set<string>();
  if (slotDatesList.length === 0) return { loggedDates, editableLoggedDates };

  const admin = createAdminClient();
  const { data } = await admin
    .from("health_logs")
    .select("log_date, submission_date_ist, author_user_id")
    .eq("customer_profile_id", customerProfileId)
    .eq("author_type", "DIETITIAN")
    .in("log_date", slotDatesList);

  for (const row of (data ?? []) as Array<{
    log_date: string;
    submission_date_ist: string | null;
    author_user_id: string | null;
  }>) {
    loggedDates.add(row.log_date);
    if (row.author_user_id === actorUserId && row.submission_date_ist === today) {
      editableLoggedDates.add(row.log_date);
    }
  }

  return { loggedDates, editableLoggedDates };
}

/**
 * Read an existing Dietitian_Log for `defaultDate`, if any, to prefill the
 * form for a same-day update (Req 15.9).
 */
async function getExistingDietitianLog(
  customerProfileId: string,
  logDate: string,
) {
  const admin = createAdminClient();
  const { data } = await admin
    .from("health_logs")
    .select("parameters, custom_parameters, closing_comment")
    .eq("customer_profile_id", customerProfileId)
    .eq("log_date", logDate)
    .eq("author_type", "DIETITIAN")
    .maybeSingle();

  if (!data) return null;

  return {
    parameters: (data.parameters as Record<string, ParameterValue>) ?? {},
    customParameters: deserializeCustomParameters(data.custom_parameters),
    closingComment: (data.closing_comment as string | null) ?? "",
  };
}
