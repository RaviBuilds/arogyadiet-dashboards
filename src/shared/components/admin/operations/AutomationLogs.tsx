"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  FileClock,
  ChevronLeft,
  ChevronRight,
  CalendarIcon,
  Clock,
  ShoppingCart,
  Network,
  UserCheck,
  PackageOpen,
  ImageOff,
  BedDouble,
  FileArchive,
  CircleSlash,
  Bot,
  UserCog,
  CheckCircle2,
  XCircle,
  Loader2,
  MinusCircle,
} from "lucide-react";
import type {
  AutomationSubTaskState,
} from "@/actions/admin-actions/operationsActions";
import { Button } from "@/shared/components/ui/button";
import { Badge } from "@/shared/components/ui/badge";
import { Card } from "@/shared/components/ui/card";
import { Popover, PopoverContent, PopoverTrigger } from "@/shared/components/ui/popover";
import { Calendar } from "@/shared/components/ui/calendar";
import { SectionHeader } from "../core/SectionHeader";
import { ExportButton } from "../core/ActionButtons";
import {
  getAutomationLogsForDay,
  getAutomationLogsDateBounds,
  type AutomationLogRow,
} from "@/actions/admin-actions/operationsActions";
import { getISTDateString, parseISODateString } from "@/lib/dates/ist";
import { cn } from "@/lib/utils";
import { format, addDays, isSameDay } from "date-fns";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeStats(stats: unknown): Record<string, unknown> {
  if (isRecord(stats)) return stats;
  if (typeof stats === "string") {
    try {
      const parsed = JSON.parse(stats);
      return isRecord(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }
  return {};
}

function formatStatLabel(key: string) {
  return key
    .replace(/_/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatStatValue(value: unknown) {
  if (value === null || value === undefined) return "N/A";
  if (Array.isArray(value)) {
    if (value.length === 0) return "0";
    if (value.length <= 5 && value.every((v) => typeof v === "string")) {
      return value.join(", ");
    }
    return String(value.length);
  }
  if (typeof value === "object") return JSON.stringify(value);
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}

function formatTimeIST(dateStr: string | null) {
  if (!dateStr) return null;
  return new Date(dateStr).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    dateStyle: "medium",
    timeStyle: "short",
  });
}

/** Formats a YYYY-MM-DD string as a short human date (e.g. "16 Jul"). */
function formatDateLabel(dateStr: string | null) {
  if (!dateStr) return "";
  const [y, m, d] = dateStr.split("-").map(Number);
  if (!y || !m || !d) return dateStr;
  return format(new Date(y, m - 1, d), "dd MMM");
}

function escapeCsvValue(value: unknown) {
  const str = String(value ?? "");
  return `"${str.replace(/"/g, '""')}"`;
}

function downloadCsv(filename: string, rows: Array<Record<string, unknown>>) {
  if (rows.length === 0) return;
  const headers = Object.keys(rows[0]);
  const csv = [
    headers.map(escapeCsvValue).join(","),
    ...rows.map((row) => headers.map((header) => escapeCsvValue(row[header])).join(",")),
  ].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

// ─── Automation Type Metadata (icon, label, accent color) ───────────────────

const AUTOMATION_META: Record<
  string,
  { label: string; icon: typeof Clock; accent: string; iconBg: string; iconColor: string }
> = {
  ORDER_GEN: {
    label: "5:15 PM Order Creation",
    icon: Clock,
    accent: "border-blue-200",
    iconBg: "bg-blue-50",
    iconColor: "text-blue-600",
  },
  PRODUCT_LINK: {
    label: "Product Linking",
    icon: ShoppingCart,
    accent: "border-amber-200",
    iconBg: "bg-amber-50",
    iconColor: "text-amber-600",
  },
  ROUTING: {
    label: "Routing & Batching",
    icon: Network,
    accent: "border-purple-200",
    iconBg: "bg-purple-50",
    iconColor: "text-purple-600",
  },
  SUB_ACTIVATE: {
    label: "Subscription Activation / Expiry",
    icon: UserCheck,
    accent: "border-green-200",
    iconBg: "bg-green-50",
    iconColor: "text-green-600",
  },
  KIT_EXPIRE: {
    label: "KIT Subscription Expiry",
    icon: PackageOpen,
    accent: "border-red-200",
    iconBg: "bg-red-50",
    iconColor: "text-red-600",
  },
  IMG_CLEANUP: {
    label: "Dispatch Image Cleanup",
    icon: ImageOff,
    accent: "border-slate-200",
    iconBg: "bg-slate-50",
    iconColor: "text-slate-600",
  },
  STAY_TRANSITION: {
    label: "Accommodation Stay Transition",
    icon: BedDouble,
    accent: "border-teal-200",
    iconBg: "bg-teal-50",
    iconColor: "text-teal-600",
  },
  PO_CLEANUP: {
    label: "Purchase Order Cleanup",
    icon: FileArchive,
    accent: "border-orange-200",
    iconBg: "bg-orange-50",
    iconColor: "text-orange-600",
  },
};

function getAutomationMeta(type: string) {
  return (
    AUTOMATION_META[type] ?? {
      label: type,
      icon: Clock,
      accent: "border-border",
      iconBg: "bg-muted",
      iconColor: "text-muted-foreground",
    }
  );
}

// Every automation we always want a card for, in daily-operational order.
// AUTO_OFF_DUTY (the 5-minute rider sweep) is intentionally excluded. If a
// given automation has no log row for the selected day, we still render its
// card as "not run" so admins can confirm at a glance whether it ran.
const DISPLAY_AUTOMATION_ORDER = [
  "SUB_ACTIVATE",
  "ORDER_GEN",
  "PRODUCT_LINK",
  "ROUTING",
  "KIT_EXPIRE",
  "STAY_TRANSITION",
  "IMG_CLEANUP",
  "PO_CLEANUP",
];

/** Synthesizes an empty "not run" row for an automation with no log that day. */
function makePlaceholderLog(type: string, runDate: string): AutomationLogRow {
  return {
    automation_type: type,
    target_date: runDate,
    run_date: runDate,
    run_count: 0,
    last_run_at: null,
    latest_stats: null,
    main_status: null,
    sub_tasks: null,
    manual_run_count: 0,
    last_manual_run_at: null,
    latest_manual_stats: null,
    manual_main_status: null,
    manual_sub_tasks: null,
  };
}

/**
 * Merges the fetched logs with the canonical automation list so every
 * automation shows a card. Real rows win; missing ones become "not run"
 * placeholders. Any fetched type not in the canonical list is appended.
 */
function buildDisplayLogs(logs: AutomationLogRow[], runDate: string): AutomationLogRow[] {
  const byType = new Map(logs.map((log) => [log.automation_type, log]));
  const ordered: AutomationLogRow[] = [];

  for (const type of DISPLAY_AUTOMATION_ORDER) {
    ordered.push(byType.get(type) ?? makePlaceholderLog(type, runDate));
    byType.delete(type);
  }
  // Append any extra types the query returned that aren't in the canonical list.
  for (const log of byType.values()) {
    if (log.automation_type !== "AUTO_OFF_DUTY") ordered.push(log);
  }
  return ordered;
}

// ─── Stats Pills ─────────────────────────────────────────────────────────────

function StatsPills({ stats }: { stats: unknown }) {
  const entries = Object.entries(normalizeStats(stats));

  if (entries.length === 0) {
    return <span className="text-xs text-muted-foreground">No stats recorded</span>;
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      {entries.map(([key, value]) => (
        <Badge key={key} variant="secondary" className="font-normal text-[11px]">
          {formatStatLabel(key)}: {formatStatValue(value)}
        </Badge>
      ))}
    </div>
  );
}

// ─── Main-task status + follow-up sub-tasks ──────────────────────────────────

const SUB_TASK_STYLE: Record<
  string,
  { icon: typeof CheckCircle2; className: string; label: string }
> = {
  success: { icon: CheckCircle2, className: "text-green-600 border-green-200 bg-green-50", label: "Done" },
  failed: { icon: XCircle, className: "text-red-600 border-red-200 bg-red-50", label: "Failed" },
  pending: { icon: Loader2, className: "text-amber-600 border-amber-200 bg-amber-50", label: "In progress" },
  skipped: { icon: MinusCircle, className: "text-slate-500 border-slate-200 bg-slate-50", label: "Skipped" },
};

function MainStatusBadge({ status }: { status: string | null }) {
  if (!status) return null;
  const failed = status === "failed";
  const running = status === "running" || status === "pending";
  const Icon = failed ? XCircle : running ? Loader2 : CheckCircle2;
  const cls = failed
    ? "text-red-600 border-red-200 bg-red-50"
    : running
      ? "text-amber-600 border-amber-200 bg-amber-50"
      : "text-green-600 border-green-200 bg-green-50";
  const label = failed ? "Main task failed" : running ? "Running" : "Main task OK";
  return (
    <Badge variant="outline" className={cn("h-5 gap-1 text-[10px] font-medium", cls)}>
      <Icon className={cn("h-3 w-3", running && "animate-spin")} />
      {label}
    </Badge>
  );
}

function SubTasksList({
  subTasks,
}: {
  subTasks: Record<string, AutomationSubTaskState> | null | undefined;
}) {
  const entries = Object.entries(subTasks ?? {});
  if (entries.length === 0) return null;

  return (
    <div className="mt-1 space-y-1 border-t border-border/40 pt-1.5">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/70">
        Follow-up pipeline
      </p>
      <div className="flex flex-wrap gap-1.5">
        {entries.map(([key, state]) => {
          const style = SUB_TASK_STYLE[state?.status] ?? SUB_TASK_STYLE.pending;
          const Icon = style.icon;
          const title = state?.error || state?.info || style.label;
          return (
            <Badge
              key={key}
              variant="outline"
              className={cn("h-5 gap-1 text-[10px] font-normal", style.className)}
              title={title}
            >
              <Icon className={cn("h-3 w-3", state?.status === "pending" && "animate-spin")} />
              {formatStatLabel(key)}
              {state?.info ? `: ${state.info}` : ""}
            </Badge>
          );
        })}
      </div>
    </div>
  );
}

// ─── Run Sub-Card (Cron or Manual) ───────────────────────────────────────────

function RunSourceBlock({
  sourceLabel,
  sourceIcon: SourceIcon,
  runCount,
  lastRunAt,
  stats,
  mainStatus,
  subTasks,
  emptyMessage,
}: {
  sourceLabel: string;
  sourceIcon: typeof Bot;
  runCount: number;
  lastRunAt: string | null;
  stats: unknown;
  mainStatus?: string | null;
  subTasks?: Record<string, AutomationSubTaskState> | null;
  emptyMessage: string;
}) {
  const hasRun = runCount > 0 && lastRunAt;

  return (
    <div className="rounded-lg border border-border/60 bg-muted/20 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <SourceIcon className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {sourceLabel}
          </span>
        </div>
        {hasRun && (
          <Badge variant="outline" className="h-5 text-[10px] font-medium">
            {runCount} run{runCount !== 1 ? "s" : ""}
          </Badge>
        )}
      </div>

      {hasRun ? (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[11px] text-muted-foreground">{formatTimeIST(lastRunAt)} IST</p>
            <MainStatusBadge status={mainStatus ?? null} />
          </div>
          <StatsPills stats={stats} />
          <SubTasksList subTasks={subTasks} />
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">{emptyMessage}</p>
      )}
    </div>
  );
}

// ─── Automation Card ─────────────────────────────────────────────────────────

function AutomationCard({ log }: { log: AutomationLogRow }) {
  const meta = getAutomationMeta(log.automation_type);
  const Icon = meta.icon;

  const cronRan = (log.run_count ?? 0) > 0;
  const manualRan = (log.manual_run_count ?? 0) > 0;

  return (
    <Card className={cn("overflow-hidden border shadow-sm transition-shadow hover:shadow-md", meta.accent)}>
      <div className="flex items-center gap-3 border-b border-border/50 bg-muted/10 px-4 py-3">
        <div className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-lg", meta.iconBg)}>
          <Icon className={cn("h-4.5 w-4.5", meta.iconColor)} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-foreground">{meta.label}</p>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className="font-mono text-[10px] text-muted-foreground">{log.automation_type}</span>
            {log.target_date && log.target_date !== log.run_date && (
              <span className="text-[10px] text-muted-foreground">
                for {formatDateLabel(log.target_date)}
              </span>
            )}
          </div>
        </div>
        {!cronRan && !manualRan && (
          <Badge variant="outline" className="gap-1 text-[10px] text-muted-foreground">
            <CircleSlash className="h-3 w-3" />
            No run
          </Badge>
        )}
      </div>

      <div className="grid grid-cols-1 gap-2.5 p-3 sm:grid-cols-2">
        <RunSourceBlock
          sourceLabel="Scheduled (Cron)"
          sourceIcon={Bot}
          runCount={log.run_count ?? 0}
          lastRunAt={log.last_run_at}
          stats={log.latest_stats}
          mainStatus={log.main_status}
          subTasks={log.sub_tasks}
          emptyMessage="Not triggered by the scheduler on this day."
        />
        <RunSourceBlock
          sourceLabel="Manual (Admin)"
          sourceIcon={UserCog}
          runCount={log.manual_run_count ?? 0}
          lastRunAt={log.last_manual_run_at}
          stats={log.latest_manual_stats}
          mainStatus={log.manual_main_status}
          subTasks={log.manual_sub_tasks}
          emptyMessage="Not manually re-run by an admin on this day."
        />
      </div>
    </Card>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────

export default function AutomationLogs({
  initialLogs = [],
  initialDate,
}: {
  initialLogs?: AutomationLogRow[];
  initialDate?: string;
}) {
  const todayIST = getISTDateString(0);
  const [selectedDate, setSelectedDate] = useState<string>(() => initialDate || todayIST);

  // Seed the first render from initialLogs (already fetched server-side) so
  // there's no loading flash when the tab first opens on today's date.
  const seededLogs = useMemo(
    () =>
      initialLogs.filter(
        (log) => (log.run_date ?? log.target_date) === (initialDate || todayIST),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const [logs, setLogs] = useState<AutomationLogRow[]>(seededLogs);
  const [isLoading, setIsLoading] = useState(false);
  const [isCalendarOpen, setIsCalendarOpen] = useState(false);
  const [dateBounds, setDateBounds] = useState<{ minDate: string | null; maxDate: string | null }>({
    minDate: null,
    maxDate: null,
  });
  const hasMountedRef = useRef(false);

  const loadDay = useCallback(async (date: string) => {
    setIsLoading(true);
    try {
      const data = await getAutomationLogsForDay(date);
      setLogs(data);
    } catch {
      toast.error("Failed to load automation logs for this date.");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    getAutomationLogsDateBounds().then(setDateBounds).catch(() => {});
  }, []);

  useEffect(() => {
    // Skip the very first run if we already seeded matching data for today.
    if (!hasMountedRef.current) {
      hasMountedRef.current = true;
      if (seededLogs.length > 0) return;
    }
    loadDay(selectedDate);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDate, loadDay]);

  const selectedDateObj = useMemo(() => parseISODateString(selectedDate), [selectedDate]);
  const today = useMemo(() => getISTDateString(0), []);

  // Always show a card for every automation, "not run" when there's no row.
  const displayLogs = useMemo(
    () => buildDisplayLogs(logs, selectedDate),
    [logs, selectedDate],
  );

  const canGoPrev = !dateBounds.minDate || selectedDate > dateBounds.minDate;
  const canGoNext = selectedDate < today;

  const goToPrevDay = () => {
    const prev = format(addDays(selectedDateObj, -1), "yyyy-MM-dd");
    setSelectedDate(prev);
  };

  const goToNextDay = () => {
    if (!canGoNext) return;
    const next = format(addDays(selectedDateObj, 1), "yyyy-MM-dd");
    setSelectedDate(next);
  };

  const handleExportCsv = () => {
    const exportRows = displayLogs.map((log) => ({
      "Automation Type": log.automation_type,
      "Run Date": log.run_date ?? "N/A",
      "Target Date": log.target_date,
      "Cron Run Count": log.run_count ?? 0,
      "Cron Main Status": log.main_status ?? "N/A",
      "Cron Last Run (IST)": formatTimeIST(log.last_run_at) ?? "N/A",
      "Cron Stats": JSON.stringify(normalizeStats(log.latest_stats)),
      "Cron Follow-ups": JSON.stringify(log.sub_tasks ?? {}),
      "Manual Run Count": log.manual_run_count ?? 0,
      "Manual Main Status": log.manual_main_status ?? "N/A",
      "Manual Last Run (IST)": formatTimeIST(log.last_manual_run_at) ?? "N/A",
      "Manual Stats": JSON.stringify(normalizeStats(log.latest_manual_stats)),
      "Manual Follow-ups": JSON.stringify(log.manual_sub_tasks ?? {}),
    }));
    downloadCsv(`Automation_Logs_${selectedDate}.csv`, exportRows);
  };

  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 duration-500 space-y-5">
      <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <SectionHeader title="Automation Logs" icon={FileClock} className="mb-0" />

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            className="h-9 w-9 shrink-0"
            onClick={goToPrevDay}
            disabled={!canGoPrev || isLoading}
            title="Previous day"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>

          <Popover open={isCalendarOpen} onOpenChange={setIsCalendarOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                className="h-9 min-w-[190px] justify-start gap-2 font-normal"
              >
                <CalendarIcon className="h-4 w-4 text-muted-foreground" />
                {format(selectedDateObj, "EEE, dd MMM yyyy")}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="center">
              <Calendar
                mode="single"
                selected={selectedDateObj}
                defaultMonth={selectedDateObj}
                onSelect={(date) => {
                  if (!date) return;
                  setSelectedDate(format(date, "yyyy-MM-dd"));
                  setIsCalendarOpen(false);
                }}
                disabled={(date) => format(date, "yyyy-MM-dd") > today}
              />
            </PopoverContent>
          </Popover>

          <Button
            variant="outline"
            size="icon"
            className="h-9 w-9 shrink-0"
            onClick={goToNextDay}
            disabled={!canGoNext || isLoading}
            title="Next day"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>

          {isSameDay(selectedDateObj, parseISODateString(today)) && (
            <Badge variant="secondary" className="ml-1 hidden text-[10px] sm:inline-flex">
              Today
            </Badge>
          )}

          <ExportButton onClick={handleExportCsv} disabled={logs.length === 0} />
        </div>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className="h-[220px] animate-pulse rounded-xl border border-border bg-muted/30"
            />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {displayLogs.map((log) => (
            <AutomationCard
              key={`${log.automation_type}-${log.run_date ?? log.target_date}`}
              log={log}
            />
          ))}
        </div>
      )}
    </div>
  );
}
