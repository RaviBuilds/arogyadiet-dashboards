"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { requestPincodeSchema, type RequestPincodeInput } from "@/validations/franchiseSchemas";
import type { FranchisePincodeRequest } from "@/types/franchise";
import { revalidatePath } from "next/cache";

// ─── Auth Helper ─────────────────────────────────────────────────────────────

/**
 * Resolves the calling FRANCHISE_ADMIN's internal user id + franchise id.
 * Reads are done with the user-scoped client (session), so identity cannot be spoofed.
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
    return { success: false, error: "Only a Franchise Admin can request pincodes" };
  }

  if (!userRecord.franchise_id) {
    return { success: false, error: "No franchise is assigned to your account" };
  }

  return { success: true, userId: userRecord.id, franchiseId: userRecord.franchise_id };
}

// ─── Request a Pincode ───────────────────────────────────────────────────────

/**
 * Franchise admin requests a new service-area pincode.
 * The request is created with status 'pending' and must be approved by an
 * ADMIN / MASTER_ADMIN before the pincode becomes an active service area.
 */
export async function requestFranchisePincode(
  input: RequestPincodeInput
): Promise<{ success: true } | { success: false; error: string }> {
  const caller = await resolveFranchiseCaller();
  if (!caller.success) return caller;

  const parsed = requestPincodeSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0].message };
  }

  const { pincode } = parsed.data;
  const admin = createAdminClient();

  // Already an ACTIVE service pincode somewhere?
  const { data: existingActive } = await admin
    .from("franchise_pincodes")
    .select("franchise_id")
    .eq("pincode", pincode)
    .maybeSingle();

  if (existingActive) {
    if (existingActive.franchise_id === caller.franchiseId) {
      return { success: false, error: "This pincode is already in your service area" };
    }
    return { success: false, error: "This pincode is already served by another franchise" };
  }

  // Already a pending request (for this or another franchise)?
  const { data: existingPending } = await admin
    .from("franchise_pincode_requests")
    .select("id, franchise_id")
    .eq("pincode", pincode)
    .eq("status", "pending")
    .maybeSingle();

  if (existingPending) {
    if (existingPending.franchise_id === caller.franchiseId) {
      return { success: false, error: "You already have a pending request for this pincode" };
    }
    return { success: false, error: "Another franchise has a pending request for this pincode" };
  }

  const { error: insertError } = await admin.from("franchise_pincode_requests").insert({
    franchise_id: caller.franchiseId,
    pincode,
    status: "pending",
    requested_by: caller.userId,
  });

  if (insertError) {
    if (insertError.code === "23505") {
      return { success: false, error: "You already have a pending request for this pincode" };
    }
    return { success: false, error: insertError.message };
  }

  revalidatePath("/franchise/profile");
  revalidatePath("/franchises");
  return { success: true };
}

// ─── List My Requests ──────────────────────────────────────────────────────

/**
 * Lists the calling franchise's own pincode requests (all statuses, newest first).
 */
export async function listMyPincodeRequests(): Promise<
  { success: true; data: FranchisePincodeRequest[] } | { success: false; error: string }
> {
  const caller = await resolveFranchiseCaller();
  if (!caller.success) return caller;

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("franchise_pincode_requests")
    .select("*")
    .eq("franchise_id", caller.franchiseId)
    .order("created_at", { ascending: false });

  if (error) return { success: false, error: error.message };

  return { success: true, data: (data ?? []) as FranchisePincodeRequest[] };
}

// ─── Cancel a Pending Request ────────────────────────────────────────────────

/**
 * Franchise admin cancels (deletes) one of their own still-pending requests.
 */
export async function cancelMyPincodeRequest(
  requestId: string
): Promise<{ success: true } | { success: false; error: string }> {
  const caller = await resolveFranchiseCaller();
  if (!caller.success) return caller;

  const admin = createAdminClient();
  const { error, count } = await admin
    .from("franchise_pincode_requests")
    .delete({ count: "exact" })
    .eq("id", requestId)
    .eq("franchise_id", caller.franchiseId)
    .eq("status", "pending");

  if (error) return { success: false, error: error.message };
  if (!count) return { success: false, error: "Request not found or already reviewed" };

  revalidatePath("/franchise/profile");
  revalidatePath("/franchises");
  return { success: true };
}
