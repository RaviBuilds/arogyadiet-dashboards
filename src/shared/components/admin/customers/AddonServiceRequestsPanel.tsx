"use client";

// src/shared/components/admin/customers/AddonServiceRequestsPanel.tsx
//
// Add-on wellness service requests raised by accommodation customers, listed
// for the admin who owns the Accommodation Customers tab.
//
// Scope note: this panel is rendered ONLY from AccommodationCustomerSection,
// which exists ONLY on the core-business admin Customers page. The franchise
// portal has its own customer dashboard with no accommodation tab, so franchise
// users never reach this surface. It reads requests for exactly the customer
// rows the tab is already showing, so the franchise/core selector above the
// tab scopes it for free.

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { format } from "date-fns";
import { Sparkles, Loader2, CheckCircle2, Check } from "lucide-react";
import { toast } from "sonner";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/shared/components/ui/table";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { cn } from "@/lib/utils";

import { DataTableCard } from "../core/DataTableCard";
import { SectionHeader } from "../core/SectionHeader";
import { RefreshButton } from "../core/ActionButtons";
import {
  getAccommodationAddonRequestsAction,
  type AccommodationAddonRequest,
} from "@/actions/admin-actions/accommodationCustomerActions";
import { updateAddonServiceStatusAction } from "@/actions/addonServiceActions";

/** Display labels for the requestable service types (mirrors the customer UI). */
const SERVICE_TYPE_LABELS: Record<string, string> = {
  THERAPY: "Therapy Session",
  MASSAGE: "Ayurvedic Massage",
  YOGA: "Private Yoga Session",
};

const STATUS_STYLES: Record<AccommodationAddonRequest["status"], string> = {
  PENDING: "bg-amber-50 text-amber-700 border-amber-200",
  CONFIRMED: "bg-blue-50 text-blue-700 border-blue-200",
  COMPLETED: "bg-emerald-50 text-emerald-700 border-emerald-200",
};

interface AddonServiceRequestsPanelProps {
  /** The accommodation customers currently visible on the tab. */
  customers: { id: string; fullName: string }[];
  /** Hides the Confirm / Mark completed controls for a read-only Dietitian. */
  isDietitian?: boolean;
}

export function AddonServiceRequestsPanel({
  customers,
  isDietitian = false,
}: AddonServiceRequestsPanelProps) {
  const [requests, setRequests] = useState<AccommodationAddonRequest[]>([]);
  const [loading, setLoading] = useState(false);
  const [showCompleted, setShowCompleted] = useState(false);
  const [isPending, startTransition] = useTransition();

  const customerIds = useMemo(
    () => customers.map((customer) => customer.id),
    [customers],
  );

  const nameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const customer of customers) map.set(customer.id, customer.fullName);
    return map;
  }, [customers]);

  // `customerIds.join` keeps the effect keyed on the ID set rather than the
  // array identity, so re-renders of the parent do not refetch.
  const idsKey = customerIds.join(",");

  const fetchRequests = useCallback(async () => {
    if (customerIds.length === 0) {
      setRequests([]);
      return;
    }

    setLoading(true);
    try {
      const result = await getAccommodationAddonRequestsAction(customerIds);
      setRequests("success" in result && result.success ? result.data : []);
    } catch (err) {
      console.error("Failed to load add-on service requests:", err);
      setRequests([]);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey]);

  useEffect(() => {
    void fetchRequests();
  }, [fetchRequests]);

  const openRequests = useMemo(
    () => requests.filter((request) => request.status !== "COMPLETED"),
    [requests],
  );

  const visibleRequests = showCompleted ? requests : openRequests;

  const handleStatusChange = (
    request: AccommodationAddonRequest,
    status: "CONFIRMED" | "COMPLETED",
  ) => {
    startTransition(async () => {
      const result = await updateAddonServiceStatusAction(request.id, status);

      if ("error" in result) {
        toast.error(result.error);
        return;
      }

      toast.success(
        status === "CONFIRMED"
          ? "Request confirmed. The customer now sees it as CONFIRMED."
          : "Request marked completed.",
      );
      setRequests((prev) =>
        prev.map((row) => (row.id === request.id ? { ...row, status } : row)),
      );
    });
  };

  return (
    <DataTableCard
      header={
        <SectionHeader
          title="Add-on Service Requests"
          icon={Sparkles}
          action={
            openRequests.length > 0 ? (
              <Badge className="rounded-full border-0 bg-amber-100 px-2.5 text-[11px] font-semibold text-amber-700 hover:bg-amber-100">
                {openRequests.length} open
              </Badge>
            ) : null
          }
        />
      }
      controls={
        <Button
          type="button"
          variant={showCompleted ? "default" : "outline"}
          size="sm"
          className="transition-all duration-200"
          onClick={() => setShowCompleted(!showCompleted)}
        >
          {showCompleted ? "Showing Completed" : "Show Completed"}
        </Button>
      }
      actions={<RefreshButton onClick={fetchRequests} isLoading={loading} />}
    >
      <Table>
        <TableHeader>
          <TableRow className="border-b border-slate-200 bg-slate-50/50">
            <TableHead className="text-xs font-medium uppercase tracking-wider text-slate-500">
              Customer
            </TableHead>
            <TableHead className="text-xs font-medium uppercase tracking-wider text-slate-500">
              Service
            </TableHead>
            <TableHead className="text-xs font-medium uppercase tracking-wider text-slate-500">
              Requested
            </TableHead>
            <TableHead className="text-xs font-medium uppercase tracking-wider text-slate-500">
              Status
            </TableHead>
            <TableHead className="text-right text-xs font-medium uppercase tracking-wider text-slate-500">
              {isDietitian ? <span className="sr-only">Actions</span> : "Action"}
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {loading ? (
            <TableRow>
              <TableCell colSpan={5} className="py-10 text-center text-sm text-slate-500">
                <div className="flex flex-col items-center gap-1.5">
                  <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
                  <span>Loading add-on service requests...</span>
                </div>
              </TableCell>
            </TableRow>
          ) : visibleRequests.length === 0 ? (
            <TableRow>
              <TableCell colSpan={5} className="py-10 text-center text-sm text-slate-500">
                <div className="flex flex-col items-center gap-1.5">
                  <CheckCircle2 className="h-7 w-7 text-slate-300" />
                  <span className="text-sm font-medium text-slate-700">
                    No add-on service requests
                  </span>
                  <span className="max-w-md text-xs text-slate-500">
                    {showCompleted
                      ? "Accommodation customers have not requested any wellness services yet."
                      : "Nothing pending. Enable Show Completed to see past requests."}
                  </span>
                </div>
              </TableCell>
            </TableRow>
          ) : (
            visibleRequests.map((request) => (
              <TableRow
                key={request.id}
                className="transition-colors duration-200 hover:bg-slate-50"
              >
                <TableCell className="font-semibold tracking-tight text-slate-900">
                  {nameById.get(request.customerProfileId) ?? "Customer"}
                </TableCell>
                <TableCell className="text-sm text-slate-700">
                  {SERVICE_TYPE_LABELS[request.serviceType] ?? request.serviceType}
                </TableCell>
                <TableCell className="text-sm text-slate-600">
                  {format(new Date(request.requestedAt), "dd MMM yyyy, hh:mm a")}
                </TableCell>
                <TableCell>
                  <Badge
                    variant="outline"
                    className={cn(
                      "w-fit rounded-full px-2.5 text-[11px] font-semibold shadow-none",
                      STATUS_STYLES[request.status],
                    )}
                  >
                    {request.status}
                  </Badge>
                </TableCell>
                <TableCell className="text-right">
                  {isDietitian || request.status === "COMPLETED" ? (
                    <span className="text-xs text-slate-400">—</span>
                  ) : (
                    <Button
                      size="sm"
                      variant={request.status === "PENDING" ? "default" : "outline"}
                      className="gap-1.5 transition-all duration-200"
                      disabled={isPending}
                      onClick={() =>
                        handleStatusChange(
                          request,
                          request.status === "PENDING" ? "CONFIRMED" : "COMPLETED",
                        )
                      }
                    >
                      <Check className="h-3.5 w-3.5" />
                      {request.status === "PENDING" ? "Confirm" : "Mark Completed"}
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </DataTableCard>
  );
}
