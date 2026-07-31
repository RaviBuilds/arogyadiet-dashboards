// src/actions/admin-actions/kitBulkImportActions.ts
//
// Admin Server Actions for the KIT customer bulk import (offline → platform
// migration of KIT customers).
//
// LAYERING: Orchestration only. Each export authorizes the caller, resolves the
// admin identity, parses/validates the upload with the pure helpers in
// `src/lib/bulk-migration`, and then delegates every write to
// `OnboardingService.onboard` — the same atomic path the interactive
// Quick_Onboarding_Form uses. That is what makes this import current with the
// mobile + PIN identity model: each row creates the Supabase Auth phone
// identity, a hashed temporary PIN (`users.pin_hash`, `is_temp_pin = true`), a
// unique `customer_code`, the KIT subscription (`customer_category = 'KIT'`,
// `kit_product_id`, `kit_duration_days`) and the payment inside one
// `onboard_customer` transaction. Nothing partial is ever left behind.
//
// The import is CHUNKED: the client calls `bulkImportKitCustomersAction`
// repeatedly with an increasing offset. Each row costs a bcrypt hash, an Auth
// user creation and an RPC round-trip, so a 200-row sheet would otherwise
// exceed the serverless request budget in a single call.

"use server";

import * as XLSX from "xlsx";
import { revalidatePath } from "next/cache";

import { createAdminClient } from "@/lib/supabase/admin";
import { checkGroupManage, getCurrentAdminContext } from "@/lib/auth/adminAccess";
import { logAdminAction } from "@/lib/logger";
import { isValidPinFormat } from "@/lib/pin/pinUtils";
import { hashPin } from "@/services/PinService";
import { onboard as serviceOnboard } from "@/services/OnboardingService";
import { parseSpreadsheetBuffer } from "@/lib/bulk-migration/parse";
import type { RowValidationError } from "@/lib/bulk-migration/validate";
import {
  kitRowToOnboardingPayload,
  validateKitCustomerRows,
  type KitNamedReference,
} from "@/lib/bulk-migration/validateKitRows";
import {
  KIT_CUSTOMER_BULK_HEADERS,
  KIT_CUSTOMER_BULK_KEYS,
  KIT_CUSTOMER_BULK_SAMPLE_ROWS,
  KIT_GUIDE_HEADERS,
  KIT_GUIDE_INTRO,
  KIT_GUIDE_ROWS,
  KIT_REFERENCE_CLINICS_HEADERS,
  KIT_REFERENCE_PRODUCTS_HEADERS,
} from "@/lib/bulk-migration/kitTemplates";

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

/** Outcome of a single sheet row. */
export type KitBulkRowResult = {
  row: number;
  success: boolean;
  /** Mobile number — the primary identifier of a Customer_Record. */
  identifier: string;
  name: string;
  kitProduct: string;
  /** The temporary PIN issued to the customer (only on success). */
  tempPin?: string;
  message?: string;
};

export type KitBulkValidationResult =
  | {
      success: true;
      totalRows: number;
      validRows: number;
      validationErrors: RowValidationError[];
    }
  | { success: false; error: string };

export type KitBulkImportChunkResult =
  | {
      success: true;
      /** Number of importable rows in the file (invalid rows excluded). */
      totalValidRows: number;
      /** Offset the client should send next; equals totalValidRows when done. */
      nextOffset: number;
      done: boolean;
      succeeded: number;
      failed: number;
      results: KitBulkRowResult[];
      validationErrors: RowValidationError[];
    }
  | { success: false; error: string };

const ADMIN_CUSTOMERS_PATH = "/admin/customers";

/** Rows processed per action call. Keeps each request well inside its budget. */
const DEFAULT_CHUNK_SIZE = 20;
const MAX_CHUNK_SIZE = 50;

// ---------------------------------------------------------------------------
// Reference data
// ---------------------------------------------------------------------------

async function loadKitReferenceData(): Promise<{
  kitProducts: Array<KitNamedReference & { base_price: number }>;
  clinics: KitNamedReference[];
}> {
  const supabase = createAdminClient();

  const [{ data: products }, { data: clinics }] = await Promise.all([
    supabase
      .from("kit_products")
      .select("id, name, base_price")
      .eq("is_active", true)
      .order("name"),
    supabase.from("clinics").select("id, name").order("name"),
  ]);

  return {
    kitProducts: (products ?? []).map((p) => ({
      id: p.id as string,
      name: p.name as string,
      base_price: Number(p.base_price ?? 0),
    })),
    clinics: (clinics ?? []).map((c) => ({
      id: c.id as string,
      name: c.name as string,
    })),
  };
}

/** Reference data for the KIT import UI (product names shown to the admin). */
export async function getKitBulkImportReferenceAction() {
  const { kitProducts, clinics } = await loadKitReferenceData();
  return { success: true as const, kitProducts, clinics };
}

// ---------------------------------------------------------------------------
// Template workbook
// ---------------------------------------------------------------------------

/**
 * Build the KIT collection workbook: a guide sheet that marks every field
 * required/optional, the data sheet whose headers carry the same `(optional)`
 * markers, and live reference sheets for KIT products and clinics.
 */
export async function downloadKitBulkImportWorkbookAction() {
  const gate = await checkGroupManage("customers");
  if (!gate.ok) {
    return { success: false as const, error: gate.error };
  }

  const { kitProducts, clinics } = await loadKitReferenceData();
  const wb = XLSX.utils.book_new();

  // 00_read_me — intro notes + the required/optional field table.
  const guideRows: (string | number)[][] = [
    ...KIT_GUIDE_INTRO.map((line) => [line]),
    [...KIT_GUIDE_HEADERS],
    ...KIT_GUIDE_ROWS,
  ];
  const guideSheet = XLSX.utils.aoa_to_sheet(guideRows);
  guideSheet["!cols"] = [{ wch: 26 }, { wch: 20 }, { wch: 46 }, { wch: 82 }];
  XLSX.utils.book_append_sheet(wb, guideSheet, "00_read_me");

  // 01_kit_customers — the sheet the client fills in.
  const dataRows: (string | number)[][] = [
    [...KIT_CUSTOMER_BULK_HEADERS],
    ...KIT_CUSTOMER_BULK_SAMPLE_ROWS.map((row) =>
      KIT_CUSTOMER_BULK_KEYS.map((key) => row[key] ?? ""),
    ),
  ];
  const dataSheet = XLSX.utils.aoa_to_sheet(dataRows);
  dataSheet["!cols"] = KIT_CUSTOMER_BULK_HEADERS.map((h) => ({
    wch: Math.max(16, h.length + 2),
  }));
  XLSX.utils.book_append_sheet(wb, dataSheet, "01_kit_customers");

  const productRows: (string | number)[][] = [
    [...KIT_REFERENCE_PRODUCTS_HEADERS],
    ...kitProducts.map((p) => [p.name, p.base_price, p.id]),
  ];
  const productSheet = XLSX.utils.aoa_to_sheet(productRows);
  productSheet["!cols"] = [{ wch: 30 }, { wch: 22 }, { wch: 38 }];
  XLSX.utils.book_append_sheet(wb, productSheet, "reference_kit_products");

  const clinicRows: (string | number)[][] = [
    [...KIT_REFERENCE_CLINICS_HEADERS],
    ...clinics.map((c) => [c.name]),
  ];
  const clinicSheet = XLSX.utils.aoa_to_sheet(clinicRows);
  clinicSheet["!cols"] = [{ wch: 36 }];
  XLSX.utils.book_append_sheet(wb, clinicSheet, "reference_clinics");

  return {
    success: true as const,
    fileName: "arogyadiet_kit_customer_import_template.xlsx",
    base64: XLSX.write(wb, { type: "base64", bookType: "xlsx" }),
  };
}

// ---------------------------------------------------------------------------
// Parse + validate helpers
// ---------------------------------------------------------------------------

function base64ToArrayBuffer(fileBase64: string): ArrayBuffer {
  const buffer = Buffer.from(fileBase64, "base64");
  return buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength,
  ) as ArrayBuffer;
}

async function parseAndValidate(fileBase64: string) {
  const rawRows = parseSpreadsheetBuffer(
    base64ToArrayBuffer(fileBase64),
    "kit-upload",
  );
  const { kitProducts, clinics } = await loadKitReferenceData();
  return {
    rawCount: rawRows.length,
    ...validateKitCustomerRows(rawRows, kitProducts, clinics),
  };
}

/**
 * Dry run: parse and validate the upload without creating anything. The client
 * calls this first so the admin can fix the sheet before any Customer_Record is
 * written.
 */
export async function validateKitCustomerFileAction(
  fileBase64: string,
): Promise<KitBulkValidationResult> {
  const gate = await checkGroupManage("customers");
  if (!gate.ok) {
    return { success: false, error: gate.error };
  }

  try {
    const { rawCount, valid, errors } = await parseAndValidate(fileBase64);
    if (rawCount === 0) {
      return {
        success: false,
        error:
          "No data rows found. Fill the '01_kit_customers' sheet and keep the header row intact.",
      };
    }
    return {
      success: true,
      totalRows: rawCount,
      validRows: valid.length,
      validationErrors: errors,
    };
  } catch (err) {
    console.error("validateKitCustomerFileAction failed:", err);
    return {
      success: false,
      error: "Could not read the spreadsheet. Upload a .xlsx or .csv file.",
    };
  }
}

// ---------------------------------------------------------------------------
// Chunked import
// ---------------------------------------------------------------------------

/**
 * Import one chunk of KIT customers.
 *
 * Rows that fail validation are never attempted; the surviving rows are
 * onboarded one by one through `OnboardingService.onboard`, which owns the
 * atomic write and the Auth-identity compensation on failure. A row failure is
 * reported and the loop continues, so one bad record does not abort a migration.
 *
 * @param fileBase64 the uploaded sheet (re-sent with every chunk)
 * @param offset     index into the list of VALID rows to resume from
 * @param limit      rows to process in this call
 */
export async function bulkImportKitCustomersAction(
  fileBase64: string,
  offset = 0,
  limit = DEFAULT_CHUNK_SIZE,
): Promise<KitBulkImportChunkResult> {
  const gate = await checkGroupManage("customers");
  if (!gate.ok) {
    return { success: false, error: gate.error };
  }

  const { userId: adminUserId } = await getCurrentAdminContext();

  let valid: Awaited<ReturnType<typeof parseAndValidate>>["valid"];
  let validationErrors: RowValidationError[];
  try {
    const parsed = await parseAndValidate(fileBase64);
    valid = parsed.valid;
    validationErrors = parsed.errors;
  } catch (err) {
    console.error("bulkImportKitCustomersAction parse failed:", err);
    return {
      success: false,
      error: "Could not read the spreadsheet. Upload a .xlsx or .csv file.",
    };
  }

  const safeLimit = Math.min(Math.max(1, limit), MAX_CHUNK_SIZE);
  const start = Math.max(0, offset);
  const slice = valid.slice(start, start + safeLimit);

  const results: KitBulkRowResult[] = [];
  let succeeded = 0;
  let failed = 0;

  for (const row of slice) {
    const base = {
      row: row.rowIndex,
      identifier: row.mobile,
      name: row.fullName,
      kitProduct: row.kitProductName,
    };

    // Defensive re-check: the PIN reaches the hasher only in a valid format.
    if (!isValidPinFormat(row.tempPin)) {
      failed++;
      results.push({
        ...base,
        success: false,
        message: "Temporary PIN must be exactly 6 digits.",
      });
      continue;
    }

    try {
      const pinHash = await hashPin(row.tempPin);
      const outcome = await serviceOnboard(
        kitRowToOnboardingPayload(row),
        { adminUserId },
        { pinHash, isTempPin: true },
      );

      if (outcome.ok) {
        succeeded++;
        results.push({ ...base, success: true, tempPin: row.tempPin });
      } else {
        failed++;
        results.push({ ...base, success: false, message: outcome.message });
      }
    } catch (err) {
      failed++;
      results.push({
        ...base,
        success: false,
        message:
          err instanceof Error ? err.message : "Unexpected error while importing.",
      });
    }
  }

  const nextOffset = start + slice.length;
  const done = nextOffset >= valid.length;

  if (slice.length > 0) {
    await logAdminAction("CREATE", "bulk_import", "kit_customers", {
      offset: start,
      attempted: slice.length,
      succeeded,
      failed,
    });
  }

  if (done) {
    revalidatePath(ADMIN_CUSTOMERS_PATH);
    revalidatePath("/admin/subscriptions");
  }

  return {
    success: true,
    totalValidRows: valid.length,
    nextOffset,
    done,
    succeeded,
    failed,
    // Validation errors are identical for every chunk; report them once.
    validationErrors: start === 0 ? validationErrors : [],
    results,
  };
}
