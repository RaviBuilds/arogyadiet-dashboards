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
  Home,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";

import { DataTableCard } from "../core/DataTableCard";
import { SectionHeader } from "../core/SectionHeader";
import { DataSearchFilter } from "../core/DataSearchFilter";
import { ExportButton, RefreshButton } from "../core/ActionButtons";
import {
  getBulkAccommodationStayInfoAction,
  type AccommodationCustomerStayInfo,
} from "@/actions/admin-actions/accommodationCustomerActions";
import type { CustomerData } from "./CustomerDashboard";

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
}

// --- Filter states managed internally ---
function getStayStatusBadge(status: string | null) {
  if (!status) {
    return (
      <Badge
        variant="outline"
        className="rounded-full px-2.5 text-[11px] font-semibold text-slate-500 border-slate-200"
      >
        No Stay
      </Badge>
    );
  }

  const config: Record<string, { bg: string; text: string; border: string }> = {
    PENDING: { bg: "bg-amber-50", text: "text-amber-700", border: "border-amber-200" },
    ACTIVE: { bg: "bg-green-50", text: "text-green-700", border: "border-green-200" },
    FINISHED: { bg: "bg-slate-50", text: "text-slate-700", border: "border-slate-200" },
    EXPIRED: { bg: "bg-red-50", text: "text-red-700", border: "border-red-200" },
  };

  const style = config[status] ?? config.FINISHED;

  return (
    <Badge
      variant="outline"
      className={cn(
        "rounded-full px-2.5 text-[11px] font-semibold shadow-none w-fit",
        style.bg,
        style.text,
        style.border
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
}: AccommodationCustomerSectionProps) {
  // Stay info fetched from server
  const [stayInfoMap, setStayInfoMap] = useState<
    Map<string, AccommodationCustomerStayInfo>
  >(new Map());
  const [loadingStayInfo, setLoadingStayInfo] = useState(false);

  // Internal filters for the accommodation tab
  const [filterDiet, setFilterDiet] = useState<string>("ALL");
  const [filterStatus, setFilterStatus] = useState<string>("ALL");
  const [filterMedical, setFilterMedical] = useState<string>("ALL");

  // Apply internal filters to the customers list
  const displayCustomers = useMemo(() => {
    let result = customers;

    if (!showArchived) {
      result = result.filter((c) => c.isActive);
    }

    if (filterDiet !== "ALL") {
      result = result.filter((c) => c.dietary_preference === filterDiet);
    }

    if (filterStatus !== "ALL") {
      result = result.filter((c) => c.status === filterStatus);
    }

    if (filterMedical === "Yes") {
      result = result.filter((c) => c.hasMedicalHistory);
    } else if (filterMedical === "No") {
      result = result.filter((c) => !c.hasMedicalHistory);
    }

    return result;
  }, [customers, showArchived, filterDiet, filterStatus, filterMedical]);

  // Fetch stay info for all visible accommodation customers
  const fetchStayInfo = useCallback(async () => {
    if (displayCustomers.length === 0) {
      setStayInfoMap(new Map());
      return;
    }

    setLoadingStayInfo(true);
    const ids = displayCustomers.map((c) => c.id);
    const result = await getBulkAccommodationStayInfoAction(ids);

    if ("success" in result && result.success) {
      const map = new Map<string, AccommodationCustomerStayInfo>();
      for (const item of result.data) {
        map.set(item.customerProfileId, item);
      }
      setStayInfoMap(map);
    }
    setLoadingStayInfo(false);
  }, [displayCustomers]);

  useEffect(() => {
    fetchStayInfo();
  }, [fetchStayInfo]);

  return (
    <DataTableCard
      header={<SectionHeader title="Accommodation Customers" icon={Home} />}
      controls={
        <div className="flex flex-wrap items-center gap-4">
          <DataSearchFilter
            searchColumn={searchColumn}
            onColumnChange={setSearchColumn}
            searchTerm={searchTerm}
            onTermChange={setSearchTerm}
            options={searchOptions}
          />
          {/* Diet & Allergy Filter */}
          <Select value={filterDiet} onValueChange={setFilterDiet}>
            <SelectTrigger className="w-[160px] border-slate-200 bg-white transition-all duration-200">
              <SelectValue placeholder="Diet & Allergy" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All Diets</SelectItem>
              <SelectItem value="Veg">Veg</SelectItem>
              <SelectItem value="Non-Veg">Non-Veg</SelectItem>
            </SelectContent>
          </Select>
          {/* Status Filter */}
          <Select value={filterStatus} onValueChange={setFilterStatus}>
            <SelectTrigger className="w-[140px] border-slate-200 bg-white transition-all duration-200">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All Status</SelectItem>
              <SelectItem value="Active">Active</SelectItem>
              <SelectItem value="Inactive">Inactive</SelectItem>
            </SelectContent>
          </Select>
          {/* Medical History Filter */}
          <Select value={filterMedical} onValueChange={setFilterMedical}>
            <SelectTrigger className="w-[170px] border-slate-200 bg-white transition-all duration-200">
              <SelectValue placeholder="Medical History" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All Medical</SelectItem>
              <SelectItem value="Yes">Has Medical History</SelectItem>
              <SelectItem value="No">No Medical History</SelectItem>
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
        </div>
      }
      actions={
        <>
          <ExportButton onClick={onExport} disabled={customers.length === 0} />
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
            <TableHead className="text-xs font-medium text-slate-500 uppercase tracking-wider">
              Diet & Allergy
            </TableHead>
            <TableHead className="text-xs font-medium text-slate-500 uppercase tracking-wider">
              Stay Status
            </TableHead>
            <TableHead className="text-xs font-medium text-slate-500 uppercase tracking-wider">
              Stay Type
            </TableHead>
            <TableHead className="text-xs font-medium text-slate-500 uppercase tracking-wider">
              Medical History
            </TableHead>
            <TableHead className="w-[50px] text-xs font-medium text-slate-500 uppercase tracking-wider">
              <span className="sr-only">Actions</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {loadingStayInfo ? (
            <TableRow>
              <TableCell
                colSpan={7}
                className="text-center py-12 text-sm text-slate-500"
              >
                <div className="flex flex-col items-center gap-1.5">
                  <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
                  <span className="text-sm text-slate-500">
                    Loading accommodation customers...
                  </span>
                </div>
              </TableCell>
            </TableRow>
          ) : displayCustomers.length === 0 ? (
            <TableRow>
              <TableCell
                colSpan={7}
                className="text-center py-12 text-sm text-slate-500"
              >
                <div className="flex flex-col items-center gap-1.5">
                  <Home className="h-8 w-8 text-slate-300" />
                  <span className="text-sm font-medium text-slate-700">
                    No accommodation customers found
                  </span>
                  <span className="max-w-md text-xs text-slate-500">
                    No accommodation customers match the current criteria.
                  </span>
                </div>
              </TableCell>
            </TableRow>
          ) : (
            displayCustomers.map((customer) => {
              const stayInfo = stayInfoMap.get(customer.id);

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
                      <Badge className="rounded-full border-0 bg-teal-100 px-2 text-[10px] font-semibold text-teal-700 hover:bg-teal-100">
                        STAY
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
                    {customer.email && customer.email !== "N/A" && (
                      <div className="text-xs text-slate-500 mt-0.5 truncate max-w-[180px]">
                        {customer.email}
                      </div>
                    )}
                  </TableCell>

                  {/* Diet & Allergy */}
                  <TableCell>
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
                    {customer.allergies && (
                      <div className="text-xs text-slate-500 mt-1 truncate max-w-[120px]">
                        {customer.allergies}
                      </div>
                    )}
                  </TableCell>

                  {/* Stay Status */}
                  <TableCell>
                    {getStayStatusBadge(stayInfo?.stayStatus ?? null)}
                  </TableCell>

                  {/* Stay Type */}
                  <TableCell>
                    <span className="text-sm text-slate-700">
                      {stayInfo?.stayType ?? "—"}
                    </span>
                  </TableCell>

                  {/* Medical History */}
                  <TableCell>
                    {customer.hasMedicalHistory ? (
                      <Badge
                        variant="outline"
                        className="rounded-full px-2.5 text-[11px] font-semibold text-blue-700 border-blue-200 bg-blue-50"
                      >
                        Has History
                      </Badge>
                    ) : (
                      <span className="text-xs text-slate-500">None</span>
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
              );
            })
          )}
        </TableBody>
      </Table>
    </DataTableCard>
  );
}
