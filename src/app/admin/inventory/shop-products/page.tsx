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
import { guardAdminPage } from "@/lib/auth/adminAccess";
import { resolveDestination, type KnownDestinations } from "@/lib/shop/clinicStock";
import type { ClinicShopProductRow } from "@/types/clinicShop";
import InventoryPageClient, {
  type ShopProductsMode,
} from "@/shared/components/admin/product-inventory/InventoryPageClient";
import { ShopProductsDestinationSelector } from "@/shared/components/admin/product-inventory/ShopProductsDestinationSelector";
import { Alert, AlertDescription } from "@/shared/components/ui/alert";

export const revalidate = 0;

interface ShopProductsPageProps {
  // Next.js 16: `searchParams` is a Promise and must be awaited.
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

/**
 * Warehouse_Shop_Products_Page (clinic-scoped-shop-inventory spec — Task 7.3).
 *
 * This page previously carried NO page guard at all. `guardAdminPage("inventory")`
 * closes that gap: a non-ADMIN session is redirected to `/unauthorized`, and an
 * `operations`-level Admin (including a Clinic_Scoped_Admin) is redirected to
 * their own landing route — which is exactly Requirement 16.7.
 *
 * The Destination_Selector is URL-driven (`?destination=`) rather than client
 * state, so the selected destination's data is resolved and fetched here,
 * server-side, under the same authorization check the rest of this page uses
 * (Req 5.14), and the page re-renders without a manual refresh when the
 * selector's `router.replace` changes the search param (Req 5.9).
 */
export default async function ShopProductsPage({
  searchParams,
}: ShopProductsPageProps) {
  await guardAdminPage("inventory");

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
    mode = { kind: "clinic", clinicId: destination.clinicId };
    const result = await getClinicShopViewAction(destination.clinicId);
    if (result.success) {
      clinicProducts = result.data;
    } else {
      // Req 5.13: the page shows no Shop_Product rows on a load failure.
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
      // Req 19.8: the franchise data could not be loaded.
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
