import { cookies } from "next/headers";
import { Package, TruckIcon } from "lucide-react";

import {
  getFranchiseInventoryCatalog,
  getIncomingTransfers,
} from "@/services/franchiseInventoryEngine";
import type { Scope } from "@/types/franchise";
import type { FranchiseCatalogProduct } from "@/types/franchiseInventory";
import type { InventoryCatalogProduct } from "@/lib/inventory/product-schema";
import ProductCard from "@/shared/components/admin/inventory/ProductCard";
import IncomingTransfersPanel from "./_components/IncomingTransfersPanel";

export const revalidate = 0;

/**
 * Maps a FranchiseCatalogProduct (from the franchise inventory service) into
 * the InventoryCatalogProduct shape expected by the shared ProductCard component.
 */
function toInventoryCatalogProduct(
  product: FranchiseCatalogProduct,
): InventoryCatalogProduct {
  return {
    id: product.productId,
    name: product.name,
    imageUrl: product.imageUrl,
    category: "Finished Good",
    type: "FINISHED_GOOD",
    baseUom: product.baseUom,
    minStockThreshold: 0,
    defaultDurabilityDays: 0,
    createdAt: "",
    updatedAt: "",
    totalStock: product.onHandQuantity,
    activeLots: product.batches.map((batch) => ({
      batchNumber: batch.batchNumber,
      quantityRemaining: batch.quantity,
      expiryDate: batch.expiryDate ? new Date(batch.expiryDate) : null,
    })),
  };
}

export default async function FranchiseInventoryPage() {
  const cookieStore = await cookies();
  const franchiseId = cookieStore.get("x-franchise-id")?.value ?? "";

  if (!franchiseId) {
    return (
      <div className="text-center py-12 text-slate-500">
        <p>Unable to determine franchise. Please contact support.</p>
      </div>
    );
  }

  const scope: Scope = { kind: "franchise", franchise_id: franchiseId };

  // Fetch catalog and incoming transfers in parallel
  const [catalog, incomingTransfers] = await Promise.all([
    getFranchiseInventoryCatalog(franchiseId, scope),
    getIncomingTransfers(franchiseId, scope),
  ]);

  return (
    <div className="space-y-8">
      {/* Page header */}
      <div>
        <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
          Inventory
        </h1>
        <p className="text-sm text-slate-500 mt-1">
          Product catalog and stock for your franchise.
        </p>
      </div>

      {/* Product catalog section */}
      {catalog.length === 0 ? (
        <div className="flex min-h-[300px] flex-col items-center justify-center rounded-lg border border-dashed bg-muted/30 p-8 text-center">
          <Package className="size-12 text-muted-foreground/50 mb-4" />
          <p className="text-lg font-medium text-slate-700">
            No products in inventory
          </p>
          <p className="mt-2 text-sm text-muted-foreground max-w-md">
            Your franchise inventory is empty. Products will appear here once stock
            is transferred from the central kitchen and received.
          </p>
        </div>
      ) : (
        <div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {catalog.map((product) => (
              <div key={product.productId} className="relative">
                {product.onHandQuantity === 0 && (
                  <div className="absolute top-2 left-2 z-10">
                    <span className="inline-flex items-center rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-semibold text-red-800">
                      Out of Stock
                    </span>
                  </div>
                )}
                <ProductCard
                  product={toInventoryCatalogProduct(product)}
                  productManagement={false}
                />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Incoming transfers section */}
      {incomingTransfers.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <TruckIcon className="size-5 text-slate-600" />
            <h2 className="text-lg font-semibold text-slate-800">
              Incoming Transfers
            </h2>
            <span className="ml-auto inline-flex items-center rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-medium text-blue-800">
              {incomingTransfers.length}
            </span>
          </div>
          <IncomingTransfersPanel transfers={incomingTransfers} />
        </div>
      )}
    </div>
  );
}
