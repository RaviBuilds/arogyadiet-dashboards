// src/app/admin/(main)/kitchen-shop/inventory/page.tsx
//
// Operations_Shop_Products_Page (clinic-scoped-shop-inventory spec — Task
// 10.1). Replaces the old shared/global-catalog view-only rendering with a
// clinic-scoped read: an Unscoped_Operations_Admin picks a Core_Clinic from
// a dropdown, a Clinic_Scoped_Admin's dropdown is fixed to their own
// Clinic_Scope_Assignment, and either way the page shows only that clinic's
// Effective_Clinic_Stock and Effective_Clinic_Visibility (Req 9.1–9.5,
// 9.11, 9.13, 9.14, 14.4, 14.5, 14.8, 16.6).
//
// The clinic ledger view (Req 9.6–9.10, 9.12) is built by task 10.2:
// `ClinicLedgerView`, fetched server-side here via `getClinicLedgerAction`
// exactly like `clinicProducts` is fetched via `getClinicShopViewAction`, and
// rendered only when a clinic is actually selected. A distinct
// `ledgerError` state keeps "the ledger could not be loaded" (Req 9.12) from
// being conflated with the existing "clinic stock data could not be loaded"
// (Req 9.13) `pageError` message.
//
// Server-side resolution goes through `getCurrentAdminContext` +
// `getClinicShopViewAction` / `getClinicLedgerAction` (both gate every read
// through `checkClinicScope` / `resolveReadableClinicId`, the design's single
// chokepoint), so a Clinic_Scoped_Admin can never read another clinic's
// stock/ledger even if the UI were bypassed (Req 9.14, 14.6, 14.7).

import { AlertCircle } from "lucide-react";

import { guardAdminGroup, getCurrentAdminContext } from "@/lib/auth/adminAccess";
import {
  getClinicLedgerAction,
  getClinicShopViewAction,
  getDestinationOptionsAction,
} from "@/actions/admin-actions/clinicShopInventoryActions";
import { getClinicById } from "@/repositories/clinic/clinicRepository";
import type { ClinicLedgerEntry, ClinicShopProductRow } from "@/types/clinicShop";
import InventoryPageClient, {
  type ShopProductsMode,
} from "@/shared/components/admin/product-inventory/InventoryPageClient";
import { ClinicLedgerView } from "@/shared/components/admin/product-inventory/ClinicLedgerView";
import {
  ClinicSelector,
  CLINIC_SELECTOR_PARAM,
  type ClinicSelectorOption,
} from "@/shared/components/admin/ClinicSelector";
import { Alert, AlertDescription } from "@/shared/components/ui/alert";

export const revalidate = 0;

interface OperationsShopProductsPageProps {
  // Next.js 16: `searchParams` is a Promise and must be awaited.
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

export default async function InventoryPage({
  searchParams,
}: OperationsShopProductsPageProps) {
  await guardAdminGroup("shop_products");

  const { clinicId: assignedClinicId } = await getCurrentAdminContext();

  const resolvedParams = await searchParams;
  const rawClinicParam = resolvedParams[CLINIC_SELECTOR_PARAM];
  const requestedClinicId = Array.isArray(rawClinicParam)
    ? rawClinicParam[0]
    : rawClinicParam;

  let clinics: ClinicSelectorOption[] = [];
  let fixedClinic: ClinicSelectorOption | null = null;
  let selectedClinicId: string | null = null;
  let pageError: string | null = null;
  let clinicProducts: ClinicShopProductRow[] = [];
  let ledgerEntries: ClinicLedgerEntry[] = [];
  // Req 9.12: distinct from `pageError` (Req 9.13) so "the ledger could not
  // be loaded" is never conflated with "the clinic stock data could not be
  // loaded".
  let ledgerError: string | null = null;

  if (assignedClinicId) {
    // Req 14.5: fixed to the assignment, no other Core_Clinic selectable.
    selectedClinicId = assignedClinicId;

    let assignedClinicName = "Your Clinic";
    try {
      const clinic = await getClinicById(assignedClinicId);
      if (clinic) assignedClinicName = clinic.name;
    } catch {
      // Name resolution failure is non-fatal for the selector label; the
      // clinic-stock read below is what actually determines Req 14.8.
    }
    fixedClinic = { id: assignedClinicId, name: assignedClinicName };

    const view = await getClinicShopViewAction(assignedClinicId);
    if (view.success) {
      clinicProducts = view.data;
    } else {
      // Req 14.8: the assignment references a Core_Clinic that no longer
      // exists (or is otherwise unreadable) — no stock/ledger shown.
      pageError =
        "Your assigned clinic is unavailable. Contact an administrator.";
    }

    if (!pageError) {
      const ledger = await getClinicLedgerAction(assignedClinicId);
      if (ledger.success) {
        ledgerEntries = ledger.data;
      } else {
        ledgerError = "The ledger could not be loaded.";
      }
    }
  } else {
    // Unscoped_Operations_Admin: resolve the selectable Core_Clinic list
    // (Req 9.1). No filter based on scope is applied here (Req 14.1–14.3 —
    // not relevant to this action; `getDestinationOptionsAction` itself is
    // gated to warehouse access, but this page's own `guardAdminGroup` check
    // above is what actually authorizes the caller for Shop_Products).
    const destinationOptions = await getDestinationOptionsAction();
    if (destinationOptions.success) {
      clinics = destinationOptions.data.clinics;
    } else {
      pageError = "The clinic list could not be loaded.";
    }

    if (requestedClinicId) {
      selectedClinicId = requestedClinicId;
      const view = await getClinicShopViewAction(requestedClinicId);
      if (view.success) {
        clinicProducts = view.data;
      } else {
        // Req 9.13: the clinic stock data could not be loaded — no
        // Shop_Product rows, distinct from the "no selection" prompt below.
        pageError = "The clinic stock data could not be loaded.";
      }

      if (!pageError) {
        const ledger = await getClinicLedgerAction(requestedClinicId);
        if (ledger.success) {
          ledgerEntries = ledger.data;
        } else {
          ledgerError = "The ledger could not be loaded.";
        }
      }
    }
  }

  const mode: ShopProductsMode = {
    kind: "operations-view",
    clinicId: selectedClinicId,
  };

  const noClinicsConfigured = !assignedClinicId && clinics.length === 0 && !pageError;

  return (
    <div className="space-y-4">
      <div className="px-6 pt-6">
        <ClinicSelector clinics={clinics} fixedClinic={fixedClinic} />

        {pageError ? (
          <Alert variant="destructive" className="mt-3">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{pageError}</AlertDescription>
          </Alert>
        ) : null}

        {/* Req 9.2: no Core_Clinic selected yet (Unscoped_Operations_Admin
            only — a Clinic_Scoped_Admin's clinic is always resolved). */}
        {!assignedClinicId && !selectedClinicId && !pageError && !noClinicsConfigured ? (
          <Alert className="mt-3">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              Select a clinic to view its shop stock and ledger.
            </AlertDescription>
          </Alert>
        ) : null}
      </div>

      <InventoryPageClient
        mode={mode}
        products={[]}
        clinicProducts={clinicProducts}
        pageTitle="Shop Products"
        pageDescription="View shop products and their per-clinic stock and visibility."
      />

      {/* Clinic ledger view — rendered only when a clinic is actually
          selected (Req 9.6). When no clinic is selected, nothing
          ledger-related renders; the "select a clinic" / empty-state prompts
          above already cover that state. */}
      {selectedClinicId ? (
        <div className="px-6 pb-6">
          {ledgerError ? (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{ledgerError}</AlertDescription>
            </Alert>
          ) : (
            <ClinicLedgerView entries={ledgerEntries} />
          )}
        </div>
      ) : null}
    </div>
  );
}
