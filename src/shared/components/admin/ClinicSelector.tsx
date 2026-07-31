"use client";

// src/shared/components/admin/ClinicSelector.tsx
//
// Shared Core_Clinic selector for the Shop Products / Shop Orders / Assisted
// Order surfaces that need a clinic-scoped read (clinic-scoped-shop-inventory
// spec — Task 10.1, design.md "UI components": "Reused by the operations
// page, shop-orders page, and assisted-order page").
//
// URL-driven, matching `ShopProductsDestinationSelector`'s established
// convention in this spec: selecting a clinic replaces a search param via
// `router.replace` rather than local client state, so the owning Server
// Component re-resolves and re-fetches without a manual refresh. The
// selector itself never fetches data or renders stock/ledger content — the
// caller supplies the option list and (for a Clinic_Scoped_Admin) the fixed
// assignment.
//
// Three renderable states (Req 9.1, 9.3, 14.5):
//   1. `fixedClinic` set        -> a static "Clinic: <name>" display, no
//                                  dropdown, no other clinic ever selectable
//                                  (Req 14.5).
//   2. `clinics` is empty       -> a "no clinics configured" empty-state
//                                  message, no dropdown (Req 9.3).
//   3. otherwise                -> a Select dropdown listing every supplied
//                                  Core_Clinic (Req 9.1).
//
// The "select a clinic" prompt (no selection yet) and the "assigned clinic
// unavailable" error are deliberately NOT rendered here — both depend on
// data the caller resolves server-side (whether a clinic is selected, and
// whether the caller's own scope-assignment lookup succeeded), so the caller
// renders those states itself, alongside this selector.
//
// The Shop_Orders_Page (Task 10.3, Req 12.2, 12.3, 12.6) needs two additive
// options the Operations page never uses, both opt-in via props so the
// existing reuse sites (7.4/10.1) are unaffected:
//   - `includeAllOption`        -> prepends an "All Clinics" entry (value
//                                  `ALL_CLINICS`, "all"); selecting it clears
//                                  the param entirely, since "no param" and
//                                  "all" both mean "no clinic filter" (Req
//                                  12.3). When this prop is set and no param
//                                  is present, the selector displays "All
//                                  Clinics" as selected rather than the
//                                  "select a clinic" placeholder.
//   - `includeUnassignedOption` -> appends an "Unassigned" entry (value
//                                  `UNASSIGNED_CLINIC_VALUE`), selecting only
//                                  Shop_Orders whose Order_Clinic_Stamp is
//                                  unset (Req 12.6). Only ever offered to an
//                                  Unscoped_Operations_Admin (no `fixedClinic`).
//
// Requirements validated: 9.1, 9.3, 14.5, 12.2, 12.3, 12.6

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { Building2, MapPin } from "lucide-react";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";
import { Label } from "@/shared/components/ui/label";
import { ALL_CLINICS } from "@/lib/clinic/visibility";

export const CLINIC_SELECTOR_PARAM = "clinic";

/**
 * Sentinel `?clinic=` value selecting only Shop_Orders (or other clinic-scoped
 * rows) whose clinic association is unset — the `Unassigned` grouping (Req
 * 12.6). Not a real clinic id, so `checkClinicScope`/`resolveReadableClinicId`
 * never evaluates it; callers branch on this sentinel before any scope check.
 */
export const UNASSIGNED_CLINIC_VALUE = "unassigned";

/** One selectable Core_Clinic option. */
export interface ClinicSelectorOption {
  id: string;
  name: string;
}

interface ClinicSelectorProps {
  /** Every selectable Core_Clinic (Req 9.1). Ignored when `fixedClinic` is set. */
  clinics: ClinicSelectorOption[];
  /**
   * Set for a Clinic_Scoped_Admin: fixes the selector to this one clinic with
   * no other Core_Clinic ever offered as a selectable value (Req 14.5). A
   * static label is rendered instead of a dropdown, since a disabled
   * single-option Select would misrepresent this as a real choice.
   */
  fixedClinic?: ClinicSelectorOption | null;
  /** Search param name the selection is read from / written to. */
  paramName?: string;
  /** Label shown above the control. */
  label?: string;
  className?: string;
  /**
   * Prepend an "All Clinics" option (Req 12.3). Selecting it clears the
   * param, since no param and "all" are equivalent ("no clinic filter").
   */
  includeAllOption?: boolean;
  /**
   * Append an "Unassigned" option selecting only rows with no clinic
   * association (Req 12.6). Ignored when `fixedClinic` is set — a
   * Clinic_Scoped_Admin never sees this grouping.
   */
  includeUnassignedOption?: boolean;
}

/**
 * Core_Clinic selector for the clinic-scoped Shop Products / Shop Orders /
 * Assisted Order surfaces. See file header for the three renderable states.
 */
export function ClinicSelector({
  clinics,
  fixedClinic = null,
  paramName = CLINIC_SELECTOR_PARAM,
  label = "Clinic",
  className,
  includeAllOption = false,
  includeUnassignedOption = false,
}: ClinicSelectorProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Req 14.5: fixed to the assignment, no other Core_Clinic selectable.
  if (fixedClinic) {
    return (
      <div className={className}>
        <Label className="mb-1.5 block text-xs font-medium text-slate-700">
          {label}
        </Label>
        <div
          className="flex w-fit min-w-[220px] items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700"
          aria-label={`Assigned clinic: ${fixedClinic.name}`}
        >
          <Building2 className="h-4 w-4 text-emerald-600" />
          <span className="font-medium">{fixedClinic.name}</span>
        </div>
      </div>
    );
  }

  // Req 9.3: no Core_Clinic exists at all.
  if (clinics.length === 0) {
    return (
      <div className={className}>
        <Label className="mb-1.5 block text-xs font-medium text-slate-700">
          {label}
        </Label>
        <div className="flex items-center gap-2 rounded-md border border-dashed border-slate-200 bg-slate-50 px-3 py-2 text-sm text-muted-foreground">
          <MapPin className="h-4 w-4 opacity-50" />
          No clinics are configured yet.
        </div>
      </div>
    );
  }

  const rawValue = searchParams.get(paramName);
  // Req 12.3: no param and "all" both mean "no clinic filter" — when the
  // All Clinics option is offered, treat an absent param as that option
  // being selected rather than showing the "select a clinic" placeholder.
  const currentValue =
    rawValue ?? (includeAllOption ? ALL_CLINICS : undefined);

  function handleValueChange(value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (includeAllOption && value === ALL_CLINICS) {
      params.delete(paramName);
    } else {
      params.set(paramName, value);
    }
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname);
  }

  return (
    <div className={className}>
      <Label className="mb-1.5 block text-xs font-medium text-slate-700">
        {label}
      </Label>
      <Select value={currentValue} onValueChange={handleValueChange}>
        <SelectTrigger className="w-[220px]" aria-label={label}>
          <span className="flex items-center gap-2">
            <Building2 className="h-4 w-4 text-emerald-600" />
            <SelectValue placeholder="Select a clinic" />
          </span>
        </SelectTrigger>
        <SelectContent>
          {includeAllOption ? (
            <SelectItem value={ALL_CLINICS}>All Clinics</SelectItem>
          ) : null}
          {clinics.map((clinic) => (
            <SelectItem key={clinic.id} value={clinic.id}>
              {clinic.name}
            </SelectItem>
          ))}
          {includeUnassignedOption ? (
            <SelectItem value={UNASSIGNED_CLINIC_VALUE}>Unassigned</SelectItem>
          ) : null}
        </SelectContent>
      </Select>
    </div>
  );
}

export default ClinicSelector;
