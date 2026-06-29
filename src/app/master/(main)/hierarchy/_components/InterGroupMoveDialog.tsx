"use client";

// src/app/master/(main)/hierarchy/_components/InterGroupMoveDialog.tsx
// Inter-Group Move dialog for the Master Hierarchy UI
// (multi-tenant-franchise — Task 13.4, Req 12.4, 5.2, 5.4).
//
// Client Component that lets a full_network operator move a Franchise from its
// current Group to ANOTHER Group IN THE SAME CITY. The parent (HierarchyTree)
// passes only same-city groups in `sameCityGroups`, satisfying the same-city
// constraint at the UI level (Req 5.2); the SECURITY DEFINER RPC behind
// `moveFranchiseToGroup` independently re-enforces it server-side.
//
// On selecting a destination Group the dialog shows a Kitchen re-resolve preview
// (Req 5.4) sourced from the chosen group's `kitchenName`. On confirm it calls
// the `moveFranchiseToGroup` Server Action inside a transition; success toasts
// (noting franchise_id / clinics / pincodes are preserved — Req 5.5), closes the
// dialog, and refreshes the tree. Failure surfaces the action's error message
// (e.g. cross-city / destination-not-found).

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeftRight, ChefHat, Info } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/shared/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/shared/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";
import { moveFranchiseToGroup } from "@/actions/master-actions/franchiseActions";

export interface InterGroupMoveGroupOption {
  id: string;
  name: string;
  kitchenName?: string;
}

interface InterGroupMoveDialogProps {
  /** The franchise being moved. */
  franchise: { id: string; name: string };
  /** The franchise's current Group id — excluded from the destination list. */
  currentGroupId: string;
  /**
   * OTHER groups in the SAME city the franchise may be moved to. The parent is
   * expected to pass same-city groups only (Req 5.2); this component still
   * filters out the current group defensively.
   */
  sameCityGroups: InterGroupMoveGroupOption[];
  /** Optional trigger override; defaults to an icon button matching the tree. */
  trigger?: React.ReactNode;
}

export default function InterGroupMoveDialog({
  franchise,
  currentGroupId,
  sameCityGroups,
  trigger,
}: InterGroupMoveDialogProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [destGroupId, setDestGroupId] = useState<string>("");

  // Destination candidates: same-city groups excluding the current group.
  const destinationGroups = sameCityGroups.filter(
    (group) => group.id !== currentGroupId
  );
  const hasDestinations = destinationGroups.length > 0;

  const selectedGroup = destinationGroups.find((g) => g.id === destGroupId);

  function resetState() {
    setDestGroupId("");
  }

  function handleOpenChange(next: boolean) {
    // Block closing mid-flight so the transition can settle.
    if (isPending) return;
    setOpen(next);
    if (!next) resetState();
  }

  function handleConfirm() {
    if (!destGroupId) return;

    startTransition(async () => {
      const result = await moveFranchiseToGroup(franchise.id, destGroupId);

      if (result.success) {
        toast.success(`"${franchise.name}" moved to ${selectedGroup?.name}`, {
          description:
            "Its franchise_id, wired clinics, and pincode assignments are preserved. " +
            "The kitchen has been re-resolved through the new group.",
        });
        setOpen(false);
        resetState();
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  const defaultTrigger = (
    <Button
      type="button"
      size="icon-sm"
      variant="ghost"
      aria-label="Move franchise to another group"
    >
      <ArrowLeftRight className="h-3.5 w-3.5 text-slate-500" />
    </Button>
  );

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>{trigger ?? defaultTrigger}</DialogTrigger>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>Move franchise to another group</DialogTitle>
          <DialogDescription>
            Move <span className="font-medium text-slate-700">{franchise.name}</span>{" "}
            to another group in the same city. Only groups in this city are
            available as destinations.
          </DialogDescription>
        </DialogHeader>

        {!hasDestinations ? (
          <div className="flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50/70 px-3 py-3">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
            <p className="text-sm text-amber-700">
              There are no other groups in this city to move this franchise to.
              Create another group in the same city first.
            </p>
          </div>
        ) : (
          <div className="space-y-4 py-1">
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-slate-700">
                Destination group
              </label>
              <Select
                value={destGroupId}
                onValueChange={setDestGroupId}
                disabled={isPending}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select a group in this city" />
                </SelectTrigger>
                <SelectContent>
                  {destinationGroups.map((group) => (
                    <SelectItem key={group.id} value={group.id}>
                      {group.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Kitchen re-resolve preview (Req 5.4). */}
            {selectedGroup && (
              <div className="flex items-start gap-2.5 rounded-lg bg-slate-50/80 px-3 py-2.5">
                <ChefHat className="mt-0.5 h-4 w-4 shrink-0 text-orange-600" />
                <p className="text-sm text-slate-600">
                  After moving, this franchise&apos;s kitchen will be:{" "}
                  <span className="font-medium text-slate-800">
                    {selectedGroup.kitchenName ?? "the new group's kitchen"}
                  </span>
                </p>
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => handleOpenChange(false)}
            disabled={isPending}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handleConfirm}
            disabled={!hasDestinations || !destGroupId || isPending}
          >
            {isPending ? "Moving..." : "Move franchise"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
