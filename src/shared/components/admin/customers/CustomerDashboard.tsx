"use client";

import { useState, useMemo, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/shared/components/ui/table";
import { Popover, PopoverContent, PopoverTrigger } from "@/shared/components/ui/popover";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { Badge } from "@/shared/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/shared/components/ui/dropdown-menu";
import { Eye, MoreHorizontal, CalendarDays, ShoppingBag } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/shared/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";
import {
  Users,
  Edit,
  Trash2,
  AlertTriangle,
  Loader2,
  Filter,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import * as XLSX from "xlsx";

import { DataTableCard } from "../core/DataTableCard";
import { SectionHeader } from "../core/SectionHeader";
import { DataSearchFilter } from "../core/DataSearchFilter";
import { StatusBadge } from "../core/StatusBadge";
import { ExportButton, RefreshButton } from "../core/ActionButtons";
import { AdminSubmenu } from "../core/AdminSubmenu";
import {
  revalidateCustomersPage,
  updateCustomerBasicInfo,
  deactivateCustomerAccount,
  adminUpdateAddonOrderDeliveryDate,
} from "@/actions/admin-actions/customerActions";
import { AdminCreateCustomerModal } from "./AdminCreateCustomerModal";
import { CustomerOverview } from "./CustomerOverview";
import { Plus, Upload } from "lucide-react";

export interface CustomerData {
  id: string;
  userId?: string;
  fullName: string;
  email: string;
  mobile: string;
  dietary_preference: string;
  primary_pincode: string;
  status: string;
  gender: string;
  dateOfBirth: string;
  age: number | null;
  allergies: string | null;
  hasMedicalHistory: boolean;
  activePlanName: string | null;
  isActive: boolean;
}

export interface ActiveSubscriptionData {
  id: string;
  customer_name: string;
  email: string;
  plan_name: string;
  total_days: number;
  starts_on: string;
  ends_on: string;
  pause_credits_total: number;
  pause_credits_used: number;
  status: string;
}

export interface ShopOrderAdminData {
  id: string;
  created_at: string;
  customer_profile_id: string;
  customer_name: string;
  total_amount: number | null;
  status: string | null;
  target_delivery_date: string | null;
  delivery_order_id: string | null;
  scheduled_delivery_date: string | null;
  items: Array<{ product_name: string; quantity: number; unit_price: number }>;
}

export default function CustomerDashboard({
  customers = [],
  activeSubscriptions = [],
  pendingSubscriptions = [],
  stoppedSubscriptions = [],
  shopOrders = [],
}: {
  customers?: CustomerData[];
  activeSubscriptions?: ActiveSubscriptionData[];
  pendingSubscriptions?: ActiveSubscriptionData[];
  stoppedSubscriptions?: ActiveSubscriptionData[];
  shopOrders?: ShopOrderAdminData[];
}) {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState("Customer Directory");
  const [isLoading, setIsLoading] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [searchColumn, setSearchColumn] = useState("fullName");
  const [searchTerm, setSearchTerm] = useState("");

  // Filter States
  const [filterDiet, setFilterDiet] = useState<string>("ALL");
  const [filterStatus, setFilterStatus] = useState<string>("ALL");
  const [filterMedical, setFilterMedical] = useState<string>("ALL");
  const [showArchived, setShowArchived] = useState(false);

  // Dynamically extract unique active plans for the filter dropdown
  const uniquePlans = useMemo(() => {
    const plans = new Set(customers.map(c => c.activePlanName).filter(Boolean));
    return Array.from(plans);
  }, [customers]);

  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);

  const [activeCustomer, setActiveCustomer] = useState<CustomerData | null>(
    null,
  );
  const [editForm, setEditForm] = useState({
    fullName: "",
    mobile: "",
    gender: "",
    dateOfBirth: "",
    dietaryPreference: "",
  });
  const [deleteConfirmCode, setDeleteConfirmCode] = useState("");

  // Shop order edit state
  const [isShopEditOpen, setIsShopEditOpen] = useState(false);
  const [activeShopOrder, setActiveShopOrder] = useState<ShopOrderAdminData | null>(null);
  const [shopEditDate, setShopEditDate] = useState("");
  const [isShopEditPending, startShopEditTransition] = useTransition();

  const handleTabChange = (tab: string) => {
    setActiveTab(tab);
    if (tab === "Customer Directory") {
      setSearchColumn("fullName");
    } else {
      setSearchColumn("customer_name");
    }
    setSearchTerm("");
  };

  const filteredCustomers = useMemo(() => {
    let result = customers;

    if (!showArchived) {
      result = result.filter((customer) => customer.isActive);
    }

    if (searchTerm) {
      const lowerTerm = searchTerm.toLowerCase();
      result = result.filter((row) => {
        if (searchColumn === "fullName")
          return row.fullName.toLowerCase().includes(lowerTerm);
        if (searchColumn === "mobile")
          return row.mobile.toLowerCase().includes(lowerTerm);
        if (searchColumn === "email")
          return row.email.toLowerCase().includes(lowerTerm);
        if (searchColumn === "primary_pincode")
          return row.primary_pincode.toLowerCase().includes(lowerTerm);
        return true;
      });
    }

    if (filterDiet !== "ALL") {
      result = result.filter(
        (customer) => customer.dietary_preference === filterDiet,
      );
    }

    if (filterStatus !== "ALL") {
      result = result.filter((customer) => customer.status === filterStatus);
    }

    if (filterMedical === "Yes") {
      result = result.filter((customer) => customer.hasMedicalHistory);
    } else if (filterMedical === "No") {
      result = result.filter((customer) => !customer.hasMedicalHistory);
    }

    return result;
  }, [customers, searchTerm, searchColumn, filterDiet, filterStatus, filterMedical, showArchived]);

  const filterSubList = (list: ActiveSubscriptionData[]) => {
    if (!searchTerm) return list;
    const lowerTerm = searchTerm.toLowerCase();
    return list.filter((sub) => {
      if (searchColumn === "customer_name")
        return sub.customer_name.toLowerCase().includes(lowerTerm);
      if (searchColumn === "email")
        return sub.email.toLowerCase().includes(lowerTerm);
      if (searchColumn === "plan_name")
        return sub.plan_name.toLowerCase().includes(lowerTerm);
      return true;
    });
  };

  const filteredActiveSubscriptions = useMemo(
    () => filterSubList(activeSubscriptions),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activeSubscriptions, searchTerm, searchColumn],
  );

  const filteredPendingSubscriptions = useMemo(
    () => filterSubList(pendingSubscriptions),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pendingSubscriptions, searchTerm, searchColumn],
  );

  const filteredStoppedSubscriptions = useMemo(
    () => filterSubList(stoppedSubscriptions),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [stoppedSubscriptions, searchTerm, searchColumn],
  );

  const filteredShopOrders = useMemo(() => {
    if (!searchTerm) return shopOrders;
    const lowerTerm = searchTerm.toLowerCase();
    return shopOrders.filter((o) =>
      o.customer_name.toLowerCase().includes(lowerTerm),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shopOrders, searchTerm]);

  const searchOptions = useMemo(() => {
    if (activeTab === "Customer Directory") {
      return [
        { value: "fullName", label: "Name" },
        { value: "mobile", label: "Phone Number" },
        { value: "email", label: "Email ID" },
        { value: "primary_pincode", label: "Pincode" },
      ];
    } else if (
      activeTab === "Active Subscriptions" ||
      activeTab === "Pending Subscriptions" ||
      activeTab === "Expired / Stopped"
    ) {
      return [
        { value: "customer_name", label: "Customer Name" },
        { value: "email", label: "Email ID" },
        { value: "plan_name", label: "Plan Name" },
      ];
    } else if (activeTab === "Shop Orders") {
      return [{ value: "customer_name", label: "Customer Name" }];
    }
    return [];
  }, [activeTab]);

  const handleRefreshISR = async () => {
    setIsLoading(true);
    await revalidateCustomersPage();
    setIsLoading(false);
    toast.success("Data refreshed successfully");
  };

  const handleExportExcel = () => {
    if (activeTab === "Customer Directory") {
      if (filteredCustomers.length === 0) return;
      const exportData = filteredCustomers.map((row) => ({
        "Full Name": row.fullName,
        Email: row.email,
        Mobile: row.mobile,
        Gender: row.gender,
        "Date of Birth": row.dateOfBirth,
        "Dietary Preference": row.dietary_preference,
        "Primary Pincode": row.primary_pincode,
        Status: row.status,
      }));
      const ws = XLSX.utils.json_to_sheet(exportData);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Customers");
      XLSX.writeFile(
        wb,
        `Customers_${new Date().toISOString().split("T")[0]}.xlsx`,
      );
    } else if (activeTab === "Active Subscriptions") {
      if (filteredActiveSubscriptions.length === 0) return;
      const exportData = filteredActiveSubscriptions.map((row) => ({
        "Customer Name": row.customer_name,
        Email: row.email,
        "Plan Name": row.plan_name,
        "Total Days": row.total_days,
        "Starts On": row.starts_on,
        "Ends On": row.ends_on,
        "Pause Credits Total": row.pause_credits_total,
        "Pause Credits Used": row.pause_credits_used,
      }));
      const ws = XLSX.utils.json_to_sheet(exportData);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Active Subscriptions");
      XLSX.writeFile(
        wb,
        `ActiveSubscriptions_${new Date().toISOString().split("T")[0]}.xlsx`,
      );
    } else if (activeTab === "Pending Subscriptions") {
      if (filteredPendingSubscriptions.length === 0) return;
      const exportData = filteredPendingSubscriptions.map((row) => ({
        "Customer Name": row.customer_name,
        Email: row.email,
        "Plan Name": row.plan_name,
        "Total Days": row.total_days,
        "Scheduled Start": row.starts_on,
        "Pause Credits Total": row.pause_credits_total,
        "Pause Credits Used": row.pause_credits_used,
      }));
      const ws = XLSX.utils.json_to_sheet(exportData);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Pending Subscriptions");
      XLSX.writeFile(
        wb,
        `PendingSubscriptions_${new Date().toISOString().split("T")[0]}.xlsx`,
      );
    } else if (activeTab === "Expired / Stopped") {
      if (filteredStoppedSubscriptions.length === 0) return;
      const exportData = filteredStoppedSubscriptions.map((row) => ({
        "Customer Name": row.customer_name,
        Email: row.email,
        "Plan Name": row.plan_name,
        "Total Days": row.total_days,
        "Start Date": row.starts_on,
        "End Date": row.ends_on,
        Status: row.status,
      }));
      const ws = XLSX.utils.json_to_sheet(exportData);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Expired-Stopped");
      XLSX.writeFile(
        wb,
        `ExpiredStopped_${new Date().toISOString().split("T")[0]}.xlsx`,
      );
    } else if (activeTab === "Shop Orders") {
      if (filteredShopOrders.length === 0) return;
      const exportData = filteredShopOrders.map((row) => ({
        "Order #": `#${String(row.id).slice(-6).toUpperCase()}`,
        Customer: row.customer_name,
        Items: row.items.map((i) => `${i.product_name} x${i.quantity}`).join(", "),
        "Amount (₹)": row.total_amount != null ? Number(row.total_amount).toFixed(2) : "",
        "Purchased On": row.created_at
          ? new Date(row.created_at).toLocaleDateString("en-IN")
          : "",
        "Target Delivery": row.scheduled_delivery_date ?? row.target_delivery_date ?? "",
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
    }
  };

  const openEditModal = (customer: CustomerData) => {
    setActiveCustomer(customer);
    setEditForm({
      fullName: customer.fullName,
      mobile: customer.mobile,
      gender: customer.gender !== "N/A" ? customer.gender : "",
      dateOfBirth: customer.dateOfBirth,
      dietaryPreference:
        customer.dietary_preference !== "N/A"
          ? customer.dietary_preference
          : "",
    });
    setIsEditModalOpen(true);
  };

  const openDeleteModal = (customer: CustomerData) => {
    setActiveCustomer(customer);
    setDeleteConfirmCode("");
    setIsDeleteModalOpen(true);
  };

  const handleEditSubmit = () => {
    
    if (!activeCustomer || !activeCustomer.id) return;
    
    startTransition(async () => {
      const res = await updateCustomerBasicInfo(
        activeCustomer.id,
        activeCustomer.userId!,
        editForm,
      );
     
      if (res.success) {
        toast.success("Customer details updated");
        setIsEditModalOpen(false);
      } else {
        toast.error(res.error);
      }
    });
  };

  const handleDeactivateSubmit = () => {
    if (!activeCustomer || deleteConfirmCode !== activeCustomer.email) return;
    if (!activeCustomer.userId) return;

    startTransition(async () => {
      const res = await deactivateCustomerAccount(
        activeCustomer.id,
        activeCustomer.userId!,
      );
      if (res.success) {
        toast.success("Customer account deactivated");
        setIsDeleteModalOpen(false);
        setDeleteConfirmCode("");
        router.refresh();
      } else toast.error(res.error);
    });
  };

  const openShopEditModal = (order: ShopOrderAdminData) => {
    setActiveShopOrder(order);
    setShopEditDate(order.target_delivery_date ?? "");
    setIsShopEditOpen(true);
  };

  const handleShopEditSubmit = () => {
    if (!activeShopOrder || !shopEditDate) return;
    startShopEditTransition(async () => {
      const res = await adminUpdateAddonOrderDeliveryDate(activeShopOrder.id, shopEditDate);
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
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex items-start justify-between gap-4">
        <AdminSubmenu
          tabs={["Overview", "Customer Directory", "Active Subscriptions", "Pending Subscriptions", "Expired / Stopped", "Shop Orders"]}
          activeTab={activeTab}
          onTabChange={handleTabChange}
        />
        <div className="flex shrink-0 flex-col items-stretch gap-2">
          <Button variant="outline" size="sm" asChild>
            <Link href="/customers/bulk-import">
              <Upload className="h-4 w-4 mr-1.5" />
              Bulk import
            </Link>
          </Button>
          <Button onClick={() => setIsCreateModalOpen(true)} size="sm">
            <Plus className="h-4 w-4 mr-1.5" />
            Create Customer
          </Button>
        </div>
      </div>

      <AdminCreateCustomerModal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
      />

      {activeTab === "Overview" ? (
        <CustomerOverview
          customers={customers}
          activeSubscriptions={activeSubscriptions}
          pendingSubscriptions={pendingSubscriptions}
          stoppedSubscriptions={stoppedSubscriptions}
          onNavigate={handleTabChange}
        />
      ) : activeTab === "Customer Directory" ? (
        <DataTableCard
          header={<SectionHeader title="Customer Directory" icon={Users} />}
          controls={
            <div className="flex flex-wrap items-center gap-3">
              <DataSearchFilter
                searchColumn={searchColumn}
                onColumnChange={setSearchColumn}
                searchTerm={searchTerm}
                onTermChange={setSearchTerm}
                options={searchOptions}
              />
              <Button
                type="button"
                variant={showArchived ? "default" : "outline"}
                size="sm"
                onClick={() => setShowArchived((prev) => !prev)}
              >
                {showArchived ? "Showing Archived" : "Show Archived"}
              </Button>
            </div>
          }
          actions={
            <>
              <ExportButton
                onClick={handleExportExcel}
                disabled={filteredCustomers.length === 0}
              />
              <RefreshButton
                onClick={handleRefreshISR}
                isLoading={isLoading || isPending}
              />
            </>
          }
        >
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/10">
                <TableHead>Customer Info</TableHead>
                <TableHead>Contact</TableHead>

                {/* Filterable: Diet & Location */}
                <TableHead>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="-ml-3 h-8 data-[state=open]:bg-accent font-semibold text-muted-foreground hover:text-foreground"
                      >
                        <span>Diet & Allergy</span>
                        <Filter
                          className={cn(
                            "ml-2 h-3.5 w-3.5",
                            filterDiet !== "ALL"
                              ? "text-primary fill-primary/20"
                              : "text-muted-foreground/70",
                          )}
                        />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" className="w-[180px]">
                      <DropdownMenuLabel>Filter by Diet</DropdownMenuLabel>
                      <DropdownMenuItem
                        onClick={() => setFilterDiet("ALL")}
                        className={
                          filterDiet === "ALL" ? "bg-accent font-semibold" : ""
                        }
                      >
                        All Diets & Allergies
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => setFilterDiet("VEG")}
                        className={
                          filterDiet === "VEG" ? "bg-accent font-semibold" : ""
                        }
                      >
                        Vegetarian
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => setFilterDiet("NON_VEG")}
                        className={
                          filterDiet === "NON_VEG"
                            ? "bg-accent font-semibold"
                            : ""
                        }
                      >
                        Non-Vegetarian
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuLabel>Filter by Allergy</DropdownMenuLabel>
                      <DropdownMenuItem
                        onClick={() => setFilterDiet("ALLERGY")}
                        className={
                          filterDiet === "ALLERGY"
                            ? "bg-accent font-semibold"
                            : ""
                        }
                      >
                        Has Allergies
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableHead>

                {/* Filterable: Status */}
                <TableHead>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="-ml-3 h-8 data-[state=open]:bg-accent font-semibold text-muted-foreground hover:text-foreground"
                      >
                        <span>Status</span>
                        <Filter
                          className={cn(
                            "ml-2 h-3.5 w-3.5",
                            filterStatus !== "ALL"
                              ? "text-primary fill-primary/20"
                              : "text-muted-foreground/70",
                          )}
                        />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" className="w-[180px]">
                      <DropdownMenuLabel>Filter by Status</DropdownMenuLabel>
                      <DropdownMenuItem
                        onClick={() => setFilterStatus("ALL")}
                        className={
                          filterStatus === "ALL"
                            ? "bg-accent font-semibold"
                            : ""
                        }
                      >
                        All Statuses
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => setFilterStatus("Active")}
                        className={filterStatus === "Active" ? "bg-accent font-semibold" : ""}
                      >
                        Active
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => setFilterStatus("Pending")}
                        className={filterStatus === "Pending" ? "bg-accent font-semibold" : ""}
                      >
                        Pending
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => setFilterStatus("Stopped")}
                        className={filterStatus === "Stopped" ? "bg-accent font-semibold" : ""}
                      >
                        Stopped
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => setFilterStatus("Expired")}
                        className={filterStatus === "Expired" ? "bg-accent font-semibold" : ""}
                      >
                        Expired
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => setFilterStatus("No Plan")}
                        className={filterStatus === "No Plan" ? "bg-accent font-semibold" : ""}
                      >
                        No Plan
                      </DropdownMenuItem>
                      {uniquePlans && uniquePlans.length > 0 && (
                        <>
                          <DropdownMenuSeparator />
                          <DropdownMenuLabel>Filter by Plan</DropdownMenuLabel>
                          {uniquePlans.map((plan: any) => (
                            <DropdownMenuItem
                              key={plan}
                              onClick={() => setFilterStatus(plan)}
                              className={
                                filterStatus === plan
                                  ? "bg-accent font-semibold"
                                  : ""
                              }
                            >
                              {plan}
                            </DropdownMenuItem>
                          ))}
                        </>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableHead>

                {/* Filterable: Medical History */}
                <TableHead>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="-ml-3 h-8 data-[state=open]:bg-accent font-semibold text-muted-foreground hover:text-foreground"
                      >
                        <span>Medical History</span>
                        <Filter
                          className={cn(
                            "ml-2 h-3.5 w-3.5",
                            filterMedical !== "ALL"
                              ? "text-primary fill-primary/20"
                              : "text-muted-foreground/70",
                          )}
                        />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" className="w-[180px]">
                      <DropdownMenuLabel>Filter by History</DropdownMenuLabel>
                      <DropdownMenuItem
                        onClick={() => setFilterMedical("ALL")}
                        className={
                          filterMedical === "ALL"
                            ? "bg-accent font-semibold"
                            : ""
                        }
                      >
                        All Medical History
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => setFilterMedical("PROVIDED")}
                        className={
                          filterMedical === "PROVIDED"
                            ? "bg-accent font-semibold"
                            : ""
                        }
                      >
                        Provided
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => setFilterMedical("EMPTY")}
                        className={
                          filterMedical === "EMPTY"
                            ? "bg-accent font-semibold"
                            : ""
                        }
                      >
                        Empty
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableHead>

                <TableHead className="w-[50px]">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredCustomers.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={6}
                    className="text-center py-12 text-muted-foreground"
                  >
                    No customers match your criteria.
                  </TableCell>
                </TableRow>
              ) : (
                filteredCustomers.map((customer) => (
                  <TableRow key={customer.id} className="hover:bg-muted/30">
                    {/* Column 1: Customer Info */}
                    <TableCell>
                      <div className="font-bold">{customer.fullName}</div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {customer.gender && customer.gender !== "N/A" ? (
                          <span>
                            ( {customer.gender.charAt(0).toUpperCase()} -{" "}
                            {customer.age ? `${customer.age} yrs` : "N/A"} )
                          </span>
                        ) : (
                          <span>( N/A )</span>
                        )}
                      </div>
                    </TableCell>

                    {/* Column 2: Contact */}
                    <TableCell>
                      <div className="font-medium">{customer.mobile}</div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {customer.email}
                      </div>
                    </TableCell>

                    {/* Column 3: Diet & Location */}
                    <TableCell>
                      <div className="flex flex-col items-start gap-2">
                        <Badge variant="outline" className="bg-primary/5">
                          {customer.dietary_preference}
                        </Badge>
                        {customer.allergies &&
                          customer.allergies.toLowerCase() !== "none" &&
                          customer.allergies.trim() !== "" && (
                            <Popover>
                              <PopoverTrigger asChild>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="h-6 text-[10px] px-2 bg-red-50 text-red-600 border-red-200 hover:bg-red-100"
                                >
                                  View Allergy
                                </Button>
                              </PopoverTrigger>
                              <PopoverContent className="w-64 p-3 text-sm">
                                <p className="font-semibold mb-1 text-red-600">
                                  Allergies/Instructions:
                                </p>
                                <p className="text-muted-foreground">
                                  {customer.allergies}
                                </p>
                              </PopoverContent>
                            </Popover>
                          )}
                      </div>
                    </TableCell>

                    {/* Column 4: Status */}
                    <TableCell>
                      <StatusBadge
                        status={customer.status}
                        variant={
                          customer.status === "Active" ? "solid" : "outline"
                        }
                      />
                      <div className="text-xs text-muted-foreground mt-1 font-medium">
                        {customer.activePlanName || "No Active Plan"}
                      </div>
                    </TableCell>

                    {/* Column 5: Medical History */}
                    <TableCell>
                      {customer.hasMedicalHistory ? (
                        <Badge className="bg-blue-50 text-blue-700 border-blue-200 shadow-none hover:bg-blue-100">
                          Provided
                        </Badge>
                      ) : (
                        <Badge
                          variant="outline"
                          className="text-muted-foreground bg-zinc-50 shadow-none"
                        >
                          Empty
                        </Badge>
                      )}
                    </TableCell>

                    {/* Column 6: Actions (Keep existing DropdownMenu code exactly as it is) */}
                    <TableCell>
                      {/* ... Existing DropdownMenu code ... */}
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" className="h-8 w-8 p-0">
                            <MoreHorizontal className="h-4 w-4 text-muted-foreground" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-[180px]">
                          <DropdownMenuItem asChild>
                            <Link
                              href={`/customers/${customer.id}`}
                              className="cursor-pointer font-medium flex items-center"
                            >
                              <Eye className="mr-2 h-4 w-4 text-primary" />
                              View 360 Dashboard
                            </Link>
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            className="cursor-pointer font-medium"
                            onClick={() => openEditModal(customer)}
                          >
                            <Edit className="mr-2 h-4 w-4 text-muted-foreground" />
                            Quick Edit
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            className="text-destructive focus:bg-destructive/10 cursor-pointer font-medium"
                            onClick={() => openDeleteModal(customer)}
                            disabled={!customer.isActive}
                          >
                            <Trash2 className="mr-2 h-4 w-4" />
                            Deactivate Customer
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
      ) : activeTab === "Active Subscriptions" ? (
        <DataTableCard
          header={<SectionHeader title="Active Subscriptions" icon={Users} />}
          controls={
            <div className="flex flex-wrap items-center gap-3">
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
                disabled={filteredActiveSubscriptions.length === 0}
              />
              <RefreshButton
                onClick={handleRefreshISR}
                isLoading={isLoading || isPending}
              />
            </>
          }
        >
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/10">
                <TableHead>Customer</TableHead>
                <TableHead>Plan</TableHead>
                <TableHead>Dates</TableHead>
                <TableHead>Pause Credits</TableHead>
                <TableHead className="w-[50px]">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredActiveSubscriptions.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={4}
                    className="text-center py-12 text-muted-foreground"
                  >
                    No active subscriptions match your criteria.
                  </TableCell>
                </TableRow>
              ) : (
                filteredActiveSubscriptions.map((sub) => (
                  <TableRow key={sub.id} className="hover:bg-muted/30">
                    <TableCell>
                      <div className="font-bold">{sub.customer_name}</div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {sub.email}
                      </div>
                    </TableCell>
                    <TableCell>
                      {sub.plan_name}
                      <div className="text-xs text-muted-foreground mt-0.5">
                        Total Days: {sub.total_days}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="text-sm">
                        Starts: {new Date(sub.starts_on).toLocaleDateString()}
                      </div>
                      <div className="text-sm">
                        Ends: {new Date(sub.ends_on).toLocaleDateString()}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="text-sm">
                        Total: {sub.pause_credits_total}
                      </div>
                      <div className="text-sm">
                        Used: {sub.pause_credits_used}
                      </div>
                    </TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" className="h-8 w-8 p-0">
                            <MoreHorizontal className="h-4 w-4 text-muted-foreground" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-[180px]">
                          <DropdownMenuItem asChild>
                            <Link
                              href={`/subscriptions/${sub.id}`}
                              className="cursor-pointer font-medium flex items-center"
                            >
                              <Eye className="mr-2 h-4 w-4 text-primary" />
                              View Subscription 360
                            </Link>
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
      ) : activeTab === "Pending Subscriptions" ? (
        <DataTableCard
          header={<SectionHeader title="Pending Subscriptions" icon={Users} />}
          controls={
            <div className="flex flex-wrap items-center gap-3">
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
                disabled={filteredPendingSubscriptions.length === 0}
              />
              <RefreshButton
                onClick={handleRefreshISR}
                isLoading={isLoading || isPending}
              />
            </>
          }
        >
          <div className="mx-4 mt-4 mb-2 flex items-start gap-2 rounded-lg border border-orange-200 bg-orange-50 px-4 py-3 text-sm text-orange-800">
            <span className="mt-0.5 shrink-0">ℹ️</span>
            <span>
              Go to the{" "}
              <strong>Subscription 360 Dashboard</strong> (via the Actions menu
              below) to manage or activate pending subscriptions. Pending
              subscriptions are automatically activated the day before their
              scheduled start date.
            </span>
          </div>
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/10">
                <TableHead>Customer</TableHead>
                <TableHead>Plan</TableHead>
                <TableHead>Scheduled Start Date</TableHead>
                <TableHead>Pause Credits</TableHead>
                <TableHead className="w-[50px]">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredPendingSubscriptions.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={5}
                    className="text-center py-12 text-muted-foreground"
                  >
                    No pending subscriptions found.
                  </TableCell>
                </TableRow>
              ) : (
                filteredPendingSubscriptions.map((sub) => (
                  <TableRow key={sub.id} className="hover:bg-muted/30">
                    <TableCell>
                      <div className="font-bold">{sub.customer_name}</div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {sub.email}
                      </div>
                    </TableCell>
                    <TableCell>
                      {sub.plan_name}
                      <div className="text-xs text-muted-foreground mt-0.5">
                        Total Days: {sub.total_days}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="text-sm font-medium">
                        {new Date(sub.starts_on).toLocaleDateString()}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="text-sm">
                        Total: {sub.pause_credits_total}
                      </div>
                      <div className="text-sm">
                        Used: {sub.pause_credits_used}
                      </div>
                    </TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" className="h-8 w-8 p-0">
                            <MoreHorizontal className="h-4 w-4 text-muted-foreground" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-[200px]">
                          <DropdownMenuItem asChild>
                            <Link
                              href={`/subscriptions/${sub.id}`}
                              className="cursor-pointer font-medium flex items-center"
                            >
                              <Eye className="mr-2 h-4 w-4 text-primary" />
                              View Subscription 360
                            </Link>
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
      ) : activeTab === "Expired / Stopped" ? (
        <DataTableCard
          header={<SectionHeader title="Expired / Stopped Subscriptions" icon={Users} />}
          controls={
            <div className="flex flex-wrap items-center gap-3">
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
                disabled={filteredStoppedSubscriptions.length === 0}
              />
              <RefreshButton
                onClick={handleRefreshISR}
                isLoading={isLoading || isPending}
              />
            </>
          }
        >
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/10">
                <TableHead>Customer</TableHead>
                <TableHead>Plan</TableHead>
                <TableHead>Start Date</TableHead>
                <TableHead>End Date</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-[50px]">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredStoppedSubscriptions.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={6}
                    className="text-center py-12 text-muted-foreground"
                  >
                    No expired or stopped subscriptions found.
                  </TableCell>
                </TableRow>
              ) : (
                filteredStoppedSubscriptions.map((sub) => (
                  <TableRow key={sub.id} className="hover:bg-muted/30">
                    <TableCell>
                      <div className="font-bold">{sub.customer_name}</div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {sub.email}
                      </div>
                    </TableCell>
                    <TableCell>
                      {sub.plan_name}
                      <div className="text-xs text-muted-foreground mt-0.5">
                        Total Days: {sub.total_days}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="text-sm">
                        {sub.starts_on
                          ? new Date(sub.starts_on).toLocaleDateString()
                          : "—"}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="text-sm">
                        {sub.ends_on
                          ? new Date(sub.ends_on).toLocaleDateString()
                          : "—"}
                      </div>
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={sub.status} variant="outline" />
                    </TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" className="h-8 w-8 p-0">
                            <MoreHorizontal className="h-4 w-4 text-muted-foreground" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-[200px]">
                          <DropdownMenuItem asChild>
                            <Link
                              href={`/subscriptions/${sub.id}`}
                              className="cursor-pointer font-medium flex items-center"
                            >
                              <Eye className="mr-2 h-4 w-4 text-primary" />
                              View Subscription 360
                            </Link>
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
      ) : activeTab === "Shop Orders" ? (
        <DataTableCard
          header={<SectionHeader title="Shop Orders" icon={ShoppingBag} />}
          controls={
            <div className="flex flex-wrap items-center gap-3">
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
                onClick={handleRefreshISR}
                isLoading={isLoading || isPending}
              />
            </>
          }
        >
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/10">
                <TableHead>Order</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Items</TableHead>
                <TableHead>Purchased</TableHead>
                <TableHead>Target Delivery</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-[50px]">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredShopOrders.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={7}
                    className="text-center py-12 text-muted-foreground"
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
                    <TableRow key={order.id} className="hover:bg-muted/30">
                      <TableCell>
                        <div className="font-bold text-sm">
                          #{String(order.id).slice(-6).toUpperCase()}
                        </div>
                        {typeof order.total_amount === "number" && (
                          <div className="text-xs text-muted-foreground mt-0.5">
                            ₹{Number(order.total_amount).toFixed(2)}
                          </div>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="font-medium">{order.customer_name}</div>
                      </TableCell>
                      <TableCell>
                        <div className="space-y-0.5">
                          {order.items.length === 0 ? (
                            <span className="text-muted-foreground text-sm">—</span>
                          ) : (
                            order.items.map((item, idx) => (
                              <div key={idx} className="flex items-center gap-1.5 text-sm">
                                <span className="font-medium">{item.product_name}</span>
                                <span className="text-muted-foreground text-xs">×{item.quantity}</span>
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
                            <Button variant="ghost" className="h-8 w-8 p-0">
                              <MoreHorizontal className="h-4 w-4 text-muted-foreground" />
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
      ) : null}

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

      {/* --- EDIT CUSTOMER MODAL --- */}
      <Dialog open={isEditModalOpen} onOpenChange={setIsEditModalOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Quick Edit Customer</DialogTitle>
            <DialogDescription asChild>
              <div className="text-sm text-muted-foreground mt-1.5">
                Update basic info for{" "}
                <span className="font-bold text-foreground">
                  {activeCustomer?.fullName}
                </span>
                .
              </div>
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <label className="text-sm font-medium">Full Name</label>
              <Input
                value={editForm.fullName}
                onChange={(e) =>
                  setEditForm((prev) => ({ ...prev, fullName: e.target.value }))
                }
              />
            </div>
            <div className="grid gap-2">
              <label className="text-sm font-medium">Mobile Number</label>
              <Input
                value={editForm.mobile}
                onChange={(e) =>
                  setEditForm((prev) => ({ ...prev, mobile: e.target.value }))
                }
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <label className="text-sm font-medium">Gender</label>
                <Select
                  value={editForm.gender}
                  onValueChange={(val) =>
                    setEditForm({ ...editForm, gender: val })
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="MALE">Male</SelectItem>
                    <SelectItem value="FEMALE">Female</SelectItem>
                    <SelectItem value="OTHER">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <label className="text-sm font-medium">Date of Birth</label>
                <Input
                  type="date"
                  value={editForm.dateOfBirth}
                  onChange={(e) =>
                    setEditForm((prev) => ({
                      ...prev,
                      dateOfBirth: e.target.value,
                    }))
                  }
                />
              </div>
            </div>
            <div className="grid gap-2">
              <label className="text-sm font-medium">Dietary Preference</label>
              <Select
                value={editForm.dietaryPreference}
                onValueChange={(val) =>
                  setEditForm({ ...editForm, dietaryPreference: val })
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select Diet" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Veg">Vegetarian</SelectItem>
                  <SelectItem value="Non-Veg">Non-Vegetarian</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsEditModalOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleEditSubmit} disabled={isPending}>
              {isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* --- DEACTIVATE CUSTOMER MODAL --- */}
      <Dialog open={isDeleteModalOpen} onOpenChange={setIsDeleteModalOpen}>
        <DialogContent className="sm:max-w-[450px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-5 w-5" /> Deactivate Customer Account
            </DialogTitle>
            <DialogDescription asChild>
              <div className="pt-2 text-muted-foreground font-medium text-sm space-y-2">
                <p>
                  This archives the customer account and blocks login. Billing
                  history, payments, and subscriptions are preserved.
                </p>
                <p>
                  The same email and mobile can be used later to create a new
                  customer account if they return.
                </p>
              </div>
            </DialogDescription>
          </DialogHeader>
          <div className="py-4 space-y-4">
            <div className="bg-destructive/10 text-destructive text-sm p-3 rounded-md border border-destructive/20 font-medium">
              To confirm deletion, please type the email address:
              <br />
              <span className="font-bold text-base tracking-widest">
                {activeCustomer?.email}
              </span>
            </div>
            <Input
              placeholder="Type email here..."
              value={deleteConfirmCode}
              onChange={(e) => setDeleteConfirmCode(e.target.value)}
              className="border-destructive/50 focus-visible:ring-destructive"
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setIsDeleteModalOpen(false)}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDeactivateSubmit}
              disabled={
                isPending || deleteConfirmCode !== activeCustomer?.email
              }
            >
              {isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="mr-2 h-4 w-4" />
              )}{" "}
              Deactivate Customer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}