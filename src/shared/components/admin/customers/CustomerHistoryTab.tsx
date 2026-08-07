"use client";

/**
 * CustomerHistoryTab
 *
 * The Customer_360 history tab, rendered per Customer_Category:
 * - MEAL          → "Subscription History"  (one row per meal subscription)
 * - KIT           → "KIT History"           (one row per KIT)
 * - ACCOMMODATION → "Accommodation History" (one row per stay)
 *
 * Each row's report button downloads the exact same PDF the customer downloads
 * from their own dashboard, served by /api/admin/customer-report/[type]/[id].
 */

import { useCallback, useEffect, useState } from "react";
import { format } from "date-fns";
import { AlertCircle, Download, FileText, Loader2, Package } from "lucide-react";

import {
  getAdminKitHistoryAction,
  getAdminMealSubscriptionHistoryAction,
  getAdminStayHistoryAction,
} from "@/actions/admin-actions/customerHistoryActions";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { Card, CardContent } from "@/shared/components/ui/card";
import { StayDocumentsDialog } from "./StayDocumentsDialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/shared/components/ui/table";

type HistoryCategory = "MEAL" | "KIT" | "ACCOMMODATION";

/** A category-agnostic row so one table renders all three histories. */
interface HistoryRow {
  id: string;
  /** Report type segment for the download URL. */
  reportType: "meal" | "kit" | "stay";
  title: string;
  subtitle: string | null;
  startDate: string | null;
  endDate: string | null;
  duration: number | null;
  status: string;
  /** Extra category-specific column, e.g. KIT meals taken / skipped. */
  extra: string | null;
  reportDisabled: boolean;
}

interface CustomerHistoryTabProps {
  customerProfileId: string;
  category: HistoryCategory;
}

const COPY: Record<
  HistoryCategory,
  { primaryHeader: string; durationHeader: string; extraHeader: string | null; empty: string }
> = {
  MEAL: {
    primaryHeader: "Plan",
    durationHeader: "Duration",
    extraHeader: null,
    empty: "This customer has no meal subscriptions yet.",
  },
  KIT: {
    primaryHeader: "KIT Package",
    durationHeader: "KIT Days",
    extraHeader: "Taken / Skipped",
    empty: "This customer has no KIT subscriptions yet.",
  },
  ACCOMMODATION: {
    primaryHeader: "Stay",
    durationHeader: "Nights",
    // Count of add-on wellness services actually delivered during the stay.
    extraHeader: "Completed Add-ons",
    empty: "This customer has no stays yet.",
  },
};

function formatDate(value: string | null): string {
  if (!value) return "—";
  try {
    return format(new Date(value), "dd MMM yyyy");
  } catch {
    return value;
  }
}

function StatusBadge({ status }: { status: string }) {
  const upper = status.toUpperCase();
  const tone =
    upper === "ACTIVE"
      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
      : upper === "PENDING"
        ? "border-amber-200 bg-amber-50 text-amber-700"
        : upper === "PAUSED"
          ? "border-blue-200 bg-blue-50 text-blue-700"
          : "border-slate-200 bg-slate-50 text-slate-500";

  return (
    <Badge
      variant="outline"
      className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wider ${tone}`}
    >
      {status}
    </Badge>
  );
}

function ReportDownloadButton({ row }: { row: HistoryRow }) {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDownload() {
    if (row.reportDisabled || isLoading) return;

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(
        `/api/admin/customer-report/${row.reportType}/${row.id}`,
      );

      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.error || "Report could not be generated.");
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download =
        row.reportType === "kit" ? `kit-report-${row.id}.pdf` : `health-report-${row.id}.pdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Report could not be generated.");
    } finally {
      setIsLoading(false);
    }
  }

  if (row.reportDisabled) {
    return (
      <Button
        variant="ghost"
        size="icon"
        disabled
        className="h-9 w-9 rounded-lg cursor-not-allowed"
        title="Report not available yet"
      >
        <FileText className="h-4 w-4 text-slate-300" />
      </Button>
    );
  }

  return (
    <div className="flex flex-col items-center gap-1">
      <Button
        variant="ghost"
        size="icon"
        onClick={handleDownload}
        disabled={isLoading}
        className="h-9 w-9 rounded-lg text-primary hover:bg-primary/10 hover:text-primary"
        title="Download report"
      >
        {isLoading ? (
          <Loader2 className="h-4 w-4 animate-spin text-primary/60" />
        ) : (
          <div className="relative">
            <FileText className="h-4 w-4" />
            <Download className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 text-primary" />
          </div>
        )}
      </Button>
      {error && (
        <p className="max-w-[140px] text-center text-[10px] leading-tight text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

export function CustomerHistoryTab({
  customerProfileId,
  category,
}: CustomerHistoryTabProps) {
  const [rows, setRows] = useState<HistoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      if (category === "KIT") {
        const res = await getAdminKitHistoryAction(customerProfileId);
        if (!res.success) {
          setError(res.error);
          return;
        }
        setRows(
          res.data.map((entry) => ({
            id: entry.id,
            reportType: "kit" as const,
            title: entry.kitProductName,
            subtitle: null,
            startDate: entry.orderDate,
            endDate: null,
            duration: entry.kitDays,
            status: entry.status,
            extra: `${entry.daysTakenMeal} / ${entry.daysSkipped}`,
            reportDisabled: !entry.canDownloadReport,
          })),
        );
        return;
      }

      if (category === "ACCOMMODATION") {
        const res = await getAdminStayHistoryAction(customerProfileId);
        if (!res.success) {
          setError(res.error);
          return;
        }
        setRows(
          res.data.map((stay) => ({
            id: stay.id,
            reportType: "stay" as const,
            title:
              [stay.stayType, stay.occupancyType].filter(Boolean).join(" · ") ||
              "Accommodation Stay",
            subtitle: null,
            startDate: stay.startDate,
            endDate: stay.endDate,
            duration: stay.totalNights,
            status: stay.status,
            extra: String(stay.completedAddonCount),
            reportDisabled: stay.status.toUpperCase() === "PENDING",
          })),
        );
        return;
      }

      const res = await getAdminMealSubscriptionHistoryAction(customerProfileId);
      if (!res.success) {
        setError(res.error);
        return;
      }
      setRows(
        res.data.map((sub) => ({
          id: sub.id,
          reportType: "meal" as const,
          title: sub.planName ?? "Meal Plan",
          subtitle: sub.subscriptionCode,
          startDate: sub.startsOn,
          endDate: sub.endsOn,
          duration: sub.totalDays,
          status: sub.status,
          extra: null,
          reportDisabled: sub.status.toUpperCase() === "PENDING",
        })),
      );
    } catch {
      setError("Unable to load history right now.");
    } finally {
      setLoading(false);
    }
  }, [category, customerProfileId]);

  useEffect(() => {
    void load();
  }, [load]);

  const copy = COPY[category];

  if (loading) {
    return (
      <Card>
        <CardContent className="flex min-h-[220px] items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardContent className="flex min-h-[220px] flex-col items-center justify-center gap-2">
          <AlertCircle className="h-6 w-6 text-destructive" />
          <p className="text-sm text-muted-foreground">{error}</p>
          <Button variant="outline" size="sm" onClick={() => void load()}>
            Retry
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (rows.length === 0) {
    return (
      <Card className="border-dashed">
        <CardContent className="flex min-h-[220px] flex-col items-center justify-center gap-2">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted">
            <Package className="h-7 w-7 text-muted-foreground" />
          </div>
          <p className="text-sm text-muted-foreground">{copy.empty}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/50 hover:bg-muted/50">
            <TableHead className="pl-6 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {copy.primaryHeader}
            </TableHead>
            <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {category === "KIT" ? "Order Date" : "Start Date"}
            </TableHead>
            {category !== "KIT" && (
              <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                End Date
              </TableHead>
            )}
            <TableHead className="text-center text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {copy.durationHeader}
            </TableHead>
            {copy.extraHeader && (
              <TableHead className="text-center text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {copy.extraHeader}
              </TableHead>
            )}
            <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Status
            </TableHead>
            {/* Accommodation is the only category whose money is split across
                several documents — a receipt per payment plus the invoices — so
                it is the only one that needs a way to reach them all. */}
            {category === "ACCOMMODATION" && (
              <TableHead className="text-center text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Invoices
              </TableHead>
            )}
            <TableHead className="pr-6 text-center text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Report
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.id}>
              <TableCell className="pl-6 font-semibold">
                {row.title}
                {row.subtitle && (
                  <span className="block text-[11px] font-normal text-muted-foreground">
                    {row.subtitle}
                  </span>
                )}
              </TableCell>
              <TableCell className="text-sm">{formatDate(row.startDate)}</TableCell>
              {category !== "KIT" && (
                <TableCell className="text-sm">{formatDate(row.endDate)}</TableCell>
              )}
              <TableCell className="text-center">
                <span className="inline-flex h-7 min-w-[28px] items-center justify-center rounded-md bg-muted px-2 text-sm font-semibold">
                  {row.duration ?? "—"}
                </span>
              </TableCell>
              {copy.extraHeader && (
                <TableCell className="text-center text-sm">
                  {/* The accommodation extra is a single count, so it gets the
                      same numeric pill as the Nights column beside it. KIT's
                      "taken / skipped" pair stays plain text. */}
                  {category === "ACCOMMODATION" ? (
                    <span className="inline-flex h-7 min-w-[28px] items-center justify-center rounded-md bg-muted px-2 text-sm font-semibold">
                      {row.extra ?? "0"}
                    </span>
                  ) : (
                    (row.extra ?? "—")
                  )}
                </TableCell>
              )}
              <TableCell>
                <StatusBadge status={row.status} />
              </TableCell>
              {category === "ACCOMMODATION" && (
                <TableCell className="text-center">
                  {/* For accommodation rows `row.id` IS the stay id — the same
                      value the report route is keyed on. */}
                  <StayDocumentsDialog
                    stayId={row.id}
                    stayLabel={row.title}
                    stayPeriod={`${formatDate(row.startDate)} – ${formatDate(row.endDate)}`}
                  />
                </TableCell>
              )}
              <TableCell className="pr-6 text-center">
                <ReportDownloadButton row={row} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}
