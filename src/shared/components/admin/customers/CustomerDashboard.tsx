"use client";

import { useState, useMemo, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
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
import { AlertTriangle, Loader2, ShoppingBag, Trash2 } from "lucide-react";
import { toast } from "sonner";
import * as XLSX from "xlsx";

import { AdminSubmenuBar } from "../core/AdminSubmenuBar";
import {
  revalidateCustomersPage,
  updateCustomerBasicInfo,
  deactivateCustomerAccount,
} from "@/actions/admin-actions/customerActions";
import { AdminCreateCustomerModal } from "./AdminCreateCustomerModal";
import { CustomerOverview } from "./CustomerOverview";
import { OnboardingCustomersSection } from "./OnboardingCustomersSection";
import { MealCustomerSection } from "./MealCustomerSection";
import { KitCustomerSection } from "./KitCustomerSection";
import { AccommodationCustomerSection } from "./AccommodationCustomerSection";
import { AddonServiceRequestsPanel } from "./AddonServiceRequestsPanel";
import { UserPlus, Stethoscope } from "lucide-react";
import {
  matchesDietAllergy,
  matchesDietitian,
  matchesLocationFlags,
  matchesMedical,
  matchesStatus,
} from "./CustomerTableCells";
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
  dietitianId?: string | null;
  dietitianName?: string | null;
  hasCoords?: boolean;
}

/**
 * The active subscription window for a customer, used by the shared "Plan
 * Period" column (column 6 of the Meal table) and by the expiring-soon filters.
 * Derived from the subscription rows the page already loads — no extra fetch.
 */
export interface SubscriptionPeriod {
  startsOn: string | null;
  endsOn: string | null;
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
  /** `null` for a walk-in (non-subscriber) counter sale. */
  customer_profile_id: string | null;
  /** The subscriber's name, or the recorded walk-in buyer's name. */
  customer_name: string;
  /** The buyer's mobile when known (subscriber or walk-in). */
  customer_mobile?: string | null;
  /** Set only for a walk-in sale; identifies the order as a counter sale. */
  walkin_name?: string | null;
  walkin_mobile?: string | null;
  walkin_address?: string | null;
  /** `users.id` of the admin who placed the order; `null` when self-serve. */
  placed_by_user_id?: string | null;
  /** Display name of the admin who placed the order, when known. */
  placed_by_name?: string | null;
  total_amount: number | null;
  status: string | null;
  target_delivery_date: string | null;
  delivery_order_id: string | null;
  scheduled_delivery_date: string | null;
  /** When the order became delivered via an offline/clinic-pickup path. */
  delivered_at: string | null;
  /** e.g. 'CLINIC_PICKUP', 'DELIVERED_OFFLINE', 'UNFULFILLABLE_STOCK'. */
  fulfillment_status: string | null;
  items: Array<{ product_name: string; quantity: number; unit_price: number }>;
  /**
   * The Order_Clinic_Stamp (clinic-scoped-shop-inventory, Req 12.5, 12.6):
   * the Core_Clinic whose stock fulfilled this order, or `null` when unset
   * (the `Unassigned` grouping — e.g. a franchise order or a pre-migration
   * legacy row).
   */
  clinic_id?: string | null;
  /** Display name of the Order_Clinic_Stamp's clinic, when known (Req 12.5). */
  clinic_name?: string | null;
}

export default function CustomerDashboard({
  customers = [],
  activeSubscriptions = [],
  pendingSubscriptions = [],
  stoppedSubscriptions = [],
  autoOpenCreate = false,
  isDietitian = false,
}: {
  customers?: CustomerData[];
  activeSubscriptions?: ActiveSubscriptionData[];
  pendingSubscriptions?: ActiveSubscriptionData[];
  stoppedSubscriptions?: ActiveSubscriptionData[];
  autoOpenCreate?: boolean;
  /**
   * Renders the read-only Dietitian workspace (dietitian-management, Req
   * 15.1, 16.1, 16.6): replaces the Shop Orders + Onboarding CTAs with Log
   * Customer, and removes every create/edit/deactivate/mutating-export/
   * bulk-import control. Every other Access_Level is unaffected — this prop
   * defaults to `false` so every existing caller keeps its current behavior.
   */
  isDietitian?: boolean;
}) {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState("Overview");
  const [isLoading, setIsLoading] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [searchColumn, setSearchColumn] = useState("fullName");
  const [searchTerm, setSearchTerm] = useState("");

  // Filter States
  const [filterDiet, setFilterDiet] = useState<string>("ALL");
  const [filterStatus, setFilterStatus] = useState<string>("ALL");
  const [filterDietitian, setFilterDietitian] = useState<string>("ALL");
  const [filterMedicalRecord, setFilterMedicalRecord] = useState<string>("ALL");
  const [showArchived, setShowArchived] = useState(false);
  const [showExpired, setShowExpired] = useState(false);
  const [clinicFilter, setClinicFilter] =
    useState<ClinicFilterSelection>(ALL_CLINICS);
  // Data-quality toggles that live in the shared Location column header.
  // Multi-select so "this clinic" and "missing GPS" can still be combined.
  const [locationFlags, setLocationFlags] = useState<string[]>([]);
  const [expiringInDays, setExpiringInDays] = useState<number | null>(null);

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

  // Dynamically extract unique dietitian names for the filter dropdown
  const uniqueDietitians = useMemo(() => {
    const names = new Set(customers.map(c => c.dietitianName).filter((n): n is string => Boolean(n)));
    return Array.from(names).sort((a, b) => a.localeCompare(b));
  }, [customers]);

  /**
   * customer email → the earliest-ending active subscription window. Powers both
   * the expiring-soon filters and the Meal table's Plan Period column, so the
   * dates a row is filtered on are always the dates it displays.
   */
  const customerPeriodMap = useMemo(() => {
    const map = new Map<string, SubscriptionPeriod>();
    for (const sub of activeSubscriptions) {
      if (!sub.ends_on) continue;
      const existing = map.get(sub.email);
      if (!existing?.endsOn || new Date(sub.ends_on) < new Date(existing.endsOn)) {
        map.set(sub.email, {
          startsOn: sub.starts_on ?? null,
          endsOn: sub.ends_on,
        });
      }
    }
    return map;
  }, [activeSubscriptions]);

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
    if (tab === "Meal Customers" || tab === "KIT Customer" || tab === "Accommodation Customers") {
      setSearchColumn("fullName");
    } else {
      setSearchColumn("customer_name");
    }
    setSearchTerm("");
    setClinicFilter(ALL_CLINICS);
  };

  const filteredCustomers = useMemo(() => {
    // Meal Customers: exclude KIT and ACCOMMODATION category customers
    let result = filterRowsByClinic(
      customers.filter((c) => c.customerCategory !== "KIT" && c.customerCategory !== "ACCOMMODATION"),
      clinicFilter
    );

    // Location column data-quality toggles (unassigned clinic / missing GPS).
    result = result.filter((customer) =>
      matchesLocationFlags(customer, locationFlags),
    );

    if (showArchived) {
      // Strictly show only archived (inactive) customers
      result = result.filter((customer) => !customer.isActive);
    } else {
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

    // Column filters, sharing their predicates with the dropdown options so the
    // two can never disagree (see CustomerTableCells).
    result = result.filter(
      (customer) =>
        matchesDietAllergy(customer, filterDiet) &&
        matchesStatus(customer, filterStatus) &&
        matchesDietitian(customer, filterDietitian) &&
        matchesMedical(customer, filterMedicalRecord),
    );

    // Expiring-in-days filter: only show customers whose active subscription ends within N days
    if (expiringInDays !== null) {
      const now = new Date();
      const cutoff = new Date(now.getTime() + expiringInDays * 24 * 60 * 60 * 1000);
      result = result.filter((customer) => {
        const endDate = customerPeriodMap.get(customer.email)?.endsOn;
        if (!endDate) return false;
        const end = new Date(endDate);
        return end >= now && end <= cutoff;
      });
    }

    return result;
  }, [customers, searchTerm, searchColumn, filterDiet, filterStatus, filterDietitian, filterMedicalRecord, showArchived, clinicFilter, locationFlags, expiringInDays, customerPeriodMap]);

  // KIT Customer tab: same directory filtering pipeline, scoped to KIT category.
  const kitCustomers = useMemo(
    () => customers.filter((customer) => customer.customerCategory === "KIT"),
    [customers],
  );

  const filteredKitCustomers = useMemo(() => {
    let result = filterRowsByClinic(kitCustomers, clinicFilter);

    if (!showArchived && !showExpired) {
      result = result.filter((customer) => customer.isActive);
    } else if (showArchived && !showExpired) {
      // showArchived includes inactive (archived) customers — no isActive filter
    } else if (!showArchived && showExpired) {
      // When showExpired is active, include all customers so the child component
      // can filter by expired subscription status (expired customers may still be "active" accounts)
    } else {
      // Both active: include all, child handles union logic
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

    // Status, diet, medical and dietitian filters live in the KIT table's own
    // column headers, so they are applied inside KitCustomerSection rather than
    // here — `filterStatus` above belongs to the Meal table.
    return result;
  }, [kitCustomers, searchTerm, searchColumn, showArchived, showExpired, clinicFilter]);

  // Accommodation Customers tab: scoped to ACCOMMODATION category.
  const accommodationCustomers = useMemo(
    () => customers.filter((customer) => customer.customerCategory === "ACCOMMODATION"),
    [customers],
  );

  const filteredAccommodationCustomers = useMemo(() => {
    let result = [...accommodationCustomers];

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

    return result;
  }, [accommodationCustomers, searchTerm, searchColumn]);

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
    if (activeTab === "Meal Customers" || activeTab === "KIT Customer" || activeTab === "Accommodation Customers") {
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
    } else if (activeTab === "Accommodation Customers") {
      if (filteredAccommodationCustomers.length === 0) return;
      const exportData = filteredAccommodationCustomers.map((row) => ({
        "Full Name": row.fullName,
        Email: row.email,
        Mobile: row.mobile,
        Gender: row.gender,
        "Date of Birth": row.dateOfBirth,
        "Dietary Preference": row.dietary_preference,
        Allergies: row.allergies ?? "",
        "Medical History": row.hasMedicalHistory ? "Yes" : "No",
        Status: row.status,
      }));
      const ws = XLSX.utils.json_to_sheet(exportData);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Accommodation Customers");
      XLSX.writeFile(
        wb,
        `Accommodation_Customers_${new Date().toISOString().split("T")[0]}.xlsx`,
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
          "Accommodation Customers",
          "Onboarded",
        ]}
        activeTab={activeTab}
        onTabChange={handleTabChange}
        actions={
          isDietitian ? (
            // Req 15.1: Log Customer replaces the Shop Orders + Onboarding CTAs.
            <Button size="sm" className="transition-all duration-200" asChild>
              <Link href="/log-customer">
                <Stethoscope className="h-4 w-4 mr-1.5" />
                Log Customer
              </Link>
            </Button>
          ) : (
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                className="transition-all duration-200"
                asChild
              >
                <Link href="/customers/assisted-order">
                  <ShoppingBag className="h-4 w-4 mr-1.5" />
                  Shop Orders
                </Link>
              </Button>
              <Button size="sm" className="transition-all duration-200" asChild>
                <Link href="/customers/onboarding">
                  <UserPlus className="h-4 w-4 mr-1.5" />
                  Onboarding
                </Link>
              </Button>
            </div>
          )
        }
      />

      {/* Req 16.1: the create-customer modal is a mutating control, never rendered for a Dietitian. */}
      {!isDietitian && (
        <AdminCreateCustomerModal
          isOpen={isCreateModalOpen}
          onClose={() => setIsCreateModalOpen(false)}
        />
      )}

      {activeTab === "Overview" ? (
        <CustomerOverview
          customers={customers}
          activeSubscriptions={activeSubscriptions}
          pendingSubscriptions={pendingSubscriptions}
          stoppedSubscriptions={stoppedSubscriptions}
          onNavigate={handleTabChange}
        />
      ) : activeTab === "Meal Customers" ? (
        <MealCustomerSection
          customers={filteredCustomers}
          clinicFilter={clinicFilter}
          setClinicFilter={setClinicFilter}
          clinicOptions={clinicOptions}
          locationFlags={locationFlags}
          setLocationFlags={setLocationFlags}
          filterDiet={filterDiet}
          setFilterDiet={setFilterDiet}
          filterStatus={filterStatus}
          setFilterStatus={setFilterStatus}
          filterMedicalRecord={filterMedicalRecord}
          setFilterMedicalRecord={setFilterMedicalRecord}
          filterDietitian={filterDietitian}
          setFilterDietitian={setFilterDietitian}
          uniquePlans={uniquePlans}
          uniqueDietitians={uniqueDietitians}
          showArchived={showArchived}
          setShowArchived={setShowArchived}
          expiringInDays={expiringInDays}
          setExpiringInDays={setExpiringInDays}
          searchColumn={searchColumn}
          setSearchColumn={setSearchColumn}
          searchTerm={searchTerm}
          setSearchTerm={setSearchTerm}
          searchOptions={searchOptions}
          periodMap={customerPeriodMap}
          isLoading={isLoading || isPending}
          onRefresh={handleRefreshISR}
          onExport={handleExportExcel}
          onEdit={openEditModal}
          onDeactivate={openDeleteModal}
          isDietitian={isDietitian}
        />
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
          showExpired={showExpired}
          setShowExpired={setShowExpired}
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
          isDietitian={isDietitian}
          periodMap={customerPeriodMap}
        />
      ) : activeTab === "Accommodation Customers" ? (
        <div className="space-y-6">
          {/* Add-on wellness requests raised by accommodation customers. This
              dashboard powers the core-business Customers page only — the
              franchise portal renders FranchiseCustomerDashboard, which has no
              accommodation tab — so franchise users never see this panel. */}
          <AddonServiceRequestsPanel
            customers={filteredAccommodationCustomers}
            isDietitian={isDietitian}
          />
          <AccommodationCustomerSection
            customers={filteredAccommodationCustomers}
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
            isDietitian={isDietitian}
          />
        </div>
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
