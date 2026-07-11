/**
 * StayHistoryTable
 *
 * Displays the accommodation customer's past stays (FINISHED/EXPIRED)
 * in a responsive layout.
 * Desktop: Card-wrapped table.
 * Mobile (<768px): Stacked cards.
 *
 * Requirements: 8.3, 8.4
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
import { BedDouble, CalendarDays, Moon } from "lucide-react";
import type { StayEntry } from "@/types/accommodation";

interface StayHistoryTableProps {
  stays: StayEntry[];
}

/**
 * Returns badge styling based on stay status.
 * Only FINISHED and EXPIRED are expected here.
 */
function getStatusBadge(status: StayEntry["status"]) {
  switch (status) {
    case "FINISHED":
      return (
        <Badge
          variant="outline"
          className="rounded-full border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-emerald-700"
        >
          Finished
        </Badge>
      );
    case "EXPIRED":
      return (
        <Badge
          variant="outline"
          className="rounded-full border-rose-200 bg-rose-50 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-rose-600"
        >
          Expired
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

function formatDate(dateString: string): string {
  try {
    return format(new Date(dateString), "dd MMM yyyy");
  } catch {
    return dateString;
  }
}

export function StayHistoryTable({ stays }: StayHistoryTableProps) {
  if (stays.length === 0) {
    return (
      <Card className="border border-dashed border-slate-200 bg-white shadow-sm">
        <CardContent className="flex flex-col items-center justify-center min-h-[300px] py-16">
          <div className="h-16 w-16 bg-slate-100 rounded-full flex items-center justify-center mb-4">
            <BedDouble className="h-8 w-8 text-slate-400" />
          </div>
          <p className="text-lg font-semibold text-slate-900 tracking-tight">
            No Past Stays
          </p>
          <p className="text-sm text-slate-500 mt-1 text-center max-w-sm">
            No past stay records are available yet.
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
                  Stay Type
                </TableHead>
                <TableHead className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Occupancy
                </TableHead>
                <TableHead className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Start Date
                </TableHead>
                <TableHead className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                  End Date
                </TableHead>
                <TableHead className="text-center text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Nights
                </TableHead>
                <TableHead className="text-xs font-semibold uppercase tracking-wider text-slate-500 pr-6">
                  Status
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {stays.map((stay) => (
                <TableRow
                  key={stay.id}
                  className="group transition-colors hover:bg-slate-50/50"
                >
                  <TableCell className="pl-6 font-semibold text-slate-900">
                    {stay.stayType}
                  </TableCell>
                  <TableCell className="text-sm text-slate-700">
                    {stay.occupancyType}
                  </TableCell>
                  <TableCell className="text-sm text-slate-700">
                    {formatDate(stay.startDate)}
                  </TableCell>
                  <TableCell className="text-sm text-slate-700">
                    {formatDate(stay.endDate)}
                  </TableCell>
                  <TableCell className="text-center">
                    <span className="inline-flex items-center justify-center h-7 min-w-[28px] rounded-md bg-slate-100 px-2 text-sm font-semibold text-slate-700">
                      {stay.totalNights}
                    </span>
                  </TableCell>
                  <TableCell className="pr-6">{getStatusBadge(stay.status)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      </div>

      {/* Mobile Cards — visible only below md breakpoint */}
      <div className="md:hidden space-y-4">
        {stays.map((stay) => (
          <Card
            key={stay.id}
            className="border border-slate-200 bg-white shadow-sm overflow-hidden transition-all duration-200 hover:shadow-md"
          >
            <CardContent className="p-0">
              {/* Card Header */}
              <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 bg-slate-50/50">
                <div className="flex items-center gap-2">
                  <BedDouble className="h-4 w-4 text-primary" />
                  <span className="text-sm font-semibold text-slate-900">
                    {stay.stayType}
                  </span>
                </div>
                {getStatusBadge(stay.status)}
              </div>

              {/* Card Body */}
              <div className="p-4 space-y-4">
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-slate-500 font-medium">
                      Occupancy
                    </p>
                    <p className="text-slate-900 font-medium">{stay.occupancyType}</p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-slate-500 font-medium">
                      Nights
                    </p>
                    <p className="text-slate-900 font-medium flex items-center gap-1">
                      <Moon className="h-3.5 w-3.5 text-slate-400" />
                      {stay.totalNights}
                    </p>
                  </div>
                </div>

                <div className="flex items-center justify-between pt-3 border-t border-slate-100 text-xs text-slate-500">
                  <span className="flex items-center gap-1.5">
                    <CalendarDays className="h-3.5 w-3.5 text-slate-400" />
                    {formatDate(stay.startDate)} &rarr; {formatDate(stay.endDate)}
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </>
  );
}
