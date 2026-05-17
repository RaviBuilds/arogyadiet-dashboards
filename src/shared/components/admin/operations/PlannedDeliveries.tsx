"use client";

import { useState, useMemo, useTransition } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/shared/components/ui/card";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuPortal,
  DropdownMenuSubContent,
} from "@/shared/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/shared/components/ui/dialog";
import { Badge } from "@/shared/components/ui/badge";
import {
  Filter,
  RefreshCw,
  Search,
  Download,
  CalendarClock,
  MoreHorizontal,
  UtensilsCrossed,
  Trash2,
  MapPin,
  Loader2,
} from "lucide-react";
import { revalidateOperationsPage } from "@/actions/admin-actions/operationsActions";
import {
  deletePlannedOrder,
  updateOrderMeal,
  getAddressesForOrder,
  updateOrderAddress,
} from "@/actions/admin-actions/plannedActions";
import { toast } from "sonner";
import * as XLSX from "xlsx";

const getMealLabel = (name?: string) => {
  if (!name) return "N/A";
  const upperName = name.toUpperCase();
  if (upperName.includes("CHICKEN") || upperName.includes("NON-VEGETARIAN"))
    return "CHICKEN";
  if (upperName.includes("EGG")) return "EGG";
  if (upperName.includes("MIXED")) return "MIXED";
  if (upperName.includes("VEGETARIAN") || upperName === "VEG") return "VEG";
  return upperName;
};

export default function PlannedDeliveries({ data = [] }: { data?: any[] }) {
  const [isLoading, setIsLoading] = useState(false);
  const [isPending, startTransition] = useTransition();

  // Search & Filters
  const [searchColumn, setSearchColumn] = useState("customer_name");
  const [searchTerm, setSearchTerm] = useState("");
  const [mealFilter, setMealFilter] = useState<string[]>([]);

  // Address Modal State
  const [isAddressModalOpen, setIsAddressModalOpen] = useState(false);
  const [activeOrderId, setActiveOrderId] = useState<string | null>(null);
  const [customerAddresses, setCustomerAddresses] = useState<any[]>([]);
  const [selectedAddressId, setSelectedAddressId] = useState<string | null>(
    null,
  );
  const [isFetchingAddresses, setIsFetchingAddresses] = useState(false);

  // Derive final filtered data
  const filteredData = useMemo(() => {
    let result = data;
    if (searchTerm) {
      const lowerTerm = searchTerm.toLowerCase();
      result = result.filter((row) => {
        if (searchColumn === "customer_name")
          return row.customer_profiles?.users?.full_name
            ?.toLowerCase()
            .includes(lowerTerm);
        if (searchColumn === "mobile")
          return row.customer_profiles?.users?.mobile
            ?.toLowerCase()
            .includes(lowerTerm);
        if (searchColumn === "pincode")
          return (row.addresses?.pincode || "")
            .toLowerCase()
            .includes(lowerTerm);
        return true;
      });
    }
    if (mealFilter.length > 0) {
      result = result.filter((row) =>
        mealFilter.includes(getMealLabel(row.meal_categories?.name)),
      );
    }
    return result;
  }, [data, searchTerm, searchColumn, mealFilter]);

  // --- ACTIONS ---
  const handleRefreshISR = async () => {
    setIsLoading(true);
    await revalidateOperationsPage();
    setIsLoading(false);
    toast.success("Data refreshed successfully");
  };

  const handleDelete = (orderId: string) => {
    if (!confirm("Are you sure you want to cancel this delivery for tomorrow?"))
      return;
    startTransition(async () => {
      const result = await deletePlannedOrder(orderId);
      if (result.success) {
        toast.success("Order cancelled successfully");
        await revalidateOperationsPage();
      } else toast.error(result.error || "Failed to cancel order");
    });
  };

  const handleMealSwap = (orderId: string, newMealType: string) => {
    startTransition(async () => {
      const result = await updateOrderMeal(orderId, newMealType);
      if (result.success) {
        toast.success(`Meal updated to ${newMealType}`);
        await revalidateOperationsPage();
      } else toast.error(result.error || "Failed to update meal");
    });
  };

  // --- ADDRESS LOGIC ---
  const handleOpenAddressModal = async (orderId: string) => {
    setActiveOrderId(orderId);
    setCustomerAddresses([]);
    setSelectedAddressId(null);
    setIsAddressModalOpen(true);
    setIsFetchingAddresses(true);

    const result = await getAddressesForOrder(orderId);
    if (result.success && result.addresses) {
      setCustomerAddresses(result.addresses);
      // Auto-select their primary address if it exists
      const primary = result.addresses.find((a: any) => a.is_primary);
      if (primary) setSelectedAddressId(primary.id);
    } else {
      toast.error(result.error || "Failed to fetch addresses");
    }
    setIsFetchingAddresses(false);
  };

  const handleSubmitAddressChange = () => {
    if (!activeOrderId || !selectedAddressId) return;

    startTransition(async () => {
      const result = await updateOrderAddress(activeOrderId, selectedAddressId);
      if (result.success) {
        toast.success("Delivery address updated for tomorrow!");
        setIsAddressModalOpen(false);
        await revalidateOperationsPage();
      } else {
        toast.error(result.error || "Failed to update address");
      }
    });
  };

  // --- EXPORT ---
  const handleExportExcel = () => {
    if (filteredData.length === 0) return;
    const exportData = filteredData.map((row) => ({
      "Order ID": row.id.split("-")[0].toUpperCase(),
      "Customer Name": row.customer_profiles?.users?.full_name || "Unknown",
      Mobile: row.customer_profiles?.users?.mobile || "N/A",
      "Meal Type": getMealLabel(row.meal_categories?.name),
      Address: row.addresses || "N/A",
      Pincode: row.customer_profiles?.addresses?.[0]?.pincode || "N/A",
      Status: row.status || "PENDING",
    }));
    const worksheet = XLSX.utils.json_to_sheet(exportData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Planned Deliveries");
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    XLSX.writeFile(
      workbook,
      `Planned_Deliveries_${tomorrow.toISOString().split("T")[0]}.xlsx`,
    );
  };

  return (
    <>
      <Card className="border-border shadow-sm animate-in fade-in slide-in-from-bottom-4 duration-500">
        <CardHeader className="pb-4 border-b flex flex-row items-center justify-between">
          <CardTitle className="text-lg font-semibold flex items-center gap-2">
            <CalendarClock className="h-5 w-5 text-primary" />
            Planned for Tomorrow
          </CardTitle>
          <Button
            variant="outline"
            size="sm"
            onClick={handleExportExcel}
            disabled={filteredData.length === 0}
            className="gap-2 text-primary hover:text-primary"
          >
            <Download className="h-4 w-4" /> Export to Excel
          </Button>
        </CardHeader>

        <CardContent className="p-4 md:px-6">
          <div className="flex flex-col xl:flex-row justify-between items-start xl:items-center gap-4 mb-5">
            <div className="flex items-center gap-2 w-full xl:w-auto">
              <Select value={searchColumn} onValueChange={setSearchColumn}>
                <SelectTrigger className="w-[180px] bg-background">
                  <SelectValue placeholder="Search by..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="customer_name">Customer Name</SelectItem>
                  <SelectItem value="mobile">Mobile</SelectItem>
                  <SelectItem value="pincode">Area Pin</SelectItem>
                </SelectContent>
              </Select>
              <div className="relative w-full md:w-[250px]">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder={`Search ${searchColumn.replace("_", " ")}...`}
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-9 bg-background"
                />
              </div>
            </div>

            <div className="flex items-center gap-3 w-full xl:w-auto flex-wrap justify-end">
              <Button
                variant="secondary"
                onClick={handleRefreshISR}
                disabled={isLoading || isPending}
                className="gap-2 shadow-sm font-medium"
              >
                <RefreshCw
                  className={`h-4 w-4 ${isLoading || isPending ? "animate-spin" : ""}`}
                />
                Refresh Data
              </Button>
            </div>
          </div>

          <div className="rounded-md border bg-card overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/10">
                  <TableHead>Customer</TableHead>
                  <TableHead>Mobile</TableHead>
                  <TableHead>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="sm"
                          className={`-ml-3 h-8 transition-colors ${mealFilter.length > 0 ? "bg-primary/10 text-primary hover:bg-primary/20 hover:text-primary" : "data-[state=open]:bg-accent"}`}
                        >
                          <span
                            className={
                              mealFilter.length > 0 ? "font-semibold" : ""
                            }
                          >
                            Meal Type
                          </span>
                          {mealFilter.length > 0 && (
                            <Badge
                              variant="default"
                              className="ml-2 h-5 px-1.5 text-[10px] rounded-sm"
                            >
                              {mealFilter.length}
                            </Badge>
                          )}
                          <Filter
                            className={`ml-2 h-3.5 w-3.5 ${mealFilter.length > 0 ? "text-primary" : "text-muted-foreground"}`}
                          />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start">
                        {["VEG", "MIXED", "EGG", "CHICKEN"].map((type) => (
                          <DropdownMenuCheckboxItem
                            key={type}
                            checked={mealFilter.includes(type)}
                            onCheckedChange={(checked) =>
                              setMealFilter((prev) =>
                                checked
                                  ? [...prev, type]
                                  : prev.filter((t) => t !== type),
                              )
                            }
                          >
                            {type}
                          </DropdownMenuCheckboxItem>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableHead>
                  <TableHead>Delivery Area</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-[50px]">
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredData.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={6}
                      className="text-center py-12 text-muted-foreground"
                    >
                      {data.length === 0
                        ? "Tomorrow's delivery schedules will appear here after the evening automation runs at 5:15 PM."
                        : "No planned deliveries match your current filters."}
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredData.map((order, i) => (
                    <TableRow key={order.id || i} className="hover:bg-muted/30">
                      <TableCell className="font-medium">
                        {order.customer_profiles?.users?.full_name || "Unknown"}
                      </TableCell>
                      <TableCell>
                        {order.customer_profiles?.users?.mobile || "N/A"}
                      </TableCell>
                      <TableCell className="font-semibold text-xs tracking-wide text-muted-foreground">
                        {getMealLabel(order.meal_categories?.name)}
                      </TableCell>
                      <TableCell>
                        {order.addresses?.street_1 ? (
                          <span
                            className="truncate max-w-[200px] inline-block"
                            title={order.addresses.street_1}
                          >
                            {order.addresses.street_1}
                          </span>
                        ) : (
                          "N/A"
                        )}
                        <br />
                        <span className="text-xs text-muted-foreground">
                          {order.addresses?.pincode}
                        </span>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="secondary"
                          className="bg-primary/10 text-primary hover:bg-primary/20"
                        >
                          {order.status || "ORDER_CREATED"}
                        </Badge>
                      </TableCell>

                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" className="h-8 w-8 p-0">
                              <span className="sr-only">Open menu</span>
                              <MoreHorizontal className="h-4 w-4 text-muted-foreground" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent
                            align="end"
                            className="w-[170px]"
                          >
                            {/* NEW: Change Address Button */}
                            <DropdownMenuItem
                              className="cursor-pointer font-medium"
                              onClick={() => handleOpenAddressModal(order.id)}
                            >
                              <MapPin className="mr-2 h-4 w-4 text-muted-foreground" />
                              Change Address
                            </DropdownMenuItem>

                            <DropdownMenuSub>
                              <DropdownMenuSubTrigger className="cursor-pointer font-medium">
                                <UtensilsCrossed className="mr-2 h-4 w-4 text-muted-foreground" />
                                <span>Swap Meal</span>
                              </DropdownMenuSubTrigger>
                              <DropdownMenuPortal>
                                <DropdownMenuSubContent>
                                  {[
                                    "Vegetarian",
                                    "Non-Vegetarian (Chicken)",
                                    "Mixed Diet",
                                    "Egg / Eggetarian",
                                  ].map((mealName) => (
                                    <DropdownMenuItem
                                      key={mealName}
                                      className="cursor-pointer"
                                      onClick={() =>
                                        handleMealSwap(order.id, mealName)
                                      }
                                    >
                                      {mealName}
                                    </DropdownMenuItem>
                                  ))}
                                </DropdownMenuSubContent>
                              </DropdownMenuPortal>
                            </DropdownMenuSub>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              className="text-destructive focus:bg-destructive/10 cursor-pointer font-medium"
                              onClick={() => handleDelete(order.id)}
                            >
                              <Trash2 className="mr-2 h-4 w-4" />
                              Cancel Order
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>

          <div className="flex items-center justify-between pt-5 pb-1">
            <p className="text-sm text-muted-foreground">
              Total planned deliveries:{" "}
              <span className="font-semibold text-foreground">
                {filteredData.length}
              </span>
            </p>
          </div>
        </CardContent>
      </Card>

      {/* --- CHANGE ADDRESS MODAL --- */}
      <Dialog open={isAddressModalOpen} onOpenChange={setIsAddressModalOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Change Delivery Address</DialogTitle>
            <DialogDescription>
              Select an alternate saved address for tomorrow's delivery.
            </DialogDescription>
          </DialogHeader>

          <div className="py-4 space-y-3 max-h-[300px] overflow-y-auto pr-2">
            {isFetchingAddresses ? (
              <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
                <Loader2 className="h-8 w-8 animate-spin mb-2" />
                <p className="text-sm">Fetching customer addresses...</p>
              </div>
            ) : customerAddresses.length === 0 ? (
              <div className="text-center py-8 text-sm text-muted-foreground bg-muted/20 rounded-md border border-dashed">
                This customer has no other addresses saved.
              </div>
            ) : (
              customerAddresses.map((address) => (
                <div
                  key={address.id}
                  onClick={() => setSelectedAddressId(address.id)}
                  className={`p-3 rounded-lg border cursor-pointer transition-all ${selectedAddressId === address.id ? "border-primary bg-primary/5 ring-1 ring-primary/20" : "border-border hover:border-primary/50 hover:bg-muted/30"}`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-semibold text-sm flex items-center gap-2">
                      <MapPin className="h-3.5 w-3.5 text-muted-foreground" />
                      {address.tag || "Saved Address"}
                    </span>
                    {address.is_primary && (
                      <Badge variant="secondary" className="text-[10px] h-4">
                        Primary
                      </Badge>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground pl-5 line-clamp-2">
                    {address.street_1}
                    {address.street_2 && `, ${address.street_2}`}
                  </p>
                  <p className="text-xs font-medium text-foreground pl-5 mt-1">
                    {address.city} - {address.pincode}
                  </p>
                </div>
              ))
            )}
          </div>

          <DialogFooter className="border-t pt-4">
            <Button
              variant="outline"
              onClick={() => setIsAddressModalOpen(false)}
            >
              Cancel
            </Button>
            <Button
              onClick={handleSubmitAddressChange}
              disabled={isFetchingAddresses || !selectedAddressId || isPending}
            >
              {isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : null}
              Confirm Address
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
