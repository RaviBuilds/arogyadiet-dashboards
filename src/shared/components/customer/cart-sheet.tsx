"use client";

import { useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Leaf, ShoppingBag, ShoppingCart } from "lucide-react";
import { useCartStore } from "@/store/useCartStore";
import { Button } from "@/shared/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/shared/components/ui/sheet";
import { ScrollArea } from "@/shared/components/ui/scroll-area";
import { Separator } from "@/shared/components/ui/separator";
import { CartItem } from "@/shared/components/customer/cart-item";
import { useSyncCartStockFromServer } from "@/shared/hooks/use-sync-cart-stock";

const subscribeToNothing = () => () => {};

export function CartSheet() {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const isMounted = useSyncExternalStore(
    subscribeToNothing,
    () => true,
    () => false,
  );
  const items = useCartStore((state) => state.items);
  const cartTotal = useCartStore((state) => state.cartTotal);

  useSyncCartStockFromServer(isOpen);

  if (!isMounted) {
    return null;
  }

  const handleCheckout = () => {
    setIsOpen(false);
    router.push("/shop/checkout");
  };

  const totalItems = items.reduce((sum, item) => sum + item.quantity, 0);

  return (
    <Sheet open={isOpen} onOpenChange={setIsOpen}>
      <SheetTrigger asChild>
        <button
          type="button"
          className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-700 transition-all duration-200 hover:bg-emerald-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 focus-visible:ring-offset-2"
        >
          <ShoppingCart className="h-4 w-4" />
          {totalItems > 0 && (
            <span className="absolute -right-1 -top-1 inline-flex min-w-[18px] items-center justify-center rounded-full bg-emerald-600 px-1 text-[10px] font-semibold leading-4 text-white ring-2 ring-white">
              {totalItems}
            </span>
          )}
          <span className="sr-only">Open cart</span>
        </button>
      </SheetTrigger>

      <SheetContent
        side="right"
        className="flex h-[100dvh] w-full max-w-[430px] flex-col gap-0 overflow-hidden border-l border-emerald-900/10 bg-gradient-to-b from-emerald-50/70 via-white to-white p-0 sm:w-[430px] sm:max-w-[430px]"
      >
        <SheetHeader className="relative overflow-hidden border-b border-emerald-900/10 bg-gradient-to-br from-[#0f5230] via-[#1f7d49] to-[#37a862] px-6 py-6 text-left">
          <div className="pointer-events-none absolute -right-12 -top-16 h-44 w-44 rounded-full bg-white/10 blur-3xl" />
          <div className="pointer-events-none absolute -bottom-20 left-1/3 h-36 w-36 rounded-full bg-lime-200/15 blur-3xl" />
          <div className="relative flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 text-emerald-100/90">
                <Leaf className="h-3.5 w-3.5" />
                <span className="text-[11px] font-semibold uppercase tracking-[0.18em]">
                  Wellness essentials
                </span>
              </div>
              <SheetTitle className="mt-2 text-xl font-semibold tracking-tight text-white">
                Your cart
              </SheetTitle>
            </div>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1.5 text-xs font-semibold text-emerald-50 ring-1 ring-inset ring-white/15">
              <ShoppingBag className="h-3.5 w-3.5" />
              {totalItems} {totalItems === 1 ? "item" : "items"}
            </span>
          </div>
        </SheetHeader>

        {items.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center px-8 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-50 text-emerald-600 ring-1 ring-inset ring-emerald-900/10">
              <ShoppingCart className="h-7 w-7" />
            </div>
            <p className="mt-5 text-base font-semibold tracking-tight text-slate-900">
              Your cart is waiting
            </p>
            <p className="mt-2 max-w-xs text-sm leading-relaxed text-slate-500">
              Add nourishing essentials to have them delivered with your next meal.
            </p>
          </div>
        ) : (
          <>
            <ScrollArea className="min-h-0 flex-1">
              <div className="flex w-full max-w-full flex-col gap-3 overflow-x-hidden p-4 sm:p-5">
                {items.map((item) => (
                  <CartItem key={item.id} item={item} />
                ))}
              </div>
            </ScrollArea>

            <div className="border-t border-emerald-900/10 bg-white/95 p-4 shadow-[0_-12px_28px_rgba(15,82,48,0.06)] backdrop-blur-sm sm:p-5">
              <div className="mb-3 flex items-center justify-between text-sm">
                <span className="font-medium text-slate-500">Cart subtotal</span>
                <span className="text-lg font-semibold tabular-nums tracking-tight text-slate-900">
                  ₹{cartTotal().toFixed(2)}
                </span>
              </div>
              <Separator className="mb-4 bg-emerald-900/10" />
              <Button
                className="group h-11 w-full rounded-full bg-primary text-sm font-semibold text-primary-foreground shadow-md shadow-primary/20 transition-all hover:brightness-105 hover:shadow-lg hover:shadow-primary/25"
                onClick={handleCheckout}
                disabled={items.length === 0}
              >
                Continue to checkout
                <ArrowRight className="ml-2 h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5" />
              </Button>
              <p className="mt-3 text-center text-xs text-slate-500">
                Secure payment. Delivered with your next meal.
              </p>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
