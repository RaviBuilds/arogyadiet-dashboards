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
    .single();

  // 2. Fetch Customer Specific Info from 'customer_profiles' table
  let customerProfile = null;
  if (dbUser) {
    const { data: cpData } = await supabase
      .from("customer_profiles")
      .select("*")
      .eq("user_id", dbUser.id)
      .single();

    customerProfile = cpData;
  }

  // 3. Combine the data to pass into the form
  const initialProfileData = {
    full_name: dbUser?.full_name || "",
    email: user.email || "",
    phone: dbUser?.mobile || "", // Note: mapping DB 'mobile' to Form 'phone'
    gender: customerProfile?.gender || "",
    date_of_birth: customerProfile?.date_of_birth || "",
    dietary_preference:
      (customerProfile?.dietary_preference as "Veg" | "Non-Veg") || "Veg",
    allergies: customerProfile?.allergies || "",
  };

  const addresses = await getUserAddresses();
  console.log("ADDRESS=>", addresses);
  return (
    <div className="flex flex-col gap-8 max-w-5xl mx-auto w-full">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Personal Details</h2>
        <p className="text-muted-foreground">
          Manage your profile information and dietary preferences.
        </p>
      </div>

      <div className="bg-white p-6 rounded-xl border shadow-sm">
        <ProfileForm initialData={initialProfileData} />
      </div>

      <Separator />

      <AddressList addresses={addresses} />
    </div>
  );
}
