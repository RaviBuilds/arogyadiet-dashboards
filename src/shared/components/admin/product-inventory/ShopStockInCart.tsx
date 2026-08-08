"use client";

// src/shared/components/admin/product-inventory/ShopStockInCart.tsx
// Persistent Shop_Products_Cart panel for the warehouse-to-clinic Stock_In
// flow (clinic-scoped-shop-inventory spec — Task 7.7).
//
// Outbound-only by construction (Req 7.2): the cart only ever holds pending
// Stock_In lines (`shopStockInCart`) and exposes exactly one submission
// action — there is no inbound/outbound duality here like `OperationsCart`.
//
// SINGLE-CLINIC CART: `clinicStockInAction` commits to one clinic, so this
// cart holds lines for exactly one clinic at a time. `ShopStockInDialog`
// refuses to add a line for a second clinic, which makes "every line shares
// one clinicId" an invariant rather than a hope — so `shopStockInCart[0]`
// identifies the whole cart's destination.
//
// When the destination selector is moved to a different clinic while lines
// are still pending, the cart does NOT silently commit to the clinic the
// operator is no longer looking at (stock-in is irreversible: it depletes
// warehouse lots FIFO and writes an immutable ledger entry). Instead submit
// is disabled and the operator is given two explicit ways out — switch the
// selector back to the cart's clinic, or discard the cart and start over for
// the selected clinic.
//
// On success the committed lines are removed (Req 7.6, "clear after commit");
// on rejection every pending line is retained (Req 7.10, 7.12, 7.14) and the
// error is surfaced via toast.

import { useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  AlertCircle,
  Loader2,
  Package,
  ShoppingCart,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

import { Alert, AlertDescription } from "@/shared/components/ui/alert";

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

interface ShopStockInCartProps {
  /** The Clinic_Mode page's currently selected destination clinic. */
  selectedClinicId: string;
  /** Display name of the currently selected destination clinic. */
  selectedClinicName: string;
}

export function ShopStockInCart({
  selectedClinicId,
  selectedClinicName,
}: ShopStockInCartProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isOpen, setIsOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  const shopStockInCart = useInventoryStore((state) => state.shopStockInCart);
  const removeShopStockInLine = useInventoryStore(
    (state) => state.removeShopStockInLine,
  );
  const clearShopStockInCart = useInventoryStore(
    (state) => state.clearShopStockInCart,
  );

  const isEmpty = shopStockInCart.length === 0;

  // Single-clinic invariant: every line in the cart shares one clinic, because
  // `ShopStockInDialog` is blocked from adding a line for a second clinic. So
  // the first line identifies the whole cart's destination.
  const cartClinicId = shopStockInCart[0]?.clinicId ?? null;
  const cartClinicName = shopStockInCart[0]?.clinicName ?? "another clinic";
  const isCrossClinic =
    cartClinicId !== null && cartClinicId !== selectedClinicId;

  /** Point the destination selector at the cart's clinic (Req 5.9's URL model). */
  function handleSwitchToCartClinic() {
    if (!cartClinicId) return;
    const params = new URLSearchParams(searchParams.toString());
    params.set("destination", `clinic:${cartClinicId}`);
    router.replace(`${pathname}?${params.toString()}`);
    setIsOpen(false);
  }

  function handleDiscardCart() {
    clearShopStockInCart();
    toast.success(`Cart cleared. You can now stock in for ${selectedClinicName}.`);
  }

  function handleSubmit() {
    // Never submit a cart whose destination is not the clinic on screen.
    if (isEmpty || isCrossClinic || !cartClinicId) return;

    startTransition(async () => {
      const lines = shopStockInCart.map((line) => ({
        productId: line.productId,
        quantity: line.qty,
      }));

      const result = await clinicStockInAction(lines, cartClinicId);

      if (result.success) {
        // Clear the committed lines (Req 7.6, "clear after commit").
        for (const line of shopStockInCart) {
          removeShopStockInLine(line.clinicId, line.productId);
        }
        toast.success("Stock-in submitted successfully.");
        router.refresh();
        setIsOpen(false);
        return;
      }

      // Retain every pending line on rejection (Req 7.10, 7.12, 7.14).
      toast.error(result.error ?? "The stock-in submission failed.");
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
                {isEmpty
                  ? "Review pending Stock In lines before submitting them to the destination clinic."
                  : `Pending Stock In lines for ${cartClinicName}.`}
              </SheetDescription>
            </SheetHeader>

            {isCrossClinic ? (
              <div className="px-6 pt-4">
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription className="space-y-3">
                    <span className="block">
                      This cart holds stock-in lines for{" "}
                      <strong>{cartClinicName}</strong>, but{" "}
                      <strong>{selectedClinicName}</strong> is selected. Submit
                      is disabled to prevent stocking the wrong clinic.
                    </span>
                    <span className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={handleSwitchToCartClinic}
                        disabled={isPending}
                      >
                        Switch to {cartClinicName}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={handleDiscardCart}
                        disabled={isPending}
                      >
                        Clear cart and stock in for {selectedClinicName}
                      </Button>
                    </span>
                  </AlertDescription>
                </Alert>
              </div>
            ) : null}

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
                disabled={isEmpty || isPending || isCrossClinic}
                onClick={handleSubmit}
              >
                {isPending ? (
                  <>
                    <Loader2 className="animate-spin" />
                    Submitting...
                  </>
                ) : isCrossClinic ? (
                  `Submit disabled — cart is for ${cartClinicName}`
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
