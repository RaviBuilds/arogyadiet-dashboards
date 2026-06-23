"use client";

import { useState, useMemo } from "react";
import { FranchiseSelector } from "@/shared/components/admin/core/FranchiseSelector";
import RiderManagement from "@/shared/components/admin/riders/RiderManagement";
import type { RiderData } from "@/shared/components/admin/riders/RiderManagement";

interface Props {
  data: (RiderData & { franchiseId?: string | null })[];
  allAreas: any[];
}

/**
 * Wraps RiderManagement with a franchise scope selector.
 * Allows admin to view Core riders, a specific franchise's riders, or all.
 */
export function AdminRidersWrapper({ data, allAreas }: Props) {
  const [scope, setScope] = useState("core");

  const filteredRiders = useMemo(() => {
    if (scope === "all") return data;
    if (scope === "core") return data.filter((r) => !r.franchiseId);
    return data.filter((r) => r.franchiseId === scope);
  }, [data, scope]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-4 py-2.5 shadow-sm">
        <span className="text-xs text-slate-500 font-medium">View Data For:</span>
        <FranchiseSelector value={scope} onChange={setScope} showAllOption={true} />
      </div>
      <RiderManagement data={filteredRiders} allAreas={allAreas} />
    </div>
  );
}
