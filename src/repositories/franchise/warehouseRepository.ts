// src/repositories/franchise/warehouseRepository.ts
// Data-access layer for franchise warehouse + stock
// (`franchise_warehouses`, `franchise_warehouse_stock`)
// (multi-tenant-franchise — Task 3.4).
//
// LAYERING: Data-access ONLY. No business validation, no 'use server' wrappers.
// All access uses the service-role admin client (createAdminClient).
//
// Each Franchise owns EXACTLY ONE warehouse (`franchise_warehouses.franchise_id`
// UNIQUE, Req 19.1). Stock rows carry a denormalized `franchise_id` so the
// franchise `Scope` can filter them directly on that column via `applyScope`
// (Req 19.6) — exactly mirroring the RLS predicate.

import { createAdminClient } from "@/lib/supabase/admin";
import { applyScope } from "@/lib/auth/scope-resolver";
import type {
  FranchiseWarehouse,
  FranchiseWarehouseStock,
  Scope,
} from "@/types/franchise";

const WAREHOUSE_COLUMNS = "id, franchise_id, name";
const STOCK_COLUMNS = "id, warehouse_id, franchise_id, product_id, quantity";

/**
 * Fetch the single warehouse owned by a Franchise via `franchise_id` (Req 19.1).
 * Returns `null` when the Franchise has no warehouse yet.
 */
export async function getWarehouseByFranchise(
  franchiseId: string
): Promise<FranchiseWarehouse | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("franchise_warehouses")
    .select(WAREHOUSE_COLUMNS)
    .eq("franchise_id", franchiseId)
    .maybeSingle();

  if (error) {
    throw new Error(
      `Failed to fetch warehouse for franchise ${franchiseId}: ${error.message}`
    );
  }
  return (data as FranchiseWarehouse) ?? null;
}

/**
 * Ensure a Franchise has its single warehouse, creating it if absent, and return
 * it (Req 19.1). The `franchise_id` UNIQUE constraint guarantees at most one
 * warehouse per Franchise; this helper is idempotent — calling it repeatedly
 * returns the existing warehouse rather than creating duplicates.
 */
export async function ensureWarehouseForFranchise(
  franchiseId: string,
  name?: string
): Promise<FranchiseWarehouse> {
  const existing = await getWarehouseByFranchise(franchiseId);
  if (existing) {
    return existing;
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("franchise_warehouses")
    .insert({
      franchise_id: franchiseId,
      name: name ?? "Franchise Warehouse",
    })
    .select(WAREHOUSE_COLUMNS)
    .single();

  if (error || !data) {
    throw new Error(
      `Failed to ensure warehouse for franchise ${franchiseId}: ${error?.message ?? "unknown error"}`
    );
  }
  return data as FranchiseWarehouse;
}

/**
 * List warehouse stock for a Franchise, applying the caller's {@link Scope} on
 * the denormalized `franchise_id` column (Req 19.6). The explicit
 * `franchise_id` filter narrows to the requested Franchise, and `applyScope`
 * additionally enforces tenant isolation so a franchise-scoped caller can never
 * read another Franchise's stock even if it passes a different `franchiseId`.
 */
export async function listWarehouseStock(
  franchiseId: string,
  scope: Scope
): Promise<FranchiseWarehouseStock[]> {
  const admin = createAdminClient();
  const base = admin
    .from("franchise_warehouse_stock")
    .select(STOCK_COLUMNS)
    .eq("franchise_id", franchiseId);

  const { data, error } = await applyScope(base, scope).order("product_id", {
    ascending: true,
  });

  if (error) {
    throw new Error(
      `Failed to list warehouse stock for franchise ${franchiseId}: ${error.message}`
    );
  }
  return (data ?? []) as FranchiseWarehouseStock[];
}

/**
 * Fetch a single warehouse-stock row by its identifier, applying the caller's
 * {@link Scope} so a franchise-scoped caller can only read rows that belong to
 * its own Franchise (Req 19.6). Returns `null` when no row is visible under the
 * scope.
 */
export async function getWarehouseStockById(
  id: string,
  scope: Scope
): Promise<FranchiseWarehouseStock | null> {
  const admin = createAdminClient();
  const base = admin
    .from("franchise_warehouse_stock")
    .select(STOCK_COLUMNS)
    .eq("id", id);

  const { data, error } = await applyScope(base, scope).maybeSingle();

  if (error) {
    throw new Error(`Failed to fetch warehouse stock ${id}: ${error.message}`);
  }
  return (data as FranchiseWarehouseStock) ?? null;
}
