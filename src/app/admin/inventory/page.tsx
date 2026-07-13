import InventoryDashboard from "@/shared/components/admin/inventory/InventoryDashboard";
import InventoryMetrics from "@/shared/components/admin/inventory/InventoryMetrics";
import {
  getInventoryMasterCatalog,
  getInventoryMetrics,
  listCoreClinicsForDispatch,
} from "@/services/inventoryEngine";
import { listActiveFranchiseDestinations } from "@/services/franchiseInventoryEngine";

export const revalidate = 0;

export default async function WarehouseInventoryPage() {
  const [initialProducts, metricsData, franchiseDestinations, coreClinicDestinations] =
    await Promise.all([
      getInventoryMasterCatalog(),
      getInventoryMetrics(),
      listActiveFranchiseDestinations(),
      listCoreClinicsForDispatch(),
    ]);

  return (
    <div className="space-y-6 bg-zinc-100 p-6">
      <InventoryMetrics data={metricsData} products={initialProducts} />
      <InventoryDashboard
        initialProducts={initialProducts}
        franchiseDestinations={franchiseDestinations}
        coreClinicDestinations={coreClinicDestinations}
      />
    </div>
  );
}
