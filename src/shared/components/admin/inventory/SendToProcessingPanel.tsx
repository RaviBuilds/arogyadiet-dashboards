"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import { Loader2, PackageOpen, Send } from "lucide-react";
import { toast } from "sonner";

import { dispatchToManufacturingAction } from "@/actions/inventory-actions";
import {
  type ActiveRawMaterialLot,
  type BaseUom,
} from "@/lib/inventory/product-schema";
import { Button } from "@/shared/components/ui/button";
import { Card, CardContent } from "@/shared/components/ui/card";
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
    <Card className="border-slate-200 shadow-sm">
      <CardContent className="space-y-4 p-5">
        <div className="flex items-center gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
            <Send className="size-4 text-primary" />
          </div>
          <div>
            <p className="text-[15px] font-semibold leading-snug text-slate-900">
              Send Raw Material to Processing
            </p>
            <p className="text-xs text-slate-500">
              Dispatch raw material lots into work-in-progress.
            </p>
          </div>
        </div>

        {activeLots.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-200 bg-slate-50/60 px-6 py-12 text-center">
            <PackageOpen className="mb-3 size-10 text-slate-300" />
            <p className="font-medium text-slate-900">No active raw material lots</p>
            <p className="mt-1 text-sm text-slate-500">
              Receive stock for raw materials in the Master Catalog first.
            </p>
          </div>
        ) : (
          <div className="max-h-[520px] space-y-2.5 overflow-y-auto pr-1">
            {activeLots.map((lot) => {
              const uomLabel = BASE_UOM_LABELS[lot.baseUom];
              const isRowPending = isPending && pendingLotId === lot.id;

              return (
                <div
                  key={lot.id}
                  className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-3.5 transition-colors hover:border-slate-300 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <p className="text-sm font-semibold text-slate-900">
                      {lot.productName}
                    </p>
                    <p className="text-xs text-slate-500">
                      Batch {lot.batchNumber} · Expires{" "}
                      {format(new Date(lot.expiryDate), "d MMM yyyy")}
                    </p>
                    <p className="text-xs text-slate-500">
                      <span className="font-medium text-slate-700">
                        {lot.quantityRemaining} {uomLabel}
                      </span>{" "}
                      remaining
                    </p>
                  </div>

                  <div className="flex shrink-0 items-center gap-2">
                    <Input
                      type="number"
                      min={0.01}
                      max={lot.quantityRemaining}
                      step="0.01"
                      placeholder={`Qty (${uomLabel})`}
                      className="w-28 border-slate-200"
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
