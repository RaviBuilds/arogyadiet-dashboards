"use client";

// src/shared/components/admin/product-inventory/ShopStockInDialog.tsx
// Quantity-entry dialog for the Stock_In row action in Clinic_Mode
// (clinic-scoped-shop-inventory spec — Task 7.7).
//
// Adds one pending line to the isolated `shopStockInCart` slice
// (`useInventoryStore`) via `addShopStockInLine`, matching the sequence
// diagram in design.md ("Stock In sequence"):
//   UI->>Store: addShopStockInLine({clinicId, productId, qty})
//
// Blocked entirely for an Unlinked_Shop_Product (Req 7.15): the trigger
// button itself renders disabled with an explanatory tooltip, and the
// dialog is never opened for that product — there is no code path that
// shows a quantity input with no way to validate it.

import { useState } from "react";
import { Plus } from "lucide-react";

import { validateMovementQuantity } from "@/lib/shop/clinicStock";
import { useInventoryStore } from "@/shared/stores/useInventoryStore";
import { Button } from "@/shared/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/components/ui/dialog";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/shared/components/ui/tooltip";

/** Minimal product shape the dialog needs — matches `ClinicShopProductRow`. */
export interface ShopStockInDialogProduct {
  id: string;
  name: string;
  inventory_product_id: string | null;
}

interface ShopStockInDialogProps {
  product: ShopStockInDialogProduct;
  clinicId: string;
  /** Display name of the destination clinic, stored on the pending line. */
  clinicName: string;
  /**
   * When set, the Stock In action is disabled and this message explains why.
   * Used to block adding a line while the cart already holds lines for a
   * different clinic, which would otherwise mix destinations in one cart.
   */
  blockedReason?: string | null;
  /** Optional: called after a valid quantity is added to the cart. */
  onAdded?: () => void;
}

const UNLINKED_MESSAGE =
  "This product must be linked to a Master Catalog Product before stock-in.";

/** Maps a `QuantityRejection` reason to the requirement's specified wording. */
function rejectionMessage(reason: string): string {
  switch (reason) {
    case "NOT_INTEGER":
    case "BELOW_MINIMUM":
    case "ABOVE_MAXIMUM":
    default:
      return "Quantity must be a whole number between 1 and 1,000,000.";
  }
}

export function ShopStockInDialog({
  product,
  clinicId,
  clinicName,
  blockedReason,
  onAdded,
}: ShopStockInDialogProps) {
  const [open, setOpen] = useState(false);
  const [rawValue, setRawValue] = useState("");
  const addShopStockInLine = useInventoryStore(
    (state) => state.addShopStockInLine,
  );

  const isUnlinked = !product.inventory_product_id;
  // An unlinked product can never be stocked in (Req 7.15); a cross-clinic
  // cart blocks it only until the cart is resolved.
  const disabledMessage = isUnlinked ? UNLINKED_MESSAGE : (blockedReason ?? null);
  const isDisabled = disabledMessage !== null;

  // Empty input is treated as "not yet entered" rather than an immediate
  // NOT_INTEGER error, so the field does not open already showing red.
  const trimmed = rawValue.trim();
  const parsedNumber = trimmed === "" ? NaN : Number(trimmed);
  const validation =
    trimmed === ""
      ? null
      : validateMovementQuantity(
          Number.isFinite(parsedNumber) ? parsedNumber : rawValue,
        );

  const isValid = validation !== null && validation.ok;

  const handleOpenChange = (next: boolean) => {
    // Never openable for an unlinked product (Req 7.15) or while a
    // cross-clinic cart blocks new lines.
    if (isDisabled) return;
    setOpen(next);
    if (!next) {
      setRawValue("");
    }
  };

  const handleAdd = () => {
    if (!validation || !validation.ok) return;

    addShopStockInLine({
      clinicId,
      clinicName,
      productId: product.id,
      name: product.name,
      qty: validation.value,
    });

    setOpen(false);
    setRawValue("");
    onAdded?.();
  };

  const trigger = (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="h-8 gap-1.5 text-slate-600 hover:text-slate-900"
      disabled={isDisabled}
      onClick={() => handleOpenChange(true)}
    >
      <Plus className="h-3.5 w-3.5" />
      Stock In
    </Button>
  );

  return (
    <>
      {disabledMessage ? (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              {/* span wrapper so the tooltip fires even though the button is disabled */}
              <span className="inline-flex" title={disabledMessage}>
                {trigger}
              </span>
            </TooltipTrigger>
            <TooltipContent side="top" className="text-xs">
              {disabledMessage}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      ) : (
        trigger
      )}

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle>Stock In — {product.name}</DialogTitle>
          </DialogHeader>

          <div className="space-y-2">
            <Label htmlFor="shop-stock-in-qty" className="text-xs font-medium text-slate-700">
              Quantity
            </Label>
            <Input
              id="shop-stock-in-qty"
              type="number"
              inputMode="numeric"
              min={1}
              max={1_000_000}
              step={1}
              placeholder="Enter quantity"
              value={rawValue}
              onChange={(e) => setRawValue(e.target.value)}
              aria-invalid={validation !== null && !validation.ok}
              autoFocus
            />
            {validation !== null && !validation.ok ? (
              <p className="text-xs text-destructive">
                {rejectionMessage(validation.reason)}
              </p>
            ) : null}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => handleOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="button" disabled={!isValid} onClick={handleAdd}>
              Add to Cart
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
