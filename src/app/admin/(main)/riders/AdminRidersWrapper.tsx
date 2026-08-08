"use client";

import { useState, useMemo } from "react";
import { Building2 } from "lucide-react";
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
  /**
   * The signed-in admin's Clinic_Scope_Assignment. When set, every row is
   * already confined to this one clinic server-side, the "View Data For"
   * business-unit selector is replaced with a static label, and the clinic
   * option list (rider onboarding/assignment, Service Areas grouping) is
   * narrowed to just this one clinic instead of every Core/franchise clinic.
   */
  lockedClinicId?: string | null;
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
export function AdminRidersWrapper({ data, allAreas, clinics, lockedClinicId = null }: Props) {
  const [scope, setScope] = useState("core");

  const filteredRiders = useMemo(() => {
    if (lockedClinicId) return data;
    if (scope === "all") return data;
    if (scope === "core") return data.filter((r) => !r.franchiseId);
    return data.filter((r) => r.franchiseId === scope);
  }, [data, scope, lockedClinicId]);

  const scopedClinics = useMemo(() => {
    if (lockedClinicId) return clinics.filter((c) => c.id === lockedClinicId);
    if (scope === "all") return clinics;
    if (scope === "core") return clinics.filter((c) => !c.franchise_id);
    return clinics.filter((c) => c.franchise_id === scope);
  }, [clinics, scope, lockedClinicId]);

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
      <RiderManagement
        data={filteredRiders}
        allAreas={allAreas}
        clinics={scopedClinics}
        lockedClinicId={lockedClinicId}
      />
    </div>
  );
}
