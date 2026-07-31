"use client";

// src/shared/components/admin/product-inventory/ClinicLedgerView.tsx
//
// Clinic ledger view for the Operations Shop Products page
// (clinic-scoped-shop-inventory spec — Task 10.2). Mirrors `LedgerWorkspace`'s
// section-switcher pattern (src/shared/components/admin/inventory/ledger/
// LedgerWorkspace.tsx) but simplified to exactly what Requirement 9.6–9.10,
// 9.12 calls for:
//
//   - Two sections only — "Stock In" (direction IN) and "Stock Out"
//     (direction OUT) — no manufacturing tab, no summary metric cards, no
//     date-range filter (none of those concepts apply to a per-clinic shop
//     ledger and none are named by the requirement's plain field list).
//   - Each entry row shows: occurrence timestamp, product name, direction
//     (as a badge — redundant with the active section but still part of the
//     requirement's literal field list), quantity, and movement source
//     (Req 9.6).
//   - Ordering is NOT re-derived here — `entries` arrives already ordered by
//     `occurred_at DESC, id DESC` from `listLedgerEntries` (Req 9.7); this
//     component only buckets the already-ordered array by direction, exactly
//     as `LedgerWorkspace` buckets its own already-fetched dataset into
//     sections in a `useMemo`.
//   - Req 9.9: the whole clinic has zero ledger entries at all -> a single
//     "no recorded stock movements" empty state, no section switcher (there
//     is nothing to switch between).
//   - Req 9.10: the overall list is non-empty but the active section (IN or
//     OUT) has zero entries -> a distinct "no movements match this filter"
//     empty state inside that section's content area, with the switcher
//     still shown.
//
// Load-failure (Req 9.12) is intentionally NOT handled here — this component
// only ever receives an already-successfully-fetched `entries` array; the
// page renders a distinct error Alert instead of this component when the
// fetch itself fails (see kitchen-shop/inventory/page.tsx), which keeps the
// "no movements" and "could not load" states textually and structurally
// separate as the requirement demands.
//
// Data-fetching is intentionally NOT done here — the page (Server Component)
// already fetches `clinicProducts` server-side via `getClinicShopViewAction`
// for the same pattern, so the ledger entries are fetched the same way via
// `getClinicLedgerAction` and passed down as a prop. This component is a
// "use client" leaf only for the IN/OUT tab-switching interactivity.

import { useMemo, useState } from "react";
import { format, parseISO } from "date-fns";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Inbox,
  type LucideIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { Badge } from "@/shared/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/shared/components/ui/table";
import type {
  ClinicLedgerDirection,
  ClinicLedgerEntry,
  ClinicMovementSource,
} from "@/types/clinicShop";

/**
 * Readable label per `ClinicMovementSource` value. A local map rather than a
 * shared export (unlike `INVENTORY_SOURCE_LABELS`, which backs the *different*
 * `InventorySourceType` enum) since no other caller in the codebase currently
 * needs this mapping.
 */
const MOVEMENT_SOURCE_LABELS: Record<ClinicMovementSource, string> = {
  WAREHOUSE_STOCK_IN: "Warehouse Stock In",
  CUSTOMER_APP_SALE: "Customer App Sale",
  ASSISTED_SALE: "Assisted Sale",
  WALKIN_SALE: "Walk-in Sale",
  MIGRATION: "Migration",
};

type SectionId = "IN" | "OUT";

interface SectionConfig {
  id: SectionId;
  direction: ClinicLedgerDirection;
  label: string;
  hint: string;
  icon: LucideIcon;
  emptyFilterLabel: string;
  accent: {
    activeButton: string;
    activeIcon: string;
    idleIcon: string;
    activeCount: string;
  };
}

const SECTIONS: SectionConfig[] = [
  {
    id: "IN",
    direction: "IN",
    label: "Stock In",
    hint: "Stock received",
    icon: ArrowDownToLine,
    emptyFilterLabel: "No stock-in movements match this filter.",
    accent: {
      activeButton: "border-emerald-300 bg-emerald-50/80 ring-1 ring-emerald-200",
      activeIcon: "bg-emerald-100 text-emerald-700",
      idleIcon: "bg-emerald-50 text-emerald-600",
      activeCount: "bg-emerald-600 text-white",
    },
  },
  {
    id: "OUT",
    direction: "OUT",
    label: "Stock Out",
    hint: "Stock sold",
    icon: ArrowUpFromLine,
    emptyFilterLabel: "No stock-out movements match this filter.",
    accent: {
      activeButton: "border-rose-300 bg-rose-50/80 ring-1 ring-rose-200",
      activeIcon: "bg-rose-100 text-rose-700",
      idleIcon: "bg-rose-50 text-rose-600",
      activeCount: "bg-rose-600 text-white",
    },
  },
];

const DIRECTION_BADGE_STYLES: Record<ClinicLedgerDirection, string> = {
  IN: "border-emerald-200 bg-emerald-50 text-emerald-700",
  OUT: "border-rose-200 bg-rose-50 text-rose-700",
};

function formatTimestamp(value: string): string {
  return format(parseISO(value), "dd MMM yyyy, hh:mm a");
}

interface ClinicLedgerViewProps {
  /** Every Clinic_Shop_Ledger entry for the selected clinic, already ordered
   * by `occurred_at DESC, id DESC` (Req 9.7). */
  entries: ClinicLedgerEntry[];
}

export function ClinicLedgerView({ entries }: ClinicLedgerViewProps) {
  const [activeId, setActiveId] = useState<SectionId>("IN");

  const { sectionEntries, sectionCounts } = useMemo(() => {
    const dataMap = new Map<SectionId, ClinicLedgerEntry[]>();
    const countMap = new Map<SectionId, number>();

    for (const section of SECTIONS) {
      dataMap.set(section.id, []);
      countMap.set(section.id, 0);
    }

    for (const entry of entries) {
      const section = SECTIONS.find((s) => s.direction === entry.direction);
      if (!section) continue;
      dataMap.get(section.id)!.push(entry);
      countMap.set(section.id, (countMap.get(section.id) ?? 0) + 1);
    }

    return { sectionEntries: dataMap, sectionCounts: countMap };
  }, [entries]);

  // Req 9.9: the clinic has zero ledger entries at all — nothing to switch
  // between, so the section switcher itself is not rendered.
  if (entries.length === 0) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="mb-3 text-base font-semibold text-slate-900">
          Stock Movement Ledger
        </h2>
        <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-slate-200 bg-slate-50 py-12 text-center">
          <Inbox className="h-8 w-8 text-slate-400" />
          <p className="text-sm font-medium text-slate-700">
            No recorded stock movements
          </p>
          <p className="text-xs text-slate-500">
            This clinic has no stock-in or stock-out history yet.
          </p>
        </div>
      </div>
    );
  }

  const activeSection = SECTIONS.find((section) => section.id === activeId)!;
  const activeEntries = sectionEntries.get(activeId) ?? [];

  return (
    <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <h2 className="text-base font-semibold text-slate-900">
        Stock Movement Ledger
      </h2>

      {/* Section switcher — mirrors LedgerWorkspace's tab pattern, simplified
          to two sections with no metric cards or date filter. */}
      <div
        role="tablist"
        aria-label="Clinic ledger sections"
        className="grid grid-cols-1 gap-3 sm:grid-cols-2"
      >
        {SECTIONS.map((section) => {
          const isActive = section.id === activeId;
          const count = sectionCounts.get(section.id) ?? 0;
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
                isActive
                  ? section.accent.activeButton
                  : "border-slate-200 shadow-sm",
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
                      isActive
                        ? section.accent.activeCount
                        : "bg-slate-100 text-slate-600",
                    )}
                  >
                    {count}
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

      {/* Active section content */}
      {activeEntries.length === 0 ? (
        // Req 9.10: the overall ledger is non-empty but this filter matches
        // nothing — distinct from the Req 9.9 "no movements at all" state.
        <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-slate-200 bg-slate-50 py-10 text-center">
          <activeSection.icon className="h-7 w-7 text-slate-400" />
          <p className="text-sm font-medium text-slate-700">
            {activeSection.emptyFilterLabel}
          </p>
        </div>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/10">
                <TableHead>Date &amp; Time</TableHead>
                <TableHead>Product</TableHead>
                <TableHead>Direction</TableHead>
                <TableHead className="text-right">Quantity</TableHead>
                <TableHead>Movement Source</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {activeEntries.map((entry) => (
                <TableRow key={entry.id} className="hover:bg-muted/50">
                  <TableCell className="whitespace-nowrap text-sm">
                    {formatTimestamp(entry.occurred_at)}
                  </TableCell>
                  <TableCell className="text-sm font-medium text-slate-900">
                    {entry.product_name}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant="outline"
                      className={DIRECTION_BADGE_STYLES[entry.direction]}
                    >
                      {entry.direction}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right font-medium tabular-nums">
                    {entry.quantity}
                  </TableCell>
                  <TableCell className="text-sm text-slate-700">
                    {MOVEMENT_SOURCE_LABELS[entry.movement_source]}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

export default ClinicLedgerView;
