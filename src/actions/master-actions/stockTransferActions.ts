"use server";

// src/actions/master-actions/stockTransferActions.ts
// Master/admin-portal Server Actions for franchise stock transfers + warehouse
// stock reads in the multi-tenant-franchise hierarchy
// (multi-tenant-franchise spec — Task 10.1, Requirements 19.2–19.7).
//
// LAYERING: Action layer ONLY. These actions orchestrate authorization (Scope),
// the franchise feature-flag gate, pure validation (`stockTransferSchema` from
// src/validations/franchise.ts), and data access. The MULTI-STATEMENT,
// must-be-atomic movement is delegated to the SECURITY DEFINER plpgsql RPC
// `transfer_stock`, invoked through the service-role admin client
// (`createAdminClient().rpc(...)`), mirroring groupActions.createGroup and
// serviceAreaActions.movePincode (scripts/create-transfer-stock-rpc.sql):
//   - initiateStockTransfer        → public.transfer_stock (Req 19.2–19.5, 19.7)
//   - listFranchiseWarehouseStock  → warehouseRepository.listWarehouseStock (Req 19.6)
//
// A stock transfer moves product INTO a destination Franchise warehouse from
// either the CORE business or another Franchise. Initiating a transfer is a
// FULL-NETWORK concern (MASTER_ADMIN / ADMIN only, Req 19.7); the atomic RPC
// conserves total stock, rejects qty>available and qty<=0, and writes exactly
// one ledger row (Req 19.2–19.5). Reading a Franchise's warehouse stock is
// tenant-scoped: a franchise-scoped caller sees only its own stock, while a
// full-network caller may read any Franchise's stock (Req 19.6).

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveScope } from "@/lib/auth/scope-resolver";
import { FRANCHISE_FEATURES_ENABLED } from "@/lib/franchise/constants";
import {
  stockTransferSchema,
  type StockTransferSchemaInput,
} from "@/validations/franchise";
import { listWarehouseStock } from "@/repositories/franchise/warehouseRepository";
import type {
  ActionResult,
  FranchiseWarehouseStock,
} from "@/types/franchise";

const MASTER_SYSTEM_PATH = "/system";

// ─── Authorization + feature gate ───────────────────────────────────────────

/**
 * Resolve the authenticated caller and require the FULL-NETWORK scope
 * (MASTER_ADMIN / ADMIN). Returns either the resolved current user id (so the
 * caller can be stamped as `p_created_by` on the ledger) or an `ActionResult`
 * failure.
 *
 * - When FRANCHISE_FEATURES_ENABLED is off the franchise surface is inert
 *   (Req 18.x): no franchise reads/writes are performed.
 * - Only the full_network scope may initiate stock transfers (Req 19.7).
 */
async function assertFullNetworkScope(): Promise<
  { ok: true; userId: string } | { ok: false; result: ActionResult<never> }
> {
  if (!FRANCHISE_FEATURES_ENABLED) {
    return {
      ok: false,
      result: { success: false, error: "Franchise features are not enabled" },
    };
  }

  // Resolve the caller's session first so an unauthenticated request is
  // reported as Unauthorized rather than a generic scope error.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, result: { success: false, error: "Unauthorized" } };
  }

  const scopeResult = await resolveScope();
  if (!scopeResult.ok || scopeResult.scope.kind !== "full_network") {
    return {
      ok: false,
      result: {
        success: false,
        error: "Only an Admin or Master Admin can initiate stock transfers",
      },
    };
  }

  return { ok: true, userId: user.id };
}

/**
 * Map a `transfer_stock` RPC RAISE message to a friendly, user-facing error.
 * The RPC RAISEs deterministic messages on every validation failure (the
 * transaction aborts, so balances are unchanged and no ledger row is written):
 *   - 'invalid transfer quantity'              → qty <= 0 (Req 19.4)
 *   - 'insufficient source stock'              → qty > available (Req 19.3)
 *   - 'destination warehouse not found ...'    → dest franchise has no warehouse
 *   - 'source warehouse not found ...'         → source franchise has no warehouse
 *   - 'invalid source kind'                    → unrecognized source kind
 */
function mapTransferError(rawMessage: string): string {
  const message = rawMessage ?? "";

  if (message.includes("invalid transfer quantity")) {
    return "Transfer quantity must be greater than 0";
  }
  if (message.includes("insufficient source stock")) {
    return "The source does not have enough stock for this transfer";
  }
  if (message.includes("destination warehouse not found")) {
    return "The destination franchise does not have a warehouse yet";
  }
  if (message.includes("source warehouse not found")) {
    return "The source franchise does not have a warehouse yet";
  }
  if (message.includes("invalid source kind")) {
    return "The transfer source is invalid";
  }

  return message || "Failed to initiate stock transfer";
}

// ─── Actions (Task 10.1) ────────────────────────────────────────────────────

/**
 * Initiate a stock transfer INTO a destination Franchise warehouse from either
 * the CORE business or another Franchise (Req 19.2–19.5, 19.7).
 *
 * Full-network scope ONLY (MASTER_ADMIN / ADMIN, Req 19.7). Validates the input
 * via {@link stockTransferSchema} (source_kind / source_franchise_id coherence,
 * positive quantity), then delegates the actual movement to the SECURITY
 * DEFINER RPC `transfer_stock`, which atomically conserves total stock, rejects
 * qty>available and qty<=0, and records exactly one ledger row. The current
 * user is stamped as `p_created_by`. RPC RAISE messages are mapped to friendly
 * errors via {@link mapTransferError}.
 *
 * Validates: Requirements 19.2, 19.3, 19.4, 19.5, 19.7.
 */
export async function initiateStockTransfer(
  input: StockTransferSchemaInput
): Promise<ActionResult<{ id: string }>> {
  const auth = await assertFullNetworkScope();
  if (!auth.ok) return auth.result;

  const parsed = stockTransferSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return {
      success: false,
      error: issue?.message ?? "Invalid stock transfer",
      field: issue?.path?.[0] ? String(issue.path[0]) : undefined,
    };
  }

  const {
    source_kind,
    source_franchise_id,
    dest_franchise_id,
    product_id,
    quantity,
  } = parsed.data;

  const admin = createAdminClient();
  const { data: transferId, error } = await admin.rpc("transfer_stock", {
    p_source_kind: source_kind,
    p_source_franchise_id: source_franchise_id,
    p_dest_franchise_id: dest_franchise_id,
    p_product_id: product_id,
    p_quantity: quantity,
    p_created_by: auth.userId,
  });

  if (error || !transferId) {
    return { success: false, error: mapTransferError(error?.message ?? "") };
  }

  revalidatePath(MASTER_SYSTEM_PATH);
  return { success: true, data: { id: transferId as string } };
}

/**
 * List the warehouse stock for a Franchise (Req 19.6). Tenant-scoped:
 *   - full_network (MASTER_ADMIN / ADMIN) → may read ANY Franchise's stock.
 *   - franchise (FRANCHISE_ADMIN)         → may read ONLY its own stock; a
 *     request for a different franchise is rejected, and `applyScope` in the
 *     repository additionally enforces the boundary as defense-in-depth.
 *   - core / unresolved                   → no franchise stock to read.
 *
 * Validates: Requirement 19.6.
 */
export async function listFranchiseWarehouseStock(
  franchiseId: string
): Promise<ActionResult<FranchiseWarehouseStock[]>> {
  if (!FRANCHISE_FEATURES_ENABLED) {
    return { success: false, error: "Franchise features are not enabled" };
  }

  if (!franchiseId || franchiseId.trim().length === 0) {
    return { success: false, error: "Franchise id is required" };
  }

  // Resolve the caller's session first so an unauthenticated request is
  // reported as Unauthorized rather than a generic scope error.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { success: false, error: "Unauthorized" };

  const scopeResult = await resolveScope();
  if (!scopeResult.ok) {
    return {
      success: false,
      error:
        scopeResult.reason === "no_franchise"
          ? "Your account is not assigned to a franchise"
          : "Unauthorized",
    };
  }

  const scope = scopeResult.scope;

  // Core callers have no franchise warehouse stock to read (Req 19.6).
  if (scope.kind === "core") {
    return {
      success: false,
      error: "Only franchise or network administrators can view warehouse stock",
    };
  }

  // A franchise-scoped caller may only read its own franchise's stock (Req 19.6).
  if (scope.kind === "franchise" && scope.franchise_id !== franchiseId) {
    return {
      success: false,
      error: "You can only view your own franchise's warehouse stock",
    };
  }

  try {
    const stock = await listWarehouseStock(franchiseId, scope);
    return { success: true, data: stock };
  } catch (err) {
    return {
      success: false,
      error:
        err instanceof Error
          ? err.message
          : "Failed to list franchise warehouse stock",
    };
  }
}
