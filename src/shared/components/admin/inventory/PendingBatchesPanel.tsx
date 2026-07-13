"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { format, formatDistanceToNow } from "date-fns";
import { Blend, CalendarIcon, Loader2, Undo2 } from "lucide-react";
import { toast } from "sonner";

import {
  processBatchOutputAction,
  revertPendingBatchAction,
} from "@/actions/inventory-actions";
import {
  type BaseUom,
  type FinishedGoodOption,
  type ManufacturingBatch,
} from "@/lib/inventory/product-schema";
import { cn } from "@/lib/utils";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/shared/components/ui/alert-dialog";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { Calendar } from "@/shared/components/ui/calendar";
import { Card, CardContent } from "@/shared/components/ui/card";
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

interface PendingBatchesPanelProps {
  batches: ManufacturingBatch[];
}

export default function PendingBatchesPanel({
  batches,
}: PendingBatchesPanelProps) {
  return (
    <Card className="border-slate-200 shadow-sm">
      <CardContent className="space-y-4 p-5">
        <div className="flex items-center gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
            <Blend className="size-4 text-primary" />
          </div>
          <div>
            <p className="text-[15px] font-semibold leading-snug text-slate-900">
              Pending Batches (Multi-Material)
            </p>
            <p className="text-xs text-slate-500">
              Combined raw material batches awaiting output.
            </p>
          </div>
        </div>

        <div className="max-h-[520px] space-y-3 overflow-y-auto pr-1">
          {batches.map((batch) => (
            <BatchCard key={batch.id} batch={batch} />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function BatchCard({ batch }: { batch: ManufacturingBatch }) {
  const router = useRouter();
  const [isReverting, startRevertTransition] = useTransition();

  // Group orders by raw product name so a mixture reads as "N raw
  // materials" even when one ingredient spans multiple batches/lots.
  const ordersByProduct = useMemo(() => {
    const groups = new Map<
      string,
      { productName: string; baseUom: (typeof batch.orders)[number]["baseUom"]; orders: typeof batch.orders }
    >();

    for (const order of batch.orders) {
      const existing = groups.get(order.rawProductName);
      if (existing) {
        existing.orders.push(order);
      } else {
        groups.set(order.rawProductName, {
          productName: order.rawProductName,
          baseUom: order.baseUom,
          orders: [order],
        });
      }
    }

    return Array.from(groups.values());
  }, [batch.orders]);

  function handleRevert() {
    startRevertTransition(async () => {
      const result = await revertPendingBatchAction(batch.id);

      if (result.success) {
        toast.success(
          `${result.itemsReturned} item${result.itemsReturned === 1 ? "" : "s"} returned to stock.`,
        );
        router.refresh();
        return;
      }

      toast.error(result.error);
    });
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-slate-900">{batch.name}</p>
          <p className="text-xs text-slate-500">
            {ordersByProduct.length} raw material
            {ordersByProduct.length !== 1 ? "s" : ""} ·{" "}
            {formatDistanceToNow(new Date(batch.createdAt), {
              addSuffix: true,
            })}
          </p>
        </div>
        <Badge className="shrink-0 border-0 bg-secondary/15 font-normal text-emerald-800">
          ₹{batch.totalCostValue.toFixed(2)}
        </Badge>
      </div>

      <div className="mt-3 space-y-1.5">
        {ordersByProduct.map((group) => {
          const uomLabel = BASE_UOM_LABELS[group.baseUom];
          const totalQty = group.orders.reduce(
            (sum, o) => sum + o.quantitySent,
            0,
          );
          return (
            <div
              key={group.productName}
              className="flex items-center justify-between gap-3 rounded-lg bg-slate-50/80 px-3 py-2"
            >
              <p className="text-sm font-medium text-slate-800">
                {group.productName}
              </p>
              <p className="text-xs text-slate-500">
                {totalQty} {uomLabel}
                {group.orders.length > 1
                  ? ` · ${group.orders.length} batches`
                  : ""}
              </p>
            </div>
          );
        })}
      </div>

      <p className="mt-2.5 text-xs text-slate-500">
        Total input: {batch.totalInputWeight}
      </p>

      <div className="mt-3 flex flex-wrap gap-2">
        <ProcessBatchOutputDialog batch={batch} />
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="border-slate-200"
              disabled={isReverting}
            >
              {isReverting ? (
                <>
                  <Loader2 className="animate-spin" />
                  Returning...
                </>
              ) : (
                <>
                  <Undo2 />
                  Return to Stock
                </>
              )}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Return batch to stock?</AlertDialogTitle>
              <AlertDialogDescription>
                All {batch.orders.length} raw material
                {batch.orders.length === 1 ? "" : "s"} in this batch will be
                refunded back to their source lots. This batch will be
                closed and removed from the pending queue.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={isReverting}>
                Cancel
              </AlertDialogCancel>
              <AlertDialogAction disabled={isReverting} onClick={handleRevert}>
                Return to Stock
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
}

function ProcessBatchOutputDialog({ batch }: { batch: ManufacturingBatch }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [finishedProductId, setFinishedProductId] = useState("");
  const [packageSize, setPackageSize] = useState("");
  const [packageCount, setPackageCount] = useState("");
  const [expiryDate, setExpiryDate] = useState<Date | undefined>();
  const [isCalendarOpen, setIsCalendarOpen] = useState(false);

  const finishedGoods = batch.allowedFinishedProducts;

  const totalOutput = useMemo(() => {
    const size = Number(packageSize);
    const count = Number(packageCount);
    if (!Number.isFinite(size) || !Number.isFinite(count)) return 0;
    return size * count;
  }, [packageSize, packageCount]);

  const exceedsLimit = totalOutput > batch.totalInputWeight;

  function resetForm() {
    setFinishedProductId("");
    setPackageSize("");
    setPackageCount("");
    setExpiryDate(undefined);
    setIsCalendarOpen(false);
  }

  function handleOpenChange(nextOpen: boolean) {
    setOpen(nextOpen);
    if (!nextOpen) resetForm();
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (exceedsLimit) {
      toast.error(
        `Output weight exceeds total input (${batch.totalInputWeight}).`,
      );
      return;
    }

    if (!expiryDate) {
      toast.error("Expiry date is required.");
      return;
    }

    startTransition(async () => {
      const result = await processBatchOutputAction({
        batchId: batch.id,
        finishedProductId,
        packageSize: Number(packageSize),
        packageCount: Number(packageCount),
        expiryDate: format(expiryDate, "yyyy-MM-dd"),
      });

      if (result.success) {
        toast.success(`Finished goods added to stock (${result.batchNumber}).`);
        resetForm();
        setOpen(false);
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button type="button" size="sm">
          Process Batch Output
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Process Batch Output</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label>Target Finished Good</Label>
            <Select
              value={finishedProductId}
              onValueChange={setFinishedProductId}
              required
            >
              <SelectTrigger>
                <SelectValue placeholder="Select finished good" />
              </SelectTrigger>
              <SelectContent>
                {finishedGoods.map((product) => (
                  <SelectItem key={product.id} value={product.id}>
                    {product.name} ({BASE_UOM_LABELS[product.baseUom]})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Package Size</Label>
            <Input
              type="number"
              min={0.01}
              step="0.01"
              required
              value={packageSize}
              onChange={(e) => setPackageSize(e.target.value)}
              placeholder="e.g. 1"
            />
          </div>

          <div className="space-y-2">
            <Label>Package Count</Label>
            <Input
              type="number"
              min={1}
              step={1}
              required
              value={packageCount}
              onChange={(e) => setPackageCount(e.target.value)}
              placeholder="e.g. 3"
            />
          </div>

          <p
            className={cn(
              "text-sm font-medium",
              exceedsLimit ? "text-destructive" : "text-muted-foreground",
            )}
          >
            Total Output: {totalOutput || 0} / {batch.totalInputWeight} total
            input
          </p>

          <div className="space-y-2">
            <Label>Expiry Date</Label>
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
                    : "Select expiry date"}
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
          </div>

          <Button
            type="submit"
            disabled={isPending || exceedsLimit || finishedGoods.length === 0}
            className="w-full"
          >
            {isPending ? (
              <>
                <Loader2 className="animate-spin" />
                Converting...
              </>
            ) : (
              "Convert & Add to Stock"
            )}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
