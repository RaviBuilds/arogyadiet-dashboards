"use server";

// Franchise-portal inventory actions.
//
// These server actions handle the franchise operator's inventory movements:
// accepting/rejecting/receiving stock transfers and recording stock-outs.
// Product create/edit/delete actions are intentionally absent — franchise
// operators have stock-movement-only permissions (Requirements 4.1–4.3).
//
// Each action resolves the caller's Scope via the shared Scope_Resolver,
// uses `scope.franchise_id` as the authoritative franchise (never trusts
// a client-supplied franchise ID), validates input with Zod, delegates to
// the service layer, and revalidates the franchise inventory routes.
//
// (franchise-inventory spec — Task 11.1)
// Requirements validated: 2.6, 4.1, 4.2, 4.3, 7.4, 7.5, 8.3, 10.1, 11.6

import { revalidatePath } from "next/cache";
import { resolveScope } from "@/lib/auth/scope-resolver";
import { createClient } from "@/lib/supabase/server";
import {
  transferActionInputSchema,
  stockOutInputSchema,
} from "@/validations/franchiseInventory";
import {
  acceptTransfer,
  rejectTransfer,
  receiveTransfer,
  recordStockOut,
} from "@/services/franchiseInventoryEngine";
import type { ActionResult } from "@/types/franchise";
import type {
  TransferActionResult,
  StockOutResult,
} from "@/services/franchiseInventoryEngine";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function revalidateFranchiseInventory(): void {
  revalidatePath("/franchise/inventory");
  revalidatePath("/franchise/inventory/ledger");
}

async function getCurrentUserId(): Promise<string | null> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  // Look up the internal user ID from the auth_user_id
  const { data } = await supabase.from("users").select("id").eq("auth_user_id", user.id).single();
  return data?.id ?? null;
}

// ---------------------------------------------------------------------------
// Transfer actions
// ---------------------------------------------------------------------------

/**
 * Accept an incoming transfer (DISPATCHED → ACCEPTED).
 * Resolves scope, validates input, calls the service, and revalidates.
 */
export async function acceptTransferAction(
  formData: FormData,
): Promise<ActionResult<TransferActionResult>> {
  // 1. Resolve scope — reject unresolved / no_franchise callers
  const scopeResult = await resolveScope();
  if (!scopeResult.ok) {
    return {
      success: false,
      error:
        scopeResult.reason === "no_franchise"
          ? "No franchise is assigned to your account."
          : "Unauthorized. Please log in.",
    };
  }

  const { scope } = scopeResult;

  // Only franchise-scoped users can perform this action
  if (scope.kind !== "franchise") {
    return { success: false, error: "This action is restricted to franchise operators." };
  }

  // 2. Validate input with Zod schema
  const raw = {
    transfer_id: formData.get("transfer_id") as string,
    franchise_id: scope.franchise_id, // authoritative — never trust client-supplied
  };

  const parsed = transferActionInputSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return {
      success: false,
      error: issue?.message ?? "Invalid input.",
      field: issue?.path[0]?.toString(),
    };
  }

  // 3. Call the service (uses scope.franchise_id as authoritative)
  const userId = await getCurrentUserId();
  const result = await acceptTransfer(
    parsed.data.transfer_id,
    scope.franchise_id,
    scope,
    userId ?? undefined,
  );

  // 4. Revalidate franchise inventory routes
  revalidateFranchiseInventory();

  if (!result.success) {
    return { success: false, error: result.error ?? "Failed to accept transfer." };
  }

  return { success: true, data: result };
}

/**
 * Reject an incoming transfer (DISPATCHED → REJECTED).
 * Resolves scope, validates input, calls the service, and revalidates.
 */
export async function rejectTransferAction(
  formData: FormData,
): Promise<ActionResult<TransferActionResult>> {
  // 1. Resolve scope
  const scopeResult = await resolveScope();
  if (!scopeResult.ok) {
    return {
      success: false,
      error:
        scopeResult.reason === "no_franchise"
          ? "No franchise is assigned to your account."
          : "Unauthorized. Please log in.",
    };
  }

  const { scope } = scopeResult;

  if (scope.kind !== "franchise") {
    return { success: false, error: "This action is restricted to franchise operators." };
  }

  // 2. Validate input
  const raw = {
    transfer_id: formData.get("transfer_id") as string,
    franchise_id: scope.franchise_id,
  };

  const parsed = transferActionInputSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return {
      success: false,
      error: issue?.message ?? "Invalid input.",
      field: issue?.path[0]?.toString(),
    };
  }

  // 3. Call the service
  const userId = await getCurrentUserId();
  const result = await rejectTransfer(
    parsed.data.transfer_id,
    scope.franchise_id,
    scope,
    userId ?? undefined,
  );

  // 4. Revalidate
  revalidateFranchiseInventory();

  if (!result.success) {
    return { success: false, error: result.error ?? "Failed to reject transfer." };
  }

  return { success: true, data: result };
}

/**
 * Receive an incoming transfer (ACCEPTED → RECEIVED).
 * Creates franchise lots, increments on-hand, writes the IN ledger entry.
 */
export async function receiveTransferAction(
  formData: FormData,
): Promise<ActionResult<TransferActionResult>> {
  // 1. Resolve scope
  const scopeResult = await resolveScope();
  if (!scopeResult.ok) {
    return {
      success: false,
      error:
        scopeResult.reason === "no_franchise"
          ? "No franchise is assigned to your account."
          : "Unauthorized. Please log in.",
    };
  }

  const { scope } = scopeResult;

  if (scope.kind !== "franchise") {
    return { success: false, error: "This action is restricted to franchise operators." };
  }

  // 2. Validate input
  const raw = {
    transfer_id: formData.get("transfer_id") as string,
    franchise_id: scope.franchise_id,
  };

  const parsed = transferActionInputSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return {
      success: false,
      error: issue?.message ?? "Invalid input.",
      field: issue?.path[0]?.toString(),
    };
  }

  // 3. Call the service
  const userId = await getCurrentUserId();
  const result = await receiveTransfer(
    parsed.data.transfer_id,
    scope.franchise_id,
    scope,
    userId ?? undefined,
  );

  // 4. Revalidate
  revalidateFranchiseInventory();

  if (!result.success) {
    return { success: false, error: result.error ?? "Failed to receive transfer." };
  }

  return { success: true, data: result };
}

// ---------------------------------------------------------------------------
// Stock-Out action
// ---------------------------------------------------------------------------

/**
 * Record a stock-out from franchise inventory.
 * FIFO-depletes the earliest-expiry batches and writes the OUT ledger entry.
 */
export async function recordStockOutAction(
  formData: FormData,
): Promise<ActionResult<StockOutResult>> {
  // 1. Resolve scope
  const scopeResult = await resolveScope();
  if (!scopeResult.ok) {
    return {
      success: false,
      error:
        scopeResult.reason === "no_franchise"
          ? "No franchise is assigned to your account."
          : "Unauthorized. Please log in.",
    };
  }

  const { scope } = scopeResult;

  if (scope.kind !== "franchise") {
    return { success: false, error: "This action is restricted to franchise operators." };
  }

  // 2. Validate input with Zod schema
  const raw = {
    product_id: formData.get("product_id") as string,
    reason: formData.get("reason") as string,
    quantity: Number(formData.get("quantity")),
    comment: formData.get("comment") as string | null,
  };

  const parsed = stockOutInputSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return {
      success: false,
      error: issue?.message ?? "Invalid input.",
      field: issue?.path[0]?.toString(),
    };
  }

  // 3. Call the service (uses scope.franchise_id as authoritative)
  const result = await recordStockOut(parsed.data, scope.franchise_id, scope);

  // 4. Revalidate
  revalidateFranchiseInventory();

  if (!result.success) {
    return { success: false, error: result.error ?? "Failed to record stock out." };
  }

  return { success: true, data: result };
}

// ---------------------------------------------------------------------------
// Bulk outbound dispatch (staging cart → outbound batch)
// ---------------------------------------------------------------------------

export interface BulkFranchiseDispatchItem {
  product_id: string;
  name: string;
  quantity: number;
  reason: string;
  comment?: string | null;
}

export interface BulkFranchiseDispatchResult {
  success: boolean;
  processed?: number;
  totalDispatched?: number;
  error?: string;
}

/**
 * Processes a staged outbound batch: each item is validated and dispatched via
 * the atomic record_franchise_stock_out RPC (FIFO depletion + OUT ledger entry).
 * Stops on the first failing item and reports which item failed so the operator
 * can correct the cart.
 */
export async function bulkFranchiseDispatchAction(
  items: BulkFranchiseDispatchItem[],
): Promise<BulkFranchiseDispatchResult> {
  // 1. Resolve scope
  const scopeResult = await resolveScope();
  if (!scopeResult.ok) {
    return {
      success: false,
      error:
        scopeResult.reason === "no_franchise"
          ? "No franchise is assigned to your account."
          : "Unauthorized. Please log in.",
    };
  }

  const { scope } = scopeResult;
  if (scope.kind !== "franchise") {
    return { success: false, error: "This action is restricted to franchise operators." };
  }

  if (!Array.isArray(items) || items.length === 0) {
    return { success: false, error: "The outbound cart is empty." };
  }

  let processed = 0;
  let totalDispatched = 0;

  // Process sequentially so each FIFO depletion sees the prior item's effect.
  for (const item of items) {
    const parsed = stockOutInputSchema.safeParse({
      product_id: item.product_id,
      reason: item.reason,
      quantity: item.quantity,
      comment: item.comment ?? null,
    });

    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return {
        success: false,
        processed,
        error: `${item.name}: ${issue?.message ?? "Invalid item."}`,
      };
    }

    const result = await recordStockOut(parsed.data, scope.franchise_id, scope);

    if (!result.success) {
      return {
        success: false,
        processed,
        error: `${item.name}: ${result.error ?? "Dispatch failed."}`,
      };
    }

    processed += 1;
    totalDispatched += item.quantity;
  }

  revalidateFranchiseInventory();

  return { success: true, processed, totalDispatched };
}
