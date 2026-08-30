import Link from "next/link";
import { AlertCircle, ClipboardList, ShoppingBag } from "lucide-react";

import { createAdminClient } from "@/lib/supabase/admin";
import { guardFranchiseGroupAccess } from "@/lib/auth/adminAccess";
import { PageHeader } from "@/shared/components/franchise/ui/PageHeader";
import { Button } from "@/shared/components/ui/button";
import { Alert, AlertDescription } from "@/shared/components/ui/alert";
import AllShopOrdersView from "@/shared/components/admin/customers/AllShopOrdersView";
import type { ShopOrderAdminData } from "@/shared/components/admin/customers/CustomerDashboard";
import {
  franchiseUpdateAddonOrderDeliveryDate,
  franchiseMarkAddonOrderDeliveredOffline,
} from "@/actions/franchise-actions/franchiseShopOrderActions";

export const revalidate = 0;

/**
 * The franchise Shop_Orders ledger — every shop-product order belonging to this
 * franchise in one place: bought by the customer themselves, placed by a
 * franchise operator for a subscriber, or sold across the counter to a walk-in.
 *
 * Mirrors `/admin/customers/shop-orders`, with two deliberate differences:
 *
 *   1. TENANCY IS `addon_orders.franchise_id`. The franchise shop-products page
 *      has an inline "Recent Orders" tab that filters through
 *      `customer_profiles.franchise_id` with an inner join — which silently DROPS
 *      every walk-in sale, because a walk-in has no customer profile at all
 *      (`customer_profile_id IS NULL`, enforced by
 *      `addon_orders_buyer_identity_check`). Filtering on the order's own tenancy
 *      stamp is what makes counter sales visible.
 *   2. NO CLINIC SELECTOR OR COLUMN. `addon_orders.clinic_id` is the Core_Clinic
 *      stamp and is NULL by design for a franchise order; a franchise owns exactly
 *      one clinic, so there is nothing to filter by and the column would be dashes.
 */
const MAX_ORDERS = 1000;

/* eslint-disable @typescript-eslint/no-explicit-any */

export default async function FranchiseShopOrdersPage() {
  // Group-gated page guard. A franchise Dietitian is redirected to their landing
  // route: shop orders are not part of the read-only Dietitian workspace. That is
  // safe here (unlike on `/customers` itself) because this route is not the
  // dietitian landing route, so there is no redirect loop.
  const { franchiseId } = await guardFranchiseGroupAccess("customers");

  const supabase = createAdminClient();

  let pageError: string | null = null;
  let orderRows: any[] = [];

  const { data: rawOrders, error: ordersError } = await supabase
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
      clinic_id,
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
    .eq("franchise_id", franchiseId)
    .order("created_at", { ascending: false })
    .limit(MAX_ORDERS);

  if (ordersError) {
    pageError = "The shop orders could not be loaded.";
  } else {
    orderRows = rawOrders ?? [];
  }

  // Operator display names, resolved in one follow-up query rather than an
  // embedded join: `addon_orders` reaches `users` two different ways
  // (through `customer_profiles`, and via `placed_by_user_id`), so a second read
  // keeps the relationship unambiguous.
  const operatorIds = Array.from(
    new Set(
      orderRows
        .map((o: any) => o.placed_by_user_id as string | null)
        .filter((operatorId): operatorId is string => Boolean(operatorId)),
    ),
  );

  const operatorNames = new Map<string, string>();
  if (operatorIds.length > 0) {
    const { data: operators } = await supabase
      .from("users")
      .select("id, full_name")
      .in("id", operatorIds);
    for (const op of operators ?? []) {
      if (op?.id) {
        operatorNames.set(op.id as string, (op.full_name as string) ?? "");
      }
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
      clinic_id: (o.clinic_id as string) ?? null,
      clinic_name: null,
    } as ShopOrderAdminData;
  });

  return (
    <div className="flex flex-col gap-6 pb-4 animate-in fade-in duration-500">
      <PageHeader
        title="Shop Orders"
        subtitle="Every shop-product order for your franchise — bought by customers themselves, placed by your team for a subscriber, or sold across the counter."
        icon={ShoppingBag}
        actions={
          <Button asChild>
            <Link href="/shop-products/assisted-order">
              <ClipboardList className="h-4 w-4" />
              Place an order
            </Link>
          </Button>
        }
      />

      {pageError ? (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{pageError}</AlertDescription>
        </Alert>
      ) : (
        <AllShopOrdersView
          shopOrders={shopOrders}
          loadedLimit={MAX_ORDERS}
          showClinicColumn={false}
          actions={{
            updateDeliveryDate: franchiseUpdateAddonOrderDeliveryDate,
            markDeliveredOffline: franchiseMarkAddonOrderDeliveredOffline,
          }}
        />
      )}
    </div>
  );
}
