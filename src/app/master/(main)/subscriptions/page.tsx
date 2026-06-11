import { AdminPageHeader } from "@/shared/components/admin/core/AdminPageHeader";
import {
  getMasterSubscriptionKPIs,
  getMasterSubscriptionList,
} from "@/actions/master-actions/subscriptionReportActions";
import SubscriptionsClient from "./SubscriptionsClient";

export const revalidate = 0;

export default async function MasterSubscriptionsPage() {
  const [kpis, subscriptions] = await Promise.all([
    getMasterSubscriptionKPIs(),
    getMasterSubscriptionList(),
  ]);

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Subscriptions"
        description="Granular subscription lifecycle tracking with pause credit visibility and exportable reports."
      />
      <SubscriptionsClient kpis={kpis} subscriptions={subscriptions} />
    </div>
  );
}
