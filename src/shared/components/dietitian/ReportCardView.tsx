"use client";

// src/shared/components/dietitian/ReportCardView.tsx
// Feature: dietitian-management — task 10.9.
//
// Portal-neutral Client Component (Recharts + the PDF export button both need
// interactivity, per design's "Component Design" table) rendering the
// per-customer Report_Card. The parent Server Component
// (`src/app/admin/(main)/customers/[id]/report-card/page.tsx` and its
// franchise counterpart) fetches the `ReportCardViewModel` via
// `getReportCard` (`reportCardActions.ts`) and passes it here as a prop — this
// component performs no data fetching of its own beyond the PDF export call.
//
// Sections mirror `DietitianReportTemplate.tsx`'s PDF layout so the on-screen
// report and the exported PDF agree on content, though the trend charts use
// Recharts here instead of hand-rolled react-pdf SVG:
// - Adherence summary (Req 19.4) as stat cards
// - Weight / BP / Fasting Sugar trend charts (Req 19.3)
// - Date-ordered parameter table (Req 19.2)
// - Reverse-chronological Closing_Comment history with author names (Req 19.5)
// - PDF export button, disabled when `hasHealthLogs === false` (Req 19.6, 19.8)
//
// PDF DOWNLOAD: `exportReportCardPdf` is a Server Action, so it cannot stream
// a `Buffer` the way the KIT report's Route Handler does — it returns a
// base64-encoded PDF (see `reportCardActions.ts`'s "PDF RETURN SHAPE" note).
// This component decodes that base64 string into a `Blob` client-side
// (mirroring `BulkMigrationClient.tsx`'s `downloadBase64File`) and triggers
// the download via a transient anchor element.
//
// Requirements: 19.2, 19.3, 19.4, 19.5, 19.6, 19.8

import { useTransition } from "react";
import { toast } from "sonner";
import { Download, Loader2 } from "lucide-react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { fieldByKey } from "@/lib/dietitian/fieldSets";
import type { ParameterValue } from "@/types/dietitian";
import type { ReportCardViewModel } from "@/services/DietitianReportService";
import { exportReportCardPdf } from "@/actions/dietitian-actions/reportCardActions";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/shared/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/shared/components/ui/table";

/** The result shape `exportReportCardPdf` (and any override) must return. */
type ExportReportCardPdfResult =
  | { success: true; data: { base64: string; filename: string } }
  | { success: false; error: string };

interface ReportCardViewProps {
  /** The Customer_Record's Report_Card view data (Req 19.2–19.5, 19.8). */
  report: ReportCardViewModel;
  /** The Customer_Record whose Report_Card is shown — passed to `exportAction`. */
  customerProfileId: string;
  /**
   * Overrides the PDF export call. Defaults to the Dietitian-scoped
   * `exportReportCardPdf` (self-gated via `checkDietitianScope`) — the admin
   * and franchise Report_Card pages never pass this. The Master dashboard's
   * activity report supplies its own master-scoped export action here, since
   * a master admin is not a Dietitian and `checkDietitianScope` would reject
   * them.
   */
  exportAction?: (customerProfileId: string) => Promise<ExportReportCardPdfResult>;
}

// ---------------------------------------------------------------------------
// Formatting helpers — mirror DietitianReportTemplate.tsx / HealthLogTimeline.tsx
// ---------------------------------------------------------------------------

/** Formats one recorded parameter value for display. */
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

/** Decode a base64 string into a `Blob` and trigger a browser download. */
function downloadBase64Pdf(base64: string, filename: string) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const blob = new Blob([bytes], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------------------
// Adherence summary (Req 19.4)
// ---------------------------------------------------------------------------

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-foreground/10 p-3">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 text-2xl font-semibold text-foreground">{value}</p>
    </div>
  );
}

function AdherenceSummarySection({
  adherence,
}: {
  adherence: ReportCardViewModel["adherence"];
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Adherence Summary</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <StatCard label="Dietitian Logs" value={adherence.dietitianLogCount} />
          <StatCard label="Pending Logs" value={adherence.pendingLogCount} />
          <StatCard label="Self Logs" value={adherence.selfLogCount} />
          <StatCard label="Skipped Self Logs" value={adherence.skippedSelfLogCount} />
          <StatCard label="Paused Days" value={adherence.pausedDaysCount} />
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Trend charts (Req 19.3) — Recharts LineChart, mirroring
// ReportEngineShell.tsx's ResponsiveContainer/CartesianGrid/Tooltip conventions
// ---------------------------------------------------------------------------

function EmptyTrendState() {
  return (
    <div className="flex h-[220px] items-center justify-center text-sm text-muted-foreground">
      No data recorded
    </div>
  );
}

function WeightTrendChart({
  points,
}: {
  points: ReportCardViewModel["trends"]["weight"];
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Weight (kg)</CardTitle>
      </CardHeader>
      <CardContent>
        {points.length === 0 ? (
          <EmptyTrendState />
        ) : (
          <div className="h-[220px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={points as unknown as Record<string, unknown>[]}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis
                  dataKey="date"
                  tickFormatter={formatDisplayDate}
                  tick={{ fontSize: 10, fill: "#64748b" }}
                  axisLine={{ stroke: "#e2e8f0" }}
                  tickLine={false}
                />
                <YAxis tick={{ fontSize: 10, fill: "#64748b" }} axisLine={false} tickLine={false} />
                <Tooltip
                  labelFormatter={(label) => formatDisplayDate(String(label))}
                  contentStyle={{ borderRadius: "8px", border: "1px solid #e2e8f0", fontSize: "12px" }}
                />
                <Line
                  type="monotone"
                  dataKey="value"
                  name="Weight"
                  stroke="#059669"
                  strokeWidth={2}
                  dot={{ r: 3 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function BPTrendChart({ points }: { points: ReportCardViewModel["trends"]["bp"] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Blood Pressure (mmHg)</CardTitle>
      </CardHeader>
      <CardContent>
        {points.length === 0 ? (
          <EmptyTrendState />
        ) : (
          <div className="h-[220px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={points as unknown as Record<string, unknown>[]}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis
                  dataKey="date"
                  tickFormatter={formatDisplayDate}
                  tick={{ fontSize: 10, fill: "#64748b" }}
                  axisLine={{ stroke: "#e2e8f0" }}
                  tickLine={false}
                />
                <YAxis tick={{ fontSize: 10, fill: "#64748b" }} axisLine={false} tickLine={false} />
                <Tooltip
                  labelFormatter={(label) => formatDisplayDate(String(label))}
                  contentStyle={{ borderRadius: "8px", border: "1px solid #e2e8f0", fontSize: "12px" }}
                />
                <Legend wrapperStyle={{ fontSize: "11px" }} />
                <Line
                  type="monotone"
                  dataKey="systolic"
                  name="Systolic"
                  stroke="#d97706"
                  strokeWidth={2}
                  dot={{ r: 3 }}
                />
                <Line
                  type="monotone"
                  dataKey="diastolic"
                  name="Diastolic"
                  stroke="#2563eb"
                  strokeWidth={2}
                  dot={{ r: 3 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function FastingSugarTrendChart({
  points,
}: {
  points: ReportCardViewModel["trends"]["fastingSugar"];
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Fasting Sugar (mg/dL)</CardTitle>
      </CardHeader>
      <CardContent>
        {points.length === 0 ? (
          <EmptyTrendState />
        ) : (
          <div className="h-[220px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={points as unknown as Record<string, unknown>[]}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis
                  dataKey="date"
                  tickFormatter={formatDisplayDate}
                  tick={{ fontSize: 10, fill: "#64748b" }}
                  axisLine={{ stroke: "#e2e8f0" }}
                  tickLine={false}
                />
                <YAxis tick={{ fontSize: 10, fill: "#64748b" }} axisLine={false} tickLine={false} />
                <Tooltip
                  labelFormatter={(label) => formatDisplayDate(String(label))}
                  contentStyle={{ borderRadius: "8px", border: "1px solid #e2e8f0", fontSize: "12px" }}
                />
                <Line
                  type="monotone"
                  dataKey="value"
                  name="Fasting Sugar"
                  stroke="#d97706"
                  strokeWidth={2}
                  dot={{ r: 3 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function TrendChartsSection({ trends }: { trends: ReportCardViewModel["trends"] }) {
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <WeightTrendChart points={trends.weight} />
      <BPTrendChart points={trends.bp} />
      <FastingSugarTrendChart points={trends.fastingSugar} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Date-ordered parameter table (Req 19.2)
// ---------------------------------------------------------------------------

function ParameterTableSection({
  parameterTable,
}: {
  parameterTable: ReportCardViewModel["parameterTable"];
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Health Log History</CardTitle>
      </CardHeader>
      <CardContent>
        {parameterTable.length === 0 ? (
          <p className="text-sm text-muted-foreground">No health logs recorded yet</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Author</TableHead>
                <TableHead>Parameters</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {parameterTable.map((row, i) => {
                const keys = Object.keys(row.parameters);
                const hasCustomParameters = row.customParameters.length > 0;
                return (
                  <TableRow key={`${row.logDate}-${i}`}>
                    <TableCell className="align-top font-medium">
                      {formatDisplayDate(row.logDate)}
                    </TableCell>
                    <TableCell className="align-top">
                      {row.authorType === "DIETITIAN" ? (
                        <Badge
                          variant="outline"
                          className="border-emerald-200 bg-emerald-50 text-emerald-700"
                        >
                          {row.authorName ? `Dietitian · ${row.authorName}` : "Dietitian"}
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="border-blue-200 bg-blue-50 text-blue-700">
                          Self Log
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="align-top whitespace-normal">
                      {keys.length === 0 && !hasCustomParameters ? (
                        <span className="text-muted-foreground">No parameter values recorded</span>
                      ) : (
                        <dl className="grid grid-cols-1 gap-1 sm:grid-cols-2 lg:grid-cols-3">
                          {keys.map((key) => {
                            const field = fieldByKey(key);
                            const label = field?.label ?? key;
                            return (
                              <div key={key} className="flex justify-between gap-2">
                                <dt className="text-muted-foreground">{label}</dt>
                                <dd className="text-right font-medium">
                                  {formatParameterValue(row.parameters[key])}
                                </dd>
                              </div>
                            );
                          })}
                          {row.customParameters.map((cp, ci) => (
                            <div key={`custom-${ci}-${cp.label}`} className="flex justify-between gap-2">
                              <dt className="text-muted-foreground">{cp.label}</dt>
                              <dd className="text-right font-medium">
                                {cp.value}
                                {cp.unit ? ` ${cp.unit}` : ""}
                              </dd>
                            </div>
                          ))}
                        </dl>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Reverse-chronological Closing_Comment history with author names (Req 19.5)
// ---------------------------------------------------------------------------

function ClosingCommentHistorySection({
  closingComments,
}: {
  closingComments: ReportCardViewModel["closingComments"];
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Closing Comment History</CardTitle>
      </CardHeader>
      <CardContent>
        {closingComments.length === 0 ? (
          <p className="text-sm text-muted-foreground">No closing comments recorded</p>
        ) : (
          <div className="space-y-3">
            {closingComments.map((entry, i) => (
              <div key={`${entry.logDate}-${i}`} className="rounded-lg border border-foreground/10 p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold text-foreground">
                    {formatDisplayDate(entry.logDate)}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {entry.authorName ?? "Unknown"} · {formatSubmittedAt(entry.submittedAt)}
                  </span>
                </div>
                <p className="mt-1 text-sm text-foreground">{entry.comment}</p>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// PDF export button (Req 19.6, 19.8)
// ---------------------------------------------------------------------------

function PdfExportButton({
  customerProfileId,
  hasHealthLogs,
  exportAction,
}: {
  customerProfileId: string;
  hasHealthLogs: boolean;
  exportAction: (customerProfileId: string) => Promise<ExportReportCardPdfResult>;
}) {
  const [isPending, startTransition] = useTransition();

  const handleExport = () => {
    startTransition(async () => {
      const result = await exportAction(customerProfileId);
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      downloadBase64Pdf(result.data.base64, result.data.filename);
      toast.success("Report card PDF downloaded.");
    });
  };

  return (
    <Button
      onClick={handleExport}
      disabled={!hasHealthLogs || isPending}
      title={!hasHealthLogs ? "No health logs recorded yet" : undefined}
      className="gap-2"
    >
      {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
      Export PDF
    </Button>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

/**
 * Portal-neutral Report_Card view: the parameter table, the Weight/BP/Fasting
 * Sugar trend charts, the adherence summary, the Closing_Comment history and
 * the PDF export button. Used by both the admin and franchise report-card
 * pages, which pass in the `ReportCardViewModel` already fetched server-side
 * via `getReportCard`.
 */
export function ReportCardView({
  report,
  customerProfileId,
  exportAction = exportReportCardPdf,
}: ReportCardViewProps) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-foreground">{report.customerName}</h2>
          <p className="text-sm text-muted-foreground">
            {report.customerCode ?? "—"} · {report.category} ·{" "}
            {report.assignedDietitianName ?? "Unassigned"}
          </p>
        </div>
        <PdfExportButton
          customerProfileId={customerProfileId}
          hasHealthLogs={report.hasHealthLogs}
          exportAction={exportAction}
        />
      </div>

      <AdherenceSummarySection adherence={report.adherence} />
      <TrendChartsSection trends={report.trends} />
      <ParameterTableSection parameterTable={report.parameterTable} />
      <ClosingCommentHistorySection closingComments={report.closingComments} />
    </div>
  );
}
