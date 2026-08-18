"use client";

// src/shared/components/admin/customers/PartialPaymentSection.tsx
//
// Admin Customers → "Partial Payment": the collections board for customers who
// onboarded against an ADVANCE and still owe a balance, spanning MEAL
// subscriptions and ACCOMMODATION stays in one list.
//
// Renders the same 9-column spine, toolbar and pagination as the Meal / KIT /
// Accommodation directories (see CustomerTableCells.tsx), with the
// category-specific slots given over to money: column 5 is Total / Advance,
// column 6 is the outstanding Balance, column 7 expands into the full payment
// breakup.
//
// ── Two things this component deliberately does NOT do ───────────────────────
//
// 1. It does not own the membership rule. Which entities owe money is decided by
//    `getPartialPaymentBalancesAction`, which is where the ledger-existence gate
//    and the strictly-positive balance test live. See the header of
//    `src/types/partialPayment.ts` for why both matter.
// 2. It does not record payments. Money is collected through the audited RPC
//    paths on Customer 360 (`?tab=Accommodation` → StayPaymentPanel,
//    `?tab=Subscription` → SubscriptionPaymentSummaryCard), so every row links
//    out rather than mutating here. A second write surface for balances would be
//    a second place for the balance to go wrong.

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import * as XLSX from "xlsx";
import { toast } from "sonner";

import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/shared/components/ui/table";
import {
  ArrowDown,
  ArrowUp,
  Building2,
  ChevronDown,
  ChevronRight,
  Eye,
  IndianRupee,
  Wallet,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ALL_CLINICS, type ClinicFilterSelection } from "@/lib/clinic/visibility";

import { DataTableCard } from "../core/DataTableCard";
import { SectionHeader } from "../core/SectionHeader";
import { DataSearchFilter } from "../core/DataSearchFilter";
import { TableColumnFilter } from "../core/TableColumnFilter";
import { TablePagination } from "../core/TablePagination";
import { ExportButton, RefreshButton } from "../core/ActionButtons";
import { getPartialPaymentBalancesAction } from "@/actions/admin-actions/partialPaymentActions";
import type {
  PartialPaymentBalance,
  PartialPaymentRow,
  PartialPaymentSort,
  PartialPaymentTypeFilter,
} from "@/types/partialPayment";
import type { CustomerData } from "./CustomerDashboard";
import {
  ContactCell,
  CustomerInfoCell,
  DateRangeLine,
  LocationCell,
  TableEmptyRow,
  TableLoadingRow,
  EMPTY,
  FILTER_ALL,
  formatDate,
  CUSTOMER_TABLE_SCROLL_CONTAINER,
  CUSTOMER_TABLE_STICKY_HEADER,
} from "./CustomerTableCells";

const PAGE_SIZE = 20;

/** This table's own spine width/colspan — 9 columns, but money-heavy ones. */
const COLSPAN = 9;
const MIN_WIDTH = "min-w-[1460px]";

interface PartialPaymentSectionProps {
  /**
   * The dashboard's already-scoped customer directory. Balances are joined onto
   * THIS list, which is how the board inherits the page's franchise, clinic and
   * dietitian scoping — a customer not present here cannot be rendered.
   */
  customers: CustomerData[];
  clinicFilter: ClinicFilterSelection;
  setClinicFilter: (val: ClinicFilterSelection) => void;
  clinicOptions: { id: string; name: string }[];
  /** Set for a Clinic_Scoped_Admin: renders a static label, not a dropdown. */
  lockedClinicName?: string | null;
  searchColumn: string;
  setSearchColumn: (val: string) => void;
  searchTerm: string;
  setSearchTerm: (val: string) => void;
  searchOptions: { value: string; label: string }[];
  /** Removes the mutating Excel export for a Dietitian (Req 16.1). */
  isDietitian?: boolean;
}

// ─── Money + date formatting ──────────────────────────────────────────────────

/** `₹53,100` — Indian grouping, no decimals unless there are paise. */
function rupees(amount: number): string {
  return `₹${amount.toLocaleString("en-IN", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })}`;
}

/** Whole days from today to `iso`; negative when it has already passed. */
function daysUntil(iso: string | null): number | null {
  if (!iso) return null;
  const target = new Date(iso);
  if (Number.isNaN(target.getTime())) return null;
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  target.setHours(0, 0, 0, 0);
  return Math.round(
    (target.getTime() - startOfToday.getTime()) / (24 * 60 * 60 * 1000),
  );
}

/**
 * Balance severity, used only for colour. Thresholds are presentational — the
 * figure itself is always shown in full, so a band can never hide an amount.
 */
function balanceTone(amount: number): string {
  if (amount >= 25000) return "text-rose-700";
  if (amount >= 10000) return "text-orange-600";
  return "text-amber-600";
}

const TRANSACTION_LABEL: Record<string, string> = {
  ADVANCE: "Advance",
  PARTIAL_BALANCE_PAYMENT: "Instalment",
  REFUND: "Refund",
};

/**
 * Deep link to the audited payment surface for this row's domain. The two
 * Customer 360 tab names are the ones that dashboard accepts in its `?tab=`
 * allow-list, so a link that stops matching fails loudly (lands on the default
 * tab) rather than silently rendering the wrong panel.
 */
function paymentHref(row: PartialPaymentRow): string {
  return row.source === "STAY"
    ? `/customers/${row.customer.id}?tab=Accommodation`
    : `/customers/${row.customer.id}?tab=Subscription`;
}

// ─── Due-date badge ───────────────────────────────────────────────────────────

function DueBadge({ dueDate }: { dueDate: string | null }) {
  const days = daysUntil(dueDate);
  if (days === null) {
    return (
      <Badge
        variant="outline"
        className="w-fit rounded-full border-slate-200 bg-slate-50 px-2 text-[10px] font-semibold text-slate-500"
      >
        No date
      </Badge>
    );
  }
  if (days < 0) {
    return (
      <Badge className="w-fit rounded-full border-0 bg-rose-100 px-2 text-[10px] font-semibold text-rose-700 hover:bg-rose-100">
        Overdue by {Math.abs(days)}d
      </Badge>
    );
  }
  if (days === 0) {
    return (
      <Badge className="w-fit rounded-full border-0 bg-rose-100 px-2 text-[10px] font-semibold text-rose-700 hover:bg-rose-100">
        Due today
      </Badge>
    );
  }
  return (
    <Badge
      className={cn(
        "w-fit rounded-full border-0 px-2 text-[10px] font-semibold",
        days <= 5
          ? "bg-amber-100 text-amber-700 hover:bg-amber-100"
          : "bg-slate-100 text-slate-600 hover:bg-slate-100",
      )}
    >
      in {days}d
    </Badge>
  );
}

// ─── KPI strip ────────────────────────────────────────────────────────────────

function KpiTile({
  label,
  value,
  hint,
  tone = "slate",
}: {
  label: string;
  value: string;
  hint: string;
  tone?: "slate" | "rose" | "amber";
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p
        className={cn(
          "mt-1 text-2xl font-semibold tracking-tight",
          tone === "rose"
            ? "text-rose-700"
            : tone === "amber"
              ? "text-amber-600"
              : "text-slate-900",
        )}
      >
        {value}
      </p>
      <p className="mt-0.5 text-xs text-slate-500">{hint}</p>
    </div>
  );
}

// ─── Section ──────────────────────────────────────────────────────────────────

export function PartialPaymentSection({
  customers,
  clinicFilter,
  setClinicFilter,
  clinicOptions,
  lockedClinicName = null,
  searchColumn,
  setSearchColumn,
  searchTerm,
  setSearchTerm,
  searchOptions,
  isDietitian = false,
}: PartialPaymentSectionProps) {
  const [balances, setBalances] = useState<PartialPaymentBalance[]>([]);
  const [loading, setLoading] = useState(true);

  const [typeFilter, setTypeFilter] = useState<PartialPaymentTypeFilter>("ALL");
  const [statusFilter, setStatusFilter] = useState(FILTER_ALL);
  const [dueInDays, setDueInDays] = useState<number | null>(null);
  const [sort, setSort] = useState<PartialPaymentSort>("BALANCE_DESC");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [currentPage, setCurrentPage] = useState(0);

  /**
   * customer_profiles.id → directory row, for joining balances onto the scoped
   * customer list. Rebuilt whenever the dashboard's scope changes, so switching
   * the "View Data For" selector re-narrows this board without a refetch.
   */
  const customerById = useMemo(() => {
    const map = new Map<string, CustomerData>();
    for (const customer of customers) map.set(customer.id, customer);
    return map;
  }, [customers]);

  const loadBalances = useCallback(async () => {
    setLoading(true);
    const result = await getPartialPaymentBalancesAction();
    if ("error" in result) {
      toast.error(`Could not load balances: ${result.error}`);
      setBalances([]);
    } else {
      setBalances(result.data);
    }
    setLoading(false);
    // No dependency on `customerById`: scoping is applied by the join in
    // `joinedRows`, which recomputes on every scope change. Depending on it here
    // would refetch the same balances every time the franchise selector moved.
  }, []);

  useEffect(() => {
    loadBalances();
  }, [loadBalances]);

  /**
   * Resolve each balance to the customer it belongs to. The two domains resolve
   * differently, and that difference IS the visibility rule:
   *
   *   MEAL   must be present in the dashboard's directory. That directory is
   *          already clinic-, franchise- and dietitian-scoped by the page, so
   *          requiring the join is what confines a Clinic_Scoped_Admin to their
   *          own clinic's meal dues without restating any of those rules here.
   *
   *   STAY   resolved from the action's snapshot, so it renders for every admin.
   *          It CANNOT use the join: every accommodation customer has
   *          `clinic_id = NULL`, so they are absent from a clinic-scoped admin's
   *          directory entirely and every row would silently vanish.
   *
   * A Dietitian is the one exception: their workspace is a strict read-scope
   * (Req 5.5–5.7), so accommodation rows must clear the join for them too rather
   * than bypassing it.
   */
  const joinedRows = useMemo<PartialPaymentRow[]>(() => {
    const rows: PartialPaymentRow[] = [];
    for (const balance of balances) {
      const directoryRow = customerById.get(balance.customerProfileId);
      const bypassesDirectory = balance.source === "STAY" && !isDietitian;

      if (!directoryRow && !bypassesDirectory) continue;

      rows.push({
        ...balance,
        customer: directoryRow ?? balance.customerSnapshot,
      });
    }
    return rows;
  }, [balances, customerById, isDietitian]);

  const displayRows = useMemo(() => {
    let result = joinedRows;

    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      result = result.filter((row) => {
        const c = row.customer;
        if (searchColumn === "mobile") return c.mobile.toLowerCase().includes(term);
        if (searchColumn === "email") return c.email.toLowerCase().includes(term);
        if (searchColumn === "primary_pincode")
          return c.primary_pincode.toLowerCase().includes(term);
        return c.fullName.toLowerCase().includes(term);
      });
    }

    // The clinic filter narrows MEAL rows only. Accommodation is a single shared
    // property with no clinic attribution at all (`clinic_id` is NULL on every
    // accommodation customer), so filtering it by clinic would just empty the
    // domain out rather than narrowing it. Use the Type filter to isolate meal.
    if (clinicFilter && clinicFilter !== ALL_CLINICS) {
      result = result.filter(
        (row) =>
          row.source === "STAY" || row.customer.clinic_id === clinicFilter,
      );
    }

    if (typeFilter !== "ALL") {
      result = result.filter((row) => row.source === typeFilter);
    }

    if (statusFilter !== FILTER_ALL) {
      result = result.filter((row) => row.entityStatus === statusFilter);
    }

    // "Ending soon" = the plan end / checkout date falls within the window.
    // Overdue rows are deliberately INCLUDED: a balance whose due date has
    // already passed is more urgent than one approaching it, so hiding it behind
    // a narrower window would bury exactly the rows that need chasing.
    if (dueInDays !== null) {
      result = result.filter((row) => {
        const days = daysUntil(row.dueDate);
        return days !== null && days <= dueInDays;
      });
    }

    const sorted = [...result];
    sorted.sort((a, b) => {
      switch (sort) {
        case "BALANCE_ASC":
          return a.remainingBalance - b.remainingBalance;
        case "DUE_SOONEST": {
          const da = daysUntil(a.dueDate);
          const db = daysUntil(b.dueDate);
          if (da === null) return 1;
          if (db === null) return -1;
          return da - db;
        }
        case "LAST_PAID":
          return (b.lastPaymentDate ?? "").localeCompare(a.lastPaymentDate ?? "");
        case "BALANCE_DESC":
        default:
          return b.remainingBalance - a.remainingBalance;
      }
    });
    return sorted;
  }, [
    joinedRows,
    searchTerm,
    searchColumn,
    clinicFilter,
    typeFilter,
    statusFilter,
    dueInDays,
    sort,
  ]);

  // Send the reader back to page 1 whenever the filter set changes, otherwise a
  // narrower result set can leave them stranded on a now-empty page. Adjusted
  // during render rather than in an effect — the pattern React recommends for
  // resetting state in response to changing inputs.
  const filterKey = [
    searchTerm,
    searchColumn,
    clinicFilter ?? "",
    typeFilter,
    statusFilter,
    String(dueInDays),
    sort,
  ].join("|");
  const [prevFilterKey, setPrevFilterKey] = useState(filterKey);
  if (prevFilterKey !== filterKey) {
    setPrevFilterKey(filterKey);
    setCurrentPage(0);
  }

  const paginatedRows = useMemo(() => {
    const start = currentPage * PAGE_SIZE;
    return displayRows.slice(start, start + PAGE_SIZE);
  }, [displayRows, currentPage]);

  // KPIs describe the CURRENTLY FILTERED set, so they always reconcile with the
  // rows on screen rather than reporting a hidden global total.
  const kpis = useMemo(() => {
    const total = displayRows.reduce((sum, row) => sum + row.remainingBalance, 0);
    const dueSoon = displayRows.filter((row) => {
      const days = daysUntil(row.dueDate);
      return days !== null && days <= 5;
    }).length;
    const highest = displayRows.reduce(
      (max, row) => Math.max(max, row.remainingBalance),
      0,
    );
    return {
      count: displayRows.length,
      total,
      dueSoon,
      highest,
      customers: new Set(displayRows.map((row) => row.customer.id)).size,
    };
  }, [displayRows]);

  /** Distinct entity statuses present, for the column 8 filter. */
  const statusOptions = useMemo(() => {
    const set = new Set(joinedRows.map((row) => row.entityStatus));
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [joinedRows]);

  const toggleExpanded = (entityId: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(entityId)) next.delete(entityId);
      else next.add(entityId);
      return next;
    });
  };

  /**
   * Two sheets, because one row per payment and one row per customer answer
   * different questions: "Balances" is the collections worklist, "Payment
   * Breakup" is the audit trail behind it.
   */
  const handleExport = () => {
    if (displayRows.length === 0) return;

    const summary = displayRows.map((row) => ({
      Customer: row.customer.fullName,
      Mobile: row.customer.mobile,
      Email: row.customer.email,
      Type: row.source === "STAY" ? "Accommodation" : "Meal",
      "Plan / Unit": row.entityLabel ?? "",
      Clinic: row.customer.clinicName ?? "Unassigned",
      Status: row.entityStatus,
      "Total Amount": row.totalAmount,
      "Advance Paid": row.advanceAmount,
      "Advance Date": formatDate(row.advanceDate) ?? "",
      "Total Paid": row.totalPaid,
      "Balance Left": row.remainingBalance,
      Instalments: row.instalmentCount,
      "Last Payment Date": formatDate(row.lastPaymentDate) ?? "",
      "Plan End / Checkout": formatDate(row.dueDate) ?? "",
      "Days To Due": daysUntil(row.dueDate) ?? "",
    }));

    const breakup = displayRows.flatMap((row) =>
      row.breakup.map((entry, index) => ({
        Customer: row.customer.fullName,
        Mobile: row.customer.mobile,
        Type: row.source === "STAY" ? "Accommodation" : "Meal",
        "Payment #": index + 1,
        Kind: TRANSACTION_LABEL[entry.transactionType] ?? entry.transactionType,
        Amount: entry.amount,
        Date: formatDate(entry.transactionDate) ?? "",
        Method: entry.paymentMethod ?? "",
        Comment: entry.comment ?? "",
        Remark: entry.remark ?? "",
      })),
    );

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(summary),
      "Balances",
    );
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(breakup),
      "Payment Breakup",
    );
    XLSX.writeFile(
      wb,
      `PartialPayment_${new Date().toISOString().split("T")[0]}.xlsx`,
    );
    toast.success("Partial payment report exported");
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiTile
          label="Outstanding Balances"
          value={String(kpis.count)}
          hint={`${kpis.customers} customer${kpis.customers === 1 ? "" : "s"}`}
        />
        <KpiTile
          label="Total Amount Pending"
          value={rupees(kpis.total)}
          hint="Sum of balances in view"
          tone="rose"
        />
        <KpiTile
          label="Ending Within 5 Days"
          value={String(kpis.dueSoon)}
          hint="Plan end / checkout near, balance unpaid"
          tone="amber"
        />
        <KpiTile
          label="Highest Single Balance"
          value={rupees(kpis.highest)}
          hint="Largest amount owed by one entity"
        />
      </div>

      <DataTableCard
        header={
          <SectionHeader
            title="Partial Payment Customers"
            icon={Wallet}
            description={
              lockedClinicName
                ? `Customers who paid an advance and still owe a balance. Meal dues are limited to ${lockedClinicName}; accommodation dues are shown for the whole property. A customer drops off this list the moment their balance reaches zero.`
                : "Meal and accommodation customers who paid an advance and still owe a balance. The clinic filter narrows meal rows only — accommodation is one shared property with no clinic attribution. A customer drops off this list the moment their balance reaches zero."
            }
          />
        }
        footer={
          displayRows.length > 0 ? (
            <TablePagination
              totalRecords={displayRows.length}
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
            <Select
              value={typeFilter}
              onValueChange={(val) =>
                setTypeFilter(val as PartialPaymentTypeFilter)
              }
            >
              <SelectTrigger className="w-[170px] border-slate-200 bg-white transition-all duration-200">
                <SelectValue placeholder="Type..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All Types</SelectItem>
                <SelectItem value="MEAL">Meal Only</SelectItem>
                <SelectItem value="STAY">Accommodation Only</SelectItem>
              </SelectContent>
            </Select>
            <Select
              value={dueInDays === null ? "ALL" : String(dueInDays)}
              onValueChange={(val) =>
                setDueInDays(val === "ALL" ? null : Number(val))
              }
            >
              <SelectTrigger className="w-[185px] border-slate-200 bg-white transition-all duration-200">
                <SelectValue placeholder="Ending in..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All Due Dates</SelectItem>
                <SelectItem value="0">Overdue / due today</SelectItem>
                <SelectItem value="2">Ending in 2 days</SelectItem>
                <SelectItem value="5">Ending in 5 days</SelectItem>
                <SelectItem value="10">Ending in 10 days</SelectItem>
                <SelectItem value="15">Ending in 15 days</SelectItem>
              </SelectContent>
            </Select>
            <Select
              value={sort}
              onValueChange={(val) => setSort(val as PartialPaymentSort)}
            >
              <SelectTrigger className="w-[210px] border-slate-200 bg-white transition-all duration-200">
                <SelectValue placeholder="Sort by..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="BALANCE_DESC">Balance: High to Low</SelectItem>
                <SelectItem value="BALANCE_ASC">Balance: Low to High</SelectItem>
                <SelectItem value="DUE_SOONEST">Due Date: Soonest</SelectItem>
                <SelectItem value="LAST_PAID">Last Payment: Recent</SelectItem>
              </SelectContent>
            </Select>
          </div>
        }
        actions={
          <>
            {!isDietitian && (
              <ExportButton
                onClick={handleExport}
                disabled={displayRows.length === 0}
              />
            )}
            <RefreshButton onClick={loadBalances} isLoading={loading} />
          </>
        }
      >
        <Table
          containerClassName={CUSTOMER_TABLE_SCROLL_CONTAINER}
          className={MIN_WIDTH}
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
                  title="Type & Plan"
                  value={typeFilter}
                  onChange={(val) =>
                    setTypeFilter(val as PartialPaymentTypeFilter)
                  }
                  allValue="ALL"
                  sections={[
                    {
                      label: "Filter by Type",
                      options: [
                        { value: "ALL", label: "All Types" },
                        { value: "MEAL", label: "Meal" },
                        { value: "STAY", label: "Accommodation" },
                      ],
                    },
                  ]}
                />
              </TableHead>
              <TableHead className="text-xs font-medium uppercase tracking-wider text-slate-500">
                Location
              </TableHead>
              <TableHead className="text-xs font-medium uppercase tracking-wider text-slate-500">
                Total / Advance
              </TableHead>
              <TableHead>
                {/* The sort control lives on the column it sorts, and writes the
                    same state as the toolbar's Sort select, so the two can never
                    disagree about the current order. */}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    setSort(
                      sort === "BALANCE_DESC" ? "BALANCE_ASC" : "BALANCE_DESC",
                    )
                  }
                  className="-ml-3 h-8 text-xs font-medium uppercase tracking-wider text-slate-500 transition-all duration-200 hover:text-slate-900"
                  aria-label={`Sort by balance, currently ${
                    sort === "BALANCE_ASC" ? "ascending" : "descending"
                  }`}
                >
                  <span
                    className={cn(
                      (sort === "BALANCE_ASC" || sort === "BALANCE_DESC") &&
                        "font-semibold text-slate-900",
                    )}
                  >
                    Balance Left
                  </span>
                  {sort === "BALANCE_ASC" ? (
                    <ArrowUp className="ml-2 h-3.5 w-3.5 text-primary" />
                  ) : (
                    <ArrowDown
                      className={cn(
                        "ml-2 h-3.5 w-3.5",
                        sort === "BALANCE_DESC"
                          ? "text-primary"
                          : "text-muted-foreground/70",
                      )}
                    />
                  )}
                </Button>
              </TableHead>
              <TableHead className="text-xs font-medium uppercase tracking-wider text-slate-500">
                Payment Breakup
              </TableHead>
              <TableHead>
                <TableColumnFilter
                  mode="single"
                  title="Plan End / Checkout"
                  value={statusFilter}
                  onChange={setStatusFilter}
                  allValue={FILTER_ALL}
                  contentClassName="w-[200px]"
                  sections={[
                    {
                      label: "Filter by Status",
                      options: [
                        { value: FILTER_ALL, label: "All Statuses" },
                        ...statusOptions.map((status) => ({
                          value: status,
                          label: status,
                        })),
                      ],
                    },
                  ]}
                />
              </TableHead>
              <TableHead className="text-right text-xs font-medium uppercase tracking-wider text-slate-500">
                Actions
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableLoadingRow
                label="Loading outstanding balances..."
                colSpan={COLSPAN}
              />
            ) : paginatedRows.length === 0 ? (
              <TableEmptyRow
                icon={IndianRupee}
                title="No outstanding partial payments"
                hint="Every meal and accommodation customer who paid an advance has cleared their balance, or no one matches the current filters."
                colSpan={COLSPAN}
              />
            ) : (
              paginatedRows.map((row) => {
                const isOpen = expanded.has(row.entityId);
                return (
                  <Fragment key={row.entityId}>
                    <TableRow className="border-b border-slate-100 transition-colors hover:bg-slate-50/60">
                      <CustomerInfoCell customer={row.customer} />
                      <ContactCell customer={row.customer} />
                      <TableCell>
                        <Badge
                          className={cn(
                            "rounded-full border-0 px-2 text-[10px] font-semibold",
                            row.source === "STAY"
                              ? "bg-teal-100 text-teal-700 hover:bg-teal-100"
                              : "bg-emerald-100 text-emerald-700 hover:bg-emerald-100",
                          )}
                        >
                          {row.source === "STAY" ? "Accommodation" : "Meal"}
                        </Badge>
                        <div className="mt-1 text-sm text-slate-500">
                          {row.entityLabel ?? EMPTY}
                          {row.totalNights != null && (
                            <span className="text-slate-400">
                              {" "}
                              · {row.totalNights}N
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <LocationCell customer={row.customer} />
                      <TableCell>
                        <div className="font-semibold tracking-tight text-slate-900">
                          {rupees(row.totalAmount)}
                        </div>
                        <div className="mt-0.5 text-xs text-slate-500">
                          {row.advanceAmount > 0 ? (
                            <>
                              Adv {rupees(row.advanceAmount)}
                              {row.advanceDate && (
                                <span className="text-slate-400">
                                  {" "}
                                  · {formatDate(row.advanceDate)}
                                </span>
                              )}
                            </>
                          ) : (
                            <span className="italic text-slate-400">
                              No advance row
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div
                          className={cn(
                            "text-base font-semibold tracking-tight",
                            balanceTone(row.remainingBalance),
                          )}
                        >
                          {rupees(row.remainingBalance)}
                        </div>
                        <div className="mt-0.5 text-xs text-slate-500">
                          paid {rupees(row.totalPaid)}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => toggleExpanded(row.entityId)}
                          aria-expanded={isOpen}
                          className="-ml-2 h-7 gap-1 px-2 text-xs font-medium text-primary hover:bg-emerald-50"
                        >
                          {isOpen ? (
                            <ChevronDown className="h-3.5 w-3.5" />
                          ) : (
                            <ChevronRight className="h-3.5 w-3.5" />
                          )}
                          {row.breakup.length}{" "}
                          {row.breakup.length === 1 ? "payment" : "payments"}
                        </Button>
                        <div className="mt-0.5 pl-1 text-xs text-slate-500">
                          {row.lastPaymentDate
                            ? `last ${formatDate(row.lastPaymentDate)}`
                            : EMPTY}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col gap-1">
                          <DueBadge dueDate={row.dueDate} />
                          <DateRangeLine
                            start={row.periodStart}
                            end={row.dueDate}
                          />
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-2">
                          {!isDietitian && (
                            <Button
                              size="sm"
                              variant="outline"
                              asChild
                              className="h-8 gap-1.5 text-xs"
                            >
                              <Link href={paymentHref(row)}>
                                <IndianRupee className="h-3.5 w-3.5" />
                                Record Payment
                              </Link>
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="ghost"
                            asChild
                            className="h-8 gap-1.5 text-xs"
                          >
                            <Link href={`/customers/${row.customer.id}`}>
                              <Eye className="h-3.5 w-3.5 text-primary" />
                              360
                            </Link>
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>

                    {isOpen && (
                      <TableRow className="border-b border-slate-100 bg-slate-50/70">
                        <TableCell colSpan={COLSPAN} className="py-4">
                          <div className="space-y-2 pl-2">
                            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                              Payment breakup · {row.customer.fullName}
                            </p>
                            {row.breakup.map((entry, index) => (
                              <div
                                key={entry.id}
                                className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-slate-200 bg-white px-4 py-2.5"
                              >
                                <div className="flex items-center gap-3">
                                  <span className="w-5 text-xs font-medium text-slate-400">
                                    {index + 1}
                                  </span>
                                  <Badge
                                    className={cn(
                                      "rounded-full border-0 px-2 text-[10px] font-semibold",
                                      entry.transactionType === "REFUND"
                                        ? "bg-rose-100 text-rose-700 hover:bg-rose-100"
                                        : entry.transactionType === "ADVANCE"
                                          ? "bg-sky-100 text-sky-700 hover:bg-sky-100"
                                          : "bg-emerald-100 text-emerald-700 hover:bg-emerald-100",
                                    )}
                                  >
                                    {TRANSACTION_LABEL[entry.transactionType] ??
                                      entry.transactionType}
                                  </Badge>
                                  <span
                                    className={cn(
                                      "text-sm font-semibold",
                                      entry.transactionType === "REFUND"
                                        ? "text-rose-700"
                                        : "text-slate-900",
                                    )}
                                  >
                                    {entry.transactionType === "REFUND"
                                      ? `− ${rupees(entry.amount)}`
                                      : rupees(entry.amount)}
                                  </span>
                                  <span className="text-xs text-slate-500">
                                    {formatDate(entry.transactionDate) ?? EMPTY}
                                  </span>
                                </div>
                                <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500">
                                  {entry.paymentMethod && (
                                    <span className="rounded bg-slate-100 px-1.5 py-0.5 font-medium text-slate-600">
                                      {entry.paymentMethod}
                                    </span>
                                  )}
                                  {entry.comment && <span>{entry.comment}</span>}
                                  {entry.remark && (
                                    <span className="italic">{entry.remark}</span>
                                  )}
                                </div>
                              </div>
                            ))}
                            <div className="flex items-center justify-end gap-6 pt-1 text-sm">
                              <span className="text-slate-500">
                                Total paid{" "}
                                <span className="font-semibold text-slate-900">
                                  {rupees(row.totalPaid)}
                                </span>
                              </span>
                              <span className="text-slate-500">
                                Balance left{" "}
                                <span
                                  className={cn(
                                    "font-semibold",
                                    balanceTone(row.remainingBalance),
                                  )}
                                >
                                  {rupees(row.remainingBalance)}
                                </span>
                              </span>
                            </div>
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                  </Fragment>
                );
              })
            )}
          </TableBody>
        </Table>
      </DataTableCard>
    </div>
  );
}
