"use client";

import { useState, useMemo } from "react";
import { FranchiseSelector } from "@/shared/components/admin/core/FranchiseSelector";
import OperationsDashboard from "@/shared/components/admin/operations/OperationsDashboard";

interface Props {
  deliveries: any[];
  plannedDeliveries: any[];
  rosterData: any;
  automationLogs: any;
}

/**
 * Wraps OperationsDashboard with a franchise scope selector.
 * Filters delivery data by franchise_id.
 */
export function AdminOperationsWrapper({
  deliveries,
  plannedDeliveries,
  rosterData,
  automationLogs,
}: Props) {
  const [scope, setScope] = useState("core");

  const filteredDeliveries = useMemo(() => {
    if (scope === "all") return deliveries;
    if (scope === "core") return deliveries.filter((d: any) => !d.franchise_id);
    return deliveries.filter((d: any) => d.franchise_id === scope);
  }, [deliveries, scope]);

  const filteredPlanned = useMemo(() => {
    if (scope === "all") return plannedDeliveries;
    if (scope === "core") return plannedDeliveries.filter((d: any) => !d.franchise_id);
    return plannedDeliveries.filter((d: any) => d.franchise_id === scope);
  }, [plannedDeliveries, scope]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-4 py-2.5 shadow-sm">
        <span className="text-xs text-slate-500 font-medium">View Data For:</span>
        <FranchiseSelector value={scope} onChange={setScope} showAllOption={true} />
      </div>
      <OperationsDashboard
        deliveries={filteredDeliveries}
        plannedDeliveries={filteredPlanned}
        rosterData={rosterData}
        automationLogs={automationLogs}
      />
    </div>
  );
}
