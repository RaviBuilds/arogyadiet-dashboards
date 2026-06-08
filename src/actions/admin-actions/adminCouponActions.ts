"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { mirrorLegacyDurationColumns } from "@/lib/coupons/couponPlanDiscounts";
import { logAdminAction } from "@/lib/logger";
import { revalidatePath } from "next/cache";
import { z } from "zod";

// ─── schemas ────────────────────────────────────────────────────────────────

const couponFieldsSchema = z.object({
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

const globalCouponFieldsSchema =
  couponFieldsSchema.superRefine(refineCouponFields);

const createCouponSchema = couponFieldsSchema
  .extend({ customerProfileId: z.string().uuid() })
  .superRefine(refineCouponFields);

type ActionResult = { success: boolean; error?: string };

async function getActivePlansForLegacyMirror(supabase: ReturnType<typeof createAdminClient>) {
  const { data: plans } = await supabase
    .from("subscription_plans")
    .select("id, duration_days")
    .eq("is_active", true);

  return plans ?? [];
}

function buildCouponInsertPayload(
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

// ─── createCoupon ────────────────────────────────────────────────────────────

export async function createCoupon(
  formData: z.infer<typeof createCouponSchema>,
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
    const msg =
      err instanceof Error ? err.message : "Failed to create coupon.";
    console.error("createCoupon error:", msg);
    return { success: false, error: msg };
  }
}

// ─── deleteCoupon ────────────────────────────────────────────────────────────

export async function deleteCoupon(
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
    const msg =
      err instanceof Error ? err.message : "Failed to delete coupon.";
    console.error("deleteCoupon error:", msg);
    return { success: false, error: msg };
  }
}

// ─── createGlobalCoupon ──────────────────────────────────────────────────────

export async function createGlobalCoupon(
  formData: z.infer<typeof globalCouponFieldsSchema>,
): Promise<ActionResult> {
  const parsed = globalCouponFieldsSchema.safeParse(formData);
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
      .is("customer_profile_id", null)
      .maybeSingle();

    if (existing) {
      return {
        success: false,
        error: `Global coupon code "${d.code}" already exists.`,
      };
    }

    const plans = await getActivePlansForLegacyMirror(supabase);
    const { error } = await supabase.from("coupons").insert({
      customer_profile_id: null,
      ...buildCouponInsertPayload(d, plans),
    });

    if (error) throw new Error(error.message);

    await logAdminAction("CREATE", "global_coupon", d.code, {
      discount_type: d.discountType,
    });

    revalidatePath("/subscriptions");

    return { success: true };
  } catch (err: unknown) {
    const msg =
      err instanceof Error ? err.message : "Failed to create global coupon.";
    console.error("createGlobalCoupon error:", msg);
    return { success: false, error: msg };
  }
}

// ─── deleteGlobalCoupon ──────────────────────────────────────────────────────

export async function deleteGlobalCoupon(couponId: string): Promise<ActionResult> {
  const supabase = createAdminClient();

  try {
    const { error } = await supabase
      .from("coupons")
      .delete()
      .eq("id", couponId)
      .is("customer_profile_id", null);

    if (error) throw new Error(error.message);

    await logAdminAction("DELETE", "global_coupon", couponId, {});

    revalidatePath("/subscriptions");

    return { success: true };
  } catch (err: unknown) {
    const msg =
      err instanceof Error ? err.message : "Failed to delete global coupon.";
    console.error("deleteGlobalCoupon error:", msg);
    return { success: false, error: msg };
  }
}
