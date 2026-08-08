"use client";

// src/shared/components/admin/product-inventory/MasterCatalogLinkByCode.tsx
//
// Client leaf: lets an Inventory_Admin link a Shop_Product to a
// Master_Catalog_Product by typing the Product_Code shown on that product's
// Master Catalog card, instead of picking from a dropdown. Shows a resolved
// preview (name, code, category, unit of measure, image) once a valid code is
// looked up.
//
// Locking behaviour: once a Shop_Product has been linked (an
// `inventoryProductId` is already set), the link becomes permanent — this
// component renders as a read-only preview with no way to change or clear it.

import { useEffect, useState } from "react";
import { AlertCircle, CheckCircle2, Loader2, Package, X } from "lucide-react";

import {
  lookupMasterCatalogProductByCodeAction,
  getMasterCatalogProductByIdAction,
  type MasterCatalogProductPreview,
} from "@/actions/admin-actions/inventoryActions";
import { Alert, AlertDescription } from "@/shared/components/ui/alert";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";

interface MasterCatalogLinkByCodeProps {
  /** The currently linked Master_Catalog_Product id, or `null` when unlinked. */
  value: string | null;
  /** Called with the newly linked Master_Catalog_Product id once resolved. */
  onChange: (inventoryProductId: string | null) => void;
  /**
   * True once the Shop_Product already exists (edit mode). The Master
   * Catalog link may be set only at creation — an existing product renders a
   * permanently read-only view regardless of whether it holds a link.
   */
  locked?: boolean;
  disabled?: boolean;
  className?: string;
  id?: string;
}

/**
 * Product_Code input + "Link" button + resolved preview, used only while
 * creating a Shop_Product. Once the product exists (`locked`), renders a
 * read-only preview (or "Not linked") with no way to set, change, or clear
 * the link — matching the "cannot change once created" rule.
 */
export function MasterCatalogLinkByCode({
  value,
  onChange,
  locked = false,
  disabled,
  className,
  id,
}: MasterCatalogLinkByCodeProps) {
  const [codeInput, setCodeInput] = useState("");
  const [looking, setLooking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<MasterCatalogProductPreview | null>(
    null,
  );
  const [loadingLocked, setLoadingLocked] = useState(false);

  // When editing an already-linked product, resolve the preview for the
  // locked id once so the admin can see what it's linked to.
  useEffect(() => {
    if (!value) {
      setPreview(null);
      return;
    }

    let cancelled = false;
    setLoadingLocked(true);

    getMasterCatalogProductByIdAction(value)
      .then((result) => {
        if (cancelled) return;
        if (result.success) {
          setPreview(result.data);
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingLocked(false);
      });

    return () => {
      cancelled = true;
    };
    // Only re-run if the locked value itself changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  async function handleLookup() {
    setError(null);

    if (!codeInput.trim()) {
      setError("Enter a product code.");
      return;
    }

    setLooking(true);
    try {
      const result = await lookupMasterCatalogProductByCodeAction(
        codeInput.trim(),
      );

      if (!result.success) {
        setError(result.error);
        setPreview(null);
        return;
      }

      // Resolving a valid code immediately links it — the preview shown
      // below confirms what was linked.
      setPreview(result.data);
      onChange(result.data.id);
    } finally {
      setLooking(false);
    }
  }

  function handleUnlinkPreview() {
    setPreview(null);
    setCodeInput("");
    setError(null);
    onChange(null);
  }

  // ── Locked state: editing an existing product — permanently read-only,
  //    whether or not it holds a link ───────────────────────────────────────
  if (locked) {
    return (
      <div className={className}>
        {!value ? (
          <p className="text-sm text-muted-foreground">
            Not linked to a Master Catalog Product.
          </p>
        ) : loadingLocked ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Loading linked product...
          </div>
        ) : preview ? (
          <div className="flex items-center gap-3 rounded-md border border-slate-200 bg-slate-50 p-3">
            {preview.imageUrl ? (
              <img
                src={preview.imageUrl}
                alt={preview.name}
                className="h-10 w-10 rounded object-cover"
              />
            ) : (
              <div className="flex h-10 w-10 items-center justify-center rounded bg-slate-200">
                <Package className="h-5 w-5 text-slate-500" />
              </div>
            )}
            <div className="flex-1">
              <p className="text-sm font-medium text-slate-800">
                {preview.name}
              </p>
              <p className="text-xs text-slate-500">
                Code {preview.productCode} · {preview.category} ·{" "}
                {preview.baseUom}
              </p>
            </div>
            <CheckCircle2 className="h-4 w-4 shrink-0 text-green-600" />
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Linked (details unavailable).</p>
        )}
        <p className="mt-1.5 text-xs text-slate-500">
          The Master Catalog link can only be set when a product is first
          created, and cannot be changed afterward.
        </p>
      </div>
    );
  }

  // ── Unlinked: code entry + lookup + confirm ───────────────────────────────
  return (
    <div className={className}>
      {preview ? (
        <div className="flex items-center gap-3 rounded-md border border-green-200 bg-green-50 p-3">
          {preview.imageUrl ? (
            <img
              src={preview.imageUrl}
              alt={preview.name}
              className="h-10 w-10 rounded object-cover"
            />
          ) : (
            <div className="flex h-10 w-10 items-center justify-center rounded bg-slate-200">
              <Package className="h-5 w-5 text-slate-500" />
            </div>
          )}
          <div className="flex-1">
            <p className="text-sm font-medium text-slate-800">
              {preview.name}
            </p>
            <p className="text-xs text-slate-500">
              Code {preview.productCode} · {preview.category} ·{" "}
              {preview.baseUom}
            </p>
          </div>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="shrink-0"
            onClick={handleUnlinkPreview}
            disabled={disabled}
            aria-label="Undo link (before saving)"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      ) : (
        <div className="flex gap-2">
          <Input
            id={id}
            placeholder="Enter Product Code (e.g. K7M2Q)"
            value={codeInput}
            onChange={(event) => {
              setCodeInput(event.target.value.toUpperCase());
              setError(null);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                handleLookup();
              }
            }}
            disabled={disabled || looking}
            maxLength={5}
            className="border-slate-200 font-mono uppercase focus-visible:ring-primary/30"
          />
          <Button
            type="button"
            variant="outline"
            onClick={handleLookup}
            disabled={disabled || looking || !codeInput.trim()}
          >
            {looking ? <Loader2 className="h-4 w-4 animate-spin" /> : "Link"}
          </Button>
        </div>
      )}

      {error ? (
        <Alert variant="destructive" className="mt-2">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {!preview ? (
        <p className="mt-1.5 text-xs text-slate-500">
          Find the code on the product&apos;s card in Master Catalog, next to
          its stock unit. Leave unlinked to keep it out of Stock In. Once
          this product is saved, the link cannot be changed.
        </p>
      ) : (
        <p className="mt-1.5 text-xs text-slate-500">
          Linked. Click the X to unlink before saving — once saved, this
          becomes permanent.
        </p>
      )}
    </div>
  );
}

export default MasterCatalogLinkByCode;
