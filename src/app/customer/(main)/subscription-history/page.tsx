import { getCustomerSession } from "@/lib/customer/get-session";
import { redirect } from "next/navigation";
import { getMealSubscriptionHistoryAction } from "@/actions/mealSubscriptionHistoryActions";
import { SubscriptionHistoryTable } from "@/shared/components/customer/subscription-history/SubscriptionHistoryTable";
import { History, AlertCircle } from "lucide-react";

/**
 * Subscription History Page (Server Component)
 *
 * Lists all MEAL subscriptions for the authenticated customer and lets them
 * download a per-subscription Health Report (the dietitian-recorded health
 * log data for that subscription), mirroring the KIT History page.
 */

export const revalidate = 0;

export default async function SubscriptionHistoryPage() {
  const { user, error } = await getCustomerSession();
  if (error || !user) redirect("/login");

  const result = await getMealSubscriptionHistoryAction();

  if (!result.success) {
    return (
      <div className="relative z-10 max-w-5xl mx-auto">
        <div className="flex items-center justify-center min-h-[400px]">
          <div className="text-center space-y-3">
            <div className="h-12 w-12 mx-auto bg-red-50 rounded-full flex items-center justify-center">
              <AlertCircle className="h-6 w-6 text-red-500" />
            </div>
            <p className="text-lg font-semibold text-slate-900">
              Unable to load Subscription History
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
        <div className="rounded-full bg-emerald-50 p-2.5 text-emerald-600 shrink-0">
          <History className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-2xl sm:text-3xl font-semibold text-slate-900 tracking-tight">
            Subscription History
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            View all your meal subscriptions and download your health reports.
          </p>
        </div>
      </div>

      <SubscriptionHistoryTable subscriptions={result.subscriptions} />
    </div>
  );
}
