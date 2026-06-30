"use client";

import {
  AdminCouponsTab,
  type CouponRow,
  type CouponSubscriptionPlan,
} from "@/shared/components/admin/customers/AdminCouponsTab";
import {
  franchiseCreateGlobalCoupon,
  franchiseDeleteGlobalCoupon,
  franchiseListGlobalCoupons,
} from "@/actions/franchise-actions/franchiseMarketingActions";

interface FranchiseGlobalDiscountProps {
  initialCoupons: CouponRow[];
  subscriptionPlans: CouponSubscriptionPlan[];
}

/**
 * Global discount manager for a franchise. Reuses the shared AdminCouponsTab
 * "global" variant but wires it to franchise-scoped actions that resolve the
 * franchise from the session (the client cannot target another franchise).
 */
export default function FranchiseGlobalDiscount({
  initialCoupons,
  subscriptionPlans,
}: FranchiseGlobalDiscountProps) {
  return (
    <AdminCouponsTab
      variant="global"
      initialCoupons={initialCoupons}
      subscriptionPlans={subscriptionPlans}
      listGlobalCouponsAction={franchiseListGlobalCoupons as never}
      createGlobalCouponAction={franchiseCreateGlobalCoupon as never}
      deleteGlobalCouponAction={franchiseDeleteGlobalCoupon}
    />
  );
}
