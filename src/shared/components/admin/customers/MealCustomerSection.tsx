"use client";

// src/shared/components/admin/customers/MealCustomerSection.tsx
//
// Meal Customers directory. Extracted out of CustomerDashboard so all three
// customer tables (Meal / KIT / Accommodation) are siblings that compose the
// same shared cell renderers from CustomerTableCells — which is what stops the
// three tables drifting apart again.
//
// Column 6 for a meal subscriber is the plan period: the start and end of the
// earliest-ending active subscription. That comes from the subscription rows the
// page already loads, so this column needs no extra fetch.
//
// Filter state lives in the parent rather than here, because the parent's Excel
// export must operate on exactly the rows the table is showing.

import { useMemo, useState } from "react";
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
import { Edit, Eye, MoreHorizontal, Trash2, Users } from "lucide-react";

import { DataTableCard } from "../core/DataTableCard";
import { SectionHeader } from "../core/SectionHeader";
import { DataSearchFilter } from "../core/DataSearchFilter";
import { TableColumnFilter } from "../core/TableColumnFilter";
import { TablePagination } from "../core/TablePagination";
import { ExportButton, RefreshButton } from "../core/ActionButtons";
import { ALL_CLINICS, type ClinicFilterSelection } from "@/lib/clinic/visibility";
import type { CustomerData, SubscriptionPeriod } from "./CustomerDashboard";
import {
  ContactCell,
  CustomerInfoCell,
  DateRangeLine,
  DietAllergyCell,
  DietitianCell,
  LifecycleCell,
  LocationCell,
  MedicalRecordCell,
  StatusPlanCell,
  TableEmptyRow,
  dietAllergyFilterSections,
  dietitianFilterSections,
  medicalFilterSections,
  statusFilterSections,
  CUSTOMER_TABLE_COLSPAN,
  CUSTOMER_TABLE_MIN_WIDTH,
  CUSTOMER_TABLE_SCROLL_CONTAINER,
  CUSTOMER_TABLE_STICKY_HEADER,
  LOCATION_FILTER_NO_GPS,
  LOCATION_FILTER_UNASSIGNED_CLINIC,
} from "./CustomerTableCells";

interface MealCustomerSectionProps {
  /** Rows already run through every active filter by the parent. */
  customers: CustomerData[];
  clinicFilter: ClinicFilterSelection;
  setClinicFilter: (val: ClinicFilterSelection) => void;
  clinicOptions: { id: string; name: string }[];
  locationFlags: string[];
  setLocationFlags: (val: string[]) => void;
  filterDiet: string;
  setFilterDiet: (val: string) => void;
  filterStatus: string;
  setFilterStatus: (val: string) => void;
  filterMedicalRecord: string;
  setFilterMedicalRecord: (val: string) => void;
  filterDietitian: string;
  setFilterDietitian: (val: string) => void;
  uniquePlans: string[];
  uniqueDietitians: string[];
  showArchived: boolean;
  setShowArchived: (val: boolean) => void;
  expiringInDays: number | null;
  setExpiringInDays: (val: number | null) => void;
  searchColumn: string;
  setSearchColumn: (val: string) => void;
  searchTerm: string;
  setSearchTerm: (val: string) => void;
  searchOptions: { value: string; label: string }[];
  /** customer email → active subscription window, for the Plan Period column. */
  periodMap: Map<string, SubscriptionPeriod>;
  isLoading: boolean;
  onRefresh: () => void;
  onExport: () => void;
  onEdit: (customer: CustomerData) => void;
  onDeactivate: (customer: CustomerData) => void;
  /** Removes the mutating export/edit/deactivate controls for a Dietitian (dietitian-management, Req 16.1). */
  isDietitian?: boolean;
}

const PAGE_SIZE = 20;

export function MealCustomerSection({
  customers,
  clinicFilter,
  setClinicFilter,
  clinicOptions,
  locationFlags,
  setLocationFlags,
  filterDiet,
  setFilterDiet,
  filterStatus,
  setFilterStatus,
  filterMedicalRecord,
  setFilterMedicalRecord,
  filterDietitian,
  setFilterDietitian,
  uniquePlans,
  uniqueDietitians,
  showArchived,
  setShowArchived,
  expiringInDays,
  setExpiringInDays,
  searchColumn,
  setSearchColumn,
  searchTerm,
  setSearchTerm,
  searchOptions,
  periodMap,
  isLoading,
  onRefresh,
  onExport,
  onEdit,
  onDeactivate,
  isDietitian = false,
}: MealCustomerSectionProps) {
  const [currentPage, setCurrentPage] = useState(0);

  // Send the reader back to page 1 whenever the filter set changes, otherwise a
  // narrower result set can leave them stranded on a now-empty page. Adjusted
  // during render rather than in an effect — the pattern React recommends for
  // resetting state in response to changing inputs, and it avoids the extra
  // render pass an effect would cost.
  const filterKey = [
    searchTerm,
    filterDiet,
    filterStatus,
    filterMedicalRecord,
    filterDietitian,
    String(showArchived),
    clinicFilter ?? "",
    [...locationFlags].sort().join(","),
    String(expiringInDays),
  ].join("|");
  const [prevFilterKey, setPrevFilterKey] = useState(filterKey);
  if (prevFilterKey !== filterKey) {
    setPrevFilterKey(filterKey);
    setCurrentPage(0);
  }

  const paginatedCustomers = useMemo(() => {
    const start = currentPage * PAGE_SIZE;
    return customers.slice(start, start + PAGE_SIZE);
  }, [customers, currentPage]);

  return (
    <DataTableCard
      header={<SectionHeader title="Meal Customers" icon={Users} />}
      footer={
        customers.length > 0 ? (
          <TablePagination
            totalRecords={customers.length}
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
          <Select
            value={expiringInDays === null ? "ALL" : String(expiringInDays)}
            onValueChange={(val) =>
              setExpiringInDays(val === "ALL" ? null : Number(val))
            }
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
          {/* Req 16.1: the mutating Excel export is removed for a Dietitian; Refresh is a read, so it stays. */}
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
                allValue="ALL"
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
                  { value: LOCATION_FILTER_NO_GPS, label: "No GPS" },
                ]}
              />
            </TableHead>
            <TableHead>
              <TableColumnFilter
                mode="single"
                title="Status & Plan"
                value={filterStatus}
                onChange={setFilterStatus}
                allValue="ALL"
                contentClassName="w-[200px]"
                sections={statusFilterSections(uniquePlans)}
              />
            </TableHead>
            <TableHead className="text-xs font-medium uppercase tracking-wider text-slate-500">
              Plan Period
            </TableHead>
            <TableHead>
              <TableColumnFilter
                mode="single"
                title="Medical Record"
                value={filterMedicalRecord}
                onChange={setFilterMedicalRecord}
                allValue="ALL"
                sections={medicalFilterSections()}
              />
            </TableHead>
            <TableHead>
              <TableColumnFilter
                mode="single"
                title="Dietitian"
                value={filterDietitian}
                onChange={setFilterDietitian}
                allValue="ALL"
                contentClassName="w-[200px]"
                sections={dietitianFilterSections(uniqueDietitians)}
              />
            </TableHead>
            <TableHead className="w-[50px] text-xs font-medium uppercase tracking-wider text-slate-500">
              <span className="sr-only">Actions</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {customers.length === 0 ? (
            <TableEmptyRow
              icon={Users}
              title="No meal customers found"
              hint="No meal customers match the current criteria."
              colSpan={CUSTOMER_TABLE_COLSPAN}
            />
          ) : (
            paginatedCustomers.map((customer) => {
              const period = periodMap.get(customer.email);

              return (
                <TableRow
                  key={customer.id}
                  className="transition-colors duration-200 hover:bg-slate-50"
                >
                  <CustomerInfoCell customer={customer} showGps />
                  <ContactCell customer={customer} />
                  <DietAllergyCell customer={customer} />
                  <LocationCell customer={customer} />
                  <StatusPlanCell
                    status={customer.status}
                    secondary={customer.activePlanName || "No Active Plan"}
                  />
                  <LifecycleCell
                    dates={
                      <DateRangeLine
                        start={period?.startsOn}
                        end={period?.endsOn}
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
                        {/* Req 16.1: Quick Edit and Deactivate are mutating controls, removed for a Dietitian. */}
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
