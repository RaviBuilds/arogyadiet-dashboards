"use server";

// src/actions/admin-actions/clinicShopInventoryActions.ts
// Server actions for the per-clinic shop stock overlay, its Stock In flow, and
// the clinic-scoped reads that back the Warehouse Shop Products page
// (Clinic_Mode), the Operations Shop Products page, and the clinic ledger view
// (clinic-scoped-shop-inventory spec — Task 7.1).
//
// LAYERING: "use server" boundary only — auth gate -> Zod validate -> call
// repository/RPC -> revalidatePath, returning the project's existing
// `{ success, error? }` / `ActionResult<T>` shapes (src/types/clinic.ts). No
// business validation lives here beyond what Zod expresses; the pure decision
// rules live in src/lib/shop/clinicStock.ts and are re-applied under row locks
// by the Postgres RPCs (clinic_shop_stock_in, clinic_shop_apply_sale,
// set_clinic_product_visibility).
//
// Requirements validated: 5.1, 5.10, 5.12, 5.14, 6.2, 6.4, 6.9, 7.6, 9.4, 9.6,
// 9.14, 14.4, 14.6, 14.7, 16.1, 16.2, 16.3, 16.4, 16.5, 16.8, 16.9, 19.4, 19.9

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { createAdminClient } from "@/lib/supabase/admin";
import {
  checkClinicScope,
  checkWarehouseAccess,
  getCurrentAdminContext,
} from "@/lib/auth/adminAccess";
import {
  clinicVisibilitySchema,
  productInventoryLinkSchema,
  stockInSubmissionSchema,
} from "@/validations/clinicShopInventory";
import {
  computeAggregateStock,
  resolveEffectiveOverlay,
} from "@/lib/shop/clinicStock";
import {
  applyStockIn,
  listClinicOverlays,
  listOverlaysForProduct,
  setVisibility,
} from "@/repositories/clinic/clinicProductRepository";
import { listLedgerEntries } from "@/repositories/clinic/clinicProductLedgerRepository";
import type {
  ClinicLedgerEntry,
  ClinicLedgerDirection,
  ClinicProductOverlayRow,
  ClinicShopProductRow,
} from "@/types/clinicShop";
import type { ActionResult } from "@/types/clinic";

// ─────────────────────────────────────────────────────────────────────────────
// Result shapes
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The project's existing write-action result shape (matches
 * `inventoryActions.ts`, `franchiseProductActions.ts`). No new result
 * convention is introduced (design.md "Error Handling").
 */
type SimpleResult = { success: boolean; error?: string };

/** One selectable destination in the Destination_Selector. */
export interface DestinationOption {
  id: string;
  name: string;
}

/** The full Destination_Selector option set (Req 5.1). */
export interface DestinationOptionsResult {
  clinics: DestinationOption[];
  franchises: DestinationOption[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Revalidation targets
// ─────────────────────────────────────────────────────────────────────────────

const WAREHOUSE_SHOP_PRODUCTS_PATH = "/admin/inventory/shop-products";
const OPERATIONS_SHOP_PRODUCTS_PATH = "/admin/kitchen-shop/inventory";
const FRANCHISE_SHOP_PRODUCTS_PATH = "/franchise/shop-products";

function revalidateShopProductSurfaces(): void {
  revalidatePath(WAREHOUSE_SHOP_PRODUCTS_PATH);
  revalidatePath(OPERATIONS_SHOP_PRODUCTS_PATH);
}

// ─────────────────────────────────────────────────────────────────────────────
// RPC error-prefix -> user-facing message mapping (design.md "Message mapping")
// ─────────────────────────────────────────────────────────────────────────────

import { mapClinicStockRpcError } from "@/shared/utils/clinicStockErrors";

function errorMessageOf(err: unknown): string {
  return mapClinicStockRpcError(err instanceof Error ? err.message : String(err));
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. clinicStockInAction — Requirement 7, 16.1–16.4, 16.8
// ─────────────────────────────────────────────────────────────────────────────

/** One pending Stock_In line as submitted from the Shop_Products_Cart. */
export interface StockInLineInput {
  productId: string;
  quantity: number;
}

/**
 * Move `lines` worth of warehouse stock into `clinicId`'s Clinic_Shop_Stock via
 * the `clinic_shop_stock_in` RPC (Req 7). Restricted to an Inventory_Admin —
 * an `operations` admin (including a Clinic_Scoped_Admin) is rejected before
 * any validation or mutation runs (Req 16.1, 16.2, 16.3, 16.8), and an
 * unauthenticated caller is rejected before that (Req 16.4).
 */
export async function clinicStockInAction(
  lines: StockInLineInput[],
  clinicId: string,
): Promise<SimpleResult> {
  const gate = await checkWarehouseAccess("inventory_operations");
  if (!gate.ok) return { success: false, error: gate.error };

  const parsed = stockInSubmissionSchema.safeParse({ clinicId, lines });
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message ?? "Invalid stock-in submission.",
    };
  }

  const { userId } = await getCurrentAdminContext();
  if (!userId) {
    return {
      success: false,
      error: "Authentication is required to perform this action.",
    };
  }

  try {
    await applyStockIn(
      parsed.data.clinicId,
      parsed.data.lines.map((line) => ({
        productId: line.productId,
        quantity: line.quantity,
      })),
      userId,
    );
  } catch (err) {
    return { success: false, error: errorMessageOf(err) };
  }

  revalidateShopProductSurfaces();
  return { success: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. setClinicProductVisibilityAction — Requirement 6.2, 6.4, 6.9, 16.5, 16.9
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Set Clinic_Visibility for one (clinic, product) pair via the
 * `set_clinic_product_visibility` RPC, which upserts a missing overlay row at
 * stock 0 (Req 6.4). Restricted to an Inventory_Admin — visibility is managed
 * from warehouse inventory, so a Clinic_Scoped_Admin (or any `operations`
 * admin) is rejected (Req 16.5, 16.9).
 */
export async function setClinicProductVisibilityAction(
  clinicId: string,
  productId: string,
  isVisible: boolean,
): Promise<SimpleResult> {
  const gate = await checkWarehouseAccess("inventory_operations");
  if (!gate.ok) return { success: false, error: gate.error };

  const parsed = clinicVisibilitySchema.safeParse({
    clinicId,
    productId,
    isVisible,
  });
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message ?? "Invalid visibility request.",
    };
  }

  try {
    await setVisibility(
      parsed.data.clinicId,
      parsed.data.productId,
      parsed.data.isVisible,
    );
  } catch (err) {
    return { success: false, error: errorMessageOf(err) };
  }

  revalidateShopProductSurfaces();
  return { success: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. setProductInventoryLinkAction — Requirement 3.7, 3.8, 3.11, 3.12
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Change a Shop_Product's Product_Link. Restricted to `product_management`
 * (catalogue-level changes) and additionally gated on Aggregate_Stock being 0
 * across every Core Clinic (Req 3.11), since re-linking a product that
 * already carries clinic stock would silently repoint what that stock means.
 * Both checks run here regardless of any UI gating (Req 3.12).
 */
export async function setProductInventoryLinkAction(
  productId: string,
  inventoryProductId: string | null,
): Promise<SimpleResult> {
  const gate = await checkWarehouseAccess("product_management");
  if (!gate.ok) return { success: false, error: gate.error };

  const parsed = productInventoryLinkSchema.safeParse({
    productId,
    inventoryProductId,
  });
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message ?? "Invalid product link.",
    };
  }

  let overlays: ClinicProductOverlayRow[];
  try {
    overlays = await listOverlaysForProduct(parsed.data.productId);
  } catch {
    return {
      success: false,
      error: "The product's clinic stock could not be verified.",
    };
  }

  if (computeAggregateStock(overlays) > 0) {
    return {
      success: false,
      error:
        "The Product Link can be changed only while every clinic holds 0 stock of this product.",
    };
  }

  const admin = createAdminClient();

  if (parsed.data.inventoryProductId) {
    const { data: linkedProduct, error: linkedError } = await admin
      .from("inventory_products")
      .select("id")
      .eq("id", parsed.data.inventoryProductId)
      .is("deleted_at", null)
      .maybeSingle();

    if (linkedError) {
      return {
        success: false,
        error: "The selected Master Catalog Product could not be verified.",
      };
    }
    if (!linkedProduct) {
      return {
        success: false,
        error: "The selected Master Catalog Product was not found.",
      };
    }
  }

  const { error } = await admin
    .from("products")
    .update({
      inventory_product_id: parsed.data.inventoryProductId,
      updated_at: new Date().toISOString(),
    })
    .eq("id", parsed.data.productId);

  if (error) {
    return { success: false, error: "The product link could not be saved." };
  }

  revalidateShopProductSurfaces();
  revalidatePath(FRANCHISE_SHOP_PRODUCTS_PATH);
  return { success: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. getDestinationOptionsAction — Requirement 5.1, 5.10, 5.12, 5.14
// ─────────────────────────────────────────────────────────────────────────────

/**
 * List the Destination_Selector's option set: every Core Clinic and every
 * active Franchise. Resolved only for an Inventory_Admin (Req 5.14); the
 * caller falls back to All_Clinics_Mode with the load-failure notice when
 * this returns `success: false` (Req 5.12).
 */
export async function getDestinationOptionsAction(): Promise<
  ActionResult<DestinationOptionsResult>
> {
  const gate = await checkWarehouseAccess("inventory_operations");
  if (!gate.ok) return { success: false, error: gate.error };

  const admin = createAdminClient();

  const [clinicsResult, franchisesResult] = await Promise.all([
    admin
      .from("clinics")
      .select("id, name")
      .is("franchise_id", null)
      .order("name", { ascending: true }),
    admin
      .from("franchises")
      .select("id, name")
      .eq("status", "active")
      .order("name", { ascending: true }),
  ]);

  if (clinicsResult.error || franchisesResult.error) {
    return {
      success: false,
      error: "The destination list could not be loaded.",
    };
  }

  return {
    success: true,
    data: {
      clinics: (clinicsResult.data ?? []).map((row) => ({
        id: row.id,
        name: row.name,
      })),
      franchises: (franchisesResult.data ?? []).map((row) => ({
        id: row.id,
        name: row.name,
      })),
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. getClinicShopViewAction — Requirement 9.4, 9.14, 14.4, 14.6, 14.7
// ─────────────────────────────────────────────────────────────────────────────

const uuidSchema = z.string().uuid("Invalid clinic ID");

/**
 * List every Shop_Product with the Effective_Clinic_Stock and
 * Effective_Clinic_Visibility of `clinicId`, for the Warehouse Shop Products
 * page's Clinic_Mode and the Operations Shop Products page alike.
 *
 * Gated by `checkClinicScope`, the single chokepoint for Requirements 14.6 and
 * 14.7: a Clinic_Scoped_Admin's requested clinic must equal their
 * Clinic_Scope_Assignment, or the request is rejected (Req 14.4, 14.6).
 */
export async function getClinicShopViewAction(
  clinicId: string,
): Promise<ActionResult<ClinicShopProductRow[]>> {
  const idCheck = uuidSchema.safeParse(clinicId);
  if (!idCheck.success) {
    return { success: false, error: idCheck.error.issues[0].message };
  }

  const gate = await checkClinicScope(idCheck.data);
  if (!gate.ok) return { success: false, error: gate.error };

  const resolvedClinicId = gate.clinicId ?? idCheck.data;

  const admin = createAdminClient();
  const { data: products, error: productsError } = await admin
    .from("products")
    .select(
      "id, sku, name, original_price, sale_price, is_active, inventory_product_id, inventory_products(name, base_uom)",
    )
    .is("deleted_at", null)
    .order("name", { ascending: true });

  if (productsError) {
    return {
      success: false,
      error: "The clinic stock data could not be loaded.",
    };
  }

  let overlays: ClinicProductOverlayRow[];
  try {
    overlays = await listClinicOverlays(resolvedClinicId);
  } catch {
    return {
      success: false,
      error: "The clinic stock data could not be loaded.",
    };
  }

  const overlayByProduct = new Map(
    overlays.map((row) => [row.product_id, row] as const),
  );

  const rows: ClinicShopProductRow[] = (products ?? []).map((product) => {
    const overlay = overlayByProduct.get(product.id) ?? null;
    const effective = resolveEffectiveOverlay(overlay);

    const joinedInventoryProduct = Array.isArray(product.inventory_products)
      ? product.inventory_products[0]
      : product.inventory_products;

    return {
      id: product.id,
      sku: product.sku ?? null,
      name: product.name,
      original_price: product.original_price,
      sale_price: product.sale_price ?? null,
      inventory_product_id: product.inventory_product_id ?? null,
      inventory_product_name: joinedInventoryProduct?.name ?? null,
      base_uom: joinedInventoryProduct?.base_uom ?? null,
      stock_quantity: effective.stockQuantity,
      is_visible: effective.isVisible,
      catalog_active: product.is_active,
      has_settings: overlay !== null,
    };
  });

  return { success: true, data: rows };
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. getClinicLedgerAction — Requirement 9.6–9.10, 9.12, 14.4
// ─────────────────────────────────────────────────────────────────────────────

const ledgerFilterSchema = z
  .object({ direction: z.enum(["IN", "OUT"]).optional() })
  .optional();

/**
 * List every Clinic_Shop_Ledger entry for `clinicId`, ordered by occurrence
 * timestamp descending with ties broken by ledger entry id descending
 * (Req 9.7), optionally filtered to only `IN` or only `OUT` entries (Req 9.8).
 *
 * Gated by `checkClinicScope`, mirroring {@link getClinicShopViewAction}
 * (Req 14.4).
 */
export async function getClinicLedgerAction(
  clinicId: string,
  filter?: { direction?: ClinicLedgerDirection },
): Promise<ActionResult<ClinicLedgerEntry[]>> {
  const idCheck = uuidSchema.safeParse(clinicId);
  if (!idCheck.success) {
    return { success: false, error: idCheck.error.issues[0].message };
  }

  const filterCheck = ledgerFilterSchema.safeParse(filter);
  if (!filterCheck.success) {
    return { success: false, error: "Invalid ledger filter." };
  }

  const gate = await checkClinicScope(idCheck.data);
  if (!gate.ok) return { success: false, error: gate.error };

  const resolvedClinicId = gate.clinicId ?? idCheck.data;

  try {
    const entries = await listLedgerEntries(resolvedClinicId, filterCheck.data);
    return { success: true, data: entries };
  } catch {
    return { success: false, error: "The ledger could not be loaded." };
  }
}
