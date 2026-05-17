import { Button } from "@/shared/components/ui/button";
import { createClient } from "@/lib/supabase/server";
import CustomerDashboard from "@/shared/components/admin/customers/CustomerDashboard";

export default async function CustomersPage() {
  const supabase = await createClient();

  const { data: rawCustomers, error } = await supabase.from("customer_profiles")
    .select(`
      id,
      is_active,
      dietary_preference,
      users!inner (
        full_name,
        email,
        mobile
      ),
      addresses (
        pincode,
        is_primary
      )
    `);

  if (error) console.error("Error fetching customers:", error);

  // Map the raw data into our safe Customer interface
  const customers = (rawCustomers || []).map((customer: any) => {
    const primaryAddress = customer.addresses?.find(
      (addr: any) => addr.is_primary,
    );
    return {
      id: customer.id,
      fullName: customer.users?.full_name || "N/A",
      email: customer.users?.email || "N/A",
      mobile: customer.users?.mobile || "N/A",
      dietary_preference: customer.dietary_preference || "N/A",
      primary_pincode: primaryAddress?.pincode || "N/A",
      status: customer.is_active ? "Active" : "Inactive",
    };
  });

  return (
    <div className="space-y-6 flex flex-col">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Customers</h1>
          <p className="text-muted-foreground mt-1">
            Manage your subscriber base and account statuses.
          </p>
        </div>
        <Button>Create Customer</Button>
      </div>

      {/* Render the new Tabbed Dashboard layout */}
      <CustomerDashboard customers={customers} />
    </div>
  );
}
