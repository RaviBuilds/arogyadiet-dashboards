// src/repositories/clinic/clinicProductRepository.ts
// Data-access layer for the per-clinic shop stock overlay
// (`clinic_product_settings`) and its atomic mutation RPCs
// (`clinic_shop_stock_in`, `set_clinic_product_visibility`)
// (clinic-scoped-shop-inventory spec — Task 4.4).
//
// LAYERING: Data-access ONLY. No business validation (that lives in
// src/lib/shop/clinicStock.ts) and no 'use server' wrappers (those live in
// src/actions/admin-actions/clinicShopInventoryActions.ts). Uses the
// service-role admin client, mirroring the clinic and franchise data-access
// pattern (src/repositories/clinic/clinicRepository.ts).
//
// Requirements validated: 5.5, 5.13, 9.4, 9.6, 9.7, 9.8, 9.12, 9.13

import { createAdminClient } from "@/lib/supabase/admin";
import type { ClinicProductOverlayRow } from "@/types/clinicShop";

const OVERLAY_COLUMNS =
  "id, clinic_id, product_id, stock_quantity, is_visible, created_at, updated_at";

/**
 * One line of a Stock In submission: how many shop items of a Shop_Product to
 * move from warehouse stock into a Core_Clinic's Clinic_Shop_Stock.
 */
export interface StockInLine {
  productId: string;
  quantity: number;
}

/**
 * One applied line of a Stock In submission, as reported by the
 * `clinic_shop_stock_in` RPC.
 */
export interface StockInAppliedLine {
  productId: string;
  quantity: number;
  stockBefore: number;
  stockAfter: number;
  transactionIds: string[];
  ledgerEntryId: string;
}

/**
 * The camelCase report returned by {@link applyStockIn}, mapped from the
 * `clinic_shop_stock_in` RPC's snake_case jsonb response.
 */
export interface StockInReport {
  clinicId: string;
  applied: StockInAppliedLine[];
  totalQuantity: number;
}

/**
 * List every Clinic_Shop_Stock overlay row for one Core_Clinic, across every
 * Shop_Product that holds a record for that clinic. (Req 9.4)
 */
export async function listClinicOverlays(
  clinicId: string
): Promise<ClinicProductOverlayRow[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("clinic_product_settings")
    .select(OVERLAY_COLUMNS)
    .eq("clinic_id", clinicId);

  if (error) {
    throw new Error(
      `Failed to list clinic overlays for clinic ${clinicId}: ${error.message}`
    );
  }
  return (data ?? []) as ClinicProductOverlayRow[];
}

/**
 * List every Clinic_Shop_Stock overlay row for one Shop_Product, across every
 * Core_Clinic that holds a record for that product. Used to compute
 * Aggregate_Stock for a single product. (Req 5.5)
 */
export async function listOverlaysForProduct(
  productId: string
): Promise<ClinicProductOverlayRow[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("clinic_product_settings")
    .select(OVERLAY_COLUMNS)
    .eq("product_id", productId);

  if (error) {
    throw new Error(
      `Failed to list clinic overlays for product ${productId}: ${error.message}`
    );
  }
  return (data ?? []) as ClinicProductOverlayRow[];
}

/**
 * Fetch the single Clinic_Shop_Stock overlay row for one (clinic, product)
 * pair. Returns `null` when no such record exists — a missing overlay is a
 * valid, meaningful state (Effective_Clinic_Stock 0, Effective_Clinic_Visibility
 * hidden — Req 1.13) and is not treated as an error.
 */
export async function getOverlay(
  clinicId: string,
  productId: string
): Promise<ClinicProductOverlayRow | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("clinic_product_settings")
    .select(OVERLAY_COLUMNS)
    .eq("clinic_id", clinicId)
    .eq("product_id", productId)
    .maybeSingle();

  if (error) {
    throw new Error(
      `Failed to fetch overlay for clinic ${clinicId} and product ${productId}: ${error.message}`
    );
  }
  return (data as ClinicProductOverlayRow) ?? null;
}

/**
 * Compute the Aggregate_Stock of every Shop_Product: the sum of
 * `stock_quantity` across every Core_Clinic's Clinic_Shop_Stock record, keyed
 * by `product_id`. (Req 5.5, 3.10)
 *
 * The Supabase JS client v2 query builder has no clean server-side GROUP BY
 * expression, so this selects every overlay row's `product_id` and
 * `stock_quantity` and reduces them into the Map in TypeScript. This is a
 * repository-layer concern, not a performance-critical hot path.
 */
export async function listAggregateStockByProduct(): Promise<
  Map<string, number>
> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("clinic_product_settings")
    .select("product_id, stock_quantity");

  if (error) {
    throw new Error(
      `Failed to list aggregate clinic stock by product: ${error.message}`
    );
  }

  const totals = new Map<string, number>();
  for (const row of (data ?? []) as { product_id: string; stock_quantity: number }[]) {
    totals.set(row.product_id, (totals.get(row.product_id) ?? 0) + row.stock_quantity);
  }
  return totals;
}

/**
 * Set the Clinic_Visibility of one Shop_Product for one Core_Clinic via the
 * `set_clinic_product_visibility` RPC. The RPC upserts a missing overlay row
 * at stock 0 (Req 6.4, 19.6), so this never needs to distinguish "create" from
 * "update".
 */
export async function setVisibility(
  clinicId: string,
  productId: string,
  isVisible: boolean
): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin.rpc("set_clinic_product_visibility", {
    p_clinic_id: clinicId,
    p_product_id: productId,
    p_is_visible: isVisible,
  });

  if (error) {
    throw new Error(
      `Failed to set visibility for clinic ${clinicId} and product ${productId}: ${error.message}`
    );
  }
}

/**
 * Move stock from warehouse Master_Catalog_Product stock into a Core_Clinic's
 * Clinic_Shop_Stock via the `clinic_shop_stock_in` RPC, one line per
 * Shop_Product. Maps the camelCase `lines` input into the RPC's snake_case
 * jsonb `p_lines` parameter and maps the RPC's snake_case jsonb response back
 * into a camelCase {@link StockInReport}.
 *
 * Throws on an RPC error, surfacing the RPC's exception message unchanged so
 * the action layer can map the stable prefixes
 * (`CLINIC_STOCK_INSUFFICIENT_WAREHOUSE:`, `CLINIC_STOCK_EXCEEDS_MAXIMUM:`,
 * `CLINIC_STOCK_UNLINKED_PRODUCT:`) to user-facing copy.
 */
export async function applyStockIn(
  clinicId: string,
  lines: StockInLine[],
  actorUserId: string
): Promise<StockInReport> {
  const admin = createAdminClient();

  const pLines = lines.map((line) => ({
    product_id: line.productId,
    quantity: line.quantity,
  }));

  const { data, error } = await admin.rpc("clinic_shop_stock_in", {
    p_clinic_id: clinicId,
    p_lines: pLines,
    p_actor_user_id: actorUserId,
  });

  if (error) {
    throw new Error(
      `Failed to apply stock in for clinic ${clinicId}: ${error.message}`
    );
  }

  const report = data as {
    clinic_id: string;
    applied: {
      product_id: string;
      quantity: number;
      stock_before: number;
      stock_after: number;
      transaction_ids: string[];
      ledger_entry_id: string;
    }[];
    total_quantity: number;
  };

  return {
    clinicId: report.clinic_id,
    applied: (report.applied ?? []).map((line) => ({
      productId: line.product_id,
      quantity: line.quantity,
      stockBefore: line.stock_before,
      stockAfter: line.stock_after,
      transactionIds: line.transaction_ids ?? [],
      ledgerEntryId: line.ledger_entry_id,
    })),
    totalQuantity: report.total_quantity,
  };
}
