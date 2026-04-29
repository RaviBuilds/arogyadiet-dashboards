// src/actions/addressActions.ts
"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { addressSchema, AddressFormValues } from "@/validations/addressSchema";

// 2. The Server Action
export async function saveAddressAction(data: AddressFormValues) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthorized");

  // Validate the incoming data against our schema
  const parsed = addressSchema.safeParse(data);
  if (!parsed.success) {
    return { error: "Invalid address data provided." };
  }

  const addressData = {
    user_id: user.id,
    tag: parsed.data.tag,
    street_1: parsed.data.street_1,
    street_2: parsed.data.street_2,
    landmark: parsed.data.landmark,
    city: parsed.data.city,
    state: parsed.data.state,
    pincode: parsed.data.pincode,
  };

  try {
    if (parsed.data.id) {
      // UPDATE existing address
      const { error } = await supabase
        .from("addresses")
        .update(addressData)
        .eq("id", parsed.data.id)
        .eq("user_id", user.id); // Extra security check

      if (error) throw error;
    } else {
      // INSERT new address
      const { error } = await supabase.from("addresses").insert([addressData]);

      if (error) throw error;
    }

    // Refresh the profile page data
    revalidatePath("/customer/profile");
    return { success: true };
  } catch (error: any) {
    console.error("Database error saving address:", error);
    return { error: "Failed to save address. Please try again." };
  }
}
