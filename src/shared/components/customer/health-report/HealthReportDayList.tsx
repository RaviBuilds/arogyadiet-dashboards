"use client";

// src/shared/components/customer/health-report/HealthReportDayList.tsx
//
// The body of the customer Health Report: a vitals band that leads with an
// encouraging caption (the dashboard's `MomentumStrip` pattern) followed by one
// collapsible card per logged day, newest first.
//
// Colour carries meaning here, matching the dashboard's system: emerald for
// vitals and anything the customer did, amber for nutrition, sky for activity,
// violet for counts, muted slate for "not today". The coral `--primary` stays
// reserved for calls to action so a health page never reads as a warning.
//
// Display-only: it renders the `days` prop as given (chronological, oldest first,
// per `getCustomerHealthReportAction`) and fetches nothing itself.

import { useMemo, useState } from "react";
import {
  Activity,
  CalendarCheck,
  Check,
  ChevronDown,
  Droplet,
  Footprints,
  HeartPulse,
  Minus,
  NotebookPen,
  Salad,
  Scale,
  Sparkles,
  TrendingDown,
  TrendingUp,
  type LucideIcon,
} from "lucide-react";

import type { HealthReportDay } from "@/actions/customerHealthReportActions";
import type { ParameterValue } from "@/types/dietitian";
import { cn } from "@/lib/utils";
import { Sparkline } from "./Sparkline";
import {
  formatDisplayDate,
  formatSubmittedAt,
  formatValue,
  formatWeekday,
  type GroupTone,
  initialOf,
  labelFor,
  NARRATIVE_KEYS,
  numericValue,
  PARAMETER_GROUPS,
  partitionKeys,
  splitValue,
  ungroupedKeys,
} from "./healthReportDisplay";

interface HealthReportDayListProps {
  /** Chronological, oldest first. */
  days: readonly HealthReportDay[];
  /** Assigned dietitian, shown against each closing note. */
  dietitianName: string | null;
  /** Nights in the stay, for the "N of M days" coverage chip. */
  totalNights: number;
  /** `false` for a completed stay — changes the trailing copy. */
  isActive: boolean;
}

/** The readings promoted to the collapsed card header, in order of preference. */
const HEADLINE_KEYS = ["weight", "bp", "fasting_sugar", "step_count", "sleep"] as const;

const GROUP_ICONS: Record<string, LucideIcon> = {
  vitals: HeartPulse,
  nutrition: Salad,
  activity: Footprints,
};

const TONE_CHIP: Record<GroupTone | "violet", string> = {
  emerald: "bg-emerald-100/80 text-emerald-700",
  amber: "bg-amber-100/80 text-amber-700",
  sky: "bg-sky-100/80 text-sky-700",
  slate: "bg-slate-100 text-slate-600",
  violet: "bg-violet-100/80 text-violet-700",
};

const TONE_DOT: Record<string, string> = {
  weight: "bg-emerald-500",
  bp: "bg-sky-500",
  fasting_sugar: "bg-amber-500",
  step_count: "bg-sky-500",
  sleep: "bg-violet-500",
};

// ---------------------------------------------------------------------------
// Vitals band
// ---------------------------------------------------------------------------

/** The most recent recorded reading for a key, scanning newest to oldest. */
function latestReading(
  days: readonly HealthReportDay[],
  key: string,
): { value: ParameterValue; logDate: string } | null {
  for (let i = days.length - 1; i >= 0; i--) {
    const value = days[i].parameters[key];
    if (value !== undefined) return { value, logDate: days[i].logDate };
  }
  return null;
}

/** Every numeric reading for a key, chronological — the sparkline series. */
function series(days: readonly HealthReportDay[], key: string): number[] {
  return days
    .map((day) => numericValue(day.parameters[key]))
    .filter((value): value is number => value !== null);
}

function VitalCell({
  icon: Icon,
  tone,
  label,
  value,
  unit,
  caption,
  trend,
  spark,
}: {
  icon: LucideIcon;
  tone: GroupTone | "violet";
  label: string;
  value: string;
  unit?: string;
  caption?: string;
  trend?: { direction: "up" | "down" | "flat"; text: string };
  spark?: { values: number[]; tone: "emerald" | "amber" | "sky" | "violet" };
}) {
  const TrendIcon =
    trend?.direction === "down"
      ? TrendingDown
      : trend?.direction === "up"
        ? TrendingUp
        : Minus;

  return (
    <div className="bg-gradient-to-br from-emerald-50/40 via-white to-white px-4 py-4">
      <div className="flex items-center gap-2">
        <span
          className={cn(
            "flex h-7 w-7 shrink-0 items-center justify-center rounded-full",
            TONE_CHIP[tone],
          )}
        >
          <Icon className="h-3.5 w-3.5" aria-hidden="true" />
        </span>
        <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
          {label}
        </span>
      </div>

      <div className="mt-2.5 flex items-end justify-between gap-2">
        <p className="flex items-baseline gap-1">
          <span className="text-2xl font-semibold leading-none tracking-tight text-slate-900">
            {value}
          </span>
          {unit && <span className="text-xs font-medium text-slate-500">{unit}</span>}
        </p>
        {spark && spark.values.length > 1 && (
          <Sparkline values={spark.values} tone={spark.tone} width={72} height={26} />
        )}
      </div>

      {trend ? (
        <p
          className={cn(
            "mt-1.5 flex items-center gap-1 text-[11px] font-medium",
            trend.direction === "flat" ? "text-slate-500" : "text-emerald-700",
          )}
        >
          <TrendIcon className="h-3 w-3" aria-hidden="true" />
          {trend.text}
        </p>
      ) : caption ? (
        <p className="mt-1.5 text-[11px] text-slate-500">{caption}</p>
      ) : null}
    </div>
  );
}

function VitalsBand({
  days,
  totalNights,
  isActive,
}: {
  days: readonly HealthReportDay[];
  totalNights: number;
  isActive: boolean;
}) {
  const cells = useMemo(() => {
    const items: React.ReactNode[] = [];

    items.push(
      <VitalCell
        key="days"
        icon={CalendarCheck}
        tone="violet"
        label="Days recorded"
        value={`${days.length}`}
        unit={totalNights > 0 ? `of ${totalNights}` : undefined}
        caption={
          days.length > 0
            ? `Latest ${formatDisplayDate(days[days.length - 1].logDate)}`
            : undefined
        }
      />,
    );

    const weight = latestReading(days, "weight");
    if (weight) {
      const values = series(days, "weight");
      const latest = numericValue(weight.value);
      const first = values[0] ?? null;
      const delta =
        latest !== null && first !== null ? Number((latest - first).toFixed(1)) : null;
      const { main, unit } = splitValue(weight.value);
      items.push(
        <VitalCell
          key="weight"
          icon={Scale}
          tone="emerald"
          label="Latest weight"
          value={main}
          unit={unit}
          caption={formatDisplayDate(weight.logDate)}
          spark={{ values, tone: "emerald" }}
          trend={
            delta === null || values.length < 2
              ? undefined
              : {
                  direction: delta < 0 ? "down" : delta > 0 ? "up" : "flat",
                  text:
                    delta === 0
                      ? "Holding steady"
                      : `${delta > 0 ? "+" : ""}${delta} ${unit} since day 1`,
                }
          }
        />,
      );
    }

    const bp = latestReading(days, "bp");
    if (bp) {
      const { main, unit } = splitValue(bp.value);
      items.push(
        <VitalCell
          key="bp"
          icon={HeartPulse}
          tone="sky"
          label="Latest BP"
          value={main}
          unit={unit}
          caption={formatDisplayDate(bp.logDate)}
          spark={{ values: series(days, "bp"), tone: "sky" }}
        />,
      );
    }

    const sugar = latestReading(days, "fasting_sugar");
    if (sugar) {
      const { main, unit } = splitValue(sugar.value);
      items.push(
        <VitalCell
          key="sugar"
          icon={Droplet}
          tone="amber"
          label="Fasting sugar"
          value={main}
          unit={unit}
          caption={formatDisplayDate(sugar.logDate)}
          spark={{ values: series(days, "fasting_sugar"), tone: "amber" }}
        />,
      );
    }

    return items;
  }, [days, totalNights]);

  const caption =
    days.length === 0
      ? "Your readings will appear here as your wellness team records them."
      : isActive
        ? `Your wellness team has recorded ${days.length} of ${totalNights} days so far — every reading adds to the picture.`
        : `${days.length} ${days.length === 1 ? "day" : "days"} of readings from your completed stay.`;

  return (
    <div
      className="reveal-rise overflow-hidden rounded-3xl border border-emerald-900/10 bg-gradient-to-br from-emerald-50/80 via-white to-white shadow-sm"
      style={{ ["--reveal-delay" as string]: "300ms" }}
    >
      <div className="flex items-center gap-2 px-4 pb-3 pt-4">
        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" />
        <p className="text-sm font-medium leading-snug text-emerald-800">{caption}</p>
      </div>

      <div className="grid grid-cols-2 gap-px border-t border-emerald-900/10 bg-emerald-900/10 sm:grid-cols-4">
        {cells}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Day card internals
// ---------------------------------------------------------------------------

function MeasurementCell({
  paramKey,
  value,
}: {
  paramKey: string;
  value: ParameterValue;
}) {
  const { main, unit } = splitValue(value);
  return (
    <div className="rounded-xl border border-slate-200/70 bg-white px-3 py-2.5">
      <p className="truncate text-[10px] font-medium uppercase tracking-wide text-slate-500">
        {labelFor(paramKey)}
      </p>
      <p className="mt-1 text-base font-semibold leading-none text-slate-900">
        {main}
        {unit && (
          <span className="ml-1 text-[11px] font-medium text-slate-500">{unit}</span>
        )}
      </p>
    </div>
  );
}

function FlagChip({ paramKey, on }: { paramKey: string; on: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium",
        on
          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
          : "border-slate-200 bg-white text-slate-400",
      )}
    >
      {on ? (
        <Check className="h-3 w-3" aria-hidden="true" />
      ) : (
        <Minus className="h-3 w-3" aria-hidden="true" />
      )}
      {labelFor(paramKey)}
      <span className="sr-only">{on ? ": yes" : ": no"}</span>
    </span>
  );
}

function SectionHeading({
  icon: Icon,
  tone,
  title,
}: {
  icon: LucideIcon;
  tone: GroupTone;
  title: string;
}) {
  return (
    <div className="flex items-center gap-2.5">
      <span
        className={cn(
          "flex h-7 w-7 shrink-0 items-center justify-center rounded-full",
          TONE_CHIP[tone],
        )}
      >
        <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      </span>
      <h4 className="text-[11px] font-semibold uppercase tracking-wider text-slate-600">
        {title}
      </h4>
      <span className="h-px flex-1 bg-slate-200/80" aria-hidden="true" />
    </div>
  );
}

function GroupSection({
  title,
  icon,
  tone,
  keys,
  parameters,
}: {
  title: string;
  icon: LucideIcon;
  tone: GroupTone;
  keys: readonly string[];
  parameters: Record<string, ParameterValue>;
}) {
  const { measurements, flagsOn, flagsOff } = partitionKeys(keys, parameters);
  if (measurements.length === 0 && flagsOn.length === 0 && flagsOff.length === 0) {
    return null;
  }

  return (
    <section className="space-y-3">
      <SectionHeading icon={icon} tone={tone} title={title} />

      {measurements.length > 0 && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          {measurements.map((key) => (
            <MeasurementCell key={key} paramKey={key} value={parameters[key]} />
          ))}
        </div>
      )}

      {(flagsOn.length > 0 || flagsOff.length > 0) && (
        <div className="flex flex-wrap gap-1.5">
          {flagsOn.map((key) => (
            <FlagChip key={key} paramKey={key} on />
          ))}
          {flagsOff.map((key) => (
            <FlagChip key={key} paramKey={key} on={false} />
          ))}
        </div>
      )}
    </section>
  );
}

function HeadlineChips({ day }: { day: HealthReportDay }) {
  const recorded = HEADLINE_KEYS.filter(
    (key) => day.parameters[key] !== undefined,
  ).slice(0, 3);

  if (recorded.length === 0) {
    const count = Object.keys(day.parameters).length + day.customParameters.length;
    return (
      <span className="text-xs text-slate-500">
        {count > 0
          ? `${count} ${count === 1 ? "reading" : "readings"} recorded`
          : "No readings recorded"}
      </span>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {recorded.map((key) => (
        <span
          key={key}
          className="inline-flex items-baseline gap-1.5 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs"
        >
          <span
            className={cn(
              "mb-px h-1.5 w-1.5 shrink-0 self-center rounded-full",
              TONE_DOT[key] ?? "bg-slate-400",
            )}
            aria-hidden="true"
          />
          <span className="text-slate-500">{labelFor(key)}</span>
          <span className="font-semibold text-slate-900">
            {formatValue(day.parameters[key])}
          </span>
        </span>
      ))}
    </div>
  );
}

function DayCard({
  day,
  dietitianName,
  isLatest,
  isOpen,
  onToggle,
}: {
  day: HealthReportDay;
  dietitianName: string | null;
  isLatest: boolean;
  isOpen: boolean;
  onToggle: () => void;
}) {
  const panelId = `health-day-${day.id}`;
  const extraKeys = ungroupedKeys(day.parameters);
  const narratives = NARRATIVE_KEYS.filter((key) => day.parameters[key] !== undefined);
  const readingCount = Object.keys(day.parameters).length + day.customParameters.length;

  return (
    <div
      className={cn(
        "group overflow-hidden rounded-2xl border bg-white shadow-sm transition-all duration-200",
        isOpen
          ? "border-emerald-200 shadow-md ring-1 ring-emerald-500/10"
          : "border-slate-200 hover:-translate-y-0.5 hover:border-emerald-200 hover:shadow-md",
      )}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={isOpen}
        aria-controls={panelId}
        className="flex w-full items-center gap-3 p-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-emerald-500/40 sm:gap-4 sm:p-5"
      >
        <div
          className={cn(
            "flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded-2xl border text-center transition-colors",
            isLatest
              ? "border-emerald-200 bg-emerald-50 text-emerald-700"
              : "border-slate-200 bg-slate-50 text-slate-600",
          )}
        >
          <span className="text-[10px] font-medium uppercase leading-none opacity-80">
            {formatWeekday(day.logDate)}
          </span>
          <span className="mt-0.5 text-base font-semibold leading-none">
            {day.logDate.slice(8, 10)}
          </span>
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-sm font-semibold text-slate-900">
              {formatDisplayDate(day.logDate)}
            </span>
            {day.dayNumber !== null && (
              <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700">
                Day {day.dayNumber}
              </span>
            )}
            {isLatest && (
              <span className="rounded-full bg-slate-900/5 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-600">
                Latest
              </span>
            )}
          </div>
          <div className="mt-1.5">
            <HeadlineChips day={day} />
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2.5">
          <span className="hidden text-[11px] font-medium text-slate-400 sm:block">
            {isOpen
              ? "Hide details"
              : `${readingCount} ${readingCount === 1 ? "reading" : "readings"}`}
          </span>
          <span
            className={cn(
              "flex h-8 w-8 items-center justify-center rounded-full transition-colors",
              isOpen
                ? "bg-emerald-100 text-emerald-700"
                : "bg-slate-100 text-slate-500 group-hover:bg-emerald-50 group-hover:text-emerald-700",
            )}
          >
            <ChevronDown
              className={cn("h-4 w-4 transition-transform duration-200", isOpen && "rotate-180")}
              aria-hidden="true"
            />
          </span>
        </div>
      </button>

      {isOpen && (
        <div
          id={panelId}
          className="space-y-5 border-t border-slate-100 bg-slate-50/60 p-4 sm:p-5"
        >
          {readingCount === 0 ? (
            <p className="text-sm text-slate-500">
              No measurements were recorded for this day.
            </p>
          ) : (
            <>
              {PARAMETER_GROUPS.map((group) => (
                <GroupSection
                  key={group.id}
                  title={group.title}
                  icon={GROUP_ICONS[group.id] ?? Activity}
                  tone={group.tone}
                  keys={group.keys}
                  parameters={day.parameters}
                />
              ))}

              {extraKeys.length > 0 && (
                <GroupSection
                  title="Other measurements"
                  icon={Sparkles}
                  tone="slate"
                  keys={extraKeys}
                  parameters={day.parameters}
                />
              )}

              {day.customParameters.length > 0 && (
                <section className="space-y-3">
                  <SectionHeading
                    icon={Sparkles}
                    tone="slate"
                    title="Additional readings"
                  />
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                    {day.customParameters.map((custom, index) => (
                      <div
                        key={`${custom.label}-${index}`}
                        className="rounded-xl border border-slate-200/70 bg-white px-3 py-2.5"
                      >
                        <p className="truncate text-[10px] font-medium uppercase tracking-wide text-slate-500">
                          {custom.label}
                        </p>
                        <p className="mt-1 text-base font-semibold leading-none text-slate-900">
                          {custom.value}
                          {custom.unit && (
                            <span className="ml-1 text-[11px] font-medium text-slate-500">
                              {custom.unit}
                            </span>
                          )}
                        </p>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {narratives.length > 0 && (
                <section className="space-y-3">
                  <SectionHeading icon={NotebookPen} tone="slate" title="Remarks" />
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {narratives.map((key) => (
                      <div
                        key={key}
                        className="rounded-xl border border-slate-200/70 bg-white px-3 py-2.5"
                      >
                        <p className="text-[10px] font-medium uppercase tracking-wide text-slate-500">
                          {labelFor(key)}
                        </p>
                        <p className="mt-1 whitespace-pre-line text-sm leading-relaxed text-slate-700">
                          {formatValue(day.parameters[key])}
                        </p>
                      </div>
                    ))}
                  </div>
                </section>
              )}
            </>
          )}

          {day.closingComment && (
            <div className="rounded-2xl border border-emerald-200/70 bg-emerald-50/60 p-4">
              <div className="flex gap-3">
                <span
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-sm font-semibold text-white"
                  aria-hidden="true"
                >
                  {initialOf(dietitianName)}
                </span>
                <div className="min-w-0">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-emerald-800">
                    Note from your dietitian
                  </p>
                  <p className="mt-1 whitespace-pre-line text-sm leading-relaxed text-slate-800">
                    {day.closingComment}
                  </p>
                  <p className="mt-2 text-[11px] text-slate-500">
                    {dietitianName ? `${dietitianName} · ` : ""}
                    {formatSubmittedAt(day.submittedAt)}
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------

export function HealthReportDayList({
  days,
  dietitianName,
  totalNights,
  isActive,
}: HealthReportDayListProps) {
  // Newest first — the reading a customer wants is the one just recorded.
  const ordered = useMemo(() => [...days].reverse(), [days]);
  const [openIds, setOpenIds] = useState<Set<string>>(
    () => new Set(ordered.length > 0 ? [ordered[0].id] : []),
  );

  const allOpen = openIds.size === ordered.length && ordered.length > 0;
  const pendingDays = Math.max(0, totalNights - ordered.length);

  function toggle(id: string) {
    setOpenIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="space-y-6">
      <VitalsBand days={days} totalNights={totalNights} isActive={isActive} />

      <div
        className="reveal-rise space-y-4"
        style={{ ["--reveal-delay" as string]: "450ms" }}
      >
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-semibold tracking-tight text-slate-900">
              Day-wise records
            </h2>
            <span className="shrink-0 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-700">
              {ordered.length} {ordered.length === 1 ? "day" : "days"}
            </span>
          </div>
          {ordered.length > 1 && (
            <button
              type="button"
              onClick={() =>
                setOpenIds(allOpen ? new Set() : new Set(ordered.map((day) => day.id)))
              }
              className="shrink-0 rounded-lg px-2 py-1 text-xs font-semibold text-emerald-700 transition-colors hover:bg-emerald-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40"
            >
              {allOpen ? "Collapse all" : "Expand all"}
            </button>
          )}
        </div>

        <div className="space-y-3">
          {ordered.map((day, index) => (
            <DayCard
              key={day.id}
              day={day}
              dietitianName={dietitianName}
              isLatest={index === 0}
              isOpen={openIds.has(day.id)}
              onToggle={() => toggle(day.id)}
            />
          ))}
        </div>

        {isActive && pendingDays > 0 && (
          <div className="flex items-center gap-2.5 rounded-2xl border border-dashed border-slate-200 bg-white/60 px-4 py-3.5">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500">
              <CalendarCheck className="h-3.5 w-3.5" aria-hidden="true" />
            </span>
            <p className="text-xs leading-relaxed text-slate-500">
              {pendingDays} more {pendingDays === 1 ? "day" : "days"} left in your stay.
              New readings appear here each time your wellness team records them.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
