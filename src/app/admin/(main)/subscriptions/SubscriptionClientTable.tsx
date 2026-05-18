"use client";

import { ColumnDef } from "@tanstack/react-table";
import { DataTable } from "@/shared/components/ui/data-table";

interface SubscriptionClientTableProps<TData, TValue> {
  columns: ColumnDef<TData, TValue>[];
  data: TData[];
}

export function SubscriptionClientTable<TData, TValue>({
  columns,
  data,
}: SubscriptionClientTableProps<TData, TValue>) {
  return <DataTable columns={columns} data={data} />;
}
