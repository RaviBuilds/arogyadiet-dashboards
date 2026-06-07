import type { SupabaseClient } from "@supabase/supabase-js";

import {
  getFlatDiscountForPlan,
  normalizeFlatDiscountsByPlan,
} from "./couponPlanDiscounts";

export type SubscriptionCouponRow = {
  id: string;
  code: string;
  discount_type: "FLAT" | "PERCENTAGE";
  discount_value: number;
  discount_value_30_days: number;
  discount_value_60_days: number;
  discount_value_90_days: number;
  flat_discounts_by_plan?: unknown;
  max_uses: number;
  times_used: number;
  expires_at: string | null;
  customer_profile_id: string | null;
};

export type ResolvedSubscriptionCoupon = {
  coupon: SubscriptionCouponRow;
  resolvedDiscountValue: number;
};

export function resolveCouponDiscountValue(
  coupon: Pick<
    SubscriptionCouponRow,
    | "discount_type"
    | "discount_value"
    | "discount_value_30_days"
    | "discount_value_60_days"
    | "discount_value_90_days"
    | "flat_discounts_by_plan"
  >,
  planId: string,
  planDuration?: number,
): number {
  if (coupon.discount_type === "PERCENTAGE") {
    return Number(coupon.discount_value ?? 0);
  }

  return getFlatDiscountForPlan(coupon, planId, planDuration);
}

export function validateCouponEligibility(
  coupon: Pick<SubscriptionCouponRow, "times_used" | "max_uses" | "expires_at">,
): { valid: true } | { valid: false; error: string } {
  if (coupon.times_used >= coupon.max_uses) {
    return {
      valid: false,
      error: "This coupon usage limit has been reached.",
    };
  }

  if (coupon.expires_at && new Date(coupon.expires_at) < new Date()) {
    return { valid: false, error: "This coupon has expired." };
  }

  return { valid: true };
}

export async function findSubscriptionCoupon(
  supabase: SupabaseClient,
  code: string,
  customerProfileId: string,
): Promise<SubscriptionCouponRow | null> {
  const normalizedCode = code.toUpperCase();

  const { data: customerCoupon } = await supabase
    .from("coupons")
    .select("*")
    .eq("code", normalizedCode)
    .eq("customer_profile_id", customerProfileId)
    .maybeSingle();

  if (customerCoupon) {
    return customerCoupon as SubscriptionCouponRow;
  }

  const { data: globalCoupon } = await supabase
    .from("coupons")
    .select("*")
    .eq("code", normalizedCode)
    .is("customer_profile_id", null)
    .maybeSingle();

  return (globalCoupon as SubscriptionCouponRow | null) ?? null;
}

export async function resolveSubscriptionCoupon(
  supabase: SupabaseClient,
  code: string,
  customerProfileId: string,
  planId: string,
  planDuration?: number,
): Promise<
  | { success: true; result: ResolvedSubscriptionCoupon }
  | { success: false; error: string }
> {
  const coupon = await findSubscriptionCoupon(
    supabase,
    code,
    customerProfileId,
  );

  if (!coupon) {
    return { success: false, error: "Invalid coupon code." };
  }

  const eligibility = validateCouponEligibility(coupon);
  if (!eligibility.valid) {
    return { success: false, error: eligibility.error };
  }

  const resolvedDiscountValue = resolveCouponDiscountValue(
    coupon,
    planId,
    planDuration,
  );

  if (resolvedDiscountValue <= 0) {
    return {
      success: false,
      error: "This coupon is not valid for the selected plan.",
    };
  }

  return {
    success: true,
    result: { coupon, resolvedDiscountValue },
  };
}

export function applyCouponToBasePrice(
  basePrice: number,
  coupon: Pick<SubscriptionCouponRow, "discount_type">,
  resolvedDiscountValue: number,
): number {
  let finalBasePrice = basePrice;

  if (coupon.discount_type === "FLAT") {
    finalBasePrice -= resolvedDiscountValue;
  } else if (coupon.discount_type === "PERCENTAGE") {
    finalBasePrice -= (finalBasePrice * resolvedDiscountValue) / 100;
  }

  return Math.max(1, finalBasePrice);
}

export { normalizeFlatDiscountsByPlan };
