"use client";

/**
 * SubscriptionHistoryTable
 *
 * Displays the customer's MEAL subscription history in a responsive layout,
 * mirroring the KIT History table aesthetic.
 * Desktop: card-wrapped table. Mobile (<768px): stacked cards.
 * Each row exposes a per-subscription Health Report PDF download.
 */

import { format } from "date-fns";
import { Badge } from "@/shared/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/shared/components/ui/table";
import { Card, CardContent } from "@/shared/components/ui/card";
import { HealthReportDownloadButton } from "./HealthReportDownloadButton";
import type { MealSubscriptionRow } from "@/repositories/healthReportRepository";
import { Package, CalendarDays, CalendarClock } from "lucide-react";

interface SubscriptionHistoryTableProps {
  subscriptions: MealSubscriptionRow[];
}

function getStatusBadge(status: string) {
  const upper = status.toUpperCase();
  switch (upper) {
    case "ACTIVE":
      return (
        <Badge
          variant="outline"
          className="rounded-full border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-emerald-700"
        >
          Active
        </Badge>
      );
    case "PENDING":
      return (
        <Badge
          variant="outline"
          className="rounded-full border-amber-200 bg-amber-50 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-amber-700"
        >
          Pending
        </Badge>
      );
    case "PAUSED":
      return (
        <Badge
          variant="outline"
          className="rounded-full border-blue-200 bg-blue-50 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-blue-700"
        >
          Paused
        </Badge>
      );
    default:
      return (
        <Badge
          variant="outline"
          className="rounded-full border-slate-200 bg-slate-50 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500"
        >
          {status}
        </Badge>
      );
  }
}

function formatDate(dateString: string | null): string {
  if (!dateString) return "—";
  try {
    return format(new Date(dateString), "dd MMM yyyy");
  } catch {
    return dateString;
  }
}

export function SubscriptionHistoryTable({
  subscriptions,
}: SubscriptionHistoryTableProps) {
  if (subscriptions.length === 0) {
    return (
      <Card className="border border-dashed border-slate-200 bg-white shadow-sm">
        <CardContent className="flex flex-col items-center justify-center min-h-[300px] py-16">
          <div className="h-16 w-16 bg-slate-100 rounded-full flex items-center justify-center mb-4">
            <Package className="h-8 w-8 text-slate-400" />
          </div>
          <p className="text-lg font-semibold text-slate-900 tracking-tight">
            No Subscriptions Yet
          </p>
          <p className="text-sm text-slate-500 mt-1">
            You don&apos;t have any meal subscriptions yet.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      {/* Desktop Table — hidden below md breakpoint */}
      <div className="hidden md:block">
        <Card className="border border-slate-200 bg-white shadow-sm overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="bg-slate-50/80 hover:bg-slate-50/80">
                <TableHead className="pl-6 text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Plan
                </TableHead>
                <TableHead className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Start Date
                </TableHead>
                <TableHead className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                  End Date
                </TableHead>
                <TableHead className="text-center text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Duration
                </TableHead>
                <TableHead className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Status
                </TableHead>
                <TableHead className="text-center text-xs font-semibold uppercase tracking-wider text-slate-500 pr-6">
                  Report
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {subscriptions.map((entry) => (
                <TableRow
                  key={entry.id}
                  className="group transition-colors hover:bg-slate-50/50"
                >
                  <TableCell className="pl-6 font-semibold text-slate-900">
                    {entry.planName ?? "Meal Plan"}
                    {entry.subscriptionCode && (
                      <span className="block text-[11px] font-normal text-slate-400">
                        {entry.subscriptionCode}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-sm text-slate-700">
                    {formatDate(entry.startsOn)}
                  </TableCell>
                  <TableCell className="text-sm text-slate-700">
                    {formatDate(entry.endsOn)}
                  </TableCell>
                  <TableCell className="text-center">
                    <span className="inline-flex items-center justify-center h-7 min-w-[28px] rounded-md bg-slate-100 px-2 text-sm font-semibold text-slate-700">
                      {entry.totalDays ?? "—"}
                    </span>
                  </TableCell>
                  <TableCell>{getStatusBadge(entry.status)}</TableCell>
                  <TableCell className="text-center pr-6">
                    <HealthReportDownloadButton
                      subscriptionId={entry.id}
                      status={entry.status}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      </div>

      {/* Mobile Cards — visible only below md breakpoint */}
      <div className="md:hidden space-y-4">
        {subscriptions.map((entry) => (
          <Card
            key={entry.id}
            className="border border-slate-200 bg-white shadow-sm overflow-hidden transition-all duration-200 hover:shadow-md"
          >
            <CardContent className="p-0">
              <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 bg-slate-50/50">
                <div className="flex items-center gap-2">
                  <Package className="h-4 w-4 text-emerald-600" />
                  <span className="text-sm font-semibold text-slate-900">
                    {entry.planName ?? "Meal Plan"}
                  </span>
                </div>
                {getStatusBadge(entry.status)}
              </div>

              <div className="p-4 space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div className="flex flex-col items-center p-3 rounded-lg bg-slate-50">
                    <CalendarDays className="h-4 w-4 text-slate-500 mb-1" />
                    <span className="text-sm font-semibold text-slate-900">
                      {formatDate(entry.startsOn)}
                    </span>
                    <span className="text-[10px] uppercase tracking-wider text-slate-500 font-medium">
                      Start
                    </span>
                  </div>
                  <div className="flex flex-col items-center p-3 rounded-lg bg-slate-50">
                    <CalendarClock className="h-4 w-4 text-slate-500 mb-1" />
                    <span className="text-sm font-semibold text-slate-900">
                      {formatDate(entry.endsOn)}
                    </span>
                    <span className="text-[10px] uppercase tracking-wider text-slate-500 font-medium">
                      End
                    </span>
                  </div>
                </div>

                <div className="flex items-center justify-between pt-3 border-t border-slate-100">
                  <div className="space-y-1">
                    <p className="text-xs text-slate-500">
                      {entry.totalDays ? `${entry.totalDays} days` : "—"}
                    </p>
                    {entry.subscriptionCode && (
                      <p className="text-[11px] text-slate-400">
                        {entry.subscriptionCode}
                      </p>
                    )}
                  </div>
                  <HealthReportDownloadButton
                    subscriptionId={entry.id}
                    status={entry.status}
                  />
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </>
  );
}
