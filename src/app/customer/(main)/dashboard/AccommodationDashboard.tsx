import Link from "next/link";
import { format, parseISO, differenceInCalendarDays } from "date-fns";
import {
  BedDouble,
  CalendarDays,
  Users,
  ArrowRight,
  Droplet,
  FileText,
  Sparkles,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/shared/components/ui/card";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import type { StayEntry, StayStatus } from "@/types/accommodation";

/**
 * ACCOMMODATION-specific customer dashboard component.
 *
 * Mirrors the KitDashboard pattern: displays the customer's active/pending
 * stay summary (stay type, occupancy, dates, progress) and quick links to
 * the dedicated accommodation pages (Stay Tracker, Health Logs, Health
 * Report, Add-on Services) instead of the generic meal dashboard.
 *
 * Requirements: 8.1, 8.2
 */

const STATUS_BADGE_STYLES: Record<StayStatus, string> = {
  PENDING: "border-amber-200 bg-amber-50 text-amber-700",
  ACTIVE: "border-emerald-200 bg-emerald-50 text-emerald-700",
  FINISHED: "border-slate-200 bg-slate-50 text-slate-700",
  EXPIRED: "border-red-200 bg-red-50 text-red-700",
};

interface AccommodationDashboardProps {
  stay: StayEntry | null;
}

export function AccommodationDashboard({ stay }: AccommodationDashboardProps) {
  if (!stay) {
    return (
      <div className="relative z-10 max-w-4xl mx-auto mt-1 animate-in fade-in slide-in-from-bottom-4">
        <Card className="border border-dashed border-slate-200 bg-white shadow-sm text-center py-16">
          <CardContent className="flex flex-col items-center space-y-4">
            <div className="h-20 w-20 bg-slate-100 rounded-full flex items-center justify-center mb-4">
              <BedDouble className="h-10 w-10 text-slate-400" />
            </div>
            <h2 className="text-xl font-semibold text-slate-900 tracking-tight">
              No Upcoming or Active Stay
            </h2>
            <p className="text-sm text-slate-500 max-w-md mx-auto">
              You don&apos;t have an upcoming or active stay yet. Please
              contact our team to arrange your accommodation booking.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const today = new Date();
  const endDate = parseISO(stay.endDate);
  const startDate = parseISO(stay.startDate);
  const remainingNights = Math.max(0, differenceInCalendarDays(endDate, today));
  const currentDay = Math.min(
    stay.totalNights,
    Math.max(1, stay.totalNights - remainingNights),
  );
  const progressPercent = Math.min(
    100,
    Math.round((currentDay / stay.totalNights) * 100),
  );

  return (
    <div className="relative z-10 max-w-5xl mx-auto space-y-6">
      {/* Header Section */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-semibold text-slate-900 tracking-tight">
            My Stay
          </h1>
          <p className="text-sm text-slate-500 mt-1 flex items-center gap-2">
            <BedDouble className="h-4 w-4 text-emerald-600" /> {stay.stayType} ·{" "}
            {stay.occupancyType} Occupancy
          </p>
        </div>
        <Badge
          variant="outline"
          className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wider ${STATUS_BADGE_STYLES[stay.status]}`}
        >
          {stay.status}
        </Badge>
      </div>

      {/* Stay Summary Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card className="border border-slate-200 bg-white shadow-sm">
          <CardHeader className="border-b border-slate-100 bg-slate-50/50 px-6 py-4">
            <CardTitle className="text-base font-semibold text-slate-900 flex items-center gap-2">
              <CalendarDays className="h-5 w-5 text-primary" />
              Stay Timeline
            </CardTitle>
          </CardHeader>
          <CardContent className="p-6 space-y-4">
            <div className="flex justify-between items-end gap-6">
              <div className="space-y-1">
                <p className="text-xs font-medium uppercase tracking-wider text-slate-500">
                  Start Date
                </p>
                <p className="font-semibold text-slate-900">
                  {format(startDate, "MMM do, yyyy")}
                </p>
              </div>
              <div className="space-y-1 text-right">
                <p className="text-xs font-medium uppercase tracking-wider text-slate-500">
                  End Date
                </p>
                <p className="font-semibold text-slate-900">
                  {format(endDate, "MMM do, yyyy")}
                </p>
              </div>
            </div>

            {stay.status === "ACTIVE" && (
              <div className="pt-4 border-t border-slate-100">
                <div className="flex justify-between items-center mb-2 text-sm">
                  <span className="text-slate-600">
                    Day {currentDay} of {stay.totalNights}
                  </span>
                  <span className="font-medium text-slate-900">
                    {remainingNights} nights left
                  </span>
                </div>
                <div
                  className="w-full h-2.5 bg-slate-100 rounded-full overflow-hidden"
                  role="progressbar"
                  aria-valuenow={progressPercent}
                  aria-valuemin={0}
                  aria-valuemax={100}
                >
                  <div
                    className="h-full rounded-full bg-emerald-500 transition-all duration-500"
                    style={{ width: `${progressPercent}%` }}
                  />
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="border border-slate-200 bg-white shadow-sm">
          <CardHeader className="border-b border-slate-100 bg-slate-50/50 px-6 py-4">
            <CardTitle className="text-base font-semibold text-slate-900 flex items-center gap-2">
              <Users className="h-5 w-5 text-primary" />
              Stay Details
            </CardTitle>
          </CardHeader>
          <CardContent className="p-6 space-y-3">
            <div className="flex justify-between items-center">
              <span className="text-sm text-slate-600">Stay Type</span>
              <span className="font-semibold text-slate-900">{stay.stayType}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm text-slate-600">Occupancy</span>
              <span className="font-semibold text-slate-900">
                {stay.occupancyType}
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm text-slate-600">Meal Preference</span>
              <span className="font-semibold text-slate-900">
                {stay.mealPreference}
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm text-slate-600">Total Nights</span>
              <span className="font-semibold text-slate-900">
                {stay.totalNights}
              </span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Quick Links */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <Link href="/health-logs" className="block">
          <Card className="border border-slate-200 bg-white shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all duration-200 h-full">
            <CardContent className="p-5 flex items-center gap-3">
              <div className="rounded-full bg-blue-100 p-2.5 text-blue-600 shrink-0">
                <Droplet className="h-5 w-5" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-slate-900">
                  My Health Logs
                </p>
                <p className="text-xs text-slate-500">Log daily activity</p>
              </div>
              <ArrowRight className="h-4 w-4 text-slate-400 shrink-0" />
            </CardContent>
          </Card>
        </Link>

        <Link href="/health-report" className="block">
          <Card className="border border-slate-200 bg-white shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all duration-200 h-full">
            <CardContent className="p-5 flex items-center gap-3">
              <div className="rounded-full bg-purple-100 p-2.5 text-purple-600 shrink-0">
                <FileText className="h-5 w-5" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-slate-900">
                  Health Report
                </p>
                <p className="text-xs text-slate-500">View checkup data</p>
              </div>
              <ArrowRight className="h-4 w-4 text-slate-400 shrink-0" />
            </CardContent>
          </Card>
        </Link>

        <Link href="/addon-services" className="block">
          <Card className="border border-slate-200 bg-white shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all duration-200 h-full">
            <CardContent className="p-5 flex items-center gap-3">
              <div className="rounded-full bg-amber-100 p-2.5 text-amber-600 shrink-0">
                <Sparkles className="h-5 w-5" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-slate-900">
                  Add-on Services
                </p>
                <p className="text-xs text-slate-500">Request wellness services</p>
              </div>
              <ArrowRight className="h-4 w-4 text-slate-400 shrink-0" />
            </CardContent>
          </Card>
        </Link>
      </div>

      <div className="flex justify-center">
        <Button asChild variant="outline" size="lg" className="min-h-11">
          <Link href="/stay-tracker">
            View Full Stay Tracker <ArrowRight className="ml-2 h-4 w-4" />
          </Link>
        </Button>
      </div>
    </div>
  );
}
