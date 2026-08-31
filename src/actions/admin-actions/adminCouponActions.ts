"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { logAdminAction } from "@/lib/logger";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { checkGroupManage } from "@/lib/auth/adminAccess";
// Schemas, payload helpers and the ungated per-customer coupon cores are shared
// with the Franchise_Portal's own gated wrappers (franchise-scoped-access
// Task 2). They live outside this `"use server"` module because such a module
// may only export async functions.
import {
  globalCouponFieldsSchema,
  getActivePlansForLegacyMirror,
  buildCouponInsertPayload,
  createCouponCore,
  deleteCouponCore,
  type CreateCouponInput,
  type ActionResult,
} from "@/services/customerCouponCore";

// ─── createCoupon ────────────────────────────────────────────────────────────

export async function createCoupon(
  formData: CreateCouponInput,
): Promise<ActionResult> {
  const gate = await checkGroupManage("customers");
  if (!gate.ok) return { success: false, error: gate.error };
  return createCouponCore(formData);
}

// ─── deleteCoupon ────────────────────────────────────────────────────────────

export async function deleteCoupon(
  couponId: string,
  customerProfileId: string,
): Promise<ActionResult> {
  const gate = await checkGroupManage("customers");
  if (!gate.ok) return { success: false, error: gate.error };
  return deleteCouponCore(couponId, customerProfileId);
}

// ─── createGlobalCoupon ──────────────────────────────────────────────────────

export async function createGlobalCoupon(
  formData: z.infer<typeof globalCouponFieldsSchema>,
  scope?: string | null,
): Promise<ActionResult> {
  const gate = await checkGroupManage("customers");
  if (!gate.ok) return { success: false, error: gate.error };
  const parsed = globalCouponFieldsSchema.safeParse(formData);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0].message };
  }

  const d = parsed.data;
  const supabase = createAdminClient();
  const franchiseId = !scope || scope === "core" ? null : scope;

  try {
    let existingQuery = supabase
      .from("coupons")
      .select("id")
      .eq("code", d.code)
      .is("customer_profile_id", null);

    existingQuery = franchiseId
      ? existingQuery.eq("franchise_id", franchiseId)
      : existingQuery.is("franchise_id", null);

    const { data: existing } = await existingQuery.maybeSingle();

    if (existing) {
      return {
        success: false,
        error: `Global coupon code "${d.code}" already exists for this scope.`,
      };
    }

    const plans = await getActivePlansForLegacyMirror(supabase);
    const { error } = await supabase.from("coupons").insert({
      customer_profile_id: null,
      franchise_id: franchiseId,
      ...buildCouponInsertPayload(d, plans),
    });

    if (error) throw new Error(error.message);

    await logAdminAction("CREATE", "global_coupon", d.code, {
      discount_type: d.discountType,
      franchise_id: franchiseId,
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

// ─── listGlobalCoupons (franchise-scoped) ────────────────────────────────────

export async function listGlobalCoupons(scope?: string | null) {
  const supabase = createAdminClient();
  const franchiseId = !scope || scope === "core" ? null : scope;

  let query = supabase
    .from("coupons")
    .select(
      "id, code, discount_type, discount_value_30_days, discount_value_60_days, discount_value_90_days, flat_discounts_by_plan, discount_value, max_uses, times_used, expires_at, created_at",
    )
    .is("customer_profile_id", null);

  query = franchiseId
    ? query.eq("franchise_id", franchiseId)
    : query.is("franchise_id", null);

  const { data, error } = await query.order("created_at", { ascending: false });

  if (error) {
    console.error("listGlobalCoupons error:", error.message);
    return { success: false as const, error: error.message, data: [] };
  }

  return { success: true as const, data: data ?? [] };
}

// ─── deleteGlobalCoupon ──────────────────────────────────────────────────────

export async function deleteGlobalCoupon(couponId: string): Promise<ActionResult> {
  const gate = await checkGroupManage("customers");
  if (!gate.ok) return { success: false, error: gate.error };
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
