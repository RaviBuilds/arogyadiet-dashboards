import InventoryDashboard from "@/shared/components/admin/inventory/InventoryDashboard";
import InventoryMetrics from "@/shared/components/admin/inventory/InventoryMetrics";
import {
  getInventoryCategoryOverview,
  getInventoryMasterCatalog,
  getInventoryMetrics,
  listCoreClinicsForDispatch,
  listInventoryProductCategories,
} from "@/services/inventoryEngine";
import { listActiveFranchiseDestinations } from "@/services/franchiseInventoryEngine";

export const revalidate = 0;

export default async function MasterWarehouseCatalogPage() {
  const [
    initialProducts,
    metricsData,
    franchiseDestinations,
    coreClinicDestinations,
    categories,
    categoryOverview,
  ] = await Promise.all([
    getInventoryMasterCatalog(),
    getInventoryMetrics(),
    listActiveFranchiseDestinations(),
    listCoreClinicsForDispatch(),
    listInventoryProductCategories(),
    getInventoryCategoryOverview(),
  ]);

  return (
    <div className="space-y-6 bg-zinc-100 p-6">
      <InventoryMetrics data={metricsData} products={initialProducts} />
      <InventoryDashboard
        initialProducts={initialProducts}
        productManagement={true}
        basePath="/inventory/warehouse"
        franchiseDestinations={franchiseDestinations}
        coreClinicDestinations={coreClinicDestinations}
        categories={categories}
        categoryOverview={categoryOverview}
      />
    </div>
  );
}
