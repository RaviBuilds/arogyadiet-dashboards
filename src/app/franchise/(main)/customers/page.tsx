import { cookies } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { Users } from "lucide-react";
import { PageHeader } from "@/shared/components/franchise/ui/PageHeader";
import FranchiseCustomerDashboard from "./FranchiseCustomerDashboard";

export const revalidate = 0;

/**
 * Resolve whether the signed-in franchise user is a Franchise Dietitian
 * (dietitian-management, Req 23.1, 23.2) — read directly here rather than via
 * `guardDietitianPage`/`getCurrentAdminContext`, since this page is reachable
 * by every franchise Access_Level and must render the FULL workspace for
 * every level except `dietitian`, not redirect them away.
 */
async function resolveIsFranchiseDietitian(): Promise<boolean> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return false;

  const { data } = await supabase
    .from("users")
    .select("admin_access_level")
    .eq("auth_user_id", user.id)
    .maybeSingle();

  return data?.admin_access_level === "dietitian";
}

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

  const isDietitian = await resolveIsFranchiseDietitian();
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
      users!customer_profiles_user_id_fkey!inner ( id, full_name, email, mobile, is_active ),
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
      <FranchiseCustomerDashboard
        customers={customers}
        franchiseId={franchiseId}
        isDietitian={isDietitian}
      />
    </div>
  );
}
