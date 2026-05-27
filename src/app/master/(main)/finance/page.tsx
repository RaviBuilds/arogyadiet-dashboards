import { AdminPageHeader } from "@/shared/components/admin/core/AdminPageHeader";
import FinanceDashboard from "@/shared/components/admin/finance/FinanceDashboard";
import {
  getFinanceOverview,
  getSubscriptionPayments,
  getAllRidersWithEarnings,
  getSystemSettings,
} from "@/actions/admin-actions/financeActions";

export const revalidate = 0;

export default async function MasterFinancePage() {
  const [overviewData, paymentsData, ridersData, settingsData] =
    await Promise.all([
      getFinanceOverview(),
      getSubscriptionPayments(),
      getAllRidersWithEarnings(),
      getSystemSettings(),
    ]);

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Finance"
        description="Manage subscription revenue, rider payouts, and system settings."
      />
      <FinanceDashboard
        overviewData={overviewData}
        paymentsData={paymentsData}
        ridersData={ridersData}
        settingsData={settingsData}
      />
    </div>
  );
}
