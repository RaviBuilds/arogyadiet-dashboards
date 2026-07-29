import { redirect } from "next/navigation";
import Link from "next/link";
import { AlertCircle, ArrowRight, BedDouble, HeartPulse } from "lucide-react";

import { getCustomerSession } from "@/lib/customer/get-session";
import { getCustomerHealthReportAction } from "@/actions/customerHealthReportActions";
import { HealthReportDayList } from "@/shared/components/customer/health-report/HealthReportDayList";
import { HealthReportHero } from "@/shared/components/customer/health-report/HealthReportHero";
import { StayHealthReportDownloadButton } from "@/shared/components/customer/health-report/StayHealthReportDownloadButton";
import { formatDisplayDate } from "@/shared/components/customer/health-report/healthReportDisplay";

/**
 * Health Report Page (Server Component)
 *
 * The day-wise view of the health measurements the wellness team recorded during
 * the customer's stay: a hero in the dashboard's visual family, a vitals band with
 * trend sparklines, one expandable card per logged day, and a PDF download.
 *
 * Data comes from `getCustomerHealthReportAction`, which reads Dietitian_Logs from
 * `health_logs` scoped to the stay's date window — the same window the PDF uses,
 * so the page and the download always agree.
 *
 * Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 15.4
 */

export const revalidate = 0;

export default async function HealthReportPage() {
  const { user, error } = await getCustomerSession();
  if (error || !user) redirect("/login");

  const result = await getCustomerHealthReportAction();

  if ("error" in result) {
    return <ErrorState message={result.error} />;
  }

  const report = result.data;

  if (!report) {
    return <NoStayState />;
  }

  const { stay, days, dietitianName } = report;
  const stayTypeLabel =
    [stay.stayType, stay.occupancyType].filter(Boolean).join(" · ") ||
    "Accommodation stay";

  return (
    <div className="relative z-10 mx-auto max-w-5xl space-y-6 sm:space-y-8">
      <HealthReportHero
        stayRangeLabel={`${formatDisplayDate(stay.startDate)} — ${formatDisplayDate(stay.endDate)}`}
        stayTypeLabel={stayTypeLabel}
        totalNights={stay.totalNights}
        daysRecorded={days.length}
        dietitianName={dietitianName}
        isActive={stay.isActive}
        action={
          <StayHealthReportDownloadButton
            stayId={stay.id}
            hasRecords={days.length > 0}
            dayCount={days.length}
          />
        }
      />

      {days.length === 0 ? (
        <NoRecordsState />
      ) : (
        <HealthReportDayList
          days={days}
          dietitianName={dietitianName}
          totalNights={stay.totalNights}
          isActive={stay.isActive}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// States
// ---------------------------------------------------------------------------

/** No readings yet, but the stay exists — keeps the hero and reassures. */
function NoRecordsState() {
  return (
    <div
      className="reveal-rise relative overflow-hidden rounded-3xl border border-dashed border-slate-200 bg-white text-center shadow-sm"
      style={{ ["--reveal-delay" as string]: "300ms" }}
    >
      <div className="pointer-events-none absolute -top-16 left-1/2 h-56 w-56 -translate-x-1/2 rounded-full bg-emerald-100/60 blur-3xl" />
      <div className="relative flex flex-col items-center gap-3 px-6 py-14 sm:px-10">
        <div className="mb-1 flex h-20 w-20 items-center justify-center rounded-full bg-emerald-50 text-emerald-500">
          <HeartPulse className="h-10 w-10" aria-hidden="true" />
        </div>
        <h2 className="text-xl font-semibold tracking-tight text-slate-900">
          No readings recorded yet
        </h2>
        <p className="max-w-md text-sm leading-relaxed text-slate-500">
          Your wellness team records your measurements during your stay. As soon as
          the first check-in happens, your day-wise report will appear right here.
        </p>
        <Link
          href="/stay-tracker"
          className="group mt-3 inline-flex w-fit items-center justify-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground shadow-sm transition-all duration-200 hover:shadow-md hover:brightness-105 active:scale-[0.98]"
        >
          Open Stay Tracker
          <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5" />
        </Link>
      </div>
    </div>
  );
}

/** No stay on record at all. */
function NoStayState() {
  return (
    <div className="relative z-10 mx-auto max-w-4xl">
      <div
        className="reveal-rise relative overflow-hidden rounded-3xl border border-dashed border-slate-200 bg-white text-center shadow-sm"
        style={{ ["--reveal-delay" as string]: "150ms" }}
      >
        <div className="pointer-events-none absolute -top-16 left-1/2 h-56 w-56 -translate-x-1/2 rounded-full bg-emerald-100/60 blur-3xl" />
        <div className="relative flex flex-col items-center gap-3 px-6 py-16 sm:px-10">
          <div className="mb-1 flex h-20 w-20 items-center justify-center rounded-full bg-emerald-50 text-emerald-500">
            <BedDouble className="h-10 w-10" aria-hidden="true" />
          </div>
          <h2 className="text-xl font-semibold tracking-tight text-slate-900">
            No stay records yet
          </h2>
          <p className="max-w-md text-sm leading-relaxed text-slate-500">
            Your health report opens up once your stay begins. Everything your
            wellness team records will be collected here, day by day.
          </p>
          <Link
            href="/dashboard"
            className="group mt-3 inline-flex w-fit items-center justify-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground shadow-sm transition-all duration-200 hover:shadow-md hover:brightness-105 active:scale-[0.98]"
          >
            Back to dashboard
            <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5" />
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <div className="relative z-10 mx-auto max-w-5xl">
      <div className="flex min-h-[400px] items-center justify-center">
        <div className="space-y-3 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-red-50">
            <AlertCircle className="h-6 w-6 text-red-500" aria-hidden="true" />
          </div>
          <p className="text-lg font-semibold text-slate-900">
            Unable to load Health Report
          </p>
          <p className="max-w-sm text-sm text-slate-500">{message}</p>
        </div>
      </div>
    </div>
  );
}
