"use client";

import { useState, useMemo, useCallback, useTransition } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/shared/components/ui/button";
import { ConfirmDeleteModal } from "@/shared/components/admin/core/ConfirmDeleteModal";
import { AdminSubmenuBar } from "@/shared/components/admin/core/AdminSubmenuBar";
// ExportButton / RefreshButton are no longer imported: the Meal and KIT table
// sections render their own from the `onExport` / `onRefresh` props.
import { KitCustomerSection } from "@/shared/components/admin/customers/KitCustomerSection";
import { MealCustomerSection } from "@/shared/components/admin/customers/MealCustomerSection";
import {
  matchesDietAllergy,
  matchesStatus,
  matchesDietitian,
  matchesMedical,
  matchesLocationFlags,
} from "@/shared/components/admin/customers/CustomerTableCells";
import type { SubscriptionPeriod } from "@/shared/components/admin/customers/CustomerDashboard";
import { OnboardingCustomersSection } from "@/shared/components/admin/customers/OnboardingCustomersSection";
import { PartialPaymentSection } from "@/shared/components/admin/customers/PartialPaymentSection";
import { franchiseGetPartialPaymentBalances } from "@/actions/franchise-actions/franchisePartialPaymentActions";
import { PageHeader } from "@/shared/components/franchise/ui/PageHeader";
import {
  ALL_CLINICS,
  clinicDisplayName,
  filterRowsByClinic,
  type ClinicFilterSelection,
} from "@/lib/clinic/visibility";
import {
  Users,
  Plus,
  UserPlus,
  Stethoscope,
  ShoppingBag,
} from "lucide-react";
import * as XLSX from "xlsx";

import { FranchiseCreateCustomerModal } from "./FranchiseCreateCustomerModal";
import { FranchiseCustomerOverview } from "./FranchiseCustomerOverview";
import { FranchiseQuickEditModal } from "./FranchiseQuickEditModal";
// `applyAllFilters` is no longer imported: the Meal tab's filtering now uses the
// shared predicates from `CustomerTableCells` (the same module that builds the
// dropdown options), so the franchise-local filter pipeline is gone along with the
// franchise-local table.
import type { SearchColumn } from "./franchiseCustomerFilters";
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
  /**
   * The customer's Dietitian_Link. Selected so the server page can apply
   * `dietitianCanRead` before these rows are sent (the franchise list reads via
   * the service-role client, so RLS does not narrow them), and so the directory
   * can offer a Dietitian filter.
   */
  dietitianId?: string | null;
  /**
   * Resolved Dietitian name. `matchesDietitian` filters on the NAME, and the
   * shared `DietitianCell` displays it, so both this and `dietitianId` are needed.
   */
  dietitianName?: string | null;
  /**
   * Whether the primary address carries usable coordinates. Backs the "No GPS"
   * data-quality toggle in the shared Location column header.
   */
  hasCoords?: boolean;
}

// NOTE: the three fields above are declared with exactly the same names, types
// and optionality as the ADMIN `CustomerData`
// (`shared/components/admin/customers/CustomerDashboard.tsx`), because the Meal
// and KIT tabs now render the SHARED table components, whose `customers` prop is
// typed against that interface. Keeping them identical is what makes franchise
// rows assignable without a cast.

interface Props {
  customers: CustomerData[];
  /**
   * ACTIVE subscription windows for the visible customers, correlated by email.
   *
   * Supplied by the server page, which intersects them with the already
   * dietitian-scoped customer set — so a Dietitian cannot receive a window for a
   * customer they are not assigned to. Drives the "Expiring in N days" filter and
   * the Plan Period column, neither of which the franchise directory had.
   */
  activeSubscriptions?: {
    email: string;
    starts_on: string | null;
    ends_on: string | null;
  }[];
  franchiseId: string;
  /**
   * Renders the read-only Franchise Dietitian workspace (dietitian-management,
   * Req 23.1, 23.2, 23.3): replaces Quick Onboard + Create Customer with Log
   * Customer and removes every create/edit/deactivate/export control. Every
   * other Access_Level is unaffected — defaults to `false` so existing
   * callers keep their current behavior.
   */
  isDietitian?: boolean;
  /**
   * Whether the signed-in franchise user holds `manage` (not merely `view`) on
   * the `customers` Operations_Group (franchise-scoped-access Task 5/9).
   *
   * Defaults to `true` so any caller that does not yet pass it keeps its
   * current behaviour. The server-side gate in
   * `franchiseCustomerManagementActions` is the real enforcement; this flag
   * only avoids presenting controls that would be refused.
   */
  canManage?: boolean;
}

// No "Accommodation Customers" tab: Accommodation is not a franchise product.
// Otherwise this mirrors the admin directory's tab set.
const TABS = [
  { id: "overview", label: "Overview" },
  { id: "meal", label: "Meal Customers" },
  { id: "kit", label: "KIT Customers" },
  { id: "onboarded", label: "Onboarded" },
  { id: "partial-payment", label: "Partial Payment" },
];

const SEARCH_OPTIONS = [
  { value: "fullName", label: "Name" },
  { value: "mobile", label: "Phone" },
  { value: "email", label: "Email" },
  { value: "primary_pincode", label: "Pincode" },
];

export default function FranchiseCustomerDashboard({
  customers,
  activeSubscriptions = [],
  franchiseId,
  isDietitian = false,
  canManage = true,
}: Props) {
  /**
   * Whether to present any mutating control at all.
   *
   * Two INDEPENDENT reasons to withhold them: the caller is a Dietitian (a
   * role), or they hold `customers: "view"` rather than `"manage"` (a permission
   * level). This is presentation only — the real enforcement is the server-side
   * `checkFranchiseGroupManage("customers")` gate in
   * `franchiseCustomerManagementActions`, which refuses the write regardless of
   * what the UI renders.
   */
  const canWrite = !isDietitian && canManage;
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

  // Filters (Meal tab).
  //
  // These now mirror the ADMIN directory one-for-one, because the Meal tab renders
  // the shared `MealCustomerSection` rather than a franchise-local copy of the
  // table. That is the point of this change: the franchise directory was missing
  // the clinic filter, the dietitian filter, the location data-quality flags, the
  // "expiring in N days" filter, the plan sub-filter inside Status, the Plan Period
  // column and pagination — all of which the shared component already has.
  //
  // The franchise-only standalone Allergy select is gone: admin folds allergy into
  // the Diet & Allergy column filter (`dietAllergyFilterSections`), and keeping a
  // second control would mean two sources of truth for the same predicate.
  const [searchColumn, setSearchColumn] = useState<SearchColumn>("fullName");
  const [searchTerm, setSearchTerm] = useState("");
  const [filterDiet, setFilterDiet] = useState("ALL");
  const [filterStatus, setFilterStatus] = useState("ALL");
  const [filterMedicalRecord, setFilterMedicalRecord] = useState("ALL");
  const [filterDietitian, setFilterDietitian] = useState("ALL");
  const [showArchived, setShowArchived] = useState(false);
  const [clinicFilter, setClinicFilter] =
    useState<ClinicFilterSelection>(ALL_CLINICS);
  const [locationFlags, setLocationFlags] = useState<string[]>([]);
  const [expiringInDays, setExpiringInDays] = useState<number | null>(null);

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

  // ── Filter option sets, derived from the loaded rows ───────────────────────

  /**
   * Distinct clinics present in the rows. A franchise owns exactly one clinic
   * today, so this is usually a single option — but deriving it rather than
   * hard-coding `[]` (as the KIT tab used to) means the control is correct if a
   * franchise ever spans more, and it lets the KIT tab share the same filter.
   */
  const clinicOptions = useMemo(() => {
    const map = new Map<string, string>();
    customers.forEach((row) => {
      if (row.clinic_id) map.set(row.clinic_id, clinicDisplayName(row.clinicName));
    });
    return Array.from(map, ([id, name]) => ({ id, name })).sort((a, b) =>
      a.name.localeCompare(b.name),
    );
  }, [customers]);

  const uniquePlans = useMemo(
    () =>
      Array.from(
        new Set(
          customers
            .map((c) => c.activePlanName)
            .filter((p): p is string => Boolean(p)),
        ),
      ),
    [customers],
  );

  const uniqueDietitians = useMemo(
    () =>
      Array.from(
        new Set(
          customers
            .map((c) => c.dietitianName)
            .filter((n): n is string => Boolean(n)),
        ),
      ).sort((a, b) => a.localeCompare(b)),
    [customers],
  );

  /**
   * customer email → earliest-ending ACTIVE subscription window.
   *
   * Drives BOTH the expiring-soon filter and the Plan Period column, so a row is
   * always filtered on the same dates it displays.
   */
  const customerPeriodMap = useMemo(() => {
    const map = new Map<string, SubscriptionPeriod>();
    for (const sub of activeSubscriptions) {
      if (!sub.ends_on) continue;
      const existing = map.get(sub.email);
      if (
        !existing?.endsOn ||
        new Date(sub.ends_on) < new Date(existing.endsOn)
      ) {
        map.set(sub.email, { startsOn: sub.starts_on ?? null, endsOn: sub.ends_on });
      }
    }
    return map;
  }, [activeSubscriptions]);

  // Apply meal tab filters. Predicates come from `CustomerTableCells`, the same
  // module that builds the dropdown options, so the options and the filtering can
  // never disagree.
  const filteredMealCustomers = useMemo(() => {
    let result = filterRowsByClinic(mealCustomers, clinicFilter);

    result = result.filter((customer) =>
      matchesLocationFlags(customer, locationFlags),
    );

    result = showArchived
      ? result.filter((customer) => !customer.isActive)
      : result.filter((customer) => customer.isActive);

    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      result = result.filter((row) => {
        if (searchColumn === "fullName")
          return row.fullName.toLowerCase().includes(term);
        if (searchColumn === "mobile")
          return row.mobile.toLowerCase().includes(term);
        if (searchColumn === "email")
          return row.email.toLowerCase().includes(term);
        if (searchColumn === "primary_pincode")
          return row.primary_pincode.toLowerCase().includes(term);
        return true;
      });
    }

    result = result.filter(
      (customer) =>
        matchesDietAllergy(customer, filterDiet) &&
        matchesStatus(customer, filterStatus) &&
        matchesDietitian(customer, filterDietitian) &&
        matchesMedical(customer, filterMedicalRecord),
    );

    if (expiringInDays !== null) {
      const now = new Date();
      const cutoff = new Date(now.getTime() + expiringInDays * 86400000);
      result = result.filter((customer) => {
        const endDate = customerPeriodMap.get(customer.email)?.endsOn;
        if (!endDate) return false;
        const end = new Date(endDate);
        return end >= now && end <= cutoff;
      });
    }

    return result;
  }, [
    mealCustomers,
    clinicFilter,
    locationFlags,
    showArchived,
    searchTerm,
    searchColumn,
    filterDiet,
    filterStatus,
    filterDietitian,
    filterMedicalRecord,
    expiringInDays,
    customerPeriodMap,
  ]);

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
          isDietitian ? (
            // Req 23.3: Log Customer replaces the Quick Onboard + Create
            // Customer calls to action for a Franchise Dietitian.
            <Button size="sm" asChild>
              <Link href="/log-customer">
                <Stethoscope className="h-4 w-4 mr-1.5" />
                Log Customer
              </Link>
            </Button>
          ) : canManage ? (
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
          ) : null
          // A view-only franchise user gets neither the Dietitian's Log Customer
          // CTA nor the onboarding/create CTAs — every one of them leads to a
          // write the server would refuse.
        }
      />

      {/* Tab Navigation */}
      <AdminSubmenuBar
        tabs={TABS}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        actions={
          // Links only — no Export/Refresh here, matching the admin directory's
          // submenu bar.
          //
          // Both table sections (`MealCustomerSection`, `KitCustomerSection`)
          // render their OWN Export and Refresh controls from the `onExport` /
          // `onRefresh` props below. While the Meal tab used a franchise-local
          // table that had none, duplicating them here was the only way to offer
          // them; now it produces TWO Export and TWO Refresh buttons on the same
          // screen. `read-only-workspace.property.test.tsx` caught exactly that —
          // its `queryByRole("button", { name: /export/i })` throws on multiple
          // matches.
          <div className="flex items-center gap-2">
            {/* The Shop_Orders ledger. Hidden from a Dietitian, whose read-only
                workspace does not include shop orders — `guardFranchiseGroupAccess`
                on that page would bounce them to their landing route anyway, so
                offering the link would only lead to a dead end. */}
            {!isDietitian && (
              <Button variant="outline" size="sm" asChild>
                <Link href="/customers/shop-orders">
                  <ShoppingBag className="h-4 w-4 mr-1.5" />
                  Shop Orders
                </Link>
              </Button>
            )}
          </div>
        }
      />

      {/* Tab Content */}
      {activeTab === "overview" && (
        <FranchiseCustomerOverview customers={customers} />
      )}

      {activeTab === "meal" && (
        <MealCustomerSection
          customers={filteredMealCustomers}
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
          setSearchColumn={(val) => setSearchColumn(val as SearchColumn)}
          searchTerm={searchTerm}
          setSearchTerm={setSearchTerm}
          searchOptions={SEARCH_OPTIONS}
          periodMap={customerPeriodMap}
          isLoading={isRefreshing}
          onRefresh={handleRefresh}
          onExport={handleExport}
          onEdit={setQuickEditTarget}
          onDeactivate={setDeactivateTarget}
          // The shared component names this `isDietitian`, but it means "hide the
          // mutating controls". A view-only franchise user must be hidden them too,
          // so `!canWrite` is passed rather than `isDietitian` alone.
          isDietitian={!canWrite}
        />
      )}

      {activeTab === "kit" && (
        <KitCustomerSection
          customers={kitCustomers}
          clinicFilter={clinicFilter}
          setClinicFilter={setClinicFilter}
          clinicOptions={clinicOptions}
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
          readOnly={!canWrite}
        />
      )}

      {activeTab === "onboarded" && (
        <OnboardingCustomersSection status="IN_PROGRESS" />
      )}

      {activeTab === "partial-payment" && (
        // Receives the FULL scoped directory, not a category- or archive-filtered
        // slice: a balance is owed whether or not the account has since been
        // archived. The section joins balances onto this list, which is how it
        // inherits this page's franchise and dietitian scoping.
        //
        // `loadBalancesAction` is REQUIRED here. The section's default loader is
        // the admin action, which redirects non-admins and — worse — reads the
        // balance views with no tenant filter at all. The franchise action applies
        // franchise_id, restricts to MEAL, and adds the Dietitian_Link.
        <PartialPaymentSection
          customers={customers}
          clinicFilter={clinicFilter}
          setClinicFilter={setClinicFilter}
          clinicOptions={clinicOptions}
          searchColumn={searchColumn}
          setSearchColumn={(val) => setSearchColumn(val as SearchColumn)}
          searchTerm={searchTerm}
          setSearchTerm={setSearchTerm}
          searchOptions={SEARCH_OPTIONS}
          isDietitian={!canWrite}
          loadBalancesAction={franchiseGetPartialPaymentBalances}
        />
      )}

      {/* Modals — never rendered for a Franchise Dietitian (Req 23.1), nor for a
          view-only user, since every one of them performs a write. */}
      {canWrite && (
        <>
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
        </>
      )}
    </div>
  );
}

// The franchise-local `MealCustomerTab` that used to live here has been REMOVED.
//
// It was a second, drifting copy of the admin Meal directory table. The Meal tab
// now renders the shared `MealCustomerSection`, which already had everything the
// local copy lacked: the clinic filter, the Dietitian column and filter, the
// Location data-quality flags, the "Expiring in N days" filter, the plan
// sub-filter inside Status, the Plan Period column, and pagination.
