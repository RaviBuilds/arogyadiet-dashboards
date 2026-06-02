import { createClient } from "@/lib/supabase/server";
import { fetchCatalogProducts } from "@/lib/products/catalog-queries";
import { Product } from "@/types/product";
import ProductCard from "@/shared/components/customer/product-card";
import { CartStockSync } from "@/shared/components/customer/cart-stock-sync";

export default async function ShopPage() {
  const supabase = await createClient();

  const { data, error } = await fetchCatalogProducts(supabase);

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
    <main className="p-6 lg:p-8">
      <CartStockSync products={products} />
      <header className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight text-zinc-900">
          ArogyaDiet Shop
        </h1>
        <p className="mt-2 text-sm text-zinc-500">
          Discover clean, nourishing essentials curated for your wellness
          journey.
        </p>
      </header>

      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {products.map((product) => (
          <ProductCard key={product.id} product={product} />
        ))}
      </div>
    </main>
  );
}
