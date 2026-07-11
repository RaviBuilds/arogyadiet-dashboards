import { getCustomerSession } from "@/lib/customer/get-session";
import { redirect } from "next/navigation";
import { format, parseISO } from "date-fns";
import { HeartPulse, AlertCircle } from "lucide-react";

import { getActiveStayAction, getStayHistoryAction } from "@/actions/stayActions";
import { getAdminHealthLogsAction } from "@/actions/healthLogActions";
import type { AdminHealthLogRow } from "@/repositories/healthLogRepository";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/components/ui/card";

/**
 * Health Report Page (Server Component)
 *
 * Displays admin-entered health data (weight, BP, sugar level, notes) for the
 * customer's active stay in a read-only, chronologically ascending format.
 * Falls back to the most recent FINISHED stay when no active stay exists.
 *
 * Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 15.4
 */

export const revalidate = 0;

export default async function HealthReportPage() {
  const { user, customerProfileId, error } = await getCustomerSession();
  if (error || !user) redirect("/login");

  if (!customerProfileId) {
    return (
      <ErrorState message="Unable to load your customer profile. Please try again." />
    );
  }

  // Resolve the relevant stay: active/pending first, else most recent FINISHED
  const activeResult = await getActiveStayAction(customerProfileId);
  if ("error" in activeResult) {
    return <ErrorState message={activeResult.error} />;
  }

  let stayId: string | null = null;
  let stayIsActive = false;

  if (activeResult.data && activeResult.data.status === "ACTIVE") {
    stayId = activeResult.data.id;
    stayIsActive = true;
  } else {
    // No ACTIVE stay (may have a PENDING one, which doesn't count) — fall back
    // to the most recent FINISHED stay (Req 10.5)
    const historyResult = await getStayHistoryAction(customerProfileId);
    if ("error" in historyResult) {
      return <ErrorState message={historyResult.error} />;
    }

    const finishedStays = historyResult.data
      .filter((stay) => stay.status === "FINISHED")
      .sort((a, b) => (a.startDate < b.startDate ? 1 : -1));

    if (finishedStays.length > 0) {
      stayId = finishedStays[0].id;
    }
  }

  if (!stayId) {
    return (
      <PageShell>
        <EmptyState message="No stay records exist." />
      </PageShell>
    );
  }

  const logsResult = await getAdminHealthLogsAction(stayId);
  if ("error" in logsResult) {
    return <ErrorState message={logsResult.error} />;
  }

  const logs = logsResult.data;

  return (
    <PageShell>
      {!stayIsActive && (
        <p className="text-sm text-slate-500">
          Showing health data from your most recent completed stay.
        </p>
      )}
      {logs.length === 0 ? (
        <EmptyState message="No health records available yet." />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {logs.map((log) => (
            <HealthLogCard key={log.id} log={log} />
          ))}
        </div>
      )}
    </PageShell>
  );
}

// ---------------------------------------------------------------------------
// Presentational helpers
// ---------------------------------------------------------------------------

function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative z-10 max-w-5xl mx-auto space-y-6">
      <div className="flex items-start gap-3">
        <div className="rounded-full bg-primary/10 p-2.5 text-primary shrink-0">
          <HeartPulse className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-2xl sm:text-3xl font-semibold text-slate-900 tracking-tight">
            Health Report
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Health metrics recorded by our wellness team during your stay.
          </p>
        </div>
      </div>
      {children}
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex items-center justify-center min-h-[300px]">
      <div className="text-center space-y-2">
        <p className="text-base font-medium text-slate-600">{message}</p>
      </div>
    </div>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <div className="relative z-10 max-w-5xl mx-auto">
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center space-y-3">
          <div className="h-12 w-12 mx-auto bg-red-50 rounded-full flex items-center justify-center">
            <AlertCircle className="h-6 w-6 text-red-500" />
          </div>
          <p className="text-lg font-semibold text-slate-900">
            Unable to load Health Report
          </p>
          <p className="text-sm text-slate-500 max-w-sm">{message}</p>
        </div>
      </div>
    </div>
  );
}

type Metric = { label: string; value: string };

function buildMetrics(log: AdminHealthLogRow): Metric[] {
  const metrics: Metric[] = [];

  if (log.weight_kg !== null) {
    metrics.push({ label: "Weight", value: `${log.weight_kg} kg` });
  }

  if (log.bp_systolic !== null && log.bp_diastolic !== null) {
    metrics.push({
      label: "Blood Pressure",
      value: `${log.bp_systolic}/${log.bp_diastolic} mmHg`,
    });
  } else if (log.bp_systolic !== null) {
    metrics.push({ label: "BP Systolic", value: `${log.bp_systolic} mmHg` });
  } else if (log.bp_diastolic !== null) {
    metrics.push({ label: "BP Diastolic", value: `${log.bp_diastolic} mmHg` });
  }

  if (log.sugar_level_mgdl !== null) {
    metrics.push({ label: "Sugar Level", value: `${log.sugar_level_mgdl} mg/dL` });
  }

  if (log.notes) {
    metrics.push({ label: "Notes", value: log.notes });
  }

  return metrics;
}

function HealthLogCard({ log }: { log: AdminHealthLogRow }) {
  const metrics = buildMetrics(log);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm text-slate-500">
          {format(parseISO(log.log_date), "MMM d, yyyy")}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {metrics.length === 0 ? (
          <p className="text-sm text-slate-500">No metrics recorded for this date.</p>
        ) : (
          <dl className="space-y-2">
            {metrics.map((metric) => (
              <div key={metric.label} className="flex items-baseline justify-between gap-2">
                <dt className="text-xs text-slate-500">{metric.label}</dt>
                <dd className="text-sm font-medium text-slate-900 text-right">
                  {metric.value}
                </dd>
              </div>
            ))}
          </dl>
        )}
      </CardContent>
    </Card>
  );
}
