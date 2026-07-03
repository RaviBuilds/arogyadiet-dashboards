"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FranchiseSelector } from "@/shared/components/admin/core/FranchiseSelector";
import { SubscriptionDashboard } from "@/shared/components/admin/subscriptions/SubscriptionDashboard";
import { AdminSubmenuBar } from "@/shared/components/admin/core/AdminSubmenuBar";
import type { ActiveSubscriptionData } from "@/shared/components/admin/customers/CustomerDashboard";

interface SubscriptionRecord extends ActiveSubscriptionData {
  franchise_id?: string | null;
}

interface Props {
  plans: any[];
  activeSubscriptions: any[];
  initialGlobalCoupons: any[];
  subscriptionRecordsActive?: SubscriptionRecord[];
  subscriptionRecordsPending?: SubscriptionRecord[];
  subscriptionRecordsStopped?: SubscriptionRecord[];
}

/**
 * Wraps SubscriptionDashboard with a franchise scope selector.
 * Note: Subscription plans are global (not franchise-scoped), so filtering
 * only applies to active subscriptions list.
 * The SubscriptionDashboard renders plans, which are admin-only controlled.
 */
export function AdminSubscriptionsWrapper({
  plans,
  activeSubscriptions,
  initialGlobalCoupons,
  subscriptionRecordsActive = [],
  subscriptionRecordsPending = [],
  subscriptionRecordsStopped = [],
}: Props) {
  const router = useRouter();
  const [scope, setScope] = useState("core");
  const [activeTab, setActiveTab] = useState("Meal Plans");

  // Filter subscriptions by franchise_id (core = no franchise, otherwise match id)
  const filteredSubs =
    scope === "core"
      ? activeSubscriptions.filter((s: any) => !s.franchise_id)
      : activeSubscriptions.filter((s: any) => s.franchise_id === scope);

  const filterRecords = (records: SubscriptionRecord[]) =>
    scope === "core"
      ? records.filter((s) => !s.franchise_id)
      : records.filter((s) => s.franchise_id === scope);

  const handleTabChange = (tabId: string) => {
    if (tabId === "KITs") {
      router.push("/subscriptions/kits");
    } else {
      setActiveTab(tabId);
    }
  };

  return (
    <div className="space-y-4">
      <AdminSubmenuBar
        tabs={["Meal Plans", "KITs"]}
        activeTab={activeTab}
        onTabChange={handleTabChange}
      />
      
      <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-4 py-2.5 shadow-sm">
        <span className="text-xs text-slate-500 font-medium">View Data For:</span>
        <FranchiseSelector value={scope} onChange={setScope} showAllOption={false} />
      </div>
      <SubscriptionDashboard
        plans={plans}
        activeSubscriptions={filteredSubs}
        initialGlobalCoupons={initialGlobalCoupons}
        scope={scope}
        subscriptionRecordsActive={filterRecords(subscriptionRecordsActive)}
        subscriptionRecordsPending={filterRecords(subscriptionRecordsPending)}
        subscriptionRecordsStopped={filterRecords(subscriptionRecordsStopped)}
      />
    </div>
  );
}
