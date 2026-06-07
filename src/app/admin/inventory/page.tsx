import InventoryDashboard from "@/shared/components/admin/inventory/InventoryDashboard";
import InventoryMetrics from "@/shared/components/admin/inventory/InventoryMetrics";
import {
  getInventoryMasterCatalog,
  getInventoryMetrics,
} from "@/services/inventoryEngine";

export const revalidate = 0;

export default async function WarehouseInventoryPage() {
  const [initialProducts, metricsData] = await Promise.all([
    getInventoryMasterCatalog(),
    getInventoryMetrics(),
  ]);

  return (
    <div className="space-y-6 bg-zinc-100 p-6">
      <InventoryMetrics data={metricsData} />
      <InventoryDashboard initialProducts={initialProducts} />
    </div>
  );
}
