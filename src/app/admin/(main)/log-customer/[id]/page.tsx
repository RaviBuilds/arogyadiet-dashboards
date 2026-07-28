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

import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronLeft } from "lucide-react";

import { checkDietitianScope, guardDietitianPage } from "@/lib/auth/adminAccess";
import { AdminPageHeader } from "@/shared/components/admin/core/AdminPageHeader";
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

  const today = getISTDateString();
  const governingRecords = await getGoverningRecords([id]);
  const governing = governingRecords.get(id);

  // Only an ACTIVE governing subscription/stay produces a slot schedule,
  // mirroring CadenceService's "non-ACTIVE => nothing pending" outcome.
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
 * acting Dietitian (Req 18.1, 18.2, 18.3). One batched query over the slot
 * dates feeds the Log_Slot status merge in `buildLogSlots`.
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
 * form for a same-day update (Req 15.9). A direct read against `health_logs`
 * is used here rather than the shared timeline view, since only a
 * `DIETITIAN`-authored row for this exact date is relevant to prefilling.
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
