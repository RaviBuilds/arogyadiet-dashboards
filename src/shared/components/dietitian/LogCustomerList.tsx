// src/shared/components/dietitian/LogCustomerList.tsx
// Feature: dietitian-management — task 10.5.
//
// The client leaf named in design.md section 12 ("Searchable, filterable,
// sortable list of in-scope customers with cadence columns"). It owns the
// search/filter/sort UI state and re-fetches through the portal-neutral
// `listDietitianCustomers` Server Action on every change — the same fetch
// shape `HolidayCalendarClient.tsx` uses (a request-id guarded `useEffect`
// so a slow, superseded fetch can never clobber a newer one).
//
// The caller (the admin and franchise `/log-customer` pages, per design.md
// section 13) passes `listAction={listDietitianCustomers}` and an
// `hrefPrefix` that resolves the portal-correct Customer_360 route, keeping
// this component portal-neutral (Req 23.7) exactly like
// `DietitianActivityReport.tsx`'s `reportCardHrefFor` prop.
//
// Req 4.4: renders `NO_CLINIC_ASSIGNED_NOTICE` as a prominent banner when the
// action reports a non-null `clinicNotice` (a core Dietitian with no linked
// Clinic).
// Req 15.3, 16.6: renders the cadence columns and the assigned Dietitian name
// for every in-scope row.
// Req 15.4: the search box matches name, mobile and customer code via
// `filters.search`.
// Req 17.1–17.3: the "missing self log", "pending only" and "minimum days"
// filter controls map to `filters.missingSelfLog`, `filters.pendingOnly` and
// `filters.minDaysNotLogged`.
// Req 17.4–17.6: `lastDietitianLogDate` and `daysNotLogged` are sortable with
// an asc/desc toggle; the server action treats a missing last-log date as the
// earliest orderable value in both directions.
// Req 17.7: every active filter narrows the list by conjunction — enforced by
// `applyDietitianFilters` on the server, this component only forwards the
// active filter values.
//
// The Customer_Category tabs and per-category self-log columns are a pure
// client-side presentation concern: the Server Action already returns every
// in-scope row (each carrying its `category`), so the tabs partition the
// fetched set without an extra round trip, and the Self_Log columns — which are
// always zero for MEAL/ACCOMMODATION — are only shown when KIT rows can appear.
//
// Requirements: 4.4, 15.3, 15.4, 16.6, 17.1, 17.2, 17.3, 17.4, 17.5, 17.6, 17.7

"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  CalendarClock,
  ChevronRight,
  Search,
  Users,
} from "lucide-react";
import { toast } from "sonner";

import type {
  DietitianCustomerListResult,
  DietitianCustomerSort,
} from "@/actions/dietitian-actions/dietitianCustomerActions";
import type { DietitianFilters, DietitianSortKey } from "@/lib/dietitian/listFilters";
import { DEFAULT_DIETITIAN_SORT } from "@/lib/dietitian/listFilters";
import type { CustomerCategory, DietitianCustomerRow } from "@/types/dietitian";
import { cn } from "@/lib/utils";
import { Alert, AlertDescription, AlertTitle } from "@/shared/components/ui/alert";
import { Badge } from "@/shared/components/ui/badge";
import { Checkbox } from "@/shared/components/ui/checkbox";
import { Card, CardContent } from "@/shared/components/ui/card";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import { Skeleton } from "@/shared/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/shared/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/shared/components/ui/table";

/** How long to wait after the last keystroke before re-querying by search term. */
const SEARCH_DEBOUNCE_MS = 300;

/** The category tab selection: every category plus an "all" pseudo-value. */
type CategoryTab = "ALL" | CustomerCategory;

export interface LogCustomerListProps {
  /**
   * The Server Action that lists this Dietitian's in-scope customers —
   * `listDietitianCustomers` from `dietitianCustomerActions.ts` in every real
   * caller. Accepted as a prop (rather than imported directly) so the admin
   * and franchise pages can share this exact component while staying
   * portal-neutral, and so tests can substitute a stub.
   */
  listAction: (
    filters: DietitianFilters,
    sort: DietitianCustomerSort,
  ) => Promise<
    { success: true; data: DietitianCustomerListResult } | { success: false; error: string }
  >;
  /**
   * The base path a row navigates to. Each portal supplies its own
   * Customer_360-style detail route prefix (e.g. `/log-customer`) under its own
   * layout; the row href is built as `${hrefPrefix}/${customerProfileId}`.
   *
   * A plain string (not a function) so this component's props stay serializable
   * when rendered from a Server Component — passing a function across the
   * server/client boundary throws "Functions cannot be passed directly to
   * Client Components".
   */
  hrefPrefix: string;
}

/** Display label for a Customer_Category, mirroring `DietitianActivityReport.tsx`. */
function categoryLabel(category: CustomerCategory): string {
  switch (category) {
    case "ACCOMMODATION":
      return "Accommodation";
    case "KIT":
      return "Kit";
    case "MEAL":
      return "Meal";
  }
}

/** Per-category badge palette so a category reads at a glance across the table. */
const CATEGORY_BADGE: Record<CustomerCategory, string> = {
  MEAL: "border-emerald-200 bg-emerald-50 text-emerald-700",
  KIT: "border-violet-200 bg-violet-50 text-violet-700",
  ACCOMMODATION: "border-amber-200 bg-amber-50 text-amber-700",
};

/** The tabs, in display order. */
const CATEGORY_TABS: { value: CategoryTab; label: string }[] = [
  { value: "ALL", label: "All" },
  { value: "MEAL", label: "Meal" },
  { value: "KIT", label: "Kit" },
  { value: "ACCOMMODATION", label: "Accommodation" },
];

/** Format YYYY-MM-DD to a more readable display format (DD MMM YYYY). */
function formatDisplayDate(dateStr: string | null): string {
  if (!dateStr) return "Never";
  const months = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];
  const [year, month, day] = dateStr.split("-").map(Number);
  if (!year || !month || !day) return dateStr;
  return `${day} ${months[month - 1]} ${year}`;
}

/** Initials monogram for the customer avatar. */
function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function SortIcon({ active, direction }: { active: boolean; direction: "asc" | "desc" }) {
  if (!active) return <ArrowUpDown className="ml-1.5 h-3.5 w-3.5 text-muted-foreground/60" />;
  return direction === "asc" ? (
    <ArrowUp className="ml-1.5 h-3.5 w-3.5 text-primary" />
  ) : (
    <ArrowDown className="ml-1.5 h-3.5 w-3.5 text-primary" />
  );
}

/**
 * A right-aligned numeric metric cell. A zero reads as muted so the eye jumps
 * straight to the rows that actually need attention; a non-zero value is tinted
 * by its `tone` (amber = watch, rose = overdue).
 */
function MetricValue({
  value,
  tone = "neutral",
}: {
  value: number;
  tone?: "neutral" | "warn" | "danger";
}) {
  if (value === 0) {
    return <span className="text-muted-foreground/40">0</span>;
  }
  return (
    <span
      className={cn(
        "font-semibold tabular-nums",
        tone === "danger" && "text-rose-600",
        tone === "warn" && "text-amber-600",
        tone === "neutral" && "text-foreground",
      )}
    >
      {value}
    </span>
  );
}

/** Tone for "days not logged": >=7 overdue, 1–6 watch, 0 fine. */
function daysTone(days: number): "neutral" | "warn" | "danger" {
  if (days >= 7) return "danger";
  if (days >= 1) return "warn";
  return "neutral";
}

const COLUMN_HEADER_CLASS =
  "text-xs font-medium uppercase tracking-wider text-muted-foreground";

/**
 * Searchable, filterable, sortable list of the signed-in Dietitian's in-scope
 * Customer_Records with cadence columns (Req 15.3, 16.6). Every search,
 * filter or sort change re-invokes `listAction`; a monotonically increasing
 * request id discards any response that is no longer the latest in flight.
 */
export function LogCustomerList({ listAction, hrefPrefix }: LogCustomerListProps) {
  const router = useRouter();
  const rowHrefFor = (customerProfileId: string) =>
    `${hrefPrefix}/${customerProfileId}`;

  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [missingSelfLog, setMissingSelfLog] = useState(false);
  const [pendingOnly, setPendingOnly] = useState(false);
  const [minDaysInput, setMinDaysInput] = useState("");
  const [sort, setSort] = useState<DietitianCustomerSort>(DEFAULT_DIETITIAN_SORT);
  const [categoryTab, setCategoryTab] = useState<CategoryTab>("ALL");

  const [rows, setRows] = useState<DietitianCustomerRow[]>([]);
  const [clinicNotice, setClinicNotice] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const requestIdRef = useRef(0);

  // Debounce the free-text search box (Req 15.4) so every keystroke does not
  // trigger its own round trip — the same 300ms debounce pattern used by the
  // Places lookup in `address-picker-map.tsx`.
  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchInput), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const minDaysNotLogged = (() => {
    const parsed = Number(minDaysInput);
    return minDaysInput.trim().length > 0 && Number.isFinite(parsed) ? parsed : undefined;
  })();

  useEffect(() => {
    const requestId = ++requestIdRef.current;
    let cancelled = false;

    async function load() {
      setIsLoading(true);

      const filters: DietitianFilters = {
        search: search.trim().length > 0 ? search : undefined,
        missingSelfLog: missingSelfLog || undefined,
        pendingOnly: pendingOnly || undefined,
        minDaysNotLogged,
      };

      const result = await listAction(filters, sort);

      if (cancelled || requestId !== requestIdRef.current) return;

      setIsLoading(false);

      if (result.success) {
        setRows(result.data.rows);
        setClinicNotice(result.data.clinicNotice);
      } else {
        toast.error(result.error);
      }
    }

    load();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, missingSelfLog, pendingOnly, minDaysNotLogged, sort, listAction]);

  const toggleSort = (key: DietitianSortKey) => {
    setSort((prev) =>
      prev.key === key
        ? { key, direction: prev.direction === "asc" ? "desc" : "asc" }
        : { key, direction: "asc" },
    );
  };

  // Per-category counts drive the tab badges; computed from the server-filtered
  // set so they always reflect the search/filter state currently in effect.
  const categoryCounts = useMemo(() => {
    const counts: Record<CategoryTab, number> = {
      ALL: rows.length,
      MEAL: 0,
      KIT: 0,
      ACCOMMODATION: 0,
    };
    for (const row of rows) counts[row.category] += 1;
    return counts;
  }, [rows]);

  // Rows shown for the active category tab (client-side partition, Req 23.7).
  const visibleRows = useMemo(
    () => (categoryTab === "ALL" ? rows : rows.filter((r) => r.category === categoryTab)),
    [rows, categoryTab],
  );

  // Column visibility: the Category column is redundant once a single category
  // is selected, and the Self_Log columns only carry data for KIT customers.
  const showCategoryColumn = categoryTab === "ALL";
  const showSelfLogColumns = categoryTab === "ALL" || categoryTab === "KIT";
  const columnCount =
    5 + // Customer, Dietitian, Last log, Days not logged, Pending
    (showCategoryColumn ? 1 : 0) +
    1 + // Paused
    (showSelfLogColumns ? 2 : 0) +
    1; // trailing chevron

  return (
    <div className="space-y-4">
      {clinicNotice ? (
        <Alert variant="destructive">
          <AlertTitle>No clinic assigned</AlertTitle>
          <AlertDescription>{clinicNotice}</AlertDescription>
        </Alert>
      ) : null}

      <Card className="overflow-hidden">
        <CardContent className="space-y-5 pt-6">
          {/* Category selector — pick a customer type to focus the list. */}
          <Tabs
            value={categoryTab}
            onValueChange={(v) => setCategoryTab(v as CategoryTab)}
          >
            <TabsList className="h-9">
              {CATEGORY_TABS.map((tab) => (
                <TabsTrigger key={tab.value} value={tab.value} className="gap-1.5 px-3">
                  {tab.label}
                  <span
                    className={cn(
                      "rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums",
                      categoryTab === tab.value
                        ? "bg-primary/10 text-primary"
                        : "bg-muted text-muted-foreground",
                    )}
                  >
                    {categoryCounts[tab.value]}
                  </span>
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>

          {/* Filter toolbar. */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative w-full sm:w-[300px]">
              <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search name or mobile..."
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                className="pl-9"
                aria-label="Search customers"
              />
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <label
                className={cn(
                  "flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-1.5 text-sm transition-colors select-none",
                  missingSelfLog
                    ? "border-primary/40 bg-primary/5 text-foreground"
                    : "border-input text-muted-foreground hover:bg-muted/50",
                )}
              >
                <Checkbox
                  checked={missingSelfLog}
                  onCheckedChange={(checked) => setMissingSelfLog(checked === true)}
                />
                Missing self log
              </label>

              <label
                className={cn(
                  "flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-1.5 text-sm transition-colors select-none",
                  pendingOnly
                    ? "border-primary/40 bg-primary/5 text-foreground"
                    : "border-input text-muted-foreground hover:bg-muted/50",
                )}
              >
                <Checkbox
                  checked={pendingOnly}
                  onCheckedChange={(checked) => setPendingOnly(checked === true)}
                />
                Pending only
              </label>

              <div className="flex items-center gap-2 rounded-lg border border-input px-3 py-1">
                <Label
                  htmlFor="min-days-not-logged"
                  className="text-sm whitespace-nowrap text-muted-foreground"
                >
                  Min days not logged
                </Label>
                <Input
                  id="min-days-not-logged"
                  type="number"
                  min={0}
                  step={1}
                  inputMode="numeric"
                  value={minDaysInput}
                  onChange={(e) => setMinDaysInput(e.target.value)}
                  className="h-7 w-16 border-0 px-1 shadow-none focus-visible:ring-0"
                  placeholder="0"
                />
              </div>
            </div>

            {!isLoading ? (
              <span className="ml-auto text-sm text-muted-foreground">
                {visibleRows.length} customer{visibleRows.length === 1 ? "" : "s"}
              </span>
            ) : null}
          </div>

          {/* Data table. */}
          <div className="overflow-x-auto rounded-xl border">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40 hover:bg-muted/40">
                  <TableHead className={COLUMN_HEADER_CLASS}>Customer</TableHead>
                  {showCategoryColumn ? (
                    <TableHead className={COLUMN_HEADER_CLASS}>Category</TableHead>
                  ) : null}
                  <TableHead className={COLUMN_HEADER_CLASS}>Dietitian</TableHead>
                  <TableHead className={COLUMN_HEADER_CLASS}>
                    <button
                      type="button"
                      onClick={() => toggleSort("lastDietitianLogDate")}
                      className="inline-flex items-center uppercase hover:text-foreground"
                    >
                      Last log
                      <SortIcon
                        active={sort.key === "lastDietitianLogDate"}
                        direction={sort.direction}
                      />
                    </button>
                  </TableHead>
                  <TableHead className={cn(COLUMN_HEADER_CLASS, "text-right")}>
                    <button
                      type="button"
                      onClick={() => toggleSort("daysNotLogged")}
                      className="inline-flex items-center uppercase hover:text-foreground"
                    >
                      Days not logged
                      <SortIcon
                        active={sort.key === "daysNotLogged"}
                        direction={sort.direction}
                      />
                    </button>
                  </TableHead>
                  <TableHead className={cn(COLUMN_HEADER_CLASS, "text-right")}>
                    Pending
                  </TableHead>
                  <TableHead className={cn(COLUMN_HEADER_CLASS, "text-right")}>
                    Paused
                  </TableHead>
                  {showSelfLogColumns ? (
                    <>
                      <TableHead className={cn(COLUMN_HEADER_CLASS, "text-right")}>
                        Skipped self logs
                      </TableHead>
                      <TableHead className={cn(COLUMN_HEADER_CLASS, "text-right")}>
                        Missing self logs
                      </TableHead>
                    </>
                  ) : null}
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  Array.from({ length: 6 }).map((_, i) => (
                    <TableRow key={`skeleton-${i}`}>
                      {Array.from({ length: columnCount }).map((__, j) => (
                        <TableCell key={j}>
                          <Skeleton className="h-4 w-full max-w-[120px]" />
                        </TableCell>
                      ))}
                    </TableRow>
                  ))
                ) : visibleRows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={columnCount} className="h-40">
                      <div className="flex flex-col items-center justify-center gap-2 text-center text-sm text-muted-foreground">
                        <Users className="h-8 w-8 text-muted-foreground/40" />
                        No customers match the current filters.
                      </div>
                    </TableCell>
                  </TableRow>
                ) : (
                  visibleRows.map((row) => (
                    <TableRow
                      key={row.customerProfileId}
                      onClick={() => router.push(rowHrefFor(row.customerProfileId))}
                      className="group cursor-pointer transition-colors hover:bg-muted/50"
                    >
                      {/* Customer: monogram + name + mobile. */}
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                            {initialsOf(row.name)}
                          </span>
                          <div className="min-w-0">
                            <Link
                              href={rowHrefFor(row.customerProfileId)}
                              onClick={(e) => e.stopPropagation()}
                              className="block truncate font-medium text-foreground hover:text-primary hover:underline"
                            >
                              {row.name}
                            </Link>
                            <span className="text-xs text-muted-foreground tabular-nums">
                              {row.mobile ?? "No mobile"}
                            </span>
                          </div>
                        </div>
                      </TableCell>

                      {showCategoryColumn ? (
                        <TableCell>
                          <Badge
                            variant="outline"
                            className={cn("font-medium", CATEGORY_BADGE[row.category])}
                          >
                            {categoryLabel(row.category)}
                          </Badge>
                        </TableCell>
                      ) : null}

                      <TableCell>
                        {row.assignedDietitianName ? (
                          <span className="text-sm text-foreground">
                            {row.assignedDietitianName}
                          </span>
                        ) : (
                          <span className="text-sm text-muted-foreground/60 italic">
                            Unassigned
                          </span>
                        )}
                      </TableCell>

                      <TableCell>
                        {row.lastDietitianLogDate ? (
                          <span className="inline-flex items-center gap-1.5 text-sm text-foreground">
                            <CalendarClock className="h-3.5 w-3.5 text-muted-foreground" />
                            {formatDisplayDate(row.lastDietitianLogDate)}
                          </span>
                        ) : (
                          <Badge
                            variant="outline"
                            className="border-amber-200 bg-amber-50 text-amber-700"
                          >
                            Never
                          </Badge>
                        )}
                      </TableCell>

                      <TableCell className="text-right">
                        <MetricValue
                          value={row.daysNotLogged}
                          tone={daysTone(row.daysNotLogged)}
                        />
                      </TableCell>

                      <TableCell className="text-right">
                        <MetricValue value={row.pendingLogCount} tone="warn" />
                      </TableCell>

                      <TableCell className="text-right">
                        <MetricValue value={row.pausedDaysCount} tone="neutral" />
                      </TableCell>

                      {showSelfLogColumns ? (
                        <>
                          <TableCell className="text-right">
                            <MetricValue value={row.skippedSelfLogCount} tone="warn" />
                          </TableCell>
                          <TableCell className="text-right">
                            <MetricValue value={row.datesWithoutSelfLogCount} tone="danger" />
                          </TableCell>
                        </>
                      ) : null}

                      <TableCell className="text-right">
                        <ChevronRight className="h-4 w-4 text-muted-foreground/40 transition-colors group-hover:text-foreground" />
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
