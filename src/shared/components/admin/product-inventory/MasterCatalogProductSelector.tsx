"use client";

// src/shared/components/admin/product-inventory/MasterCatalogProductSelector.tsx
//
// Client leaf: the Master_Catalog_Product selector offered when creating or
// editing a Shop_Product on the Warehouse_Shop_Products_Page
// (clinic-scoped-shop-inventory spec — Task 7.4). Lists every
// Master_Catalog_Product (`inventory_products`) by name and base unit of
// measure, and always offers a "Not linked" option that maps to `null`.
//
// Standalone and reusable: takes `value` / `onChange` so a product edit form
// (Task 7.8 territory) can wire it directly into its own state or
// `react-hook-form` field without this component knowing about the form.
//
// Requirements validated: 3.2, 3.3, 3.4

import { useEffect, useState } from "react";
import { AlertCircle, Loader2 } from "lucide-react";

import { getMasterCatalogProductOptionsAction } from "@/actions/admin-actions/inventoryActions";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";
import { Alert, AlertDescription } from "@/shared/components/ui/alert";

const NOT_LINKED_VALUE = "__not_linked__";

interface MasterCatalogProductSelectorProps {
  /** The currently linked Master_Catalog_Product id, or `null` when unlinked. */
  value: string | null;
  /** Called with the newly selected Master_Catalog_Product id, or `null` for "Not linked". */
  onChange: (inventoryProductId: string | null) => void;
  disabled?: boolean;
  className?: string;
  id?: string;
  "aria-label"?: string;
}

/**
 * Lists every Master_Catalog_Product by name + base unit of measure, with a
 * "Not linked" option always present and mapped to `null` (Req 3.2).
 *
 * When no Master_Catalog_Product exists, the empty-state copy is shown and
 * only "Not linked" is offered (Req 3.3). When the list fails to load, the
 * load-failure copy is shown, only "Not linked" is offered, and any existing
 * selection is left unchanged — this component never silently clears
 * `value` on a load failure (Req 3.4).
 */
export function MasterCatalogProductSelector({
  value,
  onChange,
  disabled,
  className,
  id,
  "aria-label": ariaLabel,
}: MasterCatalogProductSelectorProps) {
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [options, setOptions] = useState<
    { id: string; name: string; base_uom: string }[]
  >([]);

  useEffect(() => {
    let cancelled = false;

    setLoading(true);
    setLoadFailed(false);

    getMasterCatalogProductOptionsAction()
      .then((result) => {
        if (cancelled) return;

        if (!result.success) {
          setLoadFailed(true);
          setOptions([]);
          return;
        }

        setOptions(result.data);
      })
      .catch(() => {
        if (cancelled) return;
        setLoadFailed(true);
        setOptions([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const isEmpty = !loading && !loadFailed && options.length === 0;
  const selectValue = value ?? NOT_LINKED_VALUE;

  function handleValueChange(nextValue: string) {
    onChange(nextValue === NOT_LINKED_VALUE ? null : nextValue);
  }

  return (
    <div className={className}>
      <Select
        value={selectValue}
        onValueChange={handleValueChange}
        disabled={disabled || loading}
      >
        <SelectTrigger id={id} aria-label={ariaLabel ?? "Master Catalog Product"}>
          {loading ? (
            <span className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Loading Master Catalog Products...
            </span>
          ) : (
            <SelectValue placeholder="Select a Master Catalog Product" />
          )}
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NOT_LINKED_VALUE}>Not linked</SelectItem>
          {options.map((option) => (
            <SelectItem key={option.id} value={option.id}>
              {option.name} ({option.base_uom})
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {loadFailed ? (
        <Alert variant="destructive" className="mt-2">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            The Master Catalog Product list could not be loaded. Only &quot;Not
            linked&quot; is available right now.
          </AlertDescription>
        </Alert>
      ) : null}

      {isEmpty ? (
        <Alert className="mt-2">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            No Master Catalog Products are available. This product will
            remain unlinked.
          </AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}

export default MasterCatalogProductSelector;
