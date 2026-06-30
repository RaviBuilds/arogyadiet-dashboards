"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/shared/components/ui/button";
import { Badge } from "@/shared/components/ui/badge";
import { Check, X, Truck, Loader2 } from "lucide-react";
import {
  acceptTransferAction,
  rejectTransferAction,
  receiveTransferAction,
} from "@/actions/franchise-actions/franchiseInventoryActions";
import type { FranchiseStockTransfer } from "@/types/franchiseInventory";

interface ReceiveTransferControlsProps {
  transfer: FranchiseStockTransfer;
}

/**
 * Client component rendering Accept/Reject buttons for DISPATCHED transfers
 * and a "Confirm Received" button for ACCEPTED (in-transit) transfers.
 *
 * Uses useTransition for loading states and submits via hidden-input forms
 * to the franchise inventory server actions.
 *
 * Requirements validated: 7.1, 7.2, 7.3, 8.2
 */
export default function ReceiveTransferControls({
  transfer,
}: ReceiveTransferControlsProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const handleAccept = () => {
    startTransition(async () => {
      const formData = new FormData();
      formData.set("transfer_id", transfer.id);
      const result = await acceptTransferAction(formData);
      if (result.success) {
        toast.success("Transfer accepted. Stock is now in transit.");
        router.refresh();
      } else {
        toast.error(result.error ?? "Failed to accept transfer.");
      }
    });
  };

  const handleReject = () => {
    startTransition(async () => {
      const formData = new FormData();
      formData.set("transfer_id", transfer.id);
      const result = await rejectTransferAction(formData);
      if (result.success) {
        toast.success("Transfer rejected.");
        router.refresh();
      } else {
        toast.error(result.error ?? "Failed to reject transfer.");
      }
    });
  };

  const handleReceive = () => {
    startTransition(async () => {
      const formData = new FormData();
      formData.set("transfer_id", transfer.id);
      const result = await receiveTransferAction(formData);
      if (result.success) {
        toast.success("Stock received and added to your inventory.");
        router.refresh();
      } else {
        toast.error(result.error ?? "Failed to confirm receipt.");
      }
    });
  };

  if (transfer.state === "DISPATCHED") {
    return (
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          className="h-8 text-xs bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100"
          onClick={handleAccept}
          disabled={isPending}
        >
          {isPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
          ) : (
            <Check className="h-3.5 w-3.5 mr-1" />
          )}
          Accept
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-8 text-xs bg-rose-50 text-rose-700 border-rose-200 hover:bg-rose-100"
          onClick={handleReject}
          disabled={isPending}
        >
          {isPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
          ) : (
            <X className="h-3.5 w-3.5 mr-1" />
          )}
          Reject
        </Button>
      </div>
    );
  }

  if (transfer.state === "ACCEPTED") {
    return (
      <div className="flex items-center gap-2">
        <Badge
          variant="outline"
          className="rounded-lg text-[10px] bg-amber-50 text-amber-700 border-amber-200"
        >
          <Truck className="h-3 w-3 mr-1" />
          In Transit
        </Badge>
        <Button
          size="sm"
          variant="outline"
          className="h-8 text-xs bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100"
          onClick={handleReceive}
          disabled={isPending}
        >
          {isPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
          ) : (
            <Check className="h-3.5 w-3.5 mr-1" />
          )}
          Confirm Received
        </Button>
      </div>
    );
  }

  // For RECEIVED or REJECTED states, no controls needed
  return null;
}
