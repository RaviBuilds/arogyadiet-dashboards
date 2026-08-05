"use client";

// src/shared/components/dietitian/ReportCardHistorySection.tsx
// Feature: report-card-lifecycle — Phase 2 (read path).
//
// Stateful wrapper around `ReportCardHistoryPanel`: owns which report is open
// and fetches that report's Log_Slot schedule on demand.
//
// Phase 4 sets what leads for each report state:
//
//   CLOSED — the Final_Report (`PeriodReportView`) is the primary content, and
//     the Log_Slot strip collapses beneath it as an audit trail. The slots are
//     deliberately kept readable rather than replaced (Req 11.6); they just stop
//     competing with the finished report for attention.
//
//   ACTIVE — the slot strip leads, because the work is still slot entry, and the
//     same `PeriodReportView` is offered collapsed as a preview of what
//     finalising would produce (Req 11.7).
//
// The Reopen affordance is lifted OUT of the block that gets demoted. If it had
// stayed where Phase 3 put it, reopening a closed report would have required
// expanding the audit trail to find the button.
//
// The slot strip is rendered through the existing `LogSlotSelector` in disabled
// mode so a historical period looks identical to the live one, rather than
// introducing a second slot visual that could drift from it.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import {
  CheckCircle2,
  Loader2,
  Lock,
  MessageSquareQuote,
  RotateCcw,
} from "lucide-react";
import { toast } from "sonner";

import { parseISODateString } from "@/lib/dates/ist";
import {
  finaliseReportAction,
  getPeriodReportAction,
  getReportCardDetailAction,
  reopenReportAction,
  type ReportCardDetailView,
} from "@/actions/dietitian-actions/reportCardLifecycleActions";
import { REPORT_PREDATES_LOG_COLLECTION } from "@/lib/dietitian/messages";
import type { PeriodReportViewModel } from "@/services/DietitianReportService";
import { Button } from "@/shared/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/shared/components/ui/card";
import { Label } from "@/shared/components/ui/label";
import { Textarea } from "@/shared/components/ui/textarea";
import type { ReportCardHistoryEntry } from "@/types/dietitian";

import { LogSlotSelector } from "./LogSlotSelector";
import { PeriodReportView } from "./PeriodReportView";
import { ReportCardHistoryPanel } from "./ReportCardHistoryPanel";

/** Matches the `report_closing_comment` CHECK in the migration. */
const MAX_CLOSING_COMMENT = 4000;

export interface ReportCardHistorySectionProps {
  entries: ReportCardHistoryEntry[];
}

export function ReportCardHistorySection({
  entries,
}: ReportCardHistorySectionProps) {
  const router = useRouter();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ReportCardDetailView | null>(null);
  const [periodReport, setPeriodReport] =
    useState<PeriodReportViewModel | null>(null);
  const [loading, setLoading] = useState(false);
  const [closingComment, setClosingComment] = useState("");
  const [isPending, startTransition] = useTransition();

  const loadDetail = async (reportCardId: string) => {
    setLoading(true);
    // Fetched together: both are scoped to the same report and the period report
    // is needed for every state — as the Final_Report when CLOSED, as the
    // preview when ACTIVE — so a second round trip on expand would only add
    // latency to something already known to be wanted.
    const [detailResult, reportResult] = await Promise.all([
      getReportCardDetailAction(reportCardId),
      getPeriodReportAction(reportCardId),
    ]);
    setLoading(false);

    if (detailResult.success) {
      setDetail(detailResult.data);
      // Seed the form with any existing comment so a reopened report is amended
      // rather than retyped from scratch.
      setClosingComment(
        detailResult.data.reportCard.reportClosingComment ?? "",
      );
    } else {
      // Keep the row selected so the failure is visibly tied to it.
      toast.error(detailResult.error);
    }

    // A period-report failure is not fatal: the slots and the finalise controls
    // still work without it, so it degrades to a notice rather than a toast that
    // would compete with the detail error above.
    setPeriodReport(reportResult.success ? reportResult.data : null);
  };

  const handleSelect = async (reportCardId: string) => {
    // Selecting the open report collapses it, so the list can be returned to.
    if (reportCardId === selectedId) {
      setSelectedId(null);
      setDetail(null);
      setPeriodReport(null);
      setClosingComment("");
      return;
    }

    setSelectedId(reportCardId);
    setDetail(null);
    setPeriodReport(null);
    await loadDetail(reportCardId);
  };

  const handleFinalise = () => {
    if (!detail) return;
    const reportCardId = detail.reportCard.id;

    startTransition(async () => {
      const result = await finaliseReportAction(reportCardId, closingComment);
      if (result.success) {
        toast.success("Report finalised. Its logs are now read-only.");
        await loadDetail(reportCardId);
        // The list's badges and the previous report's lock state both change,
        // and both are server-rendered.
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  };

  const handleReopen = () => {
    if (!detail) return;
    const reportCardId = detail.reportCard.id;

    startTransition(async () => {
      const result = await reopenReportAction(reportCardId);
      if (result.success) {
        toast.success("Report reopened. Its logs can be edited again.");
        await loadDetail(reportCardId);
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  };

  // A Retrospective_Report's Log_Slots are unfillable by construction, so slot
  // completeness cannot gate its finalise control. `ReportCardService.finaliseReport`
  // applies the identical waiver server-side; this mirrors it so the button never
  // refuses something the server would accept. Every other precondition — report
  // ACTIVE, comment present — is untouched, which is why this is one predicate
  // rather than a separate branch.
  const isRetrospective = detail?.reportCard.isRetrospective ?? false;
  const canFinalise =
    detail !== null && (detail.isComplete || isRetrospective);

  return (
    <div className="space-y-4">
      <ReportCardHistoryPanel
        entries={entries}
        selectedReportCardId={selectedId}
        onSelect={handleSelect}
        loading={loading}
      />

      {selectedId && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">
              {detail
                ? `${detail.reportCard.subjectType === "STAY" ? "Stay" : "Subscription"} report · ${format(
                    parseISODateString(detail.reportCard.windowStart),
                    "d MMM",
                  )} – ${format(
                    parseISODateString(detail.reportCard.windowEnd),
                    "d MMM yyyy",
                  )}`
                : "Loading report…"}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {loading && (
              <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading report…
              </div>
            )}

            {detail && (
              <>
                {!detail.reportCard.isEditable && (
                  <div className="flex items-start gap-2 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                    <Lock className="mt-0.5 h-4 w-4 shrink-0" />
                    <p>
                      This report is closed and permanently locked. Only the most
                      recently closed report can be reopened.
                    </p>
                  </div>
                )}

                {/* CLOSED — the Final_Report leads. */}
                {detail.reportCard.status === "CLOSED" && (
                  <>
                    {periodReport ? (
                      <PeriodReportView report={periodReport} />
                    ) : (
                      <div className="flex items-start gap-2 rounded-lg border border-dashed border-input px-4 py-3 text-sm text-muted-foreground">
                        <MessageSquareQuote className="mt-0.5 h-4 w-4 shrink-0" />
                        <p>
                          The final report could not be loaded. The period&apos;s
                          logs are still readable below.
                        </p>
                      </div>
                    )}

                    {/* Finalisation stamp and Reopen, kept out of the collapsed
                        section so reopening never requires expanding the audit
                        trail to find the button. */}
                    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-input p-4">
                      <p className="text-xs text-muted-foreground">
                        {detail.reportCard.finalisedAt
                          ? `Finalised ${format(
                              new Date(detail.reportCard.finalisedAt),
                              "d MMM yyyy, h:mm a",
                            )}`
                          : "Closed"}
                        {detail.reportCard.reopenCount > 0 &&
                          ` · reopened ${detail.reportCard.reopenCount}×`}
                      </p>
                      {detail.reportCard.isReopenable && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={handleReopen}
                          disabled={isPending}
                        >
                          {isPending ? (
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          ) : (
                            <RotateCcw className="mr-2 h-4 w-4" />
                          )}
                          Reopen report
                        </Button>
                      )}
                    </div>

                    {/* The audit trail. Collapsed, never removed (Req 11.6). */}
                    <details className="rounded-lg border border-input">
                      <summary className="cursor-pointer px-4 py-3 text-sm font-medium">
                        Log slots ({detail.loggedSlots}/{detail.totalSlots}) ·
                        audit trail
                      </summary>
                      <div className="border-t border-input px-4 py-3">
                        <LogSlotSelector
                          slots={detail.slots}
                          selectedDate={null}
                          onSelect={() => {
                            /* A closed report's slots are read-only. */
                          }}
                          disabled
                          emptyMessage="No log slots fall in this period."
                        />
                      </div>
                    </details>
                  </>
                )}

                {/* ACTIVE — the slot strip leads, because slot entry is still
                    the work, with the report available as a preview below. */}
                {detail.reportCard.status === "ACTIVE" && (
                  <>
                    <LogSlotSelector
                      slots={detail.slots}
                      selectedDate={null}
                      onSelect={() => {
                        /* Selection is owned by the live log workspace. */
                      }}
                      disabled
                      emptyMessage="No log slots fall in this period."
                    />

                    {periodReport && (
                      <details className="rounded-lg border border-input">
                        <summary className="cursor-pointer px-4 py-3 text-sm font-medium">
                          Preview the report this period would produce
                        </summary>
                        <div className="border-t border-input px-4 py-3">
                          <PeriodReportView report={periodReport} />
                        </div>
                      </details>
                    )}

                    {/* The finalise form. Enabled only once every slot in the
                        period is logged; the hint says why when it is not. */}
                    <div className="space-y-3 rounded-lg border border-input p-4">
                      <div className="space-y-1.5">
                        <Label htmlFor="report-closing-comment">
                          Closing comment
                        </Label>
                        <Textarea
                          id="report-closing-comment"
                          value={closingComment}
                          onChange={(event) =>
                            setClosingComment(event.target.value)
                          }
                          maxLength={MAX_CLOSING_COMMENT}
                          rows={4}
                          placeholder="Summarise this period before finalising the report…"
                          disabled={isPending || !canFinalise}
                        />
                        <p
                          className={
                            isRetrospective
                              ? "text-xs text-violet-700"
                              : "text-xs text-muted-foreground"
                          }
                        >
                          {/* The relaxation is never silent: a Dietitian closing
                              a report with visible slot gaps is told the gaps are
                              historical, not their own omission (Req 18.5). */}
                          {isRetrospective
                            ? REPORT_PREDATES_LOG_COLLECTION
                            : detail.isComplete
                              ? `${closingComment.length} / ${MAX_CLOSING_COMMENT}`
                              : detail.totalSlots === 0
                                ? "This period has no log slots, so there is nothing to finalise."
                                : `Fill all ${detail.totalSlots} log slots before finalising — ${
                                    detail.totalSlots - detail.loggedSlots
                                  } still pending.`}
                        </p>
                      </div>

                      <Button
                        size="sm"
                        onClick={handleFinalise}
                        disabled={
                          isPending ||
                          !canFinalise ||
                          closingComment.trim().length === 0
                        }
                      >
                        {isPending ? (
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : (
                          <CheckCircle2 className="mr-2 h-4 w-4" />
                        )}
                        Finalise report
                      </Button>

                      {detail.reportCard.reopenCount > 0 && (
                        <p className="text-xs text-muted-foreground">
                          Reopened {detail.reportCard.reopenCount}× — its logs
                          are editable again while it stays open.
                        </p>
                      )}
                    </div>
                  </>
                )}
              </>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
