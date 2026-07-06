"use client";

import { type ColumnDef, type FilterFn } from "@tanstack/react-table";
import { format, parseISO } from "date-fns";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";

import {
  INVENTORY_SOURCE_LABELS,
  type BaseUom,
  type TransactionLedgerEntry,
  type TransactionType,
} from "@/lib/inventory/product-schema";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import PackageImagesViewer from "@/shared/components/admin/inventory/PackageImagesViewer";

const BASE_UOM_LABELS: Record<BaseUom, string> = {
  KG: "KG",
  LITRE: "Litre",
  UNIT: "Unit",
};

export const TRANSACTION_LABELS: Record<TransactionType, string> = {
  IN: "Stock In",
  OUT: "Stock Out",
  SENT_TO_MFG: "Sent to Mfg",
  RECEIVED_FROM_MFG: "Received from Mfg",
  EXPIRED: "Expired",
};

const TRANSACTION_BADGE_STYLES: Record<TransactionType, string> = {
  IN: "border-green-200 bg-green-100 text-green-800",
  OUT: "border-gray-200 bg-gray-100 text-gray-700",
  SENT_TO_MFG: "border-orange-200 bg-orange-100 text-orange-800",
  RECEIVED_FROM_MFG: "border-blue-200 bg-blue-100 text-blue-800",
  EXPIRED: "border-amber-200 bg-amber-100 text-amber-800",
};

export const multiSelectFilterFn: FilterFn<TransactionLedgerEntry> = (
  row,
  columnId,
  filterValue,
) => {
  const values = filterValue as string[] | undefined;
  if (!values || values.length === 0) return true;
  return values.includes(row.getValue(columnId) as string);
};

/**
 * Canonical filterable value for the Source / Destination column.
 * - Incoming (IN): the supplier source label (Farmer / Vendor / Other)
 * - Outgoing (OUT): the dispatch reason / destination
 * - Manufacturing / other: empty (no source-or-destination concept)
 *
 * Kept canonical (not the custom "Other" name) so a single "Other" filter
 * matches every "Other" supplier regardless of the free-text name entered.
 */
export function getLedgerCategoryValue(entry: TransactionLedgerEntry): string {
  if (entry.transactionType === "IN") {
    return entry.sourceType ? INVENTORY_SOURCE_LABELS[entry.sourceType] : "";
  }
  if (entry.transactionType === "OUT") {
    return entry.reason ?? "";
  }
  return "";
}

const SOURCE_BADGE_STYLES = "border-emerald-200 bg-emerald-50 text-emerald-700";
const DESTINATION_BADGE_STYLES = "border-rose-200 bg-rose-50 text-rose-700";

function SourceOrDestinationCell({
  entry,
}: {
  entry: TransactionLedgerEntry;
}) {
  if (entry.transactionType === "IN") {
    if (!entry.sourceType) {
      return <span className="text-sm text-muted-foreground">—</span>;
    }
    const isOther = entry.sourceType === "OTHER";
    const customName = entry.sourceName?.trim();
    return (
      <div className="flex flex-col gap-0.5">
        <Badge variant="outline" className={SOURCE_BADGE_STYLES}>
          {INVENTORY_SOURCE_LABELS[entry.sourceType]}
        </Badge>
        {isOther && customName ? (
          <span className="text-xs text-muted-foreground">{customName}</span>
        ) : null}
      </div>
    );
  }

  if (entry.transactionType === "OUT") {
    if (!entry.reason) {
      return <span className="text-sm text-muted-foreground">—</span>;
    }
    return (
      <Badge variant="outline" className={DESTINATION_BADGE_STYLES}>
        {entry.reason}
      </Badge>
    );
  }

  return <span className="text-sm text-muted-foreground">—</span>;
}

function formatQuantity(value: number, baseUom: BaseUom): string {
  const sign = value > 0 ? "+" : value < 0 ? "-" : "";
  const absValue = Math.abs(value);
  return `${sign}${absValue} ${BASE_UOM_LABELS[baseUom]}`;
}

function formatFinancialImpact(value: number): string {
  const sign = value > 0 ? "+" : value < 0 ? "-" : "";
  return `${sign}₹${Math.abs(value).toLocaleString("en-IN")}`;
}

function SortableHeader({
  label,
  column,
}: {
  label: string;
  column: {
    getIsSorted: () => false | "asc" | "desc";
    toggleSorting: (desc?: boolean) => void;
  };
}) {
  const sorted = column.getIsSorted();

  return (
    <Button
      variant="ghost"
      size="sm"
      className="-ml-3 h-8"
      onClick={() => column.toggleSorting(sorted === "asc")}
    >
      {label}
      {sorted === "asc" ? (
        <ArrowUp className="ml-2 h-3.5 w-3.5" />
      ) : sorted === "desc" ? (
        <ArrowDown className="ml-2 h-3.5 w-3.5" />
      ) : (
        <ArrowUpDown className="ml-2 h-3.5 w-3.5 text-muted-foreground" />
      )}
    </Button>
  );
}

function TransactionTypeBadge({ type }: { type: TransactionType }) {
  return (
    <Badge variant="outline" className={TRANSACTION_BADGE_STYLES[type]}>
      {TRANSACTION_LABELS[type]}
    </Badge>
  );
}

export function formatLedgerRowForExport(entry: TransactionLedgerEntry) {
  const category = getLedgerCategoryValue(entry);
  const sourceOrDestination =
    entry.transactionType === "IN" &&
    entry.sourceType === "OTHER" &&
    entry.sourceName?.trim()
      ? `${category} (${entry.sourceName.trim()})`
      : category;

  return {
    Date: format(parseISO(entry.timestamp), "dd MMM yyyy, hh:mm a"),
    Type: TRANSACTION_LABELS[entry.transactionType],
    Product: entry.productName,
    Batch: entry.batchNumber,
    "Source / Destination": sourceOrDestination || "—",
    Quantity: formatQuantity(entry.quantityChanged, entry.baseUom),
    "Financial Impact": formatFinancialImpact(entry.financialValueChanged),
  };
}

export const ledgerColumns: ColumnDef<TransactionLedgerEntry>[] = [
  {
    accessorKey: "timestamp",
    id: "timestamp",
    header: ({ column }) => (
      <SortableHeader label="Date & Time" column={column} />
    ),
    cell: ({ row }) => (
      <span className="whitespace-nowrap text-sm">
        {format(parseISO(row.original.timestamp), "dd MMM yyyy, hh:mm a")}
      </span>
    ),
    sortingFn: (rowA, rowB) =>
      new Date(rowA.original.timestamp).getTime() -
      new Date(rowB.original.timestamp).getTime(),
  },
  {
    accessorKey: "transactionType",
    id: "transactionType",
    filterFn: multiSelectFilterFn,
    header: "Transaction Type",
    cell: ({ row }) => (
      <TransactionTypeBadge type={row.original.transactionType} />
    ),
  },
  {
    id: "productAndBatch",
    accessorFn: (row) => `${row.productName} ${row.batchNumber}`,
    header: "Product & Batch",
    cell: ({ row }) => (
      <div className="flex items-center gap-1.5">
        <div>
          <p className="font-medium">{row.original.productName}</p>
          <p className="text-sm text-muted-foreground">
            {row.original.batchNumber}
          </p>
        </div>
        {row.original.hasPackageImages && row.original.franchiseTransferId && (
          <PackageImagesViewer
            transferId={row.original.franchiseTransferId}
            compact
          />
        )}
      </div>
    ),
    enableSorting: false,
  },
  {
    id: "sourceOrDestination",
    accessorFn: (row) => getLedgerCategoryValue(row),
    filterFn: multiSelectFilterFn,
    header: ({ table }) => {
      const meta = table.options.meta as
        | { categoryHeader?: string }
        | undefined;
      return meta?.categoryHeader ?? "Source / Destination";
    },
    cell: ({ row }) => <SourceOrDestinationCell entry={row.original} />,
    enableSorting: false,
  },
  {
    accessorKey: "quantityChanged",
    id: "quantityChanged",
    header: ({ column }) => (
      <div className="text-right">
        <SortableHeader label="Quantity Changed" column={column} />
      </div>
    ),
    cell: ({ row }) => (
      <div className="text-right font-medium">
        {formatQuantity(row.original.quantityChanged, row.original.baseUom)}
      </div>
    ),
  },
  {
    accessorKey: "financialValueChanged",
    id: "financialValueChanged",
    header: ({ column }) => (
      <div className="text-right">
        <SortableHeader label="Financial Impact" column={column} />
      </div>
    ),
    cell: ({ row }) => {
      const value = row.original.financialValueChanged;
      return (
        <div
          className={`text-right font-semibold ${
            value > 0
              ? "text-green-700"
              : value < 0
                ? "text-red-600"
                : ""
          }`}
        >
          {formatFinancialImpact(value)}
        </div>
      );
    },
  },
];
