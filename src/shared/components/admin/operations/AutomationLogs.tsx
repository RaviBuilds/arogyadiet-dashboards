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
} from "lucide-react";
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

// ─── Run Sub-Card (Cron or Manual) ───────────────────────────────────────────

function RunSourceBlock({
  sourceLabel,
  sourceIcon: SourceIcon,
  runCount,
  lastRunAt,
  stats,
  emptyMessage,
}: {
  sourceLabel: string;
  sourceIcon: typeof Bot;
  runCount: number;
  lastRunAt: string | null;
  stats: unknown;
  emptyMessage: string;
}) {
  const hasRun = runCount > 0 && lastRunAt;

  return (
    <div className="rounded-lg border border-border/60 bg-muted/20 p-3">
      <div className="mb-2 flex items-center justify-between">
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
          <p className="text-[11px] text-muted-foreground">{formatTimeIST(lastRunAt)} IST</p>
          <StatsPills stats={stats} />
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
          <p className="font-mono text-[10px] text-muted-foreground">{log.automation_type}</p>
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
          emptyMessage="Not triggered by the scheduler for this date."
        />
        <RunSourceBlock
          sourceLabel="Manual (Admin)"
          sourceIcon={UserCog}
          runCount={log.manual_run_count ?? 0}
          lastRunAt={log.last_manual_run_at}
          stats={log.latest_manual_stats}
          emptyMessage="Not manually re-run by an admin for this date."
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
    () => initialLogs.filter((log) => log.target_date === (initialDate || todayIST)),
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
    const exportRows = logs.map((log) => ({
      "Automation Type": log.automation_type,
      "Target Date": log.target_date,
      "Cron Run Count": log.run_count ?? 0,
      "Cron Last Run (IST)": formatTimeIST(log.last_run_at) ?? "N/A",
      "Cron Stats": JSON.stringify(normalizeStats(log.latest_stats)),
      "Manual Run Count": log.manual_run_count ?? 0,
      "Manual Last Run (IST)": formatTimeIST(log.last_manual_run_at) ?? "N/A",
      "Manual Stats": JSON.stringify(normalizeStats(log.latest_manual_stats)),
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
      ) : logs.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-16 text-center text-muted-foreground">
          <FileClock className="mb-3 h-10 w-10 opacity-40" />
          <p className="font-medium">No automation activity logged for this date.</p>
          <p className="mt-1 text-sm">Try navigating to a different day.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {logs.map((log) => (
            <AutomationCard key={`${log.automation_type}-${log.target_date}`} log={log} />
          ))}
        </div>
      )}
    </div>
  );
}
