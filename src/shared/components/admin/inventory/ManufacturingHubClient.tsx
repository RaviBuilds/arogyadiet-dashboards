"use client";

import {
  type ActiveRawMaterialLot,
  type FinishedGoodOption,
  type ManufacturingBatch,
  type ManufacturingOrder,
  type ManufacturingProductMapping,
} from "@/lib/inventory/product-schema";
import MultiDispatchPanel from "@/shared/components/admin/inventory/MultiDispatchPanel";
import PendingBatchesPanel from "@/shared/components/admin/inventory/PendingBatchesPanel";
import PendingOrdersPanel from "@/shared/components/admin/inventory/PendingOrdersPanel";
import SendToProcessingPanel from "@/shared/components/admin/inventory/SendToProcessingPanel";

interface ManufacturingHubClientProps {
  activeLots: ActiveRawMaterialLot[];
  pendingOrders: ManufacturingOrder[];
  finishedGoods: FinishedGoodOption[];
  mappedFinishedGoodsMap: Record<string, FinishedGoodOption[]>;
  mappings: ManufacturingProductMapping[];
  pendingBatches: ManufacturingBatch[];
}

export default function ManufacturingHubClient({
  activeLots,
  pendingOrders,
  finishedGoods,
  mappedFinishedGoodsMap,
  mappings,
  pendingBatches,
}: ManufacturingHubClientProps) {
  // Filter mappings that have multiple raw materials (for multi-dispatch)
  const multiRawMappings = mappings.filter(
    (m) => m.rawProductIds.length > 1,
  );

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <SendToProcessingPanel activeLots={activeLots} />
        <PendingOrdersPanel
          pendingOrders={pendingOrders}
          finishedGoods={finishedGoods}
          mappedFinishedGoodsMap={mappedFinishedGoodsMap}
        />
      </div>

      {(multiRawMappings.length > 0 || pendingBatches.length > 0) && (
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          {multiRawMappings.length > 0 && (
            <MultiDispatchPanel
              mappings={multiRawMappings}
              activeLots={activeLots}
            />
          )}
          {pendingBatches.length > 0 && (
            <PendingBatchesPanel batches={pendingBatches} />
          )}
        </div>
      )}
    </div>
  );
}
