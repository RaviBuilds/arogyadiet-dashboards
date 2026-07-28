// src/shared/components/dietitian/KitSelfLogTrackerPanel.tsx
// Feature: dietitian-management — the KIT customer's own daily logs, shown to
// the Dietitian on the Log Customer page (Req 16.3, 25.6).
//
// KIT logging is two-way: the customer updates their day from the
// Customer_Portal (food taken with the day's measurements, or meal skipped)
// while the Dietitian records a Health_Log every 3rd day from this page. This
// panel is the Dietitian's read-only view of the customer's side, rendered as
// the same chip strip the Log_Slot selector uses so both schedules read the
// same way:
//   - taken    — the customer logged the day (emerald)
//   - skipped  — the customer skipped the meal (amber); each skipped day also
//                pushes the tracker end date out by one
//   - missing  — the day passed with no update at all (rose — the gap the
//                Dietitian needs to chase)
//   - upcoming — still in the future (muted)
//
// Strictly presentational and server-renderable: every value arrives as a prop,
// already read by the page. Like `SelfLogReferencePanel`, it holds no reference
// to the Health_Log form's state and exposes no callback, so there is no path
// from a customer Self_Log into the Dietitian's form (Req 25.7) and no write
// path to a Self_Log (Req 25.4).

import { format } from "date-fns";
import {
  CalendarCheck,
  CalendarClock,
  CalendarX2,
  ClipboardList,
  SkipForward,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { parseISODateString } from "@/lib/dates/ist";
import {
  buildKitSelfLogDays,
  filledKitSelfLogFields,
  summarizeKitSelfLogDays,
  type KitSelfLogDay,
  type KitSelfLogDayStatus,
  type KitSelfLogEntry,
} from "@/lib/dietitian/kitSelfLog";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/shared/components/ui/card";

export interface KitSelfLogTrackerPanelProps {
  /** `subscriptions.kit_received_date` — tracker start, `null` if unconfirmed. */
  receivedDate: string | null;
  /** `subscriptions.kit_tracker_end_date` — tracker end, `null` if unconfirmed. */
  trackerEndDate: string | null;
  /** Trigger-maintained skipped-day count on the subscription. */
  totalSkippedDays: number;
  /** Current IST calendar date, YYYY-MM-DD (injected by the page). */
  today: string;
  /** Every Self_Log the customer recorded for the governing KIT subscription. */
  entries: readonly KitSelfLogEntry[];
}

const STATUS_META: Record<
  KitSelfLogDayStatus,
  { label: string; chipClass: string; dotClass: string }
> = {
  taken: {
    label: "Food taken",
    chipClass: "border-emerald-300 bg-emerald-50 text-emerald-900",
    dotClass: "bg-emerald-500",
  },
  skipped: {
    label: "Meal skipped",
    chipClass: "border-amber-300 bg-amber-50 text-amber-900",
    dotClass: "bg-amber-500",
  },
  missing: {
    label: "Not updated",
    chipClass: "border-rose-300 bg-rose-50 text-rose-900",
    dotClass: "bg-rose-500",
  },
  upcoming: {
    label: "Upcoming",
    chipClass: "border-slate-200 bg-slate-50 text-slate-400",
    dotClass: "bg-slate-300",
  },
};

function formatDay(date: string): string {
  return format(parseISODateString(date), "dd MMM");
}

function StatTile({
  Icon,
  label,
  value,
  iconClass,
}: {
  Icon: typeof CalendarCheck;
  label: string;
  value: string | number;
  iconClass: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-slate-200/70 px-3 py-2.5">
      <Icon className={cn("size-5 shrink-0", iconClass)} />
      <div className="min-w-0">
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        <p className="truncate text-sm font-semibold text-slate-900">{value}</p>
      </div>
    </div>
  );
}

function DayChip({ day }: { day: KitSelfLogDay }) {
  const meta = STATUS_META[day.status];

  return (
    <div
      className={cn(
        "flex min-w-28 flex-col items-start gap-1 rounded-xl border px-3 py-2",
        meta.chipClass,
      )}
    >
      <span className="text-xs font-semibold uppercase tracking-wide opacity-70">
        Day {day.index}
      </span>
      <span className="text-sm font-semibold">{formatDay(day.date)}</span>
      <span className="text-[11px] font-medium opacity-80">{meta.label}</span>
    </div>
  );
}

function DayDetail({ day }: { day: KitSelfLogDay }) {
  const fields = day.entry ? filledKitSelfLogFields(day.entry) : [];

  return (
    <div className="rounded-lg border border-slate-200/70 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold text-slate-900">
          {format(parseISODateString(day.date), "dd MMM yyyy")}
        </span>
        <span
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium",
            STATUS_META[day.status].chipClass,
          )}
        >
          <span
            className={cn("size-1.5 rounded-full", STATUS_META[day.status].dotClass)}
          />
          {STATUS_META[day.status].label}
        </span>
      </div>
      {fields.length === 0 ? (
        <p className="mt-1.5 text-sm text-muted-foreground">
          {day.status === "skipped"
            ? "The customer skipped the meal on this day."
            : "The customer marked the day without filling any measurements."}
        </p>
      ) : (
        <dl className="mt-2 grid grid-cols-1 gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
          {fields.map((field) => (
            <div key={field.label} className="flex justify-between gap-2 text-sm">
              <dt className="text-muted-foreground">{field.label}</dt>
              <dd className="text-right font-medium text-slate-900">
                {field.value}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

/**
 * The KIT customer's daily self-log timeline for the governing tracker window.
 * Renders nothing but the props it is given: the tracker summary, one chip per
 * day (with days the customer never updated highlighted), and the recorded
 * values for every day that carries an entry.
 */
export function KitSelfLogTrackerPanel({
  receivedDate,
  trackerEndDate,
  totalSkippedDays,
  today,
  entries,
}: KitSelfLogTrackerPanelProps) {
  const days = buildKitSelfLogDays({
    receivedDate,
    trackerEndDate,
    today,
    entries,
  });
  const summary = summarizeKitSelfLogDays(days);
  const loggedDays = days.filter((day) => day.entry !== null);

  return (
    <Card className="border-slate-200/70">
      <CardHeader className="border-b bg-slate-50/60">
        <CardTitle className="flex items-center gap-2 text-base">
          <ClipboardList className="size-4 text-primary" />
          Customer Daily Logs
        </CardTitle>
        <CardDescription>
          What the customer recorded themselves, day by day. Read-only — days
          with no update are highlighted so they can be followed up.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 pt-5">
        {!receivedDate ? (
          <p className="rounded-lg border border-dashed border-input p-6 text-center text-sm text-muted-foreground">
            The customer has not confirmed their kit receipt yet, so daily
            logging has not started.
          </p>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <StatTile
                Icon={CalendarCheck}
                iconClass="text-emerald-500"
                label="Days logged"
                value={`${summary.takenCount} of ${summary.expectedCount}`}
              />
              <StatTile
                Icon={SkipForward}
                iconClass="text-amber-500"
                label="Meals skipped"
                value={summary.skippedCount}
              />
              <StatTile
                Icon={CalendarX2}
                iconClass="text-rose-500"
                label="Not updated"
                value={summary.missingCount}
              />
              <StatTile
                Icon={CalendarClock}
                iconClass="text-blue-500"
                label="Tracker ends"
                value={
                  trackerEndDate
                    ? format(parseISODateString(trackerEndDate), "dd MMM yyyy")
                    : "—"
                }
              />
            </div>

            {totalSkippedDays !== summary.skippedCount && (
              <p className="text-xs text-muted-foreground">
                The subscription records {totalSkippedDays} skipped day
                {totalSkippedDays === 1 ? "" : "s"} in total, including any
                outside the current tracker window.
              </p>
            )}

            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-3">
                <h3 className="text-sm font-semibold text-slate-900">
                  Daily updates
                </h3>
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  {(
                    ["taken", "skipped", "missing", "upcoming"] as const
                  ).map((status) => (
                    <span key={status} className="inline-flex items-center gap-1">
                      <span
                        className={cn(
                          "size-2 rounded-full",
                          STATUS_META[status].dotClass,
                        )}
                      />
                      {STATUS_META[status].label}
                    </span>
                  ))}
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                {days.map((day) => (
                  <DayChip key={day.date} day={day} />
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <h3 className="text-sm font-semibold text-slate-900">
                Recorded entries
              </h3>
              {loggedDays.length === 0 ? (
                <p className="rounded-lg border border-dashed border-input p-6 text-center text-sm text-muted-foreground">
                  The customer has not logged any day yet.
                </p>
              ) : (
                <div className="space-y-2">
                  {loggedDays.map((day) => (
                    <DayDetail key={day.date} day={day} />
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
