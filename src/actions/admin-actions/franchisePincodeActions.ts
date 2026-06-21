"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { getCoreServicePincodes } from "@/lib/franchise/context";
import {
  assignPincodesSchema,
  removePincodesSchema,
  type AssignPincodesInput,
  type RemovePincodesInput,
} from "@/validations/franchiseSchemas";
import type { FranchisePincodeConflict } from "@/types/franchise";
import { revalidatePath } from "next/cache";

// ─── Auth Helper ───────────────────────────────────────────────────────────

/**
 * Pincode operations can be performed by ADMIN (operational) or MASTER_ADMIN.
 * ADMIN handles day-to-day pincode assignment, conflict resolution.
 */
async function assertCallerIsAdminOrMaster(): Promise<
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

  if (roleCode !== "ADMIN" && roleCode !== "MASTER_ADMIN") {
    return { success: false, error: "Only ADMIN or MASTER_ADMIN can manage franchise pincodes" };
  }

  return { success: true };
}

// ─── Pincode Assignment ────────────────────────────────────────────────────

/**
 * Assign pincodes to a franchise.
 * Validates:
 * - 6-digit format
 * - No overlap with other franchises (DB unique constraint)
 * - No overlap with core operation pincodes
 */
export async function assignPincodes(
  input: AssignPincodesInput
): Promise<
  | { success: true; assigned: number }
  | { success: false; error: string; conflicts?: FranchisePincodeConflict[] }
> {
  const authCheck = await assertCallerIsAdminOrMaster();
  if (!authCheck.success) return authCheck;

  const parsed = assignPincodesSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0].message };
  }

  const { franchise_id, pincodes } = parsed.data;
  const adminClient = createAdminClient();

  // Verify franchise exists
  const { data: franchise } = await adminClient
    .from("franchises")
    .select("id, name")
    .eq("id", franchise_id)
    .single();

  if (!franchise) {
    return { success: false, error: "Franchise not found" };
  }

  // Check for core pincode conflicts
  const corePincodes = await getCoreServicePincodes();
  const coreConflicts = pincodes.filter((p) => corePincodes.includes(p));

  if (coreConflicts.length > 0) {
    const conflicts: FranchisePincodeConflict[] = coreConflicts.map((pincode) => ({
      pincode,
      conflicting_entity: "core" as const,
    }));

    return {
      success: false,
      error: `Pincodes already assigned to core operation: ${coreConflicts.join(", ")}`,
      conflicts,
    };
  }

  // Check for conflicts with other franchises
  const { data: existingAssignments } = await adminClient
    .from("franchise_pincodes")
    .select("pincode, franchise_id, franchises(name)")
    .in("pincode", pincodes)
    .neq("franchise_id", franchise_id);

  if (existingAssignments && existingAssignments.length > 0) {
    const conflicts: FranchisePincodeConflict[] = existingAssignments.map((row: any) => ({
      pincode: row.pincode,
      conflicting_entity: "franchise" as const,
      conflicting_franchise_id: row.franchise_id,
      conflicting_franchise_name: row.franchises?.name ?? "Unknown",
    }));

    return {
      success: false,
      error: `Pincodes already assigned to other franchises: ${existingAssignments.map((r: any) => r.pincode).join(", ")}`,
      conflicts,
    };
  }

  // Filter out pincodes already assigned to this franchise
  const { data: alreadyAssigned } = await adminClient
    .from("franchise_pincodes")
    .select("pincode")
    .eq("franchise_id", franchise_id)
    .in("pincode", pincodes);

  const alreadySet = new Set((alreadyAssigned ?? []).map((r) => r.pincode));
  const newPincodes = pincodes.filter((p) => !alreadySet.has(p));

  if (newPincodes.length === 0) {
    return { success: true, assigned: 0 };
  }

  // Insert new pincode assignments
  const rows = newPincodes.map((pincode) => ({
    franchise_id,
    pincode,
  }));

  const { error: insertError } = await adminClient
    .from("franchise_pincodes")
    .insert(rows);

  if (insertError) {
    // Handle unique constraint violation gracefully
    if (insertError.code === "23505") {
      return {
        success: false,
        error: "One or more pincodes are already assigned. Please check for conflicts.",
      };
    }
    return { success: false, error: insertError.message };
  }

  revalidatePath("/franchises");
  return { success: true, assigned: newPincodes.length };
}

/**
 * Remove pincodes from a franchise.
 */
export async function removePincodes(
  input: RemovePincodesInput
): Promise<{ success: true; removed: number } | { success: false; error: string }> {
  const authCheck = await assertCallerIsAdminOrMaster();
  if (!authCheck.success) return authCheck;

  const parsed = removePincodesSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0].message };
  }

  const { franchise_id, pincodes } = parsed.data;
  const adminClient = createAdminClient();

  // Verify franchise exists
  const { data: franchise } = await adminClient
    .from("franchises")
    .select("id")
    .eq("id", franchise_id)
    .single();

  if (!franchise) {
    return { success: false, error: "Franchise not found" };
  }

  const { error: deleteError, count } = await adminClient
    .from("franchise_pincodes")
    .delete({ count: "exact" })
    .eq("franchise_id", franchise_id)
    .in("pincode", pincodes);

  if (deleteError) {
    return { success: false, error: deleteError.message };
  }

  revalidatePath("/franchises");
  return { success: true, removed: count ?? 0 };
}

/**
 * Get pincode conflicts for a franchise — shows pincodes that
 * overlap with core or other franchises.
 */
export async function getPincodeConflicts(
  franchiseId: string
): Promise<
  | { success: true; conflicts: FranchisePincodeConflict[] }
  | { success: false; error: string }
> {
  const authCheck = await assertCallerIsAdminOrMaster();
  if (!authCheck.success) return authCheck;

  const adminClient = createAdminClient();

  // Get this franchise's pincodes
  const { data: myPincodes } = await adminClient
    .from("franchise_pincodes")
    .select("pincode")
    .eq("franchise_id", franchiseId);

  if (!myPincodes || myPincodes.length === 0) {
    return { success: true, conflicts: [] };
  }

  const pincodesArr = myPincodes.map((r) => r.pincode);
  const conflicts: FranchisePincodeConflict[] = [];

  // Check against core pincodes
  const corePincodes = await getCoreServicePincodes();
  for (const pincode of pincodesArr) {
    if (corePincodes.includes(pincode)) {
      conflicts.push({ pincode, conflicting_entity: "core" });
    }
  }

  // Check against other franchises (shouldn't happen due to unique constraint, but defensive)
  const { data: otherAssignments } = await adminClient
    .from("franchise_pincodes")
    .select("pincode, franchise_id, franchises(name)")
    .in("pincode", pincodesArr)
    .neq("franchise_id", franchiseId);

  if (otherAssignments) {
    for (const row of otherAssignments as any[]) {
      conflicts.push({
        pincode: row.pincode,
        conflicting_entity: "franchise",
        conflicting_franchise_id: row.franchise_id,
        conflicting_franchise_name: row.franchises?.name ?? "Unknown",
      });
    }
  }

  return { success: true, conflicts };
}

/**
 * List all pincodes assigned to a franchise.
 */
export async function listFranchisePincodes(
  franchiseId: string
): Promise<
  | { success: true; data: { pincode: string; id: string }[] }
  | { success: false; error: string }
> {
  const authCheck = await assertCallerIsAdminOrMaster();
  if (!authCheck.success) return authCheck;

  const adminClient = createAdminClient();

  const { data, error } = await adminClient
    .from("franchise_pincodes")
    .select("id, pincode")
    .eq("franchise_id", franchiseId)
    .order("pincode");

  if (error) {
    return { success: false, error: error.message };
  }

  return { success: true, data: data ?? [] };
}
