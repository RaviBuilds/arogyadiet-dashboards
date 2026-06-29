"use client";

// src/app/master/(main)/hierarchy/_components/FranchiseStatusControls.tsx
// Master Hierarchy — Franchise lifecycle status controls (multi-tenant-franchise
// — Task 13.3, Req 4.3, 4.4, 4.7, 15.6).
//
// Client leaf mounted at the FranchiseStatusControls TODO marker in
// HierarchyTree.tsx. Renders ONLY the transitions valid from the franchise's
// current status (the server enforces the same rules via the pure
// status-transition guard):
//   - onboarding / suspended → "Activate"   (activateFranchise)
//   - active                 → "Suspend"    (suspendFranchise)
//   - suspended              → "Reactivate" (reactivateFranchise)
//
// The activate / reactivate path can be refused server-side while an unresolved
// pincode-overlap conflict exists (Req 15.6); the action's returned error is
// surfaced verbatim in a toast — the guard lives in the action, this component
// only displays the result. Mutations run inside a transition and refresh the
// RSC tree on success.

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Power, PauseCircle, PlayCircle } from "lucide-react";

import {
  activateFranchise,
  suspendFranchise,
  reactivateFranchise,
} from "@/actions/master-actions/franchiseActions";
import type { ActionResult, Franchise, FranchiseStatus } from "@/types/franchise";

import { Button } from "@/shared/components/ui/button";

/** The minimal franchise shape needed to render the status controls. */
export interface FranchiseStatusTarget {
  id: string;
  status: FranchiseStatus;
}

interface FranchiseStatusControlsProps {
  franchise: FranchiseStatusTarget;
  /** Optional className passthrough for layout in the tree row. */
  className?: string;
}

interface TransitionAction {
  label: string;
  /** A short verb for the success toast ("activated", "suspended", ...). */
  pastTense: string;
  icon: React.ReactNode;
  variant: "default" | "outline" | "destructive";
  run: (id: string) => Promise<ActionResult<Franchise>>;
}

/**
 * The valid transition (if any) offered for each current status. Mirrors the
 * server-side `isValidStatusTransition` rules so the UI never offers an action
 * the action layer would reject (Req 4.3, 4.4, 4.7).
 */
const TRANSITION_FOR_STATUS: Record<FranchiseStatus, TransitionAction | null> = {
  onboarding: {
    label: "Activate",
    pastTense: "activated",
    icon: <Power className="h-3.5 w-3.5" />,
    variant: "default",
    run: activateFranchise,
  },
  active: {
    label: "Suspend",
    pastTense: "suspended",
    icon: <PauseCircle className="h-3.5 w-3.5" />,
    variant: "destructive",
    run: suspendFranchise,
  },
  suspended: {
    label: "Reactivate",
    pastTense: "reactivated",
    icon: <PlayCircle className="h-3.5 w-3.5" />,
    variant: "default",
    run: reactivateFranchise,
  },
};

export default function FranchiseStatusControls({
  franchise,
  className,
}: FranchiseStatusControlsProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const transition = TRANSITION_FOR_STATUS[franchise.status];

  // A terminal/no-action status renders nothing actionable.
  if (!transition) return null;

  const onClick = () => {
    startTransition(async () => {
      const result = await transition.run(franchise.id);
      if (result.success) {
        toast.success(`Franchise ${transition.pastTense}.`);
        router.refresh();
      } else {
        // Surface the returned error verbatim — this includes the unresolved
        // pincode-overlap conflict message on the activate/reactivate path
        // (Req 15.6). The guard itself lives server-side.
        toast.error(result.error);
      }
    });
  };

  return (
    <Button
      type="button"
      size="sm"
      variant={transition.variant}
      className={`gap-1.5 ${className ?? ""}`.trim()}
      onClick={onClick}
      disabled={isPending}
    >
      {transition.icon}
      {isPending ? "Working..." : transition.label}
    </Button>
  );
}
