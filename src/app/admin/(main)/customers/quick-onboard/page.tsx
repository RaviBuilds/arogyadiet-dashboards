// src/app/admin/(main)/customers/quick-onboard/page.tsx
//
// RSC shell for the admin Quick_Onboarding_Form wizard (Task 9.2). It guards the
// "customers" admin group, loads the reference data the client wizard needs
// (active subscription plans + the franchise's serviceable pincodes), and hands
// them to the `"use client"` wizard leaf. All mutation logic lives in
// `onboardCustomerAction`; this page performs only reads.
//
// Requirements: 4.1-4.6, 7, 8.5, 10.2, 13.2, 15.2/15.3/15.6-15.11

import { AdminPageHeader } from "@/shared/components/admin/core/AdminPageHeader";
import { guardAdminGroup } from "@/lib/auth/adminAccess";
import { createAdminClient } from "@/lib/supabase/admin";
import { getServiceAreaPincodesAction } from "@/actions/pincodeActions";
import {
  QuickOnboardingForm,
  type OnboardingPlan,
} from "@/shared/components/admin/customers/QuickOnboardingForm";

export const revalidate = false;

export default async function QuickOnboardPage() {
  await guardAdminGroup("customers");

  const supabaseAdmin = createAdminClient();

  // Load active subscription plans for the Category/Plan step (Req 4.4) and the
  // serviceable pincodes that drive the Address_Capture serviceability gate
  // (Req 5.6), in parallel.
  const [{ data: rawPlans }, serviceAreaPincodes] = await Promise.all([
    supabaseAdmin
      .from("subscription_plans")
      .select("id, name, price, base_price, tax_amount, duration_days")
      .eq("is_active", true)
      .order("price", { ascending: true }),
    getServiceAreaPincodesAction(),
  ]);

  const plans: OnboardingPlan[] = (rawPlans ?? []).map((plan) => ({
    id: plan.id as string,
    name: (plan.name as string) ?? "Unnamed plan",
    price: Number(plan.price ?? 0),
    durationDays: Number(plan.duration_days ?? 0),
  }));

  return (
    <div className="flex flex-col gap-6 pb-4">
      <AdminPageHeader
        title="Quick Onboard Customer"
        description="Rapidly create a customer with priority details, a subscription, a map-captured address, and collected payment."
      />
      <QuickOnboardingForm
        plans={plans}
        serviceAreaPincodes={serviceAreaPincodes}
      />
    </div>
  );
}
