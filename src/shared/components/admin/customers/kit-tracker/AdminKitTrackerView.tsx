"use client";

import { useMemo, useState } from "react";
import { format, isValid } from "date-fns";
import type { DateRange } from "react-day-picker";
import {
  Card,
  CardContent,
} from "@/shared/components/ui/card";
import { Badge } from "@/shared/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/shared/components/ui/table";
import { CalendarCheck, CalendarClock, SkipForward, ClipboardList } from "lucide-react";
import * as XLSX from "xlsx";

import { DataTableCard } from "@/shared/components/admin/core/DataTableCard";
import { SectionHeader } from "@/shared/components/admin/core/SectionHeader";
import { ExportButton } from "@/shared/components/admin/core/ActionButtons";
import { DatePickerWithRange } from "@/shared/components/ui/date-picker-with-range";

export interface AdminKitTrackerViewProps {
  kitReceivedDate: string | null;
  kitTrackerEndDate: string | null;
  kitTotalSkippedDays: number;
  kitDurationDays: number;
  dailyLogs: Array<{
    log_date: string;
    status: "FOOD_TAKEN" | "FOOD_SKIPPED";
    physical_activity_minutes: number | null;
    physical_activity_name: string | null;
    weight_kg: number | null;
  }>;
}

export function AdminKitTrackerView({
  kitReceivedDate,
  kitTrackerEndDate,
  kitTotalSkippedDays,
  kitDurationDays,
  dailyLogs,
}: AdminKitTrackerViewProps) {
  // State 1: No received date — customer has not confirmed receipt
  if (!kitReceivedDate) {
    return (
      <Card className="border-dashed shadow-none">
        <CardContent className="p-8 text-center text-muted-foreground">
          <CalendarCheck className="h-8 w-8 mx-auto mb-3 opacity-30" />
          <p className="text-sm font-medium">
            Customer has not yet confirmed package receipt.
          </p>
        </CardContent>
      </Card>
    );
  }

  const formattedReceivedDate =
    kitReceivedDate && isValid(new Date(kitReceivedDate))
      ? format(new Date(kitReceivedDate), "PPP")
      : "N/A";

  const formattedEndDate =
    kitTrackerEndDate && isValid(new Date(kitTrackerEndDate))
      ? format(new Date(kitTrackerEndDate), "PPP")
      : "N/A";

  // Sort logs chronologically ascending
  const sortedLogs = [...dailyLogs].sort(
    (a, b) => new Date(a.log_date).getTime() - new Date(b.log_date).getTime()
  );

  return <AdminKitTrackerViewInner
    formattedReceivedDate={formattedReceivedDate}
    formattedEndDate={formattedEndDate}
    kitTotalSkippedDays={kitTotalSkippedDays}
    sortedLogs={sortedLogs}
  />;
}

function AdminKitTrackerViewInner({
  formattedReceivedDate,
  formattedEndDate,
  kitTotalSkippedDays,
  sortedLogs,
}: {
  formattedReceivedDate: string;
  formattedEndDate: string;
  kitTotalSkippedDays: number;
  sortedLogs: AdminKitTrackerViewProps["dailyLogs"];
}) {
  const [dateRange, setDateRange] = useState<DateRange | undefined>(
    undefined
  );

  const filteredLogs = useMemo(() => {
    if (!dateRange?.from) return sortedLogs;
    const from = dateRange.from;
    const to = dateRange.to ?? dateRange.from;
    return sortedLogs.filter((log) => {
      const logDate = new Date(log.log_date);
      return logDate >= from && logDate <= to;
    });
  }, [sortedLogs, dateRange]);

  const handleExportExcel = () => {
    if (filteredLogs.length === 0) return;
    const exportData = filteredLogs.map((log) => ({
      Date: isValid(new Date(log.log_date))
        ? format(new Date(log.log_date), "dd MMM yyyy")
        : log.log_date,
      Status: log.status === "FOOD_TAKEN" ? "Food Taken" : "Food Skipped",
      "Activity Minutes": log.physical_activity_minutes ?? "",
      "Activity Name": log.physical_activity_name ?? "",
      "Weight (kg)": log.weight_kg ?? "",
    }));
    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "KIT Daily Logs");
    XLSX.writeFile(
      wb,
      `KitDailyLogs_${new Date().toISOString().split("T")[0]}.xlsx`
    );
  };

  return (
    <div className="space-y-4">
      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <CalendarCheck className="h-5 w-5 text-emerald-500 shrink-0" />
            <div>
              <p className="text-xs font-medium text-muted-foreground">
                Received Date
              </p>
              <p className="text-sm font-semibold">{formattedReceivedDate}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <CalendarClock className="h-5 w-5 text-blue-500 shrink-0" />
            <div>
              <p className="text-xs font-medium text-muted-foreground">
                Tracker End Date
              </p>
              <p className="text-sm font-semibold">{formattedEndDate}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <SkipForward className="h-5 w-5 text-orange-500 shrink-0" />
            <div>
              <p className="text-xs font-medium text-muted-foreground">
                Total Skipped Days
              </p>
              <p className="text-sm font-semibold">{kitTotalSkippedDays}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* State 2: Received date present, no logs */}
      {sortedLogs.length === 0 && (
        <Card className="border-dashed shadow-none">
          <CardContent className="p-6 text-center text-muted-foreground">
            <p className="text-sm">No daily entries have been logged yet.</p>
          </CardContent>
        </Card>
      )}

      {/* State 3: Received date present with logs — chronological, filterable table */}
      {sortedLogs.length > 0 && (
        <DataTableCard
          header={<SectionHeader title="Daily Log Entries" icon={ClipboardList} />}
          controls={
            <DatePickerWithRange
              date={dateRange}
              onDateChange={setDateRange}
              className="w-full md:w-[280px]"
            />
          }
          actions={
            <ExportButton
              onClick={handleExportExcel}
              disabled={filteredLogs.length === 0}
            />
          }
        >
          <Table>
            <TableHeader>
              <TableRow className="bg-slate-50/50 border-b border-slate-200">
                <TableHead className="text-xs font-medium text-slate-500 uppercase tracking-wider">
                  Date
                </TableHead>
                <TableHead className="text-xs font-medium text-slate-500 uppercase tracking-wider">
                  Status
                </TableHead>
                <TableHead className="text-xs font-medium text-slate-500 uppercase tracking-wider">
                  Activity
                </TableHead>
                <TableHead className="text-xs font-medium text-slate-500 uppercase tracking-wider">
                  Weight
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredLogs.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={4}
                    className="text-center py-12 text-sm text-slate-500"
                  >
                    No log entries found in the selected date range.
                  </TableCell>
                </TableRow>
              ) : (
                filteredLogs.map((log) => {
                  const logDateFormatted = isValid(new Date(log.log_date))
                    ? format(new Date(log.log_date), "dd MMM yyyy")
                    : log.log_date;

                  const activityDisplay =
                    log.status === "FOOD_TAKEN" &&
                    log.physical_activity_minutes != null
                      ? `${log.physical_activity_minutes} min${log.physical_activity_name ? ` — ${log.physical_activity_name}` : ""}`
                      : "—";

                  const weightDisplay =
                    log.status === "FOOD_TAKEN" && log.weight_kg != null
                      ? `${log.weight_kg} kg`
                      : "—";

                  return (
                    <TableRow
                      key={log.log_date}
                      className="hover:bg-slate-50 transition-colors duration-200"
                    >
                      <TableCell className="font-semibold text-slate-900 tracking-tight">
                        {logDateFormatted}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={
                            log.status === "FOOD_TAKEN"
                              ? "border-emerald-500 text-emerald-600 bg-emerald-50"
                              : "border-orange-400 text-orange-600 bg-orange-50"
                          }
                        >
                          {log.status === "FOOD_TAKEN"
                            ? "Food Taken"
                            : "Food Skipped"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm text-slate-500">
                        {activityDisplay}
                      </TableCell>
                      <TableCell className="text-sm text-slate-500">
                        {weightDisplay}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </DataTableCard>
      )}
    </div>
  );
}
