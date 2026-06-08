import ExecutiveDashboard from "@/shared/components/admin/dashboard/ExecutiveDashboard";
import { AdminPageHeader } from "@/shared/components/admin/core/AdminPageHeader";
import { getExecutiveSummary } from "@/services/dashboardMetrics";

export const revalidate = 0;

export default async function AdminDashboardPage() {
  const summary = await getExecutiveSummary();

  return (
    <div className="flex animate-in fade-in flex-col gap-6 pb-2 duration-500">
      <AdminPageHeader
        title="Executive Overview"
        description="Real-time pulse across customers, subscriptions, operations, and inventory."
      />
      <ExecutiveDashboard data={summary} />
    </div>
  );
}
