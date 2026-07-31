// src/app/admin/(main)/customers/shop-orders/page.tsx
//
// Feature: admin-place-shop-order-for-customer — the "All Shop Orders" ledger.
// Extended by clinic-scoped-shop-inventory (Task 10.3, Requirement 12) to
// scope this ledger by Order_Clinic_Stamp:
//
//   - A Clinic_Scoped_Admin sees ONLY their stamped orders, with NO clinic
//     selector rendered at all (Req 12.1, 12.4).
//   - An Unscoped_Operations_Admin gets a Core_Clinic selector (Req 12.2): no
//     selection shows every clinic's orders (Req 12.3); selecting a specific
//     clinic filters to it; selecting "Unassigned" shows only orders whose
//     Order_Clinic_Stamp is unset (Req 12.6).
//   - The clinic filter is a URL search param (`?clinic=`, the same
//     `CLINIC_SELECTOR_PARAM` convention `ClinicSelector` uses across its
//     three reuse sites), resolved and applied SERVER-SIDE in the Supabase
//     query itself — never fetched unfiltered and sliced on the client, so a
//     Clinic_Scoped_Admin's browser never even receives another clinic's
//     order rows.
//   - `checkClinicScope` (the design's single chokepoint) is the exact
//     mechanism enforcing Req 12.9: a Clinic_Scoped_Admin's request naming a
//     different clinic (or the "Unassigned" sentinel, which is not their own
//     clinic) is REJECTED server-side with the scope-miss message, not
//     silently overridden to their own clinic.
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

import { AlertCircle, ShoppingBag } from "lucide-react";

import { AdminPageHeader } from "@/shared/components/admin/core/AdminPageHeader";
import { checkClinicScope, getCurrentAdminContext, guardAdminGroup } from "@/lib/auth/adminAccess";
import { createAdminClient } from "@/lib/supabase/admin";
import { Button } from "@/shared/components/ui/button";
import Link from "next/link";
import AllShopOrdersView from "@/shared/components/admin/customers/AllShopOrdersView";
import type { ShopOrderAdminData } from "@/shared/components/admin/customers/CustomerDashboard";
import {
  ClinicSelector,
  CLINIC_SELECTOR_PARAM,
  UNASSIGNED_CLINIC_VALUE,
  type ClinicSelectorOption,
} from "@/shared/components/admin/ClinicSelector";
import { ALL_CLINICS } from "@/lib/clinic/visibility";
import { Alert, AlertDescription } from "@/shared/components/ui/alert";

export const revalidate = 0;

/**
 * Most recent orders fetched. Kept bounded so the page stays fast as history
 * grows; the newest orders are the ones operators act on, and the export covers
 * whatever is loaded.
 */
const MAX_ORDERS = 1000;

/* eslint-disable @typescript-eslint/no-explicit-any */

interface AdminAllShopOrdersPageProps {
  // Next.js 16: `searchParams` is a Promise and must be awaited.
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

export default async function AdminAllShopOrdersPage({
  searchParams,
}: AdminAllShopOrdersPageProps) {
  await guardAdminGroup("customers");

  const { clinicId: assignedClinicId } = await getCurrentAdminContext();

  const resolvedParams = await searchParams;
  const rawClinicParam = resolvedParams[CLINIC_SELECTOR_PARAM];
  const requestedClinicParam = Array.isArray(rawClinicParam)
    ? rawClinicParam[0]
    : rawClinicParam;
  // "" (a cleared/empty param) and the explicit "all" sentinel both mean "no
  // clinic filter" (Req 12.3) — normalize both to `null` up front.
  const requestedClinicId =
    !requestedClinicParam || requestedClinicParam === ALL_CLINICS
      ? null
      : requestedClinicParam;

  // Resolved once below into exactly one of three filter modes. `pageError`
  // short-circuits every mode: on a scope rejection (Req 12.9) or a load
  // failure (Req 12.8) the page renders the message and no Shop_Order rows.
  type ClinicFilterMode =
    | { kind: "clinic"; clinicId: string }
    | { kind: "unassigned" }
    | { kind: "all" };

  let filterMode: ClinicFilterMode = { kind: "all" };
  let pageError: string | null = null;

  if (assignedClinicId) {
    // Req 12.4: no selector at all for a Clinic_Scoped_Admin. Any request
    // naming a different clinic — including the "Unassigned" sentinel, which
    // is not this admin's own clinic — is rejected server-side (Req 12.9)
    // rather than silently coerced to their own clinic.
    if (requestedClinicId !== null && requestedClinicId !== assignedClinicId) {
      const gate = await checkClinicScope(requestedClinicId);
      if (!gate.ok) {
        pageError = gate.error;
      }
    }
    if (!pageError) {
      filterMode = { kind: "clinic", clinicId: assignedClinicId };
    }
  } else if (requestedClinicId === UNASSIGNED_CLINIC_VALUE) {
    // Req 12.6: the "Unassigned" grouping is a display concern only
    // available to an Unscoped_Operations_Admin, not a clinic-scope check —
    // `checkClinicScope` never evaluates this sentinel.
    filterMode = { kind: "unassigned" };
  } else if (requestedClinicId !== null) {
    // Unscoped: `checkClinicScope` passes any request through unchanged
    // (Req 12.2). A request naming a clinic that no longer exists simply
    // yields zero matching rows, which resolves to the ordinary empty-state
    // (Req 12.7) rather than a distinct error.
    const gate = await checkClinicScope(requestedClinicId);
    if (!gate.ok) {
      pageError = gate.error;
    } else if (gate.clinicId) {
      filterMode = { kind: "clinic", clinicId: gate.clinicId };
    }
  }
  // else: requestedClinicId === null && unscoped -> filterMode stays "all" (Req 12.3).

  const supabaseAdmin = createAdminClient();

  // Selector options for an Unscoped_Operations_Admin only (Req 12.2, 12.4).
  let clinicOptions: ClinicSelectorOption[] = [];
  if (!assignedClinicId) {
    const { data: clinicRows, error: clinicsError } = await supabaseAdmin
      .from("clinics")
      .select("id, name")
      .is("franchise_id", null)
      .order("name", { ascending: true });
    if (!clinicsError) {
      clinicOptions = (clinicRows ?? []).map((c) => ({ id: c.id, name: c.name }));
    }
  }

  let orderRows: any[] = [];

  if (!pageError) {
    let query = supabaseAdmin
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
        ),
        clinics (name)
      `,
      )
      .order("created_at", { ascending: false })
      .limit(MAX_ORDERS);

    if (filterMode.kind === "clinic") {
      query = query.eq("clinic_id", filterMode.clinicId);
    } else if (filterMode.kind === "unassigned") {
      query = query.is("clinic_id", null);
    }
    // filterMode.kind === "all": no additional filter (Req 12.3).

    const { data: rawOrders, error: ordersError } = await query;

    if (ordersError) {
      // Req 12.8: the shop orders could not be loaded.
      pageError = "The shop orders could not be loaded.";
    } else {
      orderRows = rawOrders ?? [];
    }
  }

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
    const clinic = Array.isArray(o.clinics) ? o.clinics[0] : o.clinics;
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
      clinic_name: (clinic?.name as string) ?? null,
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

      {/* Req 12.4: no selector at all for a Clinic_Scoped_Admin. */}
      {!assignedClinicId ? (
        <ClinicSelector
          clinics={clinicOptions}
          includeAllOption
          includeUnassignedOption
          label="Filter by clinic"
        />
      ) : null}

      {pageError ? (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{pageError}</AlertDescription>
        </Alert>
      ) : (
        <AllShopOrdersView shopOrders={shopOrders} loadedLimit={MAX_ORDERS} />
      )}
    </div>
  );
}
