"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAdminAction } from "@/lib/logger";
import { applyOperationsScope, type OperationsScope } from "@/lib/franchise/scope";

export interface FixedAssignmentRow {
  id: string;
  customerProfileId: string;
  customerName: string;
  customerMobile: string;
  riderId: string;
  riderName: string;
  riderCode: string;
  note: string | null;
  createdAt: string;
}

export interface AssignableCustomer {
  customerProfileId: string;
  name: string;
  mobile: string;
  email: string;
  pincodes: string[];
}

export interface AssignableRider {
  id: string;
  name: string;
  employeeCode: string;
  pincodes: string[];
}

/**
 * Fetch all permanent customer -> rider assignment overrides, enriched with
 * customer and rider display details.
 */
export async function getFixedAssignments(
  scope?: OperationsScope,
): Promise<FixedAssignmentRow[]> {
  const supabaseAdmin = createAdminClient();

  let query = supabaseAdmin
    .from("fixed_rider_assignments")
    .select(
      `
      id,
      note,
      created_at,
      customer_profile_id,
      customer_profiles!inner ( franchise_id, users ( full_name, mobile ) ),
      rider_profiles!inner ( id, employee_code, users ( full_name ) )
    `,
    )
    .order("created_at", { ascending: false });

  // Scope by the pinned customer's franchise.
  query = applyOperationsScope(query, scope, "customer_profiles.franchise_id");

  const { data, error } = await query;

  if (error) {
    console.error("Error fetching fixed assignments:", error);
    return [];
  }

  return (data || []).map((row: any) => {
    const customerUser = Array.isArray(row.customer_profiles)
      ? row.customer_profiles[0]?.users
      : row.customer_profiles?.users;
    const rider = Array.isArray(row.rider_profiles)
      ? row.rider_profiles[0]
      : row.rider_profiles;
    const riderUser = Array.isArray(rider?.users) ? rider?.users[0] : rider?.users;

    return {
      id: row.id,
      customerProfileId: row.customer_profile_id,
      customerName: customerUser?.full_name || "Unknown",
      customerMobile: customerUser?.mobile || "N/A",
      riderId: rider?.id || "",
      riderName: riderUser?.full_name || "Unknown",
      riderCode: rider?.employee_code || "N/A",
      note: row.note ?? null,
      createdAt: row.created_at,
    };
  });
}

/**
 * Search active customers for assignment. Matches against full name, mobile and
 * email. Returns the customer's known delivery pincodes for admin reference.
 */
export async function searchCustomersForFixedAssignment(
  query: string,
  scope?: OperationsScope,
): Promise<AssignableCustomer[]> {
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];

  const supabaseAdmin = createAdminClient();
  const pattern = `%${trimmed}%`;

  // Find matching users first, then their customer profiles + addresses.
  const { data: users, error: usersError } = await supabaseAdmin
    .from("users")
    .select("id, full_name, mobile, email")
    .or(`full_name.ilike.${pattern},mobile.ilike.${pattern},email.ilike.${pattern}`)
    .limit(15);

  if (usersError || !users?.length) {
    if (usersError) console.error("Error searching customers:", usersError);
    return [];
  }

  const userIds = users.map((u) => u.id);

  let profilesQuery = supabaseAdmin
    .from("customer_profiles")
    .select("id, user_id, addresses ( pincode )")
    .in("user_id", userIds)
    .eq("is_active", true);

  // Only surface customers within the active scope (franchise/core).
  profilesQuery = applyOperationsScope(profilesQuery, scope);

  const { data: profiles, error: profilesError } = await profilesQuery;

  if (profilesError || !profiles?.length) {
    if (profilesError) console.error("Error loading customer profiles:", profilesError);
    return [];
  }

  const usersById = new Map(users.map((u) => [u.id, u]));

  return profiles.map((profile: any) => {
    const user = usersById.get(profile.user_id);
    const pincodes = Array.from(
      new Set(
        (profile.addresses || [])
          .map((a: any) => a?.pincode)
          .filter(Boolean) as string[],
      ),
    );
    return {
      customerProfileId: profile.id,
      name: user?.full_name || "Unknown",
      mobile: user?.mobile || "N/A",
      email: user?.email || "N/A",
      pincodes,
    };
  });
}

/**
 * List active riders with their mapped service-area pincodes for the assignment UI.
 */
export async function getAssignableRiders(
  scope?: OperationsScope,
): Promise<AssignableRider[]> {
  const supabaseAdmin = createAdminClient();

  let query = supabaseAdmin
    .from("rider_profiles")
    .select(
      `
      id,
      employee_code,
      users!inner ( full_name ),
      rider_service_areas ( pincode )
    `,
    )
    .eq("is_active", true);

  query = applyOperationsScope(query, scope);

  const { data, error } = await query;

  if (error) {
    console.error("Error fetching assignable riders:", error);
    return [];
  }

  return (data || []).map((r: any) => ({
    id: r.id,
    name: r.users?.full_name || "Unknown",
    employeeCode: r.employee_code || "N/A",
    pincodes: (r.rider_service_areas || []).map((a: any) => a.pincode),
  }));
}

/**
 * Create or update a permanent customer -> rider override. A customer can only
 * be pinned to a single rider, so this upserts on customer_profile_id.
 */
export async function upsertFixedAssignment(
  customerProfileId: string,
  riderId: string,
  note?: string,
) {
  if (!customerProfileId || !riderId) {
    return { success: false, error: "Customer and rider are both required." };
  }

  const supabaseAdmin = createAdminClient();

  const { error } = await supabaseAdmin
    .from("fixed_rider_assignments")
    .upsert(
      {
        customer_profile_id: customerProfileId,
        rider_id: riderId,
        note: note?.trim() || null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "customer_profile_id" },
    );

  if (error) {
    console.error("Error saving fixed assignment:", error);
    return { success: false, error: error.message };
  }

  await logAdminAction("UPDATE", "fixed_rider_assignment", customerProfileId, {
    rider_id: riderId,
  });
  revalidatePath("/admin/operations");
  return { success: true };
}

/**
 * Remove a permanent override. Future routing runs revert to pincode-based
 * assignment for this customer.
 */
export async function removeFixedAssignment(id: string) {
  const supabaseAdmin = createAdminClient();

  const { error } = await supabaseAdmin
    .from("fixed_rider_assignments")
    .delete()
    .eq("id", id);

  if (error) {
    console.error("Error removing fixed assignment:", error);
    return { success: false, error: error.message };
  }

  await logAdminAction("DELETE", "fixed_rider_assignment", id, {});
  revalidatePath("/admin/operations");
  return { success: true };
}
