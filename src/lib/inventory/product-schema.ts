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

export const PURCHASE_ORDER_BUCKET = "purchase-orders";
export const MAX_PURCHASE_ORDER_SIZE_BYTES = 5_242_880;
export const ALLOWED_PURCHASE_ORDER_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
] as const;

export const INVENTORY_SOURCE_TYPES = ["FARMER", "VENDOR", "SELF_MADE", "OTHER"] as const;

export type ProductType = (typeof PRODUCT_TYPES)[number];
export type BaseUom = (typeof BASE_UOMS)[number];
export type AllowedImageType = (typeof ALLOWED_IMAGE_TYPES)[number];
export type AllowedPurchaseOrderType =
  (typeof ALLOWED_PURCHASE_ORDER_TYPES)[number];
export type InventorySourceType = (typeof INVENTORY_SOURCE_TYPES)[number];

export const INVENTORY_SOURCE_LABELS: Record<InventorySourceType, string> = {
  FARMER: "Farmer",
  VENDOR: "Vendor",
  SELF_MADE: "Self Made",
  OTHER: "Other",
};

// ─── Managed product categories ───────────────────────────────────────────

/**
 * Reserved sentinel used when a product has no category assigned. Products with
 * this value are grouped under "Uncategorized" in the catalog. It cannot be
 * created as a real category by the master admin.
 */
export const UNCATEGORIZED_LABEL = "Uncategorized";

export type InventoryProductCategory = {
  id: string;
  name: string;
  description: string | null;
  imageUrl: string | null;
  createdAt: string;
  updatedAt: string;
};

/** A category enriched with live product / stock aggregates for the overview UI. */
export type InventoryCategoryOverview = {
  /** Null for the synthetic "Uncategorized" bucket. */
  id: string | null;
  name: string;
  description: string | null;
  imageUrl: string | null;
  productCount: number;
  totalStock: number;
};

export const categoryFormSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Category name is required")
    .max(100, "Name must be 100 characters or less")
    .refine(
      (value) => value.toLowerCase() !== UNCATEGORIZED_LABEL.toLowerCase(),
      `"${UNCATEGORIZED_LABEL}" is a reserved name.`,
    ),
  description: z
    .string()
    .trim()
    .max(500, "Description must be 500 characters or less")
    .optional()
    .or(z.literal("")),
});

export type CategoryFormValues = z.infer<typeof categoryFormSchema>;

export function parseCreateCategoryFormData(formData: FormData) {
  return categoryFormSchema.safeParse({
    name: getFormString(formData, "name"),
    description: getFormString(formData, "description"),
  });
}

export type CreateInventoryProductCategoryInput = {
  name: string;
  description?: string | null;
  imageUrl?: string | null;
};

type InventoryProductCategoryRow = {
  id: string;
  name: string;
  description: string | null;
  image_url: string | null;
  created_at: string;
  updated_at: string;
};

export function mapInventoryProductCategoryRow(
  row: InventoryProductCategoryRow,
): InventoryProductCategory {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    imageUrl: row.image_url,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

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

export const receiveStockBaseSchema = z.object({
  productId: z.string().uuid("Invalid product ID"),
  quantity: z.coerce.number().positive("Quantity must be greater than 0"),
  totalCost: z.coerce.number().min(0, "Total cost must be 0 or greater"),
  expiryDate: z.string().optional(),
  sourceType: z.enum(INVENTORY_SOURCE_TYPES, {
    message: "Select a source",
  }),
  sourceName: z
    .string()
    .max(255, "Source name must be 255 characters or less")
    .optional(),
});

export const receiveStockFormSchema = receiveStockBaseSchema.superRefine(
  (data, ctx) => {
    if (data.sourceType === "OTHER" && !data.sourceName?.trim()) {
      ctx.addIssue({
        code: "custom",
        path: ["sourceName"],
        message: "Enter the source name when 'Other' is selected",
      });
    }
  },
);

export type ReceiveStockFormValues = z.infer<typeof receiveStockFormSchema>;

/**
 * Fixed, non-entity dispatch reasons (no DB entity backing them).
 * Clinic-based and franchise-based destinations are dynamic and stored as
 * plain text snapshots in inventory_transactions.reason.
 */
export const STATIC_DISPATCH_REASONS = [
  "Kitchen Consumption",
  "Customer Sale",
  "Spoilage / Damage",
] as const;

/**
 * @deprecated Legacy alias retained so the static array still works as a
 * readonly tuple in any existing consumer that spreads it. New code should
 * derive available options dynamically (clinics + franchises + static reasons).
 */
export const DISPATCH_STOCK_REASONS = STATIC_DISPATCH_REASONS;

/**
 * Any string stored in inventory_transactions.reason.  The DB column is
 * unconstrained TEXT (the old CHECK constraint was dropped in
 * add-franchise-dispatch-to-inventory-transactions.sql).
 */
export type DispatchStockReason = string;

/** Prefix applied to clinic-based dispatch values in the Select component. */
export const CLINIC_DISPATCH_PREFIX = "clinic:";

/** A core-business clinic surfaced as a dispatch destination. */
export type CoreClinicDestination = {
  id: string;
  name: string;
};

export const dispatchStockFormSchema = z.object({
  productId: z.string().uuid("Invalid product ID"),
  quantity: z.coerce.number().positive("Quantity must be greater than 0"),
  // Plain string — the DB column is unconstrained TEXT.
  reason: z.string().min(1, "Select a dispatch reason"),
});

export type DispatchStockFormValues = z.infer<typeof dispatchStockFormSchema>;

export const bulkInboundItemSchema = receiveStockBaseSchema
  .extend({
    name: z.string().min(1, "Product name is required"),
    purchaseOrderPath: z
      .string()
      .max(512, "Purchase order path must be 512 characters or less")
      .optional(),
  })
  .superRefine((data, ctx) => {
    if (data.sourceType === "OTHER" && !data.sourceName?.trim()) {
      ctx.addIssue({
        code: "custom",
        path: ["sourceName"],
        message: "Enter the source name when 'Other' is selected",
      });
    }
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

export const purchaseOrderExportFiltersSchema = z.object({
  from: z.string().min(1, "Start date is required"),
  to: z.string().min(1, "End date is required"),
  type: z.enum(PRODUCT_TYPES).optional(),
  productIds: z.array(z.string().uuid("Invalid product ID")).optional(),
});

export type PurchaseOrderExportFilters = z.infer<
  typeof purchaseOrderExportFiltersSchema
>;

export type PurchaseOrderExportFile = {
  lotId: string;
  batchNumber: string;
  productName: string;
  path: string;
  receivedAt: string;
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
  /** Incoming entries only — where the stock came from. */
  sourceType: InventorySourceType | null;
  /** Free-text supplier name, captured when sourceType is OTHER. */
  sourceName: string | null;
  /** Outgoing entries only — why the stock left (DISPATCH_STOCK_REASONS). */
  reason: DispatchStockReason | null;
  /** For franchise dispatch entries — the transfer ID to fetch package images */
  franchiseTransferId: string | null;
  /** Whether the franchise transfer has package images attached */
  hasPackageImages: boolean;
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

export const revertPendingBatchSchema = z.object({
  batchId: z.string().uuid("Invalid batch ID"),
});

export type RevertPendingBatchFormValues = z.infer<
  typeof revertPendingBatchSchema
>;

export type RevertPendingBatchResult = {
  itemsReturned: number;
};

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

export function validatePurchaseOrderFile(file: File): string | null {
  if (!(file instanceof File) || file.size === 0) {
    return "Purchase order file is empty.";
  }

  if (file.size > MAX_PURCHASE_ORDER_SIZE_BYTES) {
    return "Purchase order file must be 5 MB or smaller.";
  }

  if (
    !ALLOWED_PURCHASE_ORDER_TYPES.includes(
      file.type as AllowedPurchaseOrderType,
    )
  ) {
    return "Purchase order must be JPEG, PNG, WebP, or PDF.";
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
  const sourceName = getFormString(formData, "sourceName");

  return receiveStockFormSchema.safeParse({
    productId: getFormString(formData, "productId"),
    quantity: getFormString(formData, "quantity"),
    totalCost: getFormString(formData, "totalCost"),
    expiryDate: expiryDate || undefined,
    sourceType: getFormString(formData, "sourceType"),
    sourceName: sourceName || undefined,
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

type TransactionLedgerLotSummary = {
  batch_number: string;
  source_type: InventorySourceType | null;
  source_name: string | null;
  inventory_products: JoinedProductSummary | JoinedProductSummary[];
};

type TransactionLedgerRow = {
  id: string;
  transaction_type: TransactionType;
  quantity_changed: string | number;
  financial_value_changed: string | number;
  timestamp: string;
  reason: DispatchStockReason | null;
  franchise_transfer_id: string | null;
  inventory_lots: TransactionLedgerLotSummary | TransactionLedgerLotSummary[];
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
    sourceType: lot.source_type ?? null,
    sourceName: lot.source_name ?? null,
    reason: row.reason ?? null,
    franchiseTransferId: row.franchise_transfer_id ?? null,
    hasPackageImages: false, // Resolved separately after mapping
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
