"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
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
import { Input } from "@/shared/components/ui/input";
import {
  Eye,
  Loader2,
  UserPlus,
  CheckCircle2,
  AlertCircle,
  Truck,
  Filter,
  Calendar,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { DataTableCard } from "../core/DataTableCard";
import { DataSearchFilter, type SearchOption } from "../core/DataSearchFilter";
import { TableColumnFilter } from "../core/TableColumnFilter";
import { TablePagination } from "../core/TablePagination";
import { SectionHeader } from "../core/SectionHeader";
import { StatusBadge } from "../core/StatusBadge";
import { RefreshButton } from "../core/ActionButtons";
import { cn } from "@/lib/utils";
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

/** Search field options for the Onboarded/Completed tables. */
const SEARCH_OPTIONS: SearchOption[] = [
  { value: "name", label: "Name" },
  { value: "mobile", label: "Mobile" },
  { value: "email", label: "Email" },
  { value: "code", label: "Code" },
];

/** Customer_Category → display metadata for the Type column and its filter. */
const CATEGORY_META: Record<string, { label: string; className: string }> = {
  MEAL: { label: "Meal", className: "bg-emerald-100 text-emerald-700" },
  KIT: { label: "Kit", className: "bg-orange-100 text-orange-700" },
  ACCOMMODATION: { label: "Accommodation", className: "bg-sky-100 text-sky-700" },
};

/** Ordered list of the category values a customer can be filtered by. */
const CATEGORY_FILTER_ORDER = ["MEAL", "KIT", "ACCOMMODATION"] as const;

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
 * Convert an ISO timestamp to a local `YYYY-MM-DD` string so it can be compared
 * against the value produced by a native `<input type="date">` (which is also a
 * local calendar date). Returns `null` for missing/invalid input.
 */
function toLocalDateKey(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Admin Customers dashboard section listing customers by Onboarding_Status.
 *
 * Data is loaded on demand via the admin-scoped list Server Actions
 * (`listOnboardedCustomersAction` / `listCompletedCustomersAction`), which apply
 * their own authorization and franchise scoping. Loading, error, and empty
 * states mirror the existing Customer Directory styling (Req 6.9/6.10/6.11,
 * 15.10).
 *
 * Search (by name/mobile/email/code), a specific onboarded-day filter, and a
 * multi-select Type (Meal/Kit/Accommodation) column filter are applied purely
 * client-side over the already-fetched rows.
 */
export function OnboardingCustomersSection({
  status,
}: OnboardingCustomersSectionProps) {
  const config = SECTION_CONFIG[status];
  const [rows, setRows] = useState<CustomerRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // ── Client-side filter state ──────────────────────────────────────────────
  const [searchColumn, setSearchColumn] = useState("name");
  const [searchTerm, setSearchTerm] = useState("");
  const [dateFilter, setDateFilter] = useState(""); // YYYY-MM-DD, "" = all days
  const [typeFilter, setTypeFilter] = useState<string[]>([]); // [] = all types

  // ── Pagination state ──────────────────────────────────────────────────────
  const [currentPage, setCurrentPage] = useState(0);
  const PAGE_SIZE = 20;

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

  // Derived, filtered rows. Recomputed only when the data or a filter changes.
  const filteredRows = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    return rows.filter((row) => {
      // Text search on the selected column
      if (term) {
        const haystack =
          searchColumn === "mobile"
            ? row.mobile
            : searchColumn === "email"
              ? row.email
              : searchColumn === "code"
                ? row.customerCode
                : row.fullName;
        if (!haystack || !haystack.toLowerCase().includes(term)) return false;
      }

      // Specific onboarded-day filter
      if (dateFilter && toLocalDateKey(row.createdAt) !== dateFilter) {
        return false;
      }

      // Multi-select Type filter ([] means no restriction)
      if (typeFilter.length > 0) {
        const category = (row.customerCategory ?? "").toUpperCase();
        if (!typeFilter.includes(category)) return false;
      }

      return true;
    });
  }, [rows, searchColumn, searchTerm, dateFilter, typeFilter]);

  // Reset page to 0 whenever any filter changes
  useEffect(() => {
    setCurrentPage(0);
  }, [searchTerm, dateFilter, typeFilter]);

  // Paginated slice of filteredRows for the current page
  const paginatedRows = useMemo(() => {
    const start = currentPage * PAGE_SIZE;
    return filteredRows.slice(start, start + PAGE_SIZE);
  }, [filteredRows, currentPage, PAGE_SIZE]);

  const hasActiveFilters =
    searchTerm.trim() !== "" || dateFilter !== "" || typeFilter.length > 0;

  const clearFilters = useCallback(() => {
    setSearchTerm("");
    setDateFilter("");
    setTypeFilter([]);
  }, []);

  const COLUMN_COUNT = 6;

  return (
    <DataTableCard
      header={<SectionHeader title={config.title} icon={config.icon} />}
      controls={
        <div className="flex w-full flex-col gap-3 xl:flex-row xl:items-center">
          <DataSearchFilter
            searchColumn={searchColumn}
            onColumnChange={setSearchColumn}
            searchTerm={searchTerm}
            onTermChange={setSearchTerm}
            options={SEARCH_OPTIONS}
          />

          {/* Specific onboarded-day filter */}
          <div className="flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3">
            <Calendar className="h-4 w-4 shrink-0 text-slate-400" />
            <span className="text-xs font-medium uppercase tracking-wider text-slate-500">
              Onboarded on
            </span>
            <Input
              type="date"
              value={dateFilter}
              onChange={(e) => setDateFilter(e.target.value)}
              aria-label="Filter by onboarded date"
              className="h-9 w-[140px] border-0 p-0 shadow-none focus-visible:ring-0"
            />
            {dateFilter && (
              <button
                type="button"
                onClick={() => setDateFilter("")}
                aria-label="Clear date filter"
                className="rounded-full p-0.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          {hasActiveFilters && (
            <Button
              variant="ghost"
              size="sm"
              onClick={clearFilters}
              className="text-slate-500 hover:text-slate-900"
            >
              <X className="mr-1 h-3.5 w-3.5" />
              Clear filters
            </Button>
          )}
        </div>
      }
      actions={<RefreshButton onClick={refresh} isLoading={isLoading} />}
      footer={
        !isLoading && !error && rows.length > 0 && filteredRows.length > 0 ? (
          <TablePagination
            totalRecords={filteredRows.length}
            pageSize={PAGE_SIZE}
            currentPage={currentPage}
            onPageChange={setCurrentPage}
          />
        ) : undefined
      }
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

            {/* Filterable: Type (Meal / Kit / Accommodation) */}
            <TableHead>
              <TableColumnFilter
                mode="multiple"
                title="Type"
                groupLabel="Filter by type"
                values={typeFilter}
                onChange={setTypeFilter}
                options={CATEGORY_FILTER_ORDER.map((value) => ({
                  value,
                  label: CATEGORY_META[value].label,
                }))}
              />
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
              <TableCell colSpan={COLUMN_COUNT} className="py-12 text-center">
                <div className="flex items-center justify-center gap-2 text-sm text-slate-500">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading customers...
                </div>
              </TableCell>
            </TableRow>
          ) : error ? (
            <TableRow>
              <TableCell colSpan={COLUMN_COUNT} className="py-12 text-center">
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
              <TableCell colSpan={COLUMN_COUNT} className="py-12 text-center">
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
          ) : filteredRows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={COLUMN_COUNT} className="py-12 text-center">
                <div className="flex flex-col items-center gap-1.5">
                  <Filter className="h-8 w-8 text-slate-300" />
                  <span className="text-sm font-medium text-slate-700">
                    No customers match your filters
                  </span>
                  <span className="max-w-md text-xs text-slate-500">
                    Try adjusting the search, date, or type filters.
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-2"
                    onClick={clearFilters}
                  >
                    Clear filters
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          ) : (
            paginatedRows.map((row) => {
              const categoryKey = (row.customerCategory ?? "").toUpperCase();
              const categoryMeta = CATEGORY_META[categoryKey];
              return (
                <TableRow
                  key={row.profileId}
                  className="transition-colors duration-200 hover:bg-slate-50"
                >
                  {/* Customer Info */}
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold tracking-tight text-slate-900">
                        {row.fullName || "N/A"}
                      </span>
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

                  {/* Type */}
                  <TableCell>
                    {categoryMeta ? (
                      <Badge
                        className={cn(
                          "rounded-full border-0 px-2.5 text-[11px] font-semibold",
                          categoryMeta.className,
                        )}
                      >
                        {categoryMeta.label}
                      </Badge>
                    ) : (
                      <span className="text-sm text-slate-400">—</span>
                    )}
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
                        row.onboardingStatus === "COMPLETED"
                          ? "solid"
                          : "outline"
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
                    <div className="flex items-center gap-1">
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
                      {row.customerCategory === "KIT" && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 transition-all duration-200 hover:bg-slate-100"
                          asChild
                        >
                          <Link href={`/customers/${row.profileId}?tab=Shipping`}>
                            <Truck className="mr-1.5 h-4 w-4 text-primary" />
                            Shipping
                          </Link>
                        </Button>
                      )}
                    </div>
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
