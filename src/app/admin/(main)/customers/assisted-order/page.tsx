// src/app/admin/(main)/customers/assisted-order/page.tsx
//
// Feature: admin-place-shop-order-for-customer — admin portal wiring (task 9.2).
//
// RSC shell for the admin assisted-order flow. It guards the "customers" admin
// operations group (the same group the action wrapper authorizes against —
// Req 8.5), fetches the CORE shop catalog server-side (the same catalog the
// customer checkout uses for the core, non-franchise context — reusing
// `fetchShopProductsForCustomer(supabase, null)`), maps it to the shared
// component's product contract, and renders the portal-agnostic
// `AssistedOrderBuilder` bound to the admin action wrapper.
//
// The builder is a client leaf; the four admin server actions are injected via
// the `actions` prop (Next.js supports passing "use server" functions as props
// to client components). Every authorization/scope check is re-enforced inside
// those actions and the service, independent of this page (Req 8.7).
//
// Requirements: 7.1, 8.5

import { AdminPageHeader } from "@/shared/components/admin/core/AdminPageHeader";
import { guardAdminGroup } from "@/lib/auth/adminAccess";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchShopProductsForCustomer } from "@/lib/products/catalog-queries";
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

export const revalidate = 0;

type ProductRow = {
  id: string;
  name?: string | null;
  sku?: string | null;
  category?: string | null;
  original_price?: number | null;
  sale_price?: number | null;
  tax_percent?: number | null;
  image_url?: string[] | string | null;
};

/** Resolve a single display image url from the product's `image_url` column. */
function resolveImageUrl(imageUrl: ProductRow["image_url"]): string | null {
  if (Array.isArray(imageUrl)) {
    return imageUrl[0] ?? null;
  }
  return imageUrl ?? null;
}

/** Map a catalog product row to the shared component's product contract. */
function toAssistedOrderProduct(row: ProductRow): AssistedOrderProduct {
  return {
    id: row.id,
    name: row.name ?? "Unnamed product",
    sku: row.sku ?? null,
    category: row.category ?? null,
    originalPrice: Number(row.original_price ?? 0),
    salePrice:
      row.sale_price === null || row.sale_price === undefined
        ? null
        : Number(row.sale_price),
    taxPercent:
      row.tax_percent === null || row.tax_percent === undefined
        ? null
        : Number(row.tax_percent),
    imageUrl: resolveImageUrl(row.image_url),
  };
}

export default async function AdminAssistedOrderPage() {
  await guardAdminGroup("customers");

  const supabaseAdmin = createAdminClient();

  // Admin serves only CORE (non-franchise) customers, so fetch the core catalog
  // (franchiseId = null) — the identical product set/prices the customer
  // dashboard shop checkout presents for the core context (Req 1.7).
  const { data: rawProducts } = await fetchShopProductsForCustomer(
    supabaseAdmin,
    null,
  );

  const products: AssistedOrderProduct[] = (rawProducts ?? []).map(
    (row) => toAssistedOrderProduct(row as ProductRow),
  );

  return (
    <div className="flex flex-col gap-6 pb-4">
      <AdminPageHeader
        title="Place Shop Order for Customer"
        description="Build a cart of shop products, then either pick an eligible core customer so the order rides along with their next delivery, or record a walk-in buyer for a counter sale."
        action={
          <Button asChild variant="outline" data-variant="outline">
            <Link href="/customers/shop-orders">
              <ReceiptText /> See orders
            </Link>
          </Button>
        }
      />
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
    </div>
  );
}
