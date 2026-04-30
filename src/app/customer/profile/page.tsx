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

  const { data: profile } = await supabase
    .from("users")
    .select("*")
    .eq("auth_user_id", user.id)
    .single();

  const initialProfileData = {
    full_name: profile?.full_name || "",
    email: user.email || "",
    phone: profile?.phone || "",
    dietary_preference:
      (profile?.dietary_preference as "Veg" | "Non-Veg") || "Veg", // Default to Non-Veg based on your preference!
    allergies: profile?.allergies || "",
  };

  const addresses = await getUserAddresses();

  return (
    <div className="flex flex-col gap-8 max-w-5xl mx-auto w-full">
      
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Personal Details</h2>
        <p className="text-muted-foreground">
          Manage your profile information and dietary preferences.
        </p>
        {/* <ProfileForm /> will go here later */}
      </div>
      <div className="bg-white p-6 rounded-xl border shadow-sm">
        <ProfileForm initialData={initialProfileData} />
      </div>

      <Separator />

      {/* 
        We pass the addresses down. 
        The AddressList component will now handle the section header, 
        the Add button, the Grid, and the Modal! 
      */}
      <AddressList addresses={addresses} />
    </div>
  );
}
