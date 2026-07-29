import { getCustomerSession } from "@/lib/customer/get-session";
import { redirect } from "next/navigation";
import { getStayHistoryAction } from "@/actions/stayActions";
import { getStayRecordedDayCountsAction } from "@/actions/customerHealthReportActions";
import { StayHistoryTable } from "@/shared/components/customer/stay-history/StayHistoryTable";
import { History, AlertCircle } from "lucide-react";

/**
 * Stay History Page (Server Component)
 *
 * Displays all FINISHED/EXPIRED stay entries for the authenticated
 * accommodation customer in reverse chronological order.
 *
 * Requirements: 8.3, 8.4
 */

export const revalidate = 0;

export default async function StayHistoryPage() {
  const { user, error, customerProfileId } = await getCustomerSession();
  if (error || !user) redirect("/login");

  if (!customerProfileId) {
    return (
      <div className="relative z-10 max-w-5xl mx-auto">
        <div className="flex items-center justify-center min-h-[400px]">
          <div className="text-center space-y-3">
            <div className="h-12 w-12 mx-auto bg-red-50 rounded-full flex items-center justify-center">
              <AlertCircle className="h-6 w-6 text-red-500" />
            </div>
            <p className="text-lg font-semibold text-slate-900">
              Unable to load Stay History
            </p>
            <p className="text-sm text-slate-500 max-w-sm">
              Customer profile could not be found.
            </p>
          </div>
        </div>
      </div>
    );
  }

  // The recorded-day counts decide which stays offer a Health Report download.
  // A failure there must not take the history list down with it — the column
  // simply falls back to "No readings".
  const [result, recordedDaysResult] = await Promise.all([
    getStayHistoryAction(customerProfileId),
    getStayRecordedDayCountsAction(),
  ]);

  const recordedDays =
    "success" in recordedDaysResult ? recordedDaysResult.data : {};

  if ("error" in result) {
    return (
      <div className="relative z-10 max-w-5xl mx-auto">
        <div className="flex items-center justify-center min-h-[400px]">
          <div className="text-center space-y-3">
            <div className="h-12 w-12 mx-auto bg-red-50 rounded-full flex items-center justify-center">
              <AlertCircle className="h-6 w-6 text-red-500" />
            </div>
            <p className="text-lg font-semibold text-slate-900">
              Unable to load Stay History
            </p>
            <p className="text-sm text-slate-500 max-w-sm">{result.error}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="relative z-10 max-w-5xl mx-auto space-y-6">
      {/* Page Header */}
      <div className="flex items-start gap-3">
        <div className="rounded-full bg-primary/10 p-2.5 text-primary shrink-0">
          <History className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-2xl sm:text-3xl font-semibold text-slate-900 tracking-tight">
            Stay History
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            View all your past stays at ArogyaDiet, and download the health report
            for each one.
          </p>
        </div>
      </div>

      <StayHistoryTable stays={result.data} recordedDays={recordedDays} />
    </div>
  );
}
