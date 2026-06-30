import { adminGetProducts } from "@/actions/admin-actions/inventoryActions";
import InventoryPageClient from "@/shared/components/admin/product-inventory/InventoryPageClient";
import { guardAdminGroup } from "@/lib/auth/adminAccess";

export const revalidate = 0;

export default async function InventoryPage() {
  await guardAdminGroup("shop_products");
  const products = await adminGetProducts();

  return <InventoryPageClient products={products} />;
}
