import { getUserAddresses } from "@/services/addressService";
import { AddressList } from "@/shared/components/customer/address-list";
import { Separator } from "@/components/ui/separator";
import { createClient } from "@/lib/supabase/server";
import { ProfileForm } from "@/shared/components/customer/profile-form";

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

  console.log("DB User =>", dbUser);
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
    <div className="flex flex-col gap-8 max-w-5xl mx-auto w-full">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Personal Details</h2>
        <p className="text-muted-foreground">
          Manage your profile information and dietary preferences.
        </p>
      </div>

      <div className="bg-white p-6 rounded-xl border shadow-sm">
        <ProfileForm
          initialData={initialProfileData}
          initialDocuments={documentsWithUrls}
        />
      </div>

      <Separator />

      <AddressList addresses={addresses} />
    </div>
  );
}
