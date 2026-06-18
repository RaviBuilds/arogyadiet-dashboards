import { type Table } from "@tanstack/react-table";

import { type TransactionLedgerEntry } from "@/lib/inventory/product-schema";

import { formatLedgerRowForExport } from "./columns";

function escapeCsvValue(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function exportLedgerToCsv(
  table: Table<TransactionLedgerEntry>,
  fileName = "audit_ledger.csv",
): void {
  const rows = table.getFilteredRowModel().rows;
  if (rows.length === 0) return;

  const exportRows = rows.map((row) => formatLedgerRowForExport(row.original));
  const headers = Object.keys(exportRows[0]);

  const csvLines = [
    headers.join(","),
    ...exportRows.map((row) =>
      headers
        .map((header) =>
          escapeCsvValue(String(row[header as keyof typeof row])),
        )
        .join(","),
    ),
  ];

  const blob = new Blob([csvLines.join("\n")], {
    type: "text/csv;charset=utf-8;",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}
