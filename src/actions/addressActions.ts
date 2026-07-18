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
import { stampCustomerByPrimaryAddress } from "@/lib/clinic/stamping";
import { customerRequiresServiceablePincode } from "@/lib/address/customerServiceability";

// 2. The Server Action

export async function saveAddressAction(data: AddressFormValues) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new Error("Unauthorized");

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

  // KIT-only customers ship by courier, so their address only needs a valid
  // pincode format — the service-area check is skipped (Req: KIT bypass).
  const requiresServiceability = await customerRequiresServiceablePincode(
    supabase,
    profile.id,
  );

  if (requiresServiceability) {
    const pincodeCheck = await assertDeliverablePincode(data.pincode);
    if (!pincodeCheck.ok) {
      return { error: pincodeCheck.error };
    }
  }

  const serviceAreaPincodes = requiresServiceability
    ? await getServiceAreaPincodesAction()
    : [];
  const parsed = createAddressSchema(
    serviceAreaPincodes,
    !requiresServiceability,
  ).safeParse(data);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid address data" };
  }

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

  if (isEdit) {
    await supabase
      .from("addresses")
      .update(addressData)
      .eq("id", parsed.data.id);
  } else {
    await supabase.from("addresses").insert(addressData);
  }

  // Stamp the customer with their resolved clinic, anchored to the PRIMARY
  // address pincode, within this same operation before reporting completion
  // (Req 6.1–6.5). Saving or editing any address re-anchors the stamp to
  // whichever address is currently primary (is_primary = true): resolved → set
  // clinic_id; no-resolution → clear to unset; ambiguous → leave unchanged.
  // Selecting a per-day Delivery_Address is a separate flow that never reaches
  // this stamper, so it can never change customer_profiles.clinic_id (Req 6.7).
  // Only the stamp is added; the accepted inputs, outputs, return shape and
  // completion behavior of saveAddressAction are otherwise unchanged (Req 6.8).
  await stampCustomerByPrimaryAddress({
    supabase,
    customerProfileId: profile.id,
  });

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
