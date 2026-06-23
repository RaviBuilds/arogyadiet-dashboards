"use client";

import { useState, useMemo } from "react";
import { FranchiseSelector } from "@/shared/components/admin/core/FranchiseSelector";
import CustomerDashboard from "@/shared/components/admin/customers/CustomerDashboard";
import type { CustomerData, ActiveSubscriptionData, ShopOrderAdminData } from "@/shared/components/admin/customers/CustomerDashboard";

interface Props {
  customers: (CustomerData & { franchiseId?: string | null })[];
  activeSubscriptions: ActiveSubscriptionData[];
  pendingSubscriptions: ActiveSubscriptionData[];
  stoppedSubscriptions: ActiveSubscriptionData[];
  shopOrders: ShopOrderAdminData[];
}

/**
 * Wraps the CustomerDashboard with a franchise selector.
 * Allows admin to view Core only, a specific franchise, or all data.
 */
export function AdminCustomersWrapper({
  customers,
  activeSubscriptions,
  pendingSubscriptions,
  stoppedSubscriptions,
  shopOrders,
}: Props) {
  const [scope, setScope] = useState("core");

  const filterByScope = <T extends { customer_profile_id?: string }>(items: T[]) => {
    // For subscription/shop data we don't have franchise_id directly, 
    // so we rely on the customer_profile_id matching filtered customers.
    return items;
  };

  const filteredCustomers = useMemo(() => {
    if (scope === "all") return customers;
    if (scope === "core") return customers.filter((c) => !c.franchiseId);
    return customers.filter((c) => c.franchiseId === scope);
  }, [customers, scope]);

  // For subscriptions, filter by matching customer email from filtered customers
  const filteredCustomerEmails = useMemo(
    () => new Set(filteredCustomers.map((c) => c.email)),
    [filteredCustomers]
  );

  const filteredActiveSubs = useMemo(() => {
    if (scope === "all") return activeSubscriptions;
    return activeSubscriptions.filter((s) => filteredCustomerEmails.has(s.email));
  }, [activeSubscriptions, scope, filteredCustomerEmails]);

  const filteredPendingSubs = useMemo(() => {
    if (scope === "all") return pendingSubscriptions;
    return pendingSubscriptions.filter((s) => filteredCustomerEmails.has(s.email));
  }, [pendingSubscriptions, scope, filteredCustomerEmails]);

  const filteredStoppedSubs = useMemo(() => {
    if (scope === "all") return stoppedSubscriptions;
    return stoppedSubscriptions.filter((s) => filteredCustomerEmails.has(s.email));
  }, [stoppedSubscriptions, scope, filteredCustomerEmails]);

  const filteredShopOrders = useMemo(() => {
    if (scope === "all") return shopOrders;
    const customerIds = new Set(filteredCustomers.map((c) => c.id));
    return shopOrders.filter((o) => customerIds.has(o.customer_profile_id));
  }, [shopOrders, scope, filteredCustomers]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-4 py-2.5 shadow-sm">
        <span className="text-xs text-slate-500 font-medium">View Data For:</span>
        <FranchiseSelector value={scope} onChange={setScope} showAllOption={true} />
      </div>
      <CustomerDashboard
        customers={filteredCustomers}
        activeSubscriptions={filteredActiveSubs}
        pendingSubscriptions={filteredPendingSubs}
        stoppedSubscriptions={filteredStoppedSubs}
        shopOrders={filteredShopOrders}
      />
    </div>
  );
}
