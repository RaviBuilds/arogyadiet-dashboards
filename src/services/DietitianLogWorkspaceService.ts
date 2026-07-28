// src/services/DietitianLogWorkspaceService.ts
// Feature: dietitian-management — everything the Log Customer detail page needs,
// assembled once for both portals.
//
// The admin and franchise Log Customer detail pages render the identical
// portal-neutral `HealthLogEntryWorkspace`, so they resolve identical data: the
// governing Logging_Window, the cadence-driven Log_Slot schedule with its
// logged/editable status merged in, the Dietitian_Log to prefill for the opened
// slot, and — for a KIT customer — the customer's own daily Self_Logs
// (Req 15.5, 15.6, 15.9, 16.3, 18.1, 18.2, 23.4, 25.6).
//
// LAYERING: orchestration only. Scope enforcement stays with the caller
// (`checkDietitianScope`/`guardDietitianPage` run before this is invoked, as on
// every other Dietitian read path), the cadence math stays pure in
// `src/lib/dietitian/*`, and the reads stay in `src/repositories/dietitian/*`.

import { getISTDateString } from "@/lib/dates/ist";
import { cadenceIntervalFor } from "@/lib/dietitian/cadence";
import { deserializeCustomParameters } from "@/lib/dietitian/customParameters";
import { toKitSelfLogEntry, type KitSelfLogEntry } from "@/lib/dietitian/kitSelfLog";
import {
  buildLogSlots,
  defaultSlotDate,
  slotDates,
  type LogSlot,
} from "@/lib/dietitian/logSlots";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  getGoverningRecords,
  getNonEligibleDatesSince,
} from "@/repositories/dietitian/cadenceRepository";
import {
  getCustomParameterLabelSuggestions,
  getKitSelfLogTracker,
} from "@/repositories/dietitian/healthLogRepository";
import { getSelfLogForDate } from "@/actions/dietitian-actions/healthLogActions";
import type {
  CustomerCategory,
  CustomParameter,
  HealthLog,
  ParameterValue,
} from "@/types/dietitian";

/** The prefill values a slot's existing Dietitian_Log carries. */
export interface DietitianLogPrefill {
  parameters: Record<string, ParameterValue>;
  customParameters: CustomParameter[];
  closingComment: string;
}

/** The customer's own KIT daily logs plus the tracker window they belong to. */
export interface KitSelfLogTrackerView {
  receivedDate: string | null;
  trackerEndDate: string | null;
  totalSkippedDays: number;
  entries: KitSelfLogEntry[];
}

export interface LogWorkspaceData {
  today: string;
  slots: LogSlot[];
  selectedDate: string | null;
  customParameterSuggestions: string[];
  selfLogs: HealthLog[];
  initialValues: DietitianLogPrefill | null;
  initialEditable: boolean;
  /** Non-null only for KIT, the one category with customer self-logging. */
  kitSelfLog: KitSelfLogTrackerView | null;
  /** Why `slots` is empty, or `null` when it is not. */
  slotsUnavailableReason: string | null;
}

/**
 * Resolve the Log Customer workspace for one in-scope customer.
 *
 * Only an ACTIVE governing subscription/stay produces a slot schedule,
 * mirroring the Cadence_Engine's "non-ACTIVE => nothing pending" outcome
 * (Req 14.7). For KIT the Logging_Window is the KIT Tracker window
 * (`kit_received_date … kit_tracker_end_date`), resolved in
 * `getGoverningRecords`, and the customer's skipped days are excluded from
 * Eligible_Days just like MEAL Paused_Days — so a KIT customer gets the same
 * every-3rd-day slot schedule a MEAL customer gets.
 */
export async function loadLogWorkspaceData(
  customerProfileId: string,
  category: CustomerCategory,
  actorUserId: string,
): Promise<LogWorkspaceData> {
  const today = getISTDateString();

  const governingRecords = await getGoverningRecords([customerProfileId]);
  const governing = governingRecords.get(customerProfileId);

  const isActive = governing?.status === "ACTIVE";
  const windowStart = governing?.windowStart ?? today;
  const windowEnd = governing?.windowEnd ?? today;

  const nonEligibleDates =
    governing && isActive
      ? ((await getNonEligibleDatesSince([customerProfileId], windowStart)).get(
          customerProfileId,
        ) ?? [])
      : [];

  const slotInput = {
    category,
    windowStart,
    windowEnd,
    today,
    pausedDates: nonEligibleDates,
  };

  const dates = isActive ? slotDates(slotInput) : [];
  const { loggedDates, editableLoggedDates } = await getSlotLogStatuses(
    customerProfileId,
    dates,
    today,
    actorUserId,
  );
  const slots = isActive
    ? buildLogSlots(slotInput, { loggedDates, editableLoggedDates })
    : [];
  const selectedDate = defaultSlotDate(slots);

  const [suggestions, selfLogResult, existingLog, kitTracker] = await Promise.all([
    getCustomParameterLabelSuggestions(customerProfileId),
    selectedDate
      ? getSelfLogForDate(customerProfileId, selectedDate)
      : Promise.resolve(null),
    selectedDate
      ? getExistingDietitianLog(customerProfileId, selectedDate)
      : Promise.resolve(null),
    category === "KIT"
      ? getKitSelfLogTracker(customerProfileId)
      : Promise.resolve(null),
  ]);

  return {
    today,
    slots,
    selectedDate,
    customParameterSuggestions: suggestions,
    selfLogs: selfLogResult?.success ? selfLogResult.data : [],
    initialValues: existingLog,
    initialEditable: selectedDate
      ? existingLog
        ? editableLoggedDates.has(selectedDate)
        : true
      : true,
    kitSelfLog: kitTracker
      ? {
          receivedDate: kitTracker.receivedDate,
          trackerEndDate: kitTracker.trackerEndDate,
          totalSkippedDays: kitTracker.totalSkippedDays,
          entries: kitTracker.logs.map(toKitSelfLogEntry),
        }
      : null,
    slotsUnavailableReason:
      slots.length > 0
        ? null
        : describeMissingSlots({
            category,
            hasGoverningRecord: Boolean(governing),
            status: governing?.status ?? null,
            isActive,
            kitReceivedDate: kitTracker?.receivedDate ?? null,
          }),
  };
}

// ---------------------------------------------------------------------------
// Internal
// ---------------------------------------------------------------------------

/**
 * Read which of `slotDatesList` already carry a Dietitian_Log for this
 * customer, and which of those are still inside their same-day edit window for
 * the acting Dietitian (Req 18.1, 18.2, 18.3). One batched query over the slot
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
 * Read an existing Dietitian_Log for the opened slot, if any, to prefill the
 * form for a same-day update (Req 15.9). A direct read against `health_logs` is
 * used rather than the shared timeline view, since only a `DIETITIAN`-authored
 * row for this exact date is relevant to prefilling.
 */
async function getExistingDietitianLog(
  customerProfileId: string,
  logDate: string,
): Promise<DietitianLogPrefill | null> {
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

/** Plain-language reason an in-scope customer has no Log_Slot to record. */
function describeMissingSlots(input: {
  category: CustomerCategory;
  hasGoverningRecord: boolean;
  status: string | null;
  isActive: boolean;
  kitReceivedDate: string | null;
}): string {
  if (input.category === "KIT" && !input.kitReceivedDate) {
    return "The customer has not confirmed their kit receipt yet, so the log schedule has not started.";
  }

  if (!input.hasGoverningRecord) {
    return input.category === "ACCOMMODATION"
      ? "This customer has no stay on record, so no log slots exist yet."
      : "This customer has no dated subscription on record, so no log slots exist yet.";
  }

  if (!input.isActive) {
    const status = (input.status ?? "").toLowerCase() || "inactive";
    return `This customer's subscription is ${status}, so no log slots are scheduled. Historical logs remain visible on the Customer 360 page.`;
  }

  const interval = cadenceIntervalFor(input.category);
  return `The first log slot falls on day ${interval} of the plan, which has not been reached yet.`;
}
