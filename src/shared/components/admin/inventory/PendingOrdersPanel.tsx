"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { formatDistanceToNow } from "date-fns";
import { Clock, Loader2, PackageCheck, Undo2 } from "lucide-react";
import { toast } from "sonner";

import { revertPendingMfgAction } from "@/actions/inventory-actions";
import PackageOutputModal from "@/shared/components/admin/inventory/modals/PackageOutputModal";
import {
  type BaseUom,
  type FinishedGoodOption,
  type ManufacturingOrder,
} from "@/lib/inventory/product-schema";
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
import { Card, CardContent } from "@/shared/components/ui/card";

const BASE_UOM_LABELS: Record<BaseUom, string> = {
  KG: "KG",
  LITRE: "Litre",
  UNIT: "Unit",
};

interface PendingOrdersPanelProps {
  pendingOrders: ManufacturingOrder[];
  finishedGoods: FinishedGoodOption[];
  mappedFinishedGoodsMap: Record<string, FinishedGoodOption[]>;
}

export default function PendingOrdersPanel({
  pendingOrders,
  finishedGoods,
  mappedFinishedGoodsMap,
}: PendingOrdersPanelProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [revertingOrderId, setRevertingOrderId] = useState<string | null>(null);

  function handleRevert(order: ManufacturingOrder) {
    startTransition(async () => {
      setRevertingOrderId(order.id);
      const result = await revertPendingMfgAction(order.id);
      setRevertingOrderId(null);

      if (result.success) {
        const uomLabel = BASE_UOM_LABELS[order.baseUom];
        toast.success(
          `${result.refundedQuantity} ${uomLabel} returned to stock.`,
        );
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
            <PackageCheck className="size-4 text-primary" />
          </div>
          <div>
            <p className="text-[15px] font-semibold leading-snug text-slate-900">
              Pending Finished Goods
            </p>
            <p className="text-xs text-slate-500">
              Work-in-progress lots waiting to be packaged.
            </p>
          </div>
        </div>

        {pendingOrders.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-200 bg-slate-50/60 px-6 py-12 text-center">
            <Clock className="mb-3 size-10 text-slate-300" />
            <p className="font-medium text-slate-900">No pending orders</p>
            <p className="mt-1 text-sm text-slate-500">
              Dispatched raw materials awaiting processing will appear here.
            </p>
          </div>
        ) : (
          <div className="max-h-[520px] space-y-2.5 overflow-y-auto pr-1">
            {pendingOrders.map((order) => {
              const uomLabel = BASE_UOM_LABELS[order.baseUom];
              const isReverting =
                isPending && revertingOrderId === order.id;

              return (
                <div
                  key={order.id}
                  className="space-y-3 rounded-xl border border-slate-200 bg-white p-3.5"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-900">
                        {order.rawProductName}
                      </p>
                      <p className="text-xs text-slate-500">
                        Batch {order.batchNumber} ·{" "}
                        {formatDistanceToNow(new Date(order.sentAt), {
                          addSuffix: true,
                        })}
                      </p>
                    </div>
                    <Badge className="shrink-0 border-0 bg-secondary/15 font-normal text-emerald-800">
                      {order.remainingToPackage} {uomLabel} left
                    </Badge>
                  </div>

                  <p className="text-xs text-slate-500">
                    Sent {order.quantitySent} {uomLabel} for processing
                  </p>

                  <div className="flex flex-wrap gap-2">
                    <PackageOutputModal
                      mfgOrderId={order.id}
                      remainingToPackage={order.remainingToPackage}
                      rawBaseUom={order.baseUom}
                      finishedGoods={
                        mappedFinishedGoodsMap[order.rawProductId]?.length > 0
                          ? mappedFinishedGoodsMap[order.rawProductId]
                          : finishedGoods
                      }
                    />
                    {order.remainingToPackage > 0 && (
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="border-slate-200"
                            disabled={isPending}
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
                            <AlertDialogTitle>
                              Return remaining to stock?
                            </AlertDialogTitle>
                            <AlertDialogDescription>
                              {order.remainingToPackage} {uomLabel} will be
                              refunded to batch {order.batchNumber}. This
                              manufacturing order will be closed and removed
                              from the pending queue. Any finished goods
                              already packaged will not be affected.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel disabled={isReverting}>
                              Cancel
                            </AlertDialogCancel>
                            <AlertDialogAction
                              disabled={isReverting}
                              onClick={() => handleRevert(order)}
                            >
                              Return to Stock
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    )}
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
