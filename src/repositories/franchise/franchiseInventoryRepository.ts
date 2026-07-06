// src/repositories/franchise/franchiseInventoryRepository.ts
// Data-access layer for the franchise inventory feature
// (`franchise_inventories`, `franchise_inventory_lots`,
//  `franchise_stock_transfers`, `franchise_stock_transfer_lines`,
//  `franchise_inventory_ledger`)
// (franchise-inventory spec — Task 9.1).
//
// LAYERING: Data-access ONLY. No business validation, no 'use server' wrappers.
// All access uses the service-role admin client (createAdminClient).
//
// Every read applies the caller's Scope on the denormalized `franchise_id`
// column (for transfers: `dest_franchise_id`) via `applyScope`, so a
// franchise-scoped caller can never read another franchise's rows even if a
// different id is passed — mirroring the database-level RLS predicate.
//
// Requirements validated: 2.6, 11.3, 11.4, 11.6

import { createAdminClient } from "@/lib/supabase/admin";
import { applyScope } from "@/lib/auth/scope-resolver";
import type { Scope } from "@/types/franchise";
import type { FranchiseTransferState } from "@/types/franchiseInventory";

// ---------------------------------------------------------------------------
// Column projections
// ---------------------------------------------------------------------------

const INVENTORY_COLUMNS = "id, franchise_id, created_at, updated_at";

const LOT_COLUMNS = [
  "id",
  "franchise_id",
  "inventory_id",
  "product_id",
  "batch_number",
  "quantity_remaining",
  "expiry_date",
  "received_at",
  "source_transfer_id",
  "status",
  "created_at",
  "updated_at",
].join(", ");

const TRANSFER_COLUMNS = [
  "id",
  "dest_franchise_id",
  "product_id",
  "quantity",
  "state",
  "source_central_kitchen_id",
  "dispatched_at",
  "accepted_at",
  "received_at",
  "rejected_at",
  "dispatched_by",
  "acted_by",
  "package_image_paths",
  "created_at",
  "updated_at",
].join(", ");

const TRANSFER_LINE_COLUMNS = [
  "id",
  "transfer_id",
  "franchise_id",
  "batch_number",
  "quantity",
  "expiry_date",
  "source_lot_id",
].join(", ");

const LEDGER_COLUMNS = [
  "id",
  "franchise_id",
  "direction",
  "product_id",
  "quantity",
  "batch_breakdown",
  "source_transfer_id",
  "source_central_kitchen_id",
  "stock_out_reason",
  "comment",
  "occurred_at",
].join(", ");

// ---------------------------------------------------------------------------
// Row types (DB shape — callers map to domain types in the service layer)
// ---------------------------------------------------------------------------

export interface FranchiseInventoryRow {
  id: string;
  franchise_id: string;
  created_at: string;
  updated_at: string;
}

export interface FranchiseInventoryLotRow {
  id: string;
  franchise_id: string;
  inventory_id: string;
  product_id: string;
  batch_number: string;
  quantity_remaining: number;
  expiry_date: string;
  received_at: string;
  source_transfer_id: string;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface FranchiseStockTransferRow {
  id: string;
  dest_franchise_id: string;
  product_id: string;
  quantity: number;
  state: FranchiseTransferState;
  source_central_kitchen_id: string | null;
  dispatched_at: string;
  accepted_at: string | null;
  received_at: string | null;
  rejected_at: string | null;
  dispatched_by: string | null;
  acted_by: string | null;
  package_image_paths: string[] | null;
  created_at: string;
  updated_at: string;
}

export interface FranchiseStockTransferLineRow {
  id: string;
  transfer_id: string;
  franchise_id: string;
  batch_number: string;
  quantity: number;
  expiry_date: string;
  source_lot_id: string | null;
}

export interface FranchiseInventoryLedgerRow {
  id: number;
  franchise_id: string;
  direction: "IN" | "OUT";
  product_id: string;
  quantity: number;
  batch_breakdown: unknown; // JSONB — [{batch_number, quantity, expiry_date}]
  source_transfer_id: string | null;
  source_central_kitchen_id: string | null;
  stock_out_reason: string | null;
  comment: string | null;
  occurred_at: string;
}

// ---------------------------------------------------------------------------
// Repository functions
// ---------------------------------------------------------------------------

/**
 * Fetch the single `franchise_inventories` row owned by a franchise.
 * Returns `null` when the franchise has no provisioned inventory yet.
 */
export async function getInventoryByFranchise(
  franchiseId: string,
  scope: Scope
): Promise<FranchiseInventoryRow | null> {
  const admin = createAdminClient();
  const base = admin
    .from("franchise_inventories")
    .select(INVENTORY_COLUMNS)
    .eq("franchise_id", franchiseId);

  const { data, error } = await applyScope(base, scope).maybeSingle();

  if (error) {
    throw new Error(
      `Failed to fetch inventory for franchise ${franchiseId}: ${error.message}`
    );
  }
  return (data as FranchiseInventoryRow) ?? null;
}

/**
 * List all ACTIVE lots for a franchise, ordered by expiry_date ASC then
 * received_at ASC (FIFO). This ordering ensures the earliest-expiry batch
 * appears first, with ties broken by earliest received date.
 */
export async function listActiveLots(
  franchiseId: string,
  scope: Scope
): Promise<FranchiseInventoryLotRow[]> {
  const admin = createAdminClient();
  const base = admin
    .from("franchise_inventory_lots")
    .select(LOT_COLUMNS)
    .eq("franchise_id", franchiseId)
    .eq("status", "ACTIVE")
    .order("expiry_date", { ascending: true })
    .order("received_at", { ascending: true });

  const { data, error } = await applyScope(base, scope);

  if (error) {
    throw new Error(
      `Failed to list active lots for franchise ${franchiseId}: ${error.message}`
    );
  }
  return (data as unknown as FranchiseInventoryLotRow[]) ?? [];
}

/**
 * List stock transfers destined for a franchise, optionally filtered by state.
 * Defaults to DISPATCHED + ACCEPTED (in-transit transfers) when no states are
 * provided. Ordered by dispatched_at DESC (most recent first).
 *
 * Note: for transfers, Scope is applied on `dest_franchise_id` since that is
 * the denormalized franchise column for RLS on this table.
 */
export async function listTransfers(
  franchiseId: string,
  scope: Scope,
  states?: FranchiseTransferState[]
): Promise<FranchiseStockTransferRow[]> {
  const filterStates: FranchiseTransferState[] =
    states ?? ["DISPATCHED", "ACCEPTED"];

  const admin = createAdminClient();
  const query = admin
    .from("franchise_stock_transfers")
    .select(TRANSFER_COLUMNS)
    .eq("dest_franchise_id", franchiseId)
    .in("state", filterStates)
    .order("dispatched_at", { ascending: false });

  // Apply scope on dest_franchise_id (the RLS column for transfers)
  const scoped = applyScopeOnColumn(query, scope, "dest_franchise_id");

  const { data, error } = await scoped;

  if (error) {
    throw new Error(
      `Failed to list transfers for franchise ${franchiseId}: ${error.message}`
    );
  }
  return (data as unknown as FranchiseStockTransferRow[]) ?? [];
}

/**
 * Fetch a single transfer by its ID, including its transfer lines (batch
 * breakdown). Returns `null` if the transfer is not found or not visible under
 * the caller's scope.
 */
export async function getTransferById(
  id: string,
  scope: Scope
): Promise<
  (FranchiseStockTransferRow & { lines: FranchiseStockTransferLineRow[] }) | null
> {
  const admin = createAdminClient();

  // Fetch the transfer header
  let headerQuery = admin
    .from("franchise_stock_transfers")
    .select(TRANSFER_COLUMNS)
    .eq("id", id);

  headerQuery = applyScopeOnColumn(headerQuery, scope, "dest_franchise_id");

  const { data: transfer, error: transferError } =
    await headerQuery.maybeSingle();

  if (transferError) {
    throw new Error(
      `Failed to fetch transfer ${id}: ${transferError.message}`
    );
  }
  if (!transfer) {
    return null;
  }

  // Fetch the associated lines
  const { data: lines, error: linesError } = await admin
    .from("franchise_stock_transfer_lines")
    .select(TRANSFER_LINE_COLUMNS)
    .eq("transfer_id", id)
    .order("expiry_date", { ascending: true });

  if (linesError) {
    throw new Error(
      `Failed to fetch transfer lines for ${id}: ${linesError.message}`
    );
  }

  return {
    ...(transfer as unknown as FranchiseStockTransferRow),
    lines: (lines as unknown as FranchiseStockTransferLineRow[]) ?? [],
  };
}

/**
 * List franchise inventory ledger entries, ordered newest-first with ties
 * broken by descending insertion order (id DESC) — Req 11.4.
 * An optional `limit` constrains the number of rows returned.
 */
export async function listLedgerEntries(
  franchiseId: string,
  scope: Scope,
  limit?: number
): Promise<FranchiseInventoryLedgerRow[]> {
  const admin = createAdminClient();
  let base = admin
    .from("franchise_inventory_ledger")
    .select(LEDGER_COLUMNS)
    .eq("franchise_id", franchiseId)
    .order("occurred_at", { ascending: false })
    .order("id", { ascending: false });

  if (limit !== undefined && limit > 0) {
    base = base.limit(limit);
  }

  const { data, error } = await applyScope(base, scope);

  if (error) {
    throw new Error(
      `Failed to list ledger entries for franchise ${franchiseId}: ${error.message}`
    );
  }
  return (data as unknown as FranchiseInventoryLedgerRow[]) ?? [];
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Applies the Scope on a specific column (instead of the default `franchise_id`).
 * Needed for `franchise_stock_transfers` where the RLS column is
 * `dest_franchise_id` rather than `franchise_id`.
 */
function applyScopeOnColumn<Q>(
  query: Q,
  scope: Scope,
  column: string
): Q {
  const builder = query as unknown as {
    eq(col: string, val: unknown): unknown;
    is(col: string, val: unknown): unknown;
  };
  switch (scope.kind) {
    case "franchise":
      return builder.eq(column, scope.franchise_id) as unknown as Q;
    case "core":
      return builder.is(column, null) as unknown as Q;
    case "full_network":
      return query;
  }
}
