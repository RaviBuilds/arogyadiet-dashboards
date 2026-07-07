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
      clinic_id,
      clinics ( name ),
      users!inner ( id, full_name, email, mobile, is_active ),
      addresses ( pincode, is_primary ),
      subscriptions ( status, customer_category, subscription_plans ( name ), kit_products ( name ) )
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

    // Priority order: Active > Pending > Stopped > Expired > No Plan
    const subs = customer.subscriptions || [];
    const activeSub = subs.find((s: any) => s.status === "ACTIVE");
    const pendingSub = subs.find((s: any) => s.status === "PENDING");
    const stoppedSub = subs.find((s: any) => s.status === "STOPPED" || s.status === "CANCELLED");
    const expiredSub = subs.find((s: any) => s.status === "EXPIRED");

    let displayStatus: string;
    let activePlanName: string | null = null;
    let customerCategory: string | null = null;

    // Determine highest-priority subscription for status + category
    const prioritySub = activeSub || pendingSub || stoppedSub || expiredSub;

    if (activeSub) {
      displayStatus = "Active";
      customerCategory = activeSub.customer_category || null;
      activePlanName =
        activeSub.customer_category === "KIT"
          ? activeSub.kit_products?.name || "KIT Plan"
          : activeSub.subscription_plans?.name || "Custom Plan";
    } else if (pendingSub) {
      displayStatus = "Pending";
      customerCategory = pendingSub.customer_category || null;
      activePlanName =
        pendingSub.customer_category === "KIT"
          ? pendingSub.kit_products?.name || "KIT Plan"
          : pendingSub.subscription_plans?.name || "Custom Plan";
    } else if (stoppedSub) {
      displayStatus = "Stopped";
      customerCategory = stoppedSub.customer_category || null;
    } else if (expiredSub) {
      displayStatus = "Expired";
      customerCategory = expiredSub.customer_category || null;
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
      customerCategory,
      clinic_id: customer.clinic_id || null,
      clinicName: customer.clinics?.name || null,
    };
  });

  return (
    <div className="flex flex-col gap-8 animate-in fade-in duration-500">
      <FranchiseCustomerDashboard customers={customers} franchiseId={franchiseId} />
    </div>
  );
}
