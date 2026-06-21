import { AdminPageHeader } from "@/shared/components/admin/core/AdminPageHeader";
import { BackToSystem } from "@/shared/components/master/BackToSystem";
import {
  getMasterCustomerKPIs,
  getMasterCustomerList,
} from "@/actions/master-actions/customerReportActions";
import CustomersClient from "./CustomersClient";

export const revalidate = 0;

export default async function MasterCustomersPage() {
  const [kpis, customers] = await Promise.all([
    getMasterCustomerKPIs(),
    getMasterCustomerList(),
  ]);

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Customers"
        description="Deep-dive customer registry with lifetime value tracking and exportable chronological reports."
        action={<BackToSystem />}
      />
      <CustomersClient kpis={kpis} customers={customers} />
    </div>
  );
}
