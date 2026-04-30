import { createClient } from "@/lib/supabase/server";

export type Address = {
  id: string;
  user_id: string;
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

  // 1. Get the securely authenticated user
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) throw new Error("Unauthorized");

  // 2. Fetch their addresses, ordering primary first, then newest
  const { data, error } = await supabase
    .from("addresses")
    .select("*")
    .eq("user_id", user.id)
    .order("is_primary", { ascending: false })
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Error fetching addresses:", error);
    console.log("THE ERROR =>", error);
    throw new Error("Failed to load addresses.");
  }

  return data as Address[];
}
