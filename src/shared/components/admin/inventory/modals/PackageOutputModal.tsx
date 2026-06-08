"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import { CalendarIcon, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { processOutputAction } from "@/actions/inventory-actions";
import {
  type BaseUom,
  type FinishedGoodOption,
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

interface PackageOutputModalProps {
  mfgOrderId: string;
  remainingToPackage: number;
  rawBaseUom: BaseUom;
  finishedGoods: FinishedGoodOption[];
}

export default function PackageOutputModal({
  mfgOrderId,
  remainingToPackage,
  rawBaseUom,
  finishedGoods,
}: PackageOutputModalProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [finishedProductId, setFinishedProductId] = useState("");
  const [packageSize, setPackageSize] = useState("");
  const [packageCount, setPackageCount] = useState("");
  const [expiryDate, setExpiryDate] = useState<Date | undefined>();
  const [isCalendarOpen, setIsCalendarOpen] = useState(false);

  const uomLabel = BASE_UOM_LABELS[rawBaseUom];

  const totalOutput = useMemo(() => {
    const size = Number(packageSize);
    const count = Number(packageCount);
    if (!Number.isFinite(size) || !Number.isFinite(count)) {
      return 0;
    }
    return size * count;
  }, [packageSize, packageCount]);

  const exceedsLimit = totalOutput > remainingToPackage;

  function resetForm() {
    setFinishedProductId("");
    setPackageSize("");
    setPackageCount("");
    setExpiryDate(undefined);
    setIsCalendarOpen(false);
  }

  function handleOpenChange(nextOpen: boolean) {
    setOpen(nextOpen);
    if (!nextOpen) {
      resetForm();
    }
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (exceedsLimit) {
      toast.error(
        `Output weight exceeds remaining raw material (${remainingToPackage} ${uomLabel}).`,
      );
      return;
    }

    if (!expiryDate) {
      toast.error("Expiry date is required.");
      return;
    }

    startTransition(async () => {
      const formData = new FormData();
      formData.append("mfgOrderId", mfgOrderId);
      formData.append("finishedProductId", finishedProductId);
      formData.append("packageSize", packageSize);
      formData.append("packageCount", packageCount);
      formData.append("expiryDate", format(expiryDate, "yyyy-MM-dd"));

      const result = await processOutputAction(formData);

      if (result.success) {
        toast.success(`Finished goods added to stock (${result.batchNumber}).`);
        resetForm();
        setOpen(false);
        router.refresh();
        return;
      }

      toast.error(result.error);
    });
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button type="button" size="sm">
          Process Output
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Process Manufacturing Output</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor={`finishedProduct-${mfgOrderId}`}>
              Target Finished Good
            </Label>
            <Select
              value={finishedProductId}
              onValueChange={setFinishedProductId}
              required
            >
              <SelectTrigger id={`finishedProduct-${mfgOrderId}`}>
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
            <Label htmlFor={`packageSize-${mfgOrderId}`}>Package Size</Label>
            <Input
              id={`packageSize-${mfgOrderId}`}
              type="number"
              min={0.01}
              step="0.01"
              required
              value={packageSize}
              onChange={(e) => setPackageSize(e.target.value)}
              placeholder={`e.g. 1 for 1 ${uomLabel}`}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor={`packageCount-${mfgOrderId}`}>Package Count</Label>
            <Input
              id={`packageCount-${mfgOrderId}`}
              type="number"
              min={1}
              step={1}
              required
              value={packageCount}
              onChange={(e) => setPackageCount(e.target.value)}
              placeholder="e.g. 100 bottles"
            />
          </div>

          <p
            className={cn(
              "text-sm font-medium",
              exceedsLimit ? "text-destructive" : "text-muted-foreground",
            )}
          >
            Total Output: {totalOutput || 0} / {remainingToPackage} {uomLabel}{" "}
            remaining
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
                  {expiryDate ? format(expiryDate, "PPP") : "Select expiry date"}
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
