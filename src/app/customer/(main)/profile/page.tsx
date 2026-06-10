import { getUserAddresses } from "@/services/addressService";
import { AddressList } from "@/shared/components/customer/address-list";
import { CustomerLogoutButton } from "@/shared/components/customer/customer-logout-button";
import { PasswordChangeForm } from "@/shared/components/customer/password-change-form";
import { createClient } from "@/lib/supabase/server";
import { ProfileForm } from "@/shared/components/customer/profile-form";
import {
  Card,
  CardContent,
} from "@/shared/components/ui/card";

export default async function CustomerProfilePage() {
  // Fetch data securely on the server
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null; // Or handle redirect

  // 1. Fetch Identity Info from 'users' table
  const { data: dbUser } = await supabase
    .from("users")
    .select("*")
    .eq("auth_user_id", user.id)
    .maybeSingle();

  // 2. Fetch Customer Specific Info from 'customer_profiles' table
  let customerProfile = null;
  if (dbUser) {
    const { data: cpData } = await supabase
      .from("customer_profiles")
      .select("*")
      .eq("user_id", dbUser.id)
      .maybeSingle();

    customerProfile = cpData;
  }

  // 3. Fetch uploaded medical documents and generate secure Signed URLs
  let documentsWithUrls: any[] = [];
  if (customerProfile?.id) {
    const { data: docs } = await supabase
      .from("medical_documents")
      .select("*")
      .eq("customer_profile_id", customerProfile.id)
      .order("uploaded_at", { ascending: false });

    if (docs && docs.length > 0) {
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
  }

  // 4. Combine the data to pass into the form
  const initialProfileData = {
    id: customerProfile?.id || null,
    full_name: dbUser?.full_name || "",
    email: user.email || "",
    phone: dbUser?.mobile || "", // Note: mapping DB 'mobile' to Form 'phone'
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

  const addresses = await getUserAddresses();

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

      {/* Password Change Section */}
      <div className="border-t border-slate-200 pt-10">
        <div className="mb-6">
          <h2 className="text-xl font-semibold tracking-tight text-slate-900">
            Security Settings
          </h2>
          <p className="text-sm text-slate-500">
            Manage your account security and password.
          </p>
        </div>
        <PasswordChangeForm />
      </div>

      <div className="border-t border-slate-200 pt-10">
        <AddressList addresses={addresses} />
      </div>
    </div>
  );
}
