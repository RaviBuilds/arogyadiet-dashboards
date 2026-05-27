"use client";

import * as React from "react";
import { format, parseISO } from "date-fns";
import {
  MoreHorizontal,
  CalendarDays,
  Package,
  CheckCircle2,
  Clock,
  Truck,
  XCircle,
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
import { Badge } from "@/shared/components/ui/badge";
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
    className: "bg-amber-50 text-amber-700 border-amber-200",
  },
  scheduled: {
    label: "Scheduled for Delivery",
    icon: Truck,
    className: "bg-blue-50 text-blue-700 border-blue-200",
  },
  delivered: {
    label: "Delivered",
    icon: CheckCircle2,
    className: "bg-green-50 text-green-700 border-green-200",
  },
  cancelled: {
    label: "Cancelled",
    icon: XCircle,
    className: "bg-red-50 text-red-700 border-red-200",
  },
  pending: {
    label: "Payment Pending",
    icon: Clock,
    className: "bg-zinc-100 text-zinc-600 border-zinc-200",
  },
  unknown: {
    label: "Unknown",
    icon: Clock,
    className: "bg-zinc-100 text-zinc-500 border-zinc-200",
  },
};

function StatusBadge({ order }: { order: ShopOrderRow }) {
  const key = getOrderStatus(order);
  const cfg = STATUS_CONFIG[key];
  const Icon = cfg.icon;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full border",
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
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
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
          <Button variant="outline" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={pending || !date || date < minDate}
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
      <div className="rounded-2xl border border-dashed border-zinc-200 bg-zinc-50/50 p-12 text-center">
        <Package className="h-10 w-10 text-zinc-300 mx-auto mb-3" />
        <p className="text-zinc-500 font-medium">
          You haven&apos;t purchased any shop products yet.
        </p>
        <p className="text-sm text-zinc-400 mt-1">
          Browse the shop and add products to your next delivery.
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="bg-white rounded-2xl shadow-sm border overflow-hidden">
        {/* Desktop header */}
        <div className="hidden md:grid grid-cols-[1fr_1.2fr_1.4fr_1fr_1.2fr_48px] bg-zinc-50 border-b px-5 py-3 text-xs font-bold text-zinc-500 uppercase tracking-wider">
          <div>Order</div>
          <div>Purchased</div>
          <div>Items</div>
          <div>Target Delivery</div>
          <div>Status</div>
          <div />
        </div>

        <div className="divide-y divide-zinc-100">
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
                className="px-5 py-4 grid grid-cols-1 md:grid-cols-[1fr_1.2fr_1.4fr_1fr_1.2fr_48px] items-center gap-3 md:gap-0 hover:bg-zinc-50/70 transition-colors"
              >
                {/* Order ID */}
                <div>
                  <p className="font-bold text-zinc-900 text-sm">
                    #{String(order.id).slice(-6).toUpperCase()}
                  </p>
                  {typeof order.total_amount === "number" && (
                    <p className="text-xs text-zinc-400 mt-0.5">
                      ₹{Number(order.total_amount).toFixed(2)}
                    </p>
                  )}
                </div>

                {/* Purchased date */}
                <div className="text-sm text-zinc-600">
                  {format(parseISO(order.created_at), "MMM do, yyyy")}
                </div>

                {/* Items */}
                <div className="space-y-0.5">
                  {items.length === 0 ? (
                    <span className="text-sm text-zinc-400">—</span>
                  ) : (
                    items.map((item, idx) => (
                      <div
                        key={idx}
                        className="flex items-center gap-1.5 text-sm"
                      >
                        <span className="font-medium text-zinc-800">
                          {getProductName(item?.products ?? null) ?? "Product"}
                        </span>
                        <span className="text-zinc-400 text-xs">
                          ×{item?.quantity}
                        </span>
                      </div>
                    ))
                  )}
                </div>

                {/* Target Delivery */}
                <div className="text-sm text-zinc-600">
                  {displayDate ? (
                    <span>
                      {format(parseISO(displayDate), "MMM do, yyyy")}
                    </span>
                  ) : (
                    <span className="text-zinc-400">—</span>
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
                        className="h-8 w-8 text-zinc-400 hover:text-zinc-700"
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
                          "flex items-center gap-2 cursor-pointer",
                          !canEdit && "opacity-40 cursor-not-allowed",
                        )}
                      >
                        <CalendarDays className="h-4 w-4" />
                        Edit Delivery Date
                        {!canEdit && orderStatus === "scheduled" && (
                          <span className="ml-auto text-[10px] text-zinc-400 font-normal">
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

      <EditDeliveryDialog order={editOrder} open={editOpen} onClose={closeEdit} />
    </>
  );
}
