"use client";

// src/shared/components/admin/product-inventory/ShopStockInCart.tsx
// Persistent Shop_Products_Cart panel for the warehouse-to-clinic Stock_In
// flow (clinic-scoped-shop-inventory spec — Task 7.7).
//
// Outbound-only by construction (Req 7.2): the cart only ever holds pending
// Stock_In lines (`shopStockInCart`) and exposes exactly one submission
// action — there is no inbound/outbound duality here like `OperationsCart`.
//
// Multi-clinic-group submission: `shopStockInLine` carries its own
// `clinicId`, but `clinicStockInAction` takes a single `clinicId` for the
// whole batch. In practice every line added in one session shares the
// Clinic_Mode page's current destination clinic, but to stay correct if the
// admin changes the destination selector mid-session, lines are grouped by
// `clinicId` and submitted as one `clinicStockInAction` call per group. Each
// group's outcome is independent: a group that succeeds has its lines
// removed from the cart (Req 7.6, "clear after commit"); a group that fails
// keeps its lines in the cart untouched (Req 7.10, 7.12, 7.14, "retain on
// rejection") and its error is surfaced via toast.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Package, ShoppingCart, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { clinicStockInAction } from "@/actions/admin-actions/clinicShopInventoryActions";
import { useInventoryStore } from "@/shared/stores/useInventoryStore";
import { Button } from "@/shared/components/ui/button";
import { ScrollArea } from "@/shared/components/ui/scroll-area";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/shared/components/ui/sheet";

function EmptyState() {
  return (
    <div className="flex h-full min-h-[200px] flex-col items-center justify-center gap-3 text-center text-muted-foreground">
      <div className="rounded-full bg-muted p-4">
        <Package className="h-7 w-7" />
      </div>
      <p className="font-medium text-foreground">No stock-in lines pending</p>
      <p className="text-sm">
        Use the Stock In action on a clinic product to add a line here.
      </p>
    </div>
  );
}

function CartLineRow({
  name,
  qty,
  onRemove,
}: {
  name: string;
  qty: number;
  onRemove: () => void;
}) {
  return (
    <div className="group mb-3 flex items-center justify-between rounded-lg border bg-slate-50 p-3 transition-colors hover:bg-slate-100">
      <div className="min-w-0 space-y-1">
        <p className="font-medium text-slate-900">{name}</p>
        <p className="text-sm text-muted-foreground">Qty: {qty}</p>
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

export function ShopStockInCart() {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  const shopStockInCart = useInventoryStore((state) => state.shopStockInCart);
  const removeShopStockInLine = useInventoryStore(
    (state) => state.removeShopStockInLine,
  );

  const isEmpty = shopStockInCart.length === 0;

  function handleSubmit() {
    if (shopStockInCart.length === 0) return;

    startTransition(async () => {
      // Group pending lines by destination clinic (see file header).
      const groups = new Map<
        string,
        { clinicId: string; productId: string; quantity: number }[]
      >();
      for (const line of shopStockInCart) {
        const group = groups.get(line.clinicId) ?? [];
        group.push({
          clinicId: line.clinicId,
          productId: line.productId,
          quantity: line.qty,
        });
        groups.set(line.clinicId, group);
      }

      let succeededGroups = 0;
      let failedGroups = 0;
      const errors: string[] = [];

      for (const [clinicId, lines] of groups) {
        const result = await clinicStockInAction(
          lines.map(({ productId, quantity }) => ({ productId, quantity })),
          clinicId,
        );

        if (result.success) {
          succeededGroups += 1;
          // Clear only this group's lines — lines for other (failed) groups
          // must be retained (Req 7.10, 7.12, 7.14).
          for (const line of lines) {
            removeShopStockInLine(clinicId, line.productId);
          }
        } else {
          failedGroups += 1;
          errors.push(result.error ?? "The stock-in submission failed.");
        }
      }

      if (succeededGroups > 0) {
        toast.success(
          succeededGroups === 1
            ? "Stock-in submitted successfully."
            : `${succeededGroups} stock-in group(s) submitted successfully.`,
        );
        router.refresh();
      }

      if (failedGroups > 0) {
        errors.forEach((error) => toast.error(error));
      }

      if (succeededGroups > 0 && failedGroups === 0) {
        setIsOpen(false);
      }
    });
  }

  return (
    <>
      <Button
        type="button"
        size="icon"
        className="fixed bottom-6 right-6 z-50 h-14 w-14 rounded-full shadow-lg"
        onClick={() => setIsOpen(true)}
        aria-label="Open stock-in cart"
      >
        <ShoppingCart className="h-6 w-6" />
        {shopStockInCart.length > 0 && (
          <span className="absolute -right-1 -top-1 inline-flex min-w-5 items-center justify-center rounded-full bg-red-500 px-1.5 text-[10px] font-semibold leading-5 text-white">
            {shopStockInCart.length}
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
              <SheetTitle>Stock In Cart</SheetTitle>
              <SheetDescription>
                Review pending Stock In lines before submitting them to the
                destination clinic.
              </SheetDescription>
            </SheetHeader>

            <ScrollArea className="my-4 flex-1 overflow-y-auto px-6 pr-4">
              {isEmpty ? (
                <EmptyState />
              ) : (
                <div>
                  {shopStockInCart.map((line) => (
                    <CartLineRow
                      key={line.id}
                      name={line.name}
                      qty={line.qty}
                      onRemove={() =>
                        removeShopStockInLine(line.clinicId, line.productId)
                      }
                    />
                  ))}
                </div>
              )}
            </ScrollArea>

            <div className="mt-auto border-t bg-background px-6 pt-4 pb-6">
              <div className="mb-4 flex items-center justify-between">
                <span className="text-sm font-medium text-muted-foreground">
                  Lines Pending
                </span>
                <span className="text-xl font-bold">
                  {shopStockInCart.length}
                </span>
              </div>
              <Button
                type="button"
                className="h-12 w-full text-lg"
                disabled={isEmpty || isPending}
                onClick={handleSubmit}
              >
                {isPending ? (
                  <>
                    <Loader2 className="animate-spin" />
                    Submitting...
                  </>
                ) : (
                  "Submit Stock In"
                )}
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}

export default ShopStockInCart;
