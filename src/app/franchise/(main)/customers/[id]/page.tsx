import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, UserCog } from "lucide-react";

import { createAdminClient } from "@/lib/supabase/admin";
import { guardFranchiseCustomersWorkspace } from "@/lib/auth/adminAccess";
import { PageHeader } from "@/shared/components/franchise/ui/PageHeader";
import { Button } from "@/shared/components/ui/button";
import { Customer360Dashboard } from "@/shared/components/admin/customers/Customer360Dashboard";
import { DietitianAssignmentSelector } from "@/shared/components/admin/customers/DietitianAssignmentSelector";
import {
  franchiseListDietitians,
  franchiseAssignCustomerDietitian,
} from "@/actions/franchise-actions/franchiseDietitianAssignmentActions";
import { getSubscriptionPaymentOverview } from "@/services/SubscriptionPaymentService";
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
import {
  resolveCustomerCategory,
  type CategorizableSubscription,
} from "@/lib/kit/resolveCustomerCategory";

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
  franchiseUpdateCustomerEmail,
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

  // Authorization + tenant identity in one resolution (franchise-scoped-access
  // Task 5). Replaces an `x-franchise-id` cookie read that performed no
  // Operations_Group check: `franchiseId` now comes from the caller's own
  // `users` row, a suspended franchise is rejected, and a user without the
  // customers group is redirected to their landing route instead of reaching
  // this page.
  const { franchiseId, canManage, isDietitian } =
    await guardFranchiseCustomersWorkspace();

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
      dietitian_id,
      users!customer_profiles_user_id_fkey!inner ( id, auth_user_id, full_name, email, mobile, is_active ),
      addresses ( id, tag, street_1, street_2, landmark, city, state, pincode, is_primary, lat, lng, updated_at ),
      medical_documents ( id, file_name, storage_path, uploaded_at, file_size_bytes ),
      subscriptions ( id, status, starts_on, ends_on, effective_end_on, customer_category, kit_duration_days, kit_received_date, kit_tracker_end_date, kit_total_skipped_days, subscription_plans ( name ), kit_products ( name, base_price, tax_rate ) )
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

  // ── 3b. Primary_Category + full KIT lifecycle ──────────────────────────────
  //
  // Franchise sells MEAL and KIT (never Accommodation). Until now this page
  // passed no `customerCategory` at all, so `Customer360Dashboard` fell into its
  // `else` branch and served a franchise KIT customer the MEAL tab set —
  // Subscription and Coupons — while KIT, Shipping and KIT History never
  // appeared. Resolving the category here is what switches the dashboard onto
  // its KIT branch.
  //
  // The rule below is carried over from `admin/(main)/customers/[id]/page.tsx`
  // deliberately, so both portals classify a customer identically: hold any KIT
  // subscription and no ACTIVE subscription of another category => KIT. That
  // keeps the KIT tabs for a lapsed kit and for a brand-new PENDING one (which
  // has no `starts_on` to sort on), while a customer who has moved onto an
  // active MEAL plan gets the MEAL portal.
  const allSubscriptions: CategorizableSubscription[] =
    (data.subscriptions as CategorizableSubscription[] | null) ?? [];
  const customerCategory = resolveCustomerCategory(allSubscriptions);

  // Every KIT this customer has held, each with its courier row and daily logs,
  // grouped into current / newly dispatched / history. The repository read is
  // already scoped to this customer, and the customer itself was fetched with
  // `.eq("franchise_id", franchiseId)` above, so the tenant boundary holds.
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

  // Courier details for exactly that subscription. Queried directly rather than
  // through `getShippingInfoAction()`, which resolves only an ACTIVE
  // subscription and so returns nothing for a pending dispatch or an expired
  // kit — the same reason the admin page queries it directly.
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
        delivery_charge,
        misc_charge,
        misc_charge_label,
        amount_paid,
        balance_due,
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

  // ── 4b. Subscription payment position ───────────────────────────────────────
  // Mirrors the admin page: drives the "Subscription" tab's price breakup and
  // whether a new subscription may be added
  // (meal-subscription-partial-payment).
  const subscriptionPayments = await getSubscriptionPaymentOverview(id);

  // ── 5. Shape the customer object ────────────────────────────────────────────
  const userData = data.users as any;

  const dietitianId = (data.dietitian_id as string | null) ?? null;

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

      {/* Dietitian_Link assignment (franchise-scoped-access Task 10).
          Rendered here rather than inside Customer360Dashboard because that
          component only exposes its own Dietitian dropdown on the KIT and
          Accommodation branches, which a franchise MEAL customer never reaches.
          Placing it on the page keeps the shared component — and therefore the
          admin portal — untouched.

          This is also the ONLY way a Franchise Dietitian gains visibility of a
          customer: their read scope is the Dietitian_Link, so an unassigned
          customer is invisible to every dietitian. Only a user with `customers`
          MANAGE sees this control; the action refuses everyone else. */}
      {canManage && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-card p-4">
          <div className="min-w-[180px]">
            <p className="text-sm font-medium">Assigned Dietitian</p>
            <p className="text-xs text-muted-foreground">
              Controls which dietitian can see this customer.
            </p>
          </div>
          <DietitianAssignmentSelector
            profileId={id}
            currentDietitianId={dietitianId}
            mode="all"
            actions={{
              listDietitians: franchiseListDietitians,
              assignDietitian: franchiseAssignCustomerDietitian,
            }}
          />
        </div>
      )}

      <Customer360Dashboard
        customer={customerData}
        initialSubscriptionData={initialSubscriptionData}
        initialCoupons={(coupons ?? []) as any[]}
        billingPayments={(payments ?? []) as any[]}
        hasActiveSubscription={hasActiveSubscription}
        subscriptionPayments={subscriptionPayments}
        franchiseId={franchiseId}
        backHref="/customers"
        // Switches the dashboard onto its KIT branch (KIT / Shipping / KIT
        // History tabs + the eligibility badge) for a KIT customer, and onto the
        // MEAL branch otherwise. Previously omitted, so a franchise KIT customer
        // was served the MEAL tab set.
        customerCategory={customerCategory}
        kitSubscription={kitSubscription}
        kitOverview={kitOverview}
        existingShippingInfo={existingShippingInfo}
        // Renders the read-only Dietitian workspace: drops User Management and
        // the Subscription tab, and hides every write control. `canManage` is
        // already false for a Dietitian, but this flag is what the shared
        // component keys its read-only rendering off.
        isDietitian={isDietitian}
        // `customerFranchiseId` is deliberately NOT passed. The dashboard's own
        // editable Clinic/Dietitian selectors are already suppressed by
        // `franchiseId`, and passing it would additionally render the read-only
        // Clinic/Dietitian card — duplicating the assignment control this page
        // renders above with franchise-scoped actions, and showing "Unassigned"
        // for both unless two more name lookups were added for no real gain
        // (a franchise has exactly one clinic).
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
          adminUpdateCustomerEmail: franchiseUpdateCustomerEmail,
          adminToggleCustomerActive: franchiseToggleCustomerActive,
          deactivateCustomerAccount: franchiseDeactivateCustomerAccount,
        }}
      />
    </div>
  );
}
