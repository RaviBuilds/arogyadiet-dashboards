"use client";

import { useState, useMemo } from "react";
import { FranchiseSelector } from "@/shared/components/admin/core/FranchiseSelector";
import RiderManagement from "@/shared/components/admin/riders/RiderManagement";
import type {
  RiderData,
  ClinicOption,
} from "@/shared/components/admin/riders/RiderManagement";

interface Props {
  data: (RiderData & { franchiseId?: string | null })[];
  allAreas: any[];
  clinics: ClinicOption[];
}

/**
 * Wraps RiderManagement with a franchise scope selector.
 * Allows admin to view Core riders, a specific franchise's riders, or all.
 *
 * The clinic option list (used for rider onboarding/assignment and the
 * clinic-grouped Service Areas) is scoped to match the selected view: Core
 * shows clinics with no franchise, a specific franchise shows that franchise's
 * clinics, and "all" shows every clinic.
 */
export function AdminRidersWrapper({ data, allAreas, clinics }: Props) {
  const [scope, setScope] = useState("core");

  const filteredRiders = useMemo(() => {
    if (scope === "all") return data;
    if (scope === "core") return data.filter((r) => !r.franchiseId);
    return data.filter((r) => r.franchiseId === scope);
  }, [data, scope]);

  const scopedClinics = useMemo(() => {
    if (scope === "all") return clinics;
    if (scope === "core") return clinics.filter((c) => !c.franchise_id);
    return clinics.filter((c) => c.franchise_id === scope);
  }, [clinics, scope]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-4 py-2.5 shadow-sm">
        <span className="text-xs text-slate-500 font-medium">View Data For:</span>
        <FranchiseSelector value={scope} onChange={setScope} showAllOption={true} />
      </div>
      <RiderManagement
        data={filteredRiders}
        allAreas={allAreas}
        clinics={scopedClinics}
      />
    </div>
  );
}
