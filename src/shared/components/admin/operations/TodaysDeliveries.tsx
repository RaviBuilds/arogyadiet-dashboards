"use client";

import { useState, useMemo, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/shared/components/ui/table";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "@/shared/components/ui/dropdown-menu";
import { Package, Layers, Filter, ChevronDown, Loader2 } from "lucide-react";
import { revalidateOperationsPage, updateAdminOrderStatusAction, markAdminBatchPickedUpAction } from "@/actions/admin-actions/operationsActions";
import { getAdminNextStatusTransition, PRE_PICKUP_ORDER_STATUSES } from "@/lib/delivery/adminOrderStatusTransitions";
import {
  formatDeliveryCountBreakdown,
  isBatchCompleteByCounts,
} from "@/lib/delivery/orderStatuses";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import * as XLSX from "xlsx";

// Import our new Core Design System Components
import { DataTableCard } from "../core/DataTableCard";
import { SectionHeader } from "../core/SectionHeader";
import { DataSearchFilter } from "../core/DataSearchFilter";
import { StatusBadge } from "../core/StatusBadge";
import { ExportButton, RefreshButton } from "../core/ActionButtons";
import { ConfirmActionModal } from "../core/ConfirmActionModal";

const getISTDateString = (offsetDays = 0) => {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
};

const getDayLabel = (deliveryDate: string) => {
  if (deliveryDate === getISTDateString()) return "Today";
  if (deliveryDate === getISTDateString(1)) return "Tomorrow";
  return deliveryDate;
};

const PICKED_UP_BATCH_STATUSES = ["IN_TRANSIT", "COMPLETED"];
const DISPATCH_STATUS_ORDER = [
  "ORDER_CREATED",
  "MEAL_PREPARED",
  "ASSIGNED",
  "OUT_FOR_DELIVERY",
  "REACHING_TO_LOCATION",
  "DELIVERED",
  "FAILED",
  "CANCELLED",
];

type OrderActionResult = { success: boolean; error?: string };
type BatchActionResult = {
  success: boolean;
  error?: string;
  ordersUpdated?: number;
};

interface TodaysDeliveriesProps {
  data?: any[];
  /**
   * Injectable actions so this board can be reused by the franchise portal.
   * Defaults to the core admin actions — admin behavior is unchanged.
   */
  onUpdateStatus?: (orderId: string) => Promise<OrderActionResult>;
  onMarkBatchPickup?: (
    batchId: string,
    deliveryDate: string,
  ) => Promise<BatchActionResult>;
  onRevalidate?: () => Promise<void>;
}

export default function TodaysDeliveries({
  data = [],
  onUpdateStatus = updateAdminOrderStatusAction,
  onMarkBatchPickup = markAdminBatchPickedUpAction,
  onRevalidate = revalidateOperationsPage,
}: TodaysDeliveriesProps) {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  const [isPending, startTransition] = useTransition();
  
  // Dispatch Board State
  const [searchColumn, setSearchColumn] = useState("customer_name");
  const [searchTerm, setSearchTerm] = useState("");
  const [filterDay, setFilterDay] = useState<"BOTH" | "Today" | "Tomorrow">("BOTH");
  const [filterRiders, setFilterRiders] = useState<string[]>([]);
  const [filterStatuses, setFilterStatuses] = useState<string[]>([]);

  // Active Batches State
  const [batchSearchColumn, setBatchSearchColumn] = useState("batch_id");
  const [batchSearchTerm, setBatchSearchTerm] = useState("");
  const [batchStatusFilter, setBatchStatusFilter] = useState<string[]>([]);
  const [pendingOrderId, setPendingOrderId] = useState<string | null>(null);
  const [statusConfirmOrder, setStatusConfirmOrder] = useState<{
    id: string;
    customerName: string;
    currentStatus: string;
    nextStatus: string;
    actionLabel: string;
  } | null>(null);
  const [pendingBatchKey, setPendingBatchKey] = useState<string | null>(null);
  const [batchPickupConfirm, setBatchPickupConfirm] = useState<{
    batchId: string;
    deliveryDate: string;
    batchLabel: string;
    riderName: string;
    mealCount: number;
  } | null>(null);

  // --- DISPATCH BOARD LOGIC ---
  const uniqueRiders = useMemo(() => {
    return Array.from(
      new Set(data.map((order) => order.rider_profiles?.users?.full_name || "Unassigned")),
    ).sort((a, b) => a.localeCompare(b));
  }, [data]);

  const uniqueStatuses = useMemo(() => {
    return Array.from(
      new Set(data.map((order) => (order.status || "UNKNOWN").toUpperCase())),
    ).sort((a, b) => {
      const aIndex = DISPATCH_STATUS_ORDER.indexOf(a);
      const bIndex = DISPATCH_STATUS_ORDER.indexOf(b);
      const safeAIndex = aIndex === -1 ? Number.MAX_SAFE_INTEGER : aIndex;
      const safeBIndex = bIndex === -1 ? Number.MAX_SAFE_INTEGER : bIndex;

      if (safeAIndex !== safeBIndex) return safeAIndex - safeBIndex;
      return a.localeCompare(b);
    });
  }, [data]);

  const filteredData = useMemo(() => {
    let result = data;
    if (searchTerm) {
      const lowerTerm = searchTerm.toLowerCase();
      result = result.filter(row => {
        if (searchColumn === "customer_name") return row.customer_profiles?.users?.full_name?.toLowerCase().includes(lowerTerm);
        if (searchColumn === "batch_id") return (row.delivery_batches?.id || "").toLowerCase().includes(lowerTerm);
        return true;
      });
    }

    if (filterDay !== "BOTH") {
      const targetDate =
        filterDay === "Today" ? getISTDateString() : getISTDateString(1);
      result = result.filter((row) => row.delivery_date === targetDate);
    }

    if (filterRiders.length > 0) {
      result = result.filter((row) =>
        filterRiders.includes(
          row.rider_profiles?.users?.full_name || "Unassigned",
        ),
      );
    }

    if (filterStatuses.length > 0) {
      result = result.filter((row) =>
        filterStatuses.includes((row.status || "UNKNOWN").toUpperCase()),
      );
    }

    return result;
  }, [data, searchTerm, searchColumn, filterDay, filterRiders, filterStatuses]);

  // --- ACTIVE BATCHES LOGIC ---
  const batchSummary = useMemo(() => {
    const batches = new Map();
    const todayStr = getISTDateString();
    const tomorrowStr = getISTDateString(1);
    const relevantDates = new Set([todayStr, tomorrowStr]);

    data
      .filter((order) => relevantDates.has(order.delivery_date))
      .forEach((order) => {
      const batchId = order.delivery_batches?.id || "UNBATCHED";
      const batchKey =
        batchId === "UNBATCHED"
          ? `UNBATCHED-${order.delivery_date}`
          : batchId;
      if (!batches.has(batchKey)) {
        batches.set(batchKey, {
          id: batchId,
          deliveryDate: order.delivery_date,
          status: order.delivery_batches?.status || "PENDING",
          distance: order.delivery_batches?.total_distance_km || 0,
          payout: order.delivery_batches?.expected_payout || 0,
          riderName: order.rider_profiles?.users?.full_name || "Unassigned",
          mealCount: 0,
          deliveredCount: 0,
          failedCount: 0,
          addonCount: 0,
          pendingPickupCount: 0,
        });
      }
      const b = batches.get(batchKey);
      b.mealCount += 1;
      if (order.status === "DELIVERED") b.deliveredCount += 1;
      if (order.status === "FAILED") b.failedCount += 1;
      if (PRE_PICKUP_ORDER_STATUSES.includes(order.status)) {
        b.pendingPickupCount += 1;
      }
      order.addon_orders?.forEach((ao: any) => {
        ao.addon_order_items?.forEach((item: any) => {
          b.addonCount += item.quantity || 1;
        });
      });
    });
    return Array.from(batches.values()).map((batch) => {
      const displayStatus =
        batch.id !== "UNBATCHED" &&
        isBatchCompleteByCounts({
          mealCount: batch.mealCount,
          deliveredCount: batch.deliveredCount,
          failedCount: batch.failedCount,
        })
          ? "COMPLETED"
          : batch.status;

      return {
        ...batch,
        displayStatus,
        isPickedUp:
          batch.id !== "UNBATCHED" &&
          (PICKED_UP_BATCH_STATUSES.includes(displayStatus.toUpperCase()) ||
            batch.pendingPickupCount === 0),
        canMarkPickup:
          batch.id !== "UNBATCHED" &&
          displayStatus.toUpperCase() === "PENDING" &&
          batch.pendingPickupCount > 0,
      };
    });
  }, [data]);

  const filteredBatchSummary = useMemo(() => {
    let result = batchSummary;
    
    // 1. Text Search
    if (batchSearchTerm) {
      const lowerTerm = batchSearchTerm.toLowerCase();
      result = result.filter(b => {
        if (batchSearchColumn === "batch_id") return b.id.toLowerCase().includes(lowerTerm);
        if (batchSearchColumn === "riderName") return b.riderName.toLowerCase().includes(lowerTerm);
        return true;
      });
    }
    
    // 2. Status Dropdown Filter
    if (batchStatusFilter.length > 0) {
      result = result.filter((b) =>
        batchStatusFilter.includes(b.displayStatus.toUpperCase()),
      );
    }
    
    return result;
  }, [batchSummary, batchSearchTerm, batchSearchColumn, batchStatusFilter]);

  // --- ACTIONS ---
  const handleRefreshISR = async () => {
    setIsLoading(true);
    await onRevalidate();
    router.refresh();
    setIsLoading(false);
    toast.success("Data refreshed successfully");
  };

  const handleExportOrders = () => {
    if (filteredData.length === 0) return;
    const exportData = filteredData.map(row => ({
      "Day": getDayLabel(row.delivery_date),
      "Customer Name": row.customer_profiles?.users?.full_name || "Unknown",
      "Meal Type": row.meal_categories?.name || "N/A",
      "Assigned Rider": row.rider_profiles?.users?.full_name || "Unassigned",
      "Sequence": row.route_sequence || "N/A",
      "Batch ID": row.delivery_batches?.id ? row.delivery_batches.id.substring(0, 6).toUpperCase() : "None",
      "Status": row.status,
      "Payout (INR)": row.payout_amount || 0
    }));
    const worksheet = XLSX.utils.json_to_sheet(exportData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Today's Deliveries");
    XLSX.writeFile(workbook, `Todays_Deliveries_${new Date().toISOString().split("T")[0]}.xlsx`);
  };

  const handleExportBatches = () => {
    if (filteredBatchSummary.length === 0) return;
    const exportData = filteredBatchSummary.map((b) => ({
      Day: getDayLabel(b.deliveryDate),
      "Batch Number":
        b.id === "UNBATCHED" ? "Unbatched" : b.id.substring(0, 8).toUpperCase(),
      "Meals Count": `${b.mealCount} (${formatDeliveryCountBreakdown({
        assigned: b.mealCount,
        delivered: b.deliveredCount,
        failed: b.failedCount,
      })})`,
      "Shop Products Count": b.addonCount,
      "Distance (km)": Number(b.distance).toFixed(2),
      "Payout (INR)": Number(b.payout).toFixed(2),
      "Assigned Rider": b.riderName,
      "Status": b.displayStatus
    }));
    const worksheet = XLSX.utils.json_to_sheet(exportData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Active Batches");
    XLSX.writeFile(workbook, `Active_Batches_${new Date().toISOString().split("T")[0]}.xlsx`);
  };

  const getTimeUpdated = (order: any) => {
    const dateStr = order.delivered_at || order.pickup_marked_at || order.created_at;
    if (!dateStr) return "N/A";
    return new Date(dateStr).toLocaleTimeString('en-US', { hour: "2-digit", minute: "2-digit" }).toUpperCase();
  };

  const handleStatusUpdateConfirm = () => {
    if (!statusConfirmOrder) return;

    const orderId = statusConfirmOrder.id;
    setPendingOrderId(orderId);

    startTransition(async () => {
      const result = await onUpdateStatus(orderId);
      setPendingOrderId(null);
      setStatusConfirmOrder(null);

      if (result.success) {
        toast.success(`Order marked as ${statusConfirmOrder.nextStatus.replace(/_/g, " ").toLowerCase()}`);
        router.refresh();
      } else {
        toast.error(result.error || "Failed to update order status");
      }
    });
  };

  const formatStatusLabel = (status: string) =>
    status.replace(/_/g, " ").toLowerCase();

  const handleBatchPickupConfirm = () => {
    if (!batchPickupConfirm) return;

    const batchKey = `${batchPickupConfirm.batchId}-${batchPickupConfirm.deliveryDate}`;
    setPendingBatchKey(batchKey);

    startTransition(async () => {
      const result = await onMarkBatchPickup(
        batchPickupConfirm.batchId,
        batchPickupConfirm.deliveryDate,
      );
      setPendingBatchKey(null);
      setBatchPickupConfirm(null);

      if (result.success) {
        toast.success(
          `Batch picked up. ${result.ordersUpdated ?? 0} order(s) marked out for delivery.`,
        );
        router.refresh();
      } else {
        toast.error(result.error || "Failed to mark batch pickup");
      }
    });
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      {/* DISPATCH BOARD TABLE */}
      <DataTableCard
        header={<SectionHeader title="Dispatch Board" icon={Package} />}
        controls={
          <DataSearchFilter
            searchColumn={searchColumn}
            onColumnChange={setSearchColumn}
            searchTerm={searchTerm}
            onTermChange={setSearchTerm}
            options={[
              { value: "customer_name", label: "Customer Name" },
              { value: "batch_id", label: "Batch ID" }
            ]}
          />
        }
        actions={
          <>
            <ExportButton onClick={handleExportOrders} disabled={filteredData.length === 0} label="Export Orders" />
            <RefreshButton onClick={handleRefreshISR} isLoading={isLoading || isPending} />
          </>
        }
      >
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/10">
              <TableHead>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="-ml-3 h-8 data-[state=open]:bg-accent font-semibold text-muted-foreground hover:text-foreground"
                    >
                      <span>Day</span>
                      <Filter
                        className={cn(
                          "ml-2 h-3.5 w-3.5",
                          filterDay !== "BOTH"
                            ? "text-primary fill-primary/20"
                            : "text-muted-foreground/70",
                        )}
                      />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="w-[150px]">
                    <DropdownMenuLabel>Filter by Day</DropdownMenuLabel>
                    {[
                      { value: "BOTH", label: "Both Days" },
                      { value: "Today", label: "Today" },
                      { value: "Tomorrow", label: "Tomorrow" },
                    ].map((option) => (
                      <DropdownMenuItem
                        key={option.value}
                        onClick={() =>
                          setFilterDay(
                            option.value as "BOTH" | "Today" | "Tomorrow",
                          )
                        }
                        className={
                          filterDay === option.value
                            ? "bg-accent font-semibold"
                            : ""
                        }
                      >
                        {option.label}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              </TableHead>
              <TableHead>Customer</TableHead>
              <TableHead>Meal Type</TableHead>
              <TableHead>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      className={`-ml-3 h-8 transition-colors ${filterRiders.length > 0 ? "bg-primary/10 text-primary hover:bg-primary/20 hover:text-primary" : "data-[state=open]:bg-accent"}`}
                    >
                      <span className={filterRiders.length > 0 ? "font-semibold" : ""}>Assigned Rider</span>
                      {filterRiders.length > 0 && <Badge variant="default" className="ml-2 h-5 px-1.5 text-[10px] rounded-sm">{filterRiders.length}</Badge>}
                      <Filter className={`ml-2 h-3.5 w-3.5 ${filterRiders.length > 0 ? "text-primary" : "text-muted-foreground"}`} />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="w-[200px]">
                    <DropdownMenuLabel>Filter by Rider</DropdownMenuLabel>
                    {uniqueRiders.map((rider) => (
                      <DropdownMenuCheckboxItem
                        key={rider}
                        checked={filterRiders.includes(rider)}
                        onCheckedChange={(checked) =>
                          setFilterRiders((prev) =>
                            checked
                              ? [...prev, rider]
                              : prev.filter((item) => item !== rider),
                          )
                        }
                      >
                        {rider}
                      </DropdownMenuCheckboxItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              </TableHead>
              <TableHead>Seq.</TableHead>
              <TableHead>Batch</TableHead>
              <TableHead>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      className={`-ml-3 h-8 transition-colors ${filterStatuses.length > 0 ? "bg-primary/10 text-primary hover:bg-primary/20 hover:text-primary" : "data-[state=open]:bg-accent"}`}
                    >
                      <span className={filterStatuses.length > 0 ? "font-semibold" : ""}>Status & Time</span>
                      {filterStatuses.length > 0 && <Badge variant="default" className="ml-2 h-5 px-1.5 text-[10px] rounded-sm">{filterStatuses.length}</Badge>}
                      <Filter className={`ml-2 h-3.5 w-3.5 ${filterStatuses.length > 0 ? "text-primary" : "text-muted-foreground"}`} />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="w-[210px]">
                    <DropdownMenuLabel>Filter by Status</DropdownMenuLabel>
                    {uniqueStatuses.map((status) => (
                      <DropdownMenuCheckboxItem
                        key={status}
                        checked={filterStatuses.includes(status)}
                        onCheckedChange={(checked) =>
                          setFilterStatuses((prev) =>
                            checked
                              ? [...prev, status]
                              : prev.filter((item) => item !== status),
                          )
                        }
                      >
                        {status.replace(/_/g, " ")}
                      </DropdownMenuCheckboxItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              </TableHead>
              <TableHead className="text-right">Payout</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredData.length === 0 ? (
               <TableRow>
                 <TableCell colSpan={8} className="text-center py-12 text-muted-foreground">
                   No deliveries scheduled for today or tomorrow matching your criteria.
                 </TableCell>
               </TableRow>
            ) : (
              filteredData.map((order, i) => {
                const dayLabel = getDayLabel(order.delivery_date);
                return (
                <TableRow key={order.id || i} className="hover:bg-muted/30">
                  <TableCell>
                    <Badge
                      variant="outline"
                      className={`text-xs font-medium ${
                        dayLabel === "Today"
                          ? "border-primary/30 bg-primary/5 text-primary"
                          : "border-blue-500/30 bg-blue-500/5 text-blue-600"
                      }`}
                    >
                      {dayLabel}
                    </Badge>
                  </TableCell>
                  <TableCell className="font-medium">{order.customer_profiles?.users?.full_name || "Unknown"}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{order.meal_categories?.name || "N/A"}</TableCell>
                  <TableCell>{order.rider_profiles?.users?.full_name || "Unassigned"}</TableCell>
                  <TableCell>{order.route_sequence || "-"}</TableCell>
                  <TableCell>
                    {order.delivery_batches?.id ? (
                      <Badge variant="outline" className="font-mono bg-muted/50 text-xs">
                        {order.delivery_batches.id.substring(0, 6).toUpperCase()}
                      </Badge>
                    ) : (
                      <span className="text-muted-foreground text-xs font-medium bg-muted px-2 py-1 rounded">None</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={order.status} />
                    <div className="text-[10px] text-muted-foreground mt-1 ml-1">{getTimeUpdated(order)}</div>
                    {(() => {
                      const transition = getAdminNextStatusTransition(order.status);
                      if (!transition) return null;

                      const customerName =
                        order.customer_profiles?.users?.full_name || "Unknown";
                      const isRowPending = pendingOrderId === order.id && isPending;

                      return (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={isRowPending}
                              className="mt-1 h-7 px-2 text-[11px] text-primary hover:text-primary"
                            >
                              {isRowPending ? (
                                <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                              ) : (
                                <ChevronDown className="mr-1 h-3 w-3" />
                              )}
                              Update Status
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="start">
                            <DropdownMenuItem
                              onClick={() =>
                                setStatusConfirmOrder({
                                  id: order.id,
                                  customerName,
                                  currentStatus: order.status,
                                  nextStatus: transition.next,
                                  actionLabel: transition.label,
                                })
                              }
                            >
                              {transition.label}
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      );
                    })()}
                  </TableCell>
                  <TableCell className="text-right font-medium text-foreground">
                    ₹{order.payout_amount || 0}
                  </TableCell>
                </TableRow>
              );
              })
            )}
          </TableBody>
        </Table>
      </DataTableCard>

      {/* ACTIVE BATCHES SUMMARY TABLE */}
      <DataTableCard
        header={<SectionHeader title="Active Batches Summary" icon={Layers} />}
        controls={
          <DataSearchFilter
            searchColumn={batchSearchColumn}
            onColumnChange={setBatchSearchColumn}
            searchTerm={batchSearchTerm}
            onTermChange={setBatchSearchTerm}
            options={[
              { value: "batch_id", label: "Batch Number" },
              { value: "riderName", label: "Rider Name" }
            ]}
          />
        }
        actions={
          <>
            <ExportButton onClick={handleExportBatches} disabled={filteredBatchSummary.length === 0} label="Export Batches" />
            <RefreshButton onClick={handleRefreshISR} isLoading={isLoading || isPending} />
          </>
        }
      >
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/10">
              <TableHead>Day</TableHead>
              <TableHead>Batch Number</TableHead>
              <TableHead>Meals Count</TableHead>
              <TableHead>Shop Products Count</TableHead>
              <TableHead>Distance (km)</TableHead>
              <TableHead>Payout (INR)</TableHead>
              <TableHead>Assigned Rider</TableHead>
              <TableHead>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="sm" className={`-ml-3 h-8 transition-colors ${batchStatusFilter.length > 0 ? "bg-primary/10 text-primary hover:bg-primary/20 hover:text-primary" : "data-[state=open]:bg-accent"}`}>
                      <span className={batchStatusFilter.length > 0 ? "font-semibold" : ""}>Batch Status</span>
                      {batchStatusFilter.length > 0 && <Badge variant="default" className="ml-2 h-5 px-1.5 text-[10px] rounded-sm">{batchStatusFilter.length}</Badge>}
                      <Filter className={`ml-2 h-3.5 w-3.5 ${batchStatusFilter.length > 0 ? "text-primary" : "text-muted-foreground"}`} />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start">
                    {["PENDING", "IN_TRANSIT", "COMPLETED"].map((type) => (
                      <DropdownMenuCheckboxItem 
                        key={type} 
                        checked={batchStatusFilter.includes(type)} 
                        onCheckedChange={(checked) => setBatchStatusFilter(prev => checked ? [...prev, type] : prev.filter(t => t !== type))}
                      >
                        {type}
                      </DropdownMenuCheckboxItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              </TableHead>
              <TableHead>Batch Pickup</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredBatchSummary.length === 0 ? (
               <TableRow>
                 <TableCell colSpan={9} className="text-center py-10 text-muted-foreground">
                   No batches match your criteria.
                 </TableCell>
               </TableRow>
            ) : (
              filteredBatchSummary.map((batch, i) => {
                const dayLabel = getDayLabel(batch.deliveryDate);
                const batchKey = `${batch.id}-${batch.deliveryDate}`;
                const isBatchPending = pendingBatchKey === batchKey && isPending;
                return (
                <TableRow key={`${batch.id}-${batch.deliveryDate}` || i} className="hover:bg-muted/30">
                  <TableCell>
                    <Badge
                      variant="outline"
                      className={`text-xs font-medium ${
                        dayLabel === "Today"
                          ? "border-primary/30 bg-primary/5 text-primary"
                          : "border-blue-500/30 bg-blue-500/5 text-blue-600"
                      }`}
                    >
                      {dayLabel}
                    </Badge>
                  </TableCell>
                  <TableCell className="font-mono font-medium">
                    {batch.id === "UNBATCHED" ? "Unbatched" : batch.id.substring(0, 8).toUpperCase()}
                  </TableCell>
                  <TableCell>
                    <span className="font-bold">{batch.mealCount}</span>
                    <p className="mt-0.5 text-xs font-medium text-muted-foreground">
                      {formatDeliveryCountBreakdown({
                        assigned: batch.mealCount,
                        delivered: batch.deliveredCount,
                        failed: batch.failedCount,
                      })}
                    </p>
                  </TableCell>
                  <TableCell className={`font-medium ${batch.addonCount > 0 ? "text-destructive" : "text-muted-foreground"}`}>
                    {batch.addonCount}
                  </TableCell>
                  <TableCell className="font-bold text-foreground">
                    {Number(batch.distance).toFixed(2)}
                  </TableCell>
                  <TableCell className="font-bold text-foreground">
                    ₹{Number(batch.payout).toFixed(2)}
                  </TableCell>
                  <TableCell>{batch.riderName}</TableCell>
                  <TableCell>
                    <StatusBadge status={batch.displayStatus} variant="outline" />
                  </TableCell>
                  <TableCell>
                    {batch.id === "UNBATCHED" ? (
                      <span className="text-xs text-muted-foreground">N/A</span>
                    ) : batch.canMarkPickup ? (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={isBatchPending}
                        className="h-8 text-xs"
                        onClick={() =>
                          setBatchPickupConfirm({
                            batchId: batch.id,
                            deliveryDate: batch.deliveryDate,
                            batchLabel: batch.id.substring(0, 8).toUpperCase(),
                            riderName: batch.riderName,
                            mealCount: batch.mealCount,
                          })
                        }
                      >
                        {isBatchPending ? (
                          <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                        ) : null}
                        Mark Batch Pickup
                      </Button>
                    ) : batch.isPickedUp ? (
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled
                        className="h-8 text-xs"
                      >
                        Picked
                      </Button>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </TableCell>
                </TableRow>
              );
              })
            )}
          </TableBody>
        </Table>
      </DataTableCard>

      <ConfirmActionModal
        isOpen={!!statusConfirmOrder}
        onClose={() => {
          if (!isPending) setStatusConfirmOrder(null);
        }}
        onConfirm={handleStatusUpdateConfirm}
        title={statusConfirmOrder?.actionLabel ?? "Update Order Status"}
        description={
          statusConfirmOrder ? (
            <div className="space-y-2">
              <p>
                Update order for{" "}
                <span className="font-semibold text-foreground">
                  {statusConfirmOrder.customerName}
                </span>
                ?
              </p>
              <p>
                Status will change from{" "}
                <span className="font-semibold text-foreground">
                  {formatStatusLabel(statusConfirmOrder.currentStatus)}
                </span>{" "}
                to{" "}
                <span className="font-semibold text-foreground">
                  {formatStatusLabel(statusConfirmOrder.nextStatus)}
                </span>
                .
              </p>
            </div>
          ) : null
        }
        confirmLabel={statusConfirmOrder?.actionLabel ?? "Confirm"}
        isPending={isPending && !!pendingOrderId}
      />

      <ConfirmActionModal
        isOpen={!!batchPickupConfirm}
        onClose={() => {
          if (!isPending) setBatchPickupConfirm(null);
        }}
        onConfirm={handleBatchPickupConfirm}
        title="Mark Batch Pickup"
        description={
          batchPickupConfirm ? (
            <div className="space-y-2">
              <p>
                Mark batch{" "}
                <span className="font-semibold text-foreground">
                  {batchPickupConfirm.batchLabel}
                </span>{" "}
                as picked up?
              </p>
              <p>
                All{" "}
                <span className="font-semibold text-foreground">
                  {batchPickupConfirm.mealCount}
                </span>{" "}
                assigned order(s) for rider{" "}
                <span className="font-semibold text-foreground">
                  {batchPickupConfirm.riderName}
                </span>{" "}
                will move to{" "}
                <span className="font-semibold text-foreground">
                  out for delivery
                </span>
                . This action cannot be undone.
              </p>
            </div>
          ) : null
        }
        confirmLabel="Mark Batch Pickup"
        isPending={isPending && !!pendingBatchKey}
      />
    </div>
  );
}
