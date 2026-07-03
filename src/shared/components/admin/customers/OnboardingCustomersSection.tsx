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
import { Eye, Loader2, UserPlus, CheckCircle2, AlertCircle } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { DataTableCard } from "../core/DataTableCard";
import { SectionHeader } from "../core/SectionHeader";
import { StatusBadge } from "../core/StatusBadge";
import { RefreshButton } from "../core/ActionButtons";
import {
  listOnboardedCustomersAction,
  listCompletedCustomersAction,
  type ListCustomersActionResult,
} from "@/actions/admin-actions/onboardingActions";
import type { CustomerRow } from "@/repositories/customerOnboardingRepository";

type OnboardingSectionStatus = "IN_PROGRESS" | "COMPLETED";

interface OnboardingCustomersSectionProps {
  /** Which onboarding lifecycle bucket to render (Req 6.9/6.10). */
  status: OnboardingSectionStatus;
}

/** Per-status presentation config so both sections share one implementation. */
const SECTION_CONFIG: Record<
  OnboardingSectionStatus,
  {
    title: string;
    icon: LucideIcon;
    emptyTitle: string;
    emptyHint: string;
    fetch: () => Promise<ListCustomersActionResult>;
  }
> = {
  IN_PROGRESS: {
    title: "Onboarded Customers",
    icon: UserPlus,
    emptyTitle: "No onboarded customers yet",
    emptyHint:
      "Customers created through Quick Onboarding appear here until they finish their profile.",
    fetch: listOnboardedCustomersAction,
  },
  COMPLETED: {
    title: "Onboarding Completed",
    icon: CheckCircle2,
    emptyTitle: "No completed onboardings yet",
    emptyHint:
      "Customers move here once they mark their onboarding as completed.",
    fetch: listCompletedCustomersAction,
  },
};

/** Format an ISO timestamp for the "Onboarded on" column, tolerating nulls. */
function formatDate(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

/**
 * Admin Customers dashboard section listing customers by Onboarding_Status.
 *
 * Data is loaded on demand via the admin-scoped list Server Actions
 * (`listOnboardedCustomersAction` / `listCompletedCustomersAction`), which apply
 * their own authorization and franchise scoping. Loading, error, and empty
 * states mirror the existing Customer Directory styling (Req 6.9/6.10/6.11,
 * 15.10).
 */
export function OnboardingCustomersSection({
  status,
}: OnboardingCustomersSectionProps) {
  const config = SECTION_CONFIG[status];
  const [rows, setRows] = useState<CustomerRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const applyResult = useCallback((result: ListCustomersActionResult) => {
    if (result.success) {
      setRows(result.customers);
      setError(null);
    } else {
      setError(result.error);
      setRows([]);
    }
    setIsLoading(false);
  }, []);

  // Initial load. Each tab mounts a fresh instance (isLoading defaults to true),
  // so the spinner shows without a synchronous setState inside the effect.
  useEffect(() => {
    let cancelled = false;
    config.fetch().then((result) => {
      if (!cancelled) applyResult(result);
    });
    return () => {
      cancelled = true;
    };
  }, [config, applyResult]);

  // Manual refresh (event handler, not an effect) — safe to toggle loading.
  const refresh = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    const result = await config.fetch();
    applyResult(result);
  }, [config, applyResult]);

  return (
    <DataTableCard
      header={<SectionHeader title={config.title} icon={config.icon} />}
      actions={<RefreshButton onClick={refresh} isLoading={isLoading} />}
    >
      <Table>
        <TableHeader>
          <TableRow className="border-b border-slate-200 bg-slate-50/50">
            <TableHead className="text-xs font-medium uppercase tracking-wider text-slate-500">
              Customer Info
            </TableHead>
            <TableHead className="text-xs font-medium uppercase tracking-wider text-slate-500">
              Contact
            </TableHead>
            <TableHead className="text-xs font-medium uppercase tracking-wider text-slate-500">
              Status
            </TableHead>
            <TableHead className="text-xs font-medium uppercase tracking-wider text-slate-500">
              Onboarded On
            </TableHead>
            <TableHead className="w-[50px] text-xs font-medium uppercase tracking-wider text-slate-500">
              <span className="sr-only">Actions</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {isLoading ? (
            <TableRow>
              <TableCell colSpan={5} className="py-12 text-center">
                <div className="flex items-center justify-center gap-2 text-sm text-slate-500">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading customers...
                </div>
              </TableCell>
            </TableRow>
          ) : error ? (
            <TableRow>
              <TableCell colSpan={5} className="py-12 text-center">
                <div className="flex flex-col items-center gap-2 text-sm text-red-600">
                  <AlertCircle className="h-6 w-6" />
                  <span className="font-medium">Could not load customers</span>
                  <span className="text-slate-500">{error}</span>
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-2"
                    onClick={refresh}
                  >
                    Try again
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          ) : rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={5} className="py-12 text-center">
                <div className="flex flex-col items-center gap-1.5">
                  <config.icon className="h-8 w-8 text-slate-300" />
                  <span className="text-sm font-medium text-slate-700">
                    {config.emptyTitle}
                  </span>
                  <span className="max-w-md text-xs text-slate-500">
                    {config.emptyHint}
                  </span>
                </div>
              </TableCell>
            </TableRow>
          ) : (
            rows.map((row) => (
              <TableRow
                key={row.profileId}
                className="transition-colors duration-200 hover:bg-slate-50"
              >
                {/* Customer Info */}
                <TableCell>
                  <div className="font-semibold tracking-tight text-slate-900">
                    {row.fullName || "N/A"}
                  </div>
                  <div className="mt-0.5 text-xs text-slate-500">
                    {row.customerCode || "No code"}
                  </div>
                </TableCell>

                {/* Contact */}
                <TableCell>
                  <div className="font-medium text-slate-900">
                    {row.mobile || "N/A"}
                  </div>
                  <div className="mt-0.5 text-sm text-slate-500">
                    {row.isTestEmail ? (
                      <Badge
                        variant="outline"
                        className="rounded-full border-slate-200 bg-slate-50 px-2 text-[10px] text-slate-400"
                      >
                        Placeholder email
                      </Badge>
                    ) : (
                      row.email || "N/A"
                    )}
                  </div>
                </TableCell>

                {/* Status */}
                <TableCell>
                  <StatusBadge
                    status={
                      row.onboardingStatus === "COMPLETED"
                        ? "Completed"
                        : "In Progress"
                    }
                    variant={
                      row.onboardingStatus === "COMPLETED" ? "solid" : "outline"
                    }
                  />
                </TableCell>

                {/* Onboarded On */}
                <TableCell>
                  <span className="text-sm text-slate-600">
                    {formatDate(row.createdAt)}
                  </span>
                </TableCell>

                {/* Actions */}
                <TableCell>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 transition-all duration-200 hover:bg-slate-100"
                    asChild
                  >
                    <Link href={`/customers/${row.profileId}`}>
                      <Eye className="mr-1.5 h-4 w-4 text-primary" />
                      View
                    </Link>
                  </Button>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </DataTableCard>
  );
}
