// src/app/franchise/(main)/customers/quick-onboard/page.tsx
//
// RSC shell for the franchise Quick Onboarding wizard. Fetches franchise-scoped
// reference data (active plans, KIT products, serviceable pincodes) and passes
// them to the shared `QuickOnboardingForm` component. Clinic auto-assignment
// is resolved at onboarding time via the franchise → group → kitchen → clinic
// hierarchy inside the OnboardingService.
//
// Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.7, 17.5, 17.6

import { cookies } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { listKitProductsAction } from "@/actions/admin-actions/kitProductActions";
import { PageHeader } from "@/shared/components/franchise/ui/PageHeader";
import { UserPlus, AlertTriangle } from "lucide-react";
import {
  QuickOnboardingForm,
  type OnboardingPlan,
} from "@/shared/components/admin/customers/QuickOnboardingForm";

export const revalidate = false;

export default async function FranchiseQuickOnboardPage() {
  const cookieStore = await cookies();
  const franchiseId = cookieStore.get("x-franchise-id")?.value ?? "";

  if (!franchiseId) {
    return (
      <div className="flex flex-col gap-6 pb-4">
        <PageHeader
          title="Quick Onboard Customer"
          subtitle="Rapidly create a customer with essential details, subscription, address, and payment."
          icon={UserPlus}
        />
        <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-center">
          <AlertTriangle className="mx-auto h-8 w-8 text-red-500 mb-3" />
          <p className="text-red-700 font-medium">
            Unable to determine franchise context. Please contact support.
          </p>
        </div>
      </div>
    );
  }

  const supabaseAdmin = createAdminClient();

  // Verify the franchise has a resolvable clinic via its hierarchy
  // (franchise → group → kitchen → clinic). If no clinic exists, display error (Req 17.6).
  const { data: franchise } = await supabaseAdmin
    .from("franchises")
    .select("id, group_id")
    .eq("id", franchiseId)
    .single();

  let clinicResolutionError: string | null = null;

  if (franchise?.group_id) {
    // Resolve the Group's kitchen, then check if a clinic exists for this franchise
    // linked to that kitchen (Franchise → Group → Kitchen → Clinic)
    const { data: group } = await supabaseAdmin
      .from("groups")
      .select("kitchen_id")
      .eq("id", franchise.group_id)
      .single();

    if (!group?.kitchen_id) {
      clinicResolutionError =
        "Your franchise clinic configuration is incomplete. No kitchen is linked to your franchise's group. Please contact the administrator to configure the clinic hierarchy (Franchise → Group → Kitchen → Clinic).";
    } else {
      // Check if a clinic exists that belongs to this franchise and kitchen
      const { data: clinics } = await supabaseAdmin
        .from("clinics")
        .select("id")
        .eq("franchise_id", franchiseId)
        .eq("kitchen_id", group.kitchen_id)
        .limit(1);

      if (!clinics || clinics.length === 0) {
        clinicResolutionError =
          "Your franchise clinic configuration is incomplete. No clinic is linked to your franchise's kitchen group. Please contact the administrator to configure the clinic hierarchy (Franchise → Group → Kitchen → Clinic).";
      }
    }
  } else {
    clinicResolutionError =
      "Your franchise clinic configuration is incomplete. No group is assigned to your franchise. Please contact the administrator to complete the setup.";
  }

  if (clinicResolutionError) {
    return (
      <div className="flex flex-col gap-6 pb-4">
        <PageHeader
          title="Quick Onboard Customer"
          subtitle="Rapidly create a customer with essential details, subscription, address, and payment."
          icon={UserPlus}
        />
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-6 text-center">
          <AlertTriangle className="mx-auto h-8 w-8 text-amber-500 mb-3" />
          <p className="text-amber-800 font-medium mb-2">
            Franchise Clinic Configuration Incomplete
          </p>
          <p className="text-amber-700 text-sm">
            {clinicResolutionError}
          </p>
        </div>
      </div>
    );
  }

  // Fetch active plans, KIT products, and franchise-scoped serviceable pincodes
  // in parallel (Req 6.2).
  const [{ data: rawPlans }, kitProductsResult, { data: serviceAreaRows }] =
    await Promise.all([
      // Active subscription plans — global (no franchise_id on plans table)
      supabaseAdmin
        .from("subscription_plans")
        .select("id, name, price, base_price, tax_amount, duration_days")
        .eq("is_active", true)
        .order("price", { ascending: true }),
      // Active KIT products — global
      listKitProductsAction(),
      // Serviceable pincodes scoped to this franchise (Req 6.2)
      supabaseAdmin
        .from("rider_service_areas")
        .select("pincode")
        .eq("franchise_id", franchiseId),
    ]);

  // Transform plans to the form interface (Req 6.3)
  const plans: OnboardingPlan[] = (rawPlans ?? []).map((plan) => ({
    id: plan.id as string,
    name: (plan.name as string) ?? "Unnamed plan",
    price: Number(plan.price ?? 0),
    durationDays: Number(plan.duration_days ?? 0),
  }));

  // Transform KIT products
  const kitProducts = kitProductsResult.success ? kitProductsResult.data ?? [] : [];

  // Deduplicate and normalize franchise service area pincodes
  const serviceAreaPincodes = Array.from(
    new Set(
      (serviceAreaRows ?? [])
        .map((row) =>
          typeof row.pincode === "string" ? row.pincode.trim() : "",
        )
        .filter(Boolean),
    ),
  );

  return (
    <div className="flex flex-col gap-6 pb-4">
      <PageHeader
        title="Quick Onboard Customer"
        subtitle="Rapidly create a customer with essential details, subscription, address, and payment."
        icon={UserPlus}
      />
      <QuickOnboardingForm
        plans={plans}
        kitProducts={kitProducts}
        serviceAreaPincodes={serviceAreaPincodes}
        isFranchiseSession
        franchiseId={franchiseId}
      />
    </div>
  );
}
