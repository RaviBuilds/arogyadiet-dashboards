"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { success, z } from "zod";
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

  try {
    if (!parsed.data.id) {
      // Check the current count of addresses for this user
      const { count, error: countError } = await supabase
        .from("addresses")
        .select("*", { count: "exact", head: true })
        .eq("user_id", user.id);

      if (countError) throw countError;

      if (count !== null && count >= 2) {
        return {
          error:
            "Maximum limit of 2 addresses reached. Please delete an address to add a new one.",
        };
      }
    }

    if (parsed.data.is_primary) {
      const { error: resetError } = await supabase
        .from("addresses")
        .update({ is_primary: false })
        .eq("user_id", user.id);

      if (resetError) throw resetError;
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
      is_primary: parsed.data.is_primary,
    };

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

export async function deleteAddressAction(addressId: string) {
  const supabase = await createClient();

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (!user || error) throw new Error("Unauthorized");

  try {
    const { error: deleteError } = await supabase
      .from("addresses")
      .delete()
      .eq("id", addressId)
      .eq("user_id", user.id);
    if (deleteError) throw deleteError;

    revalidatePath("/customer/profile");
    return { success: true };
  } catch (error: any) {
    console.error("Database error deleting address", error);
    return { error: "Failed to delete the address please try again." };
  }
}
