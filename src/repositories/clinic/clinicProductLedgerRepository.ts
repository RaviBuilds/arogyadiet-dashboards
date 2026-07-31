// src/repositories/clinic/clinicProductLedgerRepository.ts
// Data-access layer for the per-clinic append-only shop stock audit ledger
// (`clinic_product_ledger`) (clinic-scoped-shop-inventory spec — Task 4.4).
//
// LAYERING: Data-access ONLY. No business validation and no 'use server'
// wrappers (those live in
// src/actions/admin-actions/clinicShopInventoryActions.ts). Uses the
// service-role admin client, mirroring the franchise ledger repository
// (src/repositories/franchise/franchiseInventoryRepository.ts::listLedgerEntries).
//
// Requirements validated: 9.6, 9.7, 9.8, 9.12, 9.13

import { createAdminClient } from "@/lib/supabase/admin";
import type { ClinicLedgerEntry } from "@/types/clinicShop";

// Joins `products` for the Shop_Product display name (Req 9.6) and `users`
// for the acting admin's display name, via Supabase's embedded-resource
// select syntax.
const LEDGER_COLUMNS = [
  "id",
  "clinic_id",
  "product_id",
  "direction",
  "quantity",
  "movement_source",
  "actor_user_id",
  "addon_order_id",
  "inventory_transaction_id",
  "occurred_at",
  "products(name)",
  "users(full_name)",
].join(", ");

/** Raw row shape as returned by the embedded-resource select above. */
interface LedgerEntryJoinedRow {
  id: number | string;
  clinic_id: string;
  product_id: string;
  direction: "IN" | "OUT";
  quantity: number;
  movement_source: ClinicLedgerEntry["movement_source"];
  actor_user_id: string;
  addon_order_id: string | null;
  inventory_transaction_id: string | null;
  occurred_at: string;
  products: { name: string } | { name: string }[] | null;
  users: { full_name: string | null } | { full_name: string | null }[] | null;
}

function firstJoined<T>(value: T | T[] | null): T | null {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }
  return value ?? null;
}

/**
 * List every Clinic_Shop_Ledger entry for one Core_Clinic, ordered by
 * occurrence timestamp descending with ties broken by the ledger entry
 * identifier descending (Req 9.7). Optionally filtered to only `IN` or only
 * `OUT` entries (Req 9.8). The BIGINT `id` column is serialised as a string
 * on the returned {@link ClinicLedgerEntry} to avoid precision loss, matching
 * the franchise ledger convention.
 */
export async function listLedgerEntries(
  clinicId: string,
  filter?: { direction?: "IN" | "OUT" }
): Promise<ClinicLedgerEntry[]> {
  const admin = createAdminClient();

  let query = admin
    .from("clinic_product_ledger")
    .select(LEDGER_COLUMNS)
    .eq("clinic_id", clinicId)
    .order("occurred_at", { ascending: false })
    .order("id", { ascending: false });

  if (filter?.direction) {
    query = query.eq("direction", filter.direction);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(
      `Failed to list ledger entries for clinic ${clinicId}: ${error.message}`
    );
  }

  return ((data ?? []) as unknown as LedgerEntryJoinedRow[]).map((row) => {
    const product = firstJoined(row.products);
    const actor = firstJoined(row.users);

    return {
      id: String(row.id),
      clinic_id: row.clinic_id,
      product_id: row.product_id,
      product_name: product?.name ?? "Unknown Product",
      direction: row.direction,
      quantity: row.quantity,
      movement_source: row.movement_source,
      actor_user_id: row.actor_user_id,
      actor_name: actor?.full_name ?? null,
      addon_order_id: row.addon_order_id,
      inventory_transaction_id: row.inventory_transaction_id,
      occurred_at: row.occurred_at,
    };
  });
}
