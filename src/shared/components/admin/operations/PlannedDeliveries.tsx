"use client";

import { useState, useMemo, useTransition, type ReactNode } from "react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/shared/components/ui/table";
import { Button } from "@/shared/components/ui/button";
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuTrigger, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubTrigger, DropdownMenuPortal, DropdownMenuSubContent } from "@/shared/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/shared/components/ui/dialog";
import { Badge } from "@/shared/components/ui/badge";
import { Card } from "@/shared/components/ui/card";
import { Filter, CalendarClock, MoreHorizontal, UtensilsCrossed, Trash2, MapPin, Loader2, ChefHat, Settings, PlayCircle, CheckCircle2, Clock, ShoppingCart, Network, CalendarIcon } from "lucide-react";
import { format, isSameDay } from "date-fns";
import { Popover, PopoverContent, PopoverTrigger } from "@/shared/components/ui/popover";
import { Calendar } from "@/shared/components/ui/calendar";
import { cn } from "@/lib/utils";
import { getISTDateString, getTomorrowISTDateString, parseISODateString } from "@/lib/dates/ist";
import {
  revalidateOperationsPage,
  type AutomationLogRow,
} from "@/actions/admin-actions/operationsActions";
import { deletePlannedOrder, updateOrderMeal, getAddressesForOrder, updateOrderAddress } from "@/actions/admin-actions/plannedActions";
import { runProductLinkingAction, triggerSystemAutomation } from "@/actions/admin-actions/systemActions";
import { toast } from "sonner";
import * as XLSX from "xlsx";

// Import our new Core Design System Components
import { DataTableCard } from "../core/DataTableCard";
import { SectionHeader } from "../core/SectionHeader";
import { DataSearchFilter } from "../core/DataSearchFilter";
import { StatusBadge } from "../core/StatusBadge";
import { ExportButton, RefreshButton } from "../core/ActionButtons";
import { ConfirmActionModal } from "../core/ConfirmActionModal";

const getMealLabel = (name?: string) => {
  if (!name) return "N/A";
  const upperName = name.toUpperCase();
  if (upperName.includes("CHICKEN") || upperName.includes("NON-VEGETARIAN")) return "CHICKEN";
  if (upperName.includes("EGG")) return "EGG";
  if (upperName.includes("MIXED")) return "MIXED";
  if (upperName.includes("VEGETARIAN") || upperName === "VEG") return "VEG";
  return upperName;
};

type AutomationScriptConfig = {
  name: string;
  icon: typeof Clock;
  desc: string;
  datePickerMode?: "tomorrow-only" | "today-or-tomorrow";
};

type AutomationStatus = {
  loading: boolean;
  lastRun?: string;
  success?: boolean;
};

const automationTypeToScriptName: Record<string, string> = {
  ORDER_GEN: "5:15 PM Order Creation",
  PRODUCT_LINK: "Product Linking",
  PRODUCT_LINKING: "Product Linking",
  ROUTING: "Routing & Batching",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeStats(stats: unknown): Record<string, unknown> {
  if (isRecord(stats)) return stats;

  if (typeof stats === "string") {
    try {
      const parsed = JSON.parse(stats);
      return isRecord(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }

  return {};
}

function formatStatLabel(key: string) {
  return key
    .replace(/_/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatStatValue(value: unknown) {
  if (value === null || value === undefined) return "N/A";
  if (Array.isArray(value)) return String(value.length);
  if (typeof value === "object") return JSON.stringify(value);
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}

function formatStatsSummary(stats: unknown) {
  const entries = Object.entries(normalizeStats(stats));
  if (entries.length === 0) return "";

  return entries
    .map(([key, value]) => `${formatStatLabel(key)}: ${formatStatValue(value)}`)
    .join(" | ");
}

function formatISTRunTime(dateStr?: string | null) {
  if (!dateStr) return "unknown time";

  return new Date(dateStr).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function formatCurrentISTTime() {
  return new Date().toLocaleTimeString("en-IN", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function buildInitialAutomationStatus(
  automationLogs: AutomationLogRow[],
): Record<string, AutomationStatus> {
  const latestByScript = new Map<string, AutomationLogRow>();

  automationLogs.forEach((log) => {
    const scriptName = automationTypeToScriptName[log.automation_type];
    if (!scriptName) return;

    const existing = latestByScript.get(scriptName);
    const existingTime = existing?.last_run_at
      ? new Date(existing.last_run_at).getTime()
      : 0;
    const currentTime = log.last_run_at
      ? new Date(log.last_run_at).getTime()
      : 0;

    if (!existing || currentTime >= existingTime) {
      latestByScript.set(scriptName, log);
    }
  });

  return Array.from(latestByScript.entries()).reduce<
    Record<string, AutomationStatus>
  >((acc, [scriptName, log]) => {
    const statsSummary = formatStatsSummary(log.latest_stats);
    const statsText = statsSummary ? `; ${statsSummary}` : "";

    acc[scriptName] = {
      loading: false,
      success: true,
      lastRun: `Last run ${formatISTRunTime(log.last_run_at)} IST for ${log.target_date} (run #${log.run_count ?? 1}${statsText})`,
    };

    return acc;
  }, {});
}

export default function PlannedDeliveries({
  data = [],
  automationLogs = [],
}: {
  data?: any[];
  automationLogs?: AutomationLogRow[];
}) {
  const [isLoading, setIsLoading] = useState(false);
  const [isPending, startTransition] = useTransition();
  
  // Search & Filters
  const [searchColumn, setSearchColumn] = useState("customer_name");
  const [searchTerm, setSearchTerm] = useState("");
  const [mealFilter, setMealFilter] = useState<string[]>([]);

  // Modals State
  const [isAddressModalOpen, setIsAddressModalOpen] = useState(false);
  const [isPrepModalOpen, setIsPrepModalOpen] = useState(false);
  
  const [activeOrderId, setActiveOrderId] = useState<string | null>(null);
  const [customerAddresses, setCustomerAddresses] = useState<any[]>([]);
  const [selectedAddressId, setSelectedAddressId] = useState<string | null>(null);
  const [isFetchingAddresses, setIsFetchingAddresses] = useState(false);

  // System Automation State
  const [systemToggle, setSystemToggle] = useState(false);
  const [automationStatus, setAutomationStatus] = useState<Record<string, AutomationStatus>>(() =>
    buildInitialAutomationStatus(automationLogs),
  );
  const tomorrowDate = useMemo(() => parseISODateString(getTomorrowISTDateString()), []);
  const todayDate = useMemo(() => parseISODateString(getISTDateString(0)), []);
  const [orderGenTargetDate, setOrderGenTargetDate] = useState<Date>(() => parseISODateString(getTomorrowISTDateString()));
  const [productLinkingTargetDate, setProductLinkingTargetDate] = useState<Date>(() => parseISODateString(getISTDateString(0)));
  const [routingTargetDate, setRoutingTargetDate] = useState<Date>(() => parseISODateString(getISTDateString(0)));
  const [isOrderGenDateOpen, setIsOrderGenDateOpen] = useState(false);
  const [isProductLinkingDateOpen, setIsProductLinkingDateOpen] = useState(false);
  const [isRoutingDateOpen, setIsRoutingDateOpen] = useState(false);
  const [isRoutingRunning, setIsRoutingRunning] = useState(false);

  const isTomorrowOnly = (date: Date) => isSameDay(date, tomorrowDate);
  const isTodayOrTomorrow = (date: Date) =>
    isSameDay(date, todayDate) || isSameDay(date, tomorrowDate);

  // Confirm modal state
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmConfig, setConfirmConfig] = useState<{
    title: string;
    description: ReactNode;
    confirmLabel: string;
    variant: "destructive" | "default";
    onConfirm: () => void;
  } | null>(null);

  const openConfirm = (config: NonNullable<typeof confirmConfig>) => {
    setConfirmConfig(config);
    setConfirmOpen(true);
  };

  const closeConfirm = () => {
    setConfirmOpen(false);
    setConfirmConfig(null);
  };

  // Derive final filtered data
  const filteredData = useMemo(() => {
    let result = data;
    if (searchTerm) {
      const lowerTerm = searchTerm.toLowerCase();
      result = result.filter(row => {
        if (searchColumn === "customer_name") return row.customer_profiles?.users?.full_name?.toLowerCase().includes(lowerTerm);
        if (searchColumn === "mobile") return row.customer_profiles?.users?.mobile?.toLowerCase().includes(lowerTerm);
        if (searchColumn === "pincode") return (row.addresses?.pincode || "").toLowerCase().includes(lowerTerm);
        return true;
      });
    }
    if (mealFilter.length > 0) {
      result = result.filter(row => mealFilter.includes(getMealLabel(row.meal_categories?.name)));
    }
    return result;
  }, [data, searchTerm, searchColumn, mealFilter]);

  // Dynamic Kitchen Prep Calculations
  const prepSummary = useMemo(() => {
    const summary = { "VEG": 0, "CHICKEN": 0, "EGG": 0, "MIXED": 0, "OTHER": 0 };
    filteredData.forEach(order => {
      const meal = getMealLabel(order.meal_categories?.name);
      if (meal in summary) summary[meal as keyof typeof summary]++;
      else summary["OTHER"]++;
    });
    return summary;
  }, [filteredData]);

  // --- ACTIONS ---
  const handleRefreshISR = async () => {
    setIsLoading(true);
    await revalidateOperationsPage(); 
    setIsLoading(false);
    toast.success("Data refreshed successfully");
  };

  const handleDelete = (orderId: string) => {
    openConfirm({
      title: "Cancel Delivery",
      description: "Are you sure you want to cancel this delivery for tomorrow?",
      confirmLabel: "Cancel Delivery",
      variant: "destructive",
      onConfirm: () => {
        closeConfirm();
        startTransition(async () => {
          const result = await deletePlannedOrder(orderId);
          if (result.success) {
            toast.success("Order cancelled successfully");
            await revalidateOperationsPage();
          } else toast.error(result.error || "Failed to cancel order");
        });
      },
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

  const executeRunAutomation = async (automationName: string, targetDate?: string) => {
    setAutomationStatus(prev => ({ ...prev, [automationName]: { ...prev[automationName], loading: true } }));
    
    const result = await triggerSystemAutomation(
      automationName,
      targetDate ? { targetDate } : undefined,
    );
    
    if (result.success) {
      const insertedMsg =
        "inserted" in result && typeof result.inserted === "number"
          ? ` (${result.inserted} orders created)`
          : "";
      const linkedMsg =
        "count" in result && typeof result.count === "number"
          ? ` (${result.count} products linked)`
          : "";
      const successDate =
        "targetDate" in result && result.targetDate ? ` for ${result.targetDate}` : "";
      toast.success(`${automationName} executed successfully${successDate}${insertedMsg}${linkedMsg}!`);
      const timeStr = formatCurrentISTTime();
      
      setAutomationStatus(prev => ({
        ...prev, 
        [automationName]: {
          loading: false,
          success: true,
          lastRun: `Activity done today at ${timeStr} IST${successDate}${insertedMsg}${linkedMsg}`,
        },
      }));
      
      await revalidateOperationsPage();
    } else {
      toast.error(result.error || `Failed to run ${automationName}`);
      setAutomationStatus(prev => ({ ...prev, [automationName]: { ...prev[automationName], loading: false, success: false } }));
    }
  };

  const executeProductLinking = async (targetDate: string) => {
    const automationName = "Product Linking";
    setAutomationStatus(prev => ({ ...prev, [automationName]: { ...prev[automationName], loading: true } }));

    const result = await runProductLinkingAction(targetDate);

    if (result.success) {
      const count = result.count ?? 0;
      toast.success(`Successfully linked ${count} products!`);
      const timeStr = formatCurrentISTTime();

      setAutomationStatus(prev => ({
        ...prev,
        [automationName]: {
          loading: false,
          success: true,
          lastRun: `Activity done today at ${timeStr} IST for ${targetDate} (${count} products linked)`,
        },
      }));

      await revalidateOperationsPage();
    } else {
      toast.error(result.error || "Failed to run Product Linking");
      setAutomationStatus(prev => ({
        ...prev,
        [automationName]: { ...prev[automationName], loading: false, success: false },
      }));
    }
  };

  const executeRoutingBatching = async (targetDate: string) => {
    const automationName = "Routing & Batching";
    setIsRoutingRunning(true);
    setAutomationStatus(prev => ({ ...prev, [automationName]: { ...prev[automationName], loading: true } }));

    try {
      const res = await fetch(
        `/api/cron/dispatch?secret=arogya-demo-123&date=${targetDate}`,
      );

      if (!res.ok) {
        let message = "Failed to run Routing & Batching";

        try {
          const payload = await res.json();
          message = payload?.error || payload?.message || message;
        } catch {
          // Keep the default message if the API does not return JSON.
        }

        throw new Error(message);
      }

      toast.success(`Routing & Batching completed for ${targetDate}!`);
      const timeStr = formatCurrentISTTime();

      setAutomationStatus(prev => ({
        ...prev,
        [automationName]: {
          loading: false,
          success: true,
          lastRun: `Activity done today at ${timeStr} IST for ${targetDate}`,
        },
      }));

      await revalidateOperationsPage();
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Failed to run Routing & Batching";

      toast.error(message);
      setAutomationStatus(prev => ({
        ...prev,
        [automationName]: { ...prev[automationName], loading: false, success: false },
      }));
    } finally {
      setIsRoutingRunning(false);
    }
  };

  const requestRunProductLinking = (targetDate: string) => {
    openConfirm({
      title: "Confirm Product Linking",
      description: (
        <p>
          Are you sure you want to attach paid add-on products to the planned delivery meals for{" "}
          <span className="font-semibold text-foreground">{targetDate}</span>?
        </p>
      ),
      confirmLabel: "Run Script",
      variant: "destructive",
      onConfirm: () => {
        closeConfirm();
        void executeProductLinking(targetDate);
      },
    });
  };

  const requestRunAutomation = (automationName: string, targetDate?: string) => {
    openConfirm({
      title: "Critical Warning",
      description: (
        <>
          <p>
            Are you sure you want to force-run the{" "}
            <span className="font-semibold text-foreground">[{automationName}]</span> script?
          </p>
          {targetDate && (
            <p>
              Target delivery date:{" "}
              <span className="font-semibold text-foreground">{targetDate}</span>
            </p>
          )}
          <p>
            Running this out of schedule can cause duplicate data if not handled carefully.
          </p>
        </>
      ),
      confirmLabel: "Run Script",
      variant: "destructive",
      onConfirm: () => {
        closeConfirm();
        void executeRunAutomation(automationName, targetDate);
      },
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
      } else toast.error(result.error || "Failed to update address");
    });
  };

  // --- EXPORT ---
  const handleExportExcel = () => {
    if (filteredData.length === 0) return;
    const exportData = filteredData.map(row => ({
      "Order ID": row.id.split('-')[0].toUpperCase(),
      "Customer Name": row.customer_profiles?.users?.full_name || "Unknown",
      "Mobile": row.customer_profiles?.users?.mobile || "N/A",
      "Meal Type": getMealLabel(row.meal_categories?.name),
      "Address": row.addresses?.street_1 || "N/A",
      "Pincode": row.addresses?.pincode || "N/A",
      "Status": row.status || "PENDING"
    }));
    const worksheet = XLSX.utils.json_to_sheet(exportData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Planned Deliveries");
    XLSX.writeFile(workbook, `Planned_Deliveries_${getTomorrowISTDateString()}.xlsx`);
  };

  const automationScripts: AutomationScriptConfig[] = [
    {
      name: "5:15 PM Order Creation",
      icon: Clock,
      desc: "Forces the generation of delivery orders based on active subscriptions.",
      datePickerMode: "today-or-tomorrow" as const,
    },
    {
      name: "Product Linking",
      icon: ShoppingCart,
      desc: "Attaches add-on shop products to planned delivery meals.",
      datePickerMode: "today-or-tomorrow" as const,
    },
    {
      name: "Routing & Batching",
      icon: Network,
      desc: "Creates rider batches, sets delivery sequences, and assigns orders for today (scheduled at 12:10 AM IST).",
      datePickerMode: "today-or-tomorrow" as const,
    }
  ];

  return (
    <>
      <DataTableCard
        header={<SectionHeader title="Planned for Tomorrow" icon={CalendarClock} />}
        controls={
          <DataSearchFilter
            searchColumn={searchColumn}
            onColumnChange={setSearchColumn}
            searchTerm={searchTerm}
            onTermChange={setSearchTerm}
            options={[
              { value: "customer_name", label: "Customer Name" },
              { value: "mobile", label: "Mobile Number" },
              { value: "pincode", label: "Area Pin" }
            ]}
          />
        }
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => setIsPrepModalOpen(true)} className="gap-2">
              <ChefHat className="h-4 w-4 text-orange-500" /> Prep Sheet
            </Button>
            <ExportButton onClick={handleExportExcel} disabled={filteredData.length === 0} />
            <RefreshButton onClick={handleRefreshISR} isLoading={isLoading || isPending} />
          </>
        }
        footer={
          <p className="text-sm text-muted-foreground">
            Total planned deliveries: <span className="font-semibold text-foreground">{filteredData.length}</span>
          </p>
        }
      >
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/10">
              <TableHead>Customer</TableHead>
              <TableHead>Mobile</TableHead>
              <TableHead>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="sm" className={`-ml-3 h-8 transition-colors ${mealFilter.length > 0 ? "bg-primary/10 text-primary hover:bg-primary/20 hover:text-primary" : "data-[state=open]:bg-accent"}`}>
                      <span className={mealFilter.length > 0 ? "font-semibold" : ""}>Meal Type</span>
                      {mealFilter.length > 0 && <Badge variant="default" className="ml-2 h-5 px-1.5 text-[10px] rounded-sm">{mealFilter.length}</Badge>}
                      <Filter className={`ml-2 h-3.5 w-3.5 ${mealFilter.length > 0 ? "text-primary" : "text-muted-foreground"}`} />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start">
                    {["VEG", "MIXED", "EGG", "CHICKEN"].map((type) => (
                      <DropdownMenuCheckboxItem key={type} checked={mealFilter.includes(type)} onCheckedChange={(checked) => setMealFilter(prev => checked ? [...prev, type] : prev.filter(t => t !== type))}>
                        {type}
                      </DropdownMenuCheckboxItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              </TableHead>
              <TableHead>Delivery Area</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-[50px]"><span className="sr-only">Actions</span></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredData.length === 0 ? (
               <TableRow>
                 <TableCell colSpan={6} className="text-center py-12 text-muted-foreground">
                   {data.length === 0 ? "Next data will be available here after the 5:15 PM automation today." : "No planned deliveries match your current filters."}
                 </TableCell>
               </TableRow>
            ) : (
              filteredData.map((order, i) => (
                <TableRow key={order.id || i} className="hover:bg-muted/30">
                  <TableCell className="font-medium">{order.customer_profiles?.users?.full_name || "Unknown"}</TableCell>
                  <TableCell>{order.customer_profiles?.users?.mobile || "N/A"}</TableCell>
                  <TableCell className="font-semibold text-xs tracking-wide text-muted-foreground">{getMealLabel(order.meal_categories?.name)}</TableCell>
                  <TableCell>
                    {order.addresses?.street_1 ? (
                      <span className="truncate max-w-[200px] inline-block" title={order.addresses.street_1}>{order.addresses.street_1}</span>
                    ) : "N/A"}
                    <br/>
                    <span className="text-xs text-muted-foreground">{order.addresses?.pincode}</span>
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={order.status || "ORDER_CREATED"} />
                  </TableCell>
                  
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" className="h-8 w-8 p-0">
                          <span className="sr-only">Open menu</span>
                          <MoreHorizontal className="h-4 w-4 text-muted-foreground" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-[170px]">
                        <DropdownMenuItem className="cursor-pointer font-medium" onClick={() => handleOpenAddressModal(order.id)}>
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
                              {["Vegetarian", "Non-Vegetarian (Chicken)", "Mixed Diet", "Egg / Eggetarian"].map((mealName) => (
                                <DropdownMenuItem key={mealName} className="cursor-pointer" onClick={() => handleMealSwap(order.id, mealName)}>
                                  {mealName}
                                </DropdownMenuItem>
                              ))}
                            </DropdownMenuSubContent>
                          </DropdownMenuPortal>
                        </DropdownMenuSub>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem className="text-destructive focus:bg-destructive/10 cursor-pointer font-medium" onClick={() => handleDelete(order.id)}>
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
      </DataTableCard>

      {/* --- SYSTEM AUTOMATION CONTROL --- */}
      <div className="mt-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
        <SectionHeader 
          title="System Automation Control" 
          icon={Settings} 
          className="mb-6"
          action={
            <div className="flex items-center gap-3">
              <button
                role="switch"
                aria-checked={systemToggle}
                onClick={() => setSystemToggle(!systemToggle)}
                className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background ${systemToggle ? 'bg-primary' : 'bg-input'}`}
              >
                <span className={`pointer-events-none block h-5 w-5 rounded-full bg-background shadow-lg ring-0 transition-transform ${systemToggle ? 'translate-x-5' : 'translate-x-0'}`} />
              </button>
              <span className={`text-sm font-medium ${systemToggle ? 'text-destructive' : 'text-muted-foreground'}`}>
                {systemToggle ? "ON: Enabled (Proceed with Caution)" : "OFF: Disabled"}
              </span>
            </div>
          }
        />

        {systemToggle && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 animate-in zoom-in-95 duration-300 origin-top-left">
            {automationScripts.map((script) => {
              const status = automationStatus[script.name] || {};
              const isSuccess = status.success;
              const isOrderGeneration = script.name === "5:15 PM Order Creation";
              const isProductLinking = script.name === "Product Linking";
              const isRoutingBatching = script.name === "Routing & Batching";
              const datePickerMode = "datePickerMode" in script ? script.datePickerMode : undefined;
              const selectedDate =
                isRoutingBatching
                  ? routingTargetDate
                  : isOrderGeneration
                    ? orderGenTargetDate
                  : datePickerMode === "today-or-tomorrow"
                  ? productLinkingTargetDate
                  : datePickerMode === "tomorrow-only"
                    ? orderGenTargetDate
                    : null;
              const formattedDate = selectedDate ? format(selectedDate, "yyyy-MM-dd") : undefined;
              const isDatePickerOpen =
                isRoutingBatching
                  ? isRoutingDateOpen
                  : isOrderGeneration
                    ? isOrderGenDateOpen
                  : datePickerMode === "today-or-tomorrow"
                  ? isProductLinkingDateOpen
                  : isOrderGenDateOpen;
              const setIsDatePickerOpen =
                isRoutingBatching
                  ? setIsRoutingDateOpen
                  : isOrderGeneration
                    ? setIsOrderGenDateOpen
                  : datePickerMode === "today-or-tomorrow"
                  ? setIsProductLinkingDateOpen
                  : setIsOrderGenDateOpen;
              const isScriptRunning = isRoutingBatching ? isRoutingRunning : status.loading;

              return (
                <Card 
                  key={script.name} 
                  className={`relative overflow-hidden transition-all duration-300 flex flex-col justify-between ${
                    isSuccess 
                      ? 'border-green-500/40 shadow-sm bg-green-50/20' 
                      : 'border-border shadow-sm hover:border-primary/30'
                  }`}
                >
                  <div className="p-5 flex flex-col gap-3 h-full">
                    <div className="flex items-center gap-2 font-semibold text-[15px] text-foreground">
                      <script.icon className={`h-4 w-4 ${isSuccess ? 'text-green-600' : 'text-primary'}`} /> 
                      {script.name}
                    </div>
                    
                    <p className="text-xs text-muted-foreground leading-relaxed pr-2 lg:w-[90%]">
                      {script.desc}
                    </p>

                    {datePickerMode && (
                      <div className="space-y-1.5">
                        <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
                          Target delivery date (IST)
                        </p>
                        <Popover open={isDatePickerOpen} onOpenChange={setIsDatePickerOpen}>
                          <PopoverTrigger asChild>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className={cn(
                                "h-9 w-full justify-start text-left font-normal",
                                !selectedDate && "text-muted-foreground",
                              )}
                            >
                              <CalendarIcon className="mr-2 h-4 w-4" />
                              {selectedDate ? format(selectedDate, "PPP") : "Select date"}
                            </Button>
                          </PopoverTrigger>
                          <PopoverContent className="w-auto p-0" align="start">
                            <Calendar
                              mode="single"
                              selected={selectedDate ?? undefined}
                              month={datePickerMode === "today-or-tomorrow" ? todayDate : tomorrowDate}
                              defaultMonth={datePickerMode === "today-or-tomorrow" ? todayDate : tomorrowDate}
                              onSelect={(date) => {
                                if (!date) return;
                                if (datePickerMode === "tomorrow-only" && !isTomorrowOnly(date)) return;
                                if (datePickerMode === "today-or-tomorrow" && !isTodayOrTomorrow(date)) return;
                                if (isRoutingBatching) {
                                  setRoutingTargetDate(date);
                                } else if (isOrderGeneration) {
                                  setOrderGenTargetDate(date);
                                } else if (datePickerMode === "today-or-tomorrow") {
                                  setProductLinkingTargetDate(date);
                                } else {
                                  setOrderGenTargetDate(date);
                                }
                                setIsDatePickerOpen(false);
                              }}
                              hidden={(date) =>
                                datePickerMode === "tomorrow-only"
                                  ? !isTomorrowOnly(date)
                                  : !isTodayOrTomorrow(date)
                              }
                              disabled={(date) =>
                                datePickerMode === "tomorrow-only"
                                  ? !isTomorrowOnly(date)
                                  : !isTodayOrTomorrow(date)
                              }
                              hideNavigation
                            />
                          </PopoverContent>
                        </Popover>
                        <p className="text-[10px] text-muted-foreground">
                          {datePickerMode === "tomorrow-only"
                            ? "Only tomorrow's date is available for order generation."
                            : "Select today or tomorrow (IST)."}
                        </p>
                      </div>
                    )}
                    
                    <div className="mt-1">
                      <Button 
                        variant={isSuccess ? "outline" : "default"}
                        size="sm" 
                        className={`w-fit font-medium shadow-sm transition-all ${
                          isSuccess 
                            ? 'border-green-600 text-green-700 hover:bg-green-50' 
                            : 'bg-primary text-primary-foreground'
                        }`}
                        onClick={() => {
                          if (isRoutingBatching && formattedDate) {
                            void executeRoutingBatching(formattedDate);
                          } else if (isProductLinking && formattedDate) {
                            requestRunProductLinking(formattedDate);
                          } else {
                            requestRunAutomation(script.name, formattedDate);
                          }
                        }} 
                        disabled={isScriptRunning || (datePickerMode !== undefined && !selectedDate)}
                      >
                        {isScriptRunning ? (
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : (
                          <PlayCircle className="mr-2 h-4 w-4" />
                        )}
                        {isScriptRunning ? "Running..." : "Run Script"}
                      </Button>
                    </div>
                  </div>

                  {/* Status Footer */}
                  <div className={`px-5 py-3 text-xs border-t transition-colors ${
                    isSuccess 
                      ? 'bg-green-100/50 border-green-200 text-green-800' 
                      : 'bg-muted/30 border-border/50 text-muted-foreground'
                  }`}>
                    {isSuccess ? (
                      <div className="flex items-start gap-2 font-medium">
                        <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0" />
                        <span>{status.lastRun}</span>
                      </div>
                    ) : (
                      <div className="flex items-start gap-2">
                        <Clock className="h-4 w-4 shrink-0 opacity-50" />
                        <span>Not run today</span>
                      </div>
                    )}
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      {/* --- PREP SUMMARY MODAL --- */}
      <Dialog open={isPrepModalOpen} onOpenChange={setIsPrepModalOpen}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ChefHat className="h-5 w-5 text-orange-500" />
              Kitchen Prep Sheet
            </DialogTitle>
            <DialogDescription>
              Total meal counts required for tomorrow based on current table filters.
            </DialogDescription>
          </DialogHeader>
          
          <div className="grid grid-cols-2 gap-4 py-4">
            <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-4 flex flex-col items-center justify-center">
              <span className="text-3xl font-bold text-green-700">{prepSummary.VEG}</span>
              <span className="text-xs font-semibold uppercase tracking-wider text-green-700 mt-1">Vegetarian</span>
            </div>
            <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4 flex flex-col items-center justify-center">
              <span className="text-3xl font-bold text-red-700">{prepSummary.CHICKEN}</span>
              <span className="text-xs font-semibold uppercase tracking-wider text-red-700 mt-1">Chicken</span>
            </div>
            <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-lg p-4 flex flex-col items-center justify-center">
              <span className="text-3xl font-bold text-yellow-700">{prepSummary.EGG}</span>
              <span className="text-xs font-semibold uppercase tracking-wider text-yellow-700 mt-1">Egg</span>
            </div>
            <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-4 flex flex-col items-center justify-center">
              <span className="text-3xl font-bold text-blue-700">{prepSummary.MIXED}</span>
              <span className="text-xs font-semibold uppercase tracking-wider text-blue-700 mt-1">Mixed Diet</span>
            </div>
          </div>

          <DialogFooter>
            <Button className="w-full" onClick={() => setIsPrepModalOpen(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
                  className={`p-3 rounded-lg border cursor-pointer transition-all ${selectedAddressId === address.id ? 'border-primary bg-primary/5 ring-1 ring-primary/20' : 'border-border hover:border-primary/50 hover:bg-muted/30'}`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-semibold text-sm flex items-center gap-2">
                      <MapPin className="h-3.5 w-3.5 text-muted-foreground" />
                      {address.tag || "Saved Address"}
                    </span>
                    {address.is_primary && <Badge variant="secondary" className="text-[10px] h-4">Primary</Badge>}
                  </div>
                  <p className="text-sm text-muted-foreground pl-5 line-clamp-2">
                    {address.street_1}
                    {address.street_2 && `, ${address.street_2}`}
                  </p>
                  <p className="text-xs font-medium text-foreground pl-5 mt-1">{address.city} - {address.pincode}</p>
                </div>
              ))
            )}
          </div>

          <DialogFooter className="border-t pt-4">
            <Button variant="outline" onClick={() => setIsAddressModalOpen(false)}>Cancel</Button>
            <Button onClick={handleSubmitAddressChange} disabled={isFetchingAddresses || !selectedAddressId || isPending}>
              {isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Confirm Address
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmActionModal
        isOpen={confirmOpen}
        onClose={closeConfirm}
        onConfirm={() => confirmConfig?.onConfirm()}
        title={confirmConfig?.title}
        description={confirmConfig?.description}
        confirmLabel={confirmConfig?.confirmLabel ?? "Confirm"}
        variant={confirmConfig?.variant ?? "default"}
        isPending={isPending}
      />
    </>
  );
}
