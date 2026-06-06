"use client";

import { useEffect, useState, useTransition } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/components/ui/dialog";
import { Button } from "@/shared/components/ui/button";
import { Label } from "@/shared/components/ui/label";
import { Textarea } from "@/shared/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { requestFailedDeliveryAction } from "@/actions/rider-actions/routeActions";
import { FAILED_DELIVERY_REASONS } from "@/lib/delivery/failedDeliveryReasons";

export function FailedDeliveryModal({
  open,
  onOpenChange,
  orderId,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orderId: string;
  onSuccess: () => void;
}) {
  const [reason, setReason] = useState<string>("");
  const [remark, setRemark] = useState("");
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    if (open) {
      setReason("");
      setRemark("");
    }
  }, [open]);

  const handleSubmit = () => {
    if (!reason) {
      toast.error("Please select a failure reason.");
      return;
    }

    startTransition(async () => {
      const result = await requestFailedDeliveryAction(
        orderId,
        reason,
        remark.trim() || undefined,
      );

      if (result.success) {
        toast.success("Failure request sent for admin approval.");
        onOpenChange(false);
        onSuccess();
      } else {
        toast.error(result.error);
      }
    });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!isPending) onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Request failed delivery</DialogTitle>
          <DialogDescription>
            Admin must approve before this stop is marked failed. You cannot
            deliver until they respond.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="failure-reason">Reason</Label>
            <Select value={reason} onValueChange={setReason} disabled={isPending}>
              <SelectTrigger id="failure-reason" className="w-full">
                <SelectValue placeholder="Select a reason" />
              </SelectTrigger>
              <SelectContent>
                {FAILED_DELIVERY_REASONS.map((option) => (
                  <SelectItem key={option} value={option}>
                    {option}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="failure-remark">Remarks (optional)</Label>
            <Textarea
              id="failure-remark"
              value={remark}
              onChange={(e) => setRemark(e.target.value)}
              placeholder="Add any extra details for the admin..."
              disabled={isPending}
              rows={3}
            />
          </div>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={isPending}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={!reason || isPending}
            onClick={handleSubmit}
          >
            {isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Sending...
              </>
            ) : (
              "Send for Approval"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
