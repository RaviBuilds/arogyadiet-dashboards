"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Inbox, Loader2, Package, Trash2 } from "lucide-react";
import { toast } from "sonner";

import {
  bulkDispatchAction,
  bulkReceiveAction,
} from "@/actions/inventory-actions";
import { INVENTORY_SOURCE_LABELS } from "@/lib/inventory/product-schema";
import { Button } from "@/shared/components/ui/button";
import { ScrollArea } from "@/shared/components/ui/scroll-area";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/shared/components/ui/sheet";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/shared/components/ui/tabs";
import {
  selectInboundBatchCost,
  selectTotalCartCount,
  useInventoryStore,
} from "@/shared/stores/useInventoryStore";

function StagingEmptyState() {
  return (
    <div className="flex h-full min-h-[200px] flex-col items-center justify-center gap-3 text-center text-muted-foreground">
      <div className="rounded-full bg-muted p-4">
        <Package className="h-7 w-7" />
      </div>
      <p className="font-medium text-foreground">Your staging cart is empty</p>
      <p className="text-sm">Add items from the master catalog.</p>
    </div>
  );
}

function StagingCartItem({
  name,
  details,
  onRemove,
}: {
  name: string;
  details: string;
  onRemove: () => void;
}) {
  return (
    <div className="group mb-3 flex items-center justify-between rounded-lg border bg-slate-50 p-3 transition-colors hover:bg-slate-100">
      <div className="min-w-0 space-y-1">
        <p className="font-medium text-slate-900">{name}</p>
        <p className="text-sm text-muted-foreground">{details}</p>
      </div>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="shrink-0 text-slate-400 opacity-0 transition-opacity group-hover:opacity-100 hover:bg-red-50 hover:text-red-600"
        onClick={onRemove}
        aria-label={`Remove ${name} from cart`}
      >
        <Trash2 className="h-4 w-4" />
      </Button>
    </div>
  );
}

export default function OperationsCart() {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [isMounted, setIsMounted] = useState(false);
  const [isInboundPending, startInboundTransition] = useTransition();
  const [isOutboundPending, startOutboundTransition] = useTransition();

  const inboundCart = useInventoryStore((state) => state.inboundCart);
  const outboundCart = useInventoryStore((state) => state.outboundCart);
  const removeInboundItem = useInventoryStore((state) => state.removeInboundItem);
  const removeOutboundItem = useInventoryStore(
    (state) => state.removeOutboundItem,
  );
  const clearInboundCart = useInventoryStore((state) => state.clearInboundCart);
  const clearOutboundCart = useInventoryStore(
    (state) => state.clearOutboundCart,
  );

  const totalCartCount = useInventoryStore(selectTotalCartCount);
  const inboundBatchCost = useInventoryStore(selectInboundBatchCost);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  if (!isMounted) {
    return null;
  }

  function handleProcessInbound() {
    if (inboundCart.length === 0) {
      return;
    }

    startInboundTransition(async () => {
      const formData = new FormData();
      const payload = inboundCart.map(
        ({ productId, name, qty, cost, expiry, sourceType, sourceName }) => ({
          productId,
          name,
          quantity: qty,
          totalCost: cost,
          expiryDate: expiry,
          sourceType,
          sourceName,
        }),
      );
      formData.append("items", JSON.stringify(payload));
      inboundCart.forEach((item, index) => {
        if (item.purchaseOrderFile) {
          formData.append(`purchaseOrder-${index}`, item.purchaseOrderFile);
        }
      });

      const result = await bulkReceiveAction(formData);

      if (result.success) {
        toast.success(
          `${result.processed} inbound item${result.processed === 1 ? "" : "s"} processed successfully.`,
        );
        clearInboundCart();
        setIsOpen(false);
        router.refresh();
        return;
      }

      toast.error(result.error);
    });
  }

  function handleProcessOutbound() {
    if (outboundCart.length === 0) {
      return;
    }

    startOutboundTransition(async () => {
      const payload = outboundCart.map(({ productId, name, qty, reason }) => ({
        productId,
        name,
        quantity: qty,
        reason,
      }));

      const result = await bulkDispatchAction(payload);

      if (result.success) {
        toast.success(
          `${result.totalDispatched} units dispatched across ${result.processed} item${result.processed === 1 ? "" : "s"}.`,
        );
        clearOutboundCart();
        setIsOpen(false);
        router.refresh();
        return;
      }

      toast.error(result.error);
    });
  }

  return (
    <>
      <Button
        type="button"
        size="icon"
        className="fixed bottom-6 right-6 z-50 h-14 w-14 rounded-full shadow-lg"
        onClick={() => setIsOpen(true)}
        aria-label="Open operations cart"
      >
        <Inbox className="h-6 w-6" />
        {totalCartCount > 0 && (
          <span className="absolute -right-1 -top-1 inline-flex min-w-5 items-center justify-center rounded-full bg-red-500 px-1.5 text-[10px] font-semibold leading-5 text-white">
            {totalCartCount}
          </span>
        )}
      </Button>

      <Sheet open={isOpen} onOpenChange={setIsOpen}>
        <SheetContent
          side="right"
          className="flex h-full w-full flex-col gap-0 p-0 sm:max-w-lg"
        >
          <div className="flex h-full flex-col">
            <SheetHeader className="px-6 pt-6 pb-0">
              <SheetTitle>Operations Cart</SheetTitle>
              <SheetDescription>
                Review staged inbound and outbound stock before processing
                batches.
              </SheetDescription>
            </SheetHeader>

            <Tabs
              defaultValue="inbound"
              className="flex min-h-0 flex-1 flex-col"
            >
              <div className="px-6 pt-4">
                <TabsList className="w-full">
                  <TabsTrigger value="inbound" className="flex-1">
                    Inbound ({inboundCart.length})
                  </TabsTrigger>
                  <TabsTrigger value="outbound" className="flex-1">
                    Outbound ({outboundCart.length})
                  </TabsTrigger>
                </TabsList>
              </div>

              <TabsContent
                value="inbound"
                className="flex min-h-0 flex-1 flex-col data-[state=inactive]:hidden"
              >
                <ScrollArea className="my-4 flex-1 overflow-y-auto px-6 pr-4">
                  {inboundCart.length === 0 ? (
                    <StagingEmptyState />
                  ) : (
                    <div>
                      {inboundCart.map((item) => (
                        <StagingCartItem
                          key={item.id}
                          name={item.name}
                          details={`Qty: ${item.qty} · Cost: ₹${item.cost.toLocaleString("en-IN")}${item.expiry ? ` · Exp: ${item.expiry}` : ""} · Src: ${item.sourceType === "OTHER" && item.sourceName ? item.sourceName : INVENTORY_SOURCE_LABELS[item.sourceType]}${item.purchaseOrderFile ? " · PO attached" : ""}`}
                          onRemove={() => removeInboundItem(item.id)}
                        />
                      ))}
                    </div>
                  )}
                </ScrollArea>

                <div className="mt-auto border-t bg-background px-6 pt-4 pb-6">
                  <div className="mb-4 flex items-center justify-between">
                    <span className="text-sm font-medium text-muted-foreground">
                      Total Batch Value
                    </span>
                    <span className="text-xl font-bold">
                      ₹{inboundBatchCost.toLocaleString("en-IN")}
                    </span>
                  </div>
                  <Button
                    type="button"
                    className="h-12 w-full text-lg"
                    disabled={inboundCart.length === 0 || isInboundPending}
                    onClick={handleProcessInbound}
                  >
                    {isInboundPending ? (
                      <>
                        <Loader2 className="animate-spin" />
                        Processing...
                      </>
                    ) : (
                      "Process Inbound Batch"
                    )}
                  </Button>
                </div>
              </TabsContent>

              <TabsContent
                value="outbound"
                className="flex min-h-0 flex-1 flex-col data-[state=inactive]:hidden"
              >
                <ScrollArea className="my-4 flex-1 overflow-y-auto px-6 pr-4">
                  {outboundCart.length === 0 ? (
                    <StagingEmptyState />
                  ) : (
                    <div>
                      {outboundCart.map((item) => (
                        <StagingCartItem
                          key={item.id}
                          name={item.name}
                          details={`Qty: ${item.qty} · ${item.reason}`}
                          onRemove={() => removeOutboundItem(item.id)}
                        />
                      ))}
                    </div>
                  )}
                </ScrollArea>

                <div className="mt-auto border-t bg-background px-6 pt-4 pb-6">
                  <div className="mb-4 flex items-center justify-between">
                    <span className="text-sm font-medium text-muted-foreground">
                      Items Staged
                    </span>
                    <span className="text-xl font-bold">
                      {outboundCart.length}
                    </span>
                  </div>
                  <Button
                    type="button"
                    variant="destructive"
                    className="h-12 w-full text-lg"
                    disabled={outboundCart.length === 0 || isOutboundPending}
                    onClick={handleProcessOutbound}
                  >
                    {isOutboundPending ? (
                      <>
                        <Loader2 className="animate-spin" />
                        Processing...
                      </>
                    ) : (
                      "Process Outbound Batch"
                    )}
                  </Button>
                </div>
              </TabsContent>
            </Tabs>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
