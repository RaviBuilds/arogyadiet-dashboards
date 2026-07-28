import { getCustomerSession } from "@/lib/customer/get-session";
import { redirect } from "next/navigation";
import { getKitHistoryAction } from "@/actions/kitLifecycleActions";
import { KitHistoryTable } from "@/shared/components/customer/kit-history/KitHistoryTable";
import { History, AlertCircle } from "lucide-react";

/**
 * KIT History Page (Server Component)
 *
 * Displays all KIT subscriptions for the authenticated customer
 * in a table (desktop) or cards (mobile) layout.
 *
 * Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 8.8
 */

export const revalidate = 0;

export default async function KitHistoryPage() {
  const { user, error } = await getCustomerSession();
  if (error || !user) redirect("/login");

  const result = await getKitHistoryAction();

  if (!result.success) {
    return (
      <div className="relative z-10 max-w-5xl mx-auto">
        <div className="flex items-center justify-center min-h-[400px]">
          <div className="text-center space-y-3">
            <div className="h-12 w-12 mx-auto bg-red-50 rounded-full flex items-center justify-center">
              <AlertCircle className="h-6 w-6 text-red-500" />
            </div>
            <p className="text-lg font-semibold text-slate-900">
              Unable to load KIT History
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
            KIT History
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            View all your KIT subscriptions and download reports.
          </p>
        </div>
      </div>

      <KitHistoryTable history={result.history} />
    </div>
  );
}
