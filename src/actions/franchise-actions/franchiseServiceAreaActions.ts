"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

// ─── Auth Helper ─────────────────────────────────────────────────────────────

/**
 * Resolves the calling FRANCHISE_ADMIN's internal user id + franchise id.
 * Identity is read from the user-scoped session client so it cannot be spoofed
 * by a malicious payload. All service-area writes are scoped to this franchise.
 */
async function resolveFranchiseCaller(): Promise<
  | { success: true; userId: string; franchiseId: string }
  | { success: false; error: string }
> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { success: false, error: "Unauthorized" };

  const { data: userRecord } = await supabase
    .from("users")
    .select("id, franchise_id, roles(code)")
    .eq("auth_user_id", user.id)
    .single();

  if (!userRecord) return { success: false, error: "User record not found" };

  const rolesData: any = userRecord.roles;
  const roleCode = Array.isArray(rolesData) ? rolesData[0]?.code : rolesData?.code;

  if (roleCode !== "FRANCHISE_ADMIN") {
    return { success: false, error: "Only a Franchise Admin can manage service areas" };
  }

  if (!userRecord.franchise_id) {
    return { success: false, error: "No franchise is assigned to your account" };
  }

  return { success: true, userId: userRecord.id, franchiseId: userRecord.franchise_id };
}

// ─── Service Area CRUD (franchise-scoped) ────────────────────────────────────

/**
 * Create or update a franchise service area.
 *
 * The pincode MUST already be part of the franchise's approved territory
 * (`franchise_pincodes`). New pincodes are obtained via the request/approval
 * flow on the Profile page — this keeps territory boundaries intact.
 */
export async function franchiseUpsertServiceArea(
  id: string | null,
  areaName: string,
  pincode: string,
): Promise<{ success: true } | { success: false; error: string }> {
  const caller = await resolveFranchiseCaller();
  if (!caller.success) return caller;

  const cleanPincode = pincode.trim();
  if (!/^[0-9]{6}$/.test(cleanPincode)) {
    return { success: false, error: "Pincode must be exactly 6 digits." };
  }
  if (!areaName.trim()) {
    return { success: false, error: "Area name is required." };
  }

  const admin = createAdminClient();

  // The pincode must belong to this franchise's approved territory
  const { data: approved } = await admin
    .from("franchise_pincodes")
    .select("id")
    .eq("franchise_id", caller.franchiseId)
    .eq("pincode", cleanPincode)
    .maybeSingle();

  if (!approved) {
    return {
      success: false,
      error: `Pincode ${cleanPincode} is not in your approved service area. Request it from the Profile page first.`,
    };
  }

  try {
    if (id) {
      // Verify the area belongs to this franchise before updating
      const { data: existing } = await admin
        .from("rider_service_areas")
        .select("id, franchise_id")
        .eq("id", id)
        .single();

      if (!existing || existing.franchise_id !== caller.franchiseId) {
        return { success: false, error: "Service area not found in your franchise." };
      }

      const { error } = await admin
        .from("rider_service_areas")
        .update({ area_name: areaName.trim(), pincode: cleanPincode })
        .eq("id", id);
      if (error) throw error;
    } else {
      const { error } = await admin.from("rider_service_areas").insert({
        area_name: areaName.trim(),
        pincode: cleanPincode,
        franchise_id: caller.franchiseId,
      });
      if (error) throw error;
    }

    revalidatePath("/franchise/riders");
    return { success: true };
  } catch (error: any) {
    return {
      success: false,
      error:
        error.code === "23505"
          ? `The pincode ${cleanPincode} is already added as a service area.`
          : error.message || "Failed to save service area.",
    };
  }
}

/**
 * Delete a franchise service area (verified to belong to the caller's franchise).
 */
export async function franchiseDeleteServiceArea(
  id: string,
): Promise<{ success: true } | { success: false; error: string }> {
  const caller = await resolveFranchiseCaller();
  if (!caller.success) return caller;

  const admin = createAdminClient();

  const { data: existing } = await admin
    .from("rider_service_areas")
    .select("id, franchise_id")
    .eq("id", id)
    .single();

  if (!existing || existing.franchise_id !== caller.franchiseId) {
    return { success: false, error: "Service area not found in your franchise." };
  }

  const { error } = await admin.from("rider_service_areas").delete().eq("id", id);
  if (error) {
    return {
      success: false,
      error: "Failed to delete area. It might be linked to existing data.",
    };
  }

  revalidatePath("/franchise/riders");
  return { success: true };
}

/**
 * Assign or unassign a service area to a rider.
 * Both the area and the target rider must belong to the caller's franchise.
 */
export async function franchiseUpdateAreaAssignment(
  areaId: string,
  riderId: string | null,
): Promise<{ success: true } | { success: false; error: string }> {
  const caller = await resolveFranchiseCaller();
  if (!caller.success) return caller;

  const admin = createAdminClient();

  // Verify the area belongs to this franchise
  const { data: area } = await admin
    .from("rider_service_areas")
    .select("id, franchise_id")
    .eq("id", areaId)
    .single();

  if (!area || area.franchise_id !== caller.franchiseId) {
    return { success: false, error: "Service area not found in your franchise." };
  }

  // If assigning, verify the rider belongs to this franchise
  if (riderId) {
    const { data: rider } = await admin
      .from("rider_profiles")
      .select("id, franchise_id")
      .eq("id", riderId)
      .single();

    if (!rider || rider.franchise_id !== caller.franchiseId) {
      return { success: false, error: "Rider not found in your franchise." };
    }
  }

  const { error } = await admin
    .from("rider_service_areas")
    .update({ rider_id: riderId })
    .eq("id", areaId);

  if (error) {
    return { success: false, error: "Failed to update rider mapping." };
  }

  revalidatePath("/franchise/riders");
  return { success: true };
}
