"use client";

// src/app/franchise/(main)/inventory/ledger/_components/FranchiseLedgerWorkspace.tsx
// Franchise audit ledger — mirrors the central kitchen Audit Ledger UI:
// date filter bar, section switcher (Incoming / Outgoing), summary cards, and a
// searchable / filterable / sortable / exportable data table.
//
// Incoming = stock received from the central kitchen (Stock_Transfers).
// Outgoing = stock dispatched to customers / wastage / other (Stock-Outs).

import { useMemo, useState } from "react";
import {
  endOfDay,
  format,
  isAfter,
  isBefore,
  parseISO,
  startOfDay,
  subDays,
} from "date-fns";
import {
  ArrowDown,
  ArrowDownToLine,
  ArrowUp,
  ArrowUpDown,
  ArrowUpFromLine,
  CalendarRange,
  Download,
  Filter,
} from "lucide-react";
import { type DateRange } from "react-day-picker";

import { cn } from "@/lib/utils";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/shared/components/ui/card";
import { DatePickerWithRange } from "@/shared/components/ui/date-picker-with-range";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/shared/components/ui/dropdown-menu";
import { Input } from "@/shared/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/shared/components/ui/table";
import type {
  FranchiseLedgerEntry,
  StockOutReason,
} from "@/types/franchiseInventory";
import PackageImagesViewer from "@/shared/components/admin/inventory/PackageImagesViewer";

// ---------------------------------------------------------------------------
// Destination labels (outgoing) — same vocabulary as the Dispatch modal.
// ---------------------------------------------------------------------------

const DESTINATION_LABELS: Record<StockOutReason, string> = {
  MEAL_SUBSCRIPTION_SALE: "Meal Subscription Customer",
  KIT_SUBSCRIPTION_SALE: "Kit Subscription Customer",
  ONE_TIME_PURCHASE_SALE: "One Time Purchase Customer",
  SPOILED: "Spoilage",
  DAMAGED: "Wastage",
  OTHER: "Other",
};

const OUTGOING_DESTINATIONS = Object.values(DESTINATION_LABELS);

function destinationLabel(entry: FranchiseLedgerEntry): string {
  if (entry.direction === "IN") return "Central Kitchen";
  return entry.stockOutReason
    ? (DESTINATION_LABELS[entry.stockOutReason] ?? entry.stockOutReason)
    : "—";
}

function batchSummary(entry: FranchiseLedgerEntry): string {
  if (!entry.batchBreakdown || entry.batchBreakdown.length === 0) return "—";
  return entry.batchBreakdown
    .map((b) => `${b.batchNumber} ×${b.quantity}`)
    .join(", ");
}

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

type SectionId = "incoming" | "outgoing";

interface SectionConfig {
  id: SectionId;
  label: string;
  hint: string;
  description: string;
  direction: "IN" | "OUT";
  icon: typeof ArrowDownToLine;
  emptyLabel: string;
  exportFileName: string;
  accent: {
    activeButton: string;
    activeIcon: string;
    idleIcon: string;
    activeCount: string;
    ring: string;
  };
}

const SECTIONS: SectionConfig[] = [
  {
    id: "incoming",
    label: "Incoming Entries",
    hint: "Stock received",
    description:
      "Finished-product stock received from the central kitchen via stock transfers.",
    direction: "IN",
    icon: ArrowDownToLine,
    emptyLabel: "No incoming stock entries recorded yet.",
    exportFileName: "franchise_ledger_incoming.csv",
    accent: {
      activeButton:
        "border-emerald-300 bg-emerald-50/80 ring-1 ring-emerald-200",
      activeIcon: "bg-emerald-100 text-emerald-700",
      idleIcon: "bg-emerald-50 text-emerald-600",
      activeCount: "bg-emerald-600 text-white",
      ring: "before:bg-emerald-500",
    },
  },
  {
    id: "outgoing",
    label: "Outgoing Entries",
    hint: "Stock dispatched",
    description:
      "Stock dispatched to customers, recorded as wastage, or other reasons.",
    direction: "OUT",
    icon: ArrowUpFromLine,
    emptyLabel: "No outgoing stock entries recorded yet.",
    exportFileName: "franchise_ledger_outgoing.csv",
    accent: {
      activeButton: "border-rose-300 bg-rose-50/80 ring-1 ring-rose-200",
      activeIcon: "bg-rose-100 text-rose-700",
      idleIcon: "bg-rose-50 text-rose-600",
      activeCount: "bg-rose-600 text-white",
      ring: "before:bg-rose-500",
    },
  },
];

const RANGE_PRESETS = [
  { label: "Last 10 days", days: 10 },
  { label: "Last 30 days", days: 30 },
  { label: "Last 90 days", days: 90 },
] as const;

function lastNDays(days: number): DateRange {
  return {
    from: startOfDay(subDays(new Date(), days - 1)),
    to: endOfDay(new Date()),
  };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface FranchiseLedgerWorkspaceProps {
  entries: FranchiseLedgerEntry[];
}

export default function FranchiseLedgerWorkspace({
  entries,
}: FranchiseLedgerWorkspaceProps) {
  const [activeId, setActiveId] = useState<SectionId>("incoming");
  const [dateRange, setDateRange] = useState<DateRange | undefined>(() =>
    lastNDays(10),
  );

  // Page-level date filter.
  const dateFiltered = useMemo(() => {
    if (!dateRange?.from) return entries;
    return entries.filter((entry) => {
      const d = parseISO(entry.occurredAt);
      if (isBefore(d, startOfDay(dateRange.from!))) return false;
      if (dateRange.to && isAfter(d, endOfDay(dateRange.to))) return false;
      return true;
    });
  }, [entries, dateRange]);

  const activePresetDays = useMemo(() => {
    if (!dateRange?.from || !dateRange.to) return null;
    const matchesToday =
      endOfDay(dateRange.to).getTime() === endOfDay(new Date()).getTime();
    if (!matchesToday) return null;
    const preset = RANGE_PRESETS.find(
      (option) =>
        startOfDay(subDays(new Date(), option.days - 1)).getTime() ===
        startOfDay(dateRange.from!).getTime(),
    );
    return preset?.days ?? null;
  }, [dateRange]);

  const incomingEntries = useMemo(
    () => dateFiltered.filter((e) => e.direction === "IN"),
    [dateFiltered],
  );
  const outgoingEntries = useMemo(
    () => dateFiltered.filter((e) => e.direction === "OUT"),
    [dateFiltered],
  );

  const sectionCounts: Record<SectionId, number> = {
    incoming: incomingEntries.length,
    outgoing: outgoingEntries.length,
  };

  const activeSection = SECTIONS.find((s) => s.id === activeId)!;
  const activeData = activeId === "incoming" ? incomingEntries : outgoingEntries;
  const totalUnits = activeData.reduce((sum, e) => sum + e.quantity, 0);

  return (
    <div className="space-y-6">
      {/* Date filter bar */}
      <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-600">
            <CalendarRange className="size-5" />
          </span>
          <div>
            <p className="text-sm font-semibold text-slate-900">
              Filter by date
            </p>
            <p className="text-xs text-slate-500">
              {dateFiltered.length} of {entries.length} entries in range
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {RANGE_PRESETS.map((preset) => (
            <Button
              key={preset.days}
              type="button"
              size="sm"
              variant={activePresetDays === preset.days ? "default" : "outline"}
              onClick={() => setDateRange(lastNDays(preset.days))}
            >
              {preset.label}
            </Button>
          ))}
          <Button
            type="button"
            size="sm"
            variant={!dateRange?.from ? "default" : "outline"}
            onClick={() => setDateRange(undefined)}
          >
            All time
          </Button>
          <DatePickerWithRange date={dateRange} onDateChange={setDateRange} />
        </div>
      </div>

      {/* Section switcher */}
      <div
        role="tablist"
        aria-label="Franchise ledger sections"
        className="grid grid-cols-1 gap-3 sm:grid-cols-2"
      >
        {SECTIONS.map((section) => {
          const isActive = section.id === activeId;
          const Icon = section.icon;
          return (
            <button
              key={section.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => setActiveId(section.id)}
              className={cn(
                "group flex items-center gap-3 rounded-xl border bg-white p-4 text-left transition-all",
                "hover:border-slate-300 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2",
                isActive ? section.accent.activeButton : "border-slate-200 shadow-sm",
              )}
            >
              <span
                className={cn(
                  "flex size-11 shrink-0 items-center justify-center rounded-lg transition-colors",
                  isActive ? section.accent.activeIcon : section.accent.idleIcon,
                )}
              >
                <Icon className="size-5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-semibold text-slate-900">
                    {section.label}
                  </span>
                  <span
                    className={cn(
                      "inline-flex min-w-6 items-center justify-center rounded-full px-2 py-0.5 text-xs font-semibold transition-colors",
                      isActive ? section.accent.activeCount : "bg-slate-100 text-slate-600",
                    )}
                  >
                    {sectionCounts[section.id]}
                  </span>
                </span>
                <span className="mt-0.5 block truncate text-xs text-slate-500">
                  {section.hint}
                </span>
              </span>
            </button>
          );
        })}
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <SummaryCard
          label="Entries in this view"
          value={activeData.length.toLocaleString("en-IN")}
          caption={activeSection.description}
          accentRing={activeSection.accent.ring}
        />
        <SummaryCard
          label={activeId === "incoming" ? "Total Units Received" : "Total Units Dispatched"}
          value={totalUnits.toLocaleString("en-IN")}
          caption={
            activeId === "incoming"
              ? "Units added to inventory from the central kitchen"
              : "Units dispatched to customers, wastage, or other"
          }
          icon={activeId === "incoming" ? ArrowDownToLine : ArrowUpFromLine}
          iconClassName={activeId === "incoming" ? "text-emerald-600" : "text-rose-600"}
          valueClassName={activeId === "incoming" ? "text-emerald-700" : "text-rose-700"}
          accentRing={activeSection.accent.ring}
        />
      </div>

      {/* Data table */}
      <LedgerTable
        key={activeId}
        section={activeSection}
        data={activeData}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Summary card
// ---------------------------------------------------------------------------

interface SummaryCardProps {
  label: string;
  value: string;
  caption: string;
  icon?: typeof ArrowDownToLine;
  iconClassName?: string;
  valueClassName?: string;
  accentRing: string;
}

function SummaryCard({
  label,
  value,
  caption,
  icon: Icon,
  iconClassName,
  valueClassName,
  accentRing,
}: SummaryCardProps) {
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-xl border border-slate-200 bg-white p-4 shadow-sm",
        "before:absolute before:inset-y-0 before:left-0 before:w-1 before:content-['']",
        accentRing,
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
          {label}
        </p>
        {Icon ? <Icon className={cn("size-4", iconClassName)} /> : null}
      </div>
      <p
        className={cn(
          "mt-2 text-2xl font-semibold tracking-tight text-slate-900",
          valueClassName,
        )}
      >
        {value}
      </p>
      <p className="mt-1 line-clamp-1 text-xs text-slate-500">{caption}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Data table (search + destination filter + sort + export + pagination)
// ---------------------------------------------------------------------------

type SortKey = "occurredAt" | "quantity";
type SortDir = "asc" | "desc";
const PAGE_SIZE = 25;

function LedgerTable({
  section,
  data,
}: {
  section: SectionConfig;
  data: FranchiseLedgerEntry[];
}) {
  const [search, setSearch] = useState("");
  const [destFilter, setDestFilter] = useState<string[]>([]);
  const [sortKey, setSortKey] = useState<SortKey>("occurredAt");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [page, setPage] = useState(0);

  const isOutgoing = section.direction === "OUT";

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let rows = data;
    if (q) {
      rows = rows.filter((e) => {
        const inName = e.productName.toLowerCase().includes(q);
        const inBatch = (e.batchBreakdown ?? []).some((b) =>
          b.batchNumber.toLowerCase().includes(q),
        );
        return inName || inBatch;
      });
    }
    if (isOutgoing && destFilter.length > 0) {
      rows = rows.filter((e) => destFilter.includes(destinationLabel(e)));
    }
    const sorted = [...rows].sort((a, b) => {
      let cmp = 0;
      if (sortKey === "occurredAt") {
        cmp =
          new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime();
      } else {
        cmp = a.quantity - b.quantity;
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    return sorted;
  }, [data, search, destFilter, sortKey, sortDir, isOutgoing]);

  const pageCount = Math.max(Math.ceil(filtered.length / PAGE_SIZE), 1);
  const safePage = Math.min(page, pageCount - 1);
  const pageRows = filtered.slice(
    safePage * PAGE_SIZE,
    safePage * PAGE_SIZE + PAGE_SIZE,
  );

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  function handleExport() {
    const rows = filtered.map((e) => ({
      "Date & Time": format(parseISO(e.occurredAt), "dd MMM yyyy, hh:mm a"),
      Direction: e.direction === "IN" ? "Stock In" : "Stock Out",
      Product: e.productName,
      Batches: batchSummary(e),
      [isOutgoing ? "Destination" : "Source"]: destinationLabel(e),
      Comment: e.comment ?? "",
      Quantity: `${e.direction === "IN" ? "+" : "-"}${e.quantity}`,
    }));
    exportToCsv(rows, section.exportFileName);
  }

  return (
    <Card className="border shadow-sm">
      <CardHeader>
        <CardTitle>{section.label} · Transaction History</CardTitle>
        <CardDescription>
          {section.description} · {filtered.length} transaction
          {filtered.length === 1 ? "" : "s"} shown
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <Input
            placeholder="Search products or batches..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(0);
            }}
            className="max-w-xs"
          />

          {isOutgoing && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" className="gap-2">
                  <Filter className="h-4 w-4" />
                  Destination
                  {destFilter.length > 0 && (
                    <span className="text-xs text-muted-foreground">
                      ({destFilter.length})
                    </span>
                  )}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-60">
                {OUTGOING_DESTINATIONS.map((dest) => (
                  <DropdownMenuCheckboxItem
                    key={dest}
                    checked={destFilter.includes(dest)}
                    onCheckedChange={(checked) => {
                      setPage(0);
                      setDestFilter((prev) =>
                        checked
                          ? [...prev, dest]
                          : prev.filter((d) => d !== dest),
                      );
                    }}
                  >
                    {dest}
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          <Button
            variant="outline"
            className="ml-auto gap-2"
            disabled={filtered.length === 0}
            onClick={handleExport}
          >
            <Download className="h-4 w-4" />
            Export CSV
          </Button>
        </div>

        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/10">
                <TableHead>
                  <SortHeader
                    label="Date & Time"
                    active={sortKey === "occurredAt"}
                    dir={sortDir}
                    onClick={() => toggleSort("occurredAt")}
                  />
                </TableHead>
                <TableHead>Direction</TableHead>
                <TableHead>Product &amp; Batches</TableHead>
                <TableHead>{isOutgoing ? "Destination" : "Source"}</TableHead>
                <TableHead className="text-right">
                  <SortHeader
                    label="Quantity"
                    active={sortKey === "quantity"}
                    dir={sortDir}
                    onClick={() => toggleSort("quantity")}
                    alignRight
                  />
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pageRows.length ? (
                pageRows.map((entry) => (
                  <TableRow key={entry.id} className="hover:bg-muted/50">
                    <TableCell className="whitespace-nowrap text-sm">
                      {format(parseISO(entry.occurredAt), "dd MMM yyyy, hh:mm a")}
                    </TableCell>
                    <TableCell>
                      <DirectionBadge direction={entry.direction} />
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5">
                        <div>
                          <p className="font-medium">{entry.productName}</p>
                          <p className="text-xs text-muted-foreground">
                            {batchSummary(entry)}
                          </p>
                        </div>
                        {entry.hasPackageImages && entry.transferId && (
                          <PackageImagesViewer
                            transferId={entry.transferId}
                            compact
                          />
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col gap-0.5">
                        <Badge
                          variant="outline"
                          className={
                            entry.direction === "IN"
                              ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                              : "border-rose-200 bg-rose-50 text-rose-700"
                          }
                        >
                          {destinationLabel(entry)}
                        </Badge>
                        {entry.comment ? (
                          <span className="text-xs text-muted-foreground line-clamp-1">
                            {entry.comment}
                          </span>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell className="text-right font-medium">
                      <span
                        className={
                          entry.direction === "IN"
                            ? "text-emerald-700"
                            : "text-rose-600"
                        }
                      >
                        {entry.direction === "IN" ? "+" : "-"}
                        {entry.quantity}
                      </span>
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell
                    colSpan={5}
                    className="h-24 text-center text-muted-foreground"
                  >
                    {section.emptyLabel}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">
            Page {safePage + 1} of {pageCount} · {filtered.length} transaction
            {filtered.length === 1 ? "" : "s"}
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.max(p - 1, 0))}
              disabled={safePage === 0}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.min(p + 1, pageCount - 1))}
              disabled={safePage >= pageCount - 1}
            >
              Next
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function SortHeader({
  label,
  active,
  dir,
  onClick,
  alignRight,
}: {
  label: string;
  active: boolean;
  dir: SortDir;
  onClick: () => void;
  alignRight?: boolean;
}) {
  return (
    <Button
      variant="ghost"
      size="sm"
      className={cn("h-8", alignRight ? "-mr-3" : "-ml-3")}
      onClick={onClick}
    >
      {label}
      {active ? (
        dir === "asc" ? (
          <ArrowUp className="ml-2 h-3.5 w-3.5" />
        ) : (
          <ArrowDown className="ml-2 h-3.5 w-3.5" />
        )
      ) : (
        <ArrowUpDown className="ml-2 h-3.5 w-3.5 text-muted-foreground" />
      )}
    </Button>
  );
}

function DirectionBadge({ direction }: { direction: "IN" | "OUT" }) {
  if (direction === "IN") {
    return (
      <Badge variant="outline" className="border-green-200 bg-green-100 text-green-800">
        Stock In
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="border-gray-200 bg-gray-100 text-gray-700">
      Stock Out
    </Badge>
  );
}

// ---------------------------------------------------------------------------
// CSV export
// ---------------------------------------------------------------------------

function exportToCsv(rows: Record<string, string>[], fileName: string) {
  if (rows.length === 0) return;
  const headers = Object.keys(rows[0]);
  const escape = (val: string) => {
    const s = String(val ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [
    headers.join(","),
    ...rows.map((row) => headers.map((h) => escape(row[h])).join(",")),
  ].join("\n");

  const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
