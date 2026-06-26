"use server";

import { createClient } from "@/lib/supabase/server";
import { deleteCustomerAddress } from "@/lib/address/deleteCustomerAddress";
import { revalidatePath } from "next/cache";
import {
  createAddressSchema,
  type AddressFormValues,
} from "@/validations/addressSchema";
import {
  assertDeliverablePincode,
  getServiceAreaPincodesAction,
} from "@/actions/pincodeActions";
import {
  notifyAddressDeleted,
  notifyAddressSaved,
} from "@/lib/customer/customerProfileNotifications";
import { stampCustomerClinic } from "@/lib/clinic/stamping";

// 2. The Server Action

export async function saveAddressAction(data: AddressFormValues) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new Error("Unauthorized");

  const pincodeCheck = await assertDeliverablePincode(data.pincode);
  if (!pincodeCheck.ok) {
    return { error: pincodeCheck.error };
  }

  const serviceAreaPincodes = await getServiceAreaPincodesAction();
  const parsed = createAddressSchema(serviceAreaPincodes).safeParse(data);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid address data" };
  }

  // get internal user
  const { data: dbUser } = await supabase
    .from("users")
    .select("id")
    .eq("auth_user_id", user.id)
    .single();

  if (!dbUser) return { error: "User not found" };

  // get customer profile
  const { data: profile } = await supabase
    .from("customer_profiles")
    .select("id")
    .eq("user_id", dbUser.id)
    .single();

  if (!profile) return { error: "Customer profile not found" };

  // count
  if (!parsed.data.id) {
    const { count } = await supabase
      .from("addresses")
      .select("*", { count: "exact", head: true })
      .eq("customer_profile_id", profile.id);

    if (count && count >= 2) {
      return {
        error: "Maximum 2 addresses allowed",
      };
    }
  }

  // reset primary
  if (parsed.data.is_primary) {
    await supabase
      .from("addresses")
      .update({ is_primary: false })
      .eq("customer_profile_id", profile.id);
  }

  const addressData = {
    customer_profile_id: profile.id,
    tag: parsed.data.tag,
    street_1: parsed.data.street_1,
    street_2: parsed.data.street_2,
    landmark: parsed.data.landmark,
    city: parsed.data.city,
    state: parsed.data.state,
    pincode: parsed.data.pincode,
    is_primary: parsed.data.is_primary,
    lat: parsed.data.lat,
    lng: parsed.data.lng,
  };

  const isEdit = Boolean(parsed.data.id);

  // The address row id we just wrote — used to stamp the exact address (Req 6.2).
  let stampedAddressId: string | null = null;

  if (isEdit) {
    await supabase
      .from("addresses")
      .update(addressData)
      .eq("id", parsed.data.id);
    stampedAddressId = parsed.data.id ?? null;
  } else {
    // Return the new id so we can stamp the exact row we just created.
    const { data: inserted } = await supabase
      .from("addresses")
      .insert(addressData)
      .select("id")
      .single();
    stampedAddressId = inserted?.id ?? null;
  }

  // Stamp the customer + this address with their resolved clinic within the same
  // operation, before reporting completion (Req 6.1–6.5). Only the stamp is
  // added; the accepted inputs, outputs, return shape and completion behavior of
  // saveAddressAction are otherwise unchanged (Req 6.7).
  if (stampedAddressId) {
    await stampCustomerClinic({
      supabase,
      customerProfileId: profile.id,
      addressId: stampedAddressId,
      pincode: parsed.data.pincode,
    });
  }

  await notifyAddressSaved(dbUser.id, {
    isEdit,
    tag: parsed.data.tag,
  });

  revalidatePath("/profile");

  return { success: true };
}

export async function deleteAddressAction(addressId: string) {
  const supabase = await createClient();

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (!user || error) throw new Error("Unauthorized");

  const { data: dbUser } = await supabase
    .from("users")
    .select("id")
    .eq("auth_user_id", user.id)
    .single();

  if (!dbUser) return { error: "User not found." };

  const { data: profile } = await supabase
    .from("customer_profiles")
    .select("id")
    .eq("user_id", dbUser.id)
    .single();

  if (!profile) return { error: "Customer profile not found." };

  const result = await deleteCustomerAddress(profile.id, addressId);

  if (!result.success) {
    return { error: result.error };
  }

  await notifyAddressDeleted(dbUser.id);

  revalidatePath("/profile");
  return { success: true };
}
