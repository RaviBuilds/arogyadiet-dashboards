import { cookies } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, UserCog } from "lucide-react";

import { createAdminClient } from "@/lib/supabase/admin";
import { PageHeader } from "@/shared/components/franchise/ui/PageHeader";
import { Button } from "@/shared/components/ui/button";
import { Customer360Dashboard } from "@/shared/components/admin/customers/Customer360Dashboard";

import { franchiseAddSubscription } from "@/actions/franchise-actions/franchiseSubscriptionActions";
import {
  franchiseUpdateCustomerBasicInfo,
  franchiseUpdateCustomerDietaryProfile,
  franchiseUpdateCustomerMedicalProfile,
  franchiseDeleteMedicalDocument,
  franchiseUploadMedicalDocument,
  franchiseUpsertCustomerAddress,
  franchiseDeleteCustomerAddress,
  franchiseSetCustomerPassword,
  franchiseSendPasswordReset,
  franchiseToggleCustomerActive,
  franchiseDeactivateCustomerAccount,
  franchiseCreateCustomerCoupon,
  franchiseDeleteCustomerCoupon,
} from "@/actions/franchise-actions/franchiseCustomerManagementActions";

export const revalidate = 0;

export default async function FranchiseCustomer360Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const cookieStore = await cookies();
  const franchiseId = cookieStore.get("x-franchise-id")?.value ?? "";

  if (!franchiseId) {
    notFound();
  }

  const supabase = createAdminClient();

  // ── 1. Customer profile (scoped to the calling franchise) ──────────────────
  const { data, error } = await supabase
    .from("customer_profiles")
    .select(
      `
      id,
      is_active,
      dietary_preference,
      gender,
      date_of_birth,
      allergies,
      medical_history_notes,
      has_medical_history,
      franchise_id,
      users!inner ( id, auth_user_id, full_name, email, mobile, is_active ),
      addresses ( id, tag, street_1, street_2, landmark, city, state, pincode, is_primary, lat, lng, updated_at ),
      medical_documents ( id, file_name, storage_path, uploaded_at, file_size_bytes ),
      subscriptions ( id, status, starts_on, ends_on, effective_end_on, subscription_plans ( name ) )
      `,
    )
    .eq("id", id)
    .eq("franchise_id", franchiseId)
    .single();

  if (error || !data) {
    notFound();
  }

  // ── 2. Signed URLs for medical documents ───────────────────────────────────
  let documentsWithUrls: {
    id: string;
    file_name: string;
    storage_path: string;
    uploaded_at: string;
    signedUrl?: string;
  }[] = [];

  if (data.medical_documents && data.medical_documents.length > 0) {
    documentsWithUrls = await Promise.all(
      (data.medical_documents as any[]).map(async (doc) => {
        const { data: urlData } = await supabase.storage
          .from("medical_records")
          .createSignedUrl(doc.storage_path, 3600);
        return {
          id: doc.id,
          file_name: doc.file_name,
          storage_path: doc.storage_path,
          uploaded_at: doc.uploaded_at,
          signedUrl: urlData?.signedUrl ?? undefined,
        };
      }),
    );
  }

  // ── 3. Resolve active subscription (for "Add Subscription" form) ───────────
  const activeSubscription =
    (data.subscriptions as any[])?.find((s) => s.status === "ACTIVE") ?? null;

  // ── 4. Lookup data for the subscription form + coupons ─────────────────────
  const [
    { data: subscriptionPlans },
    { data: mealCategories },
    { data: coupons },
    { data: payments },
  ] = await Promise.all([
    supabase
      .from("subscription_plans")
      .select("id, name, price, duration_days, pause_credits, is_active")
      .order("price"),
    supabase.from("meal_categories").select("id, code, name").order("name"),
    supabase
      .from("coupons")
      .select(
        "id, code, discount_type, discount_value_30_days, discount_value_60_days, discount_value_90_days, flat_discounts_by_plan, discount_value, max_uses, times_used, expires_at, created_at",
      )
      .eq("customer_profile_id", id)
      .order("created_at", { ascending: false }),
    supabase
      .from("payments")
      .select(
        `
        id,
        amount,
        payment_method,
        status,
        created_at,
        paid_at,
        subscription_id,
        base_amount,
        tax_percent,
        tax_amount,
        discount_amount,
        invoice_type,
        payment_reference,
        payment_notes,
        subscriptions (
          subscription_code,
          status,
          subscription_plans ( name )
        )
        `,
      )
      .eq("customer_profile_id", id)
      .order("created_at", { ascending: false }),
  ]);

  // ── 5. Shape the customer object ────────────────────────────────────────────
  const userData = data.users as any;

  const customerData = {
    userId: userData?.id ?? "",
    authUserId: userData?.auth_user_id ?? "",
    isActive: userData?.is_active ?? true,
    id: data.id,
    full_name: userData?.full_name ?? "N/A",
    email: userData?.email ?? "N/A",
    mobile: userData?.mobile ?? "N/A",
    gender: (data.gender as string) ?? "N/A",
    date_of_birth: (data.date_of_birth as string) ?? "N/A",
    dietary_preference: (data.dietary_preference as string) ?? "N/A",
    allergies: (data.allergies as string) ?? "None",
    medical_history_notes: (data.medical_history_notes as string) ?? "N/A",
    has_medical_history: (data.has_medical_history as boolean) ?? false,
    medical_documents: documentsWithUrls,
    addresses: ((data.addresses as any[]) ?? []).map((a) => ({
      id: a.id as string,
      tag: (["Home", "Work", "Other"].includes(a.tag) ? a.tag : "Home") as
        | "Home"
        | "Work"
        | "Other",
      street_1: (a.street_1 as string) ?? "",
      street_2: (a.street_2 as string) ?? "",
      landmark: (a.landmark as string) ?? "",
      city: (a.city as string) ?? "Hyderabad",
      state: (a.state as string) ?? "Telangana",
      pincode: (a.pincode as string) ?? "",
      is_primary: (a.is_primary as boolean) ?? false,
      lat: (a.lat as number | null) ?? null,
      lng: (a.lng as number | null) ?? null,
      updated_at: (a.updated_at as string) ?? "",
    })),
  };

  const hasActiveSubscription =
    (data.subscriptions as any[])?.some((s) => s.status === "ACTIVE") ?? false;

  const initialSubscriptionData = {
    activeSubscription: activeSubscription
      ? {
          id: activeSubscription.id as string,
          effective_end_on:
            (activeSubscription.effective_end_on as string) ??
            (activeSubscription.ends_on as string),
        }
      : null,
    previousSubscriptionEndDate: (() => {
      const allSubs = (data.subscriptions as any[]) ?? [];
      const prev = allSubs
        .filter((s: any) => s.status === "EXPIRED" || s.status === "CANCELLED")
        .sort((a: any, b: any) => {
          const aEnd = a.effective_end_on ?? a.ends_on ?? "";
          const bEnd = b.effective_end_on ?? b.ends_on ?? "";
          return bEnd.localeCompare(aEnd); // most recent first
        })[0] ?? null;
      return prev
        ? (prev.effective_end_on as string) ?? (prev.ends_on as string) ?? null
        : null;
    })(),
    existingSubscriptions: ((data.subscriptions as any[]) ?? [])
      .filter((s: any) => s.status === "ACTIVE" || s.status === "PENDING")
      .map((s: any) => ({
        starts_on: s.starts_on as string,
        effective_end_on: (s.effective_end_on as string) ?? (s.ends_on as string),
        status: s.status as string,
      })),
    subscriptionPlans: (subscriptionPlans ?? []).map((p: any) => ({
      id: p.id as string,
      name: p.name as string,
      price: p.price as number,
      duration_days: p.duration_days as number,
      pause_credits: p.pause_credits as number,
      is_active: p.is_active as boolean,
    })),
    mealCategories: (mealCategories ?? []).map((c: any) => ({
      id: c.id as string,
      code: c.code as string,
      name: c.name as string,
    })),
    addresses: ((data.addresses as any[]) ?? []).map((a) => ({
      id: a.id as string,
      tag: (a.tag as string) ?? "Home",
      street_1: a.street_1 as string,
      city: a.city as string,
      pincode: a.pincode as string,
    })),
  };

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title={`${customerData.full_name}'s Profile`}
        subtitle="Manage the customer"
        icon={UserCog}
        actions={
          <Button variant="outline" asChild>
            <Link href="/customers">
              <ChevronLeft className="h-4 w-4 mr-2" /> Back to Directory
            </Link>
          </Button>
        }
      />
      <Customer360Dashboard
        customer={customerData}
        initialSubscriptionData={initialSubscriptionData}
        initialCoupons={(coupons ?? []) as any[]}
        billingPayments={(payments ?? []) as any[]}
        hasActiveSubscription={hasActiveSubscription}
        franchiseId={franchiseId}
        backHref="/customers"
        addSubscriptionAction={franchiseAddSubscription as any}
        createCouponAction={franchiseCreateCustomerCoupon as any}
        deleteCouponAction={franchiseDeleteCustomerCoupon as any}
        uploadMedicalAction={franchiseUploadMedicalDocument}
        actions={{
          updateCustomerBasicInfo: franchiseUpdateCustomerBasicInfo,
          updateCustomerDietaryProfile: franchiseUpdateCustomerDietaryProfile,
          updateCustomerMedicalProfile: franchiseUpdateCustomerMedicalProfile,
          deleteMedicalDocument: franchiseDeleteMedicalDocument,
          adminUpsertCustomerAddress: franchiseUpsertCustomerAddress,
          adminDeleteCustomerAddress: franchiseDeleteCustomerAddress,
          adminSetCustomerPassword: franchiseSetCustomerPassword,
          adminSendPasswordReset: franchiseSendPasswordReset,
          adminToggleCustomerActive: franchiseToggleCustomerActive,
          deactivateCustomerAccount: franchiseDeactivateCustomerAccount,
        }}
      />
    </div>
  );
}
