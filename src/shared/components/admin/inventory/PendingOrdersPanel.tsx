"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { formatDistanceToNow } from "date-fns";
import { Clock, Loader2, Undo2 } from "lucide-react";
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
import { Button } from "@/shared/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/shared/components/ui/card";

const BASE_UOM_LABELS: Record<BaseUom, string> = {
  KG: "KG",
  LITRE: "Litre",
  UNIT: "Unit",
};

interface PendingOrdersPanelProps {
  pendingOrders: ManufacturingOrder[];
  finishedGoods: FinishedGoodOption[];
}

export default function PendingOrdersPanel({
  pendingOrders,
  finishedGoods,
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
    <Card>
      <CardHeader>
        <CardTitle>Pending Finished Goods</CardTitle>
      </CardHeader>
      <CardContent>
        {pendingOrders.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-lg border border-dashed bg-muted/30 px-6 py-12 text-center">
            <Clock className="mb-3 size-10 text-muted-foreground/60" />
            <p className="font-medium text-foreground">No pending orders</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Dispatched raw materials awaiting processing will appear here.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {pendingOrders.map((order) => {
              const uomLabel = BASE_UOM_LABELS[order.baseUom];
              const isReverting =
                isPending && revertingOrderId === order.id;

              return (
                <Card
                  key={order.id}
                  className="border-border/70 shadow-none"
                >
                  <CardContent className="space-y-2 p-4">
                    <p className="font-semibold text-foreground">
                      {order.rawProductName}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      Sent: {order.quantitySent} {uomLabel}
                    </p>
                    <p className="text-sm font-medium text-foreground">
                      Remaining to Package: {order.remainingToPackage}{" "}
                      {uomLabel}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      Batch: {order.batchNumber} · Value: ₹
                      {order.totalCostValue.toFixed(2)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {formatDistanceToNow(new Date(order.sentAt), {
                        addSuffix: true,
                      })}
                    </p>
                    <div className="flex flex-wrap gap-2 pt-1">
                      <PackageOutputModal
                        mfgOrderId={order.id}
                        remainingToPackage={order.remainingToPackage}
                        rawBaseUom={order.baseUom}
                        finishedGoods={finishedGoods}
                      />
                      {order.remainingToPackage > 0 && (
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
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
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
