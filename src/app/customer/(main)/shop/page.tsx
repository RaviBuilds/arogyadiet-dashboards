import { createClient } from "@/lib/supabase/server";
import {
  fetchCatalogProducts,
  fetchShopProductsForCustomer,
} from "@/lib/products/catalog-queries";
import { Product } from "@/types/product";
import ProductCard from "@/shared/components/customer/product-card";
import { CartStockSync } from "@/shared/components/customer/cart-stock-sync";
import {
  Card,
  CardContent,
} from "@/shared/components/ui/card";
import { Package } from "lucide-react";

export default async function ShopPage() {
  const supabase = await createClient();

  // Resolve the customer's franchise (null = core customer) so the shop only
  // shows products their franchise has made available + in stock.
  let franchiseId: string | null = null;
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    const { data: dbUser } = await supabase
      .from("users")
      .select("id")
      .eq("auth_user_id", user.id)
      .maybeSingle();

    if (dbUser) {
      const { data: profile } = await supabase
        .from("customer_profiles")
        .select("franchise_id")
        .eq("user_id", dbUser.id)
        .maybeSingle();
      franchiseId = profile?.franchise_id ?? null;
    }
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
    <div className="space-y-8">
      <CartStockSync products={products} />
      <header>
        <h1 className="text-3xl font-semibold tracking-tight text-slate-900">
          ArogyaDiet Shop
        </h1>
        <p className="mt-2 text-sm text-slate-500">
          Discover clean, nourishing essentials curated for your wellness
          journey.
        </p>
      </header>

      {products.length === 0 ? (
        <Card className="border border-dashed border-slate-200 bg-slate-50/50 shadow-none">
          <CardContent className="p-12 text-center">
            <Package className="mx-auto mb-3 h-10 w-10 text-slate-300" />
            <p className="font-medium text-slate-500">
              No products available right now.
            </p>
            <p className="mt-1 text-sm text-slate-400">
              Check back soon for new wellness essentials.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {products.map((product) => (
            <ProductCard key={product.id} product={product} />
          ))}
        </div>
      )}
    </div>
  );
}
