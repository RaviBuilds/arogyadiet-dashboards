"use client";

// src/shared/components/admin/operations/clinicSelector.tsx
// Shared clinic-selector-first scaffolding for the operational views
// (Live Routing Board, Live Tracking, Routing Sandbox) — core-clinic-architecture
// task 13.3, Requirements 17.1–17.9.
//
// Provides:
//  - `useClinicSelector`: loads the authorized Core Clinic options via an
//    injected `getClinics` action and tracks the current selection. When no
//    `getClinics` is supplied (e.g. the franchise portal, which scopes itself),
//    selector-first mode is OFF and the host view keeps its prior behavior.
//  - `ClinicSelectControl`: the Select dropdown limited to authorized clinics.
//  - `SelectClinicPrompt`: the "pick a clinic first" gate shown before any
//    rider/route/tracking data is fetched or rendered (Req 17.1, 17.3, 17.5).
//
// The actual rider gating/filtering uses the pure helpers
// `ridersForSelectedClinic` / `authorizedClinicOptions` from
// `@/lib/clinic/visibility` — this module never reimplements that logic.

import { useEffect, useState } from "react";
import { Building2, MapPin } from "lucide-react";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";
import { authorizedClinicOptions } from "@/lib/clinic/visibility";
import type {
  SelectableClinic,
  SelectableClinicsResult,
} from "@/actions/admin-actions/clinicSelectorActions";

export type GetClinics = () => Promise<SelectableClinicsResult>;

export interface ClinicSelectorState {
  /** True when a `getClinics` action was provided (selector-first enabled). */
  selectorFirst: boolean;
  /** Authorized Core Clinic options for the selector (Req 17.9). */
  clinicOptions: SelectableClinic[];
  /** Whether the clinic option list is still loading. */
  clinicsLoading: boolean;
  /** The currently selected clinic id, or "" when none is selected. */
  selectedClinicId: string;
  setSelectedClinicId: (id: string) => void;
}

/**
 * Load the authorized Core Clinic options and track the current selection.
 * Selector-first mode is enabled only when `getClinics` is provided.
 */
export function useClinicSelector(
  getClinics?: GetClinics,
): ClinicSelectorState {
  const selectorFirst = Boolean(getClinics);
  const [clinicOptions, setClinicOptions] = useState<SelectableClinic[]>([]);
  const [selectedClinicId, setSelectedClinicId] = useState<string>("");
  const [clinicsLoading, setClinicsLoading] = useState<boolean>(selectorFirst);

  useEffect(() => {
    if (!getClinics) return;
    let cancelled = false;
    setClinicsLoading(true);
    getClinics()
      .then((res) => {
        if (cancelled) return;
        // Restrict the selector to the clinics the caller may access (Req 17.9).
        setClinicOptions(
          authorizedClinicOptions(res.clinics, res.authorizedClinicIds),
        );
      })
      .catch((err) => {
        console.error("[useClinicSelector] failed to load clinics", err);
        if (!cancelled) setClinicOptions([]);
      })
      .finally(() => {
        if (!cancelled) setClinicsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [getClinics]);

  return {
    selectorFirst,
    clinicOptions,
    clinicsLoading,
    selectedClinicId,
    setSelectedClinicId,
  };
}

/**
 * The clinic selector dropdown, limited to the authorized clinics.
 */
export function ClinicSelectControl({
  clinicOptions,
  clinicsLoading,
  selectedClinicId,
  onSelect,
  className,
}: {
  clinicOptions: SelectableClinic[];
  clinicsLoading: boolean;
  selectedClinicId: string;
  onSelect: (id: string) => void;
  className?: string;
}) {
  return (
    <div className={className ?? "min-w-[220px] flex-1"}>
      <Select
        value={selectedClinicId || undefined}
        onValueChange={onSelect}
        disabled={clinicsLoading || clinicOptions.length === 0}
      >
        <SelectTrigger className="w-full border-slate-200 sm:max-w-md">
          <span className="flex items-center gap-2">
            <Building2 className="h-4 w-4 text-emerald-600" />
            <SelectValue
              placeholder={
                clinicsLoading
                  ? "Loading clinics..."
                  : clinicOptions.length === 0
                    ? "No clinics available"
                    : "Select a clinic"
              }
            />
          </span>
        </SelectTrigger>
        <SelectContent>
          {clinicOptions.map((clinic) => (
            <SelectItem key={clinic.id} value={clinic.id}>
              {clinic.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

/**
 * The clinic-selector-first gate: shown while no clinic is selected so no
 * rider/route/tracking data is fetched or rendered yet (Req 17.1, 17.3, 17.5).
 */
export function SelectClinicPrompt({
  message = "Select a clinic to view its riders and routes.",
}: {
  message?: string;
}) {
  return (
    <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/50 p-10 text-center text-muted-foreground">
      <MapPin className="mx-auto mb-3 h-10 w-10 opacity-40" />
      <p className="font-medium text-slate-700">Select a clinic to begin</p>
      <p className="mt-1 text-sm">{message}</p>
    </div>
  );
}
