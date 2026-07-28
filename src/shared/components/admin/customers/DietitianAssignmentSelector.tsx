"use client";

// src/shared/components/admin/customers/DietitianAssignmentSelector.tsx
// Feature: dietitian-management — Task 12.5.
//
// Mirrors `ClinicAssignmentSelector.tsx`'s pattern (a Select + Save button
// wired to a Server Action) for the Customer_360 Dietitian dropdown:
//   - `mode="clinic"` (Req 8.1, 8.2, 8.3, 8.9) — the KIT Clinic Assignment
//     card's Dietitian dropdown. Populated with every active Dietitian
//     linked to `clinicId` via `listDietitiansForClinic`; disabled with the
//     pinned `Assign a clinic first` placeholder while `clinicId` is null
//     (Req 8.3) — this component never fetches when unassigned.
//   - `mode="all"` (Req 9.2, 9.5) — the ACCOMMODATION Dietitian dropdown.
//     Populated with every active Dietitian, independent of Clinic, via
//     `listActiveDietitiansForAdmin`.
//
// Both modes persist through `assignCustomerDietitian` (Task 9.7), then
// `router.refresh()` so the Customer_360 page re-fetches and displays the
// persisted Dietitian name (Req 8.9).

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

import {
  assignCustomerDietitian,
  listDietitiansForClinic,
} from "@/actions/admin-actions/dietitianAssignmentActions";
import { listActiveDietitiansForAdmin } from "@/actions/admin-actions/customerHealthLogActions";
import { ASSIGN_A_CLINIC_FIRST } from "@/lib/dietitian/messages";
import type { DietitianAccount } from "@/types/dietitian";
import { Button } from "@/shared/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";

const UNASSIGNED = "unassigned";

interface DietitianAssignmentSelectorProps {
  profileId: string;
  currentDietitianId: string | null;
  /** `"clinic"` scopes the dropdown to `clinicId`'s active Dietitians (Req 8.2); `"all"` lists every active Dietitian (Req 9.2). */
  mode: "clinic" | "all";
  /** Required when `mode === "clinic"`; `null` disables the dropdown (Req 8.3). */
  clinicId?: string | null;
}

export function DietitianAssignmentSelector({
  profileId,
  currentDietitianId,
  mode,
  clinicId = null,
}: DietitianAssignmentSelectorProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [dietitians, setDietitians] = useState<DietitianAccount[]>([]);
  const [loading, setLoading] = useState(mode === "all" || clinicId !== null);
  const [selectedDietitianId, setSelectedDietitianId] = useState<string>(
    currentDietitianId ?? UNASSIGNED,
  );

  const disabled = mode === "clinic" && clinicId === null;

  useEffect(() => {
    if (disabled) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDietitians([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    const load =
      mode === "all"
        ? listActiveDietitiansForAdmin()
        : listDietitiansForClinic(clinicId!);

    load.then((result) => {
      setLoading(false);
      if (result.success) setDietitians(result.data);
      else toast.error(result.error);
    });
  }, [mode, clinicId, disabled]);

  const handleAssign = () => {
    const dietitianIdToSet =
      selectedDietitianId === UNASSIGNED ? null : selectedDietitianId;
    startTransition(async () => {
      const result = await assignCustomerDietitian(profileId, dietitianIdToSet);
      if (result.success) {
        toast.success("Dietitian assigned successfully.");
        router.refresh();
      } else {
        toast.error(result.error ?? "Failed to assign dietitian.");
      }
    });
  };

  if (disabled) {
    return (
      <Select disabled>
        <SelectTrigger className="w-[220px]">
          <SelectValue placeholder={ASSIGN_A_CLINIC_FIRST} />
        </SelectTrigger>
      </Select>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading dietitians...
      </div>
    );
  }

  const hasChanged = (currentDietitianId ?? UNASSIGNED) !== selectedDietitianId;

  return (
    <div className="flex items-center gap-3">
      <Select value={selectedDietitianId} onValueChange={setSelectedDietitianId}>
        <SelectTrigger className="w-[220px]">
          <SelectValue placeholder="Select a dietitian" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={UNASSIGNED}>Unassigned</SelectItem>
          {dietitians.length === 0 && mode === "clinic" ? (
            <div className="px-2 py-1.5 text-xs text-muted-foreground">
              No dietitian is assigned to this clinic
            </div>
          ) : (
            dietitians.map((dietitian) => (
              <SelectItem key={dietitian.id} value={dietitian.id}>
                {dietitian.fullName}
              </SelectItem>
            ))
          )}
        </SelectContent>
      </Select>
      {hasChanged && (
        <Button size="sm" onClick={handleAssign} disabled={isPending}>
          {isPending ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
          Save
        </Button>
      )}
    </div>
  );
}
