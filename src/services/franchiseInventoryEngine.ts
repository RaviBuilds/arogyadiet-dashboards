// src/services/franchiseInventoryEngine.ts
// Service layer for the franchise inventory feature.
// Wires repository reads and pure logic into exported functions.
// Mutating functions delegate atomic writes to PostgreSQL SECURITY DEFINER RPCs
// via createAdminClient().rpc(...). Read functions use the repository with Scope.
//
// (franchise-inventory spec — Task 10.1)
// Requirements validated: 5.1, 6.1, 7.4, 7.5, 8.3, 9.1, 10.2, 11.4

import { createAdminClient } from "@/lib/supabase/admin";
import {
  listActiveLots,
  listTransfers,
  listLedgerEntries,
} from "@/repositories/franchise/franchiseInventoryRepository";
import { computeOnHand } from "@/lib/franchise-inventory/on-hand-calculator";
import { validateStockOutInput } from "@/lib/franchise-inventory/stock-out-validation";
import {
  filterActiveDestinations,
  type FranchiseDestination,
} from "@/lib/franchise-inventory/active-destination-filter";
import type { Scope } from "@/types/franchise";
import type {
  FranchiseCatalogProduct,
  FranchiseStockTransfer,
  FranchiseLedgerEntry,
  FranchiseBatch,
} from "@/types/franchiseInventory";
import type {
  StockOutInput,
  DispatchToFranchiseInput,
} from "@/validations/franchiseInventory";
import { INVENTORY_PRODUCT_BUCKET } from "@/lib/inventory/product-schema";

// ---------------------------------------------------------------------------
// Image URL resolution helper
// ---------------------------------------------------------------------------

function resolveImageUrl(path: string | null): string | null {
  if (!path) return null;
  if (path.startsWith("http")) return path;
  const admin = createAdminClient();
  const { data } = admin.storage.from(INVENTORY_PRODUCT_BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

// ---------------------------------------------------------------------------
// Result types for mutating operations
// ---------------------------------------------------------------------------

export interface TransferActionResult {
  success: boolean;
  error?: string;
}

export interface StockOutResult {
  success: boolean;
  error?: string;
  requested?: number;
  available?: number;
}

export interface DispatchResult {
  success: boolean;
  transferId?: string;
  error?: string;
}

// ---------------------------------------------------------------------------
// Product name/image resolution helper
// ---------------------------------------------------------------------------

interface ProductInfo {
  id: string;
  name: string;
  image_url: string | null;
  base_uom: string;
  category: string;
}

/**
 * Fetches product name/image/uom for a set of product IDs from inventory_products.
 * Returns a Map keyed by product ID for O(1) lookups.
 */
async function resolveProductInfo(
  productIds: string[],
): Promise<Map<string, ProductInfo>> {
  if (productIds.length === 0) return new Map();

  const uniqueIds = [...new Set(productIds)];
  const admin = createAdminClient();

  const { data, error } = await admin
    .from("inventory_products")
    .select("id, name, image_url, base_uom, category")
    .in("id", uniqueIds);

  if (error) {
    throw new Error(`Failed to resolve product info: ${error.message}`);
  }

  const map = new Map<string, ProductInfo>();
  for (const row of data ?? []) {
    map.set(row.id, row as ProductInfo);
  }
  return map;
}

// ---------------------------------------------------------------------------
// Read functions
// ---------------------------------------------------------------------------

/**
 * Returns the franchise catalog: all finished products that have ACTIVE lots,
 * with their on-hand quantities and batch breakdowns.
 */
export async function getFranchiseInventoryCatalog(
  franchiseId: string,
  scope: Scope,
): Promise<FranchiseCatalogProduct[]> {
  const lots = await listActiveLots(franchiseId, scope);

  if (lots.length === 0) return [];

  // Compute on-hand per product using pure logic
  const onHandMap = computeOnHand(
    lots.map((lot) => ({
      productId: lot.product_id,
      batchNumber: lot.batch_number,
      quantityRemaining: Number(lot.quantity_remaining),
      expiryDate: lot.expiry_date,
      receivedAt: lot.received_at,
      status: lot.status as "ACTIVE" | "DEPLETED" | "EXPIRED",
    })),
  );

  // Resolve product names/images
  const productIds = [...onHandMap.keys()];
  const productInfo = await resolveProductInfo(productIds);

  // Build catalog
  const catalog: FranchiseCatalogProduct[] = [];
  for (const [productId, onHand] of onHandMap) {
    const info = productInfo.get(productId);
    catalog.push({
      productId,
      name: info?.name ?? "Unknown Product",
      imageUrl: resolveImageUrl(info?.image_url ?? null),
      baseUom: (info?.base_uom ?? "unit") as FranchiseCatalogProduct["baseUom"],
      category: info?.category ?? "Uncategorized",
      onHandQuantity: onHand.onHandQuantity,
      batches: onHand.batches,
    });
  }

  return catalog;
}

/**
 * Returns incoming transfers (DISPATCHED + ACCEPTED) for a franchise,
 * with product names resolved.
 */
export async function getIncomingTransfers(
  franchiseId: string,
  scope: Scope,
): Promise<FranchiseStockTransfer[]> {
  const transfers = await listTransfers(franchiseId, scope);

  if (transfers.length === 0) return [];

  // Resolve product names
  const productIds = transfers.map((t) => t.product_id);
  const productInfo = await resolveProductInfo(productIds);

  // Fetch transfer lines for batch breakdown
  const admin = createAdminClient();
  const transferIds = transfers.map((t) => t.id);

  const { data: linesData, error: linesError } = await admin
    .from("franchise_stock_transfer_lines")
    .select("transfer_id, batch_number, quantity, expiry_date")
    .in("transfer_id", transferIds)
    .order("expiry_date", { ascending: true });

  if (linesError) {
    throw new Error(`Failed to fetch transfer lines: ${linesError.message}`);
  }

  // Group lines by transfer_id
  const linesByTransfer = new Map<string, FranchiseBatch[]>();
  for (const line of linesData ?? []) {
    const existing = linesByTransfer.get(line.transfer_id) ?? [];
    existing.push({
      batchNumber: line.batch_number,
      quantity: Number(line.quantity),
      expiryDate: line.expiry_date,
    });
    linesByTransfer.set(line.transfer_id, existing);
  }

  return transfers.map((t) => ({
    id: t.id,
    destFranchiseId: t.dest_franchise_id,
    productId: t.product_id,
    productName: productInfo.get(t.product_id)?.name ?? "Unknown Product",
    quantity: Number(t.quantity),
    state: t.state,
    lines: linesByTransfer.get(t.id) ?? [],
    dispatchedAt: t.dispatched_at,
    sourceCentralKitchenId: t.source_central_kitchen_id,
  }));
}

/**
 * Returns the franchise audit ledger entries with product names resolved.
 */
export async function getFranchiseLedger(
  franchiseId: string,
  scope: Scope,
  limit?: number,
): Promise<FranchiseLedgerEntry[]> {
  const entries = await listLedgerEntries(franchiseId, scope, limit);

  if (entries.length === 0) return [];

  // Resolve product names
  const productIds = entries.map((e) => e.product_id);
  const productInfo = await resolveProductInfo(productIds);

  return entries.map((entry) => ({
    id: entry.id,
    direction: entry.direction,
    productName: productInfo.get(entry.product_id)?.name ?? "Unknown Product",
    quantity: Number(entry.quantity),
    batchBreakdown: (entry.batch_breakdown as FranchiseBatch[]) ?? [],
    stockOutReason: entry.stock_out_reason as FranchiseLedgerEntry["stockOutReason"],
    comment: entry.comment,
    sourceCentralKitchenId: entry.source_central_kitchen_id,
    occurredAt: entry.occurred_at,
  }));
}

// ---------------------------------------------------------------------------
// Transfer mutation functions (delegate to RPCs)
// ---------------------------------------------------------------------------

/**
 * Accepts a transfer (DISPATCHED → ACCEPTED). No on-hand change.
 */
export async function acceptTransfer(
  transferId: string,
  franchiseId: string,
  scope: Scope,
  userId?: string,
): Promise<TransferActionResult> {
  const admin = createAdminClient();
  const { error } = await admin.rpc("accept_franchise_transfer", {
    p_transfer_id: transferId,
    p_franchise_id: franchiseId,
    p_acted_by: userId ?? null,
  });

  if (error) {
    return { success: false, error: error.message };
  }
  return { success: true };
}

/**
 * Rejects a transfer (DISPATCHED → REJECTED). No on-hand change.
 */
export async function rejectTransfer(
  transferId: string,
  franchiseId: string,
  scope: Scope,
  userId?: string,
): Promise<TransferActionResult> {
  const admin = createAdminClient();
  const { error } = await admin.rpc("reject_franchise_transfer", {
    p_transfer_id: transferId,
    p_franchise_id: franchiseId,
    p_acted_by: userId ?? null,
  });

  if (error) {
    return { success: false, error: error.message };
  }
  return { success: true };
}

/**
 * Receives a transfer (ACCEPTED → RECEIVED). Creates lots, increments on-hand,
 * writes the IN ledger entry.
 */
export async function receiveTransfer(
  transferId: string,
  franchiseId: string,
  scope: Scope,
  userId?: string,
): Promise<TransferActionResult> {
  const admin = createAdminClient();
  const { error } = await admin.rpc("receive_franchise_transfer", {
    p_transfer_id: transferId,
    p_franchise_id: franchiseId,
    p_acted_by: userId ?? null,
  });

  if (error) {
    return { success: false, error: error.message };
  }
  return { success: true };
}

// ---------------------------------------------------------------------------
// Stock-Out (delegate to RPC after client-side validation)
// ---------------------------------------------------------------------------

/**
 * Records a stock-out from franchise inventory. Validates input, then delegates
 * atomic FIFO depletion + ledger write to the RPC.
 */
export async function recordStockOut(
  input: StockOutInput,
  franchiseId: string,
  scope: Scope,
): Promise<StockOutResult> {
  // Client-side available-stock computation for validation
  const lots = await listActiveLots(franchiseId, scope);
  const productLots = lots.filter((l) => l.product_id === input.product_id);
  const availableQuantity = productLots.reduce(
    (sum, lot) => sum + Number(lot.quantity_remaining),
    0,
  );

  // Validate input using the pure validation function
  const validation = validateStockOutInput({
    reason: input.reason,
    quantity: input.quantity,
    comment: input.comment ?? null,
    availableQuantity,
  });

  if (!validation.valid) {
    return {
      success: false,
      error: validation.error,
      requested: "requested" in validation ? validation.requested : undefined,
      available: "available" in validation ? validation.available : undefined,
    };
  }

  // Delegate atomic work to the RPC
  const admin = createAdminClient();
  const { error } = await admin.rpc("record_franchise_stock_out", {
    p_franchise_id: franchiseId,
    p_product_id: input.product_id,
    p_quantity: input.quantity,
    p_reason: input.reason,
    p_comment: input.comment ?? null,
  });

  if (error) {
    return { success: false, error: error.message };
  }
  return { success: true };
}

// ---------------------------------------------------------------------------
// Active franchise destinations (central kitchen dispatch side)
// ---------------------------------------------------------------------------

/**
 * Lists all active franchises as dispatch destinations.
 * Queries all franchises, then applies the pure filterActiveDestinations logic.
 */
export async function listActiveFranchiseDestinations(): Promise<
  FranchiseDestination[]
> {
  const admin = createAdminClient();

  const { data, error } = await admin
    .from("franchises")
    .select("id, name, status");

  if (error) {
    throw new Error(`Failed to list franchises: ${error.message}`);
  }

  return filterActiveDestinations(data ?? []);
}

// ---------------------------------------------------------------------------
// Dispatch to franchise (central kitchen side)
// ---------------------------------------------------------------------------

/**
 * Dispatches finished-product stock from the central kitchen to a franchise.
 * Delegates the atomic FIFO depletion + transfer creation + central ledger
 * write to the dispatch_to_franchise RPC.
 */
export async function dispatchToFranchise(
  input: DispatchToFranchiseInput,
  actorUserId: string,
): Promise<DispatchResult> {
  const admin = createAdminClient();

  const { data, error } = await admin.rpc("dispatch_to_franchise", {
    p_dest_franchise_id: input.dest_franchise_id,
    p_product_id: input.product_id,
    p_quantity: input.quantity,
    p_dispatched_by: actorUserId,
    p_source_kitchen_id: null,
  });

  if (error) {
    return { success: false, error: error.message };
  }

  return { success: true, transferId: data as string };
}
