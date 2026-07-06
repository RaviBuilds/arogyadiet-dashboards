import { addDays, format, parseISO, startOfDay } from "date-fns";

import { createAdminClient } from "@/lib/supabase/admin";
import {
  INVENTORY_PRODUCT_BUCKET,
  PURCHASE_ORDER_BUCKET,
  validateInventoryProductImage,
  validatePurchaseOrderFile,
  type ActiveRawMaterialLot,
  type AddProductInput,
  type BulkInboundItem,
  type BulkOutboundItem,
  type CreateMappingFormValues,
  type DispatchInventoryStockResult,
  type DispatchStockReason,
  type FinishedGoodOption,
  type InventoryCatalogProduct,
  type InventoryLot,
  type InventoryMetrics,
  type InventoryProduct,
  type InventorySourceType,
  type ManufacturingBatch,
  type ManufacturingOrder,
  type ManufacturingProductMapping,
  type ManufacturingProductMappingRow,
  type MultiDispatchFormValues,
  type ProcessManufacturingOutputResult,
  type PurchaseOrderExportFile,
  type PurchaseOrderExportFilters,
  type RevertPendingManufacturingResult,
  type TransactionLedgerEntry,
  type UpdateInventoryProductInput,
  mapActiveRawMaterialLotRow,
  mapFinishedGoodOptionRow,
  mapInventoryLotRow,
  mapInventoryProductRow,
  mapManufacturingOrderRow,
  mapManufacturingProductMappingRow,
  mapTransactionLedgerRow,
} from "@/lib/inventory/product-schema";

export async function uploadInventoryProductImage(file: File): Promise<string> {
  const validationError = validateInventoryProductImage(file);
  if (validationError) {
    throw new Error(validationError);
  }

  const supabase = createAdminClient();
  const extension = file.name.split(".").pop() || "jpg";
  const filename = `${Date.now()}-${crypto.randomUUID()}.${extension}`;

  const { data, error } = await supabase.storage
    .from(INVENTORY_PRODUCT_BUCKET)
    .upload(filename, file, { cacheControl: "3600", upsert: false });

  if (error) {
    throw new Error(error.message);
  }

  return data.path;
}

export async function uploadPurchaseOrderFile(file: File): Promise<string> {
  const validationError = validatePurchaseOrderFile(file);
  if (validationError) {
    throw new Error(validationError);
  }

  const supabase = createAdminClient();
  const extension = file.name.split(".").pop()?.toLowerCase() || "jpg";
  const datePrefix = format(new Date(), "yyyy/MM/dd");
  const path = `${datePrefix}/${Date.now()}-${crypto.randomUUID()}.${extension}`;

  const { data, error } = await supabase.storage
    .from(PURCHASE_ORDER_BUCKET)
    .upload(path, file, { cacheControl: "3600", upsert: false });

  if (error) {
    throw new Error(error.message);
  }

  return data.path;
}

export async function downloadPurchaseOrderFile(
  path: string,
): Promise<Uint8Array> {
  const supabase = createAdminClient();

  const { data, error } = await supabase.storage
    .from(PURCHASE_ORDER_BUCKET)
    .download(path);

  if (error || !data) {
    throw new Error(error?.message ?? `Failed to download ${path}.`);
  }

  return new Uint8Array(await data.arrayBuffer());
}

export async function createInventoryProduct(
  data: AddProductInput,
): Promise<InventoryProduct> {
  const supabase = createAdminClient();

  // Pre-insert uniqueness check: case-insensitive, trimmed name among non-deleted products
  const normalizedName = data.name.trim().toLowerCase();

  const { data: dupeCheck, error: dupeCheckError } = await supabase
    .from("inventory_products")
    .select("id, name")
    .is("deleted_at", null);

  if (dupeCheckError) {
    throw new Error(dupeCheckError.message);
  }

  const hasDuplicate = (dupeCheck ?? []).some(
    (row) => row.name.trim().toLowerCase() === normalizedName,
  );

  if (hasDuplicate) {
    throw new Error("A product with this name already exists.");
  }

  const { data: row, error } = await supabase
    .from("inventory_products")
    .insert({
      name: data.name.trim(),
      category: data.category.trim(),
      image_url: data.imageUrl.trim(),
      type: data.type,
      base_uom: data.baseUom,
      min_stock_threshold: data.minStockThreshold,
      default_durability_days: data.defaultDurabilityDays,
    })
    .select(
      "id, name, image_url, category, type, base_uom, min_stock_threshold, default_durability_days, created_at, updated_at",
    )
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return mapInventoryProductRow(row);
}

export async function updateInventoryProduct(
  id: string,
  data: UpdateInventoryProductInput,
): Promise<InventoryProduct> {
  const supabase = createAdminClient();

  // Fetch the current product to retain the existing image when no new image is provided
  const { data: currentProduct, error: fetchError } = await supabase
    .from("inventory_products")
    .select("id, image_url")
    .eq("id", id)
    .is("deleted_at", null)
    .single();

  if (fetchError || !currentProduct) {
    throw new Error(fetchError?.message ?? "Product not found.");
  }

  const payload: Record<string, string | number> = {
    updated_at: new Date().toISOString(),
  };

  if (data.name !== undefined) payload.name = data.name.trim();
  if (data.category !== undefined) payload.category = data.category.trim();

  // Replace image only when a new (non-null, non-empty) image is supplied;
  // otherwise retain the existing image_url from the database
  if (data.imageUrl !== undefined && data.imageUrl !== null && data.imageUrl.trim() !== "") {
    payload.image_url = data.imageUrl.trim();
  }
  // If no new image provided, we simply don't include image_url in the payload,
  // which means the existing value is retained.

  if (data.type !== undefined) payload.type = data.type;
  if (data.baseUom !== undefined) payload.base_uom = data.baseUom;
  if (data.minStockThreshold !== undefined) {
    payload.min_stock_threshold = data.minStockThreshold;
  }
  if (data.defaultDurabilityDays !== undefined) {
    payload.default_durability_days = data.defaultDurabilityDays;
  }

  const { data: row, error } = await supabase
    .from("inventory_products")
    .update(payload)
    .eq("id", id)
    .select(
      "id, name, image_url, category, type, base_uom, min_stock_threshold, default_durability_days, created_at, updated_at",
    )
    .single();

  if (error || !row) {
    throw new Error(error?.message ?? "Failed to update product.");
  }

  return mapInventoryProductRow(row);
}

export async function deleteInventoryProduct(id: string): Promise<void> {
  const supabase = createAdminClient();

  // Check if the product exists and whether it's already soft-deleted
  const { data: existing, error: fetchError } = await supabase
    .from("inventory_products")
    .select("id, deleted_at")
    .eq("id", id)
    .single();

  if (fetchError || !existing) {
    throw new Error("Product not found. It may have already been removed.");
  }

  if (existing.deleted_at !== null) {
    throw new Error(
      "This product has already been deleted.",
    );
  }

  // Soft-delete: set deleted_at timestamp instead of removing the row
  const { error } = await supabase
    .from("inventory_products")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id);

  if (error) {
    throw new Error(error.message);
  }
}

function resolveInventoryProductImageUrl(path: string | null): string | null {
  if (!path) return null;
  if (path.startsWith("http")) return path;

  const supabase = createAdminClient();
  const { data } = supabase.storage
    .from(INVENTORY_PRODUCT_BUCKET)
    .getPublicUrl(path);

  return data.publicUrl;
}

export async function getInventoryMasterCatalog(): Promise<
  InventoryCatalogProduct[]
> {
  const supabase = createAdminClient();

  const [productsResult, lotsResult] = await Promise.all([
    supabase
      .from("inventory_products")
      .select(
        "id, name, image_url, category, type, base_uom, min_stock_threshold, default_durability_days, created_at, updated_at",
      )
      .is("deleted_at", null)
      .order("created_at", { ascending: false }),
    supabase
      .from("inventory_lots")
      .select("product_id, batch_number, quantity_remaining, expiry_date")
      .eq("status", "ACTIVE")
      .order("expiry_date", { ascending: true }),
  ]);

  if (productsResult.error) {
    throw new Error(productsResult.error.message);
  }

  if (lotsResult.error) {
    throw new Error(lotsResult.error.message);
  }

  const quantityByProductId = new Map<string, number>();
  const lotsByProductId = new Map<
    string,
    { batchNumber: string; quantityRemaining: number; expiryDate: Date | null }[]
  >();

  for (const lot of lotsResult.data ?? []) {
    const quantityRemaining = Number(lot.quantity_remaining);
    quantityByProductId.set(
      lot.product_id,
      (quantityByProductId.get(lot.product_id) ?? 0) + quantityRemaining,
    );

    const productLots = lotsByProductId.get(lot.product_id) ?? [];
    productLots.push({
      batchNumber: lot.batch_number,
      quantityRemaining,
      expiryDate: lot.expiry_date ? new Date(lot.expiry_date) : null,
    });
    lotsByProductId.set(lot.product_id, productLots);
  }

  return (productsResult.data ?? []).map((row) => {
    const product = mapInventoryProductRow(row);
    return {
      ...product,
      imageUrl: resolveInventoryProductImageUrl(product.imageUrl),
      totalStock: quantityByProductId.get(product.id) ?? 0,
      activeLots: lotsByProductId.get(product.id) ?? [],
    };
  });
}

export async function getInventoryMetrics(): Promise<InventoryMetrics> {
  const supabase = createAdminClient();
  const now = new Date();
  const expiryWindowEnd = addDays(now, 14);

  const [productsResult, lotsResult] = await Promise.all([
    supabase
      .from("inventory_products")
      .select("id, name, base_uom, min_stock_threshold")
      .is("deleted_at", null),
    supabase
      .from("inventory_lots")
      .select(
        "id, product_id, batch_number, quantity_remaining, unit_cost, expiry_date, status",
      )
      .eq("status", "ACTIVE"),
  ]);

  if (productsResult.error) {
    throw new Error(productsResult.error.message);
  }

  if (lotsResult.error) {
    throw new Error(lotsResult.error.message);
  }

  const products = productsResult.data ?? [];
  const activeLots = lotsResult.data ?? [];

  const productById = new Map(
    products.map((product) => [
      product.id,
      {
        name: product.name,
        baseUom: product.base_uom,
        minStockThreshold: Number(product.min_stock_threshold),
      },
    ]),
  );

  const quantityByProductId = new Map<string, number>();
  let totalWarehouseValue = 0;

  for (const lot of activeLots) {
    const quantityRemaining = Number(lot.quantity_remaining);
    const unitCost = Number(lot.unit_cost);
    totalWarehouseValue += quantityRemaining * unitCost;
    quantityByProductId.set(
      lot.product_id,
      (quantityByProductId.get(lot.product_id) ?? 0) + quantityRemaining,
    );
  }

  const lowStockAlerts = products
    .map((product) => {
      const totalQuantity = quantityByProductId.get(product.id) ?? 0;
      const minStockThreshold = Number(product.min_stock_threshold);

      return {
        productId: product.id,
        productName: product.name,
        totalQuantity,
        minStockThreshold,
        baseUom: product.base_uom,
      };
    })
    .filter((alert) => alert.totalQuantity <= alert.minStockThreshold)
    .sort((a, b) => a.totalQuantity - b.totalQuantity);

  const expiringLots = activeLots
    .filter((lot) => {
      const expiryDate = new Date(lot.expiry_date);
      return expiryDate >= now && expiryDate <= expiryWindowEnd;
    })
    .map((lot) => {
      const product = productById.get(lot.product_id);
      return {
        lotId: lot.id,
        productId: lot.product_id,
        productName: product?.name ?? "Unknown product",
        batchNumber: lot.batch_number,
        quantityRemaining: Number(lot.quantity_remaining),
        expiryDate: lot.expiry_date,
      };
    })
    .sort(
      (a, b) =>
        new Date(a.expiryDate).getTime() - new Date(b.expiryDate).getTime(),
    );

  return {
    totalWarehouseValue,
    totalUniqueItems: products.length,
    lowStockAlerts,
    expiringLots,
  };
}

export async function getTransactionLedger(
  limit = 100,
): Promise<TransactionLedgerEntry[]> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("inventory_transactions")
    .select(
      `
      id,
      transaction_type,
      quantity_changed,
      financial_value_changed,
      timestamp,
      reason,
      franchise_transfer_id,
      inventory_lots!inner (
        batch_number,
        source_type,
        source_name,
        inventory_products!inner ( name, base_uom )
      )
    `,
    )
    .order("timestamp", { ascending: false })
    .limit(limit);

  if (error) {
    throw new Error(error.message);
  }

  const entries = (data ?? []).map((row) => mapTransactionLedgerRow(row));

  // Resolve which franchise transfers have package images
  const transferIds = entries
    .filter((e) => e.franchiseTransferId)
    .map((e) => e.franchiseTransferId!);

  if (transferIds.length > 0) {
    const uniqueIds = [...new Set(transferIds)];
    const { data: transferData } = await supabase
      .from("franchise_stock_transfers")
      .select("id, package_image_paths")
      .in("id", uniqueIds)
      .not("package_image_paths", "is", null);

    const withImages = new Set(
      (transferData ?? [])
        .filter((t) => Array.isArray(t.package_image_paths) && t.package_image_paths.length > 0)
        .map((t) => t.id),
    );

    for (const entry of entries) {
      if (entry.franchiseTransferId && withImages.has(entry.franchiseTransferId)) {
        entry.hasPackageImages = true;
      }
    }
  }

  return entries;
}

async function resolveExpiryDate(
  supabase: ReturnType<typeof createAdminClient>,
  productId: string,
  customExpiry?: Date,
): Promise<Date> {
  if (customExpiry) {
    return customExpiry;
  }

  const { data: product, error } = await supabase
    .from("inventory_products")
    .select("default_durability_days")
    .eq("id", productId)
    .single();

  if (error || !product) {
    throw new Error(error?.message ?? "Product not found.");
  }

  return addDays(new Date(), product.default_durability_days);
}

export type ReceiveStockSourceInfo = {
  sourceType: InventorySourceType;
  sourceName?: string;
  purchaseOrderPath?: string;
};

export async function receiveInventoryStock(
  productId: string,
  quantity: number,
  totalCost: number,
  customExpiry?: Date,
  source?: ReceiveStockSourceInfo,
): Promise<InventoryLot> {
  const supabase = createAdminClient();
  const unitCost = totalCost / quantity;
  const batchNumber = `LOT-${Date.now()}`;
  const expiryDate = await resolveExpiryDate(supabase, productId, customExpiry);

  const { data: lotRow, error: lotError } = await supabase
    .from("inventory_lots")
    .insert({
      product_id: productId,
      batch_number: batchNumber,
      quantity_remaining: quantity,
      unit_cost: unitCost,
      expiry_date: expiryDate.toISOString(),
      status: "ACTIVE",
      source_type: source?.sourceType ?? null,
      source_name:
        source?.sourceType === "OTHER"
          ? source.sourceName?.trim() || null
          : null,
      purchase_order_path: source?.purchaseOrderPath ?? null,
    })
    .select(
      "id, product_id, batch_number, quantity_remaining, unit_cost, expiry_date, status, created_at",
    )
    .single();

  if (lotError || !lotRow) {
    throw new Error(lotError?.message ?? "Failed to create inventory lot.");
  }

  const { error: transactionError } = await supabase
    .from("inventory_transactions")
    .insert({
      lot_id: lotRow.id,
      transaction_type: "IN",
      quantity_changed: quantity,
      financial_value_changed: totalCost,
    });

  if (transactionError) {
    await supabase.from("inventory_lots").delete().eq("id", lotRow.id);
    throw new Error(transactionError.message);
  }

  return mapInventoryLotRow(lotRow);
}

type LotRollbackState = {
  lotId: string;
  quantityRemaining: number;
  status: InventoryLot["status"];
};

export async function dispatchInventoryStock(
  productId: string,
  quantityToDispatch: number,
  reason: DispatchStockReason,
): Promise<DispatchInventoryStockResult> {
  const supabase = createAdminClient();

  const { data: lotRows, error: lotsFetchError } = await supabase
    .from("inventory_lots")
    .select("id, quantity_remaining, unit_cost, status, expiry_date")
    .eq("product_id", productId)
    .eq("status", "ACTIVE")
    .order("expiry_date", { ascending: true });

  if (lotsFetchError) {
    throw new Error(lotsFetchError.message);
  }

  const activeLots = lotRows ?? [];
  const totalAvailable = activeLots.reduce(
    (sum, lot) => sum + Number(lot.quantity_remaining),
    0,
  );

  if (quantityToDispatch > totalAvailable) {
    throw new Error(
      `Cannot dispatch ${quantityToDispatch}. Only ${totalAvailable} available.`,
    );
  }

  let remaining = quantityToDispatch;
  let lotsAffected = 0;
  const lotRollbacks: LotRollbackState[] = [];
  const transactionIds: string[] = [];

  async function rollbackDispatch(): Promise<void> {
    for (const transactionId of [...transactionIds].reverse()) {
      await supabase.from("inventory_transactions").delete().eq("id", transactionId);
    }

    for (const rollback of [...lotRollbacks].reverse()) {
      await supabase
        .from("inventory_lots")
        .update({
          quantity_remaining: rollback.quantityRemaining,
          status: rollback.status,
        })
        .eq("id", rollback.lotId);
    }
  }

  for (const lotRow of activeLots) {
    if (remaining <= 0) {
      break;
    }

    const quantityRemaining = Number(lotRow.quantity_remaining);
    if (quantityRemaining <= 0) {
      continue;
    }

    const deduct = Math.min(quantityRemaining, remaining);
    const unitCost = Number(lotRow.unit_cost);
    const newQuantity = quantityRemaining - deduct;
    const newStatus = newQuantity === 0 ? "DEPLETED" : "ACTIVE";

    lotRollbacks.push({
      lotId: lotRow.id,
      quantityRemaining,
      status: lotRow.status,
    });

    const { error: lotUpdateError } = await supabase
      .from("inventory_lots")
      .update({
        quantity_remaining: newQuantity,
        status: newStatus,
      })
      .eq("id", lotRow.id);

    if (lotUpdateError) {
      await rollbackDispatch();
      throw new Error(lotUpdateError.message);
    }

    const { data: transactionRow, error: transactionError } = await supabase
      .from("inventory_transactions")
      .insert({
        lot_id: lotRow.id,
        transaction_type: "OUT",
        quantity_changed: -deduct,
        financial_value_changed: -(deduct * unitCost),
        reason,
      })
      .select("id")
      .single();

    if (transactionError || !transactionRow) {
      await rollbackDispatch();
      throw new Error(
        transactionError?.message ?? "Failed to record dispatch transaction.",
      );
    }

    transactionIds.push(transactionRow.id);
    lotsAffected += 1;
    remaining -= deduct;
  }

  if (remaining > 0) {
    await rollbackDispatch();
    throw new Error("Failed to dispatch the requested quantity.");
  }

  return {
    totalDispatched: quantityToDispatch,
    lotsAffected,
  };
}

export class BulkInventoryError extends Error {
  processed: number;

  constructor(message: string, processed: number) {
    super(message);
    this.name = "BulkInventoryError";
    this.processed = processed;
  }
}

export async function processBulkInbound(
  items: BulkInboundItem[],
): Promise<{ processed: number; batchNumbers: string[] }> {
  const batchNumbers: string[] = [];

  for (let index = 0; index < items.length; index++) {
    const item = items[index];
    try {
      const customExpiry = item.expiryDate
        ? startOfDay(parseISO(item.expiryDate))
        : undefined;
      const lot = await receiveInventoryStock(
        item.productId,
        item.quantity,
        item.totalCost,
        customExpiry,
        {
          sourceType: item.sourceType,
          sourceName: item.sourceName,
          purchaseOrderPath: item.purchaseOrderPath,
        },
      );
      batchNumbers.push(lot.batchNumber);
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Failed to receive stock.";
      throw new BulkInventoryError(
        `Failed on ${item.name}: ${message}`,
        index,
      );
    }
  }

  return { processed: items.length, batchNumbers };
}

export async function processBulkOutbound(
  items: BulkOutboundItem[],
): Promise<{ processed: number; totalDispatched: number }> {
  let totalDispatched = 0;

  for (let index = 0; index < items.length; index++) {
    const item = items[index];
    try {
      const result = await dispatchInventoryStock(
        item.productId,
        item.quantity,
        item.reason,
      );
      totalDispatched += result.totalDispatched;
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Failed to dispatch stock.";
      throw new BulkInventoryError(
        `Failed on ${item.name}: ${message}`,
        index,
      );
    }
  }

  return { processed: items.length, totalDispatched };
}

type PurchaseOrderExportRow = {
  id: string;
  batch_number: string;
  purchase_order_path: string;
  created_at: string;
  product_id: string;
  inventory_products: { name: string } | { name: string }[];
};

export async function getPurchaseOrderFilesForExport(
  filters: PurchaseOrderExportFilters,
): Promise<PurchaseOrderExportFile[]> {
  const supabase = createAdminClient();
  const fromDate = startOfDay(parseISO(filters.from));
  const toDateExclusive = addDays(startOfDay(parseISO(filters.to)), 1);

  let query = supabase
    .from("inventory_lots")
    .select(
      "id, batch_number, purchase_order_path, created_at, product_id, inventory_products!inner(name, type)",
    )
    .not("purchase_order_path", "is", null)
    .gte("created_at", fromDate.toISOString())
    .lt("created_at", toDateExclusive.toISOString())
    .order("created_at", { ascending: true });

  if (filters.type) {
    query = query.eq("inventory_products.type", filters.type);
  }

  if (filters.productIds && filters.productIds.length > 0) {
    query = query.in("product_id", filters.productIds);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(error.message);
  }

  return ((data ?? []) as PurchaseOrderExportRow[]).map((row) => {
    const product = Array.isArray(row.inventory_products)
      ? row.inventory_products[0]
      : row.inventory_products;

    return {
      lotId: row.id,
      batchNumber: row.batch_number,
      productName: product?.name ?? "Unknown product",
      path: row.purchase_order_path,
      receivedAt: row.created_at,
    };
  });
}

export async function getActiveRawMaterialLots(): Promise<ActiveRawMaterialLot[]> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("inventory_lots")
    .select(
      "id, product_id, batch_number, quantity_remaining, unit_cost, expiry_date, status, created_at, inventory_products!inner(name, base_uom, type, deleted_at)",
    )
    .eq("status", "ACTIVE")
    .eq("inventory_products.type", "RAW_MATERIAL")
    .is("inventory_products.deleted_at", null)
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []).map((row) => mapActiveRawMaterialLotRow(row));
}

export async function getPendingManufacturingOrders(): Promise<
  ManufacturingOrder[]
> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("manufacturing_orders")
    .select(
      "id, raw_product_id, source_lot_id, quantity_sent, total_cost_value, status, sent_at, completed_at, inventory_products!raw_product_id(name, base_uom), inventory_lots!source_lot_id(batch_number), manufacturing_outputs(package_size, package_count)",
    )
    .eq("status", "PENDING")
    .order("sent_at", { ascending: false });

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []).map((row) => mapManufacturingOrderRow(row));
}

export async function sendToManufacturing(
  lotId: string,
  quantityToSend: number,
): Promise<ManufacturingOrder> {
  const supabase = createAdminClient();

  const { data: lotRow, error: lotFetchError } = await supabase
    .from("inventory_lots")
    .select(
      "id, product_id, batch_number, quantity_remaining, unit_cost, expiry_date, status, created_at",
    )
    .eq("id", lotId)
    .single();

  if (lotFetchError || !lotRow) {
    throw new Error(lotFetchError?.message ?? "Lot not found.");
  }

  const lot = mapInventoryLotRow(lotRow);

  if (lot.status !== "ACTIVE") {
    throw new Error("Only active lots can be sent to manufacturing.");
  }

  if (quantityToSend > lot.quantityRemaining) {
    throw new Error(
      `Cannot send ${quantityToSend}. Only ${lot.quantityRemaining} remaining in this lot.`,
    );
  }

  const totalCostValue = quantityToSend * lot.unitCost;
  const newRemaining = lot.quantityRemaining - quantityToSend;
  const newStatus = newRemaining === 0 ? "DEPLETED" : "ACTIVE";

  const { data: orderRow, error: orderError } = await supabase
    .from("manufacturing_orders")
    .insert({
      raw_product_id: lot.productId,
      source_lot_id: lotId,
      quantity_sent: quantityToSend,
      total_cost_value: totalCostValue,
      status: "PENDING",
    })
    .select(
      "id, raw_product_id, source_lot_id, quantity_sent, total_cost_value, status, sent_at, completed_at, inventory_products!raw_product_id(name, base_uom), inventory_lots!source_lot_id(batch_number)",
    )
    .single();

  if (orderError || !orderRow) {
    throw new Error(orderError?.message ?? "Failed to create manufacturing order.");
  }

  const { error: lotUpdateError } = await supabase
    .from("inventory_lots")
    .update({
      quantity_remaining: newRemaining,
      status: newStatus,
    })
    .eq("id", lotId);

  if (lotUpdateError) {
    await supabase.from("manufacturing_orders").delete().eq("id", orderRow.id);
    throw new Error(lotUpdateError.message);
  }

  const { error: transactionError } = await supabase
    .from("inventory_transactions")
    .insert({
      lot_id: lotId,
      transaction_type: "SENT_TO_MFG",
      quantity_changed: -quantityToSend,
      financial_value_changed: -totalCostValue,
    });

  if (transactionError) {
    await supabase
      .from("inventory_lots")
      .update({
        quantity_remaining: lot.quantityRemaining,
        status: lot.status,
      })
      .eq("id", lotId);
    await supabase.from("manufacturing_orders").delete().eq("id", orderRow.id);
    throw new Error(transactionError.message);
  }

  return mapManufacturingOrderRow(orderRow);
}

export async function getFinishedGoodProducts(): Promise<FinishedGoodOption[]> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("inventory_products")
    .select("id, name, base_uom")
    .eq("type", "FINISHED_GOOD")
    .is("deleted_at", null)
    .order("name", { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []).map((row) => mapFinishedGoodOptionRow(row));
}

export async function processManufacturingOutput(
  mfgOrderId: string,
  finishedProductId: string,
  packageSize: number,
  packageCount: number,
  expiryDate: Date,
): Promise<ProcessManufacturingOutputResult> {
  const supabase = createAdminClient();

  const { data: orderRow, error: orderFetchError } = await supabase
    .from("manufacturing_orders")
    .select(
      "id, raw_product_id, source_lot_id, quantity_sent, total_cost_value, status, sent_at, completed_at",
    )
    .eq("id", mfgOrderId)
    .single();

  if (orderFetchError || !orderRow) {
    throw new Error(orderFetchError?.message ?? "Manufacturing order not found.");
  }

  if (orderRow.status !== "PENDING") {
    throw new Error("Only pending manufacturing orders can be processed.");
  }

  const quantitySent = Number(orderRow.quantity_sent);
  const totalCostValue = Number(orderRow.total_cost_value);
  const currentOutputWeight = packageSize * packageCount;

  const { data: existingOutputs, error: outputsFetchError } = await supabase
    .from("manufacturing_outputs")
    .select("package_size, package_count")
    .eq("mfg_order_id", mfgOrderId);

  if (outputsFetchError) {
    throw new Error(outputsFetchError.message);
  }

  const alreadyProcessed = (existingOutputs ?? []).reduce(
    (sum, output) =>
      sum + Number(output.package_size) * Number(output.package_count),
    0,
  );
  const remainingToPackage = quantitySent - alreadyProcessed;

  if (currentOutputWeight > remainingToPackage) {
    throw new Error(
      `Output weight exceeds remaining raw material. Only ${remainingToPackage} left to package.`,
    );
  }

  const rawCostPerUnit = totalCostValue / quantitySent;
  const costTransferred = rawCostPerUnit * currentOutputWeight;

  const { data: productRow, error: productError } = await supabase
    .from("inventory_products")
    .select("id, type")
    .eq("id", finishedProductId)
    .single();

  if (productError || !productRow) {
    throw new Error(productError?.message ?? "Finished product not found.");
  }

  if (productRow.type !== "FINISHED_GOOD") {
    throw new Error("Selected product must be a finished good.");
  }

  const newUnitCost = costTransferred / packageCount;
  const batchNumber = `LOT-${Date.now()}`;
  const isFullyProcessed =
    alreadyProcessed + currentOutputWeight >= quantitySent;

  const { data: lotRow, error: lotError } = await supabase
    .from("inventory_lots")
    .insert({
      product_id: finishedProductId,
      batch_number: batchNumber,
      quantity_remaining: packageCount,
      unit_cost: newUnitCost,
      expiry_date: expiryDate.toISOString(),
      status: "ACTIVE",
    })
    .select("id")
    .single();

  if (lotError || !lotRow) {
    throw new Error(lotError?.message ?? "Failed to create finished goods lot.");
  }

  const { data: outputRow, error: outputError } = await supabase
    .from("manufacturing_outputs")
    .insert({
      mfg_order_id: mfgOrderId,
      finished_product_id: finishedProductId,
      new_lot_id: lotRow.id,
      package_size: packageSize,
      package_count: packageCount,
    })
    .select("id")
    .single();

  if (outputError || !outputRow) {
    await supabase.from("inventory_lots").delete().eq("id", lotRow.id);
    throw new Error(outputError?.message ?? "Failed to record manufacturing output.");
  }

  if (isFullyProcessed) {
    const { error: orderUpdateError } = await supabase
      .from("manufacturing_orders")
      .update({
        status: "COMPLETED",
        completed_at: new Date().toISOString(),
      })
      .eq("id", mfgOrderId);

    if (orderUpdateError) {
      await supabase
        .from("manufacturing_outputs")
        .delete()
        .eq("id", outputRow.id);
      await supabase.from("inventory_lots").delete().eq("id", lotRow.id);
      throw new Error(orderUpdateError.message);
    }
  }

  const { error: transactionError } = await supabase
    .from("inventory_transactions")
    .insert({
      lot_id: lotRow.id,
      transaction_type: "RECEIVED_FROM_MFG",
      quantity_changed: packageCount,
      financial_value_changed: costTransferred,
    });

  if (transactionError) {
    if (isFullyProcessed) {
      await supabase
        .from("manufacturing_orders")
        .update({
          status: "PENDING",
          completed_at: null,
        })
        .eq("id", mfgOrderId);
    }
    await supabase.from("manufacturing_outputs").delete().eq("id", outputRow.id);
    await supabase.from("inventory_lots").delete().eq("id", lotRow.id);
    throw new Error(transactionError.message);
  }

  return {
    lotId: lotRow.id,
    batchNumber,
    outputId: outputRow.id,
  };
}

export async function revertPendingManufacturing(
  mfgOrderId: string,
): Promise<RevertPendingManufacturingResult> {
  const supabase = createAdminClient();

  const { data: orderRow, error: orderFetchError } = await supabase
    .from("manufacturing_orders")
    .select("id, source_lot_id, quantity_sent, status")
    .eq("id", mfgOrderId)
    .single();

  if (orderFetchError || !orderRow) {
    throw new Error(orderFetchError?.message ?? "Manufacturing order not found.");
  }

  if (orderRow.status !== "PENDING") {
    throw new Error("Only pending manufacturing orders can be reverted.");
  }

  const quantitySent = Number(orderRow.quantity_sent);
  const sourceLotId = orderRow.source_lot_id;

  const { data: existingOutputs, error: outputsFetchError } = await supabase
    .from("manufacturing_outputs")
    .select("package_size, package_count")
    .eq("mfg_order_id", mfgOrderId);

  if (outputsFetchError) {
    throw new Error(outputsFetchError.message);
  }

  const alreadyProcessed = (existingOutputs ?? []).reduce(
    (sum, output) =>
      sum + Number(output.package_size) * Number(output.package_count),
    0,
  );
  const remainingQuantity = quantitySent - alreadyProcessed;

  if (remainingQuantity <= 0) {
    throw new Error("No remaining raw material to return to stock.");
  }

  const { data: lotRow, error: lotFetchError } = await supabase
    .from("inventory_lots")
    .select("id, quantity_remaining, unit_cost, status")
    .eq("id", sourceLotId)
    .single();

  if (lotFetchError || !lotRow) {
    throw new Error(lotFetchError?.message ?? "Source lot not found.");
  }

  const previousQuantity = Number(lotRow.quantity_remaining);
  const unitCost = Number(lotRow.unit_cost);
  const previousStatus = lotRow.status;
  const newQuantity = previousQuantity + remainingQuantity;
  const newStatus = previousStatus === "DEPLETED" ? "ACTIVE" : previousStatus;
  const financialValue = remainingQuantity * unitCost;

  const { error: lotUpdateError } = await supabase
    .from("inventory_lots")
    .update({
      quantity_remaining: newQuantity,
      status: newStatus,
    })
    .eq("id", sourceLotId);

  if (lotUpdateError) {
    throw new Error(lotUpdateError.message);
  }

  const { error: orderUpdateError } = await supabase
    .from("manufacturing_orders")
    .update({
      status: "COMPLETED",
      completed_at: new Date().toISOString(),
    })
    .eq("id", mfgOrderId);

  if (orderUpdateError) {
    await supabase
      .from("inventory_lots")
      .update({
        quantity_remaining: previousQuantity,
        status: previousStatus,
      })
      .eq("id", sourceLotId);
    throw new Error(orderUpdateError.message);
  }

  const { error: transactionError } = await supabase
    .from("inventory_transactions")
    .insert({
      lot_id: sourceLotId,
      transaction_type: "IN",
      quantity_changed: remainingQuantity,
      financial_value_changed: financialValue,
    });

  if (transactionError) {
    await supabase
      .from("manufacturing_orders")
      .update({
        status: "PENDING",
        completed_at: null,
      })
      .eq("id", mfgOrderId);
    await supabase
      .from("inventory_lots")
      .update({
        quantity_remaining: previousQuantity,
        status: previousStatus,
      })
      .eq("id", sourceLotId);
    throw new Error(transactionError.message);
  }

  return {
    refundedQuantity: remainingQuantity,
    sourceLotId,
  };
}


// --- Manufacturing Product Mappings ---

export async function getManufacturingMappings(): Promise<
  ManufacturingProductMapping[]
> {
  const supabase = createAdminClient();

  const { data: mappings, error } = await supabase
    .from("manufacturing_product_mappings")
    .select("id, name, raw_product_ids, finished_product_ids, created_at, updated_at")
    .order("name", { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  if (!mappings || mappings.length === 0) {
    return [];
  }

  // Collect all unique product IDs to fetch their names
  const allProductIds = new Set<string>();
  for (const mapping of mappings) {
    for (const id of mapping.raw_product_ids) allProductIds.add(id);
    for (const id of mapping.finished_product_ids) allProductIds.add(id);
  }

  const { data: products, error: productsError } = await supabase
    .from("inventory_products")
    .select("id, name, base_uom")
    .in("id", Array.from(allProductIds));

  if (productsError) {
    throw new Error(productsError.message);
  }

  const productMap = new Map(
    (products ?? []).map((p) => [p.id, { id: p.id, name: p.name, baseUom: p.base_uom }]),
  );

  return mappings.map((row) => {
    const rawProducts = row.raw_product_ids
      .map((id: string) => productMap.get(id))
      .filter(Boolean) as Pick<InventoryProduct, "id" | "name" | "baseUom">[];

    const finishedProducts = row.finished_product_ids
      .map((id: string) => productMap.get(id))
      .filter(Boolean) as Pick<InventoryProduct, "id" | "name" | "baseUom">[];

    return mapManufacturingProductMappingRow(
      row as ManufacturingProductMappingRow,
      rawProducts,
      finishedProducts,
    );
  });
}

export async function createManufacturingMapping(
  input: CreateMappingFormValues,
): Promise<ManufacturingProductMapping> {
  const supabase = createAdminClient();

  const { data: row, error } = await supabase
    .from("manufacturing_product_mappings")
    .insert({
      name: input.name,
      raw_product_ids: input.rawProductIds,
      finished_product_ids: input.finishedProductIds,
    })
    .select("id, name, raw_product_ids, finished_product_ids, created_at, updated_at")
    .single();

  if (error || !row) {
    throw new Error(error?.message ?? "Failed to create mapping.");
  }

  // Fetch product details for the response
  const allIds = [...input.rawProductIds, ...input.finishedProductIds];
  const { data: products } = await supabase
    .from("inventory_products")
    .select("id, name, base_uom")
    .in("id", allIds);

  const productMap = new Map(
    (products ?? []).map((p) => [p.id, { id: p.id, name: p.name, baseUom: p.base_uom }]),
  );

  const rawProducts = input.rawProductIds
    .map((id) => productMap.get(id))
    .filter(Boolean) as Pick<InventoryProduct, "id" | "name" | "baseUom">[];

  const finishedProducts = input.finishedProductIds
    .map((id) => productMap.get(id))
    .filter(Boolean) as Pick<InventoryProduct, "id" | "name" | "baseUom">[];

  return mapManufacturingProductMappingRow(
    row as ManufacturingProductMappingRow,
    rawProducts,
    finishedProducts,
  );
}

export async function updateManufacturingMapping(
  mappingId: string,
  input: CreateMappingFormValues,
): Promise<ManufacturingProductMapping> {
  const supabase = createAdminClient();

  const { data: row, error } = await supabase
    .from("manufacturing_product_mappings")
    .update({
      name: input.name,
      raw_product_ids: input.rawProductIds,
      finished_product_ids: input.finishedProductIds,
    })
    .eq("id", mappingId)
    .select("id, name, raw_product_ids, finished_product_ids, created_at, updated_at")
    .single();

  if (error || !row) {
    throw new Error(error?.message ?? "Failed to update mapping.");
  }

  const allIds = [...input.rawProductIds, ...input.finishedProductIds];
  const { data: products } = await supabase
    .from("inventory_products")
    .select("id, name, base_uom")
    .in("id", allIds);

  const productMap = new Map(
    (products ?? []).map((p) => [p.id, { id: p.id, name: p.name, baseUom: p.base_uom }]),
  );

  const rawProducts = input.rawProductIds
    .map((id) => productMap.get(id))
    .filter(Boolean) as Pick<InventoryProduct, "id" | "name" | "baseUom">[];

  const finishedProducts = input.finishedProductIds
    .map((id) => productMap.get(id))
    .filter(Boolean) as Pick<InventoryProduct, "id" | "name" | "baseUom">[];

  return mapManufacturingProductMappingRow(
    row as ManufacturingProductMappingRow,
    rawProducts,
    finishedProducts,
  );
}

export async function deleteManufacturingMapping(mappingId: string): Promise<void> {
  const supabase = createAdminClient();

  const { error } = await supabase
    .from("manufacturing_product_mappings")
    .delete()
    .eq("id", mappingId);

  if (error) {
    throw new Error(error.message);
  }
}

/**
 * Get finished goods that are mapped to a specific raw material product.
 * If no mapping exists for this raw product, returns an empty array.
 */
export async function getFinishedGoodsForRawProduct(
  rawProductId: string,
): Promise<FinishedGoodOption[]> {
  const supabase = createAdminClient();

  // Find all mappings where this raw product is included
  const { data: mappings, error: mappingsError } = await supabase
    .from("manufacturing_product_mappings")
    .select("finished_product_ids")
    .contains("raw_product_ids", [rawProductId]);

  if (mappingsError) {
    throw new Error(mappingsError.message);
  }

  if (!mappings || mappings.length === 0) {
    return [];
  }

  // Collect all unique finished product IDs from all matching mappings
  const finishedProductIds = new Set<string>();
  for (const mapping of mappings) {
    for (const id of mapping.finished_product_ids) {
      finishedProductIds.add(id);
    }
  }

  if (finishedProductIds.size === 0) {
    return [];
  }

  const { data, error } = await supabase
    .from("inventory_products")
    .select("id, name, base_uom")
    .eq("type", "FINISHED_GOOD")
    .is("deleted_at", null)
    .in("id", Array.from(finishedProductIds))
    .order("name", { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []).map((row) => mapFinishedGoodOptionRow(row));
}

/**
 * Get all raw material products (for mapping UI).
 */
export async function getRawMaterialProducts(): Promise<
  Pick<InventoryProduct, "id" | "name" | "baseUom">[]
> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("inventory_products")
    .select("id, name, base_uom")
    .eq("type", "RAW_MATERIAL")
    .is("deleted_at", null)
    .order("name", { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    baseUom: row.base_uom,
  }));
}


// --- Multi-Dispatch to Manufacturing (many raw materials → 1 batch) ---

export async function sendMultiToManufacturing(
  input: MultiDispatchFormValues,
): Promise<{ batchId: string }> {
  const supabase = createAdminClient();

  // Fetch the mapping to get its name
  const { data: mappingRow, error: mappingError } = await supabase
    .from("manufacturing_product_mappings")
    .select("id, name")
    .eq("id", input.mappingId)
    .single();

  if (mappingError || !mappingRow) {
    throw new Error(mappingError?.message ?? "Mapping not found.");
  }

  // Validate all lots exist and are active
  const lotIds = input.items.map((item) => item.lotId);
  const { data: lotRows, error: lotsFetchError } = await supabase
    .from("inventory_lots")
    .select("id, product_id, batch_number, quantity_remaining, unit_cost, expiry_date, status, created_at")
    .in("id", lotIds)
    .eq("status", "ACTIVE");

  if (lotsFetchError) {
    throw new Error(lotsFetchError.message);
  }

  if (!lotRows || lotRows.length !== input.items.length) {
    throw new Error("One or more lots are not found or not active.");
  }

  const lotMap = new Map(lotRows.map((row) => [row.id, row]));

  // Calculate totals
  let totalInputWeight = 0;
  let totalCostValue = 0;

  for (const item of input.items) {
    const lotRow = lotMap.get(item.lotId);
    if (!lotRow) throw new Error(`Lot ${item.lotId} not found.`);

    const quantityRemaining = Number(lotRow.quantity_remaining);
    if (item.quantityToSend > quantityRemaining) {
      throw new Error(
        `Cannot send ${item.quantityToSend} from lot ${lotRow.batch_number}. Only ${quantityRemaining} remaining.`,
      );
    }

    totalInputWeight += item.quantityToSend;
    totalCostValue += item.quantityToSend * Number(lotRow.unit_cost);
  }

  // Create the batch
  const { data: batchRow, error: batchError } = await supabase
    .from("manufacturing_batches")
    .insert({
      name: mappingRow.name,
      mapping_id: input.mappingId,
      status: "PENDING",
      total_input_weight: totalInputWeight,
      total_cost_value: totalCostValue,
    })
    .select("id")
    .single();

  if (batchError || !batchRow) {
    throw new Error(batchError?.message ?? "Failed to create manufacturing batch.");
  }

  // Create individual manufacturing orders for each lot, linked to the batch
  for (const item of input.items) {
    const lotRow = lotMap.get(item.lotId)!;
    const unitCost = Number(lotRow.unit_cost);
    const itemCost = item.quantityToSend * unitCost;

    const { data: orderRow, error: orderError } = await supabase
      .from("manufacturing_orders")
      .insert({
        raw_product_id: lotRow.product_id,
        source_lot_id: item.lotId,
        quantity_sent: item.quantityToSend,
        total_cost_value: itemCost,
        status: "PENDING",
        batch_id: batchRow.id,
      })
      .select("id")
      .single();

    if (orderError || !orderRow) {
      // Cleanup batch on failure
      await supabase.from("manufacturing_orders").delete().eq("batch_id", batchRow.id);
      await supabase.from("manufacturing_batches").delete().eq("id", batchRow.id);
      throw new Error(orderError?.message ?? "Failed to create manufacturing order.");
    }

    // Deduct from lot
    const quantityRemaining = Number(lotRow.quantity_remaining);
    const newRemaining = quantityRemaining - item.quantityToSend;
    const newStatus = newRemaining === 0 ? "DEPLETED" : "ACTIVE";

    const { error: lotUpdateError } = await supabase
      .from("inventory_lots")
      .update({
        quantity_remaining: newRemaining,
        status: newStatus,
      })
      .eq("id", item.lotId);

    if (lotUpdateError) {
      await supabase.from("manufacturing_orders").delete().eq("batch_id", batchRow.id);
      await supabase.from("manufacturing_batches").delete().eq("id", batchRow.id);
      throw new Error(lotUpdateError.message);
    }

    // Record transaction
    const { error: transactionError } = await supabase
      .from("inventory_transactions")
      .insert({
        lot_id: item.lotId,
        transaction_type: "SENT_TO_MFG",
        quantity_changed: -item.quantityToSend,
        financial_value_changed: -itemCost,
      });

    if (transactionError) {
      // Revert lot
      await supabase
        .from("inventory_lots")
        .update({ quantity_remaining: quantityRemaining, status: lotRow.status })
        .eq("id", item.lotId);
      await supabase.from("manufacturing_orders").delete().eq("batch_id", batchRow.id);
      await supabase.from("manufacturing_batches").delete().eq("id", batchRow.id);
      throw new Error(transactionError.message);
    }
  }

  return { batchId: batchRow.id };
}

export async function getPendingManufacturingBatches(): Promise<ManufacturingBatch[]> {
  const supabase = createAdminClient();

  const { data: batches, error } = await supabase
    .from("manufacturing_batches")
    .select("id, name, mapping_id, status, total_input_weight, total_cost_value, created_at, completed_at")
    .eq("status", "PENDING")
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(error.message);
  }

  if (!batches || batches.length === 0) {
    return [];
  }

  // For each batch, get its orders and mapping's finished products
  const results: ManufacturingBatch[] = [];

  for (const batch of batches) {
    // Get orders in this batch
    const { data: orderRows } = await supabase
      .from("manufacturing_orders")
      .select(
        "id, raw_product_id, source_lot_id, quantity_sent, total_cost_value, status, sent_at, completed_at, inventory_products!raw_product_id(name, base_uom), inventory_lots!source_lot_id(batch_number), manufacturing_outputs(package_size, package_count)",
      )
      .eq("batch_id", batch.id);

    const orders = (orderRows ?? []).map((row) => mapManufacturingOrderRow(row));

    // Get allowed finished products from the mapping
    let allowedFinishedProducts: FinishedGoodOption[] = [];
    if (batch.mapping_id) {
      const { data: mappingRow } = await supabase
        .from("manufacturing_product_mappings")
        .select("finished_product_ids")
        .eq("id", batch.mapping_id)
        .single();

      if (mappingRow && mappingRow.finished_product_ids?.length > 0) {
        const { data: products } = await supabase
          .from("inventory_products")
          .select("id, name, base_uom")
          .in("id", mappingRow.finished_product_ids);

        allowedFinishedProducts = (products ?? []).map((row) => mapFinishedGoodOptionRow(row));
      }
    }

    results.push({
      id: batch.id,
      name: batch.name,
      mappingId: batch.mapping_id,
      status: batch.status as "PENDING" | "COMPLETED",
      totalInputWeight: Number(batch.total_input_weight),
      totalCostValue: Number(batch.total_cost_value),
      createdAt: batch.created_at,
      completedAt: batch.completed_at,
      orders,
      allowedFinishedProducts,
    });
  }

  return results;
}

export async function processBatchOutput(
  batchId: string,
  finishedProductId: string,
  packageSize: number,
  packageCount: number,
  expiryDate: Date,
): Promise<ProcessManufacturingOutputResult> {
  const supabase = createAdminClient();

  // Get the batch
  const { data: batch, error: batchError } = await supabase
    .from("manufacturing_batches")
    .select("id, status, total_input_weight, total_cost_value")
    .eq("id", batchId)
    .single();

  if (batchError || !batch) {
    throw new Error(batchError?.message ?? "Batch not found.");
  }

  if (batch.status !== "PENDING") {
    throw new Error("Only pending batches can be processed.");
  }

  const totalInputWeight = Number(batch.total_input_weight);
  const totalCostValue = Number(batch.total_cost_value);
  const currentOutputWeight = packageSize * packageCount;

  if (currentOutputWeight > totalInputWeight) {
    throw new Error(
      `Output weight (${currentOutputWeight}) exceeds total input weight (${totalInputWeight}).`,
    );
  }

  // Verify finished product exists and is correct type
  const { data: productRow, error: productError } = await supabase
    .from("inventory_products")
    .select("id, type")
    .eq("id", finishedProductId)
    .single();

  if (productError || !productRow) {
    throw new Error(productError?.message ?? "Finished product not found.");
  }

  if (productRow.type !== "FINISHED_GOOD") {
    throw new Error("Selected product must be a finished good.");
  }

  // Calculate cost proportionally
  const costPerUnit = totalCostValue / totalInputWeight;
  const costTransferred = costPerUnit * currentOutputWeight;
  const newUnitCost = costTransferred / packageCount;
  const batchNumber = `LOT-${Date.now()}`;

  // Create finished good lot
  const { data: lotRow, error: lotError } = await supabase
    .from("inventory_lots")
    .insert({
      product_id: finishedProductId,
      batch_number: batchNumber,
      quantity_remaining: packageCount,
      unit_cost: newUnitCost,
      expiry_date: expiryDate.toISOString(),
      status: "ACTIVE",
    })
    .select("id")
    .single();

  if (lotError || !lotRow) {
    throw new Error(lotError?.message ?? "Failed to create finished goods lot.");
  }

  // Mark batch as completed
  const { error: batchUpdateError } = await supabase
    .from("manufacturing_batches")
    .update({ status: "COMPLETED", completed_at: new Date().toISOString() })
    .eq("id", batchId);

  if (batchUpdateError) {
    await supabase.from("inventory_lots").delete().eq("id", lotRow.id);
    throw new Error(batchUpdateError.message);
  }

  // Mark all orders in the batch as completed
  const { error: ordersUpdateError } = await supabase
    .from("manufacturing_orders")
    .update({ status: "COMPLETED", completed_at: new Date().toISOString() })
    .eq("batch_id", batchId);

  if (ordersUpdateError) {
    await supabase
      .from("manufacturing_batches")
      .update({ status: "PENDING", completed_at: null })
      .eq("id", batchId);
    await supabase.from("inventory_lots").delete().eq("id", lotRow.id);
    throw new Error(ordersUpdateError.message);
  }

  // Record transaction
  const { error: transactionError } = await supabase
    .from("inventory_transactions")
    .insert({
      lot_id: lotRow.id,
      transaction_type: "RECEIVED_FROM_MFG",
      quantity_changed: packageCount,
      financial_value_changed: costTransferred,
    });

  if (transactionError) {
    // Don't revert — transaction is just a log entry
    console.error("Failed to log batch output transaction:", transactionError.message);
  }

  return {
    lotId: lotRow.id,
    batchNumber,
    outputId: batchId,
  };
}
