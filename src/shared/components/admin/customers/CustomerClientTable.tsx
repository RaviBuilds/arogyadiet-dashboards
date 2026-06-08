"use client";

import * as React from "react";
import {
  ColumnDef,
  ColumnFiltersState,
  SortingState,
  VisibilityState,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { ChevronDown, Filter, Users } from "lucide-react";
import { useRouter } from "next/navigation";
import * as XLSX from "xlsx";
import { toast } from "sonner";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/shared/components/ui/table";
import { Button } from "@/shared/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/shared/components/ui/dropdown-menu";

// Core Design System Components
import { DataTableCard } from "../core/DataTableCard";
import { SectionHeader } from "../core/SectionHeader";
import { DataSearchFilter } from "../core/DataSearchFilter";
import { StatusBadge } from "../core/StatusBadge";
import { ExportButton, RefreshButton } from "../core/ActionButtons";

export interface Customer {
  id: string;
  fullName: string;
  email: string;
  mobile: string;
  dietary_preference: string;
  primary_pincode: string;
  status: string;
}

const multiSelectFilterFn = (row: any, id: string, value: string[]) => {
  if (!value || value.length === 0) return true;
  return value.includes(row.getValue(id));
};

const columns: ColumnDef<Customer>[] = [
  { accessorKey: "fullName", id: "fullName", header: "Full Name" },
  { accessorKey: "email", id: "email", header: "Email" },
  { accessorKey: "mobile", id: "mobile", header: "Mobile" },
  {
    accessorKey: "dietary_preference",
    id: "dietary_preference",
    filterFn: multiSelectFilterFn,
    header: ({ column }) => {
      const filterValue = (column.getFilterValue() as string[]) ?? [];
      return (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="-ml-3 h-8 text-xs font-medium uppercase tracking-wider text-slate-500 transition-all duration-200 hover:text-slate-900 data-[state=open]:bg-slate-100"
            >
              <span>Dietary Preference</span>
              <Filter className="ml-2 h-3.5 w-3.5 text-slate-400" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-[150px]">
            {["Veg", "Non-Veg", "N/A"].map((option) => (
              <DropdownMenuCheckboxItem
                key={option}
                className="flex items-center gap-2 pr-4"
                checked={filterValue.includes(option)}
                onCheckedChange={(checked) => {
                  const newValue = checked
                    ? [...filterValue, option]
                    : filterValue.filter((v) => v !== option);
                  column.setFilterValue(newValue.length ? newValue : undefined);
                }}
              >
                {option}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      );
    },
  },
  {
    accessorKey: "primary_pincode",
    id: "primary_pincode",
    header: "Primary Pincode",
  },
  {
    accessorKey: "status",
    id: "status",
    filterFn: multiSelectFilterFn,
    header: ({ column }) => {
      const filterValue = (column.getFilterValue() as string[]) ?? [];
      return (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="-ml-3 h-8 text-xs font-medium uppercase tracking-wider text-slate-500 transition-all duration-200 hover:text-slate-900 data-[state=open]:bg-slate-100"
            >
              <span>Status</span>
              <Filter className="ml-2 h-3.5 w-3.5 text-slate-400" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-[150px]">
            {["Active", "Inactive"].map((option) => (
              <DropdownMenuCheckboxItem
                key={option}
                className="flex items-center gap-2 pr-4"
                checked={filterValue.includes(option)}
                onCheckedChange={(checked) => {
                  const newValue = checked
                    ? [...filterValue, option]
                    : filterValue.filter((v) => v !== option);
                  column.setFilterValue(newValue.length ? newValue : undefined);
                }}
              >
                {option}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      );
    },
    cell: ({ row }) => <StatusBadge status={row.original.status} />,
  },
];

export function CustomerClientTable({ data }: { data: Customer[] }) {
  const router = useRouter();
  const [sorting, setSorting] = React.useState<SortingState>([]);
  const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>(
    [],
  );
  const [columnVisibility, setColumnVisibility] =
    React.useState<VisibilityState>({});
  const [searchColumn, setSearchColumn] = React.useState("email");
  const [isRefreshing, setIsRefreshing] = React.useState(false);

  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    onSortingChange: setSorting,
    getSortedRowModel: getSortedRowModel(),
    onColumnFiltersChange: setColumnFilters,
    getFilteredRowModel: getFilteredRowModel(),
    onColumnVisibilityChange: setColumnVisibility,
    state: { sorting, columnFilters, columnVisibility },
  });

  const handleRefresh = () => {
    setIsRefreshing(true);
    router.refresh();
    setTimeout(() => {
      setIsRefreshing(false);
      toast.success("Data refreshed successfully");
    }, 500);
  };

  const handleExportExcel = () => {
    const exportData = table.getFilteredRowModel().rows.map((row) => ({
      "Full Name": row.original.fullName,
      Email: row.original.email,
      Mobile: row.original.mobile,
      "Dietary Pref": row.original.dietary_preference,
      Pincode: row.original.primary_pincode,
      Status: row.original.status,
    }));

    if (exportData.length === 0) return;

    const worksheet = XLSX.utils.json_to_sheet(exportData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Customers");
    XLSX.writeFile(
      workbook,
      `Customers_${new Date().toISOString().split("T")[0]}.xlsx`,
    );
  };

  return (
    <DataTableCard
      header={<SectionHeader title="Customer Directory" icon={Users} />}
      controls={
        <div className="flex flex-wrap items-center gap-4">
          <DataSearchFilter
            searchColumn={searchColumn}
            onColumnChange={(val) => {
              table.getColumn(searchColumn)?.setFilterValue("");
              setSearchColumn(val);
            }}
            searchTerm={
              (table.getColumn(searchColumn)?.getFilterValue() as string) ?? ""
            }
            onTermChange={(val) =>
              table.getColumn(searchColumn)?.setFilterValue(val)
            }
            options={[
              { value: "fullName", label: "Full Name" },
              { value: "email", label: "Email" },
              { value: "mobile", label: "Mobile Number" },
              { value: "primary_pincode", label: "Area Pincode" },
            ]}
          />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                className="border-slate-200 bg-white transition-all duration-200 hover:bg-slate-50"
              >
                Columns{" "}
                <ChevronDown className="ml-2 h-4 w-4 text-slate-500" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {table
                .getAllColumns()
                .filter((column) => column.getCanHide())
                .map((column) => {
                  return (
                    <DropdownMenuCheckboxItem
                      key={column.id}
                      className="capitalize flex items-center gap-2 pr-4"
                      checked={column.getIsVisible()}
                      onCheckedChange={(value) =>
                        column.toggleVisibility(!!value)
                      }
                    >
                      {column.id.replace(/_/g, " ")}
                    </DropdownMenuCheckboxItem>
                  );
                })}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      }
      actions={
        <>
          <ExportButton
            onClick={handleExportExcel}
            disabled={table.getFilteredRowModel().rows.length === 0}
          />
          <RefreshButton onClick={handleRefresh} isLoading={isRefreshing} />
        </>
      }
      footer={
        <div className="flex w-full items-center justify-between">
          <p className="text-sm text-slate-500">
            Showing{" "}
            <span className="font-medium text-slate-900">
              {table.getFilteredRowModel().rows.length}
            </span>{" "}
            customers
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="border-slate-200 transition-all duration-200 hover:bg-slate-50"
              onClick={() => table.previousPage()}
              disabled={!table.getCanPreviousPage()}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="border-slate-200 transition-all duration-200 hover:bg-slate-50"
              onClick={() => table.nextPage()}
              disabled={!table.getCanNextPage()}
            >
              Next
            </Button>
          </div>
        </div>
      }
    >
      <Table>
        <TableHeader>
          {table.getHeaderGroups().map((headerGroup) => (
            <TableRow key={headerGroup.id} className="border-b border-slate-200 bg-slate-50/50">
              {headerGroup.headers.map((header) => {
                return (
                  <TableHead
                    key={header.id}
                    className="text-xs font-medium uppercase tracking-wider text-slate-500"
                  >
                    {header.isPlaceholder
                      ? null
                      : flexRender(
                          header.column.columnDef.header,
                          header.getContext(),
                        )}
                  </TableHead>
                );
              })}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {table.getRowModel().rows?.length ? (
            table.getRowModel().rows.map((row) => (
              <TableRow
                key={row.id}
                data-state={row.getIsSelected() && "selected"}
                className="transition-colors duration-200 hover:bg-slate-50"
              >
                {row.getVisibleCells().map((cell) => (
                  <TableCell key={cell.id}>
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </TableCell>
                ))}
              </TableRow>
            ))
          ) : (
            <TableRow>
              <TableCell
                colSpan={columns.length}
                className="py-12 text-center text-sm text-slate-500"
              >
                No customers found matching your filters.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </DataTableCard>
  );
}
