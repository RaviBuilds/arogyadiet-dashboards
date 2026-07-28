"use client";

import { useMemo, useState } from "react";
import { format, isValid } from "date-fns";
import type { DateRange } from "react-day-picker";
import {
  Card,
  CardContent,
} from "@/shared/components/ui/card";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/shared/components/ui/table";
import {
  CalendarCheck,
  CalendarClock,
  ChevronDown,
  ChevronUp,
  ClipboardList,
  SkipForward,
} from "lucide-react";
import * as XLSX from "xlsx";

import { DataTableCard } from "@/shared/components/admin/core/DataTableCard";
import { SectionHeader } from "@/shared/components/admin/core/SectionHeader";
import { ExportButton } from "@/shared/components/admin/core/ActionButtons";
import { DatePickerWithRange } from "@/shared/components/ui/date-picker-with-range";
import { parseISODateString } from "@/lib/dates/ist";
import type { AdminKitDailyLog } from "@/types/kitLifecycle";

export interface AdminKitTrackerViewProps {
  /** Identifies the customer in every exported workbook. */
  customerName: string;
  kitReceivedDate: string | null;
  kitTrackerEndDate: string | null;
  kitTotalSkippedDays: number;
  kitDurationDays: number;
  dailyLogs: AdminKitDailyLog[];
}

// ---------------------------------------------------------------------------
// Field definitions — one source of truth for the detail rows and the export,
// mirroring the customer's day-log dialog (Hydration + Food Intake sections)
// so admin sees exactly what the customer submitted.
// ---------------------------------------------------------------------------

type DetailField = {
  label: string;
  /** Rendered value, or null when the customer left the field empty. */
  value: (log: AdminKitDailyLog) => string | number | null;
};

const DETAIL_FIELDS: DetailField[] = [
  {
    label: "Water (L)",
    value: (log) => log.water_intake_liters ?? null,
  },
  { label: "Buttermilk", value: (log) => log.buttermilk_intake ?? null },
  { label: "Fat Consumption", value: (log) => log.fat_consumption ?? null },
  { label: "Main Dish", value: (log) => log.main_dish ?? null },
  { label: "Protein Curry", value: (log) => log.protein_curry ?? null },
  { label: "Veg Curry", value: (log) => log.veg_curry ?? null },
  { label: "Soup & Qty", value: (log) => log.soup_name_qty ?? null },
  { label: "No. of Eggs", value: (log) => log.eggs_count ?? null },
  { label: "Salads Qty", value: (log) => log.salads_qty ?? null },
];

/** Detail fields the customer actually filled in for this day. */
function filledDetails(log: AdminKitDailyLog) {
  return DETAIL_FIELDS.map((field) => ({
    label: field.label,
    value: field.value(log),
  })).filter(
    (entry) =>
      entry.value !== null &&
      entry.value !== undefined &&
      String(entry.value).trim() !== "",
  );
}

/**
 * `log_date` is a Postgres `date`, delivered as "yyyy-MM-dd". `new Date()` would
 * read that as UTC midnight and shift the calendar day for viewers west of
 * Greenwich, so a date-only string is parsed as a local calendar date instead.
 */
function parseLogDate(value: string): Date {
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? parseISODateString(value)
    : new Date(value);
}

function formatLogDate(value: string): string {
  const date = parseLogDate(value);
  return isValid(date) ? format(date, "dd MMM yyyy") : value;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function AdminKitTrackerView({
  customerName,
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

  const formattedReceivedDate = isValid(parseLogDate(kitReceivedDate))
    ? format(parseLogDate(kitReceivedDate), "PPP")
    : "N/A";

  const formattedEndDate =
    kitTrackerEndDate && isValid(parseLogDate(kitTrackerEndDate))
      ? format(parseLogDate(kitTrackerEndDate), "PPP")
      : "N/A";

  // Sort logs chronologically ascending
  const sortedLogs = [...dailyLogs].sort(
    (a, b) => parseLogDate(a.log_date).getTime() - parseLogDate(b.log_date).getTime()
  );

  return <AdminKitTrackerViewInner
    customerName={customerName}
    formattedReceivedDate={formattedReceivedDate}
    formattedEndDate={formattedEndDate}
    kitTotalSkippedDays={kitTotalSkippedDays}
    kitDurationDays={kitDurationDays}
    sortedLogs={sortedLogs}
  />;
}

function AdminKitTrackerViewInner({
  customerName,
  formattedReceivedDate,
  formattedEndDate,
  kitTotalSkippedDays,
  sortedLogs,
}: {
  customerName: string;
  formattedReceivedDate: string;
  formattedEndDate: string;
  kitTotalSkippedDays: number;
  kitDurationDays: number;
  sortedLogs: AdminKitDailyLog[];
}) {
  const [dateRange, setDateRange] = useState<DateRange | undefined>(
    undefined
  );
  const [expandedDate, setExpandedDate] = useState<string | null>(null);

  const filteredLogs = useMemo(() => {
    if (!dateRange?.from) return sortedLogs;
    const from = dateRange.from;
    const to = dateRange.to ?? dateRange.from;
    return sortedLogs.filter((log) => {
      const logDate = parseLogDate(log.log_date);
      // Compare on calendar days: the picker hands back local midnight for
      // `from` and `to`, so the end day must include its whole span.
      return (
        logDate >= new Date(from.getFullYear(), from.getMonth(), from.getDate()) &&
        logDate <= new Date(to.getFullYear(), to.getMonth(), to.getDate())
      );
    });
  }, [sortedLogs, dateRange]);

  const handleExportExcel = () => {
    if (filteredLogs.length === 0) return;
    // Export carries every field the customer can submit, so the sheet is a
    // faithful copy of their entries rather than a summary.
    const exportData = filteredLogs.map((log) => ({
      "Customer Name": customerName,
      Date: formatLogDate(log.log_date),
      Status: log.status === "FOOD_TAKEN" ? "Food Taken" : "Food Skipped",
      "Weight (kg)": log.weight_kg ?? "",
      "Activity Minutes": log.physical_activity_minutes ?? "",
      "Activity Name": log.physical_activity_name ?? "",
      "Step Count": log.step_count ?? "",
      ...DETAIL_FIELDS.reduce<Record<string, string | number>>(
        (columns, field) => {
          columns[field.label] = field.value(log) ?? "";
          return columns;
        },
        {},
      ),
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
                  Weight
                </TableHead>
                <TableHead className="text-xs font-medium text-slate-500 uppercase tracking-wider">
                  Activity
                </TableHead>
                <TableHead className="text-xs font-medium text-slate-500 uppercase tracking-wider">
                  Steps
                </TableHead>
                <TableHead className="text-xs font-medium text-slate-500 uppercase tracking-wider">
                  Water
                </TableHead>
                <TableHead className="text-xs font-medium text-slate-500 uppercase tracking-wider">
                  Food & Intake
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredLogs.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={7}
                    className="text-center py-12 text-sm text-slate-500"
                  >
                    No log entries found in the selected date range.
                  </TableCell>
                </TableRow>
              ) : (
                filteredLogs.flatMap((log) => {
                  const details = filledDetails(log);
                  // Water gets its own column, so it is not repeated in the
                  // expandable detail grid.
                  const gridDetails = details.filter(
                    (entry) => entry.label !== "Water (L)",
                  );
                  const isOpen = expandedDate === log.log_date;

                  const activityDisplay =
                    log.physical_activity_minutes != null
                      ? `${log.physical_activity_minutes} min${log.physical_activity_name ? ` — ${log.physical_activity_name}` : ""}`
                      : log.physical_activity_name
                        ? log.physical_activity_name
                        : "—";

                  const rows = [
                    <TableRow
                      key={log.log_date}
                      className="hover:bg-slate-50 transition-colors duration-200"
                    >
                      <TableCell className="font-semibold text-slate-900 tracking-tight">
                        {formatLogDate(log.log_date)}
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
                        {log.weight_kg != null ? `${log.weight_kg} kg` : "—"}
                      </TableCell>
                      <TableCell className="text-sm text-slate-500">
                        {activityDisplay}
                      </TableCell>
                      <TableCell className="text-sm text-slate-500">
                        {log.step_count != null
                          ? log.step_count.toLocaleString("en-IN")
                          : "—"}
                      </TableCell>
                      <TableCell className="text-sm text-slate-500">
                        {log.water_intake_liters != null
                          ? `${log.water_intake_liters} L`
                          : "—"}
                      </TableCell>
                      <TableCell className="text-sm text-slate-500">
                        {gridDetails.length === 0 ? (
                          "—"
                        ) : (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 gap-1 px-2 text-xs text-primary hover:text-primary"
                            aria-expanded={isOpen}
                            onClick={() =>
                              setExpandedDate(isOpen ? null : log.log_date)
                            }
                          >
                            {isOpen ? "Hide" : "View"} {gridDetails.length}{" "}
                            {gridDetails.length === 1 ? "entry" : "entries"}
                            {isOpen ? (
                              <ChevronUp className="h-3 w-3" />
                            ) : (
                              <ChevronDown className="h-3 w-3" />
                            )}
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>,
                  ];

                  if (isOpen && gridDetails.length > 0) {
                    rows.push(
                      <TableRow
                        key={`${log.log_date}-details`}
                        className="bg-slate-50/60"
                      >
                        <TableCell colSpan={7} className="py-4">
                          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
                            {gridDetails.map((entry) => (
                              <div key={entry.label}>
                                <p className="text-[0.65rem] font-medium uppercase tracking-wider text-slate-500">
                                  {entry.label}
                                </p>
                                <p className="text-sm font-semibold text-slate-900">
                                  {entry.value}
                                </p>
                              </div>
                            ))}
                          </div>
                        </TableCell>
                      </TableRow>,
                    );
                  }

                  return rows;
                })
              )}
            </TableBody>
          </Table>
        </DataTableCard>
      )}
    </div>
  );
}
