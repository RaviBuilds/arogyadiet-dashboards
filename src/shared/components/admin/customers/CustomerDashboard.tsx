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
import { Eye, MoreHorizontal } from "lucide-react";
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
  Truck,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import * as XLSX from "xlsx";

import { DataTableCard } from "../core/DataTableCard";
import { SectionHeader } from "../core/SectionHeader";
import { DataSearchFilter } from "../core/DataSearchFilter";
import { StatusBadge } from "../core/StatusBadge";
import { ExportButton, RefreshButton } from "../core/ActionButtons";
import { AdminSubmenuBar } from "../core/AdminSubmenuBar";
import {
  revalidateCustomersPage,
  updateCustomerBasicInfo,
  deactivateCustomerAccount,
} from "@/actions/admin-actions/customerActions";
import { AdminCreateCustomerModal } from "./AdminCreateCustomerModal";
import { CustomerOverview } from "./CustomerOverview";
import { OnboardingCustomersSection } from "./OnboardingCustomersSection";
import { KitCustomerSection } from "./KitCustomerSection";
import { Plus, Upload, UserPlus } from "lucide-react"; // Plus & Upload kept — used by AdminCreateCustomerModal trigger and possible future use
import {
  clinicDisplayName,
  filterRowsByClinic,
  ALL_CLINICS,
  type ClinicFilterSelection,
} from "@/lib/clinic/visibility";

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
  customerCategory: string | null;
  isActive: boolean;
  clinic_id: string | null;
  clinicName: string | null;
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
  autoOpenCreate = false,
}: {
  customers?: CustomerData[];
  activeSubscriptions?: ActiveSubscriptionData[];
  pendingSubscriptions?: ActiveSubscriptionData[];
  stoppedSubscriptions?: ActiveSubscriptionData[];
  autoOpenCreate?: boolean;
}) {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState("Meal Customers");
  const [isLoading, setIsLoading] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [searchColumn, setSearchColumn] = useState("fullName");
  const [searchTerm, setSearchTerm] = useState("");

  // Filter States
  const [filterDiet, setFilterDiet] = useState<string>("ALL");
  const [filterStatus, setFilterStatus] = useState<string>("ALL");
  const [filterMedical, setFilterMedical] = useState<string>("ALL");
  const [showArchived, setShowArchived] = useState(false);
  const [clinicFilter, setClinicFilter] =
    useState<ClinicFilterSelection>(ALL_CLINICS);

  // Distinct clinics present in the loaded customer rows, for the filter control.
  const clinicOptions = useMemo(() => {
    const map = new Map<string, string>();
    customers.forEach((row) => {
      if (row.clinic_id) {
        map.set(row.clinic_id, clinicDisplayName(row.clinicName));
      }
    });
    return Array.from(map, ([id, name]) => ({ id, name })).sort((a, b) =>
      a.name.localeCompare(b.name),
    );
  }, [customers]);

  // Dynamically extract unique active plans for the filter dropdown
  const uniquePlans = useMemo(() => {
    const plans = new Set(customers.map(c => c.activePlanName).filter((p): p is string => Boolean(p)));
    return Array.from(plans);
  }, [customers]);

  const [isCreateModalOpen, setIsCreateModalOpen] = useState(autoOpenCreate);
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

  const handleTabChange = (tab: string) => {
    setActiveTab(tab);
    if (tab === "Meal Customers" || tab === "KIT Customer") {
      setSearchColumn("fullName");
    } else {
      setSearchColumn("customer_name");
    }
    setSearchTerm("");
    setClinicFilter(ALL_CLINICS);
  };

  const filteredCustomers = useMemo(() => {
    // Meal Customers: exclude KIT category customers
    let result = filterRowsByClinic(
      customers.filter((c) => c.customerCategory !== "KIT"),
      clinicFilter
    );

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
  }, [customers, searchTerm, searchColumn, filterDiet, filterStatus, filterMedical, showArchived, clinicFilter]);

  // KIT Customer tab: same directory filtering pipeline, scoped to KIT category.
  const kitCustomers = useMemo(
    () => customers.filter((customer) => customer.customerCategory === "KIT"),
    [customers],
  );

  const filteredKitCustomers = useMemo(() => {
    let result = filterRowsByClinic(kitCustomers, clinicFilter);

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

    if (filterStatus !== "ALL") {
      result = result.filter((customer) => customer.status === filterStatus);
    }

    return result;
  }, [kitCustomers, searchTerm, searchColumn, filterStatus, showArchived, clinicFilter]);

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

  const searchOptions = useMemo(() => {
    if (activeTab === "Meal Customers" || activeTab === "KIT Customer") {
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
    if (activeTab === "Meal Customers") {
      if (filteredCustomers.length === 0) return;
      const exportData = filteredCustomers.map((row) => ({
        "Full Name": row.fullName,
        Email: row.email,
        Mobile: row.mobile,
        Gender: row.gender,
        "Date of Birth": row.dateOfBirth,
        "Dietary Preference": row.dietary_preference,
        "Primary Pincode": row.primary_pincode,
        Clinic: clinicDisplayName(row.clinicName),
        Status: row.status,
      }));
      const ws = XLSX.utils.json_to_sheet(exportData);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Customers");
      XLSX.writeFile(
        wb,
        `Customers_${new Date().toISOString().split("T")[0]}.xlsx`,
      );
    } else if (activeTab === "KIT Customer") {
      if (filteredKitCustomers.length === 0) return;
      const exportData = filteredKitCustomers.map((row) => ({
        "Full Name": row.fullName,
        Email: row.email,
        Mobile: row.mobile,
        Gender: row.gender,
        "Date of Birth": row.dateOfBirth,
        "Dietary Preference": row.dietary_preference,
        "Primary Pincode": row.primary_pincode,
        Clinic: clinicDisplayName(row.clinicName),
        Status: row.status,
      }));
      const ws = XLSX.utils.json_to_sheet(exportData);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "KIT Customers");
      XLSX.writeFile(
        wb,
        `KIT_Customers_${new Date().toISOString().split("T")[0]}.xlsx`,
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


  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <AdminSubmenuBar
        tabs={[
          "Overview",
          "Meal Customers",
          "KIT Customer",
          "Onboarded",
        ]}
        activeTab={activeTab}
        onTabChange={handleTabChange}
        actions={
          <Button size="sm" className="transition-all duration-200" asChild>
            <Link href="/customers/onboarding">
              <UserPlus className="h-4 w-4 mr-1.5" />
              Onboarding
            </Link>
          </Button>
        }
      />

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
      ) : activeTab === "Meal Customers" ? (
        <DataTableCard
          header={<SectionHeader title="Meal Customers" icon={Users} />}
          controls={
            <div className="flex flex-wrap items-center gap-4">
              <DataSearchFilter
                searchColumn={searchColumn}
                onColumnChange={setSearchColumn}
                searchTerm={searchTerm}
                onTermChange={setSearchTerm}
                options={searchOptions}
              />
              <Select
                value={clinicFilter ?? ALL_CLINICS}
                onValueChange={(val) => setClinicFilter(val)}
              >
                <SelectTrigger className="w-[200px] border-slate-200 bg-white transition-all duration-200">
                  <SelectValue placeholder="Filter by clinic..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_CLINICS}>All Clinics</SelectItem>
                  {clinicOptions.map((clinic) => (
                    <SelectItem key={clinic.id} value={clinic.id}>
                      {clinic.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                type="button"
                variant={showArchived ? "default" : "outline"}
                size="sm"
                className="transition-all duration-200"
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
              <TableRow className="bg-slate-50/50 border-b border-slate-200">
                <TableHead className="text-xs font-medium text-slate-500 uppercase tracking-wider">Customer Info</TableHead>
                <TableHead className="text-xs font-medium text-slate-500 uppercase tracking-wider">Contact</TableHead>

                {/* Filterable: Diet & Location */}
                <TableHead>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="-ml-3 h-8 data-[state=open]:bg-slate-100 font-medium text-xs uppercase tracking-wider text-slate-500 hover:text-slate-900 transition-all duration-200"
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
                        className="-ml-3 h-8 data-[state=open]:bg-slate-100 font-medium text-xs uppercase tracking-wider text-slate-500 hover:text-slate-900 transition-all duration-200"
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
                          {uniquePlans.map((plan: string) => (
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
                        className="-ml-3 h-8 data-[state=open]:bg-slate-100 font-medium text-xs uppercase tracking-wider text-slate-500 hover:text-slate-900 transition-all duration-200"
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

                <TableHead className="w-[50px] text-xs font-medium text-slate-500 uppercase tracking-wider">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredCustomers.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={6}
                    className="text-center py-12 text-sm text-slate-500"
                  >
                    No customers match your criteria.
                  </TableCell>
                </TableRow>
              ) : (
                filteredCustomers.map((customer) => (
                  <TableRow key={customer.id} className="hover:bg-slate-50 transition-colors duration-200">
                    {/* Column 1: Customer Info */}
                    <TableCell>
                      <div className="font-semibold text-slate-900 tracking-tight">{customer.fullName}</div>
                      <div className="text-sm text-slate-500 mt-0.5">
                        {customer.gender && customer.gender !== "N/A" ? (
                          <span>
                            ( {customer.gender.charAt(0).toUpperCase()} -{" "}
                            {customer.age ? `${customer.age} yrs` : "N/A"} )
                          </span>
                        ) : (
                          <span>( N/A )</span>
                        )}
                      </div>
                      <div
                        className={cn(
                          "text-xs mt-0.5",
                          customer.clinicName
                            ? "text-slate-500"
                            : "text-slate-400 italic",
                        )}
                      >
                        {clinicDisplayName(customer.clinicName)}
                      </div>
                    </TableCell>

                    {/* Column 2: Contact */}
                    <TableCell>
                      <div className="font-medium text-slate-900">{customer.mobile}</div>
                      <div className="text-sm text-slate-500 mt-0.5">
                        {customer.email}
                      </div>
                    </TableCell>

                    {/* Column 3: Diet & Location */}
                    <TableCell>
                      <div className="flex flex-col items-start gap-2">
                        <Badge variant="outline" className="rounded-full border-slate-200 bg-slate-50 px-2.5 text-slate-700">
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
                      <div className="text-sm text-slate-500 mt-1.5">
                        {customer.activePlanName || "No Active Plan"}
                      </div>
                    </TableCell>

                    {/* Column 5: Medical History */}
                    <TableCell>
                      {customer.hasMedicalHistory ? (
                        <Badge className="rounded-full border-blue-200 bg-blue-50 px-2.5 text-blue-700 shadow-none transition-all duration-200 hover:bg-blue-100">
                          Provided
                        </Badge>
                      ) : (
                        <Badge
                          variant="outline"
                          className="rounded-full border-slate-200 bg-slate-50 px-2.5 text-slate-500 shadow-none"
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
                          <Button variant="ghost" className="h-8 w-8 p-0 transition-all duration-200 hover:bg-slate-100">
                            <MoreHorizontal className="h-4 w-4 text-slate-500" />
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
                          {customer.customerCategory === "KIT" && (
                            <DropdownMenuItem asChild>
                              <Link
                                href={`/customers/${customer.id}?tab=Shipping`}
                                className="cursor-pointer font-medium flex items-center"
                              >
                                <Truck className="mr-2 h-4 w-4 text-primary" />
                                Shipping
                              </Link>
                            </DropdownMenuItem>
                          )}
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
      ) : activeTab === "Onboarded" ? (
        <OnboardingCustomersSection status="IN_PROGRESS" />
      ) : activeTab === "KIT Customer" ? (
        <KitCustomerSection
          customers={filteredKitCustomers}
          clinicFilter={clinicFilter}
          setClinicFilter={setClinicFilter}
          clinicOptions={clinicOptions}
          showArchived={showArchived}
          setShowArchived={setShowArchived}
          searchColumn={searchColumn}
          setSearchColumn={setSearchColumn}
          searchTerm={searchTerm}
          setSearchTerm={setSearchTerm}
          searchOptions={searchOptions}
          isLoading={isLoading || isPending}
          onRefresh={handleRefreshISR}
          onExport={handleExportExcel}
          onEdit={openEditModal}
          onDeactivate={openDeleteModal}
        />
      ) : null}

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