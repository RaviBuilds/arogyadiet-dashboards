// src/shared/components/dietitian/HealthLogTimeline.tsx
// Feature: dietitian-management — task 10.6.
//
// A server-fed display component (design.md section 12): it receives a
// Customer_Record's full Health_Log timeline as a prop — already read via
// `getHealthLogTimeline` and already date-ordered ascending by `log_date`
// then `submitted_at` per that repository function's contract (see
// `src/repositories/dietitian/healthLogRepository.ts`'s `getHealthLogTimeline`
// doc comment). This component performs no data fetching itself; it renders
// the `logs` prop as-is.
//
// Req 25.3, 12.7: Dietitian_Logs and Self_Logs are rendered in ONE unified,
// date-ordered list — never as two separate lists — with each entry labelling
// its author type, and every recorded parameter (including every
// Custom_Parameter) displayed.
// Req 13.5: each entry's Closing_Comment is shown with the author name and
// submission timestamp.
//
// Parameter/value formatting mirrors `DietitianReportTemplate.tsx`'s
// `ParameterEntryCard`/`formatParameterValue` (the PDF Report_Card renderer),
// adapted from react-pdf primitives to Shadcn UI/HTML — so a value reads the
// same way on screen as it does in the exported PDF.
//
// Requirements: 12.7, 13.5, 25.3

import { fieldByKey } from "@/lib/dietitian/fieldSets";
import type { HealthLog, ParameterValue } from "@/types/dietitian";
import { Badge } from "@/shared/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/shared/components/ui/card";

interface HealthLogTimelineProps {
  /**
   * The customer's full Health_Log timeline, already date-ordered ascending
   * (oldest first) by `getHealthLogTimeline`. Dietitian_Logs and Self_Logs
   * arrive interleaved in this single list — this component does not split,
   * re-sort or re-group them (Req 25.3, 12.7).
   */
  logs: readonly HealthLog[];
}

/**
 * Formats one recorded parameter value for display, mirroring
 * `DietitianReportTemplate.tsx`'s `formatParameterValue`: `value unit` for a
 * numeric parameter, `Yes`/`No` for a boolean, the composite
 * `systolic/diastolic unit` for `bp`, and the raw string for `enum`/`text`.
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

/** Format an ISO 8601 submission timestamp for display, in IST. */
function formatSubmittedAt(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(date);
}

function AuthorBadge({ log }: { log: HealthLog }) {
  if (log.authorType === "DIETITIAN") {
    return (
      <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700">
        {log.authorName ? `Dietitian · ${log.authorName}` : "Dietitian"}
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="border-blue-200 bg-blue-50 text-blue-700">
      Self Log
    </Badge>
  );
}

function HealthLogEntry({ log }: { log: HealthLog }) {
  const keys = Object.keys(log.parameters);
  const hasCustomParameters = log.customParameters.length > 0;

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-2 space-y-0">
        <span className="text-sm font-semibold text-foreground">
          {formatDisplayDate(log.logDate)}
        </span>
        <AuthorBadge log={log} />
      </CardHeader>
      <CardContent className="space-y-3">
        {keys.length === 0 && !hasCustomParameters ? (
          <p className="text-sm text-muted-foreground">
            No parameter values recorded
          </p>
        ) : (
          <dl className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
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

        {log.closingComment ? (
          <div className="border-t border-foreground/10 pt-3">
            <p className="text-sm text-foreground">{log.closingComment}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {log.authorName ?? "Unknown"} · {formatSubmittedAt(log.submittedAt)}
            </p>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

/**
 * Single date-ordered timeline of a Customer_Record's Dietitian_Logs and
 * Self_Logs, interleaved (Req 25.3, 12.7). Each entry labels its author type
 * — with the author name for Dietitian entries (Req 13.5) — displays every
 * recorded parameter value and every Custom_Parameter, and shows the
 * Closing_Comment with the author name and submission timestamp.
 */
export function HealthLogTimeline({ logs }: HealthLogTimelineProps) {
  if (logs.length === 0) {
    return (
      <Card>
        <CardContent className="py-6 text-center text-sm text-muted-foreground">
          No health logs recorded yet
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {logs.map((log) => (
        <HealthLogEntry key={log.id} log={log} />
      ))}
    </div>
  );
}
