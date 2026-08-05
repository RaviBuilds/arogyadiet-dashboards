"use client";

// src/shared/components/dietitian/PeriodReportView.tsx
// Feature: report-card-lifecycle — Phase 4 (final report).
//
// The final report for one subscription/stay period: its Closing_Comment, the
// per-period adherence figures, the dated parameter table and the
// Closing_Comment history, plus a PDF export.
//
// For a CLOSED report this IS the report — it replaces the slot-entry view as
// the primary thing on screen. The per-slot logs are not discarded: the caller
// renders them inside a collapsed `<details>` below, so the audit trail stays
// readable without competing with the finished report.
//
// For an ACTIVE report the same view renders as a live preview of what
// finalising would produce, which is what makes "Ready to finalise" checkable
// before committing.
//
// Purely presentational apart from the PDF download, which needs the base64 →
// Blob step to happen in the browser.

import { useState } from "react";
import { format } from "date-fns";
import { Download, FileText, Loader2, Lock } from "lucide-react";
import { toast } from "sonner";

import { parseISODateString } from "@/lib/dates/ist";
import { exportPeriodReportPdfAction } from "@/actions/dietitian-actions/reportCardLifecycleActions";
import type { PeriodReportViewModel } from "@/services/DietitianReportService";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
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

export interface PeriodReportViewProps {
  report: PeriodReportViewModel;
}

/** `14 Jul – 12 Aug 2026`, collapsing a shared year onto the end. */
function formatWindow(start: string, end: string): string {
  const from = parseISODateString(start);
  const to = parseISODateString(end);
  const sameYear = from.getFullYear() === to.getFullYear();
  return `${format(from, sameYear ? "d MMM" : "d MMM yyyy")} – ${format(to, "d MMM yyyy")}`;
}

/** Renders one sparse parameter map as `Weight 70 kg · BP 120/80`. */
function summariseParameters(
  parameters: PeriodReportViewModel["parameterTable"][number]["parameters"],
): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(parameters)) {
    if (!value) continue;
    const label = key.replace(/_/g, " ");
    if ("systolic" in value) {
      parts.push(`${label} ${value.systolic}/${value.diastolic} ${value.unit}`);
    } else if ("unit" in value && value.unit) {
      parts.push(`${label} ${value.value} ${value.unit}`);
    } else {
      parts.push(`${label} ${value.value}`);
    }
  }
  return parts.length > 0 ? parts.join(" · ") : "—";
}

export function PeriodReportView({ report }: PeriodReportViewProps) {
  const [downloading, setDownloading] = useState(false);

  const isFinal = report.status === "CLOSED";

  const handleDownload = async () => {
    setDownloading(true);
    const result = await exportPeriodReportPdfAction(report.reportCardId);
    setDownloading(false);

    if (!result.success) {
      toast.error(result.error);
      return;
    }

    // base64 → Blob must happen client-side; a Buffer cannot cross the boundary.
    const bytes = Uint8Array.from(atob(result.data.base64), (char) =>
      char.charCodeAt(0),
    );
    const url = URL.createObjectURL(
      new Blob([bytes], { type: "application/pdf" }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = result.data.filename;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Card className={isFinal ? "border-emerald-200" : undefined}>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <CardTitle className="flex items-center gap-2 text-base">
              <FileText className="h-4 w-4 text-primary" />
              {isFinal ? "Final report" : "Report preview"}
              <Badge
                variant="outline"
                className={
                  isFinal
                    ? "border-emerald-200 bg-emerald-50 text-[11px] font-semibold text-emerald-800"
                    : "border-amber-200 bg-amber-50 text-[11px] font-semibold text-amber-800"
                }
              >
                {isFinal ? (
                  <>
                    <Lock className="mr-1 h-3 w-3" />
                    Closed
                  </>
                ) : (
                  "Not finalised"
                )}
              </Badge>
            </CardTitle>
            <CardDescription>
              {report.subjectType === "STAY" ? "Stay" : "Subscription"} ·{" "}
              {formatWindow(report.windowStart, report.windowEnd)} ·{" "}
              {report.category}
              {report.finalisedAt &&
                ` · finalised ${format(new Date(report.finalisedAt), "d MMM yyyy")}`}
              {report.reopenCount > 0 && ` · reopened ${report.reopenCount}×`}
            </CardDescription>
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={handleDownload}
            disabled={downloading || !report.hasHealthLogs}
            title={
              report.hasHealthLogs
                ? undefined
                : "No health logs recorded in this period"
            }
          >
            {downloading ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Download className="mr-2 h-4 w-4" />
            )}
            Download PDF
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-5">
        {/* The report-level Closing_Comment is the headline of a finished
            report, so it leads rather than sitting at the bottom.
            
            Rendered OUTSIDE the hasHealthLogs branch on purpose: the summary is
            the Dietitian's own words about the period, not a reading taken
            during it. A period closed with no logs at all — which is exactly
            what a Retrospective_Report is — still has a summary worth showing,
            and burying it under "no health logs" would hide the only content
            such a report has. */}
        {report.reportClosingComment && (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50/60 p-4">
            <p className="mb-1 text-sm font-semibold text-emerald-900">
              Dietitian&apos;s closing summary
            </p>
            <p className="whitespace-pre-wrap text-sm text-emerald-900/80">
              {report.reportClosingComment}
            </p>
          </div>
        )}

        {!report.hasHealthLogs ? (
          <p className="rounded-lg border border-dashed border-input p-6 text-center text-sm text-muted-foreground">
            No health logs were recorded in this period.
          </p>
        ) : (
          <>
            {/* Adherence — every figure bounded to this period's window. */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
              {[
                { label: "Dietitian logs", value: report.adherence.dietitianLogCount },
                { label: "Pending", value: report.adherence.pendingLogCount },
                { label: "Self logs", value: report.adherence.selfLogCount },
                { label: "Skipped", value: report.adherence.skippedSelfLogCount },
                { label: "Paused days", value: report.adherence.pausedDaysCount },
              ].map((stat) => (
                <div
                  key={stat.label}
                  className="rounded-lg border border-input px-3 py-2"
                >
                  <p className="text-xs text-muted-foreground">{stat.label}</p>
                  <p className="text-lg font-semibold">{stat.value}</p>
                </div>
              ))}
            </div>

            {/* Dated readings for the period. */}
            <div className="overflow-hidden rounded-lg border border-input">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/40">
                    <TableHead className="text-xs uppercase tracking-wider">
                      Date
                    </TableHead>
                    <TableHead className="text-xs uppercase tracking-wider">
                      Readings
                    </TableHead>
                    <TableHead className="text-xs uppercase tracking-wider">
                      Author
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {report.parameterTable.map((row, index) => (
                    <TableRow key={`${row.logDate}-${index}`}>
                      <TableCell className="whitespace-nowrap text-sm">
                        {format(parseISODateString(row.logDate), "d MMM yyyy")}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {summariseParameters(row.parameters)}
                        {row.customParameters.length > 0 && (
                          <span className="block text-xs">
                            {row.customParameters
                              .map(
                                (param) =>
                                  `${param.label} ${param.value}${param.unit ? ` ${param.unit}` : ""}`,
                              )
                              .join(" · ")}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                        {row.authorName ??
                          (row.authorType === "CUSTOMER" ? "Customer" : "—")}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {/* Per-day Closing_Comments, newest first. Collapsed because the
                report-level summary above is the one that matters most. */}
            {report.closingComments.length > 0 && (
              <details className="rounded-lg border border-input">
                <summary className="cursor-pointer px-4 py-3 text-sm font-medium">
                  Daily notes ({report.closingComments.length})
                </summary>
                <div className="space-y-3 border-t border-input px-4 py-3">
                  {report.closingComments.map((entry, index) => (
                    <div key={`${entry.logDate}-${index}`} className="space-y-0.5">
                      <p className="text-xs text-muted-foreground">
                        {format(parseISODateString(entry.logDate), "d MMM yyyy")}
                        {entry.authorName ? ` · ${entry.authorName}` : ""}
                      </p>
                      <p className="whitespace-pre-wrap text-sm">{entry.comment}</p>
                    </div>
                  ))}
                </div>
              </details>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
