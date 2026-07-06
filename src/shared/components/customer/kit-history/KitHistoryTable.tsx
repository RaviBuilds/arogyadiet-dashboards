"use client";

/**
 * KitHistoryTable
 *
 * Displays the customer's KIT subscription history in a responsive layout.
 * Desktop: Premium card-wrapped table with refined styling.
 * Mobile (<768px): Stacked cards with visual hierarchy.
 *
 * Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 8.8
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
import { KitReportDownloadButton } from "./KitReportDownloadButton";
import type { KitHistoryEntry } from "@/types/kitLifecycle";
import {
  Package,
  CalendarDays,
  Utensils,
  SkipForward,
  Truck,
} from "lucide-react";

interface KitHistoryTableProps {
  history: KitHistoryEntry[];
}

/**
 * Returns badge styling based on KIT subscription status.
 * Uses the same badge pattern as KitDashboard (emerald/amber/gray).
 */
function getStatusBadge(status: KitHistoryEntry["status"]) {
  switch (status) {
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
    case "EXPIRED":
      return (
        <Badge
          variant="outline"
          className="rounded-full border-slate-200 bg-slate-50 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500"
        >
          Expired
        </Badge>
      );
  }
}

/**
 * Returns shipping status badge with contextual styling.
 */
function getShippingBadge(shippingStatus: KitHistoryEntry["shippingStatus"]) {
  switch (shippingStatus) {
    case "Delivered":
      return (
        <span className="inline-flex items-center gap-1.5 text-sm text-emerald-700">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
          Delivered
        </span>
      );
    case "Shipped":
      return (
        <span className="inline-flex items-center gap-1.5 text-sm text-blue-700">
          <span className="h-1.5 w-1.5 rounded-full bg-blue-500" />
          Shipped
        </span>
      );
    case "Not Shipped":
      return (
        <span className="inline-flex items-center gap-1.5 text-sm text-slate-500">
          <span className="h-1.5 w-1.5 rounded-full bg-slate-300" />
          Not Shipped
        </span>
      );
  }
}

function formatDate(dateString: string): string {
  try {
    return format(new Date(dateString), "dd MMM yyyy");
  } catch {
    return dateString;
  }
}

export function KitHistoryTable({ history }: KitHistoryTableProps) {
  if (history.length === 0) {
    return (
      <Card className="border border-dashed border-slate-200 bg-white shadow-sm">
        <CardContent className="flex flex-col items-center justify-center min-h-[300px] py-16">
          <div className="h-16 w-16 bg-slate-100 rounded-full flex items-center justify-center mb-4">
            <Package className="h-8 w-8 text-slate-400" />
          </div>
          <p className="text-lg font-semibold text-slate-900 tracking-tight">
            No KIT History
          </p>
          <p className="text-sm text-slate-500 mt-1">
            You don&apos;t have any KIT subscriptions yet.
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
                  Order Date
                </TableHead>
                <TableHead className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                  KIT Package
                </TableHead>
                <TableHead className="text-center text-xs font-semibold uppercase tracking-wider text-slate-500">
                  KIT Days
                </TableHead>
                <TableHead className="text-center text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Meals Taken
                </TableHead>
                <TableHead className="text-center text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Skipped
                </TableHead>
                <TableHead className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Status
                </TableHead>
                <TableHead className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Shipping
                </TableHead>
                <TableHead className="text-center text-xs font-semibold uppercase tracking-wider text-slate-500 pr-6">
                  Report
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {history.map((entry) => (
                <TableRow
                  key={entry.id}
                  className="group transition-colors hover:bg-slate-50/50"
                >
                  <TableCell className="pl-6 text-sm text-slate-700">
                    {formatDate(entry.orderDate)}
                  </TableCell>
                  <TableCell className="font-semibold text-slate-900">
                    {entry.kitProductName}
                  </TableCell>
                  <TableCell className="text-center">
                    <span className="inline-flex items-center justify-center h-7 min-w-[28px] rounded-md bg-slate-100 px-2 text-sm font-semibold text-slate-700">
                      {entry.kitDays}
                    </span>
                  </TableCell>
                  <TableCell className="text-center">
                    <span className="inline-flex items-center justify-center h-7 min-w-[28px] rounded-md bg-emerald-50 px-2 text-sm font-semibold text-emerald-700">
                      {entry.daysTakenMeal}
                    </span>
                  </TableCell>
                  <TableCell className="text-center">
                    <span className="inline-flex items-center justify-center h-7 min-w-[28px] rounded-md bg-orange-50 px-2 text-sm font-semibold text-orange-600">
                      {entry.daysSkipped}
                    </span>
                  </TableCell>
                  <TableCell>{getStatusBadge(entry.status)}</TableCell>
                  <TableCell>{getShippingBadge(entry.shippingStatus)}</TableCell>
                  <TableCell className="text-center pr-6">
                    <KitReportDownloadButton
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
        {history.map((entry) => (
          <Card
            key={entry.id}
            className="border border-slate-200 bg-white shadow-sm overflow-hidden transition-all duration-200 hover:shadow-md"
          >
            <CardContent className="p-0">
              {/* Card Header */}
              <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 bg-slate-50/50">
                <div className="flex items-center gap-2">
                  <Package className="h-4 w-4 text-primary" />
                  <span className="text-sm font-semibold text-slate-900">
                    {entry.kitProductName}
                  </span>
                </div>
                {getStatusBadge(entry.status)}
              </div>

              {/* Card Body */}
              <div className="p-4 space-y-4">
                {/* Stats Grid */}
                <div className="grid grid-cols-3 gap-3">
                  <div className="flex flex-col items-center p-3 rounded-lg bg-slate-50">
                    <CalendarDays className="h-4 w-4 text-slate-500 mb-1" />
                    <span className="text-lg font-semibold text-slate-900">
                      {entry.kitDays}
                    </span>
                    <span className="text-[10px] uppercase tracking-wider text-slate-500 font-medium">
                      Days
                    </span>
                  </div>
                  <div className="flex flex-col items-center p-3 rounded-lg bg-emerald-50">
                    <Utensils className="h-4 w-4 text-emerald-600 mb-1" />
                    <span className="text-lg font-semibold text-emerald-700">
                      {entry.daysTakenMeal}
                    </span>
                    <span className="text-[10px] uppercase tracking-wider text-emerald-600 font-medium">
                      Meals
                    </span>
                  </div>
                  <div className="flex flex-col items-center p-3 rounded-lg bg-orange-50">
                    <SkipForward className="h-4 w-4 text-orange-500 mb-1" />
                    <span className="text-lg font-semibold text-orange-600">
                      {entry.daysSkipped}
                    </span>
                    <span className="text-[10px] uppercase tracking-wider text-orange-500 font-medium">
                      Skipped
                    </span>
                  </div>
                </div>

                {/* Footer Details */}
                <div className="flex items-center justify-between pt-3 border-t border-slate-100">
                  <div className="space-y-1">
                    <p className="text-xs text-slate-500">
                      Ordered {formatDate(entry.orderDate)}
                    </p>
                    <div className="flex items-center gap-1.5">
                      <Truck className="h-3.5 w-3.5 text-slate-400" />
                      {getShippingBadge(entry.shippingStatus)}
                    </div>
                  </div>
                  <KitReportDownloadButton
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
