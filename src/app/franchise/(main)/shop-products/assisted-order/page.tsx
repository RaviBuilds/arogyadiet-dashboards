import { cookies } from "next/headers";
import { ClipboardList } from "lucide-react";

import { createAdminClient } from "@/lib/supabase/admin";
import { fetchShopProductsForCustomer } from "@/lib/products/catalog-queries";
import { PageHeader } from "@/shared/components/franchise/ui/PageHeader";
import AssistedOrderBuilder, {
  type AssistedOrderProduct,
} from "@/shared/components/shop/AssistedOrderBuilder";
import {
  searchCustomersAction,
  checkEligibilityAction,
  priceCartAction,
  markPaidAndPlaceOrderAction,
} from "@/actions/franchise-actions/franchiseAssistedOrderActions";

// Feature: admin-place-shop-order-for-customer — franchise portal wiring (task 9.3).
//
// Server Component that resolves the franchise context (from the verified
// `x-franchise-id` cookie set for the franchise portal), fetches the
// franchise-scoped shop catalog using the SAME query the customer dashboard shop
// checkout uses (`fetchShopProductsForCustomer`) so only the franchise's visible,
// in-stock products appear (Req 1.7, 1.8), and renders the shared
// `AssistedOrderBuilder` bound to the franchise action wrapper (Req 7.1).
//
// The four franchise server actions are passed straight to the client component
// (Next.js supports passing server actions to client components); each wrapper
// re-resolves and enforces the operator's franchise scope server-side, so the
// client never supplies role, franchise, or scope.

export const revalidate = 0;

export default async function FranchiseAssistedOrderPage() {
  const cookieStore = await cookies();
  const franchiseId = cookieStore.get("x-franchise-id")?.value ?? "";

  if (!franchiseId) {
    return (
      <div className="text-center py-12 text-slate-500">
        <p>Unable to determine franchise. Please contact support.</p>
      </div>
    );
  }

  const supabase = createAdminClient();

  // Franchise-scoped catalog (identical to the customer shop checkout for this
  // franchise context) and the franchise name for the scope label.
  const [{ data: rawProducts }, { data: franchise }] = await Promise.all([
    fetchShopProductsForCustomer(supabase, franchiseId),
    supabase.from("franchises").select("name").eq("id", franchiseId).single(),
  ]);

  const products: AssistedOrderProduct[] = (rawProducts ?? []).map((p) => ({
    id: p.id,
    name: p.name,
    sku: p.sku ?? null,
    category: p.category ?? null,
    originalPrice: Number(p.original_price ?? 0),
    salePrice:
      p.sale_price === null || p.sale_price === undefined
        ? null
        : Number(p.sale_price),
    taxPercent:
      p.tax_percent === null || p.tax_percent === undefined
        ? null
        : Number(p.tax_percent),
    imageUrl:
      (Array.isArray(p.image_urls) ? p.image_urls[0] : null) ??
      p.banner_image_url ??
      null,
  }));

  return (
    <div className="flex flex-col gap-8 animate-in fade-in duration-500">
      <PageHeader
        title="Place Assisted Order"
        subtitle="Build a shop-product order and place it on behalf of one of your customers. The order rides along with the customer's next delivery."
        icon={ClipboardList}
      />
      <AssistedOrderBuilder
        products={products}
        actions={{
          searchCustomersAction,
          checkEligibilityAction,
          priceCartAction,
          markPaidAndPlaceOrderAction,
        }}
        scopeLabel={franchise?.name ?? "franchise"}
      />
    </div>
  );
}
