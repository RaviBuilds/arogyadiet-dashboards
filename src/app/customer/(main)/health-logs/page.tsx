import { redirect } from "next/navigation";

import { getCustomerSession } from "@/lib/customer/get-session";
import { getActiveStayAction } from "@/actions/stayActions";
import { getCustomerHealthLogsAction } from "@/actions/healthLogActions";
import { getISTDateString } from "@/lib/dates/ist";
import { HealthLogForm } from "@/shared/components/customer/health-logs/HealthLogForm";
import type { CustomerHealthLog } from "@/types/accommodation";

export const revalidate = 0;

export default async function HealthLogsPage() {
  const { user, customerProfileId, error } = await getCustomerSession();
  if (error || !user) redirect("/login");
  if (!customerProfileId) redirect("/dashboard?msg=health-logs-unavailable");

  // [Req 9.6] Only an ACTIVE stay enables health logging — a PENDING stay
  // (which getActiveStayAction falls back to) does not count.
  const activeStayResult = await getActiveStayAction(customerProfileId);
  const activeStay =
    "data" in activeStayResult && activeStayResult.data?.status === "ACTIVE"
      ? activeStayResult.data
      : null;

  let logs: CustomerHealthLog[] = [];
  if (activeStay) {
    const logsResult = await getCustomerHealthLogsAction(activeStay.id);
    if ("data" in logsResult) {
      logs = logsResult.data.map((row) => ({
        id: row.id,
        stayEntryId: row.stay_entry_id,
        logDate: row.log_date,
        waterIntakeLiters: row.water_intake_liters,
        activityName: row.activity_name,
        activityDurationMinutes: row.activity_duration_minutes,
        createdAt: row.created_at,
      }));
    }
  }

  const todayIST = getISTDateString();

  return (
    <div className="mx-auto w-full max-w-3xl p-4 md:p-6 space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">My Health Logs</h1>
        <p className="text-sm text-muted-foreground">
          Log your daily water intake and physical activity during your stay.
        </p>
      </div>

      <HealthLogForm
        hasActiveStay={!!activeStay}
        todayIST={todayIST}
        initialLogs={logs}
      />
    </div>
  );
}
