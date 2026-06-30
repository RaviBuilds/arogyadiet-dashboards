import { cookies } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { Users } from "lucide-react";
import { PageHeader } from "@/shared/components/franchise/ui/PageHeader";
import FranchiseCustomerDashboard from "./FranchiseCustomerDashboard";

export const revalidate = 0;

export default async function FranchiseCustomersPage() {
  const cookieStore = await cookies();
  const franchiseId = cookieStore.get("x-franchise-id")?.value ?? "";

  if (!franchiseId) {
    return (
      <div className="text-center py-12 text-slate-500">
        <p>Unable to determine franchise. Please contact support.</p>
      </div>
    );
  }

  const supabase = createAdminClient();

  // Fetch customers belonging to this franchise with full details
  const { data: rawCustomers, error } = await supabase
    .from("customer_profiles")
    .select(`
      id,
      is_active,
      dietary_preference,
      gender,
      date_of_birth,
      allergies,
      has_medical_history,
      franchise_id,
      users!inner ( id, full_name, email, mobile, is_active ),
      addresses ( pincode, is_primary ),
      subscriptions ( status, subscription_plans ( name ) )
    `)
    .eq("franchise_id", franchiseId);

  if (error) console.error("Error fetching franchise customers:", error);

  const customers = (rawCustomers || []).map((customer: any) => {
    const primaryAddress = customer.addresses?.find((addr: any) => addr.is_primary);

    let age = null;
    if (customer.date_of_birth) {
      const birthDate = new Date(customer.date_of_birth);
      const today = new Date();
      age = today.getFullYear() - birthDate.getFullYear();
      const m = today.getMonth() - birthDate.getMonth();
      if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) age--;
    }

    const activeSub = customer.subscriptions?.find((s: any) => s.status === "ACTIVE");
    const pendingSub = customer.subscriptions?.find((s: any) => s.status === "PENDING");
    const stoppedSub = customer.subscriptions?.find((s: any) => s.status === "STOPPED" || s.status === "CANCELLED");
    const expiredSub = customer.subscriptions?.find((s: any) => s.status === "EXPIRED");

    let displayStatus: string;
    let activePlanName: string | null = null;

    if (activeSub) {
      displayStatus = "Active";
      activePlanName = activeSub.subscription_plans?.name || "Custom Plan";
    } else if (pendingSub) {
      displayStatus = "Pending";
      activePlanName = pendingSub.subscription_plans?.name || "Custom Plan";
    } else if (stoppedSub) {
      displayStatus = "Stopped";
    } else if (expiredSub) {
      displayStatus = "Expired";
    } else {
      displayStatus = "No Plan";
    }

    return {
      id: customer.id,
      userId: customer.users?.id || "",
      fullName: customer.users?.full_name || "N/A",
      email: customer.users?.email || "N/A",
      mobile: customer.users?.mobile || "N/A",
      isActive: (customer.is_active ?? true) && (customer.users?.is_active ?? true),
      dietary_preference: customer.dietary_preference || "N/A",
      primary_pincode: primaryAddress?.pincode || "N/A",
      status: displayStatus,
      gender: customer.gender || "N/A",
      dateOfBirth: customer.date_of_birth || "",
      age,
      allergies: customer.allergies || null,
      hasMedicalHistory: customer.has_medical_history || false,
      activePlanName,
    };
  });

  return (
    <div className="flex flex-col gap-8 animate-in fade-in duration-500">
      <PageHeader
        title="Customers"
        subtitle="Manage your franchise customers and their subscriptions."
        icon={Users}
      />
      <FranchiseCustomerDashboard customers={customers} franchiseId={franchiseId} />
    </div>
  );
}
