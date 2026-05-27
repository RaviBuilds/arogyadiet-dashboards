"use client";

import { useState, useMemo, useTransition } from "react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/shared/components/ui/table";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuTrigger } from "@/shared/components/ui/dropdown-menu";
import { Package, Layers, Filter } from "lucide-react";
import { revalidateOperationsPage } from "@/actions/admin-actions/operationsActions";
import { toast } from "sonner";
import * as XLSX from "xlsx";

// Import our new Core Design System Components
import { DataTableCard } from "../core/DataTableCard";
import { SectionHeader } from "../core/SectionHeader";
import { DataSearchFilter } from "../core/DataSearchFilter";
import { StatusBadge } from "../core/StatusBadge";
import { ExportButton, RefreshButton } from "../core/ActionButtons";

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

export default function TodaysDeliveries({ data = [] }: { data?: any[] }) {
  const [isLoading, setIsLoading] = useState(false);
  const [isPending, startTransition] = useTransition();
  
  // Dispatch Board State
  const [searchColumn, setSearchColumn] = useState("customer_name");
  const [searchTerm, setSearchTerm] = useState("");

  // Active Batches State
  const [batchSearchColumn, setBatchSearchColumn] = useState("batch_id");
  const [batchSearchTerm, setBatchSearchTerm] = useState("");
  const [batchStatusFilter, setBatchStatusFilter] = useState<string[]>([]);

  // --- DISPATCH BOARD LOGIC ---
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
    return result;
  }, [data, searchTerm, searchColumn]);

  // --- ACTIVE BATCHES LOGIC ---
  const batchSummary = useMemo(() => {
    const batches = new Map();
    const todayStr = getISTDateString();
    data.filter(order => order.delivery_date === todayStr).forEach(order => {
      const batchId = order.delivery_batches?.id || "UNBATCHED";
      if (!batches.has(batchId)) {
        batches.set(batchId, {
          id: batchId,
          status: order.delivery_batches?.status || "PENDING",
          distance: order.delivery_batches?.total_distance_km || 0,
          payout: order.delivery_batches?.expected_payout || 0,
          riderName: order.rider_profiles?.users?.full_name || "Unassigned",
          mealCount: 0,
          addonCount: 0
        });
      }
      const b = batches.get(batchId);
      b.mealCount += 1;
      order.addon_orders?.forEach((ao: any) => {
        ao.addon_order_items?.forEach((item: any) => {
          b.addonCount += (item.quantity || 1);
        });
      });
    });
    return Array.from(batches.values());
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
      result = result.filter(b => batchStatusFilter.includes(b.status.toUpperCase()));
    }
    
    return result;
  }, [batchSummary, batchSearchTerm, batchSearchColumn, batchStatusFilter]);

  // --- ACTIONS ---
  const handleRefreshISR = async () => {
    setIsLoading(true);
    await revalidateOperationsPage();
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
    const exportData = filteredBatchSummary.map(b => ({
      "Batch Number": b.id === "UNBATCHED" ? "Unbatched" : b.id.substring(0, 8).toUpperCase(),
      "Meals Count": b.mealCount,
      "Shop Products Count": b.addonCount,
      "Distance (km)": Number(b.distance).toFixed(2),
      "Payout (INR)": Number(b.payout).toFixed(2),
      "Assigned Rider": b.riderName,
      "Status": b.status
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
              <TableHead>Day</TableHead>
              <TableHead>Customer</TableHead>
              <TableHead>Meal Type</TableHead>
              <TableHead>Assigned Rider</TableHead>
              <TableHead>Seq.</TableHead>
              <TableHead>Batch</TableHead>
              <TableHead>Status & Time</TableHead>
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
                    {["PENDING", "COMPLETED"].map((type) => (
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
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredBatchSummary.length === 0 ? (
               <TableRow>
                 <TableCell colSpan={7} className="text-center py-10 text-muted-foreground">
                   No batches match your criteria.
                 </TableCell>
               </TableRow>
            ) : (
              filteredBatchSummary.map((batch, i) => (
                <TableRow key={batch.id || i} className="hover:bg-muted/30">
                  <TableCell className="font-mono font-medium">
                    {batch.id === "UNBATCHED" ? "Unbatched" : batch.id.substring(0, 8).toUpperCase()}
                  </TableCell>
                  <TableCell className="font-bold">{batch.mealCount}</TableCell>
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
                    <StatusBadge status={batch.status} variant="outline" />
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </DataTableCard>
    </div>
  );
}
