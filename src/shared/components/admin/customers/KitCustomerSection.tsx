"use client";

// src/shared/components/admin/customers/KitCustomerSection.tsx
//
// KIT Customers directory. Renders the shared 9-column spine from
// CustomerTableCells; column 6 (the one category-specific slot) holds the KIT
// shipment state and the timestamp it last changed.
//
// Shipment status arrives from a secondary fetch, so it renders an inline
// spinner in that cell alone — the rest of each row is available immediately
// from the customer list and must not be held back.

import { useEffect, useState, useCallback, useMemo } from "react";
import Link from "next/link";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/shared/components/ui/table";
import { Button } from "@/shared/components/ui/button";
import { Badge } from "@/shared/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/shared/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";
import { Building2, Eye, MoreHorizontal, Edit, Trash2, Truck, Package } from "lucide-react";
import { cn } from "@/lib/utils";

import { DataTableCard } from "../core/DataTableCard";
import { SectionHeader } from "../core/SectionHeader";
import { DataSearchFilter } from "../core/DataSearchFilter";
import { TableColumnFilter } from "../core/TableColumnFilter";
import { TablePagination } from "../core/TablePagination";
import { ExportButton, RefreshButton } from "../core/ActionButtons";
import {
  getBulkKitShippingStatusAction,
  type KitCustomerShippingStatus,
} from "@/actions/admin-actions/kitCustomerShippingActions";
import { getExpiredKitCustomersAction } from "@/actions/admin-actions/kitLifecycleActions";
import { ALL_CLINICS, type ClinicFilterSelection } from "@/lib/clinic/visibility";
import type { CustomerData, SubscriptionPeriod } from "./CustomerDashboard";
import {
  ContactCell,
  CustomerInfoCell,
  DietAllergyCell,
  DietitianCell,
  LifecycleCell,
  LocationCell,
  MedicalRecordCell,
  StatusPlanCell,
  TableEmptyRow,
  TableLoadingRow,
  collectDietitianNames,
  dietAllergyFilterSections,
  dietitianFilterSections,
  formatDateTime,
  matchesDietAllergy,
  matchesDietitian,
  matchesLocationFlags,
  matchesMedical,
  matchesStatus,
  medicalFilterSections,
  statusFilterSections,
  CUSTOMER_TABLE_COLSPAN,
  CUSTOMER_TABLE_MIN_WIDTH,
  CUSTOMER_TABLE_SCROLL_CONTAINER,
  CUSTOMER_TABLE_STICKY_HEADER,
  FILTER_ALL,
  LOCATION_FILTER_UNASSIGNED_CLINIC,
} from "./CustomerTableCells";

interface KitCustomerSectionProps {
  customers: CustomerData[];
  clinicFilter: ClinicFilterSelection;
  setClinicFilter: (val: ClinicFilterSelection) => void;
  clinicOptions: { id: string; name: string }[];
  /**
   * Set for a Clinic_Scoped_Admin: every row is already confined to this one
   * clinic server-side, so the filter renders as a static label with this
   * name instead of a dropdown (there is nothing else to select).
   */
  lockedClinicName?: string | null;
  showArchived: boolean;
  setShowArchived: (val: boolean) => void;
  showExpired: boolean;
  setShowExpired: (val: boolean) => void;
  searchColumn: string;
  setSearchColumn: (val: string) => void;
  searchTerm: string;
  setSearchTerm: (val: string) => void;
  searchOptions: { value: string; label: string }[];
  isLoading: boolean;
  onRefresh: () => void;
  onExport: () => void;
  onEdit: (customer: CustomerData) => void;
  onDeactivate: (customer: CustomerData) => void;
  /** Removes the mutating export/edit/deactivate controls for a Dietitian (dietitian-management, Req 16.1). */
  isDietitian?: boolean;
  /** customer email → active subscription window, for the expiry filter. */
  periodMap?: Map<string, SubscriptionPeriod>;
}

const PAGE_SIZE = 20;

export function KitCustomerSection({
  customers,
  clinicFilter,
  setClinicFilter,
  clinicOptions,
  lockedClinicName = null,
  showArchived,
  setShowArchived,
  showExpired,
  setShowExpired,
  searchColumn,
  setSearchColumn,
  searchTerm,
  setSearchTerm,
  searchOptions,
  isLoading,
  onRefresh,
  onExport,
  onEdit,
  onDeactivate,
  isDietitian = false,
  periodMap = new Map(),
}: KitCustomerSectionProps) {
  const [shippingStatuses, setShippingStatuses] = useState<
    Map<string, KitCustomerShippingStatus>
  >(new Map());
  const [expiringInDays, setExpiringInDays] = useState<number | null>(null);
  const [loadingShipping, setLoadingShipping] = useState(false);

  // ── Column filter state ─────────────────────────────────────────────────
  const [filterDiet, setFilterDiet] = useState(FILTER_ALL);
  const [locationFlags, setLocationFlags] = useState<string[]>([]);
  const [filterStatus, setFilterStatus] = useState(FILTER_ALL);
  const [filterShipment, setFilterShipment] = useState(FILTER_ALL);
  const [filterMedicalRecord, setFilterMedicalRecord] = useState(FILTER_ALL);
  const [filterDietitian, setFilterDietitian] = useState(FILTER_ALL);

  // ── Pagination state ────────────────────────────────────────────────────
  const [currentPage, setCurrentPage] = useState(0);

  // Expired KIT customers state
  const [expiredCustomerIds, setExpiredCustomerIds] = useState<Set<string>>(new Set());
  const [loadingExpired, setLoadingExpired] = useState(false);

  // Fetch expired KIT customer IDs for filtering
  const fetchExpiredCustomers = useCallback(async () => {
    if (!showExpired) {
      setExpiredCustomerIds(new Set());
      return;
    }

    setLoadingExpired(true);
    const result = await getExpiredKitCustomersAction();

    if (result.success) {
      const ids = new Set(result.data.map((c) => c.customerProfileId));
      setExpiredCustomerIds(ids);
    }
    setLoadingExpired(false);
  }, [showExpired]);

  useEffect(() => {
    fetchExpiredCustomers();
  }, [fetchExpiredCustomers]);

  // Determine which customers to display based on toggle states
  // - Default (neither toggle): show customers list as-is (active/pending from parent)
  // - Show Archived only: strictly show only archived (inactive) customers
  // - Show Expired only: filter to only expired customers from the full customer set
  // - Both active: union of archived + expired, each appearing at most once
  const displayCustomers = useMemo(() => {
    if (!showArchived && !showExpired) {
      // No filter active — show the parent-filtered (active) list as-is
      return customers;
    }

    if (showArchived && !showExpired) {
      // Strictly show only archived (inactive) customers
      return customers.filter((c) => !c.isActive);
    }

    if (showExpired && !showArchived) {
      // Show only expired customers (those whose most recent KIT subscription is EXPIRED)
      return customers.filter((c) => expiredCustomerIds.has(c.id));
    }

    // Both active: union of archived (inactive) + expired
    // The parent already includes inactive customers when showArchived is true,
    // so we filter to those that are either inactive OR expired
    return customers.filter(
      (c) => !c.isActive || expiredCustomerIds.has(c.id)
    );
  }, [customers, showExpired, showArchived, expiredCustomerIds]);

  /**
   * Every filter that does NOT depend on the shipment fetch. This is what drives
   * fetchShippingStatuses below, so it must never depend on `shippingStatuses` —
   * otherwise each response would produce a new Map, recompute this list, and
   * re-trigger the fetch in a loop.
   */
  const baseFilteredCustomers = useMemo(() => {
    let result = displayCustomers;

    if (expiringInDays !== null) {
      const now = new Date();
      const cutoff = new Date(now.getTime() + expiringInDays * 24 * 60 * 60 * 1000);
      result = result.filter((c) => {
        const endDate = periodMap.get(c.email)?.endsOn;
        if (!endDate) return false;
        const end = new Date(endDate);
        return end >= now && end <= cutoff;
      });
    }

    return result.filter(
      (c) =>
        matchesDietAllergy(c, filterDiet) &&
        matchesLocationFlags(c, locationFlags) &&
        matchesStatus(c, filterStatus) &&
        matchesMedical(c, filterMedicalRecord) &&
        matchesDietitian(c, filterDietitian),
    );
  }, [
    displayCustomers,
    expiringInDays,
    periodMap,
    filterDiet,
    locationFlags,
    filterStatus,
    filterMedicalRecord,
    filterDietitian,
  ]);

  // Fetch shipping statuses for all visible KIT customers
  const fetchShippingStatuses = useCallback(async () => {
    if (baseFilteredCustomers.length === 0) {
      setShippingStatuses(new Map());
      return;
    }

    setLoadingShipping(true);
    const ids = baseFilteredCustomers.map((c) => c.id);
    const result = await getBulkKitShippingStatusAction(ids);

    if (result.success) {
      const map = new Map<string, KitCustomerShippingStatus>();
      for (const item of result.data) {
        map.set(item.customerProfileId, item);
      }
      setShippingStatuses(map);
    }
    setLoadingShipping(false);
  }, [baseFilteredCustomers]);

  useEffect(() => {
    fetchShippingStatuses();
  }, [fetchShippingStatuses]);

  // The shipment filter is layered on last, since it reads the fetched data.
  const filteredDisplayCustomers = useMemo(() => {
    if (filterShipment === FILTER_ALL) return baseFilteredCustomers;
    return baseFilteredCustomers.filter((c) => {
      const shipmentStatus = shippingStatuses.get(c.id)?.status ?? "Not Shipped";
      return shipmentStatus === filterShipment;
    });
  }, [baseFilteredCustomers, filterShipment, shippingStatuses]);

  // Send the reader back to page 1 whenever the filter set changes, otherwise a
  // narrower result set can leave them stranded on a now-empty page. Adjusted
  // during render rather than in an effect — the pattern React recommends for
  // resetting state in response to changing inputs.
  const filterKey = [
    filterDiet,
    [...locationFlags].sort().join(","),
    filterStatus,
    filterShipment,
    filterMedicalRecord,
    filterDietitian,
    String(expiringInDays),
    searchTerm,
    String(showArchived),
    String(showExpired),
  ].join("|");
  const [prevFilterKey, setPrevFilterKey] = useState(filterKey);
  if (prevFilterKey !== filterKey) {
    setPrevFilterKey(filterKey);
    setCurrentPage(0);
  }

  const paginatedCustomers = useMemo(() => {
    const start = currentPage * PAGE_SIZE;
    return filteredDisplayCustomers.slice(start, start + PAGE_SIZE);
  }, [filteredDisplayCustomers, currentPage]);

  const dietitianOptions = useMemo(
    () => collectDietitianNames(displayCustomers),
    [displayCustomers],
  );

  const uniquePlans = useMemo(() => {
    const plans = new Set<string>();
    for (const c of displayCustomers) {
      if (c.activePlanName) plans.add(c.activePlanName);
    }
    return Array.from(plans).sort((a, b) => a.localeCompare(b));
  }, [displayCustomers]);

  return (
    <DataTableCard
      header={<SectionHeader title="KIT Customers" icon={Package} />}
      footer={
        filteredDisplayCustomers.length > 0 ? (
          <TablePagination
            totalRecords={filteredDisplayCustomers.length}
            pageSize={PAGE_SIZE}
            currentPage={currentPage}
            onPageChange={setCurrentPage}
          />
        ) : undefined
      }
      controls={
        <div className="flex flex-wrap items-center gap-4">
          <DataSearchFilter
            searchColumn={searchColumn}
            onColumnChange={setSearchColumn}
            searchTerm={searchTerm}
            onTermChange={setSearchTerm}
            options={searchOptions}
          />
          {lockedClinicName ? (
            <div
              className="flex w-[200px] items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700"
              aria-label={`Clinic: ${lockedClinicName}`}
            >
              <Building2 className="h-4 w-4 text-emerald-600" />
              <span className="truncate font-medium">{lockedClinicName}</span>
            </div>
          ) : (
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
          )}
          <Button
            type="button"
            variant={showArchived ? "default" : "outline"}
            size="sm"
            className="transition-all duration-200"
            onClick={() => setShowArchived(!showArchived)}
          >
            {showArchived ? "Showing Archived" : "Show Archived"}
          </Button>
          <Button
            type="button"
            variant={showExpired ? "default" : "outline"}
            size="sm"
            className="transition-all duration-200"
            onClick={() => setShowExpired(!showExpired)}
          >
            {showExpired ? "Showing Expired" : "Show Expired"}
          </Button>
          <Select
            value={expiringInDays === null ? "ALL" : String(expiringInDays)}
            onValueChange={(val) => setExpiringInDays(val === "ALL" ? null : Number(val))}
          >
            <SelectTrigger className="w-[160px] border-slate-200 bg-white transition-all duration-200">
              <SelectValue placeholder="Expiring in..." />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All Expiry</SelectItem>
              <SelectItem value="2">Expiring in 2 days</SelectItem>
              <SelectItem value="5">Expiring in 5 days</SelectItem>
              <SelectItem value="10">Expiring in 10 days</SelectItem>
              <SelectItem value="15">Expiring in 15 days</SelectItem>
            </SelectContent>
          </Select>
        </div>
      }
      actions={
        <>
          {!isDietitian && (
            <ExportButton onClick={onExport} disabled={customers.length === 0} />
          )}
          <RefreshButton onClick={onRefresh} isLoading={isLoading} />
        </>
      }
    >
      <Table
        containerClassName={CUSTOMER_TABLE_SCROLL_CONTAINER}
        className={CUSTOMER_TABLE_MIN_WIDTH}
      >
        <TableHeader className={CUSTOMER_TABLE_STICKY_HEADER}>
          <TableRow className="border-b border-slate-200">
            <TableHead className="text-xs font-medium uppercase tracking-wider text-slate-500">
              Customer Info
            </TableHead>
            <TableHead className="text-xs font-medium uppercase tracking-wider text-slate-500">
              Contact
            </TableHead>
            <TableHead>
              <TableColumnFilter
                mode="single"
                title="Diet & Allergy"
                value={filterDiet}
                onChange={setFilterDiet}
                allValue={FILTER_ALL}
                sections={dietAllergyFilterSections()}
              />
            </TableHead>
            <TableHead>
              <TableColumnFilter
                mode="multiple"
                title="Location"
                values={locationFlags}
                onChange={setLocationFlags}
                groupLabel="Flag data gaps"
                contentClassName="w-[200px]"
                options={[
                  {
                    value: LOCATION_FILTER_UNASSIGNED_CLINIC,
                    label: "Clinic: Unassigned",
                  },
                ]}
              />
            </TableHead>
            <TableHead>
              <TableColumnFilter
                mode="single"
                title="Status & Plan"
                value={filterStatus}
                onChange={setFilterStatus}
                allValue={FILTER_ALL}
                contentClassName="w-[200px]"
                sections={statusFilterSections(uniquePlans)}
              />
            </TableHead>
            <TableHead>
              <TableColumnFilter
                mode="single"
                title="Shipment"
                value={filterShipment}
                onChange={setFilterShipment}
                allValue={FILTER_ALL}
                sections={[
                  {
                    label: "Filter by Shipment",
                    options: [
                      { value: FILTER_ALL, label: "All Shipments" },
                      { value: "Not Shipped", label: "Not Shipped" },
                      { value: "Shipped", label: "Shipped" },
                      { value: "Delivered", label: "Delivered" },
                    ],
                  },
                ]}
              />
            </TableHead>
            <TableHead>
              <TableColumnFilter
                mode="single"
                title="Medical Record"
                value={filterMedicalRecord}
                onChange={setFilterMedicalRecord}
                allValue={FILTER_ALL}
                sections={medicalFilterSections()}
              />
            </TableHead>
            <TableHead>
              <TableColumnFilter
                mode="single"
                title="Dietitian"
                value={filterDietitian}
                onChange={setFilterDietitian}
                allValue={FILTER_ALL}
                contentClassName="w-[200px]"
                sections={dietitianFilterSections(dietitianOptions)}
              />
            </TableHead>
            <TableHead className="w-[50px] text-xs font-medium uppercase tracking-wider text-slate-500">
              <span className="sr-only">Actions</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {loadingExpired && showExpired ? (
            <TableLoadingRow
              label="Loading expired customers..."
              colSpan={CUSTOMER_TABLE_COLSPAN}
            />
          ) : filteredDisplayCustomers.length === 0 ? (
            <TableEmptyRow
              icon={Package}
              title="No KIT customers found"
              hint="KIT customers will appear here once they complete onboarding."
              colSpan={CUSTOMER_TABLE_COLSPAN}
            />
          ) : (
            paginatedCustomers.map((customer) => {
              const shipping = shippingStatuses.get(customer.id);
              const shipmentStatus = shipping?.status ?? "Not Shipped";
              const shipmentDate = formatDateTime(shipping?.statusUpdatedAt);

              return (
                <TableRow
                  key={customer.id}
                  className="transition-colors duration-200 hover:bg-slate-50"
                >
                  <CustomerInfoCell customer={customer} />
                  <ContactCell customer={customer} />
                  <DietAllergyCell customer={customer} />
                  <LocationCell customer={customer} />
                  <StatusPlanCell
                    status={customer.status}
                    secondary={customer.activePlanName || "No Active Plan"}
                  />

                  {/* Column 6 — KIT lifecycle: shipment state and when it changed. */}
                  {shipmentStatus === "Not Shipped" && !loadingShipping ? (
                    <TableCell>
                      <Link
                        href={`/customers/${customer.id}?tab=Shipping`}
                        className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
                      >
                        <Truck className="h-3.5 w-3.5" />
                        Add Shipment
                      </Link>
                    </TableCell>
                  ) : (
                    <LifecycleCell
                      loading={loadingShipping}
                      badge={
                        <Badge
                          variant="outline"
                          className={cn(
                            "w-fit rounded-full px-2.5 text-[11px] font-semibold shadow-none",
                            shipmentStatus === "Shipped"
                              ? "border-blue-200 bg-blue-50 text-blue-700"
                              : "border-green-200 bg-green-50 text-green-700",
                          )}
                        >
                          {shipmentStatus}
                        </Badge>
                      }
                      dates={
                        shipmentDate ? (
                          <span className="text-xs text-slate-500">
                            {shipmentDate}
                          </span>
                        ) : undefined
                      }
                    />
                  )}

                  <MedicalRecordCell
                    hasMedicalHistory={customer.hasMedicalHistory}
                  />
                  <DietitianCell dietitianName={customer.dietitianName} />

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
                            className="flex cursor-pointer items-center font-medium"
                          >
                            <Eye className="mr-2 h-4 w-4 text-primary" />
                            View 360 Dashboard
                          </Link>
                        </DropdownMenuItem>
                        <DropdownMenuItem asChild>
                          <Link
                            href={`/customers/${customer.id}?tab=Shipping`}
                            className="flex cursor-pointer items-center font-medium"
                          >
                            <Truck className="mr-2 h-4 w-4 text-primary" />
                            Shipping
                          </Link>
                        </DropdownMenuItem>
                        {!isDietitian && (
                          <>
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
                              className="cursor-pointer font-medium text-destructive focus:bg-destructive/10"
                              onClick={() => onDeactivate(customer)}
                              disabled={!customer.isActive}
                            >
                              <Trash2 className="mr-2 h-4 w-4" />
                              Deactivate Customer
                            </DropdownMenuItem>
                          </>
                        )}
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
  );
}
