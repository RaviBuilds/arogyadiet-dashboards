"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import { Loader2, PackageOpen } from "lucide-react";
import { toast } from "sonner";

import { dispatchToManufacturingAction } from "@/actions/inventory-actions";
import {
  type ActiveRawMaterialLot,
  type BaseUom,
} from "@/lib/inventory/product-schema";
import { Button } from "@/shared/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/shared/components/ui/card";
import { Input } from "@/shared/components/ui/input";

const BASE_UOM_LABELS: Record<BaseUom, string> = {
  KG: "KG",
  LITRE: "Litre",
  UNIT: "Unit",
};

interface SendToProcessingPanelProps {
  activeLots: ActiveRawMaterialLot[];
}

export default function SendToProcessingPanel({
  activeLots,
}: SendToProcessingPanelProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [pendingLotId, setPendingLotId] = useState<string | null>(null);
  const [quantities, setQuantities] = useState<Record<string, string>>({});

  function handleDispatch(lot: ActiveRawMaterialLot) {
    const quantityToSend = quantities[lot.id];
    if (!quantityToSend) {
      toast.error("Enter a quantity to dispatch.");
      return;
    }

    startTransition(async () => {
      setPendingLotId(lot.id);
      const formData = new FormData();
      formData.append("lotId", lot.id);
      formData.append("quantityToSend", quantityToSend);

      const result = await dispatchToManufacturingAction(formData);
      setPendingLotId(null);

      if (result.success) {
        toast.success("Raw material dispatched to processing.");
        setQuantities((prev) => {
          const next = { ...prev };
          delete next[lot.id];
          return next;
        });
        router.refresh();
        return;
      }

      toast.error(result.error);
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Send Raw Material to Processing</CardTitle>
      </CardHeader>
      <CardContent>
        {activeLots.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-lg border border-dashed bg-muted/30 px-6 py-12 text-center">
            <PackageOpen className="mb-3 size-10 text-muted-foreground/60" />
            <p className="font-medium text-foreground">No active raw material lots</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Receive stock for raw materials in the Master Catalog first.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {activeLots.map((lot) => {
              const uomLabel = BASE_UOM_LABELS[lot.baseUom];
              const isRowPending = isPending && pendingLotId === lot.id;

              return (
                <div
                  key={lot.id}
                  className="flex flex-col gap-3 rounded-lg border bg-background p-4 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0 flex-1 space-y-1">
                    <p className="font-semibold text-foreground">
                      {lot.productName}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      Batch: {lot.batchNumber}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      Remaining: {lot.quantityRemaining} {uomLabel} · Unit cost: ₹
                      {lot.unitCost.toFixed(2)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Expires: {format(new Date(lot.expiryDate), "PPP")}
                    </p>
                  </div>

                  <div className="flex shrink-0 items-center gap-2">
                    <Input
                      type="number"
                      min={0.01}
                      max={lot.quantityRemaining}
                      step="0.01"
                      placeholder={`Qty (${uomLabel})`}
                      className="w-28"
                      value={quantities[lot.id] ?? ""}
                      onChange={(e) =>
                        setQuantities((prev) => ({
                          ...prev,
                          [lot.id]: e.target.value,
                        }))
                      }
                    />
                    <Button
                      type="button"
                      size="sm"
                      disabled={isRowPending}
                      onClick={() => handleDispatch(lot)}
                    >
                      {isRowPending ? (
                        <>
                          <Loader2 className="animate-spin" />
                          Sending...
                        </>
                      ) : (
                        "Dispatch"
                      )}
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
