"use client";

import * as React from "react";
import Link from "next/link";
import { format, parseISO } from "date-fns";
import {
  MoreHorizontal,
  CalendarDays,
  Package,
  CheckCircle2,
  Clock,
  Truck,
  XCircle,
  ArrowRight,
} from "lucide-react";
import { toast } from "sonner";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/shared/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/shared/components/ui/dialog";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import { cn } from "@/lib/utils";
import { updateAddonOrderDeliveryDate } from "@/actions/shop-actions";

type OrderItem = {
  quantity: number;
  unit_price: number | null;
  products:
    | { name: string; category: string | null }
    | { name: string; category: string | null }[]
    | null;
} | null;

type DeliveryOrder = {
  delivery_date: string | null;
  status: string | null;
} | null;

export type ShopOrderRow = {
  id: string;
  created_at: string;
  total_amount: number | null;
  status: string | null;
  target_delivery_date: string | null;
  delivery_order_id: string | null;
  delivery_orders?: DeliveryOrder | DeliveryOrder[] | null;
  addon_order_items?: OrderItem[] | null;
};

function getProductName(products: unknown): string | null {
  if (!products) return null;
  if (Array.isArray(products)) return products[0]?.name ?? null;
  return (products as { name?: string }).name ?? null;
}

function getTomorrow(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().split("T")[0];
}

function getOrderStatus(order: ShopOrderRow) {
  if (order.status === "DELIVERED") return "delivered";
  if (order.status === "CANCELLED") return "cancelled";
  if (order.status === "PENDING") return "pending";
  if (order.status === "PAID" && !order.delivery_order_id) return "purchased";
  if (order.status === "PAID" && order.delivery_order_id) return "scheduled";
  return "unknown";
}

const STATUS_CONFIG = {
  purchased: {
    label: "Purchased",
    icon: Clock,
    className: "bg-amber-50 text-amber-700 ring-amber-200",
  },
  scheduled: {
    label: "Scheduled for Delivery",
    icon: Truck,
    className: "bg-blue-50 text-blue-700 ring-blue-200",
  },
  delivered: {
    label: "Delivered",
    icon: CheckCircle2,
    className: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  },
  cancelled: {
    label: "Cancelled",
    icon: XCircle,
    className: "bg-red-50 text-red-700 ring-red-200",
  },
  pending: {
    label: "Payment Pending",
    icon: Clock,
    className: "bg-slate-100 text-slate-600 ring-slate-200",
  },
  unknown: {
    label: "Unknown",
    icon: Clock,
    className: "bg-slate-100 text-slate-500 ring-slate-200",
  },
};

function StatusBadge({ order }: { order: ShopOrderRow }) {
  const key = getOrderStatus(order);
  const cfg = STATUS_CONFIG[key];
  const Icon = cfg.icon;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset",
        cfg.className,
      )}
    >
      <Icon className="h-3 w-3" />
      {cfg.label}
    </span>
  );
}

function getScheduledDate(order: ShopOrderRow): string | null {
  const d = order.delivery_orders;
  if (!d) return null;
  const delivery = Array.isArray(d) ? d[0] : d;
  return delivery?.delivery_date ?? null;
}

function EditDeliveryDialog({
  order,
  open,
  onClose,
}: {
  order: ShopOrderRow | null;
  open: boolean;
  onClose: () => void;
}) {
  const [date, setDate] = React.useState("");
  const [pending, startTransition] = React.useTransition();

  React.useEffect(() => {
    if (open && order?.target_delivery_date) {
      setDate(order.target_delivery_date);
    }
  }, [open, order]);

  const minDate = getTomorrow();

  function handleSave() {
    if (!order || !date) return;
    startTransition(async () => {
      const res = await updateAddonOrderDeliveryDate(order.id, date);
      if (res.success) {
        toast.success("Delivery date updated successfully.");
        onClose();
      } else {
        toast.error(res.error ?? "Failed to update delivery date.");
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="rounded-3xl border-emerald-900/10 sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-semibold tracking-tight text-slate-900">
            <CalendarDays className="h-5 w-5 text-primary" />
            Edit Delivery Date
          </DialogTitle>
          <DialogDescription>
            Change the target delivery date for Order #
            {order ? String(order.id).slice(-6).toUpperCase() : ""}. This can
            only be changed while the order is unscheduled.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="delivery-date">New Delivery Date</Label>
            <Input
              id="delivery-date"
              type="date"
              value={date}
              min={minDate}
              onChange={(e) => setDate(e.target.value)}
              className="w-full"
            />
            <p className="text-xs text-muted-foreground">
              Earliest allowed: {format(parseISO(minDate), "MMM do, yyyy")}
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={onClose}
            disabled={pending}
            className="transition-all duration-200"
          >
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={pending || !date || date < minDate}
            className="transition-all duration-200"
          >
            {pending ? "Saving..." : "Save Changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ShopOrdersClient({ orders }: { orders: ShopOrderRow[] }) {
  const [editOrder, setEditOrder] = React.useState<ShopOrderRow | null>(null);
  const [editOpen, setEditOpen] = React.useState(false);

  function openEdit(order: ShopOrderRow) {
    setEditOrder(order);
    setEditOpen(true);
  }

  function closeEdit() {
    setEditOpen(false);
    setEditOrder(null);
  }

  if (orders.length === 0) {
    return (
      <div className="rounded-3xl border border-dashed border-emerald-900/15 bg-white text-center shadow-sm">
        <div className="flex flex-col items-center gap-4 px-6 py-16">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-50">
            <Package className="h-8 w-8 text-emerald-400" />
          </div>
          <div>
            <h2 className="text-lg font-semibold tracking-tight text-slate-900">
              No shop orders yet
            </h2>
            <p className="mt-1 max-w-sm text-sm text-slate-500">
              Browse the shop and add wellness essentials — they&apos;ll be
              merged into your next delivery batch.
            </p>
          </div>
          <Link
            href="/shop"
            className="group/cta mt-2 inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground shadow-sm transition-all duration-200 hover:shadow-md hover:brightness-105 active:scale-[0.98]"
          >
            Browse Shop
            <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover/cta:translate-x-0.5" />
          </Link>
        </div>
      </div>
    );
  }

  return (
    <>
      {/* Desktop: table-like rows inside a dashboard-style card.
          Mobile: a stack of self-contained order cards — same data,
          presented the way the Momentum/UpcomingDeliveries cards are:
          one unified card rather than a cramped grid. */}
      <div className="hidden overflow-hidden rounded-3xl border border-emerald-900/10 bg-white shadow-sm md:block">
        <div className="grid grid-cols-[1fr_1.2fr_1.4fr_1fr_1.2fr_48px] border-b border-emerald-900/10 bg-emerald-50/40 px-6 py-3 text-xs font-medium uppercase tracking-wider text-emerald-700/80">
          <div>Order</div>
          <div>Purchased</div>
          <div>Items</div>
          <div>Target Delivery</div>
          <div>Status</div>
          <div />
        </div>

        <div className="divide-y divide-slate-100">
          {orders.map((order) => {
            const orderStatus = getOrderStatus(order);
            const canEdit = orderStatus === "purchased";
            const items = Array.isArray(order.addon_order_items)
              ? order.addon_order_items.filter(Boolean)
              : [];
            const scheduledDate = getScheduledDate(order);
            const displayDate =
              scheduledDate ?? order.target_delivery_date ?? null;

            return (
              <div
                key={order.id}
                className="grid grid-cols-[1fr_1.2fr_1.4fr_1fr_1.2fr_48px] items-center gap-0 px-6 py-4 transition-colors duration-200 hover:bg-emerald-50/30"
              >
                {/* Order ID */}
                <div>
                  <p className="text-sm font-semibold text-slate-900">
                    #{String(order.id).slice(-6).toUpperCase()}
                  </p>
                  {typeof order.total_amount === "number" && (
                    <p className="mt-0.5 text-xs text-slate-500">
                      ₹{Number(order.total_amount).toFixed(2)}
                    </p>
                  )}
                </div>

                {/* Purchased date */}
                <div className="text-sm text-slate-600">
                  {format(parseISO(order.created_at), "MMM do, yyyy")}
                </div>

                {/* Items */}
                <div className="space-y-0.5">
                  {items.length === 0 ? (
                    <span className="text-sm text-slate-400">—</span>
                  ) : (
                    items.map((item, idx) => (
                      <div
                        key={idx}
                        className="flex items-center gap-1.5 text-sm"
                      >
                        <span className="font-medium text-slate-800">
                          {getProductName(item?.products ?? null) ?? "Product"}
                        </span>
                        <span className="text-xs text-slate-400">
                          ×{item?.quantity}
                        </span>
                      </div>
                    ))
                  )}
                </div>

                {/* Target Delivery */}
                <div className="text-sm text-slate-600">
                  {displayDate ? (
                    <span>
                      {format(parseISO(displayDate), "MMM do, yyyy")}
                    </span>
                  ) : (
                    <span className="text-slate-400">—</span>
                  )}
                </div>

                {/* Status */}
                <div>
                  <StatusBadge order={order} />
                </div>

                {/* Actions */}
                <div className="flex justify-end">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-slate-400 transition-all duration-200 hover:bg-slate-100 hover:text-slate-700"
                      >
                        <MoreHorizontal className="h-4 w-4" />
                        <span className="sr-only">Order actions</span>
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-52">
                      <DropdownMenuItem
                        onClick={() => canEdit && openEdit(order)}
                        disabled={!canEdit}
                        className={cn(
                          "flex cursor-pointer items-center gap-2",
                          !canEdit && "cursor-not-allowed opacity-40",
                        )}
                      >
                        <CalendarDays className="h-4 w-4" />
                        Edit Delivery Date
                        {!canEdit && orderStatus === "scheduled" && (
                          <span className="ml-auto text-[10px] font-normal text-slate-400">
                            Locked
                          </span>
                        )}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Mobile card stack */}
      <div className="flex flex-col gap-3 md:hidden">
        {orders.map((order) => {
          const orderStatus = getOrderStatus(order);
          const canEdit = orderStatus === "purchased";
          const items = Array.isArray(order.addon_order_items)
            ? order.addon_order_items.filter(Boolean)
            : [];
          const scheduledDate = getScheduledDate(order);
          const displayDate = scheduledDate ?? order.target_delivery_date ?? null;

          return (
            <div
              key={order.id}
              className="overflow-hidden rounded-2xl border border-emerald-900/10 bg-white shadow-sm"
            >
              <div className="flex items-center justify-between gap-3 border-b border-emerald-900/10 bg-emerald-50/40 px-4 py-3">
                <div>
                  <p className="text-sm font-semibold text-slate-900">
                    #{String(order.id).slice(-6).toUpperCase()}
                  </p>
                  <p className="text-xs text-slate-500">
                    {format(parseISO(order.created_at), "MMM do, yyyy")}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <StatusBadge order={order} />
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                      >
                        <MoreHorizontal className="h-4 w-4" />
                        <span className="sr-only">Order actions</span>
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-52">
                      <DropdownMenuItem
                        onClick={() => canEdit && openEdit(order)}
                        disabled={!canEdit}
                        className={cn(
                          "flex cursor-pointer items-center gap-2",
                          !canEdit && "cursor-not-allowed opacity-40",
                        )}
                      >
                        <CalendarDays className="h-4 w-4" />
                        Edit Delivery Date
                        {!canEdit && orderStatus === "scheduled" && (
                          <span className="ml-auto text-[10px] font-normal text-slate-400">
                            Locked
                          </span>
                        )}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>

              <div className="space-y-2 px-4 py-3">
                {items.length === 0 ? (
                  <span className="text-sm text-slate-400">No items</span>
                ) : (
                  items.map((item, idx) => (
                    <div
                      key={idx}
                      className="flex items-center justify-between text-sm"
                    >
                      <span className="font-medium text-slate-800">
                        {getProductName(item?.products ?? null) ?? "Product"}
                      </span>
                      <span className="text-xs text-slate-400">
                        ×{item?.quantity}
                      </span>
                    </div>
                  ))
                )}

                <div className="flex items-center justify-between border-t border-slate-100 pt-2 text-sm">
                  <span className="text-slate-500">Target delivery</span>
                  <span className="font-medium text-slate-700">
                    {displayDate
                      ? format(parseISO(displayDate), "MMM do, yyyy")
                      : "—"}
                  </span>
                </div>
                {typeof order.total_amount === "number" && (
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-slate-500">Total</span>
                    <span className="font-semibold text-slate-900">
                      ₹{Number(order.total_amount).toFixed(2)}
                    </span>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <EditDeliveryDialog order={editOrder} open={editOpen} onClose={closeEdit} />
    </>
  );
}
