// src/repositories/disputeRepository.ts
// Data-access layer for the franchise dispute management feature.
//
// LAYERING: Data-access ONLY. This module performs all Supabase reads/writes
// for dispute operations (listing, creating, updating disputes and fetching
// received orders). It applies NO business validation (that lives in the
// server actions layer) and contains NO `'use server'` wrappers.
//
// ACCESS PATTERN:
// - All operations use `createAdminClient` from `@/lib/supabase/admin`
//   (bypasses RLS via service role key), matching the established pattern
//   across all franchise portal page reads and mutations.
// - Franchise-scoped reads filter by franchise_id from the cookie.
//
// Requirements: 1.1, 3.1, 3.4, 3.5, 5.2, 7.1, 7.3, 7.4, 9.6

import { createAdminClient } from "@/lib/supabase/admin";
import type { DisputeStatus } from "@/validations/disputeSchema";
import type {
  Dispute,
  DisputeWithFranchiseName,
  ReceivedOrderOption,
  CreateDisputeInput,
} from "@/types/dispute";

// ---------------------------------------------------------------------------
// Reads (Franchise-scoped — uses RLS-scoped client)
// ---------------------------------------------------------------------------

/**
 * Fetches all disputes for a specific franchise, ordered by created_at DESC.
 * Uses the admin client with a manual franchise_id filter, matching the
 * pattern used by all other franchise portal page reads.
 *
 * Req 3.1, 3.4, 3.5
 */
export async function getDisputesByFranchise(
  franchiseId: string
): Promise<Dispute[]> {
  const admin = createAdminClient();

  const { data, error } = await admin
    .from("franchise_disputes")
    .select("*")
    .eq("franchise_id", franchiseId)
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(`Failed to fetch disputes for franchise: ${error.message}`);
  }

  return (data ?? []) as Dispute[];
}


// ---------------------------------------------------------------------------
// Reads (Admin-scoped — uses admin client)
// ---------------------------------------------------------------------------

/**
 * Fetches all disputes joined with franchise name for the master portal.
 * Optionally filters by franchise_id. Ordered by created_at DESC.
 *
 * Req 7.1, 7.3, 7.4
 */
export async function getAllDisputes(
  franchiseFilter?: string
): Promise<DisputeWithFranchiseName[]> {
  const admin = createAdminClient();

  let query = admin
    .from("franchise_disputes")
    .select("*, franchises(name)")
    .order("created_at", { ascending: false });

  if (franchiseFilter) {
    query = query.eq("franchise_id", franchiseFilter);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(`Failed to fetch all disputes: ${error.message}`);
  }

  // Flatten the joined franchise name into the dispute row
  const disputes: DisputeWithFranchiseName[] = (data ?? []).map((row: any) => ({
    id: row.id,
    franchise_id: row.franchise_id,
    category: row.category,
    description: row.description,
    status: row.status,
    master_admin_comment: row.master_admin_comment,
    related_order_ids: row.related_order_ids,
    created_at: row.created_at,
    updated_at: row.updated_at,
    franchise_name: row.franchises?.name ?? "Unknown",
  }));

  return disputes;
}

/**
 * Fetches received stock transfers within the last 72 hours for a franchise.
 * Used to populate the order selection dropdown for Inventory disputes.
 *
 * Filters:
 * - dest_franchise_id = franchiseId
 * - state = 'RECEIVED'
 * - received_at >= (now - 72 hours)
 *
 * Joins with inventory_products to get the product name.
 *
 * Req 5.2
 */
export async function getReceivedOrdersForFranchise(
  franchiseId: string
): Promise<ReceivedOrderOption[]> {
  const admin = createAdminClient();

  const seventyTwoHoursAgo = new Date(
    Date.now() - 72 * 60 * 60 * 1000
  ).toISOString();

  const { data, error } = await admin
    .from("franchise_stock_transfers")
    .select("id, quantity, received_at, inventory_products(name)")
    .eq("dest_franchise_id", franchiseId)
    .eq("state", "RECEIVED")
    .gte("received_at", seventyTwoHoursAgo);

  if (error) {
    throw new Error(
      `Failed to fetch received orders for franchise: ${error.message}`
    );
  }

  // Flatten the joined product name
  return (data ?? []).map((row: any) => ({
    id: row.id,
    product_name: row.inventory_products?.name ?? "Unknown Product",
    quantity: Number(row.quantity),
    received_at: row.received_at,
  }));
}

/**
 * Fetches distinct franchises that have at least one dispute.
 * Used to populate the franchise filter dropdown in the master portal.
 *
 * Req 7.4
 */
export async function getFranchisesWithDisputes(): Promise<
  { id: string; name: string }[]
> {
  const admin = createAdminClient();

  const { data, error } = await admin
    .from("franchise_disputes")
    .select("franchise_id, franchises(name)")
    .order("franchise_id");

  if (error) {
    throw new Error(
      `Failed to fetch franchises with disputes: ${error.message}`
    );
  }

  // Deduplicate franchise_ids and flatten
  const seen = new Set<string>();
  const franchises: { id: string; name: string }[] = [];

  for (const row of data ?? []) {
    if (!seen.has(row.franchise_id)) {
      seen.add(row.franchise_id);
      franchises.push({
        id: row.franchise_id,
        name: (row as any).franchises?.name ?? "Unknown",
      });
    }
  }

  return franchises;
}

// ---------------------------------------------------------------------------
// Mutations (Admin-scoped — uses admin client, bypasses RLS)
// ---------------------------------------------------------------------------

/**
 * Creates a new dispute record. Returns the generated id.
 *
 * Req 1.1
 */
export async function createDispute(
  data: CreateDisputeInput
): Promise<{ id: string }> {
  const admin = createAdminClient();

  const { data: inserted, error } = await admin
    .from("franchise_disputes")
    .insert({
      franchise_id: data.franchise_id,
      category: data.category,
      description: data.description,
      related_order_ids: data.related_order_ids ?? null,
    })
    .select("id")
    .single();

  if (error) {
    throw new Error(`Failed to create dispute: ${error.message}`);
  }

  return { id: inserted.id };
}

/**
 * Updates a dispute's status and master admin comment.
 *
 * Req 1.1
 */
export async function updateDisputeStatus(
  id: string,
  status: DisputeStatus,
  comment: string
): Promise<void> {
  const admin = createAdminClient();

  const { error } = await admin
    .from("franchise_disputes")
    .update({
      status,
      master_admin_comment: comment,
    })
    .eq("id", id);

  if (error) {
    throw new Error(`Failed to update dispute status: ${error.message}`);
  }
}
