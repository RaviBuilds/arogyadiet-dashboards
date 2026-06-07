"use client";

import { type ColumnDef, type FilterFn } from "@tanstack/react-table";
import { format, parseISO } from "date-fns";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";

import {
  type BaseUom,
  type TransactionLedgerEntry,
  type TransactionType,
} from "@/lib/inventory/product-schema";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";

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
  return {
    Date: format(parseISO(entry.timestamp), "dd MMM yyyy, hh:mm a"),
    Type: TRANSACTION_LABELS[entry.transactionType],
    Product: entry.productName,
    Batch: entry.batchNumber,
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
      <div>
        <p className="font-medium">{row.original.productName}</p>
        <p className="text-sm text-muted-foreground">
          {row.original.batchNumber}
        </p>
      </div>
    ),
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
