"use client";

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
import { CalendarDays, Loader2, MoreHorizontal, ShoppingBag } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import * as XLSX from "xlsx";

import { DataTableCard } from "../core/DataTableCard";
import { SectionHeader } from "../core/SectionHeader";
import { DataSearchFilter } from "../core/DataSearchFilter";
import { ExportButton, RefreshButton } from "../core/ActionButtons";
import { adminUpdateAddonOrderDeliveryDate } from "@/actions/admin-actions/customerActions";
import type { ShopOrderAdminData } from "@/shared/components/admin/customers/CustomerDashboard";

/**
 * Shop (addon) orders list. Moved here from the Customers portal so all
 * fulfilment-related views live under Operations.
 */
export function ShopOrdersTab({
  shopOrders = [],
}: {
  shopOrders?: ShopOrderAdminData[];
}) {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [searchColumn, setSearchColumn] = useState("customer_name");
  const [searchTerm, setSearchTerm] = useState("");

  // Shop order edit state
  const [isShopEditOpen, setIsShopEditOpen] = useState(false);
  const [activeShopOrder, setActiveShopOrder] =
    useState<ShopOrderAdminData | null>(null);
  const [shopEditDate, setShopEditDate] = useState("");
  const [isShopEditPending, startShopEditTransition] = useTransition();

  const searchOptions = useMemo(
    () => [{ value: "customer_name", label: "Customer Name" }],
    [],
  );

  const filteredShopOrders = useMemo(() => {
    if (!searchTerm) return shopOrders;
    const lowerTerm = searchTerm.toLowerCase();
    return shopOrders.filter((o) =>
      o.customer_name.toLowerCase().includes(lowerTerm),
    );
  }, [shopOrders, searchTerm]);

  const handleRefresh = () => {
    setIsLoading(true);
    startTransition(() => {
      router.refresh();
      setIsLoading(false);
      toast.success("Data refreshed successfully");
    });
  };

  const handleExportExcel = () => {
    if (filteredShopOrders.length === 0) return;
    const exportData = filteredShopOrders.map((row) => ({
      "Order #": `#${String(row.id).slice(-6).toUpperCase()}`,
      Customer: row.customer_name,
      Items: row.items.map((i) => `${i.product_name} x${i.quantity}`).join(", "),
      "Amount (₹)":
        row.total_amount != null ? Number(row.total_amount).toFixed(2) : "",
      "Purchased On": row.created_at
        ? new Date(row.created_at).toLocaleDateString("en-IN")
        : "",
      "Target Delivery":
        row.scheduled_delivery_date ?? row.target_delivery_date ?? "",
      Status:
        row.status === "PAID" && !row.delivery_order_id
          ? "Purchased"
          : row.status === "PAID" && row.delivery_order_id
            ? "Scheduled for Delivery"
            : row.status === "DELIVERED"
              ? "Delivered"
              : row.status === "CANCELLED"
                ? "Cancelled"
                : row.status === "PENDING"
                  ? "Payment Pending"
                  : row.status ?? "",
    }));
    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Shop Orders");
    XLSX.writeFile(
      wb,
      `ShopOrders_${new Date().toISOString().split("T")[0]}.xlsx`,
    );
  };

  const openShopEditModal = (order: ShopOrderAdminData) => {
    setActiveShopOrder(order);
    setShopEditDate(order.target_delivery_date ?? "");
    setIsShopEditOpen(true);
  };

  const handleShopEditSubmit = () => {
    if (!activeShopOrder || !shopEditDate) return;
    startShopEditTransition(async () => {
      const res = await adminUpdateAddonOrderDeliveryDate(
        activeShopOrder.id,
        shopEditDate,
      );
      if (res.success) {
        toast.success("Delivery date updated successfully.");
        setIsShopEditOpen(false);
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

  const getShopOrderStatus = (order: ShopOrderAdminData) => {
    if (order.status === "DELIVERED") return "delivered";
    if (order.status === "CANCELLED") return "cancelled";
    if (order.status === "PENDING") return "pending";
    if (order.status === "PAID" && !order.delivery_order_id) return "purchased";
    if (order.status === "PAID" && order.delivery_order_id) return "scheduled";
    return "unknown";
  };

  return (
    <>
      <DataTableCard
        header={<SectionHeader title="Shop Orders" icon={ShoppingBag} />}
        controls={
          <div className="flex flex-wrap items-center gap-4">
            <DataSearchFilter
              searchColumn={searchColumn}
              onColumnChange={setSearchColumn}
              searchTerm={searchTerm}
              onTermChange={setSearchTerm}
              options={searchOptions}
            />
          </div>
        }
        actions={
          <>
            <ExportButton
              onClick={handleExportExcel}
              disabled={filteredShopOrders.length === 0}
            />
            <RefreshButton
              onClick={handleRefresh}
              isLoading={isLoading || isPending}
            />
          </>
        }
      >
        <Table>
          <TableHeader>
            <TableRow className="bg-slate-50/50 border-b border-slate-200">
              <TableHead className="text-xs font-medium text-slate-500 uppercase tracking-wider">Order</TableHead>
              <TableHead className="text-xs font-medium text-slate-500 uppercase tracking-wider">Customer</TableHead>
              <TableHead className="text-xs font-medium text-slate-500 uppercase tracking-wider">Items</TableHead>
              <TableHead className="text-xs font-medium text-slate-500 uppercase tracking-wider">Purchased</TableHead>
              <TableHead className="text-xs font-medium text-slate-500 uppercase tracking-wider">Target Delivery</TableHead>
              <TableHead className="text-xs font-medium text-slate-500 uppercase tracking-wider">Status</TableHead>
              <TableHead className="w-[50px] text-xs font-medium text-slate-500 uppercase tracking-wider">
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredShopOrders.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={7}
                  className="text-center py-12 text-sm text-slate-500"
                >
                  No shop orders found.
                </TableCell>
              </TableRow>
            ) : (
              filteredShopOrders.map((order) => {
                const orderStatus = getShopOrderStatus(order);
                const canEdit = orderStatus === "purchased";
                const displayDate =
                  order.scheduled_delivery_date ?? order.target_delivery_date;

                const statusConfig: Record<
                  string,
                  { label: string; className: string }
                > = {
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
                const cfg = statusConfig[orderStatus] ?? statusConfig.unknown;

                return (
                  <TableRow key={order.id} className="hover:bg-slate-50 transition-colors duration-200">
                    <TableCell>
                      <div className="font-semibold text-slate-900 tracking-tight text-sm">
                        #{String(order.id).slice(-6).toUpperCase()}
                      </div>
                      {typeof order.total_amount === "number" && (
                        <div className="text-sm text-slate-500 mt-0.5">
                          ₹{Number(order.total_amount).toFixed(2)}
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="font-semibold text-slate-900 tracking-tight">{order.customer_name}</div>
                    </TableCell>
                    <TableCell>
                      <div className="space-y-0.5">
                        {order.items.length === 0 ? (
                          <span className="text-slate-500 text-sm">—</span>
                        ) : (
                          order.items.map((item, idx) => (
                            <div key={idx} className="flex items-center gap-1.5 text-sm">
                              <span className="font-medium text-slate-900">{item.product_name}</span>
                              <span className="text-slate-500 text-xs">×{item.quantity}</span>
                            </div>
                          ))
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="text-sm">
                        {order.created_at
                          ? new Date(order.created_at).toLocaleDateString("en-IN", {
                              day: "numeric",
                              month: "short",
                              year: "numeric",
                            })
                          : "—"}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="text-sm">
                        {displayDate
                          ? new Date(displayDate).toLocaleDateString("en-IN", {
                              day: "numeric",
                              month: "short",
                              year: "numeric",
                            })
                          : "—"}
                      </div>
                    </TableCell>
                    <TableCell>
                      <span
                        className={cn(
                          "inline-flex items-center text-xs font-semibold px-2.5 py-1 rounded-full",
                          cfg.className,
                        )}
                      >
                        {cfg.label}
                      </span>
                    </TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" className="h-8 w-8 p-0 transition-all duration-200 hover:bg-slate-100">
                            <MoreHorizontal className="h-4 w-4 text-slate-500" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-[200px]">
                          <DropdownMenuLabel className="text-xs text-muted-foreground font-normal">
                            Order Actions
                          </DropdownMenuLabel>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            onClick={() => canEdit && openShopEditModal(order)}
                            disabled={!canEdit}
                            className={cn(
                              "cursor-pointer flex items-center",
                              !canEdit && "opacity-40 cursor-not-allowed",
                            )}
                          >
                            <CalendarDays className="mr-2 h-4 w-4" />
                            Edit Delivery Date
                            {!canEdit && orderStatus === "scheduled" && (
                              <span className="ml-auto text-[10px] text-muted-foreground">
                                Locked
                              </span>
                            )}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </DataTableCard>

      {/* --- SHOP ORDER EDIT DELIVERY DATE DIALOG --- */}
      <Dialog open={isShopEditOpen} onOpenChange={setIsShopEditOpen}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CalendarDays className="h-5 w-5 text-primary" />
              Edit Delivery Date
            </DialogTitle>
            <DialogDescription>
              Change the target delivery date for Order #
              {activeShopOrder ? String(activeShopOrder.id).slice(-6).toUpperCase() : ""}{" "}
              ({activeShopOrder?.customer_name}).
            </DialogDescription>
          </DialogHeader>
          <div className="py-4 space-y-3">
            <div className="grid gap-2">
              <label className="text-sm font-medium">New Delivery Date</label>
              <input
                type="date"
                value={shopEditDate}
                min={getTomorrow()}
                onChange={(e) => setShopEditDate(e.target.value)}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              />
              <p className="text-xs text-muted-foreground">
                Earliest: {new Date(getTomorrow()).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsShopEditOpen(false)} disabled={isShopEditPending}>
              Cancel
            </Button>
            <Button
              onClick={handleShopEditSubmit}
              disabled={isShopEditPending || !shopEditDate || shopEditDate < getTomorrow()}
            >
              {isShopEditPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
