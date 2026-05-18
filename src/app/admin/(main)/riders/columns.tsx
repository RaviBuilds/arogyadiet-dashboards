
"use client";

import { ColumnDef } from "@tanstack/react-table";
import { Badge } from "@/shared/components/ui/badge";

export interface Rider {
  id: string;
  fullName: string;
  mobile: string;
  employee_code: string;
  is_online: boolean;
  assigned_pincodes: string[];
}

export const columns: ColumnDef<Rider>[] = [
  { accessorKey: "fullName", header: "Full Name" },
  { accessorKey: "mobile", header: "Mobile" },
  { accessorKey: "employee_code", header: "Employee Code" },
  {
    accessorKey: "is_online",
    header: "Status",
    cell: ({ row }) => (
      <div className="flex items-center gap-2">
        <span
          className={`h-2.5 w-2.5 rounded-full ${row.original.is_online ? "bg-emerald-500" : "bg-muted-foreground"}`}
        />
        <span className="text-sm font-medium">
          {row.original.is_online ? "Online" : "Offline"}
        </span>
      </div>
    ),
  },
  {
    accessorKey: "assigned_pincodes",
    header: "Assigned Pincodes",
    cell: ({ row }) => (
      <div className="flex flex-wrap gap-1">
        {row.original.assigned_pincodes.map((pincode) => (
          <Badge key={pincode} variant="outline" className="bg-primary/5">
            {pincode}
          </Badge>
        ))}
      </div>
    ),
  },
];
