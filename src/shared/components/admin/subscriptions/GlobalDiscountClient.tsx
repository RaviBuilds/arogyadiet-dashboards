"use client";

import {
  AdminCouponsTab,
  type CouponRow,
  type CouponSubscriptionPlan,
} from "@/shared/components/admin/customers/AdminCouponsTab";

interface GlobalDiscountClientProps {
  initialCoupons: CouponRow[];
  subscriptionPlans: CouponSubscriptionPlan[];
  scope?: string;
}

export function GlobalDiscountClient({
  initialCoupons,
  subscriptionPlans,
  scope = "core",
}: GlobalDiscountClientProps) {
  return (
    <AdminCouponsTab
      variant="global"
      initialCoupons={initialCoupons}
      subscriptionPlans={subscriptionPlans}
      franchiseScope={scope}
    />
  );
}
