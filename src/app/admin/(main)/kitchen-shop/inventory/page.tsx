import { adminGetProducts } from "@/actions/admin-actions/inventoryActions";
import InventoryPageClient from "@/shared/components/admin/inventory/InventoryPageClient";

export const revalidate = 0;

export default async function InventoryPage() {
  const products = await adminGetProducts();

  return <InventoryPageClient products={products} />;
}
