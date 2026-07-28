// src/app/admin/(main)/customers/shop-orders/page.tsx
//
// Feature: admin-place-shop-order-for-customer — the "All Shop Orders" ledger.
//
// One place to see every shop-product order, whichever way it was created:
//   - placed by the customer themselves from the customer dashboard shop,
//   - placed by an admin on a subscriber's behalf (assisted order),
//   - sold across the counter to a walk-in buyer with no subscription.
//
// All three live in `public.addon_orders`, so this page is the single accountable
// record of stock leaving the shop. Unlike the compact Operations tab (which only
// surfaces orders that still need attention), this view intentionally shows the
// full history so it can be searched and exported.
//
// The page is an RSC shell: it guards the "customers" admin operations group,
// reads with the service-role client, and hands plain data to a client table.

import { ShoppingBag } from "lucide-react";

import { AdminPageHeader } from "@/shared/components/admin/core/AdminPageHeader";
import { guardAdminGroup } from "@/lib/auth/adminAccess";
import { createAdminClient } from "@/lib/supabase/admin";
import { Button } from "@/shared/components/ui/button";
import Link from "next/link";
import AllShopOrdersView from "@/shared/components/admin/customers/AllShopOrdersView";
import type { ShopOrderAdminData } from "@/shared/components/admin/customers/CustomerDashboard";

export const revalidate = 0;

/**
 * Most recent orders fetched. Kept bounded so the page stays fast as history
 * grows; the newest orders are the ones operators act on, and the export covers
 * whatever is loaded.
 */
const MAX_ORDERS = 1000;

/* eslint-disable @typescript-eslint/no-explicit-any */

export default async function AdminAllShopOrdersPage() {
  await guardAdminGroup("customers");

  const supabaseAdmin = createAdminClient();

  const { data: rawOrders } = await supabaseAdmin
    .from("addon_orders")
    .select(
      `
      id,
      created_at,
      total_amount,
      status,
      target_delivery_date,
      delivery_order_id,
      delivered_at,
      fulfillment_status,
      customer_profile_id,
      franchise_id,
      placed_by_user_id,
      walkin_name,
      walkin_mobile,
      walkin_address,
      delivery_orders (delivery_date),
      addon_order_items (
        quantity,
        unit_price,
        products (name)
      ),
      customer_profiles (
        users!customer_profiles_user_id_fkey (full_name, mobile)
      )
    `,
    )
    .order("created_at", { ascending: false })
    .limit(MAX_ORDERS);

  const orderRows = rawOrders ?? [];

  // Resolve the operator names in one follow-up query rather than an embedded
  // join: `addon_orders` reaches `users` through two different paths
  // (customer_profiles and placed_by_user_id), so a second read keeps the
  // relationship unambiguous.
  const operatorIds = Array.from(
    new Set(
      orderRows
        .map((o: any) => o.placed_by_user_id as string | null)
        .filter((id): id is string => Boolean(id)),
    ),
  );

  const operatorNames = new Map<string, string>();
  if (operatorIds.length > 0) {
    const { data: operators } = await supabaseAdmin
      .from("users")
      .select("id, full_name")
      .in("id", operatorIds);
    for (const op of operators ?? []) {
      if (op?.id) operatorNames.set(op.id as string, (op.full_name as string) ?? "");
    }
  }

  const shopOrders: ShopOrderAdminData[] = orderRows.map((o: any) => {
    const profile = Array.isArray(o.customer_profiles)
      ? o.customer_profiles[0]
      : o.customer_profiles;
    const user = Array.isArray(profile?.users) ? profile?.users[0] : profile?.users;
    const delivery = Array.isArray(o.delivery_orders)
      ? o.delivery_orders[0]
      : o.delivery_orders;
    const items = (Array.isArray(o.addon_order_items) ? o.addon_order_items : [])
      .filter(Boolean)
      .map((item: any) => ({
        product_name: item?.products?.name ?? "Product",
        quantity: item?.quantity ?? 1,
        unit_price: item?.unit_price ?? 0,
      }));

    const placedByUserId = (o.placed_by_user_id as string) ?? null;

    return {
      id: o.id as string,
      created_at: o.created_at as string,
      customer_profile_id: (o.customer_profile_id as string) ?? null,
      // A walk-in sale has no profile, so its buyer name lives on the order row.
      customer_name:
        (user?.full_name as string) || (o.walkin_name as string) || "N/A",
      customer_mobile:
        (user?.mobile as string) || (o.walkin_mobile as string) || null,
      walkin_name: (o.walkin_name as string) ?? null,
      walkin_mobile: (o.walkin_mobile as string) ?? null,
      walkin_address: (o.walkin_address as string) ?? null,
      placed_by_user_id: placedByUserId,
      placed_by_name: placedByUserId
        ? operatorNames.get(placedByUserId) || null
        : null,
      total_amount: o.total_amount as number | null,
      status: o.status as string | null,
      target_delivery_date: o.target_delivery_date as string | null,
      delivery_order_id: (o.delivery_order_id as string) ?? null,
      scheduled_delivery_date: (delivery?.delivery_date as string) ?? null,
      delivered_at: (o.delivered_at as string) ?? null,
      fulfillment_status: (o.fulfillment_status as string) ?? null,
      items,
    } as ShopOrderAdminData;
  });

  return (
    <div className="flex flex-col gap-6 pb-4">
      <AdminPageHeader
        title="All Shop Orders"
        description="Every shop-product order in one ledger — bought by customers themselves, placed by an admin for a subscriber, or sold across the counter to a walk-in buyer."
        action={
          <Button asChild variant="outline" data-variant="outline">
            <Link href="/customers/assisted-order">
              <ShoppingBag /> Place an order
            </Link>
          </Button>
        }
      />
      <AllShopOrdersView shopOrders={shopOrders} loadedLimit={MAX_ORDERS} />
    </div>
  );
}
