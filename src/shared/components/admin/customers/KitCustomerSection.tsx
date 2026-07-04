"use client";

import { useEffect, useState, useCallback } from "react";
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
import { StatusBadge } from "../core/StatusBadge";
import { ExportButton, RefreshButton } from "../core/ActionButtons";
import {
  getBulkKitShippingStatusAction,
  type KitCustomerShippingStatus,
} from "@/actions/admin-actions/kitCustomerShippingActions";
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
}: KitCustomerSectionProps) {
  const [shippingStatuses, setShippingStatuses] = useState<
    Map<string, KitCustomerShippingStatus>
  >(new Map());
  const [loadingShipping, setLoadingShipping] = useState(false);

  // Fetch shipping statuses for all visible KIT customers
  const fetchShippingStatuses = useCallback(async () => {
    if (customers.length === 0) {
      setShippingStatuses(new Map());
      return;
    }

    setLoadingShipping(true);
    const ids = customers.map((c) => c.id);
    const result = await getBulkKitShippingStatusAction(ids);

    if (result.success) {
      const map = new Map<string, KitCustomerShippingStatus>();
      for (const item of result.data) {
        map.set(item.customerProfileId, item);
      }
      setShippingStatuses(map);
    }
    setLoadingShipping(false);
  }, [customers]);

  useEffect(() => {
    fetchShippingStatuses();
  }, [fetchShippingStatuses]);

  return (
    <DataTableCard
      header={<SectionHeader title="KIT Customers" icon={Package} />}
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
              Status
            </TableHead>
            <TableHead className="text-xs font-medium text-slate-500 uppercase tracking-wider">
              Clinic
            </TableHead>
            <TableHead className="text-xs font-medium text-slate-500 uppercase tracking-wider">
              Shipment Status
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
                colSpan={6}
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
            customers.map((customer) => {
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
                    <div className="text-sm text-slate-500 mt-0.5">
                      {customer.email}
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
