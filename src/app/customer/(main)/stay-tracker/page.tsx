import { getCustomerSession } from "@/lib/customer/get-session";
import { redirect } from "next/navigation";
import { differenceInCalendarDays, format, parseISO } from "date-fns";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/shared/components/ui/card";
import { Badge } from "@/shared/components/ui/badge";
import { getActiveStayAction } from "@/actions/stayActions";
import {
  BedDouble,
  Calendar,
  CalendarClock,
  Home,
  Users,
} from "lucide-react";
import type { StayStatus } from "@/types/accommodation";

/**
 * Stay Tracker Page (Server Component)
 *
 * Displays the customer's active stay (or earliest pending stay if no
 * active stay exists) — stay type, occupancy, dates, remaining nights,
 * status, and a progress indicator (current day / total nights).
 *
 * Requirements: 8.1, 8.2, 15.4
 */

export const revalidate = 0;

const STATUS_BADGE_STYLES: Record<StayStatus, string> = {
  PENDING: "border-amber-200 bg-amber-50 text-amber-700",
  ACTIVE: "border-emerald-200 bg-emerald-50 text-emerald-700",
  FINISHED: "border-slate-200 bg-slate-100 text-slate-600",
  EXPIRED: "border-red-200 bg-red-50 text-red-700",
};

export default async function StayTrackerPage() {
  const { user, customerProfileId, error } = await getCustomerSession();
  if (error || !user) redirect("/login");

  if (!customerProfileId) {
    return <EmptyState />;
  }

  const result = await getActiveStayAction(customerProfileId);

  if ("error" in result) {
    return (
      <div className="relative z-10 max-w-5xl mx-auto">
        <div className="flex items-center justify-center min-h-[400px]">
          <div className="text-center space-y-3">
            <div className="h-12 w-12 mx-auto bg-red-50 rounded-full flex items-center justify-center">
              <CalendarClock className="h-6 w-6 text-red-500" />
            </div>
            <p className="text-lg font-semibold text-slate-900">
              Unable to load Stay Tracker
            </p>
            <p className="text-sm text-slate-500 max-w-sm">{result.error}</p>
          </div>
        </div>
      </div>
    );
  }

  const stay = result.data;

  if (!stay) {
    return <EmptyState />;
  }

  const today = new Date();
  const startDate = parseISO(stay.startDate);
  const endDate = parseISO(stay.endDate);

  // Current day number within the stay (1-indexed), clamped to [1, totalNights].
  const rawCurrentDay = differenceInCalendarDays(today, startDate) + 1;
  const currentDay = Math.min(Math.max(rawCurrentDay, 1), stay.totalNights);

  // Remaining nights = end date - current date, floored at 0.
  const remainingNights = Math.max(
    differenceInCalendarDays(endDate, today),
    0
  );

  const progressPercent = Math.min(
    Math.max((currentDay / stay.totalNights) * 100, 0),
    100
  );

  const isPending = stay.status === "PENDING";

  return (
    <div className="relative z-10 max-w-5xl mx-auto space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="rounded-full bg-primary/10 p-2.5 text-primary shrink-0">
            <BedDouble className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-2xl sm:text-3xl font-semibold text-slate-900 tracking-tight">
              Stay Tracker
            </h1>
            <p className="text-sm text-slate-500 mt-1">
              {isPending
                ? "Your upcoming stay details."
                : "Your current stay at a glance."}
            </p>
          </div>
        </div>
        <Badge
          variant="outline"
          className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wider ${
            STATUS_BADGE_STYLES[stay.status] ?? STATUS_BADGE_STYLES.PENDING
          }`}
        >
          {stay.status}
        </Badge>
      </div>

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Stay Details Card */}
        <Card className="border border-slate-200 bg-white shadow-sm">
          <CardHeader className="border-b border-slate-100 bg-slate-50/50 px-6 py-4">
            <CardTitle className="text-base font-semibold text-slate-900 flex items-center gap-2">
              <Home className="h-5 w-5 text-primary" />
              Stay Details
            </CardTitle>
          </CardHeader>
          <CardContent className="p-6 space-y-4">
            <div className="flex justify-between items-center">
              <span className="text-sm text-slate-600">Stay Type</span>
              <span className="font-semibold text-slate-900">
                {stay.stayType}
              </span>
            </div>
            <div className="flex justify-between items-center pt-4 border-t border-slate-100">
              <span className="text-sm text-slate-600 flex items-center gap-1.5">
                <Users className="h-4 w-4 text-slate-400" />
                Occupancy
              </span>
              <span className="font-semibold text-slate-900">
                {stay.occupancyType}
              </span>
            </div>
            <div className="flex justify-between items-center pt-4 border-t border-slate-100">
              <span className="text-sm text-slate-600">Total Nights</span>
              <span className="font-semibold text-slate-900">
                {stay.totalNights}
              </span>
            </div>
          </CardContent>
        </Card>

        {/* Dates & Progress Card */}
        <Card className="border border-slate-200 bg-white shadow-sm">
          <CardHeader className="border-b border-slate-100 bg-slate-50/50 px-6 py-4">
            <CardTitle className="text-base font-semibold text-slate-900 flex items-center gap-2">
              <Calendar className="h-5 w-5 text-primary" />
              Dates
            </CardTitle>
          </CardHeader>
          <CardContent className="p-6 space-y-4">
            <div className="flex justify-between items-center">
              <span className="text-sm text-slate-600">Start Date</span>
              <span className="font-semibold text-slate-900">
                {format(startDate, "MMM do, yyyy")}
              </span>
            </div>
            <div className="flex justify-between items-center pt-4 border-t border-slate-100">
              <span className="text-sm text-slate-600">End Date</span>
              <span className="font-semibold text-slate-900">
                {format(endDate, "MMM do, yyyy")}
              </span>
            </div>
            <div className="flex justify-between items-center pt-4 border-t border-slate-100">
              <span className="text-sm text-slate-600">Remaining Nights</span>
              <span className="text-lg font-bold text-slate-900">
                {remainingNights}
              </span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Progress Card */}
      <Card className="border border-slate-200 bg-white shadow-sm">
        <CardHeader className="border-b border-slate-100 bg-slate-50/50 px-6 py-4">
          <CardTitle className="text-base font-semibold text-slate-900 flex items-center gap-2">
            <CalendarClock className="h-5 w-5 text-primary" />
            Progress
          </CardTitle>
        </CardHeader>
        <CardContent className="p-6 space-y-3">
          <div className="flex justify-between items-baseline">
            <span className="text-sm text-slate-600">
              {isPending
                ? "Stay has not started yet"
                : `Day ${currentDay} of ${stay.totalNights}`}
            </span>
            <span className="text-sm font-semibold text-slate-900">
              {Math.round(progressPercent)}%
            </span>
          </div>
          <div
            className="h-2.5 w-full rounded-full bg-slate-100 overflow-hidden"
            role="progressbar"
            aria-valuenow={Math.round(progressPercent)}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`Stay progress: day ${currentDay} of ${stay.totalNights}`}
          >
            <div
              className="h-full rounded-full bg-primary transition-all"
              style={{ width: `${isPending ? 0 : progressPercent}%` }}
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="relative z-10 max-w-5xl mx-auto">
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center space-y-3">
          <div className="h-12 w-12 mx-auto bg-slate-100 rounded-full flex items-center justify-center">
            <BedDouble className="h-6 w-6 text-slate-400" />
          </div>
          <p className="text-lg font-semibold text-slate-900">
            No upcoming or active stay found
          </p>
          <p className="text-sm text-slate-500 max-w-sm">
            Once a stay is booked for you, it will show up here with all the
            details you need.
          </p>
        </div>
      </div>
    </div>
  );
}
