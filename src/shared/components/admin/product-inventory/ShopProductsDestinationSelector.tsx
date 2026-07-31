"use client";

// src/shared/components/admin/product-inventory/ShopProductsDestinationSelector.tsx
//
// Client leaf for the Warehouse_Shop_Products_Page Destination_Selector
// (clinic-scoped-shop-inventory spec — Task 7.4). Loads its option set via
// `getDestinationOptionsAction`, then encodes the selected destination into
// the page's `destination` search param and calls `router.replace` — the
// Server Component owns resolving that param via `resolveDestination` and
// fetching the selected destination's data (Task 7.3).
//
// Requirements validated: 5.1, 5.9, 5.10

import { useEffect, useState } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { AlertCircle, Loader2 } from "lucide-react";

import { getDestinationOptionsAction } from "@/actions/admin-actions/clinicShopInventoryActions";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";
import { Alert, AlertDescription } from "@/shared/components/ui/alert";

const ALL_CLINICS_VALUE = "all";
const DESTINATION_PARAM = "destination";

/** Encodes a Destination_Selector value as the `destination` search param value. */
function encodeDestination(value: string): string {
  return value;
}

/** The current destination value read from the `destination` search param. */
function readCurrentDestination(searchParams: URLSearchParams): string {
  return searchParams.get(DESTINATION_PARAM) ?? ALL_CLINICS_VALUE;
}

interface ShopProductsDestinationSelectorProps {
  className?: string;
}

/**
 * Destination_Selector: `All Clinics`, one option per Core_Clinic, and one
 * option per active Franchise (Req 5.1). Selecting a destination replaces the
 * `destination` search param via `router.replace`, letting the Server
 * Component re-resolve and re-fetch without a manual refresh (Req 5.9).
 *
 * When no Core_Clinic and no active Franchise exists, only `All Clinics` is
 * offered along with a notice that no destinations are configured (Req 5.10).
 * A load failure is shown distinctly and also falls back to `All Clinics`
 * only, since the page itself independently falls back to All_Clinics_Mode
 * when the destination list fails to load.
 */
export function ShopProductsDestinationSelector({
  className,
}: ShopProductsDestinationSelectorProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [clinics, setClinics] = useState<{ id: string; name: string }[]>([]);
  const [franchises, setFranchises] = useState<{ id: string; name: string }[]>(
    [],
  );

  useEffect(() => {
    let cancelled = false;

    setLoading(true);
    setLoadFailed(false);

    getDestinationOptionsAction()
      .then((result) => {
        if (cancelled) return;

        if (!result.success) {
          setLoadFailed(true);
          setClinics([]);
          setFranchises([]);
          return;
        }

        setClinics(result.data.clinics);
        setFranchises(result.data.franchises);
      })
      .catch(() => {
        if (cancelled) return;
        setLoadFailed(true);
        setClinics([]);
        setFranchises([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const currentValue = readCurrentDestination(searchParams);
  const isEmpty = !loading && !loadFailed && clinics.length === 0 && franchises.length === 0;

  function handleValueChange(value: string) {
    const params = new URLSearchParams(searchParams.toString());

    if (value === ALL_CLINICS_VALUE) {
      params.delete(DESTINATION_PARAM);
    } else {
      params.set(DESTINATION_PARAM, encodeDestination(value));
    }

    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname);
  }

  return (
    <div className={className}>
      <Select
        value={currentValue}
        onValueChange={handleValueChange}
        disabled={loading}
      >
        <SelectTrigger className="w-[220px]" aria-label="Shop products destination">
          {loading ? (
            <span className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Loading destinations...
            </span>
          ) : (
            <SelectValue placeholder="Select a destination" />
          )}
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL_CLINICS_VALUE}>All Clinics</SelectItem>

          {clinics.length > 0 ? (
            <SelectGroup>
              <SelectLabel>Clinics</SelectLabel>
              {clinics.map((clinic) => (
                <SelectItem key={clinic.id} value={`clinic:${clinic.id}`}>
                  {clinic.name}
                </SelectItem>
              ))}
            </SelectGroup>
          ) : null}

          {franchises.length > 0 ? (
            <SelectGroup>
              <SelectLabel>Franchises</SelectLabel>
              {franchises.map((franchise) => (
                <SelectItem key={franchise.id} value={`franchise:${franchise.id}`}>
                  {franchise.name}
                </SelectItem>
              ))}
            </SelectGroup>
          ) : null}
        </SelectContent>
      </Select>

      {loadFailed ? (
        <Alert variant="destructive" className="mt-2">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            The destination list could not be loaded. Showing All Clinics.
          </AlertDescription>
        </Alert>
      ) : null}

      {isEmpty ? (
        <Alert className="mt-2">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            No destinations are configured. Add a Core Clinic or an active
            Franchise to select one here.
          </AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}

export default ShopProductsDestinationSelector;
