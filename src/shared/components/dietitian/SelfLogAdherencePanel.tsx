// src/shared/components/dietitian/SelfLogAdherencePanel.tsx
// Feature: dietitian-management — task 10.6.
//
// A server-fed display component (design.md section 12): it receives the
// Self_Log list and the Self_Log adherence counts as props — already
// computed by `CadenceService.getCadenceForCustomer`/
// `computeCadenceForCustomers` (`skippedSelfLogCount`,
// `datesWithoutSelfLogCount`, `pausedDaysCount`) and already read via
// `getSelfLogForDate`/`getHealthLogTimeline` by the caller. It performs no
// data fetching and no counting itself — it renders the props it is given.
//
// Req 16.3: the panel shows the Self_Log list, the count of
// Skipped_Self_Logs, the count of dates within the Logging_Window with no
// Self_Log, and Paused_Days_Count.
// Req 16.4: for Customer_Category `MEAL` or `ACCOMMODATION`, every one of
// those counts is 0 and the Self_Log list is empty. `CadenceService`
// (`computeSelfLogAdherence`) already zeroes `skippedSelfLogCount` and
// `datesWithoutSelfLogCount` outside `KIT`, and the Self_Log repositories
// never return legacy accommodation/meal rows as Self_Logs, so this
// component does not need to re-derive the zeroing itself. It DOES add a
// defensive category check purely as a display safeguard: if a caller ever
// passes non-zero counts or a non-empty list alongside `category` `MEAL` or
// `ACCOMMODATION` (which should never happen given the upstream contract),
// the panel renders the zeroed/empty state anyway and surfaces a note so the
// mismatch is visible rather than silently displayed as real data.
//
// Requirements: 16.2, 16.3, 16.4

import type { CustomerCategory, HealthLog, ParameterValue } from "@/types/dietitian";
import { fieldByKey } from "@/lib/dietitian/fieldSets";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/shared/components/ui/card";

interface SelfLogAdherencePanelProps {
  /** The Customer_Record's Customer_Category — gates the Req 16.4 zeroing. */
  category: CustomerCategory;
  /**
   * The customer's Self_Logs (author type `CUSTOMER`), as returned by the
   * Health_Log timeline/read actions. Expected to be empty for `MEAL` and
   * `ACCOMMODATION` (Req 16.4).
   */
  selfLogs: readonly HealthLog[];
  /** Count of Self_Logs within the Logging_Window with status `FOOD_SKIPPED`. */
  skippedSelfLogCount: number;
  /** Count of dates within the Logging_Window that have no Self_Log. */
  datesWithoutSelfLogCount: number;
  /** Count of Paused_Days strictly after the Last_Dietitian_Log_Date. */
  pausedDaysCount: number;
}

/** Customer_Categories for which Self_Log adherence is always zero (Req 16.4). */
const ZERO_SELF_LOG_CATEGORIES: ReadonlySet<CustomerCategory> = new Set([
  "MEAL",
  "ACCOMMODATION",
]);

/**
 * Formats one recorded parameter value for display, mirroring
 * `DietitianReportTemplate.tsx`'s `formatParameterValue`.
 */
function formatParameterValue(value: ParameterValue): string {
  if ("systolic" in value) {
    return `${value.systolic}/${value.diastolic} ${value.unit}`;
  }
  if (typeof value.value === "boolean") {
    return value.value ? "Yes" : "No";
  }
  if (typeof value.value === "number") {
    return value.unit ? `${value.value} ${value.unit}` : `${value.value}`;
  }
  return value.value;
}

/** Format YYYY-MM-DD to a more readable display format (DD MMM YYYY). */
function formatDisplayDate(dateStr: string): string {
  const months = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];
  const [year, month, day] = dateStr.split("-").map(Number);
  if (!year || !month || !day) return dateStr;
  return `${day} ${months[month - 1]} ${year}`;
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-foreground/10 p-3">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 text-2xl font-semibold text-foreground">{value}</p>
    </div>
  );
}

function SelfLogEntry({ log }: { log: HealthLog }) {
  const keys = Object.keys(log.parameters);
  const hasCustomParameters = log.customParameters.length > 0;

  return (
    <div className="rounded-lg border border-foreground/10 p-3">
      <p className="text-sm font-semibold text-foreground">
        {formatDisplayDate(log.logDate)}
      </p>
      {keys.length === 0 && !hasCustomParameters ? (
        <p className="mt-1 text-sm text-muted-foreground">No values recorded</p>
      ) : (
        <dl className="mt-1 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
          {keys.map((key) => {
            const field = fieldByKey(key);
            const label = field?.label ?? key;
            return (
              <div key={key} className="flex justify-between gap-2 text-sm">
                <dt className="text-muted-foreground">{label}</dt>
                <dd className="text-right font-medium">
                  {formatParameterValue(log.parameters[key])}
                </dd>
              </div>
            );
          })}
          {log.customParameters.map((cp, i) => (
            <div
              key={`custom-${i}-${cp.label}`}
              className="flex justify-between gap-2 text-sm"
            >
              <dt className="text-muted-foreground">{cp.label}</dt>
              <dd className="text-right font-medium">
                {cp.value}
                {cp.unit ? ` ${cp.unit}` : ""}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

/**
 * Self_Log adherence panel for a Customer_Record: the Self_Log list, the
 * Skipped_Self_Log count, the missing-date count and Paused_Days_Count
 * (Req 16.3). Every count and the Self_Log list render as zero/empty for
 * `MEAL` and `ACCOMMODATION` (Req 16.4) — enforced defensively here even
 * though the upstream `CadenceService`/repositories already guarantee it.
 */
export function SelfLogAdherencePanel({
  category,
  selfLogs,
  skippedSelfLogCount,
  datesWithoutSelfLogCount,
  pausedDaysCount,
}: SelfLogAdherencePanelProps) {
  const isZeroCategory = ZERO_SELF_LOG_CATEGORIES.has(category);

  // Defensive display-only zeroing (Req 16.4): should never trigger given the
  // upstream contract, but guarantees this panel never shows non-zero
  // Self_Log adherence for MEAL/ACCOMMODATION even if it does.
  const displaySelfLogs = isZeroCategory ? [] : selfLogs;
  const displaySkippedSelfLogCount = isZeroCategory ? 0 : skippedSelfLogCount;
  const displayDatesWithoutSelfLogCount = isZeroCategory
    ? 0
    : datesWithoutSelfLogCount;

  const upstreamMismatch =
    isZeroCategory &&
    (selfLogs.length > 0 ||
      skippedSelfLogCount > 0 ||
      datesWithoutSelfLogCount > 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Self Log Adherence</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <StatCard label="Skipped Self Logs" value={displaySkippedSelfLogCount} />
          <StatCard
            label="Dates Without Self Log"
            value={displayDatesWithoutSelfLogCount}
          />
          <StatCard label="Paused Days" value={pausedDaysCount} />
        </div>

        {upstreamMismatch ? (
          <p className="text-xs text-amber-600">
            Note: non-zero Self_Log adherence data was received for a{" "}
            {category} customer, which should not happen — displaying the
            zeroed/empty state per Req 16.4 rather than the received values.
          </p>
        ) : null}

        <div className="space-y-2">
          <p className="text-sm font-medium text-foreground">Self Logs</p>
          {displaySelfLogs.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No self-logs recorded
            </p>
          ) : (
            <div className="space-y-2">
              {displaySelfLogs.map((log) => (
                <SelfLogEntry key={log.id} log={log} />
              ))}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
