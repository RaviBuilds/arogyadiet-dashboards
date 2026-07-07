import { AddressList } from "@/shared/components/customer/address-list";
import { CustomerLogoutButton } from "@/shared/components/customer/customer-logout-button";
import { PinChangeForm } from "@/shared/components/customer/pin-change-form";
import { ProfileForm } from "@/shared/components/customer/profile-form";
import { displayableEmailOrNull } from "@/lib/onboarding/testEmail";
import { getCustomerSession } from "@/lib/customer/get-session";
import { redirect } from "next/navigation";
import {
  Card,
  CardContent,
} from "@/shared/components/ui/card";

export default async function CustomerProfilePage() {
  const { supabase, user, profile, customerProfileId, error } =
    await getCustomerSession();
  if (error || !user) redirect("/login");

  // Parallelize independent queries: full user record, customer_profiles data, addresses, and medical_documents
  // All queries only depend on profile.id or customerProfileId which are already resolved
  const [dbUserResult, customerProfileResult, addressesResult, medicalDocsResult] =
    await Promise.all([
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
    ]);

  const dbUser = dbUserResult.data;
  const customerProfile = customerProfileResult.data;
  const addresses = (addressesResult.data as any[]) || [];
  const docs = (medicalDocsResult.data as any[]) || [];

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


  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-10 animate-in fade-in slide-in-from-bottom-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
            My Profile
          </h1>
          <p className="text-sm text-slate-500">
            Manage your profile information and dietary preferences.
          </p>
        </div>
        <CustomerLogoutButton className="md:hidden" />
      </div>

      <Card className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <CardContent className="p-6">
          <ProfileForm
            initialData={initialProfileData}
            initialDocuments={documentsWithUrls}
          />
        </CardContent>
      </Card>

      {/* PIN Change Section */}
      <div className="border-t border-slate-200 pt-10">
        <div className="mb-6">
          <h2 className="text-xl font-semibold tracking-tight text-slate-900">
            Security Settings
          </h2>
          <p className="text-sm text-slate-500">
            Manage your account security and login PIN.
          </p>
        </div>
        <PinChangeForm />
      </div>

      <div className="border-t border-slate-200 pt-10">
        <AddressList addresses={addresses} />
      </div>
    </div>
  );
}
