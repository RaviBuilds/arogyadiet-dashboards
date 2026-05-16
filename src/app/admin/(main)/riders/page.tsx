import { Button } from "@/shared/components/ui/button";
import { DataTable } from "@/shared/components/ui/data-table";
import { ColumnDef } from "@tanstack/react-table";
import { Badge } from "@/shared/components/ui/badge";
import { Card, CardContent } from "@/shared/components/ui/card";
import { createClient } from "@/lib/supabase/server";

interface Rider {
  id: string;
  fullName: string;
  mobile: string;
  employee_code: string;
  is_online: boolean;
  assigned_pincodes: string[];
}

const columns: ColumnDef<Rider>[] = [
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

export default async function RidersPage() {
  const supabase = await createClient();

  const { data: rawRiders, error } = await supabase.from("rider_profiles")
    .select(`
      id,
      employee_code,
      is_online,
      users!inner (
        full_name,
        mobile
      ),
      rider_service_areas (
        pincode
      )
    `);

  if (error) console.error("Error fetching riders:", error);

  const riders: Rider[] = (rawRiders || []).map((rider: any) => {
    const serviceAreas =
      rider.rider_service_areas?.map((area: any) => area.pincode) || [];
    return {
      id: rider.id,
      fullName: rider.users?.full_name || "N/A",
      mobile: rider.users?.mobile || "N/A",
      employee_code: rider.employee_code || "N/A",
      is_online: rider.is_online || false,
      assigned_pincodes: serviceAreas,
    };
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">
            Rider Management
          </h1>
          <p className="text-muted-foreground mt-1">
            Monitor delivery partners and their service areas.
          </p>
        </div>
        <Button>Onboard Rider</Button>
      </div>

      <Card>
        <CardContent className="p-0">
          <DataTable columns={columns} data={riders} />
        </CardContent>
      </Card>
    </div>
  );
}
