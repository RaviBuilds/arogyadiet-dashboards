import { AddressList } from "@/shared/components/customer/address-list";
import { CustomerLogoutButton } from "@/shared/components/customer/customer-logout-button";
import { PinChangeForm } from "@/shared/components/customer/pin-change-form";
import { ProfileForm } from "@/shared/components/customer/profile-form";
import { displayableEmailOrNull } from "@/lib/onboarding/testEmail";
import { getCustomerSession } from "@/lib/customer/get-session";
import { redirect } from "next/navigation";
import { CheckCircle2, HeartHandshake } from "lucide-react";
import { IconChip } from "@/shared/components/customer/profile-ui/IconChip";
import { StatusPill } from "@/shared/components/customer/profile-ui/StatusPill";

export default async function CustomerProfilePage() {
  const { supabase, user, profile, customerProfileId, error } =
    await getCustomerSession();
  if (error || !user) redirect("/login");

  // Parallelize independent queries: full user record, customer_profiles data, addresses, medical_documents, and active subscription categories
  // All queries only depend on profile.id or customerProfileId which are already resolved
  const [
    dbUserResult,
    customerProfileResult,
    addressesResult,
    medicalDocsResult,
    subscriptionsResult,
  ] = await Promise.all([
      profile
        ? supabase
            .from("users")
            .select("email, is_test_email")
            .eq("id", profile.id)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      customerProfileId
        ? supabase
            .from("customer_profiles")
            .select("*")
            .eq("id", customerProfileId)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      customerProfileId
        ? supabase
            .from("addresses")
            .select("*")
            .eq("customer_profile_id", customerProfileId)
            .order("is_primary", { ascending: false })
            .order("created_at", { ascending: false })
        : Promise.resolve({ data: [] }),
      customerProfileId
        ? supabase
            .from("medical_documents")
            .select("*")
            .eq("customer_profile_id", customerProfileId)
            .order("uploaded_at", { ascending: false })
        : Promise.resolve({ data: [] }),
      customerProfileId
        ? supabase
            .from("subscriptions")
            .select("customer_category")
            .eq("customer_profile_id", customerProfileId)
            .in("status", ["ACTIVE", "PENDING"])
        : Promise.resolve({ data: [] }),
    ]);

  const dbUser = dbUserResult.data;
  const customerProfile = customerProfileResult.data;
  const addresses = (addressesResult.data as any[]) || [];
  const docs = (medicalDocsResult.data as any[]) || [];

  // KIT-only customers ship by courier, so their delivery address only needs a
  // valid pincode format — skip the service-area serviceability check. If they
  // have any MEAL/ACCOMMODATION subscription (or none at all), keep enforcing it.
  const activeSubscriptions =
    (subscriptionsResult.data as { customer_category: string }[] | null) ?? [];
  const isKitOnlyCustomer =
    activeSubscriptions.length > 0 &&
    activeSubscriptions.every((sub) => sub.customer_category === "KIT");

  // Generate secure Signed URLs for medical documents
  let documentsWithUrls: any[] = [];
  if (docs.length > 0) {
    documentsWithUrls = await Promise.all(
      docs.map(async (doc) => {
        // Generates a temporary secure link valid for 1 hour
        const { data } = await supabase.storage
          .from("medical_records")
          .createSignedUrl(doc.storage_path, 3600);

        return {
          ...doc,
          signedUrl: data?.signedUrl || null,
        };
      }),
    );
  }

  // Combine the data to pass into the form.
  // Email: never surface an admin-entered placeholder Test_Email to the
  // customer (Req 10.4) — `displayableEmailOrNull` filters it out, so the
  // field starts blank until the customer supplies a real address.
  const displayEmail = dbUser
    ? displayableEmailOrNull({
        email: dbUser.email ?? null,
        is_test_email: Boolean(dbUser.is_test_email),
      })
    : null;

  const initialProfileData = {
    id: customerProfile?.id || null,
    full_name: profile?.full_name || "",
    email: displayEmail || "",
    phone: profile?.mobile || "", // Note: mapping DB 'mobile' to Form 'phone'
    gender: customerProfile?.gender || "",
    date_of_birth: customerProfile?.date_of_birth || "",
    dietary_preference:
      (customerProfile?.dietary_preference as "Veg" | "Non-Veg") || "Veg",
    allergies: customerProfile?.allergies || "",
    medical_history_notes: customerProfile?.medical_history_notes || "",
    has_medical_history:
      customerProfile?.has_medical_history || documentsWithUrls.length > 0,
    no_medical_history_confirmed: !(
      customerProfile?.has_medical_history || documentsWithUrls.length > 0
    ),
  };

  // Profile completeness — derived only from fields already fetched above,
  // never invented. Kept as a simple fraction, not shown as a ring unless it
  // reads meaningfully (avoids a hero that just repeats "0% complete").
  const completableFields = [
    initialProfileData.full_name,
    displayEmail,
    initialProfileData.phone,
    initialProfileData.gender,
    initialProfileData.date_of_birth,
    initialProfileData.allergies,
  ];
  const filledCount = completableFields.filter((v) => Boolean(v && String(v).trim())).length;
  const isMedicalAssessed =
    initialProfileData.has_medical_history ||
    initialProfileData.no_medical_history_confirmed;
  const completenessLabel = isMedicalAssessed
    ? `${filledCount}/${completableFields.length} details added · Medical profile completed`
    : `${filledCount}/${completableFields.length} details added`;

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 sm:gap-8">
      {/* Light welcoming hero — not a big brand-color card, just an anchor */}
      <div
        className="reveal-rise flex items-start gap-3"
        style={{ ["--reveal-delay" as string]: "150ms" }}
      >
        <IconChip icon={HeartHandshake} tone="coral" size="lg" />
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900 sm:text-[2rem]">
            My Health Profile
          </h1>
          <p className="mt-1 text-sm leading-relaxed text-slate-500">
            Keep your personal information, dietary preferences and delivery
            details up to date so we can serve you better.
          </p>
          <StatusPill
            icon={isMedicalAssessed ? CheckCircle2 : undefined}
            tone={isMedicalAssessed ? "green" : "slate"}
            className="mt-2.5"
          >
            {completenessLabel}
          </StatusPill>
        </div>
      </div>

      <ProfileForm
        initialData={initialProfileData}
        initialDocuments={documentsWithUrls}
      />

      <PinChangeForm />

      <AddressList
        addresses={addresses}
        bypassPincodeServiceability={isKitOnlyCustomer}
      />

      {/* Logout — a quiet exit action at the bottom, not the second thing
          users see on the page. */}
      <div
        className="reveal-rise pt-2"
        style={{ ["--reveal-delay" as string]: "750ms" }}
      >
        <CustomerLogoutButton className="w-full sm:w-auto" />
      </div>
    </div>
  );
}
