"use client";

import { type ReactNode, useRef, useState } from "react";
import { format } from "date-fns";
import { CalendarIcon, Paperclip, X } from "lucide-react";
import { toast } from "sonner";

import {
  INVENTORY_SOURCE_LABELS,
  INVENTORY_SOURCE_TYPES,
  validatePurchaseOrderFile,
  type BaseUom,
  type InventorySourceType,
} from "@/lib/inventory/product-schema";
import { cn } from "@/lib/utils";
import { useInventoryStore } from "@/shared/stores/useInventoryStore";
import { Button } from "@/shared/components/ui/button";
import { Calendar } from "@/shared/components/ui/calendar";
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
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/shared/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";

const BASE_UOM_LABELS: Record<BaseUom, string> = {
  KG: "KG",
  LITRE: "Litre",
  UNIT: "Unit",
};

const PURCHASE_ORDER_ACCEPT = ".jpg,.jpeg,.png,.webp,.pdf";

interface ReceiveStockModalProps {
  productId: string;
  productName: string;
  baseUom: BaseUom;
  trigger?: ReactNode;
}

export default function ReceiveStockModal({
  productId,
  productName,
  baseUom,
  trigger,
}: ReceiveStockModalProps) {
  const addInboundItem = useInventoryStore((state) => state.addInboundItem);
  const [open, setOpen] = useState(false);
  const [quantity, setQuantity] = useState("");
  const [totalCost, setTotalCost] = useState("");
  const [expiryDate, setExpiryDate] = useState<Date | undefined>();
  const [isCalendarOpen, setIsCalendarOpen] = useState(false);
  const [sourceType, setSourceType] = useState<InventorySourceType | "">("");
  const [sourceName, setSourceName] = useState("");
  const [purchaseOrderFile, setPurchaseOrderFile] = useState<
    File | undefined
  >();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const uomLabel = BASE_UOM_LABELS[baseUom];

  function resetForm() {
    setQuantity("");
    setTotalCost("");
    setExpiryDate(undefined);
    setIsCalendarOpen(false);
    setSourceType("");
    setSourceName("");
    setPurchaseOrderFile(undefined);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }

  function handleOpenChange(nextOpen: boolean) {
    setOpen(nextOpen);
    if (!nextOpen) {
      resetForm();
    }
  }

  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) {
      setPurchaseOrderFile(undefined);
      return;
    }

    const validationError = validatePurchaseOrderFile(file);
    if (validationError) {
      toast.error(validationError);
      event.target.value = "";
      setPurchaseOrderFile(undefined);
      return;
    }

    setPurchaseOrderFile(file);
  }

  function clearPurchaseOrderFile() {
    setPurchaseOrderFile(undefined);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!sourceType) {
      toast.error("Select a source.");
      return;
    }

    if (sourceType === "OTHER" && !sourceName.trim()) {
      toast.error("Enter the source name.");
      return;
    }

    addInboundItem({
      productId,
      name: productName,
      qty: Number(quantity),
      cost: Number(totalCost),
      expiry: expiryDate ? format(expiryDate, "yyyy-MM-dd") : undefined,
      sourceType,
      sourceName: sourceType === "OTHER" ? sourceName.trim() : undefined,
      purchaseOrderFile,
    });

    toast.success("Added to Staging");
    resetForm();
    setOpen(false);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button type="button" variant="secondary" className="w-full">
            + Receive Stock
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Receive Inbound Stock: {productName}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor={`quantity-${productId}`}>
              Quantity Received ({uomLabel})
            </Label>
            <Input
              id={`quantity-${productId}`}
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
            <Label htmlFor={`totalCost-${productId}`}>
              Total Purchase Cost (INR)
            </Label>
            <Input
              id={`totalCost-${productId}`}
              type="number"
              min={0}
              step="0.01"
              required
              value={totalCost}
              onChange={(e) => setTotalCost(e.target.value)}
              placeholder="Enter total purchase cost"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor={`source-${productId}`}>Source</Label>
            <Select
              value={sourceType}
              onValueChange={(value) => {
                setSourceType(value as InventorySourceType);
                if (value !== "OTHER") {
                  setSourceName("");
                }
              }}
              required
            >
              <SelectTrigger id={`source-${productId}`}>
                <SelectValue placeholder="Select source" />
              </SelectTrigger>
              <SelectContent>
                {INVENTORY_SOURCE_TYPES.map((option) => (
                  <SelectItem key={option} value={option}>
                    {INVENTORY_SOURCE_LABELS[option]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {sourceType === "OTHER" && (
            <div className="space-y-2">
              <Label htmlFor={`source-name-${productId}`}>
                Other Source Name
              </Label>
              <Input
                id={`source-name-${productId}`}
                required
                maxLength={255}
                value={sourceName}
                onChange={(e) => setSourceName(e.target.value)}
                placeholder="Enter the source name"
              />
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor={`purchase-order-${productId}`}>
              Purchase Order (Optional)
            </Label>
            <Input
              id={`purchase-order-${productId}`}
              ref={fileInputRef}
              type="file"
              accept={PURCHASE_ORDER_ACCEPT}
              onChange={handleFileChange}
            />
            {purchaseOrderFile && (
              <div className="flex items-center justify-between rounded-md border bg-muted/40 px-3 py-2 text-sm">
                <span className="flex min-w-0 items-center gap-2">
                  <Paperclip className="h-4 w-4 shrink-0" />
                  <span className="truncate">{purchaseOrderFile.name}</span>
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 shrink-0"
                  onClick={clearPurchaseOrderFile}
                  aria-label="Remove purchase order file"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              JPEG, PNG, WebP, or PDF up to 5 MB.
            </p>
          </div>

          <div className="space-y-2">
            <Label>Expiry Date (Optional)</Label>
            <Popover open={isCalendarOpen} onOpenChange={setIsCalendarOpen}>
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  className={cn(
                    "w-full justify-start text-left font-normal",
                    !expiryDate && "text-muted-foreground",
                  )}
                >
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {expiryDate
                    ? format(expiryDate, "PPP")
                    : "Auto-calculated from durability"}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  selected={expiryDate}
                  onSelect={(date) => {
                    setExpiryDate(date);
                    setIsCalendarOpen(false);
                  }}
                  initialFocus
                />
              </PopoverContent>
            </Popover>
            <p className="text-xs text-muted-foreground">
              Leave blank to auto-calculate expiry from the product&apos;s
              durability setting.
            </p>
          </div>

          <Button type="submit" className="w-full">
            Add to Inbound Cart
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
