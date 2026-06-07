"use client";

import {
  type ActiveRawMaterialLot,
  type FinishedGoodOption,
  type ManufacturingOrder,
} from "@/lib/inventory/product-schema";
import PendingOrdersPanel from "@/shared/components/admin/inventory/PendingOrdersPanel";
import SendToProcessingPanel from "@/shared/components/admin/inventory/SendToProcessingPanel";

interface ManufacturingHubClientProps {
  activeLots: ActiveRawMaterialLot[];
  pendingOrders: ManufacturingOrder[];
  finishedGoods: FinishedGoodOption[];
}

export default function ManufacturingHubClient({
  activeLots,
  pendingOrders,
  finishedGoods,
}: ManufacturingHubClientProps) {
  return (
    <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
      <SendToProcessingPanel activeLots={activeLots} />
      <PendingOrdersPanel
        pendingOrders={pendingOrders}
        finishedGoods={finishedGoods}
      />
    </div>
  );
}
