import { ColumnDef } from "@tanstack/react-table";

export type Subscription = {
  id: string;
  status: string;
  starts_on: string;
  ends_on: string;
  pause_credits_total: number;
  pause_credits_used: number;
  customer_name: string;
  customer_email: string;
  plan_name: string;
};

export const columns: ColumnDef<Subscription>[] = [
  {
    accessorKey: "id",
    header: "ID",
  },
  {
    accessorKey: "customer_name",
    header: "Customer Name",
  },
  {
    accessorKey: "customer_email",
    header: "Customer Email",
  },
  {
    accessorKey: "plan_name",
    header: "Plan Name",
  },
  {
    accessorKey: "status",
    header: "Status",
  },
  {
    accessorKey: "starts_on",
    header: "Starts On",
  },
  {
    accessorKey: "ends_on",
    header: "Ends On",
  },
  {
    accessorKey: "pause_credits_total",
    header: "Pause Credits Total",
  },
  {
    accessorKey: "pause_credits_used",
    header: "Pause Credits Used",
  },
];
