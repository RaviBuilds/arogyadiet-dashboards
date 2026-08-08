// src/types/clinicShop.ts
// TypeScript types for the per-clinic shop stock overlay and its append-only
// audit ledger (clinic-scoped-shop-inventory spec — Task 2.1).
//
// These types mirror the additive SQL schema created by
// `scripts/create-clinic-product-settings-table.sql` and
// `scripts/create-clinic-product-ledger-table.sql`, so row fields stay in
// snake_case exactly as the database returns them — the convention already used
// by the clinic and franchise domain types.
//
// Requirements validated: 1.1, 2.1, 5.5

/**
 * Direction of a single clinic shop stock movement. `IN` raises the clinic's
 * stock (warehouse stock-in or data migration), `OUT` lowers it (a sale).
 * Mirrors the `clinic_ledger_direction` Postgres enum. (Req 2.1)
 */
export type ClinicLedgerDirection = "IN" | "OUT";

/**
 * Classification of what caused a clinic shop stock movement. Mirrors the
 * `clinic_movement_source` Postgres enum. `WAREHOUSE_STOCK_IN` and `MIGRATION`
 * only ever appear on `IN` entries; the three sale sources only ever appear on
 * `OUT` entries — an invariant enforced by `ck_cpl_direction_source`.
 * (Req 2.8, 2.10, 2.11, 2.12)
 */
export type ClinicMovementSource =
  | "WAREHOUSE_STOCK_IN"
  | "CUSTOMER_APP_SALE"
  | "ASSISTED_SALE"
  | "WALKIN_SALE"
  | "MIGRATION";

/**
 * One `clinic_product_settings` row: a single Core Clinic's shop stock figure
 * and visibility flag for a single Shop Product. Unique per
 * (`clinic_id`, `product_id`); `stock_quantity` is an integer between 0 and
 * 1,000,000 inclusive and `is_visible` defaults to `true`.
 *
 * Absence of a row is meaningful: it reads as stock 0 and hidden
 * (Effective_Clinic_Stock / Effective_Clinic_Visibility). (Req 1.1, 1.3, 1.13)
 */
export interface ClinicProductOverlayRow {
  id: string;
  clinic_id: string;
  product_id: string;
  stock_quantity: number;
  is_visible: boolean;
  created_at: string;
  updated_at: string;
}

/**
 * One `clinic_product_ledger` entry: an immutable record of a single clinic
 * shop stock movement, joined with the product and actor display names for the
 * ledger view.
 *
 * `quantity` is always positive — direction carries the sign. Exactly one of
 * `addon_order_id` (sales) / `inventory_transaction_id` (warehouse stock-in) is
 * set, and both are `null` for a `MIGRATION` entry. (Req 2.1, 2.2, 2.10–2.12)
 */
export interface ClinicLedgerEntry {
  /** BIGINT identity column, serialised as a string to avoid precision loss. */
  id: string;
  clinic_id: string;
  product_id: string;
  product_name: string;
  direction: ClinicLedgerDirection;
  quantity: number;
  movement_source: ClinicMovementSource;
  actor_user_id: string;
  actor_name: string | null;
  /** Set for `CUSTOMER_APP_SALE`, `ASSISTED_SALE`, `WALKIN_SALE`. */
  addon_order_id: string | null;
  /** Set for `WAREHOUSE_STOCK_IN`. */
  inventory_transaction_id: string | null;
  /** UTC timestamp of the movement. */
  occurred_at: string;
}

/**
 * A Shop Product as rendered for one destination: the catalogue fields, the
 * Master Catalog link (with the linked product's name and base unit of
 * measure), and the destination's resolved stock and visibility.
 *
 * `stock_quantity` and `is_visible` carry the *effective* values, so they read
 * 0 / hidden when no overlay row exists — `has_settings` distinguishes that
 * case from a real row that happens to hold 0. `catalog_active` is the
 * product-level Global_Visibility flag. (Req 5.5, 5.6)
 */
export interface ClinicShopProductRow {
  id: string;
  sku: string | null;
  name: string;
  original_price: number;
  sale_price: number | null;
  inventory_product_id: string | null;
  inventory_product_name: string | null;
  base_uom: string | null;
  /**
   * Primary catalogue thumbnail for the product: the first entry of
   * `products.image_urls`, falling back to `products.banner_image_url`, or
   * `null` when the product has no artwork. Derived rather than a raw column so
   * consumers do not have to repeat the fallback.
   */
  image_url: string | null;
  /** Effective_Clinic_Stock: 0 when no overlay row exists. */
  stock_quantity: number;
  /** Effective_Clinic_Visibility: hidden when no overlay row exists. */
  is_visible: boolean;
  /** Global_Visibility — the `products.is_active` flag. */
  catalog_active: boolean;
  /** Whether a `clinic_product_settings` row actually exists for this pair. */
  has_settings: boolean;
}
