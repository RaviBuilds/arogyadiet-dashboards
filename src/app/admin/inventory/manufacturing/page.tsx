import { AdminPageHeader } from "@/shared/components/admin/core/AdminPageHeader";
import ManufacturingHubClient from "@/shared/components/admin/inventory/ManufacturingHubClient";
import {
  getActiveRawMaterialLots,
  getFinishedGoodProducts,
  getPendingManufacturingOrders,
} from "@/services/inventoryEngine";

export const revalidate = 0;

export default async function ManufacturingHubPage() {
  const [activeLots, pendingOrders, finishedGoods] = await Promise.all([
    getActiveRawMaterialLots(),
    getPendingManufacturingOrders(),
    getFinishedGoodProducts(),
  ]);

  return (
    <div className="space-y-6 p-6">
      <AdminPageHeader
        title="Manufacturing Hub"
        description="Send raw material lots to processing and track pending work-in-progress orders."
      />
      <ManufacturingHubClient
        activeLots={activeLots}
        pendingOrders={pendingOrders}
        finishedGoods={finishedGoods}
      />
    </div>
  );
}
