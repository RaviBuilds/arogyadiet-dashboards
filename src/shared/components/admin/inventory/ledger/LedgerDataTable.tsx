"use client";

import { useMemo, useState } from "react";
import {
  type ColumnFiltersState,
  type SortingState,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";
import {
  endOfDay,
  isAfter,
  isBefore,
  parseISO,
  startOfDay,
} from "date-fns";
import { Download, Filter } from "lucide-react";
import { type DateRange } from "react-day-picker";

import {
  TRANSACTION_TYPES,
  type TransactionLedgerEntry,
} from "@/lib/inventory/product-schema";
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

import { TRANSACTION_LABELS, ledgerColumns } from "./columns";
import { exportLedgerToCsv } from "./export-ledger-csv";

interface LedgerDataTableProps {
  data: TransactionLedgerEntry[];
}

export default function LedgerDataTable({ data }: LedgerDataTableProps) {
  const [sorting, setSorting] = useState<SortingState>([
    { id: "timestamp", desc: true },
  ]);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [globalFilter, setGlobalFilter] = useState("");
  const [dateRange, setDateRange] = useState<DateRange | undefined>();

  const dateFilteredData = useMemo(() => {
    if (!dateRange?.from) return data;

    return data.filter((entry) => {
      const entryDate = parseISO(entry.timestamp);
      if (isBefore(entryDate, startOfDay(dateRange.from!))) return false;
      if (dateRange.to && isAfter(entryDate, endOfDay(dateRange.to))) {
        return false;
      }
      return true;
    });
  }, [data, dateRange]);

  const table = useReactTable({
    data: dateFilteredData,
    columns: ledgerColumns,
    state: { sorting, columnFilters, globalFilter },
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onGlobalFilterChange: setGlobalFilter,
    globalFilterFn: (row, _columnId, filterValue) => {
      const query = String(filterValue).toLowerCase();
      if (!query) return true;
      const { productName, batchNumber } = row.original;
      return (
        productName.toLowerCase().includes(query) ||
        batchNumber.toLowerCase().includes(query)
      );
    },
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize: 25 } },
  });

  const typeFilterValue =
    (table.getColumn("transactionType")?.getFilterValue() as string[]) ?? [];
  const filteredCount = table.getFilteredRowModel().rows.length;

  return (
    <Card className="border shadow-sm">
      <CardHeader>
        <CardTitle>Transaction History</CardTitle>
        <CardDescription>
          {filteredCount} transaction{filteredCount === 1 ? "" : "s"} shown
          {dateFilteredData.length !== data.length
            ? ` (filtered from ${data.length} loaded)`
            : ` (of ${data.length} loaded)`}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <Input
            placeholder="Search products or batches..."
            value={globalFilter}
            onChange={(event) => setGlobalFilter(event.target.value)}
            className="max-w-xs"
          />

          <DatePickerWithRange date={dateRange} onDateChange={setDateRange} />

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" className="gap-2">
                <Filter className="h-4 w-4" />
                Transaction Type
                {typeFilterValue.length > 0 && (
                  <span className="text-xs text-muted-foreground">
                    ({typeFilterValue.length})
                  </span>
                )}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-52">
              {TRANSACTION_TYPES.map((type) => (
                <DropdownMenuCheckboxItem
                  key={type}
                  checked={typeFilterValue.includes(type)}
                  onCheckedChange={(checked) => {
                    const next = checked
                      ? [...typeFilterValue, type]
                      : typeFilterValue.filter((value) => value !== type);
                    table
                      .getColumn("transactionType")
                      ?.setFilterValue(next.length ? next : undefined);
                  }}
                >
                  {TRANSACTION_LABELS[type]}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          <Button
            variant="outline"
            className="ml-auto gap-2"
            disabled={filteredCount === 0}
            onClick={() => exportLedgerToCsv(table)}
          >
            <Download className="h-4 w-4" />
            Export CSV
          </Button>
        </div>

        <div className="rounded-md border">
          <Table>
            <TableHeader>
              {table.getHeaderGroups().map((headerGroup) => (
                <TableRow key={headerGroup.id} className="bg-muted/10">
                  {headerGroup.headers.map((header) => (
                    <TableHead key={header.id}>
                      {header.isPlaceholder
                        ? null
                        : flexRender(
                            header.column.columnDef.header,
                            header.getContext(),
                          )}
                    </TableHead>
                  ))}
                </TableRow>
              ))}
            </TableHeader>
            <TableBody>
              {table.getRowModel().rows.length ? (
                table.getRowModel().rows.map((row) => (
                  <TableRow key={row.id} className="hover:bg-muted/50">
                    {row.getVisibleCells().map((cell) => (
                      <TableCell key={cell.id}>
                        {flexRender(
                          cell.column.columnDef.cell,
                          cell.getContext(),
                        )}
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell
                    colSpan={ledgerColumns.length}
                    className="h-24 text-center text-muted-foreground"
                  >
                    No transactions match your filters.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">
            Page {table.getState().pagination.pageIndex + 1} of{" "}
            {Math.max(table.getPageCount(), 1)} · {filteredCount} transaction
            {filteredCount === 1 ? "" : "s"}
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => table.previousPage()}
              disabled={!table.getCanPreviousPage()}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => table.nextPage()}
              disabled={!table.getCanNextPage()}
            >
              Next
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
