"use client";

// src/app/franchise/(main)/inventory/_components/FranchiseDispatchModal.tsx
// Franchise-portal single "Dispatch" action for a finished product.
//
// The franchise only dispatches stock OUT (incoming is automatic from the
// central kitchen). The dispatch destination maps to a Stock_Out_Reason:
//   - Meal Subscription Customer  → MEAL_SUBSCRIPTION_SALE
//   - Kit Subscription Customer   → KIT_SUBSCRIPTION_SALE
//   - One Time Purchase Customer  → ONE_TIME_PURCHASE_SALE
//   - Wastage                     → DAMAGED
//   - Other                       → OTHER (comment required)
//
// FIFO depletion + ledger OUT entry are handled atomically by the
// record_franchise_stock_out RPC via recordStockOutAction.

import { useState } from "react";
import { Minus } from "lucide-react";
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
import { Input } from "@/shared/components/ui/input";
import { Textarea } from "@/shared/components/ui/textarea";
import { Label } from "@/shared/components/ui/label";

import { useFranchiseInventoryStore } from "@/shared/stores/useFranchiseInventoryStore";
import type { StockOutReason } from "@/types/franchiseInventory";

// Destination label → underlying stock-out reason.
const DISPATCH_DESTINATIONS: {
  value: StockOutReason;
  label: string;
}[] = [
  { value: "MEAL_SUBSCRIPTION_SALE", label: "Meal Subscription Customer" },
  { value: "KIT_SUBSCRIPTION_SALE", label: "Kit Subscription Customer" },
  { value: "ONE_TIME_PURCHASE_SALE", label: "One Time Purchase Customer" },
  { value: "DAMAGED", label: "Wastage" },
  { value: "OTHER", label: "Other" },
];

interface FranchiseDispatchModalProps {
  productId: string;
  productName: string;
  availableQuantity: number;
}

export default function FranchiseDispatchModal({
  productId,
  productName,
  availableQuantity,
}: FranchiseDispatchModalProps) {
  const addOutboundItem = useFranchiseInventoryStore(
    (state) => state.addOutboundItem,
  );
  const [open, setOpen] = useState(false);

  const [reason, setReason] = useState<string>("");
  const [quantity, setQuantity] = useState<string>("");
  const [comment, setComment] = useState<string>("");
  const [errors, setErrors] = useState<Record<string, string>>({});

  const showComment = reason === "OTHER";

  function resetForm() {
    setReason("");
    setQuantity("");
    setComment("");
    setErrors({});
  }

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) resetForm();
  }

  function validate(): boolean {
    const next: Record<string, string> = {};
    if (!reason) next.reason = "Select a destination.";
    const qty = Number(quantity);
    if (!quantity || !Number.isInteger(qty) || qty <= 0) {
      next.quantity = "Enter a positive whole number.";
    } else if (qty > availableQuantity) {
      next.quantity = `Only ${availableQuantity} unit(s) available.`;
    }
    if (reason === "OTHER" && comment.trim().length === 0) {
      next.comment = "Comment is required for Other.";
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  function handleAddToCart() {
    if (!validate()) return;

    const label =
      DISPATCH_DESTINATIONS.find((d) => d.value === reason)?.label ?? reason;

    addOutboundItem({
      productId,
      name: productName,
      qty: Number(quantity),
      reason: reason as StockOutReason,
      reasonLabel: label,
      comment: reason === "OTHER" ? comment.trim() : undefined,
    });

    toast.success("Added to outbound cart", {
      description: `${quantity} unit(s) of "${productName}" → ${label}.`,
    });
    setOpen(false);
    resetForm();
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button type="button" size="sm" variant="outline" className="w-full">
          <Minus className="mr-1 h-4 w-4" />
          Dispatch
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle>Dispatch Stock: {productName}</DialogTitle>
          <DialogDescription>
            Available: {availableQuantity} unit(s). Stock is depleted FIFO
            (earliest expiry first) when the outbound batch is processed.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="dispatch-quantity">Quantity to Dispatch</Label>
            <Input
              id="dispatch-quantity"
              type="number"
              min={1}
              step={1}
              placeholder="Enter quantity"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
            />
            {errors.quantity && (
              <p className="text-xs text-destructive">{errors.quantity}</p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="dispatch-destination">Destination</Label>
            <Select
              value={reason}
              onValueChange={(val) => {
                setReason(val);
                setErrors((prev) => {
                  const { reason: _r, comment: _c, ...rest } = prev;
                  return rest;
                });
              }}
            >
              <SelectTrigger id="dispatch-destination" className="w-full">
                <SelectValue placeholder="Select a destination" />
              </SelectTrigger>
              <SelectContent>
                {DISPATCH_DESTINATIONS.map((d) => (
                  <SelectItem key={d.value} value={d.value}>
                    {d.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {errors.reason && (
              <p className="text-xs text-destructive">{errors.reason}</p>
            )}
          </div>

          {showComment && (
            <div className="space-y-1.5">
              <Label htmlFor="dispatch-comment">
                Comment <span className="text-destructive">*</span>
              </Label>
              <Textarea
                id="dispatch-comment"
                placeholder="Describe the reason (1–500 characters)"
                maxLength={500}
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                className="min-h-[80px] resize-none"
              />
              {errors.comment && (
                <p className="text-xs text-destructive">{errors.comment}</p>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => handleOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handleAddToCart}
            disabled={!reason || !quantity}
          >
            Add to Outbound Cart
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
