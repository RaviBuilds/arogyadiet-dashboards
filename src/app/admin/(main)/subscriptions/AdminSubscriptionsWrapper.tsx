"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Building2 } from "lucide-react";
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
  /**
   * The signed-in admin's Clinic_Scope_Assignment. When set, every row is
   * already confined to this one clinic server-side, and the "View Data
   * For" business-unit selector is replaced with a static label.
   */
  lockedClinicId?: string | null;
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
  lockedClinicId = null,
}: Props) {
  const router = useRouter();
  const [scope, setScope] = useState("core");
  const [activeTab, setActiveTab] = useState("Meal Plans");

  // Filter subscriptions by franchise_id (core = no franchise, otherwise match id).
  // Rows are already clinic-confined server-side for a Clinic_Scoped_Admin, so
  // no further client-side scoping applies in that case.
  const filteredSubs = lockedClinicId
    ? activeSubscriptions
    : scope === "core"
      ? activeSubscriptions.filter((s: any) => !s.franchise_id)
      : activeSubscriptions.filter((s: any) => s.franchise_id === scope);

  const filterRecords = (records: SubscriptionRecord[]) =>
    lockedClinicId
      ? records
      : scope === "core"
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
        {lockedClinicId ? (
          <div
            className="flex w-fit items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-1.5 text-sm text-slate-700"
            aria-label="Business unit: Core Business (clinic-scoped)"
          >
            <Building2 className="h-4 w-4 text-emerald-600" />
            <span className="font-medium">Core Business</span>
          </div>
        ) : (
          <FranchiseSelector value={scope} onChange={setScope} showAllOption={false} />
        )}
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
