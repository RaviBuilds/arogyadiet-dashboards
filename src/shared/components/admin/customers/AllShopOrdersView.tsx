"use client";

// src/shared/components/admin/customers/AllShopOrdersView.tsx
//
// Feature: admin-place-shop-order-for-customer — the full shop-order ledger.
//
// Sibling of the compact Operations `ShopOrdersTab`, but for accountability
// rather than daily dispatch: it lists the complete history and adds a "source"
// dimension so an operator can tell, at a glance, whether an order was bought by
// the customer, placed by an admin for a subscriber, or sold to a walk-in buyer.
// The row actions mirror the Operations tab so an order can still be rescheduled
// or closed out from here.

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/shared/components/ui/table";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/shared/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/components/ui/dialog";
import {
  CalendarDays,
  CheckCheck,
  Loader2,
  MoreHorizontal,
  ShoppingBag,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import * as XLSX from "xlsx";

import { DataTableCard } from "../core/DataTableCard";
import { SectionHeader } from "../core/SectionHeader";
import { DataSearchFilter } from "../core/DataSearchFilter";
import { ExportButton, RefreshButton } from "../core/ActionButtons";
import {
  adminUpdateAddonOrderDeliveryDate,
  adminMarkAddonOrderDeliveredOffline,
} from "@/actions/admin-actions/customerActions";
import type { ShopOrderAdminData } from "./CustomerDashboard";

type OrderSource = "CUSTOMER" | "ADMIN" | "WALK_IN";
type SourceFilter = "ALL" | OrderSource;

/**
 * Where the order came from. A walk-in has no customer profile; an assisted
 * order carries the operator who placed it; everything else is self-serve.
 */
function getOrderSource(order: ShopOrderAdminData): OrderSource {
  if (order.walkin_name) return "WALK_IN";
  if (order.placed_by_user_id) return "ADMIN";
  return "CUSTOMER";
}

const sourceConfig: Record<
  OrderSource,
  { label: string; className: string }
> = {
  CUSTOMER: {
    label: "Customer",
    className: "bg-slate-50 text-slate-700 border border-slate-200",
  },
  ADMIN: {
    label: "Admin placed",
    className: "bg-indigo-50 text-indigo-700 border border-indigo-200",
  },
  WALK_IN: {
    label: "Walk-in",
    className: "bg-purple-50 text-purple-700 border border-purple-200",
  },
};

const statusConfig: Record<string, { label: string; className: string }> = {
  purchased: {
    label: "Purchased",
    className: "bg-amber-50 text-amber-700 border border-amber-200",
  },
  scheduled: {
    label: "Scheduled",
    className: "bg-blue-50 text-blue-700 border border-blue-200",
  },
  delivered: {
    label: "Delivered",
    className: "bg-green-50 text-green-700 border border-green-200",
  },
  delivered_offline: {
    label: "Delivered (Offline)",
    className: "bg-green-50 text-green-700 border border-green-200",
  },
  clinic_pickup: {
    label: "Handed Over",
    className: "bg-teal-50 text-teal-700 border border-teal-200",
  },
  cancelled: {
    label: "Cancelled",
    className: "bg-red-50 text-red-700 border border-red-200",
  },
  pending: {
    label: "Payment Pending",
    className: "bg-zinc-100 text-zinc-600 border border-zinc-200",
  },
  unknown: {
    label: "Unknown",
    className: "bg-zinc-100 text-zinc-500 border border-zinc-200",
  },
};

/** Same derivation as the Operations tab so both views label orders identically. */
function getShopOrderStatus(order: ShopOrderAdminData): string {
  if (order.fulfillment_status === "CLINIC_PICKUP") return "clinic_pickup";
  if (order.fulfillment_status === "DELIVERED_OFFLINE") return "delivered_offline";
  if (order.status === "DELIVERED" || order.status === "COMPLETED")
    return "delivered";
  if (order.status === "CANCELLED") return "cancelled";
  if (order.status === "PENDING") return "pending";
  if (order.status === "PAID" && !order.delivery_order_id) return "purchased";
  if (order.status === "PAID" && order.delivery_order_id) return "scheduled";
  return "unknown";
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export default function AllShopOrdersView({
  shopOrders = [],
  loadedLimit,
}: {
  shopOrders?: ShopOrderAdminData[];
  loadedLimit?: number;
}) {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [searchColumn, setSearchColumn] = useState("customer_name");
  const [searchTerm, setSearchTerm] = useState("");
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("ALL");

  const [isEditOpen, setIsEditOpen] = useState(false);
  const [activeOrder, setActiveOrder] = useState<ShopOrderAdminData | null>(null);
  const [editDate, setEditDate] = useState("");
  const [isEditPending, startEditTransition] = useTransition();

  const [deliverTarget, setDeliverTarget] = useState<ShopOrderAdminData | null>(
    null,
  );
  const [isDeliverPending, startDeliverTransition] = useTransition();

  const searchOptions = useMemo(
    () => [
      { value: "customer_name", label: "Customer / Buyer" },
      { value: "customer_mobile", label: "Mobile" },
      { value: "product", label: "Product" },
      { value: "id", label: "Order #" },
    ],
    [],
  );

  const counts = useMemo(() => {
    const tally: Record<SourceFilter, number> = {
      ALL: shopOrders.length,
      CUSTOMER: 0,
      ADMIN: 0,
      WALK_IN: 0,
    };
    for (const order of shopOrders) tally[getOrderSource(order)] += 1;
    return tally;
  }, [shopOrders]);

  const filteredOrders = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    return shopOrders.filter((order) => {
      if (sourceFilter !== "ALL" && getOrderSource(order) !== sourceFilter) {
        return false;
      }
      if (!term) return true;

      switch (searchColumn) {
        case "customer_mobile":
          return (order.customer_mobile ?? "").toLowerCase().includes(term);
        case "product":
          return order.items.some((item) =>
            item.product_name.toLowerCase().includes(term),
          );
        case "id":
          return order.id.toLowerCase().includes(term);
        default:
          return order.customer_name.toLowerCase().includes(term);
      }
    });
  }, [shopOrders, searchTerm, searchColumn, sourceFilter]);

  const totalValue = useMemo(
    () =>
      filteredOrders.reduce(
        (sum, order) => sum + Number(order.total_amount ?? 0),
        0,
      ),
    [filteredOrders],
  );

  const handleRefresh = () => {
    setIsLoading(true);
    startTransition(() => {
      router.refresh();
      setIsLoading(false);
      toast.success("Data refreshed successfully");
    });
  };

  const handleExportExcel = () => {
    if (filteredOrders.length === 0) return;
    const exportData = filteredOrders.map((row) => ({
      "Order #": `#${String(row.id).slice(-6).toUpperCase()}`,
      Source: sourceConfig[getOrderSource(row)].label,
      "Customer / Buyer": row.customer_name,
      Mobile: row.customer_mobile ?? "",
      "Walk-in Address": row.walkin_address ?? "",
      Items: row.items.map((i) => `${i.product_name} x${i.quantity}`).join(", "),
      "Units": row.items.reduce((sum, i) => sum + Number(i.quantity ?? 0), 0),
      "Amount (₹)":
        row.total_amount != null ? Number(row.total_amount).toFixed(2) : "",
      "Placed On": row.created_at
        ? new Date(row.created_at).toLocaleDateString("en-IN")
        : "",
      "Placed By": row.placed_by_name ?? (row.placed_by_user_id ? "Admin" : "Self"),
      "Target Delivery":
        row.scheduled_delivery_date ?? row.target_delivery_date ?? "",
      "Delivered On": row.delivered_at
        ? new Date(row.delivered_at).toLocaleDateString("en-IN")
        : "",
      Status: statusConfig[getShopOrderStatus(row)].label,
    }));
    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Shop Orders");
    XLSX.writeFile(
      wb,
      `AllShopOrders_${new Date().toISOString().split("T")[0]}.xlsx`,
    );
  };

  const openEditModal = (order: ShopOrderAdminData) => {
    setActiveOrder(order);
    setEditDate(order.target_delivery_date ?? "");
    setIsEditOpen(true);
  };

  const handleEditSubmit = () => {
    if (!activeOrder || !editDate) return;
    startEditTransition(async () => {
      const res = await adminUpdateAddonOrderDeliveryDate(
        activeOrder.id,
        editDate,
      );
      if (res.success) {
        toast.success("Delivery date updated successfully.");
        setIsEditOpen(false);
        router.refresh();
      } else {
        toast.error(res.error ?? "Failed to update delivery date.");
      }
    });
  };

  const getTomorrow = () => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return d.toISOString().split("T")[0];
  };

  const handleMarkDeliveredOffline = () => {
    if (!deliverTarget) return;
    startDeliverTransition(async () => {
      const res = await adminMarkAddonOrderDeliveredOffline(deliverTarget.id);
      if (res.success) {
        toast.success("Order marked delivered (offline).");
        setDeliverTarget(null);
        router.refresh();
      } else {
        toast.error(res.error ?? "Failed to mark the order delivered.");
      }
    });
  };

  return (
    <>
      <DataTableCard
        header={
          <SectionHeader
            title={`Shop Orders (${filteredOrders.length})`}
            icon={ShoppingBag}
          />
        }
        controls={
          <div className="flex flex-wrap items-center gap-4">
            <DataSearchFilter
              searchColumn={searchColumn}
              onColumnChange={setSearchColumn}
              searchTerm={searchTerm}
              onTermChange={setSearchTerm}
              options={searchOptions}
            />
            <div
              role="group"
              aria-label="Filter by order source"
              className="flex flex-wrap items-center gap-1 rounded-lg border border-slate-200 bg-white p-0.5"
            >
              {(
                [
                  ["ALL", "All"],
                  ["CUSTOMER", "Customer"],
                  ["ADMIN", "Admin placed"],
                  ["WALK_IN", "Walk-in"],
                ] as const
              ).map(([value, label]) => (
                <Button
                  key={value}
                  type="button"
                  size="sm"
                  variant={sourceFilter === value ? "default" : "ghost"}
                  onClick={() => setSourceFilter(value)}
                >
                  {label}
                  <span className="ml-1 text-xs opacity-70">
                    {counts[value]}
                  </span>
                </Button>
              ))}
            </div>
          </div>
        }
        actions={
          <>
            <ExportButton
              onClick={handleExportExcel}
              disabled={filteredOrders.length === 0}
            />
            <RefreshButton
              onClick={handleRefresh}
              isLoading={isLoading || isPending}
            />
          </>
        }
        footer={
          <>
            <span className="text-sm text-slate-500">
              {loadedLimit && shopOrders.length >= loadedLimit
                ? `Showing the ${loadedLimit} most recent orders.`
                : `Showing all ${shopOrders.length} orders.`}
            </span>
            <span className="text-sm font-semibold text-slate-900">
              Total: ₹{totalValue.toFixed(2)}
            </span>
          </>
        }
      >
        <Table>
          <TableHeader>
            <TableRow className="border-b border-slate-200 bg-slate-50/50">
              <TableHead className="text-xs font-medium uppercase tracking-wider text-slate-500">
                Order
              </TableHead>
              <TableHead className="text-xs font-medium uppercase tracking-wider text-slate-500">
                Customer / Buyer
              </TableHead>
              <TableHead className="text-xs font-medium uppercase tracking-wider text-slate-500">
                Source
              </TableHead>
              <TableHead className="text-xs font-medium uppercase tracking-wider text-slate-500">
                Items
              </TableHead>
              <TableHead className="text-xs font-medium uppercase tracking-wider text-slate-500">
                Placed
              </TableHead>
              <TableHead className="text-xs font-medium uppercase tracking-wider text-slate-500">
                Delivery
              </TableHead>
              <TableHead className="text-xs font-medium uppercase tracking-wider text-slate-500">
                Status
              </TableHead>
              <TableHead className="w-[50px] text-xs font-medium uppercase tracking-wider text-slate-500">
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredOrders.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={8}
                  className="py-12 text-center text-sm text-slate-500"
                >
                  No shop orders found.
                </TableCell>
              </TableRow>
            ) : (
              filteredOrders.map((order) => {
                const orderStatus = getShopOrderStatus(order);
                const cfg = statusConfig[orderStatus] ?? statusConfig.unknown;
                const source = getOrderSource(order);
                const srcCfg = sourceConfig[source];
                const canEdit = orderStatus === "purchased";
                const canMarkDelivered =
                  orderStatus === "purchased" || orderStatus === "scheduled";
                const units = order.items.reduce(
                  (sum, i) => sum + Number(i.quantity ?? 0),
                  0,
                );

                return (
                  <TableRow
                    key={order.id}
                    className="transition-colors duration-200 hover:bg-slate-50"
                  >
                    <TableCell>
                      <div className="text-sm font-semibold tracking-tight text-slate-900">
                        #{String(order.id).slice(-6).toUpperCase()}
                      </div>
                      {typeof order.total_amount === "number" && (
                        <div className="mt-0.5 text-sm text-slate-500">
                          ₹{Number(order.total_amount).toFixed(2)}
                        </div>
                      )}
                    </TableCell>

                    <TableCell>
                      <div className="font-semibold tracking-tight text-slate-900">
                        {order.customer_name}
                      </div>
                      {order.customer_mobile ? (
                        <div className="text-xs text-slate-500">
                          {order.customer_mobile}
                        </div>
                      ) : null}
                      {order.walkin_address ? (
                        <div className="max-w-[220px] truncate text-xs text-slate-400">
                          {order.walkin_address}
                        </div>
                      ) : null}
                    </TableCell>

                    <TableCell>
                      <span
                        className={cn(
                          "inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium",
                          srcCfg.className,
                        )}
                      >
                        {srcCfg.label}
                      </span>
                      {order.placed_by_name ? (
                        <div className="mt-0.5 text-xs text-slate-500">
                          by {order.placed_by_name}
                        </div>
                      ) : null}
                    </TableCell>

                    <TableCell>
                      <div className="max-w-[240px] text-sm text-slate-700">
                        {order.items.length === 0
                          ? "—"
                          : order.items
                              .map((i) => `${i.product_name} ×${i.quantity}`)
                              .join(", ")}
                      </div>
                      {units > 0 ? (
                        <div className="text-xs text-slate-400">
                          {units} unit{units === 1 ? "" : "s"}
                        </div>
                      ) : null}
                    </TableCell>

                    <TableCell className="text-sm text-slate-700">
                      {formatDate(order.created_at)}
                    </TableCell>

                    <TableCell className="text-sm text-slate-700">
                      {order.delivered_at
                        ? `Delivered ${formatDate(order.delivered_at)}`
                        : (order.scheduled_delivery_date ??
                            order.target_delivery_date ??
                            "—")}
                    </TableCell>

                    <TableCell>
                      <span
                        className={cn(
                          "inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium",
                          cfg.className,
                        )}
                      >
                        {cfg.label}
                      </span>
                    </TableCell>

                    <TableCell>
                      {canEdit || canMarkDelivered ? (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label="Order actions"
                            >
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuLabel>Actions</DropdownMenuLabel>
                            <DropdownMenuSeparator />
                            {canEdit ? (
                              <DropdownMenuItem
                                onClick={() => openEditModal(order)}
                              >
                                <CalendarDays className="mr-2 h-4 w-4" />
                                Edit delivery date
                              </DropdownMenuItem>
                            ) : null}
                            {canMarkDelivered ? (
                              <DropdownMenuItem
                                onClick={() => setDeliverTarget(order)}
                              >
                                <CheckCheck className="mr-2 h-4 w-4" />
                                Mark delivered (offline)
                              </DropdownMenuItem>
                            ) : null}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      ) : (
                        <span className="sr-only">No actions available</span>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </DataTableCard>

      {/* Edit delivery date */}
      <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit delivery date</DialogTitle>
            <DialogDescription>
              Pick an upcoming active (non-paused) day inside the customer&apos;s
              subscription window. The order will ride along with that delivery.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="all-shop-orders-delivery-date">Delivery date</Label>
            <Input
              id="all-shop-orders-delivery-date"
              type="date"
              min={getTomorrow()}
              value={editDate}
              onChange={(e) => setEditDate(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setIsEditOpen(false)}
              disabled={isEditPending}
            >
              Cancel
            </Button>
            <Button
              onClick={handleEditSubmit}
              disabled={!editDate || isEditPending}
            >
              {isEditPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Mark delivered offline */}
      <Dialog
        open={deliverTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeliverTarget(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Mark delivered (offline)?</DialogTitle>
            <DialogDescription>
              This closes the order outside the delivery pipeline — use it when
              the customer collected the product in person. It is removed from any
              assigned delivery, so no rider will carry it.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeliverTarget(null)}
              disabled={isDeliverPending}
            >
              Cancel
            </Button>
            <Button
              onClick={handleMarkDeliveredOffline}
              disabled={isDeliverPending}
            >
              {isDeliverPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
              Mark delivered
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
