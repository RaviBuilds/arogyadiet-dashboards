import { cookies } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { ShoppingBag } from "lucide-react";
import { PageHeader } from "@/shared/components/franchise/ui/PageHeader";
import FranchiseShopProductsClient from "./FranchiseShopProductsClient";

export const revalidate = 0;

export default async function FranchiseShopProductsPage() {
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

  // Fetch all active products (catalog is shared across all franchises)
  const { data: products } = await supabase
    .from("products")
    .select("id, sku, name, category, original_price, sale_price, stock_quantity, is_active, image_urls, banner_image_url")
    .is("deleted_at", null)
    .order("name", { ascending: true });

  // Fetch addon orders for this franchise's customers
  const { data: recentOrders } = await supabase
    .from("addon_orders")
    .select(`
      id, created_at, total_amount, status, target_delivery_date,
      customer_profiles!inner ( franchise_id, users ( full_name ) ),
      addon_order_items ( quantity, unit_price, products ( name ) )
    `)
    .eq("customer_profiles.franchise_id", franchiseId)
    .order("created_at", { ascending: false })
    .limit(50);

  return (
    <div className="flex flex-col gap-8 animate-in fade-in duration-500">
      <PageHeader
        title="Shop Products"
        subtitle="View product catalog and manage addon orders for your franchise customers."
        icon={ShoppingBag}
      />
      <FranchiseShopProductsClient
        products={products ?? []}
        recentOrders={(recentOrders ?? []) as any[]}
      />
    </div>
  );
}
