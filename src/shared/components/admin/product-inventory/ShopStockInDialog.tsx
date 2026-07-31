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
  onAdded,
}: ShopStockInDialogProps) {
  const [open, setOpen] = useState(false);
  const [rawValue, setRawValue] = useState("");
  const addShopStockInLine = useInventoryStore(
    (state) => state.addShopStockInLine,
  );

  const isUnlinked = !product.inventory_product_id;

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
    if (isUnlinked) return; // never openable for an unlinked product (Req 7.15)
    setOpen(next);
    if (!next) {
      setRawValue("");
    }
  };

  const handleAdd = () => {
    if (!validation || !validation.ok) return;

    addShopStockInLine({
      clinicId,
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
      disabled={isUnlinked}
      onClick={() => handleOpenChange(true)}
    >
      <Plus className="h-3.5 w-3.5" />
      Stock In
    </Button>
  );

  return (
    <>
      {isUnlinked ? (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              {/* span wrapper so the tooltip fires even though the button is disabled */}
              <span className="inline-flex" title={UNLINKED_MESSAGE}>
                {trigger}
              </span>
            </TooltipTrigger>
            <TooltipContent side="top" className="text-xs">
              {UNLINKED_MESSAGE}
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
