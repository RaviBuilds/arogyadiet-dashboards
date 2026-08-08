import { AlertCircle } from "lucide-react";

import {
  adminGetProducts,
  type AdminInventoryProduct,
} from "@/actions/admin-actions/inventoryActions";
import {
  getClinicShopViewAction,
  getDestinationOptionsAction,
} from "@/actions/admin-actions/clinicShopInventoryActions";
import {
  getFranchiseShopProducts,
  type FranchiseShopProduct,
} from "@/actions/admin-actions/franchiseProductActions";
import { resolveDestination, type KnownDestinations } from "@/lib/shop/clinicStock";
import type { ClinicShopProductRow } from "@/types/clinicShop";
import InventoryPageClient, {
  type ShopProductsMode,
} from "@/shared/components/admin/product-inventory/InventoryPageClient";
import { ShopProductsDestinationSelector } from "@/shared/components/admin/product-inventory/ShopProductsDestinationSelector";
import { Alert, AlertDescription } from "@/shared/components/ui/alert";

export const revalidate = 0;

interface MasterShopProductsPageProps {
  // Next.js 16: `searchParams` is a Promise and must be awaited.
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

/**
 * Master_Warehouse_Shop_Products_Page — the Master portal's counterpart to
 * `/admin/inventory/shop-products`. The Warehouse System nav (InventoryHeader)
 * always links to `${basePath}/shop-products`; under the Master portal that
 * resolves to `/inventory/warehouse/shop-products`, which previously had no
 * page here and 404'd. Role authorization for MASTER_ADMIN is already
 * enforced by the parent `warehouse/layout.tsx` (which redirects any non
 * MASTER_ADMIN to `/unauthorized`), so this page does not additionally call
 * `guardAdminPage` — that guard is ADMIN-portal-specific and would incorrectly
 * reject a MASTER_ADMIN session.
 */
export default async function MasterShopProductsPage({
  searchParams,
}: MasterShopProductsPageProps) {
  const resolvedParams = await searchParams;
  const rawDestinationParamValue = resolvedParams.destination;
  const rawDestinationParam = Array.isArray(rawDestinationParamValue)
    ? rawDestinationParamValue[0]
    : rawDestinationParamValue;

  const destinationOptions = await getDestinationOptionsAction();
  const known: KnownDestinations = destinationOptions.success
    ? {
        clinicIds: destinationOptions.data.clinics.map((clinic) => clinic.id),
        franchiseIds: destinationOptions.data.franchises.map(
          (franchise) => franchise.id,
        ),
      }
    : { clinicIds: [], franchiseIds: [], loadFailed: true };

  const destination = resolveDestination(rawDestinationParam, known);

  let allClinicsProducts: AdminInventoryProduct[] = [];
  let clinicProducts: ClinicShopProductRow[] = [];
  let franchiseProducts: FranchiseShopProduct[] = [];
  let destinationDataError: string | null = null;

  let mode: ShopProductsMode;

  if (destination.kind === "clinic") {
    mode = {
      kind: "clinic",
      clinicId: destination.clinicId,
      clinicName: destinationOptions.success
        ? destinationOptions.data.clinics.find(
            (clinic) => clinic.id === destination.clinicId,
          )?.name
        : undefined,
    };
    const result = await getClinicShopViewAction(destination.clinicId);
    if (result.success) {
      clinicProducts = result.data;
    } else {
      destinationDataError =
        "The destination data could not be loaded. " + result.error;
    }
  } else if (destination.kind === "franchise") {
    mode = { kind: "franchise", franchiseId: destination.franchiseId };
    try {
      franchiseProducts = await getFranchiseShopProducts(
        destination.franchiseId,
      );
    } catch {
      destinationDataError = "The franchise data could not be loaded.";
    }
  } else {
    mode = { kind: "all-clinics" };
    allClinicsProducts = await adminGetProducts();
  }

  return (
    <div className="bg-zinc-100">
      <div className="px-6 pt-6">
        <ShopProductsDestinationSelector />

        {destination.kind === "all-clinics" && destination.notice ? (
          <Alert variant="destructive" className="mt-3">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{destination.notice}</AlertDescription>
          </Alert>
        ) : null}

        {destinationDataError ? (
          <Alert variant="destructive" className="mt-3">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{destinationDataError}</AlertDescription>
          </Alert>
        ) : null}
      </div>

      <InventoryPageClient
        mode={mode}
        products={allClinicsProducts}
        clinicProducts={clinicProducts}
        franchiseProducts={franchiseProducts}
        pageTitle="Shop Products"
        pageDescription="Manage shop product catalog, stock levels, and availability."
      />
    </div>
  );
}
