"use server";

// Franchise-portal dispute actions.
//
// These server actions handle the franchise operator's dispute operations:
// creating new disputes and fetching received orders for inventory disputes.
//
// Each action resolves the caller's Scope via the shared Scope_Resolver,
// uses `scope.franchise_id` as the authoritative franchise (never trusts
// a client-supplied franchise ID), validates input with Zod, delegates to
// the repository layer, and revalidates the disputes route on mutation.
//
// (franchise-dispute-management spec — Task 3.1)
// Requirements validated: 4.3, 4.4, 4.7, 5.1, 5.2, 9.1, 9.3, 9.6

import { revalidatePath } from "next/cache";
import { resolveScope } from "@/lib/auth/scope-resolver";
import { createDisputeSchema } from "@/validations/disputeSchema";
import {
  createDispute,
  getReceivedOrdersForFranchise,
} from "@/repositories/disputeRepository";
import type { ActionResult } from "@/types/franchise";
import type { ReceivedOrderOption } from "@/types/dispute";

// ---------------------------------------------------------------------------
// createDisputeAction
// ---------------------------------------------------------------------------

/**
 * Creates a new dispute for the authenticated franchise operator.
 * Resolves scope, validates input, inserts via repository, and revalidates.
 *
 * Req 4.3, 4.4, 4.7, 9.1, 9.3
 */
export async function createDisputeAction(
  formData: FormData
): Promise<ActionResult<{ id: string }>> {
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
    return {
      success: false,
      error: "This action is restricted to franchise operators.",
    };
  }

  // 2. Extract and validate form data with Zod schema
  const rawRelatedOrderIds = formData.get("related_order_ids") as string | null;
  let relatedOrderIds: string[] | undefined;

  if (rawRelatedOrderIds) {
    try {
      relatedOrderIds = JSON.parse(rawRelatedOrderIds);
    } catch {
      return {
        success: false,
        error: "Invalid related order IDs format.",
        field: "related_order_ids",
      };
    }
  }

  const raw = {
    category: formData.get("category") as string,
    description: formData.get("description") as string,
    related_order_ids: relatedOrderIds,
  };

  const parsed = createDisputeSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return {
      success: false,
      error: issue?.message ?? "Invalid input.",
      field: issue?.path[0]?.toString(),
    };
  }

  // 3. Create the dispute via repository (uses scope.franchise_id — authoritative)
  try {
    const result = await createDispute({
      franchise_id: scope.franchise_id,
      category: parsed.data.category,
      description: parsed.data.description,
      related_order_ids: parsed.data.related_order_ids,
    });

    // 4. Revalidate the disputes page
    revalidatePath("/disputes");

    return { success: true, data: { id: result.id } };
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Could not create dispute. Please try again.",
    };
  }
}

// ---------------------------------------------------------------------------
// fetchReceivedOrdersAction
// ---------------------------------------------------------------------------

/**
 * Fetches received stock transfers within 72 hours for the current franchise.
 * Used to populate the order multi-select when raising Inventory disputes.
 *
 * Req 5.1, 5.2, 9.6
 */
export async function fetchReceivedOrdersAction(): Promise<
  ActionResult<ReceivedOrderOption[]>
> {
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
    return {
      success: false,
      error: "This action is restricted to franchise operators.",
    };
  }

  // 2. Fetch received orders via repository
  try {
    const orders = await getReceivedOrdersForFranchise(scope.franchise_id);
    return { success: true, data: orders };
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Could not fetch received orders. Please try again.",
    };
  }
}
