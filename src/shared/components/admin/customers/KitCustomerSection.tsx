"use client";

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
import {
  Eye,
  MoreHorizontal,
  Edit,
  Trash2,
  Truck,
  Package,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";

import { DataTableCard } from "../core/DataTableCard";
import { SectionHeader } from "../core/SectionHeader";
import { DataSearchFilter } from "../core/DataSearchFilter";
import { TableColumnFilter } from "../core/TableColumnFilter";
import { TablePagination } from "../core/TablePagination";
import { StatusBadge } from "../core/StatusBadge";
import { ExportButton, RefreshButton } from "../core/ActionButtons";
import {
  getBulkKitShippingStatusAction,
  type KitCustomerShippingStatus,
} from "@/actions/admin-actions/kitCustomerShippingActions";
import { getExpiredKitCustomersAction } from "@/actions/admin-actions/kitLifecycleActions";
import {
  clinicDisplayName,
  ALL_CLINICS,
  type ClinicFilterSelection,
} from "@/lib/clinic/visibility";
import type { CustomerData } from "./CustomerDashboard";

interface KitCustomerSectionProps {
  customers: CustomerData[];
  clinicFilter: ClinicFilterSelection;
  setClinicFilter: (val: ClinicFilterSelection) => void;
  clinicOptions: { id: string; name: string }[];
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
  /** Map of customer email → earliest active subscription end date (for expiry filter). */
  customerEndDateMap?: Map<string, string>;
}

function formatShippingDate(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }) + ", " + date.toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
}

export function KitCustomerSection({
  customers,
  clinicFilter,
  setClinicFilter,
  clinicOptions,
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
  customerEndDateMap = new Map(),
}: KitCustomerSectionProps) {
  const [shippingStatuses, setShippingStatuses] = useState<
    Map<string, KitCustomerShippingStatus>
  >(new Map());
  const [expiringInDays, setExpiringInDays] = useState<number | null>(null);
  const [loadingShipping, setLoadingShipping] = useState(false);

  // ── Column filter state ─────────────────────────────────────────────────
  const [filterStatus, setFilterStatus] = useState("ALL");
  const [filterDietitian, setFilterDietitian] = useState("ALL");
  const [filterShipment, setFilterShipment] = useState("ALL");

  // ── Pagination state ────────────────────────────────────────────────────
  const [currentPage, setCurrentPage] = useState(0);
  const PAGE_SIZE = 20;

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

  // Apply expiring-in-days filter on top of display list
  const expiryFilteredCustomers = useMemo(() => {
    if (expiringInDays === null) return displayCustomers;
    const now = new Date();
    const cutoff = new Date(now.getTime() + expiringInDays * 24 * 60 * 60 * 1000);
    return displayCustomers.filter((c) => {
      const endDate = customerEndDateMap.get(c.email);
      if (!endDate) return false;
      const end = new Date(endDate);
      return end >= now && end <= cutoff;
    });
  }, [displayCustomers, expiringInDays, customerEndDateMap]);

  // Fetch shipping statuses for all visible KIT customers
  const fetchShippingStatuses = useCallback(async () => {
    if (expiryFilteredCustomers.length === 0) {
      setShippingStatuses(new Map());
      return;
    }

    setLoadingShipping(true);
    const ids = expiryFilteredCustomers.map((c) => c.id);
    const result = await getBulkKitShippingStatusAction(ids);

    if (result.success) {
      const map = new Map<string, KitCustomerShippingStatus>();
      for (const item of result.data) {
        map.set(item.customerProfileId, item);
      }
      setShippingStatuses(map);
    }
    setLoadingShipping(false);
  }, [expiryFilteredCustomers]);

  useEffect(() => {
    fetchShippingStatuses();
  }, [fetchShippingStatuses]);

  // ── Derived list with column filters + pagination ─────────────────────────
  const filteredDisplayCustomers = useMemo(() => {
    let result = expiryFilteredCustomers;

    if (filterStatus !== "ALL") {
      result = result.filter((c) => c.status === filterStatus);
    }

    if (filterDietitian !== "ALL") {
      if (filterDietitian === "UNASSIGNED") {
        result = result.filter((c) => !c.dietitianName);
      } else {
        result = result.filter((c) => c.dietitianName === filterDietitian);
      }
    }

    if (filterShipment !== "ALL") {
      result = result.filter((c) => {
        const shipping = shippingStatuses.get(c.id);
        const shipmentStatus = shipping?.status ?? "Not Shipped";
        return shipmentStatus === filterShipment;
      });
    }

    return result;
  }, [expiryFilteredCustomers, filterStatus, filterDietitian, filterShipment, shippingStatuses]);

  // Reset page when filters change
  useEffect(() => {
    setCurrentPage(0);
  }, [filterStatus, filterDietitian, filterShipment, searchTerm, showArchived, showExpired]);

  const paginatedCustomers = useMemo(() => {
    const start = currentPage * PAGE_SIZE;
    return filteredDisplayCustomers.slice(start, start + PAGE_SIZE);
  }, [filteredDisplayCustomers, currentPage, PAGE_SIZE]);

  // Unique dietitian names for filter options
  const dietitianOptions = useMemo(() => {
    const names = new Set<string>();
    expiryFilteredCustomers.forEach((c) => {
      if (c.dietitianName) names.add(c.dietitianName);
    });
    return Array.from(names).sort();
  }, [expiryFilteredCustomers]);

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
      <Table>
        <TableHeader>
          <TableRow className="bg-slate-50/50 border-b border-slate-200">
            <TableHead className="text-xs font-medium text-slate-500 uppercase tracking-wider">
              Customer Info
            </TableHead>
            <TableHead className="text-xs font-medium text-slate-500 uppercase tracking-wider">
              Contact
            </TableHead>
            <TableHead>
              <TableColumnFilter
                mode="single"
                title="Status"
                value={filterStatus}
                onChange={setFilterStatus}
                allValue="ALL"
                sections={[
                  {
                    label: "Filter by Status",
                    options: [
                      { value: "ALL", label: "All Statuses" },
                      { value: "Active", label: "Active" },
                      { value: "Pending", label: "Pending" },
                      { value: "Expired", label: "Expired" },
                      { value: "Stopped", label: "Stopped" },
                      { value: "No Plan", label: "No Plan" },
                    ],
                  },
                ]}
              />
            </TableHead>
            <TableHead className="text-xs font-medium text-slate-500 uppercase tracking-wider">
              Clinic
            </TableHead>
            <TableHead>
              <TableColumnFilter
                mode="single"
                title="Dietitian"
                value={filterDietitian}
                onChange={setFilterDietitian}
                allValue="ALL"
                contentClassName="w-[200px]"
                sections={[
                  {
                    label: "Filter by Dietitian",
                    options: [
                      { value: "ALL", label: "All Dietitians" },
                      { value: "UNASSIGNED", label: "Unassigned" },
                      ...dietitianOptions.map((name) => ({ value: name, label: name })),
                    ],
                  },
                ]}
              />
            </TableHead>
            <TableHead>
              <TableColumnFilter
                mode="single"
                title="Shipment Status"
                value={filterShipment}
                onChange={setFilterShipment}
                allValue="ALL"
                sections={[
                  {
                    label: "Filter by Shipment",
                    options: [
                      { value: "ALL", label: "All Shipments" },
                      { value: "Not Shipped", label: "Not Shipped" },
                      { value: "Shipped", label: "Shipped" },
                      { value: "Delivered", label: "Delivered" },
                    ],
                  },
                ]}
              />
            </TableHead>
            <TableHead className="w-[50px] text-xs font-medium text-slate-500 uppercase tracking-wider">
              <span className="sr-only">Actions</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {(loadingExpired && showExpired) ? (
            <TableRow>
              <TableCell
                colSpan={7}
                className="text-center py-12 text-sm text-slate-500"
              >
                <div className="flex flex-col items-center gap-1.5">
                  <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
                  <span className="text-sm text-slate-500">
                    Loading expired customers...
                  </span>
                </div>
              </TableCell>
            </TableRow>
          ) : filteredDisplayCustomers.length === 0 ? (
            <TableRow>
              <TableCell
                colSpan={7}
                className="text-center py-12 text-sm text-slate-500"
              >
                <div className="flex flex-col items-center gap-1.5">
                  <Package className="h-8 w-8 text-slate-300" />
                  <span className="text-sm font-medium text-slate-700">
                    No KIT customers found
                  </span>
                  <span className="max-w-md text-xs text-slate-500">
                    KIT customers will appear here once they complete onboarding.
                  </span>
                </div>
              </TableCell>
            </TableRow>
          ) : (
            paginatedCustomers.map((customer) => {
              const shipping = shippingStatuses.get(customer.id);
              const shipmentStatus = shipping?.status ?? "Not Shipped";
              const shipmentDate = shipping?.statusUpdatedAt ?? null;

              return (
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
                      <Badge className="rounded-full border-0 bg-orange-100 px-2 text-[10px] font-semibold text-orange-700 hover:bg-orange-100">
                        KIT
                      </Badge>
                    </div>
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
                  </TableCell>

                  {/* Contact */}
                  <TableCell>
                    <div className="font-medium text-slate-900">
                      {customer.mobile}
                    </div>
                    <div className="mt-1">
                      <Badge
                        className={cn(
                          "rounded-full border-0 px-2 text-[10px] font-semibold",
                          customer.dietary_preference === "Veg"
                            ? "bg-green-100 text-green-700 hover:bg-green-100"
                            : "bg-red-100 text-red-700 hover:bg-red-100"
                        )}
                      >
                        {customer.dietary_preference === "N/A"
                          ? "Not Set"
                          : customer.dietary_preference}
                      </Badge>
                    </div>
                  </TableCell>

                  {/* Status */}
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

                  {/* Clinic */}
                  <TableCell>
                    <span
                      className={cn(
                        "text-sm",
                        customer.clinicName
                          ? "text-slate-700"
                          : "text-slate-400 italic"
                      )}
                    >
                      {clinicDisplayName(customer.clinicName)}
                    </span>
                  </TableCell>

                  {/* Dietitian */}
                  <TableCell>
                    <span
                      className={cn(
                        "text-sm",
                        customer.dietitianName
                          ? "text-slate-700"
                          : "text-slate-400 italic"
                      )}
                    >
                      {customer.dietitianName || "Unassigned"}
                    </span>
                  </TableCell>

                  {/* Shipment Status */}
                  <TableCell>
                    {loadingShipping ? (
                      <Loader2 className="h-4 w-4 animate-spin text-slate-400" />
                    ) : shipmentStatus === "Not Shipped" ? (
                      <Link
                        href={`/customers/${customer.id}?tab=Shipping`}
                        className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
                      >
                        <Truck className="h-3.5 w-3.5" />
                        Add Shipment
                      </Link>
                    ) : (
                      <div className="flex flex-col gap-0.5">
                        <Badge
                          className={cn(
                            "rounded-full px-2.5 text-[11px] font-semibold shadow-none w-fit",
                            shipmentStatus === "Shipped"
                              ? "bg-blue-50 text-blue-700 border-blue-200"
                              : "bg-green-50 text-green-700 border-green-200"
                          )}
                          variant="outline"
                        >
                          {shipmentStatus}
                        </Badge>
                        {shipmentDate && (
                          <span className="text-[10px] text-slate-500 mt-0.5">
                            {formatShippingDate(shipmentDate)}
                          </span>
                        )}
                      </div>
                    )}
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
                        <DropdownMenuItem asChild>
                          <Link
                            href={`/customers/${customer.id}?tab=Shipping`}
                            className="cursor-pointer font-medium flex items-center"
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
                              className="text-destructive focus:bg-destructive/10 cursor-pointer font-medium"
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
