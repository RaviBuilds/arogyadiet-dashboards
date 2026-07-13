"use client";

/**
 * ForceOffDutyButton
 *
 * Small icon button shown next to the "Online" status badge in the Today's Activity
 * table when a rider has no active delivery (no batch assigned or all deliveries
 * completed). Allows admin to force-mark the rider Off Duty to save resources.
 */

import { useState, useTransition } from "react";
import { PowerOff } from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/shared/components/ui/tooltip";
import { adminSetRiderOffDutyAction } from "@/actions/admin-actions/liveTrackingActions";
import { revalidateRidersPage } from "@/actions/admin-actions/riderActions";
import { toast } from "sonner";

interface ForceOffDutyButtonProps {
  riderId: string;
  riderName: string;
}

export function ForceOffDutyButton({ riderId, riderName }: ForceOffDutyButtonProps) {
  const [isPending, startTransition] = useTransition();
  const [isDone, setIsDone] = useState(false);

  if (isDone) return null;

  const handleForceOffDuty = () => {
    startTransition(async () => {
      const result = await adminSetRiderOffDutyAction(riderId);
      if (result.success) {
        toast.success(`${riderName} marked Off Duty`);
        setIsDone(true);
        revalidateRidersPage();
      } else if (result.error === "active_assignment") {
        toast.error("Cannot mark off duty — rider has active deliveries");
      } else {
        toast.error("Failed to mark rider off duty");
      }
    });
  };

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-5 w-5 rounded-full text-red-500 hover:text-red-700 hover:bg-red-50 ml-1"
            onClick={handleForceOffDuty}
            disabled={isPending}
          >
            <PowerOff className="h-3 w-3" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="top" className="text-xs">
          Force Off Duty
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
