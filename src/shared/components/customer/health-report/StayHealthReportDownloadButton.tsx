"use client";

// src/shared/components/customer/health-report/StayHealthReportDownloadButton.tsx
//
// Downloads the ACCOMMODATION Health Report PDF for one stay from
// /api/stay-health-report/[stayId]. The route authenticates the customer from
// their session and verifies stay ownership, so this component only needs the
// stay id.
//
// Two presentations over one fetch path:
// - `hero`    the Health Report page's primary action, on the dark green hero, so
//             it is white — the coral `--primary` would fight the gradient.
// - `compact` a row action in the stay history table and its mobile cards.

import { useState } from "react";
import { Download, FileDown, Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";

interface StayHealthReportDownloadButtonProps {
  stayId: string;
  /** Disabled when the stay has no dietitian-recorded days to report on. */
  hasRecords: boolean;
  /** Days included in the PDF, shown as a hint (hero) or tooltip (compact). */
  dayCount: number;
  variant?: "hero" | "compact";
  /** Compact label. Defaults to "PDF"; the mobile stay card passes a fuller one. */
  label?: string;
  className?: string;
}

export function StayHealthReportDownloadButton({
  stayId,
  hasRecords,
  dayCount,
  variant = "hero",
  label = "PDF",
  className,
}: StayHealthReportDownloadButtonProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDownload() {
    if (!hasRecords || isLoading) return;

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/stay-health-report/${stayId}`);

      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(
          data?.error || "Report could not be generated. Please try again.",
        );
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `health-report-${stayId}.pdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Report could not be generated. Please try again.",
      );
    } finally {
      setIsLoading(false);
    }
  }

  const dayHint = `${dayCount} ${dayCount === 1 ? "day" : "days"}`;
  const title = hasRecords
    ? `Download the health report for this stay (${dayHint} recorded)`
    : "No readings were recorded during this stay";

  // ---------------------------------------------------------------------------
  // Compact — stay history row action
  // ---------------------------------------------------------------------------
  if (variant === "compact") {
    if (!hasRecords) {
      return (
        <span
          className={cn(
            "inline-flex items-center gap-1.5 text-xs font-medium text-slate-400",
            className,
          )}
          title={title}
        >
          <Download className="h-3.5 w-3.5" aria-hidden="true" />
          No readings
        </span>
      );
    }

    return (
      <div className={cn("inline-flex flex-col gap-1", className)}>
        <button
          type="button"
          onClick={handleDownload}
          disabled={isLoading}
          aria-busy={isLoading}
          title={title}
          className={cn(
            "group inline-flex items-center justify-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-xs font-semibold text-emerald-700 transition-all duration-200",
            "hover:border-emerald-300 hover:bg-emerald-100 active:scale-[0.98]",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40",
            isLoading && "cursor-wait opacity-80",
          )}
        >
          {isLoading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
          ) : (
            <FileDown
              className="h-3.5 w-3.5 transition-transform duration-200 group-hover:translate-y-0.5"
              aria-hidden="true"
            />
          )}
          {isLoading ? "Preparing…" : label}
          <span className="sr-only"> — health report for this stay</span>
        </button>
        {error && (
          <p role="alert" className="max-w-[11rem] text-[11px] leading-tight text-destructive">
            {error}
          </p>
        )}
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Hero — the Health Report page's primary action
  // ---------------------------------------------------------------------------
  return (
    <div className={cn("flex flex-col gap-1.5 sm:items-end", className)}>
      <button
        type="button"
        onClick={handleDownload}
        disabled={isLoading || !hasRecords}
        aria-busy={isLoading}
        className={cn(
          "group inline-flex w-full items-center justify-center gap-2 rounded-full px-5 py-2.5 text-sm font-semibold shadow-sm transition-all duration-200 sm:w-auto",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:ring-offset-2 focus-visible:ring-offset-emerald-800",
          hasRecords
            ? "bg-white text-emerald-800 hover:shadow-md hover:brightness-105 active:scale-[0.98]"
            : "cursor-not-allowed bg-white/15 text-emerald-50/60 ring-1 ring-inset ring-white/20",
          isLoading && "cursor-wait",
        )}
        title={
          hasRecords
            ? "Download your health report as a PDF"
            : "Available once your wellness team records your first reading"
        }
      >
        {isLoading ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            Preparing PDF…
          </>
        ) : (
          <>
            <FileDown
              className="h-4 w-4 transition-transform duration-200 group-hover:translate-y-0.5"
              aria-hidden="true"
            />
            Download Health Report
          </>
        )}
      </button>

      {error ? (
        <p role="alert" className="max-w-[15rem] text-xs leading-tight text-rose-100">
          {error}
        </p>
      ) : (
        <p className="text-[11px] font-medium text-emerald-50/70 sm:text-right">
          {hasRecords ? (
            <>
              <Download className="mr-1 inline h-3 w-3" aria-hidden="true" />
              PDF · {dayHint} included
            </>
          ) : (
            "Available after your first reading"
          )}
        </p>
      )}
    </div>
  );
}
