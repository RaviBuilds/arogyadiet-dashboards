import { adminGetProducts } from "@/actions/admin-actions/inventoryActions";
import InventoryPageClient from "@/shared/components/admin/product-inventory/InventoryPageClient";

export const revalidate = 0;

export default async function ShopProductsPage() {
  const products = await adminGetProducts();

  return (
    <div className="bg-zinc-100">
      <InventoryPageClient
        products={products}
        accessMode="full-access"
        pageTitle="Shop Products"
        pageDescription="Manage shop product catalog, stock levels, and availability."
      />
    </div>
  );
}
