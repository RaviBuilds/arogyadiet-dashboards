// src/lib/bulk-migration/validateKitRows.ts
//
// Raw-spreadsheet-row → validated KIT import row translation.
//
// LAYERING: Pure decision logic. It receives already-parsed rows (`RawRow[]`)
// plus the reference data the caller loaded (active KIT products, clinics) and
// returns validated rows or per-cell errors. No Supabase access, no `use server`.
//
// Responsibilities, in order, per row:
//   1. Trim / normalize free text and enum-ish cells (case-insensitive input).
//   2. Resolve `kit_product` and `clinic_name` to UUIDs against the reference
//      data, reporting an explicit error for an unknown value.
//   3. Apply the documented defaults for blank optional cells.
//   4. Validate the assembled row with `kitBulkCustomerRowSchema` and map any
//      Zod issue back to the spreadsheet column name.
//   5. Reject a mobile number that repeats inside the same file (the platform
//      uniqueness check happens at insert time).

import {
  kitBulkCustomerRowSchema,
  kitColumnForPath,
  type KitBulkCustomerRow,
} from "@/validations/kitBulkImportSchema";
import type { QuickOnboardingInput } from "@/validations/onboardingSchema";
import type { RawRow } from "./parse";
import type { RowValidationError } from "./validate";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Reference entry for name → id resolution. */
export interface KitNamedReference {
  id: string;
  name: string;
}

export interface KitParsedRow extends KitBulkCustomerRow {
  /** 1-based spreadsheet row number (header row is row 1). */
  rowIndex: number;
  /** Resolved KIT product name, used for the import report. */
  kitProductName: string;
}

export interface KitValidationOutcome {
  valid: KitParsedRow[];
  errors: RowValidationError[];
}

function text(row: RawRow, key: string): string {
  return (row[key] ?? "").trim();
}

function optionalText(row: RawRow, key: string): string | undefined {
  const value = text(row, key);
  return value.length > 0 ? value : undefined;
}

/** Title-case a single-word enum input so `MALE` / `male` both match `Male`. */
function titleCase(value: string): string {
  if (!value) return value;
  return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
}

/** Accept `Non Veg`, `NonVeg`, `NON-VEG`, … as `Non-Veg`. */
function normalizeDietary(value: string): string {
  const compact = value.replace(/[\s_-]+/g, "").toLowerCase();
  if (compact === "veg" || compact === "vegetarian") return "Veg";
  if (compact === "nonveg" || compact === "nonvegetarian") return "Non-Veg";
  return value;
}

/** Accept `Paid` / `PAID` / `Payment Collected` as the canonical `PAID`. */
function normalizePaymentStatus(value: string): string {
  const compact = value.replace(/[\s_-]+/g, "").toLowerCase();
  if (compact === "paid" || compact === "paymentcollected") return "PAID";
  return value.toUpperCase();
}

/** Accept `YYYY/MM/DD` alongside `YYYY-MM-DD`; anything else passes through. */
function normalizeDate(value: string): string {
  return value.replace(/\//g, "-");
}

/**
 * Parse a numeric cell. Returns `undefined` for a blank cell and `null` when
 * the cell holds something that is not a finite number, so the caller can tell
 * "not supplied" apart from "supplied but invalid".
 */
function numericCell(value: string): number | undefined | null {
  if (!value) return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Strip formatting and an Indian country/trunk prefix from a mobile cell so
 * `+91 98765 43210`, `919876543210` and `09876543210` all normalize to the
 * 10-digit form. A bare 10-digit number that happens to start with `91` is left
 * alone — the prefix is only removed when doing so yields exactly 10 digits.
 */
function normalizeMobileCell(raw: string): string {
  const compact = raw.replace(/[\s()+.-]/g, "");
  if (compact.length === 13 && compact.startsWith("091")) return compact.slice(3);
  if (compact.length === 12 && compact.startsWith("91")) return compact.slice(2);
  if (compact.length === 11 && compact.startsWith("0")) return compact.slice(1);
  return compact;
}

function normalizeName(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function buildIndex(refs: readonly KitNamedReference[]): Map<string, KitNamedReference> {
  const map = new Map<string, KitNamedReference>();
  for (const ref of refs) map.set(normalizeName(ref.name), ref);
  return map;
}

/**
 * Validate every row of an uploaded KIT customer sheet.
 *
 * @param rows        parsed spreadsheet rows (header already normalized)
 * @param kitProducts active KIT products, for `kit_product` resolution
 * @param clinics     clinics, for the optional `clinic_name` resolution
 */
export function validateKitCustomerRows(
  rows: RawRow[],
  kitProducts: readonly KitNamedReference[],
  clinics: readonly KitNamedReference[],
): KitValidationOutcome {
  const errors: RowValidationError[] = [];
  const valid: KitParsedRow[] = [];

  const productsByName = buildIndex(kitProducts);
  const productsById = new Map(kitProducts.map((p) => [p.id, p]));
  const clinicsByName = buildIndex(clinics);
  const clinicsById = new Map(clinics.map((c) => [c.id, c]));

  const seenMobiles = new Map<string, number>();

  rows.forEach((row, idx) => {
    // Header occupies row 1, so the first data row is spreadsheet row 2.
    const rowNum = idx + 2;
    const rowErrors: RowValidationError[] = [];

    // ── kit_product → UUID ────────────────────────────────────────────────
    const kitProductRaw = text(row, "kit_product");
    let kitProduct: KitNamedReference | undefined;
    if (!kitProductRaw) {
      rowErrors.push({
        row: rowNum,
        field: "kit_product",
        message: "Required. Use a name from the reference_kit_products sheet.",
      });
    } else {
      kitProduct = UUID_RE.test(kitProductRaw)
        ? productsById.get(kitProductRaw)
        : productsByName.get(normalizeName(kitProductRaw));
      if (!kitProduct) {
        rowErrors.push({
          row: rowNum,
          field: "kit_product",
          message: `"${kitProductRaw}" is not an active KIT product.`,
        });
      }
    }

    // ── clinic_name → UUID (optional) ─────────────────────────────────────
    const clinicRaw = text(row, "clinic_name");
    let clinic: KitNamedReference | undefined;
    if (clinicRaw) {
      clinic = UUID_RE.test(clinicRaw)
        ? clinicsById.get(clinicRaw)
        : clinicsByName.get(normalizeName(clinicRaw));
      if (!clinic) {
        rowErrors.push({
          row: rowNum,
          field: "clinic_name",
          message: `"${clinicRaw}" is not a known clinic. Leave blank to auto-resolve.`,
        });
      }
    }

    // ── numeric cells ─────────────────────────────────────────────────────
    const durationRaw = text(row, "kit_duration_days");
    const duration = numericCell(durationRaw);
    if (duration === null) {
      rowErrors.push({
        row: rowNum,
        field: "kit_duration_days",
        message: `"${durationRaw}" is not a number.`,
      });
    }

    const latRaw = text(row, "address_lat");
    const lat = numericCell(latRaw);
    if (lat === null) {
      rowErrors.push({
        row: rowNum,
        field: "address_lat",
        message: `"${latRaw}" is not a number. Leave blank when unknown.`,
      });
    }

    const lngRaw = text(row, "address_lng");
    const lng = numericCell(lngRaw);
    if (lng === null) {
      rowErrors.push({
        row: rowNum,
        field: "address_lng",
        message: `"${lngRaw}" is not a number. Leave blank when unknown.`,
      });
    }

    // ── defaults for blank optional cells ─────────────────────────────────
    const mobile = normalizeMobileCell(text(row, "mobile"));
    const dietaryPreference = normalizeDietary(text(row, "dietary_preference"));
    const mealPreference =
      optionalText(row, "initial_meal_preference")?.toUpperCase() ??
      (dietaryPreference === "Non-Veg" ? "CHICKEN" : "VEG");
    // Blank PIN falls back to the last 6 digits of the mobile. It is stored as a
    // temporary PIN, so the customer is forced to replace it on first login.
    const tempPin = optionalText(row, "temporary_pin") ?? mobile.slice(-6);

    const candidate = {
      fullName: text(row, "full_name"),
      mobile,
      gender: titleCase(text(row, "gender")),
      dietaryPreference,
      email: optionalText(row, "email")?.toLowerCase(),
      allergies: optionalText(row, "allergies"),
      kitProductId: kitProduct?.id ?? "",
      kitDurationDays: duration ?? Number.NaN,
      startDate: optionalText(row, "start_date")
        ? normalizeDate(text(row, "start_date"))
        : undefined,
      initialMealPreference: mealPreference,
      paymentStatus: normalizePaymentStatus(text(row, "payment_status")),
      tempPin,
      clinicId: clinic?.id,
      address: {
        tag: titleCase(text(row, "address_tag")) || "Home",
        flatNumber: text(row, "address_flat_number"),
        floorNumber: optionalText(row, "address_floor_number"),
        streetAddress: optionalText(row, "address_street"),
        area: text(row, "address_area"),
        city: text(row, "address_city"),
        state: text(row, "address_state"),
        pincode: text(row, "address_pincode"),
        lat: lat ?? null,
        lng: lng ?? null,
      },
    };

    const parsed = kitBulkCustomerRowSchema.safeParse(candidate);

    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const field = kitColumnForPath(issue.path);
        // Reference-resolution failures were already reported with a clearer
        // message; skip the generic "invalid uuid" / NaN follow-ups.
        if (field === "kit_product" || field === "clinic_name") continue;
        if (field === "kit_duration_days" && duration === null) continue;
        if (field === "address_lat" && lat === null) continue;
        if (field === "address_lng" && lng === null) continue;
        rowErrors.push({ row: rowNum, field, message: issue.message });
      }
    }

    // ── in-file mobile uniqueness ─────────────────────────────────────────
    if (mobile) {
      const firstSeen = seenMobiles.get(mobile);
      if (firstSeen !== undefined) {
        rowErrors.push({
          row: rowNum,
          field: "mobile",
          message: `Duplicate mobile in file (first seen on row ${firstSeen}).`,
        });
      } else {
        seenMobiles.set(mobile, rowNum);
      }
    }

    if (!parsed.success && rowErrors.length === 0) {
      // Defensive: every Zod issue was filtered as an already-reported
      // reference failure, yet the row did not validate. Never let such a row
      // through as importable.
      rowErrors.push({
        row: rowNum,
        field: "kit_product",
        message: parsed.error.issues[0]?.message ?? "Row could not be validated.",
      });
    }

    if (rowErrors.length > 0 || !parsed.success) {
      errors.push(...rowErrors);
      return;
    }

    valid.push({
      ...parsed.data,
      rowIndex: rowNum,
      kitProductName: kitProduct?.name ?? "",
    });
  });

  return { valid, errors };
}

/**
 * Adapt a validated import row to the payload `OnboardingService.onboard`
 * expects.
 *
 * The `address` cast is deliberate and narrow: `QuickOnboardingInput` types
 * `lat`/`lng` as non-null `number` because the interactive form always resolves
 * them from the map picker, while the RPC's address block accepts `null`
 * (`OnboardAddressInput.lat?: number | null`). The service only forwards these
 * two values into that block, so a null coordinate is safe at runtime for a KIT
 * courier address.
 */
export function kitRowToOnboardingPayload(
  row: KitParsedRow,
): QuickOnboardingInput {
  return {
    fullName: row.fullName,
    mobile: row.mobile,
    gender: row.gender,
    dietaryPreference: row.dietaryPreference,
    allergies: row.allergies,
    email: row.email,
    isTestEmail: false,
    primaryCategory: "KIT",
    kitProductId: row.kitProductId,
    kitDurationDays: row.kitDurationDays,
    startDate: row.startDate,
    paymentStatus: "PAID",
    initialMealPreference: row.initialMealPreference,
    cutoffAcknowledged: true,
    clinicId: row.clinicId,
    address: {
      tag: row.address.tag,
      flatNumber: row.address.flatNumber,
      floorNumber: row.address.floorNumber,
      streetAddress: row.address.streetAddress,
      area: row.address.area,
      city: row.address.city,
      state: row.address.state,
      pincode: row.address.pincode,
      lat: row.address.lat,
      lng: row.address.lng,
    } as QuickOnboardingInput["address"],
    // Past-date reconstruction does not apply to KIT: no daily-preference
    // records are generated for a KIT subscription.
    pastDateEnabled: false,
    automationOverrideAcknowledged: false,
    pastDayStatuses: [],
  };
}
