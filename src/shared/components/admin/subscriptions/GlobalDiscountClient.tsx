"use client";

import {
  AdminCouponsTab,
  type CouponRow,
  type CouponSubscriptionPlan,
} from "@/shared/components/admin/customers/AdminCouponsTab";

interface GlobalDiscountClientProps {
  initialCoupons: CouponRow[];
  subscriptionPlans: CouponSubscriptionPlan[];
}

export function GlobalDiscountClient({
  initialCoupons,
  subscriptionPlans,
}: GlobalDiscountClientProps) {
  return (
    <AdminCouponsTab
      variant="global"
      initialCoupons={initialCoupons}
      subscriptionPlans={subscriptionPlans}
    />
  );
}
