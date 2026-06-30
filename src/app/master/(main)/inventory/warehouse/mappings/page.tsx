import ProductMappingClient from "@/shared/components/admin/inventory/ProductMappingClient";
import {
  getFinishedGoodProducts,
  getManufacturingMappings,
  getRawMaterialProducts,
} from "@/services/inventoryEngine";

export const revalidate = 0;

export default async function MasterProductMappingPage() {
  const [mappings, rawProducts, finishedProducts] = await Promise.all([
    getManufacturingMappings(),
    getRawMaterialProducts(),
    getFinishedGoodProducts(),
  ]);

  return (
    <div className="space-y-6 p-6">
      <ProductMappingClient
        mappings={mappings}
        rawProducts={rawProducts}
        finishedProducts={finishedProducts}
      />
    </div>
  );
}
