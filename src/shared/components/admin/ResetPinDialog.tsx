"use client";

// src/shared/components/admin/ResetPinDialog.tsx
// Admin dialog for resetting a customer's PIN from the Customer 360 view.
// Requirements: 7.1, 7.2, 7.3

import { useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/components/ui/dialog";
import { Button } from "@/shared/components/ui/button";
import { TempPinField } from "@/shared/components/admin/TempPinField";
import { isValidPinFormat } from "@/lib/pin/pinUtils";
import { resetCustomerPinAction } from "@/actions/admin-actions/adminPinActions";

interface ResetPinDialogProps {
  userId: string;
  customerName?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ResetPinDialog({
  userId,
  customerName,
  open,
  onOpenChange,
}: ResetPinDialogProps) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [isPending, startTransition] = useTransition();

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      // Reset state when closing
      setPin("");
      setError("");
    }
    onOpenChange(nextOpen);
  };

  const handleSubmit = () => {
    // Client-side validation: reject non-6-digit-numeric values
    if (!isValidPinFormat(pin)) {
      setError("PIN must be exactly 6 digits");
      return;
    }

    setError("");

    startTransition(async () => {
      const result = await resetCustomerPinAction(userId, pin);

      if (result.success) {
        toast.success(
          customerName
            ? `PIN reset successfully for ${customerName}`
            : "PIN reset successfully",
        );
        // Close dialog and reset state
        setPin("");
        setError("");
        onOpenChange(false);
      } else {
        setError(result.error || "Failed to reset PIN. Please try again.");
      }
    });
  };

  const title = customerName
    ? `Reset PIN for ${customerName}`
    : "Reset PIN";

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            Set a new temporary PIN. The customer will be required to change it
            on their next login.
          </DialogDescription>
        </DialogHeader>

        <div className="py-2">
          <TempPinField
            value={pin}
            onChange={(val) => {
              setPin(val);
              if (error) setError("");
            }}
            error={error}
            disabled={isPending}
            label="New Temporary PIN"
            id="reset-pin"
          />
        </div>

        <DialogFooter>
          <Button
            type="button"
            onClick={handleSubmit}
            disabled={isPending || pin.length === 0}
          >
            {isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Reset PIN
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
