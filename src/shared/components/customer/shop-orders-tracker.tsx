"use client";

import * as React from "react";
import { format, parseISO } from "date-fns";
import { Package } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/shared/components/ui/dialog";
import { Button } from "@/shared/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/shared/components/ui/card";
import { cn } from "@/lib/utils";

type ShopOrderItem = {
  quantity: number;
  products: { name: string } | { name: string }[] | null;
} | null;

type ShopOrderDelivery = {
  delivery_date: string | null;
  status: string | null;
} | null;

export type ShopOrder = {
  id: string;
  created_at: string;
  total_amount: number | null;
  status: string | null;
  delivery_order_id: string | null;
  delivery_orders?: ShopOrderDelivery | ShopOrderDelivery[] | null;
  addon_order_items?: ShopOrderItem[] | null;
};

function getDelivery(order: ShopOrder): ShopOrderDelivery {
  const d: any = order.delivery_orders;
  if (!d) return null;
  return Array.isArray(d) ? (d[0] ?? null) : d;
}

function formatStatusLabel(status: string) {
  return status.replaceAll("_", " ");
}

function getProductName(products: unknown) {
  if (!products) return null;
  if (Array.isArray(products)) return products[0]?.name ?? null;
  return (products as any)?.name ?? null;
}

export function ShopOrdersTracker({ shopOrders }: { shopOrders: ShopOrder[] }) {
  const orders = Array.isArray(shopOrders) ? shopOrders : [];

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" className="rounded-xl">
          <Package className="h-4 w-4 mr-2" />
          📦 Track Shop Orders
        </Button>
      </DialogTrigger>

      <DialogContent className="sm:max-w-2xl w-[95vw] max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold">Shop Orders</DialogTitle>
          <DialogDescription>
            Track your paid addon purchases and when they will arrive.
          </DialogDescription>
        </DialogHeader>

        {orders.length === 0 ? (
          <div className="rounded-xl border border-dashed bg-zinc-50/50 p-8 text-center">
            <p className="text-zinc-500 font-medium">
              You haven't purchased any shop products yet.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {orders.map((order) => {
              const delivery = getDelivery(order);
              const isPendingSchedule = order.delivery_order_id == null;

              const deliveryDate = delivery?.delivery_date
                ? format(parseISO(delivery.delivery_date), "MMM do, yyyy")
                : null;
              const deliveryStatus = delivery?.status
                ? formatStatusLabel(delivery.status)
                : null;

              const statusLabel = isPendingSchedule
                ? "Awaiting Schedule"
                : deliveryStatus || "Scheduled";

              const items = Array.isArray(order.addon_order_items)
                ? order.addon_order_items.filter(Boolean)
                : [];

              return (
                <Card key={order.id} className="border-none shadow-sm bg-white">
                  <CardHeader className="pb-2">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <CardTitle className="text-base font-bold text-zinc-900">
                          Order #{String(order.id).slice(-6).toUpperCase()}
                        </CardTitle>
                        <p className="text-xs text-muted-foreground mt-1">
                          Purchased{" "}
                          {format(parseISO(order.created_at), "MMM do, yyyy")}
                          {typeof order.total_amount === "number"
                            ? ` • ₹${Number(order.total_amount).toFixed(2)}`
                            : ""}
                        </p>
                      </div>

                      <div
                        className={cn(
                          "text-xs font-bold px-2.5 py-1 rounded-md whitespace-nowrap",
                          isPendingSchedule
                            ? "bg-zinc-100 text-zinc-600"
                            : "bg-blue-50 text-blue-700",
                        )}
                      >
                        {statusLabel}
                      </div>
                    </div>

                    {isPendingSchedule ? (
                      <p className="text-xs text-muted-foreground mt-2">
                        Will be delivered alongside your next unpaused meal.
                      </p>
                    ) : (
                      <p className="text-xs text-muted-foreground mt-2">
                        {deliveryDate
                          ? `Delivery: ${deliveryDate}`
                          : "Delivery scheduled"}
                      </p>
                    )}
                  </CardHeader>

                  <CardContent className="pt-0">
                    <div className="rounded-xl border bg-zinc-50/50 p-3">
                      <p className="text-xs font-bold text-zinc-500 uppercase tracking-wider">
                        Items
                      </p>
                      {items.length === 0 ? (
                        <p className="text-sm text-muted-foreground mt-2">
                          No items found for this order.
                        </p>
                      ) : (
                        <div className="mt-2 space-y-1">
                          {items.map((item: any, idx: number) => (
                            <div
                              key={`${order.id}-${idx}`}
                              className="flex items-center justify-between text-sm"
                            >
                              <div className="font-medium text-zinc-900">
                                {getProductName(item?.products) || "Product"}
                              </div>
                              <div className="text-zinc-500">
                                x{item?.quantity}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
