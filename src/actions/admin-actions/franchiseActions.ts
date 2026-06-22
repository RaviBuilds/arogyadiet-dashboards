"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { VALID_STATUS_TRANSITIONS } from "@/lib/franchise/constants";
import {
  createFranchiseSchema,
  updateFranchiseSchema,
} from "@/validations/franchiseSchemas";
import { sendEmail } from "@/services/emailService";
import {
  franchiseWelcomeEmailHtml,
  FRANCHISE_WELCOME_SUBJECT,
} from "@/emails/FranchiseWelcomeEmail";
import type {
  Franchise,
  FranchiseWithPincodes,
  FranchiseListFilters,
} from "@/types/franchise";
import { revalidatePath } from "next/cache";

// ─── Helpers ───────────────────────────────────────────────────────────────

async function assertCallerIsMasterAdmin(): Promise<
  { success: true; userId: string } | { success: false; error: string }
> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { success: false, error: "Unauthorized" };

  const { data: userRecord } = await supabase
    .from("users")
    .select("id, roles(code)")
    .eq("auth_user_id", user.id)
    .single();

  if (!userRecord) return { success: false, error: "User record not found" };

  const rolesData: any = userRecord.roles;
  const roleCode = Array.isArray(rolesData)
    ? rolesData[0]?.code
    : rolesData?.code;

  if (roleCode !== "MASTER_ADMIN") {
    return { success: false, error: "Only MASTER_ADMIN can manage franchises" };
  }

  return { success: true, userId: userRecord.id };
}

// ─── CRUD Operations (Task 4.1) ───────────────────────────────────────────

/**
 * Create a new franchise. Sets status to 'onboarding' by default.
 * Only MASTER_ADMIN can call this.
 *
 * Note: Pincodes are NOT assigned during creation.
 * ADMIN handles pincode assignment separately via franchisePincodeActions.
 */
export async function createFranchise(
  input: { name: string; kitchen_id?: string | null; owner_user_id?: string | null }
): Promise<{ success: true; data: Franchise } | { success: false; error: string }> {
  const authCheck = await assertCallerIsMasterAdmin();
  if (!authCheck.success) return authCheck;

  const parsed = createFranchiseSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0].message };
  }

  const { name, kitchen_id, owner_user_id } = parsed.data;
  const adminClient = createAdminClient();

  // Check name uniqueness
  const { data: existing } = await adminClient
    .from("franchises")
    .select("id")
    .eq("name", name)
    .single();

  if (existing) {
    return { success: false, error: `Franchise name "${name}" already exists` };
  }

  // Validate kitchen_id if provided
  if (kitchen_id) {
    const { data: kitchen } = await adminClient
      .from("kitchens")
      .select("id")
      .eq("id", kitchen_id)
      .single();

    if (!kitchen) {
      return { success: false, error: "Invalid kitchen_id — kitchen not found" };
    }
  }

  // Validate owner_user_id if provided
  if (owner_user_id) {
    const { data: ownerUser } = await adminClient
      .from("users")
      .select("id")
      .eq("id", owner_user_id)
      .single();

    if (!ownerUser) {
      return { success: false, error: "Invalid owner_user_id — user not found" };
    }
  }

  // Insert franchise
  const { data: franchise, error: insertError } = await adminClient
    .from("franchises")
    .insert({
      name,
      status: "onboarding",
      kitchen_id: kitchen_id ?? null,
      owner_user_id: owner_user_id ?? null,
    })
    .select()
    .single();

  if (insertError || !franchise) {
    return { success: false, error: insertError?.message ?? "Failed to create franchise" };
  }

  revalidatePath("/franchises");
  return { success: true, data: franchise };
}

/**
 * Update an existing franchise's name, kitchen, or owner.
 * Only MASTER_ADMIN can call this.
 */
export async function updateFranchise(
  franchiseId: string,
  input: { name?: string; kitchen_id?: string | null; owner_user_id?: string | null }
): Promise<{ success: true; data: Franchise } | { success: false; error: string }> {
  const authCheck = await assertCallerIsMasterAdmin();
  if (!authCheck.success) return authCheck;

  const parsed = updateFranchiseSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0].message };
  }

  const adminClient = createAdminClient();

  // Check franchise exists
  const { data: existing } = await adminClient
    .from("franchises")
    .select("id")
    .eq("id", franchiseId)
    .single();

  if (!existing) {
    return { success: false, error: "Franchise not found" };
  }

  // Check name uniqueness if name is being updated
  if (parsed.data.name) {
    const { data: nameConflict } = await adminClient
      .from("franchises")
      .select("id")
      .eq("name", parsed.data.name)
      .neq("id", franchiseId)
      .single();

    if (nameConflict) {
      return { success: false, error: `Franchise name "${parsed.data.name}" already exists` };
    }
  }

  const updatePayload: Record<string, any> = {};
  if (parsed.data.name !== undefined) updatePayload.name = parsed.data.name;
  if (parsed.data.kitchen_id !== undefined) updatePayload.kitchen_id = parsed.data.kitchen_id;
  if (parsed.data.owner_user_id !== undefined) updatePayload.owner_user_id = parsed.data.owner_user_id;

  if (Object.keys(updatePayload).length === 0) {
    return { success: false, error: "No fields to update" };
  }

  const { data: updated, error: updateError } = await adminClient
    .from("franchises")
    .update(updatePayload)
    .eq("id", franchiseId)
    .select()
    .single();

  if (updateError || !updated) {
    return { success: false, error: updateError?.message ?? "Failed to update franchise" };
  }

  revalidatePath("/franchises");
  return { success: true, data: updated };
}

/**
 * Get a single franchise by ID with its pincodes.
 * MASTER_ADMIN only.
 */
export async function getFranchise(
  franchiseId: string
): Promise<{ success: true; data: FranchiseWithPincodes } | { success: false; error: string }> {
  const authCheck = await assertCallerIsMasterAdmin();
  if (!authCheck.success) return authCheck;

  const adminClient = createAdminClient();

  const { data: franchise, error } = await adminClient
    .from("franchises")
    .select("*")
    .eq("id", franchiseId)
    .single();

  if (error || !franchise) {
    return { success: false, error: "Franchise not found" };
  }

  const { data: pincodes } = await adminClient
    .from("franchise_pincodes")
    .select("*")
    .eq("franchise_id", franchiseId)
    .order("pincode");

  return {
    success: true,
    data: { ...franchise, pincodes: pincodes ?? [] },
  };
}

/**
 * List franchises with optional status filter and search.
 * MASTER_ADMIN only.
 */
export async function listFranchises(
  filters?: FranchiseListFilters
): Promise<{ success: true; data: Franchise[]; total: number } | { success: false; error: string }> {
  const authCheck = await assertCallerIsMasterAdmin();
  if (!authCheck.success) return authCheck;

  const adminClient = createAdminClient();
  const page = filters?.page ?? 1;
  const perPage = filters?.per_page ?? 20;
  const from = (page - 1) * perPage;
  const to = from + perPage - 1;

  let query = adminClient
    .from("franchises")
    .select("*", { count: "exact" });

  if (filters?.status) {
    query = query.eq("status", filters.status);
  }

  if (filters?.search) {
    query = query.ilike("name", `%${filters.search}%`);
  }

  const { data, error, count } = await query
    .order("created_at", { ascending: false })
    .range(from, to);

  if (error) {
    return { success: false, error: error.message };
  }

  return { success: true, data: data ?? [], total: count ?? 0 };
}

/**
 * Delete a franchise — only allowed if status is 'onboarding' (safety).
 * MASTER_ADMIN only.
 */
export async function deleteFranchise(
  franchiseId: string
): Promise<{ success: true } | { success: false; error: string }> {
  const authCheck = await assertCallerIsMasterAdmin();
  if (!authCheck.success) return authCheck;

  const adminClient = createAdminClient();

  const { data: franchise } = await adminClient
    .from("franchises")
    .select("id, status")
    .eq("id", franchiseId)
    .single();

  if (!franchise) {
    return { success: false, error: "Franchise not found" };
  }

  if (franchise.status !== "onboarding") {
    return {
      success: false,
      error: "Can only delete franchises in 'onboarding' status. Suspend it first if needed.",
    };
  }

  // Cascade will handle franchise_pincodes
  const { error: deleteError } = await adminClient
    .from("franchises")
    .delete()
    .eq("id", franchiseId);

  if (deleteError) {
    return { success: false, error: deleteError.message };
  }

  revalidatePath("/franchises");
  return { success: true };
}

// ─── Lifecycle / Status Transitions (Task 4.2) ────────────────────────────
// Only MASTER_ADMIN can change franchise status.

/**
 * Activate a franchise (onboarding → active OR suspended → active).
 * Validates at least one pincode is assigned before activation.
 */
export async function activateFranchise(
  franchiseId: string
): Promise<{ success: true; data: Franchise } | { success: false; error: string }> {
  const authCheck = await assertCallerIsMasterAdmin();
  if (!authCheck.success) return authCheck;

  const adminClient = createAdminClient();

  const { data: franchise } = await adminClient
    .from("franchises")
    .select("id, status, name, kitchen_id")
    .eq("id", franchiseId)
    .single();

  if (!franchise) {
    return { success: false, error: "Franchise not found" };
  }

  if (franchise.status === "active") {
    return { success: false, error: `"${franchise.name}" is already active` };
  }

  const allowedFrom = Object.entries(VALID_STATUS_TRANSITIONS)
    .filter(([, targets]) => targets.includes("active"))
    .map(([from]) => from);

  if (!allowedFrom.includes(franchise.status)) {
    return {
      success: false,
      error: `Cannot activate from "${franchise.status}" status. Valid source: ${allowedFrom.join(", ")}`,
    };
  }

  // Check franchise has a kitchen assigned
  if (!franchise.kitchen_id) {
    return {
      success: false,
      error: "Cannot activate — no kitchen location set. Set up the kitchen address first.",
    };
  }

  // Check franchise has at least one pincode assigned
  const { count: pincodeCount } = await adminClient
    .from("franchise_pincodes")
    .select("id", { count: "exact", head: true })
    .eq("franchise_id", franchiseId);

  if (!pincodeCount || pincodeCount === 0) {
    return {
      success: false,
      error: "Cannot activate — franchise has no pincodes assigned. Ask admin to assign pincodes first.",
    };
  }

  const { data: updated, error: updateError } = await adminClient
    .from("franchises")
    .update({ status: "active" })
    .eq("id", franchiseId)
    .select()
    .single();

  if (updateError || !updated) {
    return { success: false, error: updateError?.message ?? "Failed to activate franchise" };
  }

  // Send welcome email to franchise owner (non-blocking)
  try {
    const { data: ownerUser } = await adminClient
      .from("users")
      .select("email, full_name")
      .eq("franchise_id", franchiseId)
      .single();

    if (ownerUser?.email) {
      const loginUrl = "https://franchies.arogyadiet.com/login";
      const supportEmail = "arogyadiet.dashboard@gmail.com";

      void sendEmail(
        ownerUser.email,
        FRANCHISE_WELCOME_SUBJECT,
        franchiseWelcomeEmailHtml({
          ownerName: ownerUser.full_name ?? "Franchise Admin",
          franchiseName: franchise.name,
          loginUrl,
          supportEmail,
        })
      );
    }
  } catch {
    // Email failure should not block activation
  }

  revalidatePath("/franchises");
  return { success: true, data: updated };
}

/**
 * Suspend a franchise (active → suspended).
 */
export async function suspendFranchise(
  franchiseId: string
): Promise<{ success: true; data: Franchise } | { success: false; error: string }> {
  const authCheck = await assertCallerIsMasterAdmin();
  if (!authCheck.success) return authCheck;

  const adminClient = createAdminClient();

  const { data: franchise } = await adminClient
    .from("franchises")
    .select("id, status, name")
    .eq("id", franchiseId)
    .single();

  if (!franchise) {
    return { success: false, error: "Franchise not found" };
  }

  if (franchise.status === "suspended") {
    return { success: false, error: `"${franchise.name}" is already suspended` };
  }

  if (franchise.status !== "active") {
    return {
      success: false,
      error: `Cannot suspend — franchise is currently "${franchise.status}". Only active franchises can be suspended.`,
    };
  }

  const { data: updated, error: updateError } = await adminClient
    .from("franchises")
    .update({ status: "suspended" })
    .eq("id", franchiseId)
    .select()
    .single();

  if (updateError || !updated) {
    return { success: false, error: updateError?.message ?? "Failed to suspend franchise" };
  }

  revalidatePath("/franchises");
  return { success: true, data: updated };
}

/**
 * Reactivate a suspended franchise (suspended → active).
 */
export async function reactivateFranchise(
  franchiseId: string
): Promise<{ success: true; data: Franchise } | { success: false; error: string }> {
  const authCheck = await assertCallerIsMasterAdmin();
  if (!authCheck.success) return authCheck;

  const adminClient = createAdminClient();

  const { data: franchise } = await adminClient
    .from("franchises")
    .select("id, status, name")
    .eq("id", franchiseId)
    .single();

  if (!franchise) {
    return { success: false, error: "Franchise not found" };
  }

  if (franchise.status !== "suspended") {
    return {
      success: false,
      error: `Cannot reactivate — franchise is currently "${franchise.status}". Only suspended franchises can be reactivated.`,
    };
  }

  const { data: updated, error: updateError } = await adminClient
    .from("franchises")
    .update({ status: "active" })
    .eq("id", franchiseId)
    .select()
    .single();

  if (updateError || !updated) {
    return { success: false, error: updateError?.message ?? "Failed to reactivate franchise" };
  }

  revalidatePath("/franchises");
  return { success: true, data: updated };
}
