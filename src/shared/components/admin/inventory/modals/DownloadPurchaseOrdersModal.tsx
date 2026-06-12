"use client";

import { useMemo, useState } from "react";
import { format } from "date-fns";
import { CalendarIcon, FileDown, Loader2 } from "lucide-react";
import { toast } from "sonner";

import {
  PRODUCT_TYPES,
  type ProductType,
} from "@/lib/inventory/product-schema";
import { cn } from "@/lib/utils";
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
import { ScrollArea } from "@/shared/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";

const TYPE_LABELS: Record<"ALL" | ProductType, string> = {
  ALL: "All Products",
  RAW_MATERIAL: "Raw Materials",
  FINISHED_GOOD: "Finished Goods",
};

export type PurchaseOrderProductOption = {
  id: string;
  name: string;
  type: ProductType;
};

interface DownloadPurchaseOrdersModalProps {
  products: PurchaseOrderProductOption[];
}

export default function DownloadPurchaseOrdersModal({
  products,
}: DownloadPurchaseOrdersModalProps) {
  const [open, setOpen] = useState(false);
  const [fromDate, setFromDate] = useState<Date | undefined>();
  const [toDate, setToDate] = useState<Date | undefined>();
  const [isFromOpen, setIsFromOpen] = useState(false);
  const [isToOpen, setIsToOpen] = useState(false);
  const [typeFilter, setTypeFilter] = useState<"ALL" | ProductType>("ALL");
  const [productSearch, setProductSearch] = useState("");
  const [selectedProductIds, setSelectedProductIds] = useState<string[]>([]);
  const [isDownloading, setIsDownloading] = useState(false);

  const visibleProducts = useMemo(() => {
    const query = productSearch.trim().toLowerCase();
    return products
      .filter((product) => typeFilter === "ALL" || product.type === typeFilter)
      .filter(
        (product) => !query || product.name.toLowerCase().includes(query),
      );
  }, [products, typeFilter, productSearch]);

  function toggleProduct(id: string) {
    setSelectedProductIds((current) =>
      current.includes(id)
        ? current.filter((productId) => productId !== id)
        : [...current, id],
    );
  }

  async function handleDownload() {
    if (!fromDate || !toDate) {
      toast.error("Select a start and end date.");
      return;
    }

    if (toDate < fromDate) {
      toast.error("End date must be on or after the start date.");
      return;
    }

    const params = new URLSearchParams({
      from: format(fromDate, "yyyy-MM-dd"),
      to: format(toDate, "yyyy-MM-dd"),
    });
    if (typeFilter !== "ALL") {
      params.set("type", typeFilter);
    }
    if (selectedProductIds.length > 0) {
      params.set("productIds", selectedProductIds.join(","));
    }

    setIsDownloading(true);
    try {
      const response = await fetch(
        `/api/admin/inventory/purchase-orders/export?${params.toString()}`,
      );

      if (!response.ok) {
        let message = "Failed to download purchase orders.";
        try {
          const body = (await response.json()) as { error?: string };
          if (body.error) {
            message = body.error;
          }
        } catch {
          // Non-JSON error body; keep the default message.
        }
        toast.error(message);
        return;
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `purchase-orders_${format(fromDate, "yyyy-MM-dd")}_to_${format(toDate, "yyyy-MM-dd")}.zip`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);

      toast.success("Purchase orders downloaded.");
      setOpen(false);
    } catch {
      toast.error("Failed to download purchase orders.");
    } finally {
      setIsDownloading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline">
          <FileDown className="mr-1 h-4 w-4" />
          Download POs
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Download Purchase Orders</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>From Date</Label>
              <Popover open={isFromOpen} onOpenChange={setIsFromOpen}>
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    className={cn(
                      "w-full justify-start text-left font-normal",
                      !fromDate && "text-muted-foreground",
                    )}
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {fromDate ? format(fromDate, "PP") : "Start date"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={fromDate}
                    onSelect={(date) => {
                      setFromDate(date);
                      setIsFromOpen(false);
                    }}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
            </div>
            <div className="space-y-2">
              <Label>To Date</Label>
              <Popover open={isToOpen} onOpenChange={setIsToOpen}>
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    className={cn(
                      "w-full justify-start text-left font-normal",
                      !toDate && "text-muted-foreground",
                    )}
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {toDate ? format(toDate, "PP") : "End date"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={toDate}
                    onSelect={(date) => {
                      setToDate(date);
                      setIsToOpen(false);
                    }}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Product Type</Label>
            <Select
              value={typeFilter}
              onValueChange={(value) => {
                setTypeFilter(value as "ALL" | ProductType);
                setSelectedProductIds([]);
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">{TYPE_LABELS.ALL}</SelectItem>
                {PRODUCT_TYPES.map((type) => (
                  <SelectItem key={type} value={type}>
                    {TYPE_LABELS[type]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Products (optional)</Label>
            <p className="text-xs text-muted-foreground">
              Leave all unchecked to include every product, or pick one or more
              specific products.
            </p>
            <Input
              placeholder="Search products..."
              value={productSearch}
              onChange={(event) => setProductSearch(event.target.value)}
            />
            <ScrollArea className="h-44 rounded-md border p-2">
              {visibleProducts.length === 0 ? (
                <p className="px-2 py-4 text-center text-sm text-muted-foreground">
                  No products found.
                </p>
              ) : (
                visibleProducts.map((product) => (
                  <label
                    key={product.id}
                    className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted"
                  >
                    <input
                      type="checkbox"
                      className="size-4 accent-orange-600"
                      checked={selectedProductIds.includes(product.id)}
                      onChange={() => toggleProduct(product.id)}
                    />
                    <span className="truncate">{product.name}</span>
                  </label>
                ))
              )}
            </ScrollArea>
            {selectedProductIds.length > 0 && (
              <p className="text-xs text-muted-foreground">
                {selectedProductIds.length} product
                {selectedProductIds.length === 1 ? "" : "s"} selected.
              </p>
            )}
          </div>

          <Button
            type="button"
            className="w-full"
            disabled={isDownloading || !fromDate || !toDate}
            onClick={handleDownload}
          >
            {isDownloading ? (
              <>
                <Loader2 className="animate-spin" />
                Preparing ZIP...
              </>
            ) : (
              <>
                <FileDown />
                Download ZIP
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
