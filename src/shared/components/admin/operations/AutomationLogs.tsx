"use client";

import { useEffect, useMemo, useState } from "react";
import { FileClock } from "lucide-react";
import { toast } from "sonner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/shared/components/ui/table";
import { Badge } from "@/shared/components/ui/badge";
import { DataTableCard } from "../core/DataTableCard";
import { DateRangeFilter } from "../core/DateRangeFilter";
import { ExportButton } from "../core/ActionButtons";
import { SectionHeader } from "../core/SectionHeader";
import {
  getAutomationLogs,
  type AutomationLogRow,
} from "@/actions/admin-actions/operationsActions";
import {
  getISTDateString,
  getTomorrowISTDateString,
  parseISODateString,
} from "@/lib/dates/ist";

function formatTargetDate(dateStr: string) {
  if (!dateStr) return "N/A";

  const date = parseISODateString(dateStr);
  const day = date.toLocaleDateString("en-GB", { day: "2-digit" });
  const month = date.toLocaleDateString("en-GB", { month: "short" });
  const year = date.toLocaleDateString("en-GB", { year: "numeric" });

  return `${day} ${month}, ${year}`;
}

function formatLastRunAt(dateStr: string | null) {
  if (!dateStr) return "N/A";

  return new Date(dateStr).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    dateStyle: "medium",
    timeStyle: "short",
  });
}

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
  if (Array.isArray(value)) return String(value.length);
  if (typeof value === "object") return JSON.stringify(value);
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}

function formatStatsSummary(stats: unknown, separator = " | ") {
  const entries = Object.entries(normalizeStats(stats));

  if (entries.length === 0) return "No stats";

  return entries
    .map(([key, value]) => `${formatStatLabel(key)}: ${formatStatValue(value)}`)
    .join(separator);
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
    ...rows.map((row) =>
      headers.map((header) => escapeCsvValue(row[header])).join(","),
    ),
  ].join("\n");

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export default function AutomationLogs({
  initialLogs = [],
}: {
  initialLogs?: AutomationLogRow[];
}) {
  const [logs, setLogs] = useState<AutomationLogRow[]>(initialLogs);
  const [fromDate, setFromDate] = useState(() => getISTDateString(-5));
  const [toDate, setToDate] = useState(() => getTomorrowISTDateString());
  const [isLoading, setIsLoading] = useState(false);

  const sortedLogs = useMemo(() => logs, [logs]);

  useEffect(() => {
    let isCurrent = true;

    async function loadLatestLogs() {
      setIsLoading(true);

      try {
        const data = await getAutomationLogs(fromDate, toDate);
        if (isCurrent) setLogs(data);
      } catch {
        if (isCurrent) {
          toast.error("Failed to load automation logs.");
        }
      } finally {
        if (isCurrent) setIsLoading(false);
      }
    }

    void loadLatestLogs();

    return () => {
      isCurrent = false;
    };
  }, []);

  const handleLoadRange = async () => {
    if (!fromDate || !toDate) {
      toast.error("Please select both From and To dates.");
      return;
    }

    if (fromDate > toDate) {
      toast.error("From date must be on or before To date.");
      return;
    }

    setIsLoading(true);

    try {
      const data = await getAutomationLogs(fromDate, toDate);
      setLogs(data);
      toast.success("Automation logs refreshed.");
    } catch {
      toast.error("Failed to load automation logs.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleExportCsv = () => {
    const exportRows = sortedLogs.map((log) => ({
      "Target Date": formatTargetDate(log.target_date),
      "Automation Type": log.automation_type,
      "Run Count": log.run_count ?? 0,
      "Last Run At (IST)": formatLastRunAt(log.last_run_at),
      "Results / Stats": formatStatsSummary(log.latest_stats, "; "),
    }));

    downloadCsv(`Automation_Logs_${fromDate}_to_${toDate}.csv`, exportRows);
  };

  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
      <DataTableCard
        header={<SectionHeader title="Automation Logs" icon={FileClock} />}
        controls={
          <DateRangeFilter
            fromDate={fromDate}
            onFromChange={setFromDate}
            toDate={toDate}
            onToChange={setToDate}
            onLoad={handleLoadRange}
            isLoading={isLoading}
          />
        }
        actions={
          <ExportButton
            onClick={handleExportCsv}
            disabled={sortedLogs.length === 0}
          />
        }
        footer={
          <p className="text-sm text-muted-foreground">
            Total log rows:{" "}
            <span className="font-semibold text-foreground">
              {sortedLogs.length}
            </span>
          </p>
        }
      >
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/10">
              <TableHead>Target Date</TableHead>
              <TableHead>Automation Type</TableHead>
              <TableHead>Run Count</TableHead>
              <TableHead>Last Run At</TableHead>
              <TableHead>Results / Stats</TableHead>
            </TableRow>
          </TableHeader>

          <TableBody>
            {sortedLogs.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={5}
                  className="text-center py-12 text-muted-foreground"
                >
                  No automation logs found for the selected date range.
                </TableCell>
              </TableRow>
            ) : (
              sortedLogs.map((log, index) => {
                const stats = Object.entries(normalizeStats(log.latest_stats));

                return (
                  <TableRow
                    key={`${log.automation_type}-${log.target_date}-${log.last_run_at ?? index}`}
                    className="hover:bg-muted/30"
                  >
                    <TableCell className="font-medium">
                      {formatTargetDate(log.target_date)}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className="bg-primary/5 text-primary border-primary/20 font-mono"
                      >
                        {log.automation_type}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-semibold">
                      {log.run_count ?? 0}
                    </TableCell>
                    <TableCell>{formatLastRunAt(log.last_run_at)}</TableCell>
                    <TableCell>
                      {stats.length === 0 ? (
                        <span className="text-sm text-muted-foreground">
                          No stats
                        </span>
                      ) : (
                        <div className="flex flex-wrap gap-1.5">
                          {stats.map(([key, value]) => (
                            <Badge
                              key={key}
                              variant="secondary"
                              className="font-normal"
                            >
                              {formatStatLabel(key)}: {formatStatValue(value)}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </DataTableCard>
    </div>
  );
}
