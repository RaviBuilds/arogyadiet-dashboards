"use client";

/**
 * KitReportDownloadButton
 *
 * Triggers a PDF download from /api/kit-report/[subscriptionId].
 * Shows loading indicator during generation and handles error states.
 * Disabled for PENDING subscriptions.
 *
 * Requirements: 9.1, 9.6, 10.5, 10.6
 */

import { useState } from "react";
import { FileText, Loader2, Download } from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import type { KitSubscriptionStatus } from "@/types/kitLifecycle";

interface KitReportDownloadButtonProps {
  subscriptionId: string;
  status: KitSubscriptionStatus;
}

export function KitReportDownloadButton({
  subscriptionId,
  status,
}: KitReportDownloadButtonProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isDisabled = status === "PENDING";

  async function handleDownload() {
    if (isDisabled || isLoading) return;

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/kit-report/${subscriptionId}`);

      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(
          data?.error || "Report could not be generated. Please try again."
        );
      }

      // Create blob from response and trigger download
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `kit-report-${subscriptionId}.pdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : "Report could not be generated. Please try again.";
      setError(message);
    } finally {
      setIsLoading(false);
    }
  }

  if (isDisabled) {
    return (
      <div className="flex flex-col items-center gap-1">
        <Button
          variant="ghost"
          size="icon"
          disabled
          className="h-9 w-9 rounded-lg cursor-not-allowed"
          title="Report not available for pending subscriptions"
        >
          <FileText className="h-4 w-4 text-slate-300" />
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-1">
      <Button
        variant="ghost"
        size="icon"
        onClick={handleDownload}
        disabled={isLoading}
        className="h-9 w-9 rounded-lg text-primary hover:text-primary hover:bg-primary/10 transition-all duration-200 group"
        title="Download KIT Report"
      >
        {isLoading ? (
          <Loader2 className="h-4 w-4 animate-spin text-primary/60" />
        ) : (
          <div className="relative">
            <FileText className="h-4 w-4 transition-transform duration-200 group-hover:scale-110" />
            <Download className="h-2.5 w-2.5 absolute -bottom-0.5 -right-0.5 text-primary" />
          </div>
        )}
      </Button>
      {error && (
        <p className="max-w-[120px] text-center text-[10px] leading-tight text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
