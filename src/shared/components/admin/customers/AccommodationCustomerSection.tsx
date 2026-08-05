"use client";

// src/shared/components/admin/customers/AccommodationCustomerSection.tsx
//
// Accommodation Customers directory. Renders the shared 9-column spine from
// CustomerTableCells; column 6 (the one category-specific slot) holds the stay
// state and the check-in → checkout window.
//
// Two accommodation-specific readings of the shared columns:
//   - Column 4 "Location" holds the on-site stay unit (e.g. "Village Style Hut")
//     rather than pincode + clinic. Accommodation captures no delivery address,
//     so the unit is the only meaningful "where is this customer served".
//   - Column 5 "Status & Plan" pairs the account status with the stay length,
//     because a stay has no package to name.
//
// Stay data arrives from a secondary fetch, so it renders an inline spinner in
// column 6 alone — the rest of each row comes from the customer list and must
// not be held back.

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
import { Eye, MoreHorizontal, Edit, Trash2, Home } from "lucide-react";
import { cn } from "@/lib/utils";

import { DataTableCard } from "../core/DataTableCard";
import { SectionHeader } from "../core/SectionHeader";
import { DataSearchFilter } from "../core/DataSearchFilter";
import { TableColumnFilter } from "../core/TableColumnFilter";
import { TablePagination } from "../core/TablePagination";
import { ExportButton, RefreshButton } from "../core/ActionButtons";
import {
  getBulkAccommodationStayInfoAction,
  type AccommodationCustomerStayInfo,
} from "@/actions/admin-actions/accommodationCustomerActions";
import type { CustomerData } from "./CustomerDashboard";
import {
  ContactCell,
  CustomerInfoCell,
  DateRangeLine,
  DietAllergyCell,
  DietitianCell,
  LifecycleCell,
  MedicalRecordCell,
  StatusPlanCell,
  StayUnitCell,
  TableEmptyRow,
  collectDietitianNames,
  deriveCheckoutDate,
  dietAllergyFilterSections,
  dietitianFilterSections,
  formatNights,
  matchesDietAllergy,
  matchesDietitian,
  matchesMedical,
  matchesStatus,
  medicalFilterSections,
  statusFilterSections,
  CUSTOMER_TABLE_COLSPAN,
  CUSTOMER_TABLE_MIN_WIDTH,
  CUSTOMER_TABLE_SCROLL_CONTAINER,
  CUSTOMER_TABLE_STICKY_HEADER,
  FILTER_ALL,
} from "./CustomerTableCells";

interface AccommodationCustomerSectionProps {
  customers: CustomerData[];
  showArchived: boolean;
  setShowArchived: (val: boolean) => void;
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
}

const PAGE_SIZE = 20;

/** Stay status chip for column 6. `null` means the customer has no stay entry. */
function StayStatusBadge({ status }: { status: string | null }) {
  if (!status) {
    return (
      <Badge
        variant="outline"
        className="w-fit rounded-full border-slate-200 px-2.5 text-[11px] font-semibold text-slate-500"
      >
        No Stay
      </Badge>
    );
  }

  const config: Record<string, string> = {
    PENDING: "border-amber-200 bg-amber-50 text-amber-700",
    ACTIVE: "border-green-200 bg-green-50 text-green-700",
    FINISHED: "border-slate-200 bg-slate-50 text-slate-700",
    EXPIRED: "border-red-200 bg-red-50 text-red-700",
  };

  return (
    <Badge
      variant="outline"
      className={cn(
        "w-fit rounded-full px-2.5 text-[11px] font-semibold shadow-none",
        config[status] ?? config.FINISHED,
      )}
    >
      {status}
    </Badge>
  );
}

export function AccommodationCustomerSection({
  customers,
  showArchived,
  setShowArchived,
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
}: AccommodationCustomerSectionProps) {
  // Stay info fetched from server
  const [stayInfoMap, setStayInfoMap] = useState<
    Map<string, AccommodationCustomerStayInfo>
  >(new Map());
  const [loadingStayInfo, setLoadingStayInfo] = useState(false);

  // ── Column filter state ─────────────────────────────────────────────────
  const [filterDiet, setFilterDiet] = useState(FILTER_ALL);
  const [filterStayType, setFilterStayType] = useState(FILTER_ALL);
  const [filterStatus, setFilterStatus] = useState(FILTER_ALL);
  const [filterStayStatus, setFilterStayStatus] = useState(FILTER_ALL);
  const [filterMedicalRecord, setFilterMedicalRecord] = useState(FILTER_ALL);
  const [filterDietitian, setFilterDietitian] = useState(FILTER_ALL);
  const [checkoutInDays, setCheckoutInDays] = useState<number | null>(null);

  // ── Pagination state ────────────────────────────────────────────────────
  const [currentPage, setCurrentPage] = useState(0);

  /**
   * Every filter that does NOT depend on the stay-info fetch. This is what
   * drives fetchStayInfo below, so it must never depend on `stayInfoMap` —
   * otherwise each response would produce a new Map, recompute this list, and
   * re-trigger the fetch in a loop, leaving the table spinning forever.
   */
  const baseFilteredCustomers = useMemo(() => {
    const result = showArchived
      ? customers.filter((c) => !c.isActive)
      : customers.filter((c) => c.isActive);

    return result.filter(
      (c) =>
        matchesDietAllergy(c, filterDiet) &&
        matchesStatus(c, filterStatus) &&
        matchesMedical(c, filterMedicalRecord) &&
        matchesDietitian(c, filterDietitian),
    );
  }, [
    customers,
    showArchived,
    filterDiet,
    filterStatus,
    filterMedicalRecord,
    filterDietitian,
  ]);

  // Fetch stay info for the customers that survived the non-stay filters.
  const fetchStayInfo = useCallback(async () => {
    if (baseFilteredCustomers.length === 0) {
      setStayInfoMap(new Map());
      return;
    }

    setLoadingStayInfo(true);
    const ids = baseFilteredCustomers.map((c) => c.id);
    const result = await getBulkAccommodationStayInfoAction(ids);

    if ("success" in result && result.success) {
      const map = new Map<string, AccommodationCustomerStayInfo>();
      for (const item of result.data) {
        map.set(item.customerProfileId, item);
      }
      setStayInfoMap(map);
    }
    setLoadingStayInfo(false);
  }, [baseFilteredCustomers]);

  useEffect(() => {
    fetchStayInfo();
  }, [fetchStayInfo]);

  // Stay-derived filters are layered on last, since they read the fetched data.
  const displayCustomers = useMemo(() => {
    let result = baseFilteredCustomers;

    if (filterStayType !== FILTER_ALL) {
      result = result.filter(
        (c) => stayInfoMap.get(c.id)?.stayType === filterStayType,
      );
    }

    if (filterStayStatus !== FILTER_ALL) {
      result = result.filter((c) => {
        const info = stayInfoMap.get(c.id);
        if (filterStayStatus === "NO_STAY") return !info?.stayStatus;
        return info?.stayStatus === filterStayStatus;
      });
    }

    if (checkoutInDays !== null) {
      const now = new Date();
      const cutoff = new Date(now.getTime() + checkoutInDays * 24 * 60 * 60 * 1000);
      result = result.filter((c) => {
        const info = stayInfoMap.get(c.id);
        const checkout = deriveCheckoutDate(info?.startDate, info?.totalNights);
        if (!checkout) return false;
        return checkout >= now && checkout <= cutoff;
      });
    }

    return result;
  }, [
    baseFilteredCustomers,
    filterStayType,
    filterStayStatus,
    checkoutInDays,
    stayInfoMap,
  ]);

  // Send the reader back to page 1 whenever the filter set changes, otherwise a
  // narrower result set can leave them stranded on a now-empty page. Adjusted
  // during render rather than in an effect — the pattern React recommends for
  // resetting state in response to changing inputs.
  const filterKey = [
    filterDiet,
    filterStayType,
    filterStatus,
    filterStayStatus,
    filterMedicalRecord,
    filterDietitian,
    String(checkoutInDays),
    searchTerm,
    String(showArchived),
  ].join("|");
  const [prevFilterKey, setPrevFilterKey] = useState(filterKey);
  if (prevFilterKey !== filterKey) {
    setPrevFilterKey(filterKey);
    setCurrentPage(0);
  }

  const paginatedCustomers = useMemo(() => {
    const start = currentPage * PAGE_SIZE;
    return displayCustomers.slice(start, start + PAGE_SIZE);
  }, [displayCustomers, currentPage]);

  // Stay unit options for the Location column filter, from the loaded stay data.
  const uniqueStayTypes = useMemo(() => {
    const types = new Set<string>();
    stayInfoMap.forEach((info) => {
      if (info.stayType) types.add(info.stayType);
    });
    return Array.from(types).sort((a, b) => a.localeCompare(b));
  }, [stayInfoMap]);

  const dietitianOptions = useMemo(
    () => collectDietitianNames(customers),
    [customers],
  );

  return (
    <DataTableCard
      header={<SectionHeader title="Accommodation Customers" icon={Home} />}
      footer={
        displayCustomers.length > 0 ? (
          <TablePagination
            totalRecords={displayCustomers.length}
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
          <Button
            type="button"
            variant={showArchived ? "default" : "outline"}
            size="sm"
            className="transition-all duration-200"
            onClick={() => setShowArchived(!showArchived)}
          >
            {showArchived ? "Showing Archived" : "Show Archived"}
          </Button>
          <Select
            value={checkoutInDays === null ? "ALL" : String(checkoutInDays)}
            onValueChange={(val) => setCheckoutInDays(val === "ALL" ? null : Number(val))}
          >
            <SelectTrigger className="w-[175px] border-slate-200 bg-white transition-all duration-200">
              <SelectValue placeholder="Checkout in..." />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All Checkout</SelectItem>
              <SelectItem value="1">Checkout in 1 day</SelectItem>
              <SelectItem value="2">Checkout in 2 days</SelectItem>
              <SelectItem value="5">Checkout in 5 days</SelectItem>
              <SelectItem value="10">Checkout in 10 days</SelectItem>
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
                mode="single"
                title="Location"
                value={filterStayType}
                onChange={setFilterStayType}
                allValue={FILTER_ALL}
                contentClassName="w-[220px]"
                sections={[
                  {
                    label: "Filter by Stay Unit",
                    options: [
                      { value: FILTER_ALL, label: "All Stay Units" },
                      ...uniqueStayTypes.map((t) => ({ value: t, label: t })),
                    ],
                  },
                ]}
              />
            </TableHead>
            <TableHead>
              <TableColumnFilter
                mode="single"
                title="Status & Nights"
                value={filterStatus}
                onChange={setFilterStatus}
                allValue={FILTER_ALL}
                contentClassName="w-[200px]"
                sections={statusFilterSections()}
              />
            </TableHead>
            <TableHead>
              <TableColumnFilter
                mode="single"
                title="Stay"
                value={filterStayStatus}
                onChange={setFilterStayStatus}
                allValue={FILTER_ALL}
                sections={[
                  {
                    label: "Filter by Stay Status",
                    options: [
                      { value: FILTER_ALL, label: "All Stays" },
                      { value: "ACTIVE", label: "Active" },
                      { value: "PENDING", label: "Pending" },
                      { value: "FINISHED", label: "Finished" },
                      { value: "EXPIRED", label: "Expired" },
                      { value: "NO_STAY", label: "No Stay" },
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
          {displayCustomers.length === 0 ? (
            <TableEmptyRow
              icon={Home}
              title="No accommodation customers found"
              hint="No accommodation customers match the current criteria."
              colSpan={CUSTOMER_TABLE_COLSPAN}
            />
          ) : (
            paginatedCustomers.map((customer) => {
              const stayInfo = stayInfoMap.get(customer.id);
              const checkoutDate = deriveCheckoutDate(
                stayInfo?.startDate,
                stayInfo?.totalNights,
              );

              return (
                <TableRow
                  key={customer.id}
                  className="transition-colors duration-200 hover:bg-slate-50"
                >
                  <CustomerInfoCell customer={customer} />
                  <ContactCell customer={customer} />
                  <DietAllergyCell customer={customer} />

                  {/* Column 4 — on-site stay unit stands in for pincode + clinic. */}
                  <StayUnitCell unit={stayInfo?.stayType} />

                  {/* Column 5 — a stay has no package, so the sub-line is its length. */}
                  <StatusPlanCell
                    status={customer.status}
                    secondary={formatNights(stayInfo?.totalNights)}
                  />

                  {/* Column 6 — stay state and the check-in → checkout window. */}
                  <LifecycleCell
                    loading={loadingStayInfo}
                    badge={
                      <StayStatusBadge status={stayInfo?.stayStatus ?? null} />
                    }
                    dates={
                      <DateRangeLine
                        start={stayInfo?.startDate}
                        end={checkoutDate}
                      />
                    }
                  />

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
