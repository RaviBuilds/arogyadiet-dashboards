import { createAdminClient } from "@/lib/supabase/admin";

const REASSIGNABLE_ORDER_STATUSES = [
  "ORDER_CREATED",
  "MEAL_PREPARED",
  "ASSIGNED",
] as const;

const IN_PROGRESS_ORDER_STATUSES = [
  "PICKED",
  "OUT_FOR_DELIVERY",
  "ON_THE_WAY",
  "REACHING_TO_LOCATION",
] as const;

type AddressRow = {
  id: string;
  is_primary: boolean;
};

export type DeleteCustomerAddressResult =
  | { success: true }
  | { success: false; error: string };

export async function deleteCustomerAddress(
  customerProfileId: string,
  addressId: string,
): Promise<DeleteCustomerAddressResult> {
  const supabaseAdmin = createAdminClient();

  const { data: targetAddress, error: targetError } = await supabaseAdmin
    .from("addresses")
    .select("id, is_primary")
    .eq("id", addressId)
    .eq("customer_profile_id", customerProfileId)
    .maybeSingle();

  if (targetError) {
    console.error("Error fetching address for deletion", targetError);
    return {
      success: false,
      error: "Failed to delete the address. Please try again.",
    };
  }

  if (!targetAddress) {
    return { success: false, error: "Address not found." };
  }

  const { data: addresses, error: addressesError } = await supabaseAdmin
    .from("addresses")
    .select("id, is_primary")
    .eq("customer_profile_id", customerProfileId);

  if (addressesError || !addresses?.length) {
    console.error("Error fetching customer addresses", addressesError);
    return {
      success: false,
      error: "Failed to delete the address. Please try again.",
    };
  }

  if (addresses.length <= 1) {
    return {
      success: false,
      error: "You cannot delete your only saved delivery address.",
    };
  }

  const fallbackAddress = pickFallbackAddress(
    addresses as AddressRow[],
    addressId,
  );

  if (!fallbackAddress) {
    return {
      success: false,
      error: "No alternate delivery address is available.",
    };
  }

  const { count: deliveredCount, error: deliveredError } = await supabaseAdmin
    .from("delivery_orders")
    .select("*", { count: "exact", head: true })
    .eq("delivery_address_id", addressId)
    .eq("status", "DELIVERED");

  if (deliveredError) {
    console.error("Error checking delivered orders", deliveredError);
    return {
      success: false,
      error: "Failed to delete the address. Please try again.",
    };
  }

  if (deliveredCount && deliveredCount > 0) {
    return {
      success: false,
      error:
        "This address cannot be deleted because it was used for a completed delivery.",
    };
  }

  const { count: inProgressCount, error: inProgressError } =
    await supabaseAdmin
      .from("delivery_orders")
      .select("*", { count: "exact", head: true })
      .eq("delivery_address_id", addressId)
      .in("status", [...IN_PROGRESS_ORDER_STATUSES]);

  if (inProgressError) {
    console.error("Error checking in-progress deliveries", inProgressError);
    return {
      success: false,
      error: "Failed to delete the address. Please try again.",
    };
  }

  if (inProgressCount && inProgressCount > 0) {
    return {
      success: false,
      error:
        "This address cannot be deleted while a delivery to it is in progress.",
    };
  }

  const { error: prefsError } = await supabaseAdmin
    .from("subscription_daily_preferences")
    .update({ delivery_address_id: fallbackAddress.id })
    .eq("customer_profile_id", customerProfileId)
    .eq("delivery_address_id", addressId);

  if (prefsError) {
    console.error("Error reassigning subscription preferences", prefsError);
    return {
      success: false,
      error: "Failed to delete the address. Please try again.",
    };
  }

  const { error: ordersError } = await supabaseAdmin
    .from("delivery_orders")
    .update({ delivery_address_id: fallbackAddress.id })
    .eq("delivery_address_id", addressId)
    .in("status", [...REASSIGNABLE_ORDER_STATUSES]);

  if (ordersError) {
    console.error("Error reassigning delivery orders", ordersError);
    return {
      success: false,
      error: "Failed to delete the address. Please try again.",
    };
  }

  if (targetAddress.is_primary) {
    const { error: promoteError } = await supabaseAdmin
      .from("addresses")
      .update({ is_primary: true })
      .eq("id", fallbackAddress.id)
      .eq("customer_profile_id", customerProfileId);

    if (promoteError) {
      console.error("Error promoting fallback address", promoteError);
      return {
        success: false,
        error: "Failed to delete the address. Please try again.",
      };
    }
  }

  const { error: deleteError } = await supabaseAdmin
    .from("addresses")
    .delete()
    .eq("id", addressId)
    .eq("customer_profile_id", customerProfileId);

  if (deleteError) {
    console.error("Database error deleting address", deleteError);
    return {
      success: false,
      error: "Failed to delete the address. Please try again.",
    };
  }

  return { success: true };
}

function pickFallbackAddress(
  addresses: AddressRow[],
  addressIdToDelete: string,
): AddressRow | null {
  const remaining = addresses.filter((address) => address.id !== addressIdToDelete);
  if (remaining.length === 0) return null;

  return remaining.find((address) => address.is_primary) ?? remaining[0];
}
