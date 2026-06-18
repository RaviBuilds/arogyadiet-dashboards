"use client";

import { useMemo, useState } from "react";
import {
  endOfDay,
  isAfter,
  isBefore,
  parseISO,
  startOfDay,
  subDays,
} from "date-fns";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  CalendarRange,
  Factory,
  TrendingDown,
  TrendingUp,
  type LucideIcon,
} from "lucide-react";
import { type DateRange } from "react-day-picker";

import {
  type TransactionLedgerEntry,
  type TransactionType,
} from "@/lib/inventory/product-schema";
import { cn } from "@/lib/utils";
import { Button } from "@/shared/components/ui/button";
import { DatePickerWithRange } from "@/shared/components/ui/date-picker-with-range";

import LedgerDataTable from "./LedgerDataTable";

type SectionId = "incoming" | "outgoing" | "manufacturing";

interface SectionConfig {
  id: SectionId;
  label: string;
  shortLabel: string;
  hint: string;
  description: string;
  icon: LucideIcon;
  types: readonly TransactionType[];
  exportFileName: string;
  emptyLabel: string;
  /** Tailwind class fragments that drive the section accent. */
  accent: {
    /** Active button container. */
    activeButton: string;
    /** Icon chip (active state). */
    activeIcon: string;
    /** Idle icon chip. */
    idleIcon: string;
    /** Count pill (active state). */
    activeCount: string;
    /** Top border of the table card / underline. */
    ring: string;
  };
}

const SECTIONS: SectionConfig[] = [
  {
    id: "incoming",
    label: "Incoming Entries",
    shortLabel: "Incoming",
    hint: "Stock received",
    description: "Stock received into inventory from purchases and restocks.",
    icon: ArrowDownToLine,
    types: ["IN"],
    exportFileName: "audit_ledger_incoming.csv",
    emptyLabel: "No incoming stock entries recorded yet.",
    accent: {
      activeButton:
        "border-emerald-300 bg-emerald-50/80 ring-1 ring-emerald-200",
      activeIcon: "bg-emerald-100 text-emerald-700",
      idleIcon: "bg-emerald-50 text-emerald-600",
      activeCount: "bg-emerald-600 text-white",
      ring: "before:bg-emerald-500",
    },
  },
  {
    id: "outgoing",
    label: "Outgoing Entries",
    shortLabel: "Outgoing",
    hint: "Stock out & expired",
    description:
      "Stock consumed, dispatched, or written off as expired wastage.",
    icon: ArrowUpFromLine,
    types: ["OUT", "EXPIRED"],
    exportFileName: "audit_ledger_outgoing.csv",
    emptyLabel: "No outgoing or expired stock entries recorded yet.",
    accent: {
      activeButton: "border-rose-300 bg-rose-50/80 ring-1 ring-rose-200",
      activeIcon: "bg-rose-100 text-rose-700",
      idleIcon: "bg-rose-50 text-rose-600",
      activeCount: "bg-rose-600 text-white",
      ring: "before:bg-rose-500",
    },
  },
  {
    id: "manufacturing",
    label: "Manufacturing Entries",
    shortLabel: "Manufacturing",
    hint: "Sent & received",
    description:
      "Raw materials sent to production and finished goods received back.",
    icon: Factory,
    types: ["SENT_TO_MFG", "RECEIVED_FROM_MFG"],
    exportFileName: "audit_ledger_manufacturing.csv",
    emptyLabel: "No manufacturing movements recorded yet.",
    accent: {
      activeButton: "border-indigo-300 bg-indigo-50/80 ring-1 ring-indigo-200",
      activeIcon: "bg-indigo-100 text-indigo-700",
      idleIcon: "bg-indigo-50 text-indigo-600",
      activeCount: "bg-indigo-600 text-white",
      ring: "before:bg-indigo-500",
    },
  },
];

interface SectionStats {
  count: number;
  inflowValue: number;
  outflowValue: number;
  netValue: number;
}

/** Plain magnitude, e.g. ₹14,200 (no leading sign). */
function formatAmount(value: number): string {
  return `₹${Math.abs(value).toLocaleString("en-IN")}`;
}

/** Signed amount, e.g. +₹14,200 / -₹18,500. */
function formatSignedAmount(value: number): string {
  const sign = value > 0 ? "+" : value < 0 ? "-" : "";
  return `${sign}₹${Math.abs(value).toLocaleString("en-IN")}`;
}

interface MetricCard {
  key: string;
  label: string;
  value: string;
  caption: string;
  icon?: LucideIcon;
  iconClassName?: string;
  valueClassName?: string;
}

/**
 * Build the summary cards relevant to a section. Cards that would always be
 * ₹0 (e.g. "value out" for incoming-only stock) are intentionally omitted.
 */
function buildSectionMetrics(
  sectionId: SectionId,
  stats: SectionStats,
): MetricCard[] {
  if (sectionId === "incoming") {
    // Incoming is only positive stock value — no "value out" to show.
    return [
      {
        key: "value-in",
        label: "Total Stock Value In",
        value: formatSignedAmount(stats.inflowValue),
        caption: "Value of stock added to inventory",
        icon: TrendingUp,
        iconClassName: "text-emerald-600",
        valueClassName: "text-emerald-700",
      },
    ];
  }

  if (sectionId === "outgoing") {
    // Outgoing is only negative stock value — no "value in" to show.
    return [
      {
        key: "value-out",
        label: "Total Stock Value Out",
        value: formatSignedAmount(stats.outflowValue),
        caption: "Value of stock consumed, dispatched, or expired",
        icon: TrendingDown,
        iconClassName: "text-rose-600",
        valueClassName: "text-rose-700",
      },
    ];
  }

  // Manufacturing is a value conversion: raw materials (SENT_TO_MFG, stored as
  // negative) are the input; finished goods (RECEIVED_FROM_MFG, positive) are
  // the output. Both are shown as plain positive amounts. The variance between
  // them is the meaningful profit/loss signal — that's the only coloured card.
  const rawInput = Math.abs(stats.outflowValue);
  const finishedOutput = stats.inflowValue;
  const valueAdded = finishedOutput - rawInput;
  const isProfit = valueAdded >= 0;

  return [
    {
      key: "raw-input",
      label: "Raw Material Input",
      value: formatAmount(rawInput),
      caption: "Value of raw materials sent to production",
      icon: ArrowUpFromLine,
      iconClassName: "text-amber-600",
      valueClassName: "text-slate-900",
    },
    {
      key: "finished-output",
      label: "Finished Goods Output",
      value: formatAmount(finishedOutput),
      caption: "Value of finished goods received from production",
      icon: ArrowDownToLine,
      iconClassName: "text-indigo-600",
      valueClassName: "text-slate-900",
    },
    {
      key: "value-added",
      label: isProfit ? "Net Value Added" : "Net Value Variance",
      value: formatSignedAmount(valueAdded),
      caption: isProfit
        ? "Output value exceeds raw material cost"
        : "Output value is below raw material cost",
      icon: isProfit ? TrendingUp : TrendingDown,
      iconClassName: isProfit ? "text-emerald-600" : "text-rose-600",
      valueClassName: isProfit ? "text-emerald-700" : "text-rose-700",
    },
  ];
}

const DEFAULT_RANGE_DAYS = 10;

/** Inclusive range covering the most recent `days` days, ending today. */
function lastNDays(days: number): DateRange {
  return {
    from: startOfDay(subDays(new Date(), days - 1)),
    to: endOfDay(new Date()),
  };
}

const RANGE_PRESETS = [
  { label: "Last 10 days", days: 10 },
  { label: "Last 30 days", days: 30 },
  { label: "Last 90 days", days: 90 },
] as const;

interface LedgerWorkspaceProps {
  data: TransactionLedgerEntry[];
}

export default function LedgerWorkspace({ data }: LedgerWorkspaceProps) {
  const [activeId, setActiveId] = useState<SectionId>("incoming");
  const [dateRange, setDateRange] = useState<DateRange | undefined>(() =>
    lastNDays(DEFAULT_RANGE_DAYS),
  );

  // Apply the page-level date filter before anything else, so the section
  // counts, summary metrics and table all reflect the same window.
  const dateFilteredData = useMemo(() => {
    if (!dateRange?.from) return data;
    return data.filter((entry) => {
      const entryDate = parseISO(entry.timestamp);
      if (isBefore(entryDate, startOfDay(dateRange.from!))) return false;
      if (dateRange.to && isAfter(entryDate, endOfDay(dateRange.to))) {
        return false;
      }
      return true;
    });
  }, [data, dateRange]);

  const activePresetDays = useMemo(() => {
    if (!dateRange?.from || !dateRange.to) return null;
    const matchesToday =
      endOfDay(dateRange.to).getTime() === endOfDay(new Date()).getTime();
    if (!matchesToday) return null;
    const preset = RANGE_PRESETS.find(
      (option) =>
        startOfDay(subDays(new Date(), option.days - 1)).getTime() ===
        startOfDay(dateRange.from!).getTime(),
    );
    return preset?.days ?? null;
  }, [dateRange]);

  // Bucket every (date-filtered) entry into its section, then derive stats.
  const { sectionData, sectionStats } = useMemo(() => {
    const dataMap = new Map<SectionId, TransactionLedgerEntry[]>();
    const statsMap = new Map<SectionId, SectionStats>();

    for (const section of SECTIONS) {
      dataMap.set(section.id, []);
      statsMap.set(section.id, {
        count: 0,
        inflowValue: 0,
        outflowValue: 0,
        netValue: 0,
      });
    }

    for (const entry of dateFilteredData) {
      const section = SECTIONS.find((candidate) =>
        candidate.types.includes(entry.transactionType),
      );
      if (!section) continue;

      dataMap.get(section.id)!.push(entry);

      const stats = statsMap.get(section.id)!;
      stats.count += 1;
      stats.netValue += entry.financialValueChanged;
      if (entry.financialValueChanged > 0) {
        stats.inflowValue += entry.financialValueChanged;
      } else if (entry.financialValueChanged < 0) {
        stats.outflowValue += entry.financialValueChanged;
      }
    }

    return { sectionData: dataMap, sectionStats: statsMap };
  }, [dateFilteredData]);

  const activeSection = SECTIONS.find((section) => section.id === activeId)!;
  const activeData = sectionData.get(activeId) ?? [];
  const activeStats = sectionStats.get(activeId)!;

  return (
    <div className="space-y-6">
      {/* Page-level date filter — drives section counts, metrics and table */}
      <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-600">
            <CalendarRange className="size-5" />
          </span>
          <div>
            <p className="text-sm font-semibold text-slate-900">
              Filter by date
            </p>
            <p className="text-xs text-slate-500">
              {dateFilteredData.length} of {data.length} entries in range
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {RANGE_PRESETS.map((preset) => (
            <Button
              key={preset.days}
              type="button"
              size="sm"
              variant={activePresetDays === preset.days ? "default" : "outline"}
              onClick={() => setDateRange(lastNDays(preset.days))}
            >
              {preset.label}
            </Button>
          ))}
          <Button
            type="button"
            size="sm"
            variant={!dateRange?.from ? "default" : "outline"}
            onClick={() => setDateRange(undefined)}
          >
            All time
          </Button>
          <DatePickerWithRange date={dateRange} onDateChange={setDateRange} />
        </div>
      </div>

      {/* Section switcher */}
      <div
        role="tablist"
        aria-label="Audit ledger sections"
        className="grid grid-cols-1 gap-3 sm:grid-cols-3"
      >
        {SECTIONS.map((section) => {
          const isActive = section.id === activeId;
          const stats = sectionStats.get(section.id)!;
          const Icon = section.icon;

          return (
            <button
              key={section.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => setActiveId(section.id)}
              className={cn(
                "group flex items-center gap-3 rounded-xl border bg-white p-4 text-left transition-all",
                "hover:border-slate-300 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2",
                isActive
                  ? section.accent.activeButton
                  : "border-slate-200 shadow-sm",
              )}
            >
              <span
                className={cn(
                  "flex size-11 shrink-0 items-center justify-center rounded-lg transition-colors",
                  isActive ? section.accent.activeIcon : section.accent.idleIcon,
                )}
              >
                <Icon className="size-5" />
              </span>

              <span className="min-w-0 flex-1">
                <span className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-semibold text-slate-900">
                    {section.label}
                  </span>
                  <span
                    className={cn(
                      "inline-flex min-w-6 items-center justify-center rounded-full px-2 py-0.5 text-xs font-semibold transition-colors",
                      isActive
                        ? section.accent.activeCount
                        : "bg-slate-100 text-slate-600",
                    )}
                  >
                    {stats.count}
                  </span>
                </span>
                <span className="mt-0.5 block truncate text-xs text-slate-500">
                  {section.hint}
                </span>
              </span>
            </button>
          );
        })}
      </div>

      {/* Active-section summary metrics (only the cards relevant to the
          section are shown — no always-zero cards). */}
      {(() => {
        const metrics = buildSectionMetrics(activeId, activeStats);
        const cardCount = metrics.length + 1; // + entries card
        const gridCols =
          cardCount >= 4
            ? "sm:grid-cols-2 lg:grid-cols-4"
            : cardCount === 3
              ? "sm:grid-cols-3"
              : "sm:grid-cols-2";

        return (
          <div className={cn("grid grid-cols-1 gap-3", gridCols)}>
            <SummaryCard
              label="Entries in this view"
              value={activeStats.count.toLocaleString("en-IN")}
              caption={activeSection.description}
              accentRing={activeSection.accent.ring}
            />
            {metrics.map((metric) => (
              <SummaryCard
                key={metric.key}
                label={metric.label}
                value={metric.value}
                caption={metric.caption}
                icon={metric.icon}
                iconClassName={metric.iconClassName}
                valueClassName={metric.valueClassName}
                accentRing={activeSection.accent.ring}
              />
            ))}
          </div>
        );
      })()}

      {/* Section-scoped data table. The key remounts the table per section so
          search, sort, type filters and pagination reset cleanly. */}
      <LedgerDataTable
        key={activeId}
        data={activeData}
        availableTypes={activeSection.types}
        title={`${activeSection.label} · Transaction History`}
        description={activeSection.description}
        emptyLabel={activeSection.emptyLabel}
        exportFileName={activeSection.exportFileName}
        showDatePicker={false}
      />
    </div>
  );
}

interface SummaryCardProps {
  label: string;
  value: string;
  caption: string;
  icon?: LucideIcon;
  iconClassName?: string;
  valueClassName?: string;
  accentRing: string;
}

function SummaryCard({
  label,
  value,
  caption,
  icon: Icon,
  iconClassName,
  valueClassName,
  accentRing,
}: SummaryCardProps) {
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-xl border border-slate-200 bg-white p-4 shadow-sm",
        "before:absolute before:inset-y-0 before:left-0 before:w-1 before:content-['']",
        accentRing,
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
          {label}
        </p>
        {Icon ? <Icon className={cn("size-4", iconClassName)} /> : null}
      </div>
      <p
        className={cn(
          "mt-2 text-2xl font-semibold tracking-tight text-slate-900",
          valueClassName,
        )}
      >
        {value}
      </p>
      <p className="mt-1 line-clamp-1 text-xs text-slate-500">{caption}</p>
    </div>
  );
}
