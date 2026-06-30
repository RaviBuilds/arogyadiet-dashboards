"use client";

// src/app/franchise/(main)/inventory/_components/StockOutModal.tsx
// Stock-Out recording modal for franchise inventory.
// (franchise-inventory spec — Task 13.3)
//
// Allows the franchise operator to record a stock-out from their inventory
// by selecting a reason, entering a quantity, and optionally providing a
// comment (required when reason is OTHER). Validates client-side using the
// stockOutInputSchema and submits via recordStockOutAction.
//
// Requirements validated: 10.1, 10.3, 10.5, 10.6

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, PackageMinus } from "lucide-react";
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

import {
  stockOutInputSchema,
  STOCK_OUT_REASONS,
} from "@/validations/franchiseInventory";
import { recordStockOutAction } from "@/actions/franchise-actions/franchiseInventoryActions";
import type { StockOutReason } from "@/types/franchiseInventory";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Human-readable labels for stock-out reasons. */
const REASON_LABELS: Record<StockOutReason, string> = {
  MEAL_SUBSCRIPTION_SALE: "Meal Subscription Sale",
  KIT_SUBSCRIPTION_SALE: "Kit Subscription Sale",
  ONE_TIME_PURCHASE_SALE: "One-Time Purchase Sale",
  SPOILED: "Spoiled",
  DAMAGED: "Damaged",
  OTHER: "Other",
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface StockOutModalProps {
  productId: string;
  productName: string;
  /** Optional trigger element; defaults to a Stock Out button. */
  trigger?: React.ReactNode;
}

export default function StockOutModal({
  productId,
  productName,
  trigger,
}: StockOutModalProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);

  // Form state
  const [reason, setReason] = useState<string>("");
  const [quantity, setQuantity] = useState<string>("");
  const [comment, setComment] = useState<string>("");

  // Validation / server errors
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<string | null>(null);

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  function resetForm() {
    setReason("");
    setQuantity("");
    setComment("");
    setErrors({});
    setServerError(null);
  }

  function handleOpenChange(next: boolean) {
    if (isPending) return;
    setOpen(next);
    if (!next) resetForm();
  }

  // ---------------------------------------------------------------------------
  // Submission
  // ---------------------------------------------------------------------------

  function handleSubmit() {
    setErrors({});
    setServerError(null);

    // Build input for Zod validation
    const rawInput = {
      product_id: productId,
      reason: reason || undefined,
      quantity: quantity ? Number(quantity) : undefined,
      comment: reason === "OTHER" ? (comment || null) : null,
    };

    // Client-side validation via stockOutInputSchema
    const parsed = stockOutInputSchema.safeParse(rawInput);
    if (!parsed.success) {
      const fieldErrors: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0]?.toString() ?? "form";
        if (!fieldErrors[key]) {
          fieldErrors[key] = issue.message;
        }
      }
      setErrors(fieldErrors);
      return;
    }

    // Submit via server action
    startTransition(async () => {
      const formData = new FormData();
      formData.append("product_id", productId);
      formData.append("reason", parsed.data.reason);
      formData.append("quantity", String(parsed.data.quantity));
      if (parsed.data.comment) {
        formData.append("comment", parsed.data.comment);
      }

      const result = await recordStockOutAction(formData);

      if (result.success) {
        toast.success("Stock out recorded", {
          description: `${parsed.data.quantity} unit(s) of "${productName}" removed from inventory.`,
        });
        setOpen(false);
        resetForm();
        router.refresh();
      } else {
        // Surface insufficient-stock or other server errors
        if (result.field) {
          setErrors({ [result.field]: result.error });
        } else {
          setServerError(result.error);
        }
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  const defaultTrigger = (
    <Button
      type="button"
      size="sm"
      variant="outline"
      className="gap-1.5"
    >
      <PackageMinus className="h-3.5 w-3.5" />
      Stock Out
    </Button>
  );

  const showCommentField = reason === "OTHER";

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>{trigger ?? defaultTrigger}</DialogTrigger>
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle>Record Stock Out</DialogTitle>
          <DialogDescription>
            Remove stock of{" "}
            <span className="font-medium text-slate-700">{productName}</span>{" "}
            from your franchise inventory.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Hidden product_id (for form semantics) */}
          <input type="hidden" name="product_id" value={productId} />

          {/* Reason selector */}
          <div className="space-y-1.5">
            <Label htmlFor="stock-out-reason">Reason</Label>
            <Select
              value={reason}
              onValueChange={(val) => {
                setReason(val);
                // Clear comment error if switching away from OTHER
                if (val !== "OTHER") {
                  setErrors((prev) => {
                    const { comment: _, ...rest } = prev;
                    return rest;
                  });
                }
              }}
              disabled={isPending}
            >
              <SelectTrigger id="stock-out-reason" className="w-full">
                <SelectValue placeholder="Select a reason" />
              </SelectTrigger>
              <SelectContent>
                {STOCK_OUT_REASONS.map((r) => (
                  <SelectItem key={r} value={r}>
                    {REASON_LABELS[r]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {errors.reason && (
              <p className="text-xs text-destructive">{errors.reason}</p>
            )}
          </div>

          {/* Quantity input */}
          <div className="space-y-1.5">
            <Label htmlFor="stock-out-quantity">Quantity</Label>
            <Input
              id="stock-out-quantity"
              type="number"
              min={1}
              step={1}
              placeholder="Enter quantity"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              disabled={isPending}
            />
            {errors.quantity && (
              <p className="text-xs text-destructive">{errors.quantity}</p>
            )}
          </div>

          {/* Comment field — conditional on reason === OTHER */}
          {showCommentField && (
            <div className="space-y-1.5">
              <Label htmlFor="stock-out-comment">
                Comment <span className="text-destructive">*</span>
              </Label>
              <Textarea
                id="stock-out-comment"
                placeholder="Describe the reason (1–500 characters)"
                maxLength={500}
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                disabled={isPending}
                className="min-h-[80px] resize-none"
              />
              {errors.comment && (
                <p className="text-xs text-destructive">{errors.comment}</p>
              )}
            </div>
          )}

          {/* Server error (e.g. insufficient stock) */}
          {serverError && (
            <div className="rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2.5">
              <p className="text-sm text-destructive">{serverError}</p>
            </div>
          )}
        </div>

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
            onClick={handleSubmit}
            disabled={isPending || !reason || !quantity}
          >
            {isPending ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Recording...
              </>
            ) : (
              "Record Stock Out"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
