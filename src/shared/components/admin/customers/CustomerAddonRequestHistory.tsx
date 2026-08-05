"use client";

// src/shared/components/admin/customers/CustomerAddonRequestHistory.tsx
//
// The complete add-on wellness service request history for ONE customer,
// rendered at the bottom of the Customer_360 Accommodation tab.
//
// Scope contrast with AddonServiceRequestsPanel: that panel is the live work
// queue across all in-house guests and drops a request once its guest checks
// out. This is the per-customer audit trail — every request ever raised, in
// every status (PENDING / CONFIRMED / COMPLETED / CANCELLED), including those
// from stays that have long since finished. It is read-only; status changes
// happen on the queue.

import { useCallback, useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { AlertCircle, History, Loader2, Sparkles } from "lucide-react";

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
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { cn } from "@/lib/utils";

import {
  getAdminAddonRequestHistoryAction,
  type AdminAddonRequestHistoryRow,
} from "@/actions/admin-actions/customerHistoryActions";
import type { AddonServiceStatus } from "@/types/accommodation";

/** Display labels for the requestable service types (mirrors the customer UI). */
const SERVICE_TYPE_LABELS: Record<string, string> = {
  THERAPY: "Therapy Session",
  MASSAGE: "Ayurvedic Massage",
  YOGA: "Private Yoga Session",
};

const STATUS_STYLES: Record<AddonServiceStatus, string> = {
  PENDING: "bg-amber-50 text-amber-700 border-amber-200",
  CONFIRMED: "bg-blue-50 text-blue-700 border-blue-200",
  COMPLETED: "bg-emerald-50 text-emerald-700 border-emerald-200",
  CANCELLED: "bg-slate-50 text-slate-500 border-slate-200",
};

function formatTimestamp(value: string): string {
  try {
    return format(new Date(value), "dd MMM yyyy, hh:mm a");
  } catch {
    return value;
  }
}

interface CustomerAddonRequestHistoryProps {
  customerProfileId: string;
}

export function CustomerAddonRequestHistory({
  customerProfileId,
}: CustomerAddonRequestHistoryProps) {
  const [rows, setRows] = useState<AdminAddonRequestHistoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await getAdminAddonRequestHistoryAction(customerProfileId);
      if (!result.success) {
        setError(result.error);
        setRows([]);
        return;
      }
      setRows(result.data);
    } catch {
      setError("Unable to load add-on service history.");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [customerProfileId]);

  useEffect(() => {
    // Load-on-mount against a Server Action — the same pattern as
    // UserManagement's and CustomerHistoryTab's fetch effects. `load` owns its
    // own loading/error state, so the initial setState here is intentional.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  /** Per-status tallies for the at-a-glance summary strip. */
  const counts = useMemo(() => {
    const tally = { PENDING: 0, CONFIRMED: 0, COMPLETED: 0, CANCELLED: 0 };
    for (const row of rows) {
      if (row.status in tally) tally[row.status] += 1;
    }
    return tally;
  }, [rows]);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-bold tracking-tight">
          Add-on Service Request History
        </h2>
        <p className="text-sm text-muted-foreground">
          Every wellness service this customer has requested, across all stays.
        </p>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Sparkles className="h-4 w-4 text-emerald-600" />
              All Requests
              {rows.length > 0 && (
                <span className="text-sm font-normal text-muted-foreground">
                  ({rows.length})
                </span>
              )}
            </CardTitle>
            {rows.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                {(
                  ["PENDING", "CONFIRMED", "COMPLETED", "CANCELLED"] as const
                ).map((status) =>
                  counts[status] > 0 ? (
                    <Badge
                      key={status}
                      variant="outline"
                      className={cn(
                        "rounded-full px-2.5 text-[11px] font-semibold shadow-none",
                        STATUS_STYLES[status],
                      )}
                    >
                      {counts[status]} {status.toLowerCase()}
                    </Badge>
                  ) : null,
                )}
              </div>
            )}
          </div>
        </CardHeader>

        <CardContent>
          {loading ? (
            <div className="flex min-h-[140px] items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : error ? (
            <div className="flex min-h-[140px] flex-col items-center justify-center gap-2">
              <AlertCircle className="h-6 w-6 text-destructive" />
              <p className="text-sm text-muted-foreground">{error}</p>
              <Button variant="outline" size="sm" onClick={() => void load()}>
                Retry
              </Button>
            </div>
          ) : rows.length === 0 ? (
            <div className="flex min-h-[140px] flex-col items-center justify-center gap-2">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
                <History className="h-6 w-6 text-muted-foreground" />
              </div>
              <p className="text-sm text-muted-foreground">
                This customer has not requested any add-on services yet.
              </p>
            </div>
          ) : (
            <div className="overflow-hidden rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50 hover:bg-muted/50">
                    <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Service
                    </TableHead>
                    <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Requested
                    </TableHead>
                    <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Last Updated
                    </TableHead>
                    <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Status
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell className="font-medium text-slate-900">
                        {SERVICE_TYPE_LABELS[row.serviceType] ?? row.serviceType}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {formatTimestamp(row.requestedAt)}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {formatTimestamp(row.updatedAt)}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={cn(
                            "w-fit rounded-full px-2.5 text-[11px] font-semibold shadow-none",
                            STATUS_STYLES[row.status],
                          )}
                        >
                          {row.status}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
