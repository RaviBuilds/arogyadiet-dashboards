"use client";

import { type ReactNode, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import {
  DISPATCH_STOCK_REASONS,
  type BaseUom,
  type DispatchStockReason,
} from "@/lib/inventory/product-schema";
import type { FranchiseDestination } from "@/lib/franchise-inventory/active-destination-filter";
import { dispatchToFranchiseAction } from "@/actions/admin-actions/franchiseDispatchActions";
import { useInventoryStore } from "@/shared/stores/useInventoryStore";
import { Button } from "@/shared/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/shared/components/ui/dialog";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";

const BASE_UOM_LABELS: Record<BaseUom, string> = {
  KG: "KG",
  LITRE: "Litre",
  UNIT: "Unit",
};

/** Prefix used to identify franchise destination values in the selector. */
const FRANCHISE_PREFIX = "franchise:";

export interface DispatchStockModalProps {
  productId: string;
  productName: string;
  baseUom: BaseUom;
  trigger?: ReactNode;
  /** Active franchise destinations available for dispatch. */
  franchiseDestinations?: FranchiseDestination[];
}

export default function DispatchStockModal({
  productId,
  productName,
  baseUom,
  trigger,
  franchiseDestinations = [],
}: DispatchStockModalProps) {
  const addOutboundItem = useInventoryStore((state) => state.addOutboundItem);
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [quantity, setQuantity] = useState("");
  const [destination, setDestination] = useState("");
  const [isPending, startTransition] = useTransition();

  const uomLabel = BASE_UOM_LABELS[baseUom];

  const isFranchiseDestination = destination.startsWith(FRANCHISE_PREFIX);
  // The selector is disabled only when there are zero options total.
  // DISPATCH_STOCK_REASONS is a fixed const array (always has items), so
  // hasNoDestinations is effectively never true — but we keep the check
  // for robustness if the constant is ever emptied.
  const hasNoDestinations =
    (DISPATCH_STOCK_REASONS as readonly string[]).length === 0 &&
    franchiseDestinations.length === 0;

  function resetForm() {
    setQuantity("");
    setDestination("");
  }

  function handleOpenChange(nextOpen: boolean) {
    setOpen(nextOpen);
    if (!nextOpen) {
      resetForm();
    }
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!destination) {
      toast.error("Select a dispatch reason or destination.");
      return;
    }

    const qty = Number(quantity);

    if (isFranchiseDestination) {
      // Dispatch to franchise via dedicated server action
      const franchiseId = destination.slice(FRANCHISE_PREFIX.length);

      startTransition(async () => {
        const formData = new FormData();
        formData.set("dest_franchise_id", franchiseId);
        formData.set("product_id", productId);
        formData.set("quantity", String(qty));

        const result = await dispatchToFranchiseAction(formData);

        if (result.success) {
          toast.success(`Dispatched ${qty} ${uomLabel} to franchise`);
          resetForm();
          setOpen(false);
          router.refresh();
        } else {
          toast.error(result.error);
        }
      });
    } else {
      // Existing branch-based dispatch via outbound cart
      addOutboundItem({
        productId,
        name: productName,
        qty,
        reason: destination as DispatchStockReason,
      });

      toast.success("Added to Staging");
      resetForm();
      setOpen(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button type="button" variant="outline" className="w-full">
            - Dispatch
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Dispatch Stock: {productName}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor={`dispatch-quantity-${productId}`}>
              Quantity to Dispatch ({uomLabel})
            </Label>
            <Input
              id={`dispatch-quantity-${productId}`}
              type="number"
              min={0.01}
              step="0.01"
              required
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              placeholder={`Enter quantity in ${uomLabel}`}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor={`dispatch-reason-${productId}`}>
              Reason / Destination
            </Label>
            {hasNoDestinations ? (
              <p className="rounded-md border border-dashed px-3 py-2 text-sm text-muted-foreground">
                No destinations available
              </p>
            ) : (
              <Select
                value={destination}
                onValueChange={setDestination}
                required
                disabled={hasNoDestinations}
              >
                <SelectTrigger id={`dispatch-reason-${productId}`}>
                  <SelectValue placeholder="Select reason or destination" />
                </SelectTrigger>
                <SelectContent>
                  {/* Existing non-franchise dispatch reasons */}
                  {DISPATCH_STOCK_REASONS.length > 0 && (
                    <SelectGroup>
                      <SelectLabel>Reasons</SelectLabel>
                      {DISPATCH_STOCK_REASONS.map((option) => (
                        <SelectItem key={option} value={option}>
                          {option}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  )}

                  {/* Active franchise destinations */}
                  {franchiseDestinations.length > 0 && (
                    <SelectGroup>
                      <SelectLabel>Franchise Destinations</SelectLabel>
                      {franchiseDestinations.map((franchise) => (
                        <SelectItem
                          key={franchise.id}
                          value={`${FRANCHISE_PREFIX}${franchise.id}`}
                        >
                          {franchise.name}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  )}

                  {/* Show message if no active franchises exist */}
                  {franchiseDestinations.length === 0 && (
                    <SelectGroup>
                      <SelectLabel>Franchise Destinations</SelectLabel>
                      <SelectItem value="__no_franchises__" disabled>
                        No active franchises available
                      </SelectItem>
                    </SelectGroup>
                  )}
                </SelectContent>
              </Select>
            )}
          </div>

          <p className="text-sm text-muted-foreground">
            Note: Stock will be deducted automatically using FIFO (oldest expiry
            first).
            {isFranchiseDestination &&
              " Franchise dispatch is processed immediately."}
          </p>

          <Button
            type="submit"
            variant="destructive"
            disabled={!destination || hasNoDestinations || isPending}
            className="w-full"
          >
            {isPending
              ? "Dispatching..."
              : isFranchiseDestination
                ? "Dispatch to Franchise"
                : "Add to Outbound Cart"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

