"use server";

import { revalidatePath } from "next/cache";

import { parseISO, startOfDay } from "date-fns";

import {
  bulkInboundSchema,
  bulkOutboundSchema,
  type BulkInboundItem,
  type BulkOutboundItem,
  createMappingFormSchema,
  deleteProductSchema,
  deleteMappingSchema,
  multiDispatchFormSchema,
  parseAddProductFormData,
  parseEditProductFormData,
  parseDispatchStockFormData,
  parseDispatchToManufacturingFormData,
  parseProcessOutputFormData,
  parseReceiveStockFormData,
  revertPendingMfgSchema,
  updateMappingFormSchema,
  validateInventoryProductImage,
} from "@/lib/inventory/product-schema";
import {
  BulkInventoryError,
  createInventoryProduct,
  createManufacturingMapping,
  deleteInventoryProduct,
  deleteManufacturingMapping,
  dispatchInventoryStock,
  processBatchOutput,
  processBulkInbound,
  processBulkOutbound,
  processManufacturingOutput,
  receiveInventoryStock,
  revertPendingManufacturing,
  sendMultiToManufacturing,
  sendToManufacturing,
  updateInventoryProduct,
  updateManufacturingMapping,
  uploadInventoryProductImage,
} from "@/services/inventoryEngine";

const INVENTORY_PATH = "/admin/inventory";
const MANUFACTURING_PATH = "/admin/inventory/manufacturing";
const MAPPINGS_PATH = "/admin/inventory/mappings";

type AddProductResult =
  | { success: true; productId: string }
  | { success: false; error: string };

type EditProductResult =
  | { success: true; productId: string }
  | { success: false; error: string };

type DeleteProductResult =
  | { success: true }
  | { success: false; error: string };

type ReceiveStockResult =
  | { success: true; lotId: string; batchNumber: string }
  | { success: false; error: string };

type DispatchToManufacturingResult =
  | { success: true; orderId: string }
  | { success: false; error: string };

type ProcessOutputResult =
  | { success: true; lotId: string; batchNumber: string }
  | { success: false; error: string };

type RevertPendingMfgResult =
  | { success: true; refundedQuantity: number }
  | { success: false; error: string };

type DispatchStockResult =
  | { success: true; totalDispatched: number }
  | { success: false; error: string };

type BulkReceiveResult =
  | { success: true; processed: number; batchNumbers: string[] }
  | { success: false; error: string; processed?: number };

type BulkDispatchResult =
  | { success: true; processed: number; totalDispatched: number }
  | { success: false; error: string; processed?: number };

export async function addProductAction(
  formData: FormData,
): Promise<AddProductResult> {
  const file = formData.get("image");

  if (!(file instanceof File)) {
    return { success: false, error: "Product image is required." };
  }

  const imageValidationError = validateInventoryProductImage(file);
  if (imageValidationError) {
    return { success: false, error: imageValidationError };
  }

  const parsed = parseAddProductFormData(formData);
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message ?? "Invalid product data.",
    };
  }

  try {
    const imagePath = await uploadInventoryProductImage(file);
    const product = await createInventoryProduct({
      ...parsed.data,
      imageUrl: imagePath,
    });
    revalidatePath(INVENTORY_PATH);
    return { success: true, productId: product.id };
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Failed to register product.";
    return { success: false, error: message };
  }
}

export async function editProductAction(
  formData: FormData,
): Promise<EditProductResult> {
  const parsed = parseEditProductFormData(formData);
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message ?? "Invalid product data.",
    };
  }

  const file = formData.get("image");
  let imageUrl: string | undefined;

  if (file instanceof File && file.size > 0) {
    const imageValidationError = validateInventoryProductImage(file);
    if (imageValidationError) {
      return { success: false, error: imageValidationError };
    }

    try {
      imageUrl = await uploadInventoryProductImage(file);
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Failed to upload product image.";
      return { success: false, error: message };
    }
  }

  const { productId, ...fields } = parsed.data;

  try {
    const product = await updateInventoryProduct(productId, {
      name: fields.name,
      category: fields.category,
      type: fields.type,
      baseUom: fields.baseUom,
      minStockThreshold: fields.minStockThreshold,
      defaultDurabilityDays: fields.defaultDurabilityDays,
      ...(imageUrl ? { imageUrl } : {}),
    });
    revalidatePath(INVENTORY_PATH);
    return { success: true, productId: product.id };
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Failed to update product.";
    return { success: false, error: message };
  }
}

export async function deleteProductAction(
  productId: string,
): Promise<DeleteProductResult> {
  const parsed = deleteProductSchema.safeParse({ productId });
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message ?? "Invalid product ID.",
    };
  }

  try {
    await deleteInventoryProduct(parsed.data.productId);
    revalidatePath(INVENTORY_PATH);
    return { success: true };
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Failed to delete product.";
    return { success: false, error: message };
  }
}

export async function receiveStockAction(
  formData: FormData,
): Promise<ReceiveStockResult> {
  const parsed = parseReceiveStockFormData(formData);
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message ?? "Invalid stock receipt data.",
    };
  }

  const customExpiry = parsed.data.expiryDate
    ? startOfDay(parseISO(parsed.data.expiryDate))
    : undefined;

  try {
    const lot = await receiveInventoryStock(
      parsed.data.productId,
      parsed.data.quantity,
      parsed.data.totalCost,
      customExpiry,
    );
    revalidatePath(INVENTORY_PATH);
    return { success: true, lotId: lot.id, batchNumber: lot.batchNumber };
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Failed to receive stock.";
    return { success: false, error: message };
  }
}

export async function dispatchToManufacturingAction(
  formData: FormData,
): Promise<DispatchToManufacturingResult> {
  const parsed = parseDispatchToManufacturingFormData(formData);
  if (!parsed.success) {
    return {
      success: false,
      error:
        parsed.error.issues[0]?.message ?? "Invalid dispatch data.",
    };
  }

  try {
    const order = await sendToManufacturing(
      parsed.data.lotId,
      parsed.data.quantityToSend,
    );
    revalidatePath(MANUFACTURING_PATH);
    return { success: true, orderId: order.id };
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Failed to dispatch to manufacturing.";
    return { success: false, error: message };
  }
}

export async function processOutputAction(
  formData: FormData,
): Promise<ProcessOutputResult> {
  const parsed = parseProcessOutputFormData(formData);
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message ?? "Invalid process output data.",
    };
  }

  const expiryDate = startOfDay(parseISO(parsed.data.expiryDate));

  try {
    const result = await processManufacturingOutput(
      parsed.data.mfgOrderId,
      parsed.data.finishedProductId,
      parsed.data.packageSize,
      parsed.data.packageCount,
      expiryDate,
    );
    revalidatePath(INVENTORY_PATH);
    revalidatePath(MANUFACTURING_PATH);
    return {
      success: true,
      lotId: result.lotId,
      batchNumber: result.batchNumber,
    };
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Failed to process manufacturing output.";
    return { success: false, error: message };
  }
}

export async function revertPendingMfgAction(
  mfgOrderId: string,
): Promise<RevertPendingMfgResult> {
  const parsed = revertPendingMfgSchema.safeParse({ mfgOrderId });
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message ?? "Invalid manufacturing order ID.",
    };
  }

  try {
    const result = await revertPendingManufacturing(parsed.data.mfgOrderId);
    revalidatePath(INVENTORY_PATH);
    revalidatePath(MANUFACTURING_PATH);
    return { success: true, refundedQuantity: result.refundedQuantity };
  } catch (err: unknown) {
    const message =
      err instanceof Error
        ? err.message
        : "Failed to return raw material to stock.";
    return { success: false, error: message };
  }
}

export async function bulkReceiveAction(
  items: BulkInboundItem[],
): Promise<BulkReceiveResult> {
  const parsed = bulkInboundSchema.safeParse(items);
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message ?? "Invalid inbound batch data.",
    };
  }

  try {
    const result = await processBulkInbound(parsed.data);
    revalidatePath(INVENTORY_PATH);
    return {
      success: true,
      processed: result.processed,
      batchNumbers: result.batchNumbers,
    };
  } catch (err: unknown) {
    if (err instanceof BulkInventoryError) {
      return {
        success: false,
        error: err.message,
        processed: err.processed,
      };
    }
    const message =
      err instanceof Error ? err.message : "Failed to process inbound batch.";
    return { success: false, error: message };
  }
}

export async function bulkDispatchAction(
  items: BulkOutboundItem[],
): Promise<BulkDispatchResult> {
  const parsed = bulkOutboundSchema.safeParse(items);
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message ?? "Invalid outbound batch data.",
    };
  }

  try {
    const result = await processBulkOutbound(parsed.data);
    revalidatePath(INVENTORY_PATH);
    return {
      success: true,
      processed: result.processed,
      totalDispatched: result.totalDispatched,
    };
  } catch (err: unknown) {
    if (err instanceof BulkInventoryError) {
      return {
        success: false,
        error: err.message,
        processed: err.processed,
      };
    }
    const message =
      err instanceof Error ? err.message : "Failed to process outbound batch.";
    return { success: false, error: message };
  }
}

export async function dispatchStockAction(
  formData: FormData,
): Promise<DispatchStockResult> {
  const parsed = parseDispatchStockFormData(formData);
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message ?? "Invalid dispatch data.",
    };
  }

  try {
    const result = await dispatchInventoryStock(
      parsed.data.productId,
      parsed.data.quantity,
      parsed.data.reason,
    );
    revalidatePath(INVENTORY_PATH);
    return { success: true, totalDispatched: result.totalDispatched };
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Failed to dispatch stock.";
    return { success: false, error: message };
  }
}

// --- Manufacturing Product Mapping Actions ---

type CreateMappingResult =
  | { success: true; mappingId: string }
  | { success: false; error: string };

type UpdateMappingResult =
  | { success: true; mappingId: string }
  | { success: false; error: string };

type DeleteMappingResult =
  | { success: true }
  | { success: false; error: string };

export async function createMappingAction(
  input: { name: string; rawProductIds: string[]; finishedProductIds: string[] },
): Promise<CreateMappingResult> {
  const parsed = createMappingFormSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message ?? "Invalid mapping data.",
    };
  }

  try {
    const mapping = await createManufacturingMapping(parsed.data);
    revalidatePath(MAPPINGS_PATH);
    revalidatePath(MANUFACTURING_PATH);
    return { success: true, mappingId: mapping.id };
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Failed to create mapping.";
    return { success: false, error: message };
  }
}

export async function updateMappingAction(
  input: { mappingId: string; name: string; rawProductIds: string[]; finishedProductIds: string[] },
): Promise<UpdateMappingResult> {
  const parsed = updateMappingFormSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message ?? "Invalid mapping data.",
    };
  }

  try {
    const mapping = await updateManufacturingMapping(
      parsed.data.mappingId,
      {
        name: parsed.data.name,
        rawProductIds: parsed.data.rawProductIds,
        finishedProductIds: parsed.data.finishedProductIds,
      },
    );
    revalidatePath(MAPPINGS_PATH);
    revalidatePath(MANUFACTURING_PATH);
    return { success: true, mappingId: mapping.id };
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Failed to update mapping.";
    return { success: false, error: message };
  }
}

export async function deleteMappingAction(
  mappingId: string,
): Promise<DeleteMappingResult> {
  const parsed = deleteMappingSchema.safeParse({ mappingId });
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message ?? "Invalid mapping ID.",
    };
  }

  try {
    await deleteManufacturingMapping(parsed.data.mappingId);
    revalidatePath(MAPPINGS_PATH);
    revalidatePath(MANUFACTURING_PATH);
    return { success: true };
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Failed to delete mapping.";
    return { success: false, error: message };
  }
}


// --- Multi-Dispatch Actions ---

type MultiDispatchResult =
  | { success: true; batchId: string }
  | { success: false; error: string };

type ProcessBatchOutputResult =
  | { success: true; lotId: string; batchNumber: string }
  | { success: false; error: string };

export async function multiDispatchToManufacturingAction(
  input: { mappingId: string; items: { lotId: string; quantityToSend: number }[] },
): Promise<MultiDispatchResult> {
  const parsed = multiDispatchFormSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message ?? "Invalid multi-dispatch data.",
    };
  }

  try {
    const result = await sendMultiToManufacturing(parsed.data);
    revalidatePath(MANUFACTURING_PATH);
    revalidatePath(INVENTORY_PATH);
    return { success: true, batchId: result.batchId };
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Failed to dispatch to manufacturing.";
    return { success: false, error: message };
  }
}

export async function processBatchOutputAction(
  input: {
    batchId: string;
    finishedProductId: string;
    packageSize: number;
    packageCount: number;
    expiryDate: string;
  },
): Promise<ProcessBatchOutputResult> {
  if (!input.batchId || !input.finishedProductId || !input.packageSize || !input.packageCount || !input.expiryDate) {
    return { success: false, error: "All fields are required." };
  }

  const expiryDate = startOfDay(parseISO(input.expiryDate));

  try {
    const result = await processBatchOutput(
      input.batchId,
      input.finishedProductId,
      input.packageSize,
      input.packageCount,
      expiryDate,
    );
    revalidatePath(INVENTORY_PATH);
    revalidatePath(MANUFACTURING_PATH);
    return { success: true, lotId: result.lotId, batchNumber: result.batchNumber };
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Failed to process batch output.";
    return { success: false, error: message };
  }
}
