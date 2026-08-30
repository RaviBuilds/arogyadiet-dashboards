// src/services/customerCouponCore.ts
//
// Feature: franchise-scoped-access — Task 2.
//
// The UNGATED business logic behind the per-customer coupon actions, plus the
// coupon schemas and payload helpers shared with the still-admin-only global
// coupon actions.
//
// Extracted from `src/actions/admin-actions/adminCouponActions.ts` for the same
// reason as `customerManagementCore.ts`: the Franchise_Portal's coupon wrappers
// (`franchiseCreateCustomerCoupon` / `franchiseDeleteCustomerCoupon`) delegated
// to `createCoupon` / `deleteCoupon`, both of which open with
// `checkGroupManage("customers")` and therefore refuse every `FRANCHISE_ADMIN`.
//
// ─── INVARIANTS ──────────────────────────────────────────────────────────────
//
//  1. THIS FILE MUST NOT CARRY `"use server"`. It would turn every export into
//     an unauthenticated, invocable server-action endpoint.
//  2. The cores authorize nothing. Callers must establish permission (manage on
//     `customers`) and, for the franchise portal, tenancy first.
//  3. Bodies are the pre-extraction logic verbatim, including the
//     `/admin/customers` revalidation, so Core Business behaviour is unchanged.
//
// The schemas live here (rather than staying in the `"use server"` action file)
// because a `"use server"` module may only export async functions — it cannot
// re-export a Zod schema or a plain helper.

import { createAdminClient } from "@/lib/supabase/admin";
import { mirrorLegacyDurationColumns } from "@/lib/coupons/couponPlanDiscounts";
import { logAdminAction } from "@/lib/logger";
import { revalidatePath } from "next/cache";
import { z } from "zod";

// ─── schemas ────────────────────────────────────────────────────────────────

export const couponFieldsSchema = z.object({
  code: z
    .string()
    .min(3, "Code must be at least 3 characters")
    .max(30, "Code must be 30 characters or less")
    .regex(/^[A-Z0-9_-]+$/, "Code can only contain letters, numbers, - and _"),
  discountType: z.enum(["FLAT", "PERCENTAGE"]),
  flatDiscountsByPlan: z.record(z.string().uuid(), z.number().min(0)).optional(),
  discountValue: z.number().min(0).max(100).optional(),
  maxUses: z.number().int().min(1, "Max uses must be at least 1"),
  expiresAt: z.string().optional(),
});

function refineCouponFields(
  d: z.infer<typeof couponFieldsSchema>,
  ctx: z.RefinementCtx,
) {
  if (d.discountType === "FLAT") {
    const discounts = d.flatDiscountsByPlan ?? {};
    const hasAny = Object.values(discounts).some((value) => value > 0);
    if (!hasAny) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "At least one plan discount must be greater than 0",
        path: ["flatDiscountsByPlan"],
      });
    }
  }
  if (d.discountType === "PERCENTAGE") {
    if (!d.discountValue || d.discountValue <= 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Discount percentage must be greater than 0",
        path: ["discountValue"],
      });
    }
  }
}

export const globalCouponFieldsSchema =
  couponFieldsSchema.superRefine(refineCouponFields);

export const createCouponSchema = couponFieldsSchema
  .extend({ customerProfileId: z.string().uuid() })
  .superRefine(refineCouponFields);

export type CreateCouponInput = z.infer<typeof createCouponSchema>;
export type GlobalCouponInput = z.infer<typeof globalCouponFieldsSchema>;

export type ActionResult = { success: boolean; error?: string };

// ─── payload helpers ─────────────────────────────────────────────────────────

export async function getActivePlansForLegacyMirror(
  supabase: ReturnType<typeof createAdminClient>,
) {
  const { data: plans } = await supabase
    .from("subscription_plans")
    .select("id, duration_days")
    .eq("is_active", true);

  return plans ?? [];
}

export function buildCouponInsertPayload(
  d: z.infer<typeof couponFieldsSchema>,
  plans: Array<{ id: string; duration_days: number }>,
) {
  const flatDiscountsByPlan = d.flatDiscountsByPlan ?? {};
  const legacy = mirrorLegacyDurationColumns(flatDiscountsByPlan, plans);

  return {
    code: d.code,
    discount_type: d.discountType,
    flat_discounts_by_plan: flatDiscountsByPlan,
    discount_value_30_days: legacy.discount_value_30_days,
    discount_value_60_days: legacy.discount_value_60_days,
    discount_value_90_days: legacy.discount_value_90_days,
    discount_value: d.discountValue ?? 0,
    max_uses: d.maxUses,
    times_used: 0,
    expires_at: d.expiresAt ? new Date(d.expiresAt).toISOString() : null,
  };
}

// ─── cores ───────────────────────────────────────────────────────────────────

export async function createCouponCore(
  formData: CreateCouponInput,
): Promise<ActionResult> {
  const parsed = createCouponSchema.safeParse(formData);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0].message };
  }

  const d = parsed.data;
  const supabase = createAdminClient();

  try {
    const { data: existing } = await supabase
      .from("coupons")
      .select("id")
      .eq("code", d.code)
      .eq("customer_profile_id", d.customerProfileId)
      .maybeSingle();

    if (existing) {
      return {
        success: false,
        error: `Coupon code "${d.code}" already exists for this customer.`,
      };
    }

    const plans = await getActivePlansForLegacyMirror(supabase);
    const { error } = await supabase.from("coupons").insert({
      customer_profile_id: d.customerProfileId,
      ...buildCouponInsertPayload(d, plans),
    });

    if (error) throw new Error(error.message);

    await logAdminAction("CREATE", "coupon", d.code, {
      customer_profile_id: d.customerProfileId,
      discount_type: d.discountType,
    });

    revalidatePath(`/admin/customers`);

    return { success: true };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to create coupon.";
    console.error("createCoupon error:", msg);
    return { success: false, error: msg };
  }
}

export async function deleteCouponCore(
  couponId: string,
  customerProfileId: string,
): Promise<ActionResult> {
  const supabase = createAdminClient();

  try {
    const { error } = await supabase
      .from("coupons")
      .delete()
      .eq("id", couponId)
      .eq("customer_profile_id", customerProfileId);

    if (error) throw new Error(error.message);

    await logAdminAction("DELETE", "coupon", couponId, {
      customer_profile_id: customerProfileId,
    });

    revalidatePath(`/admin/customers`);

    return { success: true };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to delete coupon.";
    console.error("deleteCoupon error:", msg);
    return { success: false, error: msg };
  }
}
