"use client";

// src/app/franchise/(main)/inventory/_components/FranchiseOperationsCart.tsx
// Franchise outbound staging cart + batch processor.
//
// Mirrors the central kitchen's OperationsCart but is outbound-only: the
// franchise dispatches finished-product stock to customers / wastage / other.
// Incoming stock is automatic (Stock_Transfers from the central kitchen).
//
// Staged items are processed by bulkFranchiseDispatchAction, which runs each
// dispatch through the atomic record_franchise_stock_out RPC.

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Inbox, Loader2, Package, Trash2 } from "lucide-react";
import { toast } from "sonner";

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
  selectFranchiseOutboundCount,
  selectFranchiseOutboundUnits,
  useFranchiseInventoryStore,
} from "@/shared/stores/useFranchiseInventoryStore";
import { bulkFranchiseDispatchAction } from "@/actions/franchise-actions/franchiseInventoryActions";

function StagingEmptyState() {
  return (
    <div className="flex h-full min-h-[200px] flex-col items-center justify-center gap-3 text-center text-muted-foreground">
      <div className="rounded-full bg-muted p-4">
        <Package className="h-7 w-7" />
      </div>
      <p className="font-medium text-foreground">Your outbound cart is empty</p>
      <p className="text-sm">Add items using the Dispatch button on a product.</p>
    </div>
  );
}

export default function FranchiseOperationsCart() {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [isMounted, setIsMounted] = useState(false);
  const [isPending, startTransition] = useTransition();

  const outboundCart = useFranchiseInventoryStore((state) => state.outboundCart);
  const removeOutboundItem = useFranchiseInventoryStore(
    (state) => state.removeOutboundItem,
  );
  const clearOutboundCart = useFranchiseInventoryStore(
    (state) => state.clearOutboundCart,
  );

  const count = useFranchiseInventoryStore(selectFranchiseOutboundCount);
  const units = useFranchiseInventoryStore(selectFranchiseOutboundUnits);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  if (!isMounted) {
    return null;
  }

  function handleProcessOutbound() {
    if (outboundCart.length === 0) return;

    startTransition(async () => {
      const payload = outboundCart.map(
        ({ productId, name, qty, reason, comment }) => ({
          product_id: productId,
          name,
          quantity: qty,
          reason,
          comment: comment ?? null,
        }),
      );

      const result = await bulkFranchiseDispatchAction(payload);

      if (result.success) {
        toast.success(
          `${result.totalDispatched} unit(s) dispatched across ${result.processed} item${result.processed === 1 ? "" : "s"}.`,
        );
        clearOutboundCart();
        setIsOpen(false);
        router.refresh();
        return;
      }

      toast.error(result.error ?? "Failed to process outbound batch.");
    });
  }

  return (
    <>
      <Button
        type="button"
        size="icon"
        className="fixed bottom-6 right-6 z-50 h-14 w-14 rounded-full shadow-lg"
        onClick={() => setIsOpen(true)}
        aria-label="Open outbound cart"
      >
        <Inbox className="h-6 w-6" />
        {count > 0 && (
          <span className="absolute -right-1 -top-1 inline-flex min-w-5 items-center justify-center rounded-full bg-red-500 px-1.5 text-[10px] font-semibold leading-5 text-white">
            {count}
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
              <SheetTitle>Outbound Cart</SheetTitle>
              <SheetDescription>
                Review staged dispatches before processing the outbound batch.
              </SheetDescription>
            </SheetHeader>

            <ScrollArea className="my-4 flex-1 overflow-y-auto px-6 pr-4">
              {outboundCart.length === 0 ? (
                <StagingEmptyState />
              ) : (
                <div>
                  {outboundCart.map((item) => (
                    <div
                      key={item.id}
                      className="group mb-3 flex items-center justify-between rounded-lg border bg-slate-50 p-3 transition-colors hover:bg-slate-100"
                    >
                      <div className="min-w-0 space-y-1">
                        <p className="font-medium text-slate-900">{item.name}</p>
                        <p className="text-sm text-muted-foreground">
                          Qty: {item.qty} · {item.reasonLabel}
                          {item.comment ? ` · "${item.comment}"` : ""}
                        </p>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="shrink-0 text-slate-400 opacity-0 transition-opacity group-hover:opacity-100 hover:bg-red-50 hover:text-red-600"
                        onClick={() => removeOutboundItem(item.id)}
                        aria-label={`Remove ${item.name} from cart`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </ScrollArea>

            <div className="mt-auto border-t bg-background px-6 pt-4 pb-6">
              <div className="mb-4 flex items-center justify-between">
                <span className="text-sm font-medium text-muted-foreground">
                  Total Units Staged
                </span>
                <span className="text-xl font-bold">{units}</span>
              </div>
              <Button
                type="button"
                variant="destructive"
                className="h-12 w-full text-lg"
                disabled={outboundCart.length === 0 || isPending}
                onClick={handleProcessOutbound}
              >
                {isPending ? (
                  <>
                    <Loader2 className="animate-spin" />
                    Processing...
                  </>
                ) : (
                  "Process Outbound Batch"
                )}
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
