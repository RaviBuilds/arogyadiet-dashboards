"use client";

import { useState, useMemo } from "react";
import { Building2 } from "lucide-react";
import { FranchiseSelector } from "@/shared/components/admin/core/FranchiseSelector";
import CustomerDashboard from "@/shared/components/admin/customers/CustomerDashboard";
import type { CustomerData, ActiveSubscriptionData } from "@/shared/components/admin/customers/CustomerDashboard";

interface Props {
  customers: (CustomerData & { franchiseId?: string | null })[];
  activeSubscriptions: ActiveSubscriptionData[];
  pendingSubscriptions: ActiveSubscriptionData[];
  stoppedSubscriptions: ActiveSubscriptionData[];
  autoOpenCreate?: boolean;
  /** Renders the read-only Dietitian workspace (Req 16.1) when true. */
  isDietitian?: boolean;
  /**
   * The signed-in admin's Clinic_Scope_Assignment (`users.admin_clinic_id`),
   * `null` for an unscoped admin. When set, this admin is confined to a
   * single Core Clinic: the "View Data For" business-unit selector and the
   * "All Clinics" filter are both replaced with a static, non-interactive
   * label instead of a dropdown, since every other business unit / clinic is
   * out of scope for them regardless of what the selector shows.
   */
  lockedClinicId?: string | null;
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
  autoOpenCreate = false,
  isDietitian = false,
  lockedClinicId = null,
}: Props) {
  // A Clinic_Scoped_Admin only ever has Core data (a Clinic_Scope_Assignment
  // requires the `operations` level, which never pairs with the `franchises`
  // group) — scope is always "core" and the selector is locked.
  const [scope, setScope] = useState("core");

  const filteredCustomers = useMemo(() => {
    if (lockedClinicId) return customers;
    if (scope === "all") return customers;
    if (scope === "core") return customers.filter((c) => !c.franchiseId);
    return customers.filter((c) => c.franchiseId === scope);
  }, [customers, scope, lockedClinicId]);

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

  return (
    <div className="space-y-4">
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
          <FranchiseSelector value={scope} onChange={setScope} showAllOption={true} />
        )}
      </div>
      <CustomerDashboard
        customers={filteredCustomers}
        activeSubscriptions={filteredActiveSubs}
        pendingSubscriptions={filteredPendingSubs}
        stoppedSubscriptions={filteredStoppedSubs}
        autoOpenCreate={autoOpenCreate}
        isDietitian={isDietitian}
        lockedClinicId={lockedClinicId}
      />
    </div>
  );
}
