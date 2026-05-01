import { createClient } from "@/lib/supabase/server";

export type Address = {
  id: string;
  customer_profile_id: string; // Changed from user_id
  tag: string;
  street_1: string;
  street_2?: string;
  landmark?: string;
  city: string;
  state: string;
  pincode: string;
  is_primary: boolean;
};

export async function getUserAddresses(): Promise<Address[]> {
  const supabase = await createClient();

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) throw new Error("Unauthorized");

  console.log("USER =>", user)
  // 1. Get the Customer Profile ID
  const { data: profile, error: errorInAddressFetch } = await supabase
    .from("customer_profiles")
    .select("id")
    .eq(
      "user_id",
      (
        await supabase
          .from("users")
          .select("id")
          .eq("auth_user_id", user.id)
          .single()
      ).data?.id,
    )
    .single();

  if (!profile) return [];

  console.log("PROFILE =>", profile);
  console.log("Error in address Fetch =>", errorInAddressFetch);
  // 2. Fetch addresses using the correct column
  const { data, error } = await supabase
    .from("addresses")
    .select("*")
    .eq("customer_profile_id", profile.id) // This fixes the 42703 error
    .order("is_primary", { ascending: false })
    .order("created_at", { ascending: false });

    console.log("ADDRESSES for profile=>", data);
  if (error) {
    console.error("Error fetching addresses:", error.message);
    throw new Error("Failed to load addresses.");
  }

  return data as Address[];
}
