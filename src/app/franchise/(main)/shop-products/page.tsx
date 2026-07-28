import { cookies } from "next/headers";
import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/admin";
import { ShoppingBag, ClipboardList } from "lucide-react";
import { PageHeader } from "@/shared/components/franchise/ui/PageHeader";
import { Button } from "@/shared/components/ui/button";
import { getFranchiseShopProducts } from "@/actions/admin-actions/franchiseProductActions";
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

  // Shared catalog merged with this franchise's stock + visibility overlay.
  const products = await getFranchiseShopProducts(franchiseId);

  // Fetch addon orders for this franchise's customers
  const { data: recentOrders } = await supabase
    .from("addon_orders")
    .select(`
      id, created_at, total_amount, status, target_delivery_date,
      customer_profiles!inner ( franchise_id, users!customer_profiles_user_id_fkey ( full_name ) ),
      addon_order_items ( quantity, unit_price, products ( name ) )
    `)
    .eq("customer_profiles.franchise_id", franchiseId)
    .order("created_at", { ascending: false })
    .limit(50);

  return (
    <div className="flex flex-col gap-8 animate-in fade-in duration-500">
      <PageHeader
        title="Shop Products"
        subtitle="Set your own stock and choose which products your customers can see."
        icon={ShoppingBag}
        actions={
          <Button asChild>
            <Link href="/shop-products/assisted-order">
              <ClipboardList className="h-4 w-4" />
              Place Assisted Order
            </Link>
          </Button>
        }
      />
      <FranchiseShopProductsClient
        products={products}
        recentOrders={(recentOrders ?? []) as any[]}
      />
    </div>
  );
}
