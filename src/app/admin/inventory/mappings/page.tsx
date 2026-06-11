import { AdminPageHeader } from "@/shared/components/admin/core/AdminPageHeader";
import ProductMappingClient from "@/shared/components/admin/inventory/ProductMappingClient";
import {
  getFinishedGoodProducts,
  getManufacturingMappings,
  getRawMaterialProducts,
} from "@/services/inventoryEngine";

export const revalidate = 0;

export default async function ProductMappingPage() {
  const [mappings, rawProducts, finishedProducts] = await Promise.all([
    getManufacturingMappings(),
    getRawMaterialProducts(),
    getFinishedGoodProducts(),
  ]);

  return (
    <div className="space-y-6 p-6">
      <AdminPageHeader
        title="Product Mapping"
        description="Define which raw materials can be converted into which finished products during manufacturing."
      />
      <ProductMappingClient
        mappings={mappings}
        rawProducts={rawProducts}
        finishedProducts={finishedProducts}
      />
    </div>
  );
}
