import { createAdminClient } from "@/lib/supabase/admin";
import { AdminPageHeader } from "@/shared/components/admin/core/AdminPageHeader";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Customer360Dashboard } from "@/shared/components/admin/customers/Customer360Dashboard";
import { Button } from "@/shared/components/ui/button";
import { ChevronLeft } from "lucide-react";
import { guardCustomersWorkspace } from "@/lib/auth/adminAccess";
import * as kitLifecycleRepo from "@/repositories/kitLifecycleRepository";
import {
  buildAdminKitOverview,
  mapAdminKitRecord,
  resolveShippingTarget,
} from "@/lib/kit/adminKitOverview";
import {
  transformShippingInfoRow,
  type ShippingInfoRow,
} from "@/types/kitShipping";

export default async function Customer360Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { isDietitian } = await guardCustomersWorkspace();
  const supabase = createAdminClient();

  // ── 1. Customer profile ───────────────────────────────────────────────────
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
      clinic_id,
      franchise_id,
      dietitian_id,
      customer_code,
      users!customer_profiles_user_id_fkey!inner ( id, auth_user_id, full_name, email, mobile, is_active ),
      addresses ( id, tag, street_1, street_2, landmark, city, state, pincode, is_primary, lat, lng, updated_at ),
      medical_documents ( id, file_name, storage_path, uploaded_at, file_size_bytes ),
      subscriptions ( id, status, starts_on, ends_on, effective_end_on, customer_category, kit_duration_days, kit_received_date, kit_tracker_end_date, kit_total_skipped_days, subscription_plans ( name ), kit_products ( name, base_price, tax_rate ) )
      `,
    )
    .eq("id", id)
    .single();

  if (error || !data) {
    console.error("Error fetching customer profile:", error);
    notFound();
  }

  // ── 2. Signed URLs for medical documents ─────────────────────────────────
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

  // ── 3. Resolve active subscription (for "Add Subscription" form) ─────────
  const activeSubscription =
    (data.subscriptions as any[])?.find((s) => s.status === "ACTIVE") ?? null;

  // ── 3b. Resolve the customer's current Primary_Category + KIT details ────
  //       Prefers the ACTIVE subscription; falls back to the most recent one
  //       so KIT tabs still surface useful info for lapsed/ended KIT orders.
  const allSubscriptions = (data.subscriptions as any[]) ?? [];
  const currentSubscription =
    activeSubscription ??
    allSubscriptions.slice().sort((a, b) => {
      const aTime = a.starts_on ? new Date(a.starts_on).getTime() : 0;
      const bTime = b.starts_on ? new Date(b.starts_on).getTime() : 0;
      return bTime - aTime;
    })[0] ??
    null;

  // Treat the customer as KIT whenever they hold any KIT subscription and no
  // active subscription of another category. This keeps the KIT tabs for a
  // lapsed KIT customer (expired kit, replacement not yet started) and for a
  // brand-new PENDING kit, which has no starts_on to sort on — while a customer
  // who has moved to an active MEAL/ACCOMMODATION plan still gets that portal.
  const hasKitSubscription = allSubscriptions.some(
    (s) => s.customer_category === "KIT",
  );
  const hasActiveNonKitSubscription = allSubscriptions.some(
    (s) => s.status === "ACTIVE" && s.customer_category !== "KIT",
  );

  const customerCategory: string | null =
    hasKitSubscription && !hasActiveNonKitSubscription
      ? "KIT"
      : (currentSubscription?.customer_category ?? null);

  // ── 3c. Full KIT lifecycle for the KIT tab ───────────────────────────────
  //       Every KIT the customer has held, each with its courier row and daily
  //       logs, grouped into current / newly dispatched / history.
  const kitOverview =
    customerCategory === "KIT"
      ? buildAdminKitOverview(
          (await kitLifecycleRepo.getAdminKitRecordRows(id)).map(
            mapAdminKitRecord,
          ),
        )
      : null;

  // The Shipping tab manages one courier record at a time: the newest dispatch,
  // else the running KIT, else the most recent closed one.
  const shippingTarget = kitOverview ? resolveShippingTarget(kitOverview) : null;

  const kitSubscription = shippingTarget
    ? {
        subscriptionId: shippingTarget.subscriptionId,
        kitProductName: shippingTarget.kitProductName,
        kitDurationDays: shippingTarget.kitDurationDays,
        status: shippingTarget.status,
        startsOn: shippingTarget.startsOn,
        endsOn: shippingTarget.endsOn,
        basePrice: shippingTarget.basePrice,
        taxRate: shippingTarget.taxRate,
        kitReceivedDate: shippingTarget.kitReceivedDate,
        kitTrackerEndDate: shippingTarget.kitTrackerEndDate,
        kitTotalSkippedDays: shippingTarget.kitTotalSkippedDays,
      }
    : null;

  // Courier details for exactly that subscription. Queried directly instead of
  // via getShippingInfoAction(), which resolves only an ACTIVE subscription and
  // therefore returns nothing for a pending dispatch or an expired kit.
  let existingShippingInfo = null as ReturnType<
    typeof transformShippingInfoRow
  > | null;

  if (shippingTarget) {
    const { data: shippingRow } = await supabase
      .from("kit_shipping_info")
      .select("*")
      .eq("subscription_id", shippingTarget.subscriptionId)
      .maybeSingle();

    existingShippingInfo = shippingRow
      ? transformShippingInfoRow(shippingRow as ShippingInfoRow)
      : null;
  }

  // ── 4. Fetch lookup data for the subscription form + coupons ─────────────
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

  // ── 5. Shape the customer object ──────────────────────────────────────────
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

  const hasActiveSubscription = (data.subscriptions as any[])?.some(
    (s) => s.status === "ACTIVE",
  ) ?? false;

  // ── 5b. Resolve read-only Clinic/Dietitian names for a franchise customer
  //        (Req 8.7) — the Clinic Assignment card shows plain text, not a
  //        dropdown, when the Customer_Record carries a franchise_id.
  const customerFranchiseId = (data as any).franchise_id ?? null;
  const customerDietitianId = (data as any).dietitian_id ?? null;
  const customerClinicId = (data as any).clinic_id ?? null;

  let readOnlyClinicName: string | null = null;
  let readOnlyDietitianName: string | null = null;
  if (customerFranchiseId) {
    const [{ data: clinicRow }, { data: dietitianRow }] = await Promise.all([
      customerClinicId
        ? supabase.from("clinics").select("name").eq("id", customerClinicId).maybeSingle()
        : Promise.resolve({ data: null }),
      customerDietitianId
        ? supabase.from("users").select("full_name").eq("id", customerDietitianId).maybeSingle()
        : Promise.resolve({ data: null }),
    ]);
    readOnlyClinicName = (clinicRow as { name: string } | null)?.name ?? null;
    readOnlyDietitianName = (dietitianRow as { full_name: string } | null)?.full_name ?? null;
  }

  // ── 6. Shape lookup data for the Add Subscription form ───────────────────
  // Compute the previous (most recent non-active) subscription's effective_end_on
  const previousSubscription = allSubscriptions
    .filter((s: any) => s.status === "EXPIRED" || s.status === "CANCELLED")
    .sort((a: any, b: any) => {
      const aEnd = a.effective_end_on ?? a.ends_on ?? "";
      const bEnd = b.effective_end_on ?? b.ends_on ?? "";
      return bEnd.localeCompare(aEnd); // most recent first
    })[0] ?? null;

  const previousSubscriptionEndDate: string | null = previousSubscription
    ? (previousSubscription.effective_end_on as string) ??
      (previousSubscription.ends_on as string) ??
      null
    : null;

  const initialSubscriptionData = {
    activeSubscription: activeSubscription
      ? {
          id: activeSubscription.id as string,
          effective_end_on:
            (activeSubscription.effective_end_on as string) ??
            (activeSubscription.ends_on as string),
        }
      : null,
    previousSubscriptionEndDate,
    existingSubscriptions: allSubscriptions
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
      <AdminPageHeader
        title={`${customerData.full_name}'s Profile`}
        description="Manage the Customer"
        action={
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
        customerCategory={customerCategory}
        kitSubscription={kitSubscription}
        kitOverview={kitOverview}
        existingShippingInfo={existingShippingInfo}
        customerClinicId={customerClinicId}
        customerDietitianId={customerDietitianId}
        customerFranchiseId={customerFranchiseId}
        readOnlyClinicName={readOnlyClinicName}
        readOnlyDietitianName={readOnlyDietitianName}
        isDietitian={isDietitian}
      />
    </div>
  );
}
