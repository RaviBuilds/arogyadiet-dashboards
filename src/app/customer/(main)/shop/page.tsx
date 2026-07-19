import { getCustomerSession } from "@/lib/customer/get-session";
import {
  fetchCatalogProducts,
  fetchShopProductsForCustomer,
} from "@/lib/products/catalog-queries";
import { Product } from "@/types/product";
import ProductCard from "@/shared/components/customer/product-card";
import { CartStockSync } from "@/shared/components/customer/cart-stock-sync";
import { ShopHero } from "@/shared/components/customer/shop/ShopHero";
import {
  Card,
  CardContent,
} from "@/shared/components/ui/card";
import { Package } from "lucide-react";

export default async function ShopPage() {
  const { supabase, customerProfileId } = await getCustomerSession();

  // Resolve the customer's franchise (null = core customer) so the shop only
  // shows products their franchise has made available + in stock.
  let franchiseId: string | null = null;
  if (customerProfileId) {
    const { data: profile } = await supabase
      .from("customer_profiles")
      .select("franchise_id")
      .eq("id", customerProfileId)
      .maybeSingle();
    franchiseId = profile?.franchise_id ?? null;
  }

  const { data, error } = franchiseId
    ? await fetchShopProductsForCustomer(supabase, franchiseId)
    : await fetchCatalogProducts(supabase);

  if (error) {
    console.error(
      "Failed to fetch products:",
      error.message,
      error.code,
      error.details,
    );
  }

  const products: Product[] = data ?? [];

  return (
    <div className="relative z-10 mx-auto max-w-5xl space-y-6 sm:space-y-8">
      <CartStockSync products={products} />

      <ShopHero productCount={products.length} />

      {products.length === 0 ? (
        <Card
          className="reveal-rise rounded-3xl border border-dashed border-emerald-900/15 bg-white text-center shadow-sm"
          style={{ ["--reveal-delay" as string]: "300ms" }}
        >
          <CardContent className="flex flex-col items-center space-y-4 py-16">
            <div className="mb-1 flex h-16 w-16 items-center justify-center rounded-full bg-emerald-50">
              <Package className="h-8 w-8 text-emerald-400" />
            </div>
            <h2 className="text-lg font-semibold tracking-tight text-slate-900">
              No products available right now
            </h2>
            <p className="max-w-md text-sm text-slate-500">
              Check back soon for new wellness essentials curated for your
              journey.
            </p>
          </CardContent>
        </Card>
      ) : (
        // auto-fill (not auto-fit / fixed column counts) keeps each card at
        // its natural width. A handful of products stay compact and
        // left-aligned instead of stretching to fill empty columns, so the
        // grid never looks abandoned regardless of catalog size.
        <div
          className="reveal-rise grid grid-cols-2 gap-4 sm:[grid-template-columns:repeat(auto-fill,minmax(220px,240px))] sm:gap-5"
          style={{ ["--reveal-delay" as string]: "300ms" }}
        >
          {products.map((product) => (
            <ProductCard key={product.id} product={product} />
          ))}
        </div>
      )}
    </div>
  );
}
