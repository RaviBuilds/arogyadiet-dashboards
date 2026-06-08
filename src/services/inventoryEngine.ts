import { addDays, parseISO, startOfDay } from "date-fns";

import { createAdminClient } from "@/lib/supabase/admin";
import {
  INVENTORY_PRODUCT_BUCKET,
  validateInventoryProductImage,
  type ActiveRawMaterialLot,
  type AddProductInput,
  type BulkInboundItem,
  type BulkOutboundItem,
  type DispatchInventoryStockResult,
  type DispatchStockReason,
  type FinishedGoodOption,
  type InventoryCatalogProduct,
  type InventoryLot,
  type InventoryMetrics,
  type InventoryProduct,
  type ManufacturingOrder,
  type ProcessManufacturingOutputResult,
  type RevertPendingManufacturingResult,
  type TransactionLedgerEntry,
  type UpdateInventoryProductInput,
  mapActiveRawMaterialLotRow,
  mapFinishedGoodOptionRow,
  mapInventoryLotRow,
  mapInventoryProductRow,
  mapManufacturingOrderRow,
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

export async function createInventoryProduct(
  data: AddProductInput,
): Promise<InventoryProduct> {
  const supabase = createAdminClient();

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

  const payload: Record<string, string | number> = {
    updated_at: new Date().toISOString(),
  };

  if (data.name !== undefined) payload.name = data.name.trim();
  if (data.category !== undefined) payload.category = data.category.trim();
  if (data.imageUrl !== undefined) payload.image_url = data.imageUrl.trim();
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

  const { count, error: lotsError } = await supabase
    .from("inventory_lots")
    .select("id", { count: "exact", head: true })
    .eq("product_id", id);

  if (lotsError) {
    throw new Error(lotsError.message);
  }

  if (count && count > 0) {
    throw new Error(
      "Cannot delete a product with existing stock history. Please archive it instead.",
    );
  }

  const { error } = await supabase
    .from("inventory_products")
    .delete()
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
      .select("id, name, base_uom, min_stock_threshold"),
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
      inventory_lots!inner (
        batch_number,
        inventory_products!inner ( name, base_uom )
      )
    `,
    )
    .order("timestamp", { ascending: false })
    .limit(limit);

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []).map((row) => mapTransactionLedgerRow(row));
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

export async function receiveInventoryStock(
  productId: string,
  quantity: number,
  totalCost: number,
  customExpiry?: Date,
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
  _reason: DispatchStockReason,
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

export async function getActiveRawMaterialLots(): Promise<ActiveRawMaterialLot[]> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("inventory_lots")
    .select(
      "id, product_id, batch_number, quantity_remaining, unit_cost, expiry_date, status, created_at, inventory_products!inner(name, base_uom, type)",
    )
    .eq("status", "ACTIVE")
    .eq("inventory_products.type", "RAW_MATERIAL")
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
