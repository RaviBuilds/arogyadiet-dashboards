import { cookies } from "next/headers";
import Link from "next/link";
import { TruckIcon, BookOpen } from "lucide-react";

import {
  getFranchiseInventoryCatalog,
  getIncomingTransfers,
} from "@/services/franchiseInventoryEngine";
import type { Scope } from "@/types/franchise";
import type { FranchiseCatalogProduct } from "@/types/franchiseInventory";
import type { InventoryCatalogProduct } from "@/lib/inventory/product-schema";
import { Button } from "@/shared/components/ui/button";
import InventoryDashboard from "@/shared/components/admin/inventory/InventoryDashboard";
import IncomingTransfersPanel from "./_components/IncomingTransfersPanel";
import FranchiseOperationsCart from "./_components/FranchiseOperationsCart";

export const revalidate = 0;

/**
 * Maps a FranchiseCatalogProduct (from the franchise inventory service) into
 * the InventoryCatalogProduct shape expected by the shared InventoryDashboard
 * and ProductCard components so the franchise inventory looks identical to the
 * central kitchen warehouse.
 */
function toInventoryCatalogProduct(
  product: FranchiseCatalogProduct,
): InventoryCatalogProduct {
  return {
    id: product.productId,
    name: product.name,
    imageUrl: product.imageUrl,
    category: product.category,
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

  const products = catalog.map(toInventoryCatalogProduct);

  return (
    <div className="space-y-8">
      {/* Audit Ledger CTA */}
      <div className="flex justify-end">
        <Button asChild variant="outline">
          <Link href="/inventory/ledger">
            <BookOpen className="mr-2 h-4 w-4" />
            Audit Ledger
          </Link>
        </Button>
      </div>

      {/* Reuse the shared warehouse dashboard UI (image cards, category
          grouping, batch popover) in franchise mode — single Dispatch button. */}
      <InventoryDashboard
        initialProducts={products}
        productManagement={false}
        stockOperations={false}
        franchiseMode
      />

      {/* Incoming transfers from the central kitchen (accept / receive). */}
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

      {/* Floating outbound staging cart + batch processor. */}
      <FranchiseOperationsCart />
    </div>
  );
}
