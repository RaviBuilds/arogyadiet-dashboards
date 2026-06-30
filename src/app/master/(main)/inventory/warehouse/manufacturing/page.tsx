import ManufacturingHubClient from "@/shared/components/admin/inventory/ManufacturingHubClient";
import type { FinishedGoodOption } from "@/lib/inventory/product-schema";
import {
  getActiveRawMaterialLots,
  getFinishedGoodProducts,
  getFinishedGoodsForRawProduct,
  getManufacturingMappings,
  getPendingManufacturingBatches,
  getPendingManufacturingOrders,
} from "@/services/inventoryEngine";

export const revalidate = 0;

export default async function MasterManufacturingHubPage() {
  const [activeLots, pendingOrders, allFinishedGoods, mappings, pendingBatches] =
    await Promise.all([
      getActiveRawMaterialLots(),
      getPendingManufacturingOrders(),
      getFinishedGoodProducts(),
      getManufacturingMappings(),
      getPendingManufacturingBatches(),
    ]);

  // For each pending order, get the mapped finished goods for its raw product
  const mappedFinishedGoodsMap: Record<string, FinishedGoodOption[]> = {};
  const uniqueRawProductIds = [
    ...new Set(pendingOrders.map((o) => o.rawProductId)),
  ];

  await Promise.all(
    uniqueRawProductIds.map(async (rawProductId) => {
      const mapped = await getFinishedGoodsForRawProduct(rawProductId);
      mappedFinishedGoodsMap[rawProductId] = mapped;
    }),
  );

  return (
    <div className="space-y-6 p-6">
      <ManufacturingHubClient
        activeLots={activeLots}
        pendingOrders={pendingOrders}
        finishedGoods={allFinishedGoods}
        mappedFinishedGoodsMap={mappedFinishedGoodsMap}
        mappings={mappings}
        pendingBatches={pendingBatches}
      />
    </div>
  );
}
