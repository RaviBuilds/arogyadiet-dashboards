"use client";

import { type ReactNode, useState } from "react";
import { toast } from "sonner";

import {
  STATIC_DISPATCH_REASONS,
  CLINIC_DISPATCH_PREFIX,
  type BaseUom,
  type CoreClinicDestination,
  type DispatchStockReason,
} from "@/lib/inventory/product-schema";
import type { FranchiseDestination } from "@/lib/franchise-inventory/active-destination-filter";
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
  /** Core (non-franchise) clinics available as dispatch destinations. */
  coreClinicDestinations?: CoreClinicDestination[];
}

export default function DispatchStockModal({
  productId,
  productName,
  baseUom,
  trigger,
  franchiseDestinations = [],
  coreClinicDestinations = [],
}: DispatchStockModalProps) {
  const addOutboundItem = useInventoryStore((state) => state.addOutboundItem);
  const [open, setOpen] = useState(false);
  const [quantity, setQuantity] = useState("");
  const [destination, setDestination] = useState("");

  const uomLabel = BASE_UOM_LABELS[baseUom];

  const isFranchiseDestination = destination.startsWith(FRANCHISE_PREFIX);
  const isClinicDestination = destination.startsWith(CLINIC_DISPATCH_PREFIX);
  // The selector is disabled only when there are zero options total.
  const hasNoDestinations =
    (STATIC_DISPATCH_REASONS as readonly string[]).length === 0 &&
    coreClinicDestinations.length === 0 &&
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
      // Add franchise dispatch to outbound cart (same pattern as other destinations)
      const franchiseId = destination.slice(FRANCHISE_PREFIX.length);
      const franchise = franchiseDestinations.find((f) => f.id === franchiseId);
      const franchiseName = franchise?.name ?? "Unknown Franchise";

      // Use a synthetic reason for display; the actual dispatch will use the franchise RPC
      addOutboundItem({
        productId,
        name: productName,
        qty,
        reason: `Sent to ${franchiseName}` as DispatchStockReason,
        franchiseId,
        franchiseName,
      });

      toast.success("Added to Outbound Cart", {
        description: `${qty} ${uomLabel} of "${productName}" → ${franchiseName}`,
      });
      resetForm();
      setOpen(false);
    } else if (isClinicDestination) {
      const clinicId = destination.slice(CLINIC_DISPATCH_PREFIX.length);
      const clinic = coreClinicDestinations.find((c) => c.id === clinicId);
      const clinicName = clinic?.name ?? "Unknown Clinic";
      // Stored as a plain text reason snapshot in inventory_transactions.reason
      addOutboundItem({
        productId,
        name: productName,
        qty,
        reason: `Sent to ${clinicName}` as DispatchStockReason,
      });

      toast.success("Added to Outbound Cart", {
        description: `${qty} ${uomLabel} of "${productName}" → ${clinicName}`,
      });
      resetForm();
      setOpen(false);
    } else {
      // Existing branch-based dispatch via outbound cart
      addOutboundItem({
        productId,
        name: productName,
        qty,
        reason: destination as DispatchStockReason,
      });

      toast.success("Added to Outbound Cart");
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
                  {/* Fixed non-entity dispatch reasons */}
                  {STATIC_DISPATCH_REASONS.length > 0 && (
                    <SelectGroup>
                      <SelectLabel>Reasons</SelectLabel>
                      {STATIC_DISPATCH_REASONS.map((option) => (
                        <SelectItem key={option} value={option}>
                          {option}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  )}

                  {/* Core clinic destinations — dynamically from clinics table */}
                  <SelectGroup>
                    <SelectLabel>Core Clinics</SelectLabel>
                    {coreClinicDestinations.length > 0 ? (
                      coreClinicDestinations.map((clinic) => (
                        <SelectItem
                          key={clinic.id}
                          value={`${CLINIC_DISPATCH_PREFIX}${clinic.id}`}
                        >
                          {clinic.name}
                        </SelectItem>
                      ))
                    ) : (
                      <SelectItem value="__no_clinics__" disabled>
                        No core clinics configured
                      </SelectItem>
                    )}
                  </SelectGroup>

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
            first) when the outbound batch is processed.
          </p>

          <Button
            type="submit"
            variant="destructive"
            disabled={!destination || hasNoDestinations}
            className="w-full"
          >
            Add to Outbound Cart
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

