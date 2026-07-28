// src/shared/components/dietitian/SelfLogReferencePanel.tsx
// Feature: dietitian-management — task 10.3.
//
// A server-fed display component (design.md section 12): it receives the
// Self_Log rows for the selected log date as a prop, already read via
// `getSelfLogForDate` by the caller (typically a Server Component wrapping
// the log page, or the client page's own fetch of that Server Action). It
// performs no data fetching itself and exposes no `onChange`/form-binding
// prop of any kind — there is no data path out of this component into
// `HealthLogForm`'s state.
//
// Req 25.6: when a Self_Log exists for the selected date, every recorded
// Self_Log value is displayed as read-only reference text beside the log
// form.
// Req 25.7: this component never pre-fills any log form field — it renders
// plain text only, wired to nothing. The "never pre-fills" guarantee is
// structural: `SelfLogReferencePanel` and `HealthLogForm` are independent
// siblings in the page layout, and this component holds no reference to the
// form's state, register functions or field values.
//
// Requirements: 25.6, 25.7

import type { HealthLog, ParameterValue } from "@/types/dietitian";
import { fieldByKey } from "@/lib/dietitian/fieldSets";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/shared/components/ui/card";

interface SelfLogReferencePanelProps {
  /**
   * The Self_Log(s) recorded for `logDate`, as returned by
   * `getSelfLogForDate`. Read-only reference data — never passed to, or
   * derived from, the log form.
   */
  selfLogs: readonly HealthLog[];
  /** The log date currently selected in the log form, YYYY-MM-DD. */
  logDate: string;
}

/**
 * Formats one recorded parameter value for read-only display, mirroring
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

function SelfLogEntry({ log }: { log: HealthLog }) {
  const keys = Object.keys(log.parameters);
  const hasCustomParameters = log.customParameters.length > 0;

  return (
    <div className="rounded-lg border border-foreground/10 p-3">
      {keys.length === 0 && !hasCustomParameters ? (
        <p className="text-sm text-muted-foreground">No values recorded</p>
      ) : (
        <dl className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
          {keys.map((key) => {
            const field = fieldByKey(key);
            const label = field?.label ?? key;
            return (
              <div key={key} className="flex justify-between gap-2 text-sm">
                <dt className="text-muted-foreground">{label}</dt>
                <dd className="font-medium text-right">
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
              <dd className="font-medium text-right">
                {cp.value}
                {cp.unit ? ` ${cp.unit}` : ""}
              </dd>
            </div>
          ))}
        </dl>
      )}
      {log.closingComment ? (
        <p className="mt-2 border-t border-foreground/10 pt-2 text-sm text-muted-foreground">
          {log.closingComment}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Read-only reference panel shown beside `HealthLogForm` for the selected log
 * date. Renders every recorded Self_Log value as plain text (Req 25.6) and
 * exposes no way to move a value into the form (Req 25.7) — it takes no
 * callback props and touches no form state.
 */
export function SelfLogReferencePanel({
  selfLogs,
  logDate,
}: SelfLogReferencePanelProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Self Log — {formatDisplayDate(logDate)}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {selfLogs.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No self-log recorded for this date
          </p>
        ) : (
          selfLogs.map((log) => <SelfLogEntry key={log.id} log={log} />)
        )}
      </CardContent>
    </Card>
  );
}
