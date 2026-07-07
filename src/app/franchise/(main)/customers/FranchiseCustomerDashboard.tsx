"use client";

import { useState, useMemo, useCallback, useTransition } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { Badge } from "@/shared/components/ui/badge";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/shared/components/ui/dropdown-menu";
import { ConfirmDeleteModal } from "@/shared/components/admin/core/ConfirmDeleteModal";
import { AdminSubmenuBar } from "@/shared/components/admin/core/AdminSubmenuBar";
import { DataTableCard } from "@/shared/components/admin/core/DataTableCard";
import { DataSearchFilter } from "@/shared/components/admin/core/DataSearchFilter";
import { SectionHeader } from "@/shared/components/admin/core/SectionHeader";
import { StatusBadge } from "@/shared/components/admin/core/StatusBadge";
import { ExportButton, RefreshButton } from "@/shared/components/admin/core/ActionButtons";
import { KitCustomerSection } from "@/shared/components/admin/customers/KitCustomerSection";
import { OnboardingCustomersSection } from "@/shared/components/admin/customers/OnboardingCustomersSection";
import { PageHeader } from "@/shared/components/franchise/ui/PageHeader";
import { ALL_CLINICS } from "@/lib/clinic/visibility";
import { cn } from "@/lib/utils";
import {
  Users,
  Plus,
  MoreHorizontal,
  Eye,
  Edit,
  Trash2,
  UserPlus,
} from "lucide-react";
import * as XLSX from "xlsx";

import { FranchiseCreateCustomerModal } from "./FranchiseCreateCustomerModal";
import { FranchiseCustomerOverview } from "./FranchiseCustomerOverview";
import { FranchiseQuickEditModal } from "./FranchiseQuickEditModal";
import {
  applyAllFilters,
  type SearchColumn,
} from "./franchiseCustomerFilters";
import { franchiseDeactivateCustomerAccount } from "@/actions/franchise-actions/franchiseCustomerManagementActions";
import { revalidateFranchiseCustomersPage } from "@/actions/franchise-actions/franchiseCustomerManagementActions";

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

interface Props {
  customers: CustomerData[];
  franchiseId: string;
}

const TABS = [
  { id: "overview", label: "Overview" },
  { id: "meal", label: "Meal Customers" },
  { id: "kit", label: "KIT Customers" },
  { id: "onboarded", label: "Onboarded" },
];

const SEARCH_OPTIONS = [
  { value: "fullName", label: "Name" },
  { value: "mobile", label: "Phone" },
  { value: "email", label: "Email" },
  { value: "primary_pincode", label: "Pincode" },
];

export default function FranchiseCustomerDashboard({ customers, franchiseId }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  // Tab state from URL
  const activeTab = searchParams.get("tab") || "meal";
  const setActiveTab = useCallback(
    (tab: string) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set("tab", tab);
      router.replace(`?${params.toString()}`, { scroll: false });
    },
    [router, searchParams],
  );

  // Filters (Meal tab)
  const [searchColumn, setSearchColumn] = useState<SearchColumn>("fullName");
  const [searchTerm, setSearchTerm] = useState("");
  const [filterDiet, setFilterDiet] = useState("ALL");
  const [filterStatus, setFilterStatus] = useState("ALL");
  const [filterMedical, setFilterMedical] = useState("ALL");
  const [filterAllergy, setFilterAllergy] = useState("ALL");
  const [showArchived, setShowArchived] = useState(false);

  // KIT tab filters
  const [kitSearchColumn, setKitSearchColumn] = useState("fullName");
  const [kitSearchTerm, setKitSearchTerm] = useState("");
  const [kitShowArchived, setKitShowArchived] = useState(false);
  const [kitShowExpired, setKitShowExpired] = useState(false);

  // Modals
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [quickEditTarget, setQuickEditTarget] = useState<CustomerData | null>(null);
  const [deactivateTarget, setDeactivateTarget] = useState<CustomerData | null>(null);

  // Refresh state
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Filter customers by category for tabs
  const mealCustomers = useMemo(
    () =>
      customers.filter(
        (c) => c.customerCategory === "MEAL" || c.customerCategory === null,
      ),
    [customers],
  );

  const kitCustomers = useMemo(
    () => customers.filter((c) => c.customerCategory === "KIT"),
    [customers],
  );

  // Apply meal tab filters
  const filteredMealCustomers = useMemo(
    () =>
      applyAllFilters(mealCustomers, {
        searchColumn,
        searchTerm,
        filterDiet,
        filterStatus,
        filterMedical,
        filterAllergy,
        showArchived,
      }),
    [mealCustomers, searchColumn, searchTerm, filterDiet, filterStatus, filterMedical, filterAllergy, showArchived],
  );

  // Refresh handler
  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      const timeout = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("timeout")), 10000),
      );
      await Promise.race([revalidateFranchiseCustomersPage(), timeout]);
      router.refresh();
    } catch {
      toast.error("Refresh failed. Please try again.");
    } finally {
      setIsRefreshing(false);
    }
  }, [router]);

  // Deactivate handler
  const handleDeactivate = () => {
    if (!deactivateTarget) return;
    startTransition(async () => {
      const res = await franchiseDeactivateCustomerAccount(
        deactivateTarget.id,
        deactivateTarget.userId || "",
      );
      if (res.success) {
        toast.success("Customer account deactivated.");
        setDeactivateTarget(null);
        router.refresh();
      } else {
        toast.error(
          (res as { error?: string }).error || "Failed to deactivate customer.",
        );
      }
    });
  };

  // Export handler (current tab data)
  const handleExport = useCallback(() => {
    const dataToExport =
      activeTab === "kit" ? kitCustomers : filteredMealCustomers;
    if (dataToExport.length === 0) return;

    const exportData = dataToExport.map((row) => ({
      "Full Name": row.fullName,
      Email: row.email,
      Mobile: row.mobile,
      Gender: row.gender,
      Age: row.age ?? "",
      "Dietary Preference": row.dietary_preference,
      Allergies: row.allergies || "",
      "Primary Pincode": row.primary_pincode,
      "Active Plan": row.activePlanName ?? "None",
      Category: row.customerCategory ?? "N/A",
      Clinic: row.clinicName ?? "—",
      "Medical History": row.hasMedicalHistory ? "Yes" : "No",
      Status: row.status,
    }));

    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Customers");
    XLSX.writeFile(
      wb,
      `Franchise_Customers_${activeTab}_${new Date().toISOString().split("T")[0]}.xlsx`,
    );
  }, [activeTab, kitCustomers, filteredMealCustomers]);

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <PageHeader
        title="Customers"
        subtitle="Manage your franchise customers and their subscriptions."
        icon={Users}
        actions={
          <div className="flex items-center gap-3">
            <Button variant="outline" size="sm" asChild>
              <Link href="/customers/quick-onboard">
                <UserPlus className="h-4 w-4 mr-1.5" />
                Quick Onboard
              </Link>
            </Button>
            <Button
              size="sm"
              onClick={() => setIsCreateModalOpen(true)}
            >
              <Plus className="h-4 w-4 mr-1.5" />
              Create Customer
            </Button>
          </div>
        }
      />

      {/* Tab Navigation */}
      <AdminSubmenuBar
        tabs={TABS}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        actions={
          <div className="flex items-center gap-2">
            <ExportButton
              onClick={handleExport}
              disabled={
                activeTab === "overview" ||
                activeTab === "onboarded" ||
                (activeTab === "meal"
                  ? filteredMealCustomers.length === 0
                  : kitCustomers.length === 0)
              }
            />
            <RefreshButton onClick={handleRefresh} isLoading={isRefreshing} />
          </div>
        }
      />

      {/* Tab Content */}
      {activeTab === "overview" && (
        <FranchiseCustomerOverview customers={customers} />
      )}

      {activeTab === "meal" && (
        <MealCustomerTab
          customers={filteredMealCustomers}
          searchColumn={searchColumn}
          setSearchColumn={(val) => setSearchColumn(val as SearchColumn)}
          searchTerm={searchTerm}
          setSearchTerm={setSearchTerm}
          filterDiet={filterDiet}
          setFilterDiet={setFilterDiet}
          filterStatus={filterStatus}
          setFilterStatus={setFilterStatus}
          filterMedical={filterMedical}
          setFilterMedical={setFilterMedical}
          filterAllergy={filterAllergy}
          setFilterAllergy={setFilterAllergy}
          showArchived={showArchived}
          setShowArchived={setShowArchived}
          onEdit={setQuickEditTarget}
          onDeactivate={setDeactivateTarget}
        />
      )}

      {activeTab === "kit" && (
        <KitCustomerSection
          customers={kitCustomers}
          clinicFilter={ALL_CLINICS}
          setClinicFilter={() => {}}
          clinicOptions={[]}
          showArchived={kitShowArchived}
          setShowArchived={setKitShowArchived}
          showExpired={kitShowExpired}
          setShowExpired={setKitShowExpired}
          searchColumn={kitSearchColumn}
          setSearchColumn={setKitSearchColumn}
          searchTerm={kitSearchTerm}
          setSearchTerm={setKitSearchTerm}
          searchOptions={SEARCH_OPTIONS}
          isLoading={isRefreshing}
          onRefresh={handleRefresh}
          onExport={handleExport}
          onEdit={setQuickEditTarget}
          onDeactivate={setDeactivateTarget}
        />
      )}

      {activeTab === "onboarded" && (
        <OnboardingCustomersSection status="IN_PROGRESS" />
      )}

      {/* Modals */}
      <FranchiseCreateCustomerModal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        franchiseId={franchiseId}
      />

      <FranchiseQuickEditModal
        isOpen={quickEditTarget !== null}
        onClose={() => setQuickEditTarget(null)}
        customer={quickEditTarget}
        onSuccess={() => router.refresh()}
      />

      <ConfirmDeleteModal
        isOpen={deactivateTarget !== null}
        onClose={() => setDeactivateTarget(null)}
        onConfirm={handleDeactivate}
        title="Deactivate Customer"
        description={`Deactivate ${deactivateTarget?.fullName ?? "this customer"}? Login will be blocked, but billing history is preserved. This cannot be done while the customer has an active subscription.`}
        isPending={isPending}
      />
    </div>
  );
}


// ─── Meal Customers Tab ───────────────────────────────────────────────────────

interface MealCustomerTabProps {
  customers: CustomerData[];
  searchColumn: string;
  setSearchColumn: (val: string) => void;
  searchTerm: string;
  setSearchTerm: (val: string) => void;
  filterDiet: string;
  setFilterDiet: (val: string) => void;
  filterStatus: string;
  setFilterStatus: (val: string) => void;
  filterMedical: string;
  setFilterMedical: (val: string) => void;
  filterAllergy: string;
  setFilterAllergy: (val: string) => void;
  showArchived: boolean;
  setShowArchived: (val: boolean) => void;
  onEdit: (customer: CustomerData) => void;
  onDeactivate: (customer: CustomerData) => void;
}

function MealCustomerTab({
  customers,
  searchColumn,
  setSearchColumn,
  searchTerm,
  setSearchTerm,
  filterDiet,
  setFilterDiet,
  filterStatus,
  setFilterStatus,
  filterMedical,
  setFilterMedical,
  filterAllergy,
  setFilterAllergy,
  showArchived,
  setShowArchived,
  onEdit,
  onDeactivate,
}: MealCustomerTabProps) {
  return (
    <DataTableCard
      header={<SectionHeader title="Meal Customers" icon={Users} />}
      controls={
        <div className="flex flex-wrap items-center gap-4">
          <DataSearchFilter
            searchColumn={searchColumn}
            onColumnChange={setSearchColumn}
            searchTerm={searchTerm}
            onTermChange={setSearchTerm}
            options={SEARCH_OPTIONS}
          />
          <Select value={filterDiet} onValueChange={setFilterDiet}>
            <SelectTrigger className="w-[140px] border-slate-200 bg-white">
              <SelectValue placeholder="Diet" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All Diets</SelectItem>
              <SelectItem value="VEG">Veg</SelectItem>
              <SelectItem value="NON_VEG">Non-Veg</SelectItem>
              <SelectItem value="NOT_SET">Not Set</SelectItem>
            </SelectContent>
          </Select>
          <Select value={filterStatus} onValueChange={setFilterStatus}>
            <SelectTrigger className="w-[140px] border-slate-200 bg-white">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All Status</SelectItem>
              <SelectItem value="Active">Active</SelectItem>
              <SelectItem value="Pending">Pending</SelectItem>
              <SelectItem value="Stopped">Stopped</SelectItem>
              <SelectItem value="Expired">Expired</SelectItem>
              <SelectItem value="No Plan">No Plan</SelectItem>
            </SelectContent>
          </Select>
          <Select value={filterMedical} onValueChange={setFilterMedical}>
            <SelectTrigger className="w-[160px] border-slate-200 bg-white">
              <SelectValue placeholder="Medical" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All Medical</SelectItem>
              <SelectItem value="HAS_MEDICAL">Has Medical History</SelectItem>
              <SelectItem value="NO_MEDICAL">No Medical History</SelectItem>
            </SelectContent>
          </Select>
          <Select value={filterAllergy} onValueChange={setFilterAllergy}>
            <SelectTrigger className="w-[150px] border-slate-200 bg-white">
              <SelectValue placeholder="Allergy" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All Allergies</SelectItem>
              <SelectItem value="HAS_ALLERGY">Has Allergies</SelectItem>
              <SelectItem value="NO_ALLERGY">No Allergies</SelectItem>
            </SelectContent>
          </Select>
          <Button
            type="button"
            variant={showArchived ? "default" : "outline"}
            size="sm"
            onClick={() => setShowArchived(!showArchived)}
          >
            {showArchived ? "Showing Archived" : "Show Archived"}
          </Button>
        </div>
      }
    >
      <Table>
        <TableHeader>
          <TableRow className="bg-slate-50/50 border-b border-slate-200">
            <TableHead className="text-xs font-medium text-slate-500 uppercase tracking-wider">
              Customer Info
            </TableHead>
            <TableHead className="text-xs font-medium text-slate-500 uppercase tracking-wider">
              Contact
            </TableHead>
            <TableHead className="text-xs font-medium text-slate-500 uppercase tracking-wider">
              Diet & Allergy
            </TableHead>
            <TableHead className="text-xs font-medium text-slate-500 uppercase tracking-wider">
              Pincode
            </TableHead>
            <TableHead className="text-xs font-medium text-slate-500 uppercase tracking-wider">
              Active Plan
            </TableHead>
            <TableHead className="text-xs font-medium text-slate-500 uppercase tracking-wider">
              Clinic
            </TableHead>
            <TableHead className="text-xs font-medium text-slate-500 uppercase tracking-wider">
              Medical History
            </TableHead>
            <TableHead className="text-xs font-medium text-slate-500 uppercase tracking-wider">
              Status
            </TableHead>
            <TableHead className="w-[50px] text-xs font-medium text-slate-500 uppercase tracking-wider">
              <span className="sr-only">Actions</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {customers.length === 0 ? (
            <TableRow>
              <TableCell
                colSpan={9}
                className="text-center py-12 text-sm text-slate-500"
              >
                <div className="flex flex-col items-center gap-1.5">
                  <Users className="h-8 w-8 text-slate-300" />
                  <span className="text-sm font-medium text-slate-700">
                    No customers found
                  </span>
                  <span className="max-w-md text-xs text-slate-500">
                    Try adjusting your search or filter criteria.
                  </span>
                </div>
              </TableCell>
            </TableRow>
          ) : (
            customers.map((customer) => (
              <TableRow
                key={customer.id}
                className="hover:bg-slate-50 transition-colors duration-200"
              >
                {/* Customer Info */}
                <TableCell>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-slate-900 tracking-tight">
                      {customer.fullName}
                    </span>
                  </div>
                  <div className="text-sm text-slate-500 mt-0.5">
                    {customer.gender && customer.gender !== "N/A" ? (
                      <span>
                        {customer.gender.charAt(0).toUpperCase()} -{" "}
                        {customer.age ? `${customer.age} yrs` : "N/A"}
                      </span>
                    ) : (
                      <span>N/A</span>
                    )}
                  </div>
                </TableCell>

                {/* Contact */}
                <TableCell>
                  <div className="font-medium text-slate-900 text-sm">
                    {customer.mobile}
                  </div>
                  <div className="text-xs text-slate-500 mt-0.5 truncate max-w-[160px]">
                    {customer.email}
                  </div>
                </TableCell>

                {/* Diet & Allergy */}
                <TableCell>
                  <Badge
                    className={cn(
                      "rounded-full border-0 px-2 text-[10px] font-semibold",
                      customer.dietary_preference === "Veg"
                        ? "bg-green-100 text-green-700 hover:bg-green-100"
                        : customer.dietary_preference === "Non-Veg"
                          ? "bg-red-100 text-red-700 hover:bg-red-100"
                          : "bg-slate-100 text-slate-600 hover:bg-slate-100",
                    )}
                  >
                    {customer.dietary_preference === "N/A"
                      ? "Not Set"
                      : customer.dietary_preference}
                  </Badge>
                  {customer.allergies &&
                    customer.allergies.trim() !== "" &&
                    customer.allergies.toLowerCase() !== "none" &&
                    customer.allergies.toLowerCase() !== "no allergy" && (
                      <div className="text-[10px] text-slate-500 mt-1 truncate max-w-[120px]" title={customer.allergies}>
                        {customer.allergies.length > 30
                          ? `${customer.allergies.slice(0, 30)}…`
                          : customer.allergies}
                      </div>
                    )}
                </TableCell>

                {/* Pincode */}
                <TableCell>
                  <span className="text-sm font-mono text-slate-600">
                    {customer.primary_pincode}
                  </span>
                </TableCell>

                {/* Active Plan */}
                <TableCell>
                  <span className="text-sm text-slate-600">
                    {customer.activePlanName || (
                      <span className="text-slate-400">—</span>
                    )}
                  </span>
                </TableCell>

                {/* Clinic */}
                <TableCell>
                  <span
                    className={cn(
                      "text-sm",
                      customer.clinicName
                        ? "text-slate-700"
                        : "text-slate-400",
                    )}
                  >
                    {customer.clinicName || "—"}
                  </span>
                </TableCell>

                {/* Medical History */}
                <TableCell>
                  {customer.hasMedicalHistory ? (
                    <Badge className="rounded-full border-0 bg-blue-100 px-2 text-[10px] font-semibold text-blue-700 hover:bg-blue-100">
                      Medical History
                    </Badge>
                  ) : null}
                </TableCell>

                {/* Status */}
                <TableCell>
                  <StatusBadge
                    status={customer.status}
                    variant={
                      customer.status === "Active" ? "solid" : "outline"
                    }
                  />
                </TableCell>

                {/* Actions */}
                <TableCell>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        className="h-8 w-8 p-0 transition-all duration-200 hover:bg-slate-100"
                      >
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
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        className="cursor-pointer font-medium"
                        onClick={() => onEdit(customer)}
                      >
                        <Edit className="mr-2 h-4 w-4 text-muted-foreground" />
                        Quick Edit
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        className="text-destructive focus:bg-destructive/10 cursor-pointer font-medium"
                        onClick={() => onDeactivate(customer)}
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
  );
}
