import { z } from "zod";

export const PRODUCT_TYPES = ["RAW_MATERIAL", "FINISHED_GOOD"] as const;
export const BASE_UOMS = ["KG", "LITRE", "UNIT"] as const;

export const INVENTORY_PRODUCT_BUCKET = "inventory-product";
export const MAX_IMAGE_SIZE_BYTES = 1_048_576;
export const ALLOWED_IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
] as const;

export type ProductType = (typeof PRODUCT_TYPES)[number];
export type BaseUom = (typeof BASE_UOMS)[number];
export type AllowedImageType = (typeof ALLOWED_IMAGE_TYPES)[number];

export const addProductFormSchema = z.object({
  name: z
    .string()
    .min(1, "Product name is required")
    .max(255, "Name must be 255 characters or less"),
  category: z
    .string()
    .min(1, "Category is required")
    .max(100, "Category must be 100 characters or less"),
  type: z.enum(PRODUCT_TYPES, {
    message: "Product type is required",
  }),
  baseUom: z.enum(BASE_UOMS, {
    message: "Base unit of measure is required",
  }),
  minStockThreshold: z
    .number()
    .min(0, "Minimum stock threshold must be 0 or greater"),
  defaultDurabilityDays: z
    .number()
    .int("Durability must be a whole number")
    .min(0, "Durability must be 0 or greater"),
});

export type AddProductFormValues = z.infer<typeof addProductFormSchema>;

export const addProductSchema = addProductFormSchema.extend({
  imageUrl: z
    .string()
    .min(1, "Product image is required")
    .max(512, "Image path must be 512 characters or less"),
});

export type AddProductInput = z.infer<typeof addProductSchema>;

export type InventoryProduct = {
  id: string;
  name: string;
  imageUrl: string | null;
  category: string;
  type: ProductType;
  baseUom: BaseUom;
  minStockThreshold: number;
  defaultDurabilityDays: number;
  createdAt: string;
  updatedAt: string;
};

export type ActiveLotSummary = {
  batchNumber: string;
  quantityRemaining: number;
  expiryDate: Date | null;
};

export type InventoryCatalogProduct = InventoryProduct & {
  totalStock: number;
  activeLots: ActiveLotSummary[];
};

export const LOT_STATUSES = ["ACTIVE", "DEPLETED", "EXPIRED"] as const;
export type LotStatus = (typeof LOT_STATUSES)[number];

export type InventoryLot = {
  id: string;
  productId: string;
  batchNumber: string;
  quantityRemaining: number;
  unitCost: number;
  expiryDate: string;
  status: LotStatus;
  createdAt: string;
};

export type LowStockAlert = {
  productId: string;
  productName: string;
  totalQuantity: number;
  minStockThreshold: number;
  baseUom: BaseUom;
};

export type ExpiringLotAlert = {
  lotId: string;
  productId: string;
  productName: string;
  batchNumber: string;
  quantityRemaining: number;
  expiryDate: string;
};

export type InventoryMetrics = {
  totalWarehouseValue: number;
  totalUniqueItems: number;
  lowStockAlerts: LowStockAlert[];
  expiringLots: ExpiringLotAlert[];
};

export const receiveStockFormSchema = z.object({
  productId: z.string().uuid("Invalid product ID"),
  quantity: z.coerce.number().positive("Quantity must be greater than 0"),
  totalCost: z.coerce.number().min(0, "Total cost must be 0 or greater"),
  expiryDate: z.string().optional(),
});

export type ReceiveStockFormValues = z.infer<typeof receiveStockFormSchema>;

export const DISPATCH_STOCK_REASONS = [
  "Kitchen Consumption",
  "Customer Sale",
  "Spoilage / Damage",
] as const;

export type DispatchStockReason = (typeof DISPATCH_STOCK_REASONS)[number];

export const dispatchStockFormSchema = z.object({
  productId: z.string().uuid("Invalid product ID"),
  quantity: z.coerce.number().positive("Quantity must be greater than 0"),
  reason: z.enum(DISPATCH_STOCK_REASONS, {
    message: "Select a dispatch reason",
  }),
});

export type DispatchStockFormValues = z.infer<typeof dispatchStockFormSchema>;

export const bulkInboundItemSchema = receiveStockFormSchema.extend({
  name: z.string().min(1, "Product name is required"),
});

export const bulkOutboundItemSchema = dispatchStockFormSchema.extend({
  name: z.string().min(1, "Product name is required"),
});

export const bulkInboundSchema = z
  .array(bulkInboundItemSchema)
  .min(1, "Inbound cart is empty");

export const bulkOutboundSchema = z
  .array(bulkOutboundItemSchema)
  .min(1, "Outbound cart is empty");

export type BulkInboundItem = z.infer<typeof bulkInboundItemSchema>;
export type BulkOutboundItem = z.infer<typeof bulkOutboundItemSchema>;

export type DispatchInventoryStockResult = {
  totalDispatched: number;
  lotsAffected: number;
};

export const TRANSACTION_TYPES = [
  "IN",
  "OUT",
  "SENT_TO_MFG",
  "RECEIVED_FROM_MFG",
  "EXPIRED",
] as const;

export type TransactionType = (typeof TRANSACTION_TYPES)[number];

export type TransactionLedgerEntry = {
  id: string;
  timestamp: string;
  transactionType: TransactionType;
  productName: string;
  batchNumber: string;
  baseUom: BaseUom;
  quantityChanged: number;
  financialValueChanged: number;
};

export const MFG_ORDER_STATUSES = ["PENDING", "COMPLETED"] as const;
export type MfgOrderStatus = (typeof MFG_ORDER_STATUSES)[number];

export type ActiveRawMaterialLot = InventoryLot & {
  productName: string;
  baseUom: BaseUom;
};

export type ManufacturingOrder = {
  id: string;
  rawProductId: string;
  rawProductName: string;
  baseUom: BaseUom;
  sourceLotId: string;
  batchNumber: string;
  quantitySent: number;
  quantityProcessed: number;
  remainingToPackage: number;
  totalCostValue: number;
  status: MfgOrderStatus;
  sentAt: string;
  completedAt: string | null;
};

export const dispatchToManufacturingFormSchema = z.object({
  lotId: z.string().uuid("Invalid lot ID"),
  quantityToSend: z.coerce
    .number()
    .positive("Quantity must be greater than 0"),
});

export type DispatchToManufacturingFormValues = z.infer<
  typeof dispatchToManufacturingFormSchema
>;

export type FinishedGoodOption = Pick<InventoryProduct, "id" | "name" | "baseUom">;

export type ManufacturingOutput = {
  id: string;
  mfgOrderId: string;
  finishedProductId: string;
  newLotId: string;
  packageSize: number;
  packageCount: number;
};

export type ProcessManufacturingOutputResult = {
  lotId: string;
  batchNumber: string;
  outputId: string;
};

export type RevertPendingManufacturingResult = {
  refundedQuantity: number;
  sourceLotId: string;
};

export const processOutputFormSchema = z.object({
  mfgOrderId: z.string().uuid("Invalid manufacturing order ID"),
  finishedProductId: z.string().uuid("Select a finished good"),
  packageSize: z.coerce
    .number()
    .positive("Package size must be greater than 0"),
  packageCount: z.coerce
    .number()
    .int("Package count must be a whole number")
    .positive("Package count must be greater than 0"),
  expiryDate: z.string().min(1, "Expiry date is required"),
});

export type ProcessOutputFormValues = z.infer<typeof processOutputFormSchema>;

export const revertPendingMfgSchema = z.object({
  mfgOrderId: z.string().uuid("Invalid manufacturing order ID"),
});

export type RevertPendingMfgFormValues = z.infer<typeof revertPendingMfgSchema>;

// --- Manufacturing Product Mappings ---

export const createMappingFormSchema = z.object({
  name: z
    .string()
    .min(1, "Mapping name is required")
    .max(255, "Name must be 255 characters or less"),
  rawProductIds: z
    .array(z.string().uuid("Invalid product ID"))
    .min(1, "At least one raw material is required"),
  finishedProductIds: z
    .array(z.string().uuid("Invalid product ID"))
    .min(1, "At least one finished product is required"),
});

export type CreateMappingFormValues = z.infer<typeof createMappingFormSchema>;

export const updateMappingFormSchema = createMappingFormSchema.extend({
  mappingId: z.string().uuid("Invalid mapping ID"),
});

export type UpdateMappingFormValues = z.infer<typeof updateMappingFormSchema>;

export const deleteMappingSchema = z.object({
  mappingId: z.string().uuid("Invalid mapping ID"),
});

export type ManufacturingProductMapping = {
  id: string;
  name: string;
  rawProductIds: string[];
  finishedProductIds: string[];
  rawProducts: Pick<InventoryProduct, "id" | "name" | "baseUom">[];
  finishedProducts: Pick<InventoryProduct, "id" | "name" | "baseUom">[];
  createdAt: string;
  updatedAt: string;
};

export type ManufacturingProductMappingRow = {
  id: string;
  name: string;
  raw_product_ids: string[];
  finished_product_ids: string[];
  created_at: string;
  updated_at: string;
};

export function mapManufacturingProductMappingRow(
  row: ManufacturingProductMappingRow,
  rawProducts: Pick<InventoryProduct, "id" | "name" | "baseUom">[],
  finishedProducts: Pick<InventoryProduct, "id" | "name" | "baseUom">[],
): ManufacturingProductMapping {
  return {
    id: row.id,
    name: row.name,
    rawProductIds: row.raw_product_ids,
    finishedProductIds: row.finished_product_ids,
    rawProducts,
    finishedProducts,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// --- Multi-dispatch (many raw materials → 1 finished product) ---

export const multiDispatchFormSchema = z.object({
  mappingId: z.string().uuid("Select a mapping"),
  items: z
    .array(
      z.object({
        lotId: z.string().uuid("Invalid lot ID"),
        quantityToSend: z.coerce
          .number()
          .positive("Quantity must be greater than 0"),
      }),
    )
    .min(1, "At least one raw material lot is required"),
});

export type MultiDispatchFormValues = z.infer<typeof multiDispatchFormSchema>;

export type ManufacturingBatch = {
  id: string;
  name: string;
  mappingId: string | null;
  status: MfgOrderStatus;
  totalInputWeight: number;
  totalCostValue: number;
  createdAt: string;
  completedAt: string | null;
  orders: ManufacturingOrder[];
  allowedFinishedProducts: FinishedGoodOption[];
};

type InventoryProductRow = {
  id: string;
  name: string;
  image_url: string | null;
  category: string;
  type: ProductType;
  base_uom: BaseUom;
  min_stock_threshold: string | number;
  default_durability_days: number;
  created_at: string;
  updated_at: string;
};

function getFormString(formData: FormData, key: string): string {
  const value = formData.get(key);
  return value?.toString().trim() ?? "";
}

export function validateInventoryProductImage(file: File): string | null {
  if (!(file instanceof File) || file.size === 0) {
    return "Product image is required.";
  }

  if (file.size > MAX_IMAGE_SIZE_BYTES) {
    return "Image must be 1 MB or smaller.";
  }

  if (!ALLOWED_IMAGE_TYPES.includes(file.type as AllowedImageType)) {
    return "Image must be JPEG, PNG, WebP, or GIF.";
  }

  return null;
}

const addProductFormDataSchema = addProductFormSchema.extend({
  minStockThreshold: z.coerce
    .number()
    .min(0, "Minimum stock threshold must be 0 or greater"),
  defaultDurabilityDays: z.coerce
    .number()
    .int("Durability must be a whole number")
    .min(0, "Durability must be 0 or greater"),
});

export function parseAddProductFormData(formData: FormData) {
  return addProductFormDataSchema.safeParse({
    name: getFormString(formData, "name"),
    category: getFormString(formData, "category"),
    type: getFormString(formData, "type"),
    baseUom: getFormString(formData, "baseUom"),
    minStockThreshold: getFormString(formData, "minStockThreshold"),
    defaultDurabilityDays: getFormString(formData, "defaultDurabilityDays"),
  });
}

export const editProductFormDataSchema = addProductFormDataSchema.extend({
  productId: z.string().uuid("Invalid product ID"),
});

export type EditProductFormValues = z.infer<typeof editProductFormDataSchema>;

export type UpdateInventoryProductInput = {
  name?: string;
  category?: string;
  imageUrl?: string;
  type?: ProductType;
  baseUom?: BaseUom;
  minStockThreshold?: number;
  defaultDurabilityDays?: number;
};

export const deleteProductSchema = z.object({
  productId: z.string().uuid("Invalid product ID"),
});

export function parseEditProductFormData(formData: FormData) {
  return editProductFormDataSchema.safeParse({
    productId: getFormString(formData, "productId"),
    name: getFormString(formData, "name"),
    category: getFormString(formData, "category"),
    type: getFormString(formData, "type"),
    baseUom: getFormString(formData, "baseUom"),
    minStockThreshold: getFormString(formData, "minStockThreshold"),
    defaultDurabilityDays: getFormString(formData, "defaultDurabilityDays"),
  });
}

type InventoryLotRow = {
  id: string;
  product_id: string;
  batch_number: string;
  quantity_remaining: string | number;
  unit_cost: string | number;
  expiry_date: string;
  status: LotStatus;
  created_at: string;
};

export function parseReceiveStockFormData(formData: FormData) {
  const expiryDate = getFormString(formData, "expiryDate");

  return receiveStockFormSchema.safeParse({
    productId: getFormString(formData, "productId"),
    quantity: getFormString(formData, "quantity"),
    totalCost: getFormString(formData, "totalCost"),
    expiryDate: expiryDate || undefined,
  });
}

export function parseDispatchStockFormData(formData: FormData) {
  return dispatchStockFormSchema.safeParse({
    productId: getFormString(formData, "productId"),
    quantity: getFormString(formData, "quantity"),
    reason: getFormString(formData, "reason"),
  });
}

type JoinedProductSummary = {
  name: string;
  base_uom: BaseUom;
  type?: ProductType;
};

type JoinedLotSummary = {
  batch_number: string;
};

type ActiveRawMaterialLotRow = InventoryLotRow & {
  inventory_products: JoinedProductSummary | JoinedProductSummary[];
};

type ManufacturingOutputSummaryRow = {
  package_size: string | number;
  package_count: string | number;
};

type ManufacturingOrderRow = {
  id: string;
  raw_product_id: string;
  source_lot_id: string;
  quantity_sent: string | number;
  total_cost_value: string | number;
  status: MfgOrderStatus;
  sent_at: string;
  completed_at: string | null;
  inventory_products: JoinedProductSummary | JoinedProductSummary[];
  inventory_lots: JoinedLotSummary | JoinedLotSummary[];
  manufacturing_outputs?: ManufacturingOutputSummaryRow[];
};

function sumManufacturingOutputWeight(
  outputs: ManufacturingOutputSummaryRow[] | undefined,
): number {
  return (outputs ?? []).reduce(
    (sum, output) =>
      sum + Number(output.package_size) * Number(output.package_count),
    0,
  );
}

function normalizeJoin<T>(value: T | T[]): T {
  return Array.isArray(value) ? value[0] : value;
}

export function parseDispatchToManufacturingFormData(formData: FormData) {
  return dispatchToManufacturingFormSchema.safeParse({
    lotId: getFormString(formData, "lotId"),
    quantityToSend: getFormString(formData, "quantityToSend"),
  });
}

export function parseProcessOutputFormData(formData: FormData) {
  return processOutputFormSchema.safeParse({
    mfgOrderId: getFormString(formData, "mfgOrderId"),
    finishedProductId: getFormString(formData, "finishedProductId"),
    packageSize: getFormString(formData, "packageSize"),
    packageCount: getFormString(formData, "packageCount"),
    expiryDate: getFormString(formData, "expiryDate"),
  });
}

type FinishedGoodOptionRow = {
  id: string;
  name: string;
  base_uom: BaseUom;
};

export function mapFinishedGoodOptionRow(
  row: FinishedGoodOptionRow,
): FinishedGoodOption {
  return {
    id: row.id,
    name: row.name,
    baseUom: row.base_uom,
  };
}

export function mapActiveRawMaterialLotRow(
  row: ActiveRawMaterialLotRow,
): ActiveRawMaterialLot {
  const lot = mapInventoryLotRow(row);
  const product = normalizeJoin(row.inventory_products);
  return {
    ...lot,
    productName: product.name,
    baseUom: product.base_uom,
  };
}

export function mapManufacturingOrderRow(
  row: ManufacturingOrderRow,
): ManufacturingOrder {
  const product = normalizeJoin(row.inventory_products);
  const sourceLot = normalizeJoin(row.inventory_lots);
  const quantitySent = Number(row.quantity_sent);
  const quantityProcessed = sumManufacturingOutputWeight(
    row.manufacturing_outputs,
  );

  return {
    id: row.id,
    rawProductId: row.raw_product_id,
    rawProductName: product.name,
    baseUom: product.base_uom,
    sourceLotId: row.source_lot_id,
    batchNumber: sourceLot.batch_number,
    quantitySent,
    quantityProcessed,
    remainingToPackage: quantitySent - quantityProcessed,
    totalCostValue: Number(row.total_cost_value),
    status: row.status,
    sentAt: row.sent_at,
    completedAt: row.completed_at,
  };
}

export function mapInventoryLotRow(row: InventoryLotRow): InventoryLot {
  return {
    id: row.id,
    productId: row.product_id,
    batchNumber: row.batch_number,
    quantityRemaining: Number(row.quantity_remaining),
    unitCost: Number(row.unit_cost),
    expiryDate: row.expiry_date,
    status: row.status,
    createdAt: row.created_at,
  };
}

type TransactionLedgerRow = {
  id: string;
  transaction_type: TransactionType;
  quantity_changed: string | number;
  financial_value_changed: string | number;
  timestamp: string;
  inventory_lots:
    | {
        batch_number: string;
        inventory_products: JoinedProductSummary | JoinedProductSummary[];
      }
    | {
        batch_number: string;
        inventory_products: JoinedProductSummary | JoinedProductSummary[];
      }[];
};

export function mapTransactionLedgerRow(
  row: TransactionLedgerRow,
): TransactionLedgerEntry {
  const lot = normalizeJoin(row.inventory_lots);
  const product = normalizeJoin(lot.inventory_products);

  return {
    id: row.id,
    timestamp: row.timestamp,
    transactionType: row.transaction_type,
    productName: product.name,
    batchNumber: lot.batch_number,
    baseUom: product.base_uom,
    quantityChanged: Number(row.quantity_changed),
    financialValueChanged: Number(row.financial_value_changed),
  };
}

export function mapInventoryProductRow(
  row: InventoryProductRow,
): InventoryProduct {
  return {
    id: row.id,
    name: row.name,
    imageUrl: row.image_url,
    category: row.category,
    type: row.type,
    baseUom: row.base_uom,
    minStockThreshold: Number(row.min_stock_threshold),
    defaultDurabilityDays: row.default_durability_days,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
