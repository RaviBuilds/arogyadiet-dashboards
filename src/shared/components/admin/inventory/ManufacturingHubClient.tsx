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
    <div className="space-y-8">
      <section className="space-y-4">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">
            Single-Material Processing
          </h2>
          <p className="text-xs text-slate-500">
            One raw material lot converts into one or more finished products.
          </p>
        </div>
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
          <SendToProcessingPanel activeLots={activeLots} />
          <PendingOrdersPanel
            pendingOrders={pendingOrders}
            finishedGoods={finishedGoods}
            mappedFinishedGoodsMap={mappedFinishedGoodsMap}
          />
        </div>
      </section>

      {(multiRawMappings.length > 0 || pendingBatches.length > 0) && (
        <section className="space-y-4">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">
              Multi-Material Processing
            </h2>
            <p className="text-xs text-slate-500">
              Combine two or more raw materials into a single finished product
              batch.
            </p>
          </div>
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
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
        </section>
      )}
    </div>
  );
}
