"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { format, formatDistanceToNow } from "date-fns";
import { CalendarIcon, Layers, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { processBatchOutputAction } from "@/actions/inventory-actions";
import {
  type BaseUom,
  type FinishedGoodOption,
  type ManufacturingBatch,
} from "@/lib/inventory/product-schema";
import { cn } from "@/lib/utils";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { Calendar } from "@/shared/components/ui/calendar";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/shared/components/ui/card";
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
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Layers className="h-5 w-5" />
          Pending Batches (Multi-Material)
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {batches.map((batch) => (
            <BatchCard key={batch.id} batch={batch} />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function BatchCard({ batch }: { batch: ManufacturingBatch }) {
  return (
    <Card className="border-border/70 shadow-none">
      <CardContent className="space-y-2 p-4">
        <p className="font-semibold text-foreground">{batch.name}</p>
        <div className="flex flex-wrap gap-1">
          {batch.orders.map((order) => (
            <Badge key={order.id} variant="secondary" className="text-xs">
              {order.rawProductName}: {order.quantitySent}{" "}
              {BASE_UOM_LABELS[order.baseUom]}
            </Badge>
          ))}
        </div>
        <p className="text-sm text-muted-foreground">
          Total Input: {batch.totalInputWeight} · Value: ₹
          {batch.totalCostValue.toFixed(2)}
        </p>
        <p className="text-xs text-muted-foreground">
          {formatDistanceToNow(new Date(batch.createdAt), { addSuffix: true })}
        </p>
        <div className="pt-1">
          <ProcessBatchOutputDialog batch={batch} />
        </div>
      </CardContent>
    </Card>
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
