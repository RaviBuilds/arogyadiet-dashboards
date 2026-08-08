// src/app/admin/(main)/customers/assisted-order/page.tsx
//
// Feature: admin-place-shop-order-for-customer — admin portal wiring.
// Extended by clinic-scoped-shop-inventory Task 9.3 to present exactly the
// admin's Core_Clinic shop stock instead of the old shared/global catalog.
//
// RSC shell for the admin assisted-order flow. It guards the "customers" admin
// operations group (the same group the action wrapper authorizes against —
// Req 8.5), resolves the admin's fulfilling Core_Clinic (their
// Clinic_Scope_Assignment, exactly like `assistedOrderActions.ts` does for
// order placement — Task 9.2's `resolveFulfillingClinicId`), fetches that
// clinic's Shop_Product view via `getClinicShopViewAction`, filters to exactly
// the products that should be presented (Req 15.1: visible + globally active +
// stock > 0), maps the result to the shared component's product contract
// (including the new `availableStock` field), and renders the portal-agnostic
// `AssistedOrderBuilder` bound to the admin action wrapper.
//
// The builder is a client leaf; the admin server actions are injected via the
// `actions` prop (Next.js supports passing "use server" functions as props to
// client components). Every authorization/scope check is re-enforced inside
// those actions and the service, independent of this page (Req 8.7, 15.11).
//
// Judgement call (see task report): an Unscoped_Operations_Admin (no
// Clinic_Scope_Assignment) has no clinic-selector UI on this page yet — that
// belongs to whichever task adds one for this builder. Rather than showing an
// unfiltered/global product list (which would violate clinic scoping) or an
// empty list indistinguishable from a genuinely empty clinic catalog, this
// page shows a clear blocked state for that admin.
//
// Requirements: 15.1, 15.2, 15.3, 15.4, 15.5, 15.6, 15.7, 15.8

import { AlertCircle } from "lucide-react";

import { AdminPageHeader } from "@/shared/components/admin/core/AdminPageHeader";
import { guardAdminGroup } from "@/lib/auth/adminAccess";
import { getClinicShopViewAction } from "@/actions/admin-actions/clinicShopInventoryActions";
import { resolveFulfillingClinicId } from "@/actions/admin-actions/assistedOrderActions";
import { isExposedInClinicShop } from "@/lib/shop/clinicStock";
import AssistedOrderBuilder, {
  type AssistedOrderProduct,
} from "@/shared/components/shop/AssistedOrderBuilder";
import {
  searchCustomersAction,
  checkEligibilityAction,
  priceCartAction,
  markPaidAndPlaceOrderAction,
  markPaidAndPlaceWalkInOrderAction,
} from "@/actions/admin-actions/assistedOrderActions";
import { Button } from "@/shared/components/ui/button";
import { ReceiptText } from "lucide-react";
import Link from "next/link";
import type { ClinicShopProductRow } from "@/types/clinicShop";

export const revalidate = 0;

/** Map a clinic-scoped Shop_Product row to the shared component's product contract. */
function toAssistedOrderProduct(row: ClinicShopProductRow): AssistedOrderProduct {
  return {
    id: row.id,
    name: row.name,
    sku: row.sku ?? null,
    category: null,
    originalPrice: Number(row.original_price ?? 0),
    salePrice:
      row.sale_price === null || row.sale_price === undefined
        ? null
        : Number(row.sale_price),
    taxPercent: null,
    imageUrl: row.image_url,
    availableStock: row.stock_quantity,
  };
}

export default async function AdminAssistedOrderPage() {
  await guardAdminGroup("customers");

  // The SAME resolution the order-placement actions use (Task 9.2): a
  // Clinic_Scoped_Admin's Clinic_Scope_Assignment is authoritative. No
  // clinic-selection UI exists yet, so an unscoped admin resolves to no
  // clinic here and sees the blocked state below instead of an
  // unfiltered/global product list.
  const clinicResolution = await resolveFulfillingClinicId();

  const seeOrdersButton = (
    <Button asChild variant="outline" data-variant="outline">
      <Link href="/customers/shop-orders">
        <ReceiptText /> See orders
      </Link>
    </Button>
  );

  if (!clinicResolution.ok) {
    return (
      <div className="flex flex-col gap-6 pb-4">
        <AdminPageHeader
          title="Place Shop Order for Customer"
          description="Build a cart of shop products, then either pick an eligible core customer so the order rides along with their next delivery, or record a walk-in buyer for a counter sale."
          action={seeOrdersButton}
        />
        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          <AlertCircle className="mt-0.5 size-4 shrink-0" />
          <span>
            No clinic is assigned to your account, so a shop product list
            cannot be shown. Contact an administrator to assign a clinic.
          </span>
        </div>
      </div>
    );
  }

  const clinicId = clinicResolution.clinicId;
  const view = await getClinicShopViewAction(clinicId);

  let products: AssistedOrderProduct[] = [];
  let loadError: string | null = null;

  if (!view.success) {
    loadError = view.error;
  } else {
    // Req 15.1: present only products visible with stock > 0 at the admin's
    // clinic. `isExposedInClinicShop` already encodes this exact rule
    // (deleted_at null AND globally visible AND clinic-visible AND stock > 0);
    // `getClinicShopViewAction` already excludes soft-deleted products in its
    // query, so `deletedAt` is safely passed as `null` here.
    products = view.data
      .filter((row) =>
        isExposedInClinicShop({
          deletedAt: null,
          isActive: row.catalog_active,
          overlay: { stockQuantity: row.stock_quantity, isVisible: row.is_visible },
        }),
      )
      .map(toAssistedOrderProduct);
  }

  return (
    <div className="flex flex-col gap-6 pb-4">
      <AdminPageHeader
        title="Place Shop Order for Customer"
        description="Build a cart of shop products, then either pick an eligible core customer so the order rides along with their next delivery, or record a walk-in buyer for a counter sale."
        action={seeOrdersButton}
      />
      {loadError ? (
        <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          <AlertCircle className="mt-0.5 size-4 shrink-0" />
          <span>{loadError}</span>
        </div>
      ) : (
        <AssistedOrderBuilder
          products={products}
          scopeLabel="Core"
          actions={{
            searchCustomersAction,
            checkEligibilityAction,
            priceCartAction,
            markPaidAndPlaceOrderAction,
            markPaidAndPlaceWalkInOrderAction,
          }}
        />
      )}
    </div>
  );
}
