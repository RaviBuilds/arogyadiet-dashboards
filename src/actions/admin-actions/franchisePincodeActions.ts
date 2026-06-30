"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { checkGroupManage } from "@/lib/auth/adminAccess";
import { getCoreServicePincodes } from "@/lib/franchise/context";
import { assignWaitlistedCustomers } from "@/lib/franchise/assignment-resolver";
import {
  assignPincodesSchema,
  removePincodesSchema,
  reviewPincodeRequestSchema,
  type AssignPincodesInput,
  type RemovePincodesInput,
  type ReviewPincodeRequestInput,
} from "@/validations/franchiseSchemas";
import type {
  FranchisePincodeConflict,
  FranchisePincodeRequestWithMeta,
} from "@/types/franchise";
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
  const gate = await checkGroupManage("franchises");
  if (!gate.ok) return { success: false, error: gate.error };

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
  const gate = await checkGroupManage("franchises");
  if (!gate.ok) return { success: false, error: gate.error };

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


/**
 * List all franchises for admin oversight.
 * Uses admin client (service role) to bypass any RLS on the franchises table.
 */
export async function listAllFranchisesForAdmin(): Promise<
  { success: true; data: any[] } | { success: false; error: string }
> {
  const authCheck = await assertCallerIsAdminOrMaster();
  if (!authCheck.success) return authCheck;

  const adminClient = createAdminClient();

  const { data, error } = await adminClient
    .from("franchises")
    .select("*")
    .order("name");

  if (error) {
    return { success: false, error: error.message };
  }

  return { success: true, data: data ?? [] };
}

// ─── Pincode Request Approval Queue (Admin) ──────────────────────────────────

/**
 * Resolves the calling admin's internal user id (for reviewed_by stamping).
 * Returns null id if not resolvable, but auth is still enforced separately.
 */
async function getCallerInternalUserId(): Promise<string | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data } = await supabase
    .from("users")
    .select("id")
    .eq("auth_user_id", user.id)
    .single();

  return data?.id ?? null;
}

/**
 * List franchise pincode requests for the admin approval queue.
 * @param status - optional filter; defaults to "pending"
 */
export async function listPincodeRequests(
  status: "pending" | "approved" | "rejected" | "all" = "pending"
): Promise<
  | { success: true; data: FranchisePincodeRequestWithMeta[] }
  | { success: false; error: string }
> {
  const authCheck = await assertCallerIsAdminOrMaster();
  if (!authCheck.success) return authCheck;

  const adminClient = createAdminClient();

  let query = adminClient
    .from("franchise_pincode_requests")
    .select(
      "id, franchise_id, pincode, status, requested_by, reviewed_by, review_notes, created_at, reviewed_at, franchises(name), requester:users!franchise_pincode_requests_requested_by_fkey(full_name)"
    )
    .order("created_at", { ascending: false });

  if (status !== "all") {
    query = query.eq("status", status);
  }

  const { data, error } = await query;

  if (error) return { success: false, error: error.message };

  const mapped: FranchisePincodeRequestWithMeta[] = (data ?? []).map((row: any) => ({
    id: row.id,
    franchise_id: row.franchise_id,
    pincode: row.pincode,
    status: row.status,
    requested_by: row.requested_by,
    reviewed_by: row.reviewed_by,
    review_notes: row.review_notes,
    created_at: row.created_at,
    reviewed_at: row.reviewed_at,
    franchise_name: row.franchises?.name ?? "Unknown",
    requested_by_name: row.requester?.full_name ?? null,
  }));

  return { success: true, data: mapped };
}

/**
 * Count of pending pincode requests — used for the admin nav badge.
 */
export async function countPendingPincodeRequests(): Promise<number> {
  const authCheck = await assertCallerIsAdminOrMaster();
  if (!authCheck.success) return 0;

  const adminClient = createAdminClient();
  const { count } = await adminClient
    .from("franchise_pincode_requests")
    .select("id", { count: "exact", head: true })
    .eq("status", "pending");

  return count ?? 0;
}

/**
 * Approve a pending pincode request.
 * Re-checks conflicts (core + other franchises), promotes the pincode into the
 * live franchise_pincodes table, marks the request approved, and assigns any
 * waitlisted customers in that pincode to the franchise.
 */
export async function approvePincodeRequest(
  input: ReviewPincodeRequestInput
): Promise<
  | { success: true; assignedCustomers: number }
  | { success: false; error: string; conflicts?: FranchisePincodeConflict[] }
> {
  const gate = await checkGroupManage("franchises");
  if (!gate.ok) return { success: false, error: gate.error };

  const authCheck = await assertCallerIsAdminOrMaster();
  if (!authCheck.success) return authCheck;

  const parsed = reviewPincodeRequestSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0].message };
  }

  const adminClient = createAdminClient();
  const reviewerId = await getCallerInternalUserId();

  // Load the request
  const { data: request } = await adminClient
    .from("franchise_pincode_requests")
    .select("id, franchise_id, pincode, status")
    .eq("id", parsed.data.request_id)
    .single();

  if (!request) return { success: false, error: "Request not found" };
  if (request.status !== "pending") {
    return { success: false, error: "This request has already been reviewed" };
  }

  const { franchise_id, pincode } = request;

  // Conflict: core operation pincode
  const corePincodes = await getCoreServicePincodes();
  if (corePincodes.includes(pincode)) {
    return {
      success: false,
      error: `Pincode ${pincode} is reserved for core operation and cannot be assigned.`,
      conflicts: [{ pincode, conflicting_entity: "core" }],
    };
  }

  // Conflict: already assigned to another franchise
  const { data: existing } = await adminClient
    .from("franchise_pincodes")
    .select("pincode, franchise_id, franchises(name)")
    .eq("pincode", pincode)
    .maybeSingle();

  if (existing && existing.franchise_id !== franchise_id) {
    return {
      success: false,
      error: `Pincode ${pincode} is already assigned to another franchise.`,
      conflicts: [
        {
          pincode,
          conflicting_entity: "franchise",
          conflicting_franchise_id: existing.franchise_id,
          conflicting_franchise_name: (existing as any).franchises?.name ?? "Unknown",
        },
      ],
    };
  }

  // Promote into the live service-area table (skip if it somehow already exists)
  if (!existing) {
    const { error: insertError } = await adminClient
      .from("franchise_pincodes")
      .insert({ franchise_id, pincode });

    if (insertError && insertError.code !== "23505") {
      return { success: false, error: insertError.message };
    }
  }

  // Mark the request approved
  const { error: updateError } = await adminClient
    .from("franchise_pincode_requests")
    .update({
      status: "approved",
      reviewed_by: reviewerId,
      reviewed_at: new Date().toISOString(),
      review_notes: parsed.data.notes ?? null,
    })
    .eq("id", request.id);

  if (updateError) return { success: false, error: updateError.message };

  // Auto-assign waitlisted customers sitting in this pincode
  const { assigned } = await assignWaitlistedCustomers(franchise_id, [pincode]);

  revalidatePath("/franchises");
  revalidatePath("/franchise/profile");
  return { success: true, assignedCustomers: assigned };
}

/**
 * Reject a pending pincode request with an optional note.
 */
export async function rejectPincodeRequest(
  input: ReviewPincodeRequestInput
): Promise<{ success: true } | { success: false; error: string }> {
  const gate = await checkGroupManage("franchises");
  if (!gate.ok) return { success: false, error: gate.error };

  const authCheck = await assertCallerIsAdminOrMaster();
  if (!authCheck.success) return authCheck;

  const parsed = reviewPincodeRequestSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0].message };
  }

  const adminClient = createAdminClient();
  const reviewerId = await getCallerInternalUserId();

  const { data: request } = await adminClient
    .from("franchise_pincode_requests")
    .select("id, status")
    .eq("id", parsed.data.request_id)
    .single();

  if (!request) return { success: false, error: "Request not found" };
  if (request.status !== "pending") {
    return { success: false, error: "This request has already been reviewed" };
  }

  const { error: updateError } = await adminClient
    .from("franchise_pincode_requests")
    .update({
      status: "rejected",
      reviewed_by: reviewerId,
      reviewed_at: new Date().toISOString(),
      review_notes: parsed.data.notes ?? null,
    })
    .eq("id", request.id);

  if (updateError) return { success: false, error: updateError.message };

  revalidatePath("/franchises");
  revalidatePath("/franchise/profile");
  return { success: true };
}
