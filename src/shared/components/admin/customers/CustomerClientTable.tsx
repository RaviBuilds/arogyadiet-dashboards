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
import { ChevronDown, Filter } from "lucide-react";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/shared/components/ui/table";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/shared/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";
import { Badge } from "@/shared/components/ui/badge";

export interface Customer {
  id: string;
  fullName: string;
  email: string;
  mobile: string;
  dietary_preference: string;
  primary_pincode: string;
  status: string;
}

// 1. Custom Filter Function to handle multiple selected checkbox values
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
              className="-ml-3 h-8 data-[state=open]:bg-accent"
            >
              <span>Dietary Preference</span>
              <Filter className="ml-2 h-3.5 w-3.5 text-muted-foreground" />
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
              className="-ml-3 h-8 data-[state=open]:bg-accent"
            >
              <span>Status</span>
              <Filter className="ml-2 h-3.5 w-3.5 text-muted-foreground" />
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
    cell: ({ row }) => (
      <Badge
        variant={row.original.status === "Active" ? "default" : "secondary"}
      >
        {row.original.status}
      </Badge>
    ),
  },
];

export function CustomerClientTable({ data }: { data: Customer[] }) {
  const [sorting, setSorting] = React.useState<SortingState>([]);
  const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>(
    [],
  );
  const [columnVisibility, setColumnVisibility] =
    React.useState<VisibilityState>({});
  const [searchColumn, setSearchColumn] = React.useState("email");

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

  const searchPlaceholders: Record<string, string> = {
    fullName: "Enter the name...",
    email: "Search email address...",
    mobile: "Search mobile number...",
    primary_pincode: "Search pincode...",
  };

  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Outer Card with proper styling to match Operations */}
      <div className="bg-card border-border border rounded-xl shadow-sm">
        {/* Inner Padding container */}
        <div className="p-4 md:px-6">
          {/* Top Controls Row */}
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-2 flex-1 min-w-[300px]">
              <Select
                value={searchColumn}
                onValueChange={(val) => {
                  table.getColumn(searchColumn)?.setFilterValue("");
                  setSearchColumn(val);
                }}
              >
                <SelectTrigger className="w-[160px] bg-background">
                  <SelectValue placeholder="Select column" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="fullName">Full Name</SelectItem>
                  <SelectItem value="email">Email</SelectItem>
                  <SelectItem value="mobile">Mobile</SelectItem>
                  <SelectItem value="primary_pincode">Pincode</SelectItem>
                </SelectContent>
              </Select>
              <Input
                placeholder={searchPlaceholders[searchColumn]}
                value={
                  (table.getColumn(searchColumn)?.getFilterValue() as string) ??
                  ""
                }
                onChange={(event) =>
                  table
                    .getColumn(searchColumn)
                    ?.setFilterValue(event.target.value)
                }
                className="max-w-sm bg-background"
              />
            </div>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" className="ml-auto bg-background">
                  Columns <ChevronDown className="ml-2 h-4 w-4" />
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

          {/* The Horizontal Line with specific y-padding */}
          <hr className="my-5 border-border" />

          {/* Inner Table Wrapper (Rounded box) */}
          <div className="rounded-md border bg-card overflow-hidden">
            <Table>
              <TableHeader>
                {table.getHeaderGroups().map((headerGroup) => (
                  <TableRow key={headerGroup.id} className="bg-muted/10">
                    {headerGroup.headers.map((header) => {
                      return (
                        <TableHead key={header.id}>
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
                      className="hover:bg-muted/30"
                    >
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
                      colSpan={columns.length}
                      className="h-24 text-center text-muted-foreground"
                    >
                      No results.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>

          {/* Pagination */}
          <div className="flex items-center justify-end space-x-2 pt-5 pb-1">
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
      </div>
    </div>
  );
}