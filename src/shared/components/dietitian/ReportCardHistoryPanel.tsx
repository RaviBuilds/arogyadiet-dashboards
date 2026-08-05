"use client";

// src/shared/components/dietitian/ReportCardHistoryPanel.tsx
// Feature: report-card-lifecycle — Phase 2 (read path).
//
// Lists every Report_Card a customer has — one per MEAL/KIT subscription and
// per accommodation stay — so a Dietitian can see the current period alongside
// every earlier one, and jump back into an older report whose slots were never
// finished.
//
// Applies to all three Customer_Categories. The row label adapts:
//   MEAL / KIT     "Subscription · 14 Jul – 12 Aug 2026"
//   ACCOMMODATION  "Stay · 27 Jul – 3 Aug 2026"
//
// Each row shows one of five states, which between them cover the whole
// lifecycle the feature defines:
//   In progress  — ACTIVE, slots outstanding
//   Historical   — ACTIVE and Retrospective: the period ended before the report
//                  existed, so its slots can never be filled. Distinguished from
//                  "In progress" because that label would imply work is possible
//                  when none is, which is what leaves a Dietitian staring at a
//                  permanently incomplete slot count (Req 18.6)
//   Ready        — ACTIVE, every slot logged, awaiting a Closing_Comment
//   Closed       — CLOSED and reopenable (the most recent closed report)
//   Locked       — CLOSED and permanently locked (any older closed report)
//
// `isEditable` / `isReopenable` are read straight off the server payload, which
// sources them from `v_report_card_editability`. This component never derives
// the lock rule from `status`.
//
// Purely presentational — data loading and selection are owned by the caller.

import { format } from "date-fns";
import {
  Check,
  ChevronRight,
  Clock,
  History,
  Lock,
  RotateCcw,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { parseISODateString } from "@/lib/dates/ist";
import { Badge } from "@/shared/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/shared/components/ui/card";
import type { ReportCardHistoryEntry } from "@/types/dietitian";

export interface ReportCardHistoryPanelProps {
  entries: ReportCardHistoryEntry[];
  /** The report currently open, or `null`. */
  selectedReportCardId: string | null;
  onSelect: (reportCardId: string) => void;
  /** Disables selection while the chosen report is loading. */
  loading?: boolean;
}

type RowState =
  | "IN_PROGRESS"
  | "HISTORICAL"
  | "READY"
  | "CLOSED"
  | "LOCKED";

function rowState(entry: ReportCardHistoryEntry): RowState {
  if (entry.reportCard.status === "CLOSED") {
    return entry.reportCard.isReopenable ? "CLOSED" : "LOCKED";
  }
  if (entry.isComplete) return "READY";
  // Checked after `isComplete` so a retrospective period that somehow DID get
  // every slot logged still reads as ready rather than as historical.
  return entry.reportCard.isRetrospective ? "HISTORICAL" : "IN_PROGRESS";
}

const STATE_META: Record<
  RowState,
  { label: string; Icon: typeof Check; badgeClass: string }
> = {
  IN_PROGRESS: {
    label: "In progress",
    Icon: Clock,
    badgeClass: "border-amber-200 bg-amber-50 text-amber-800",
  },
  HISTORICAL: {
    label: "Historical · can close",
    Icon: History,
    badgeClass: "border-violet-200 bg-violet-50 text-violet-800",
  },
  READY: {
    label: "Ready to finalise",
    Icon: Check,
    badgeClass: "border-sky-200 bg-sky-50 text-sky-800",
  },
  CLOSED: {
    label: "Closed · can reopen",
    Icon: RotateCcw,
    badgeClass: "border-emerald-200 bg-emerald-50 text-emerald-800",
  },
  LOCKED: {
    label: "Locked",
    Icon: Lock,
    badgeClass: "border-slate-200 bg-slate-50 text-slate-500",
  },
};

/** `14 Jul – 12 Aug 2026`, collapsing a shared year onto the end. */
function formatWindow(start: string, end: string): string {
  const from = parseISODateString(start);
  const to = parseISODateString(end);
  const sameYear = from.getFullYear() === to.getFullYear();
  return `${format(from, sameYear ? "d MMM" : "d MMM yyyy")} – ${format(to, "d MMM yyyy")}`;
}

function subjectLabel(entry: ReportCardHistoryEntry): string {
  return entry.reportCard.subjectType === "STAY" ? "Stay" : "Subscription";
}

export function ReportCardHistoryPanel({
  entries,
  selectedReportCardId,
  onSelect,
  loading = false,
}: ReportCardHistoryPanelProps) {
  if (entries.length === 0) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Reports</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="rounded-lg border border-dashed border-input p-6 text-center text-sm text-muted-foreground">
            This customer has no subscription or stay on record yet, so there are
            no reports.
          </p>
        </CardContent>
      </Card>
    );
  }

  const openCount = entries.filter(
    (entry) => entry.reportCard.status === "ACTIVE",
  ).length;
  // Counts both genuinely-ready reports and historical ones, because both are
  // closable right now — a Dietitian clearing their backlog wants one number for
  // "how many can I finish", not two.
  const readyCount = entries.filter((entry) => {
    const state = rowState(entry);
    return state === "READY" || state === "HISTORICAL";
  }).length;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Reports</CardTitle>
        <CardDescription>
          {entries.length} {entries.length === 1 ? "period" : "periods"} ·{" "}
          {openCount} open
          {readyCount > 0 ? ` · ${readyCount} can be finalised` : ""}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {entries.map((entry) => {
          const state = rowState(entry);
          const meta = STATE_META[state];
          const isSelected = entry.reportCard.id === selectedReportCardId;

          return (
            <button
              key={entry.reportCard.id}
              type="button"
              onClick={() => onSelect(entry.reportCard.id)}
              disabled={loading}
              aria-current={isSelected ? "true" : undefined}
              className={cn(
                "flex w-full items-center justify-between gap-4 rounded-lg border px-4 py-3 text-left transition-colors",
                isSelected
                  ? "border-primary bg-primary/5"
                  : "border-input hover:bg-muted/50",
                loading && "cursor-not-allowed opacity-60",
              )}
            >
              <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium">
                    {subjectLabel(entry)} ·{" "}
                    {formatWindow(
                      entry.reportCard.windowStart,
                      entry.reportCard.windowEnd,
                    )}
                  </span>
                  {entry.isCurrent && (
                    <Badge
                      variant="outline"
                      className="border-primary/30 bg-primary/10 text-[10px] font-semibold text-primary"
                    >
                      Current
                    </Badge>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  {entry.totalSlots === 0
                    ? "No log slots in this period"
                    : `${entry.loggedSlots} of ${entry.totalSlots} slots logged`}
                  {/* Names the gaps as historical. Without this, a 0-of-24 row
                      reads as two dozen missed logs rather than as a period that
                      pre-dates logging entirely. */}
                  {state === "HISTORICAL" && " · period pre-dates logging"}
                  {entry.reportCard.reopenCount > 0 &&
                    ` · reopened ${entry.reportCard.reopenCount}×`}
                </p>
              </div>

              <div className="flex shrink-0 items-center gap-2">
                <Badge
                  variant="outline"
                  className={cn(
                    "gap-1 text-[11px] font-semibold",
                    meta.badgeClass,
                  )}
                >
                  <meta.Icon className="h-3 w-3" />
                  {meta.label}
                </Badge>
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              </div>
            </button>
          );
        })}
      </CardContent>
    </Card>
  );
}
