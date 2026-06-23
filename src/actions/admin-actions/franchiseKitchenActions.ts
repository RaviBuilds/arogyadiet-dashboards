"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

// ─── Auth Helper ───────────────────────────────────────────────────────────

async function assertCallerIsMasterAdmin(): Promise<
  { success: true } | { success: false; error: string }
> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { success: false, error: "Unauthorized" };

  const { data: userRecord } = await supabase
    .from("users")
    .select("roles(code)")
    .eq("auth_user_id", user.id)
    .single();

  const rolesData: any = userRecord?.roles;
  const roleCode = Array.isArray(rolesData)
    ? rolesData[0]?.code
    : rolesData?.code;

  if (roleCode !== "MASTER_ADMIN") {
    return { success: false, error: "Only MASTER_ADMIN can manage franchise kitchens" };
  }

  return { success: true };
}

// ─── Kitchen Actions ───────────────────────────────────────────────────────

/**
 * Create or update the kitchen for a franchise.
 * If the franchise already has a kitchen, it updates it.
 * If not, it creates a new kitchen and links it.
 */
export async function saveFranchiseKitchen(input: {
  franchiseId: string;
  name: string;
  addressText: string;
  lat: number;
  lng: number;
}): Promise<{ success: true; kitchenId: string } | { success: false; error: string }> {
  const authCheck = await assertCallerIsMasterAdmin();
  if (!authCheck.success) return authCheck;

  const { franchiseId, name, addressText, lat, lng } = input;
  const adminClient = createAdminClient();

  // Validate inputs
  if (!name.trim()) return { success: false, error: "Kitchen name is required" };
  if (!addressText.trim()) return { success: false, error: "Address is required" };
  if (!lat || !lng) return { success: false, error: "Latitude and longitude are required" };

  // Check franchise exists
  const { data: franchise } = await adminClient
    .from("franchises")
    .select("id, kitchen_id")
    .eq("id", franchiseId)
    .single();

  if (!franchise) return { success: false, error: "Franchise not found" };

  // If kitchen already exists, update it
  if (franchise.kitchen_id) {
    const { error: updateError } = await adminClient
      .from("kitchens")
      .update({
        name: name.trim(),
        address_text: addressText.trim(),
        lat,
        lng,
        updated_at: new Date().toISOString(),
      })
      .eq("id", franchise.kitchen_id);

    if (updateError) return { success: false, error: updateError.message };

    revalidatePath("/franchises");
    return { success: true, kitchenId: franchise.kitchen_id };
  }

  // Create new kitchen
  const { data: newKitchen, error: insertError } = await adminClient
    .from("kitchens")
    .insert({
      name: name.trim(),
      address_text: addressText.trim(),
      lat,
      lng,
      is_active: true,
    })
    .select("id")
    .single();

  if (insertError || !newKitchen) {
    return { success: false, error: insertError?.message ?? "Failed to create kitchen" };
  }

  // Link kitchen to franchise
  const { error: linkError } = await adminClient
    .from("franchises")
    .update({ kitchen_id: newKitchen.id })
    .eq("id", franchiseId);

  if (linkError) return { success: false, error: linkError.message };

  revalidatePath("/franchises");
  return { success: true, kitchenId: newKitchen.id };
}

/**
 * Get the kitchen details for a franchise.
 */
export async function getFranchiseKitchen(franchiseId: string): Promise<
  | { success: true; kitchen: { id: string; name: string; address_text: string | null; lat: number; lng: number } | null }
  | { success: false; error: string }
> {
  const adminClient = createAdminClient();

  const { data: franchise } = await adminClient
    .from("franchises")
    .select("kitchen_id")
    .eq("id", franchiseId)
    .single();

  if (!franchise || !franchise.kitchen_id) {
    return { success: true, kitchen: null };
  }

  const { data: kitchen, error } = await adminClient
    .from("kitchens")
    .select("id, name, address_text, lat, lng")
    .eq("id", franchise.kitchen_id)
    .single();

  if (error) return { success: false, error: error.message };

  return { success: true, kitchen };
}
