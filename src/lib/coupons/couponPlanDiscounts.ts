export type CouponPlanDiscountSource = {
  flat_discounts_by_plan?: unknown;
  discount_value_30_days?: number | null;
  discount_value_60_days?: number | null;
  discount_value_90_days?: number | null;
};

export function normalizeFlatDiscountsByPlan(
  raw: unknown,
): Record<string, number> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {};
  }

  return Object.entries(raw as Record<string, unknown>).reduce<
    Record<string, number>
  >((acc, [planId, value]) => {
    const amount = Number(value ?? 0);
    if (!Number.isNaN(amount) && amount > 0) {
      acc[planId] = amount;
    }
    return acc;
  }, {});
}

export function getFlatDiscountForPlan(
  coupon: CouponPlanDiscountSource,
  planId: string,
  planDuration?: number,
): number {
  const byPlan = normalizeFlatDiscountsByPlan(coupon.flat_discounts_by_plan);
  if (byPlan[planId] != null && byPlan[planId] > 0) {
    return byPlan[planId];
  }

  if (planDuration === 30) {
    return Number(coupon.discount_value_30_days ?? 0);
  }
  if (planDuration === 60) {
    return Number(coupon.discount_value_60_days ?? 0);
  }
  if (planDuration === 90) {
    return Number(coupon.discount_value_90_days ?? 0);
  }

  return 0;
}

export function mirrorLegacyDurationColumns(
  flatDiscountsByPlan: Record<string, number>,
  plans: Array<{ id: string; duration_days: number }>,
) {
  const legacy = {
    discount_value_30_days: 0,
    discount_value_60_days: 0,
    discount_value_90_days: 0,
  };

  for (const plan of plans) {
    const amount = flatDiscountsByPlan[plan.id] ?? 0;
    if (plan.duration_days === 30) legacy.discount_value_30_days = amount;
    if (plan.duration_days === 60) legacy.discount_value_60_days = amount;
    if (plan.duration_days === 90) legacy.discount_value_90_days = amount;
  }

  return legacy;
}
