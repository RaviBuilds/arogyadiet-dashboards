import type { AddressFormValues } from "@/validations/addressSchema";
import type { RawRow } from "./parse";

export type RowValidationError = { row: number; field: string; message: string };

const EMAIL_RE = /\S+@\S+\.\S+/;
const MOBILE_RE = /^[6-9]\d{9}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const GENDERS = new Set(["MALE", "FEMALE", "OTHER"]);
const DIETARY = new Set(["Veg", "Non-Veg"]);
const ADDRESS_TAGS = new Set(["Home", "Work", "Other"]);
const MEAL_CODES = new Set(["VEG", "EGG", "CHICKEN", "MIXED"]);
const SUB_MODES = new Set(["EXISTING", "CUSTOM"]);
const PAYMENT_STATUSES = new Set(["Payment Collected", "Payment Pending"]);

function yesNo(value: string): boolean | null {
  const v = value.trim().toUpperCase();
  if (!v) return null;
  if (v === "YES" || v === "Y" || v === "TRUE" || v === "1") return true;
  if (v === "NO" || v === "N" || v === "FALSE" || v === "0") return false;
  return null;
}

function parseOptionalNumber(value: string): number | null {
  const v = value.trim();
  if (!v) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export interface ParsedCustomerRow {
  rowIndex: number;
  fullName: string;
  email: string;
  mobile: string;
  password: string;
  gender?: string;
  dateOfBirth?: string;
  dietaryPreference?: string;
  allergies?: string;
  hasMedicalHistory?: boolean;
  medicalHistoryNotes?: string;
  addresses: AddressFormValues[];
}

export interface ParsedSubscriptionRow {
  rowIndex: number;
  customerEmail: string;
  customerMobile: string;
  mode: "EXISTING" | "CUSTOM";
  planCode?: string;
  startDate: string;
  endDate?: string;
  basePrice?: number;
  taxPercent?: number;
  pauseCredits?: number;
  mealCategoryCode: string;
  deliveryAddress: string;
  paymentStatus: "Payment Collected" | "Payment Pending";
  paymentReference?: string;
  paymentNotes?: string;
}

function buildAddressFromRow(
  row: RawRow,
  prefix: "address1" | "address2",
): AddressFormValues | null {
  const tag = row[`${prefix}_tag`]?.trim();
  const street1 = row[`${prefix}_street_1`]?.trim();
  const pincode = row[`${prefix}_pincode`]?.trim();

  if (!tag && !street1 && !pincode) return null;

  const isPrimaryRaw = row[`${prefix}_is_primary`]?.trim().toUpperCase();
  const lat = parseOptionalNumber(row[`${prefix}_lat`] ?? "");
  const lng = parseOptionalNumber(row[`${prefix}_lng`] ?? "");

  return {
    tag: (tag || "Home") as "Home" | "Work" | "Other",
    street_1: street1,
    street_2: row[`${prefix}_street_2`]?.trim() || undefined,
    landmark: row[`${prefix}_landmark`]?.trim() || undefined,
    city: row[`${prefix}_city`]?.trim() || "Hyderabad",
    state: row[`${prefix}_state`]?.trim() || "Telangana",
    pincode,
    is_primary: isPrimaryRaw === "YES" || isPrimaryRaw === "Y",
    lat: lat ?? null,
    lng: lng ?? null,
  };
}

export function validateCustomerRows(rows: RawRow[]): {
  valid: ParsedCustomerRow[];
  errors: RowValidationError[];
} {
  const errors: RowValidationError[] = [];
  const valid: ParsedCustomerRow[] = [];
  const seenEmails = new Set<string>();
  const seenMobiles = new Set<string>();

  rows.forEach((row, idx) => {
    const rowNum = idx + 2;
    const fullName = row.full_name?.trim() ?? "";
    const email = row.email?.trim().toLowerCase() ?? "";
    const mobile = row.mobile?.trim().replace(/\s/g, "") ?? "";
    const password = row.temporary_password?.trim() ?? "";

    if (!fullName || fullName.length < 2) {
      errors.push({ row: rowNum, field: "full_name", message: "Required (min 2 characters)." });
    }
    if (!email || !EMAIL_RE.test(email)) {
      errors.push({ row: rowNum, field: "email", message: "Valid email required." });
    }
    if (seenEmails.has(email) && email) {
      errors.push({ row: rowNum, field: "email", message: "Duplicate email in file." });
    }
    if (email) seenEmails.add(email);

    if (!mobile || !MOBILE_RE.test(mobile)) {
      errors.push({
        row: rowNum,
        field: "mobile",
        message: "10-digit Indian mobile required (starts 6–9).",
      });
    }
    if (seenMobiles.has(mobile) && mobile) {
      errors.push({ row: rowNum, field: "mobile", message: "Duplicate mobile in file." });
    }
    if (mobile) seenMobiles.add(mobile);

    if (!password || password.length < 8) {
      errors.push({
        row: rowNum,
        field: "temporary_password",
        message: "Required (min 8 characters).",
      });
    }

    const gender = row.gender?.trim().toUpperCase();
    if (gender && !GENDERS.has(gender)) {
      errors.push({ row: rowNum, field: "gender", message: "Use MALE, FEMALE, or OTHER." });
    }

    const dob = row.date_of_birth?.trim();
    if (dob && !DATE_RE.test(dob)) {
      errors.push({ row: rowNum, field: "date_of_birth", message: "Use YYYY-MM-DD." });
    }

    const dietary = row.dietary_preference?.trim();
    if (dietary && !DIETARY.has(dietary)) {
      errors.push({ row: rowNum, field: "dietary_preference", message: "Use Veg or Non-Veg." });
    }

    const medFlag = row.has_medical_history?.trim();
    let hasMedicalHistory: boolean | undefined;
    if (medFlag) {
      const parsed = yesNo(medFlag);
      if (parsed === null) {
        errors.push({ row: rowNum, field: "has_medical_history", message: "Use YES or NO." });
      } else {
        hasMedicalHistory = parsed;
      }
    }

    const addresses: AddressFormValues[] = [];
    for (const prefix of ["address1", "address2"] as const) {
      const addr = buildAddressFromRow(row, prefix);
      if (!addr) continue;

      if (!ADDRESS_TAGS.has(addr.tag)) {
        errors.push({
          row: rowNum,
          field: `${prefix}_tag`,
          message: "Use Home, Work, or Other.",
        });
      }
      if (!addr.street_1 || addr.street_1.length < 5) {
        errors.push({
          row: rowNum,
          field: `${prefix}_street_1`,
          message: "Required when address is provided (min 5 chars).",
        });
      }
      if (!addr.pincode || !/^\d{6}$/.test(addr.pincode)) {
        errors.push({
          row: rowNum,
          field: `${prefix}_pincode`,
          message: "6-digit pincode required when address is provided.",
        });
      }
      addresses.push(addr);
    }

    if (errors.some((e) => e.row === rowNum)) return;

    valid.push({
      rowIndex: rowNum,
      fullName,
      email,
      mobile,
      password,
      gender: gender && GENDERS.has(gender) ? gender : undefined,
      dateOfBirth: dob || undefined,
      dietaryPreference: dietary || undefined,
      allergies: row.allergies?.trim() || undefined,
      hasMedicalHistory,
      medicalHistoryNotes: row.medical_history_notes?.trim() || undefined,
      addresses,
    });
  });

  return { valid, errors };
}

export function validateSubscriptionRows(
  rows: RawRow[],
  knownPlanCodes: Set<string>,
): {
  valid: ParsedSubscriptionRow[];
  errors: RowValidationError[];
} {
  const errors: RowValidationError[] = [];
  const valid: ParsedSubscriptionRow[] = [];

  rows.forEach((row, idx) => {
    const rowNum = idx + 2;
    const customerEmail = row.customer_email?.trim().toLowerCase() ?? "";
    const customerMobile = row.customer_mobile?.trim().replace(/\s/g, "") ?? "";

    if (!customerEmail && !customerMobile) {
      errors.push({
        row: rowNum,
        field: "customer_email",
        message: "customer_email or customer_mobile required.",
      });
    }
    if (customerEmail && !EMAIL_RE.test(customerEmail)) {
      errors.push({ row: rowNum, field: "customer_email", message: "Invalid email." });
    }
    if (customerMobile && !MOBILE_RE.test(customerMobile)) {
      errors.push({ row: rowNum, field: "customer_mobile", message: "Invalid mobile." });
    }

    const modeRaw = row.subscription_mode?.trim().toUpperCase();
    if (!modeRaw || !SUB_MODES.has(modeRaw)) {
      errors.push({
        row: rowNum,
        field: "subscription_mode",
        message: "Use EXISTING or CUSTOM.",
      });
    }
    const mode = modeRaw as "EXISTING" | "CUSTOM";

    const startDate = row.start_date?.trim();
    if (!startDate || !DATE_RE.test(startDate)) {
      errors.push({ row: rowNum, field: "start_date", message: "Use YYYY-MM-DD." });
    }

    const planCode = row.plan_code?.trim();
    if (mode === "EXISTING") {
      if (!planCode) {
        errors.push({ row: rowNum, field: "plan_code", message: "Required for EXISTING mode." });
      } else if (!knownPlanCodes.has(planCode)) {
        errors.push({
          row: rowNum,
          field: "plan_code",
          message: `Unknown plan_code "${planCode}". Download reference sheet.`,
        });
      }
    }

    const endDate = row.end_date?.trim();
    const basePrice = parseOptionalNumber(row.base_price ?? "");
    const taxPercent = parseOptionalNumber(row.tax_percent ?? "");
    const pauseCredits = parseOptionalNumber(row.pause_credits ?? "");

    if (mode === "CUSTOM") {
      if (!endDate || !DATE_RE.test(endDate)) {
        errors.push({ row: rowNum, field: "end_date", message: "Required for CUSTOM mode (YYYY-MM-DD)." });
      }
      if (basePrice === null || basePrice <= 0) {
        errors.push({ row: rowNum, field: "base_price", message: "Positive number required for CUSTOM." });
      }
      if (taxPercent === null || taxPercent < 0 || taxPercent > 100) {
        errors.push({ row: rowNum, field: "tax_percent", message: "0–100 required for CUSTOM." });
      }
      if (pauseCredits === null || pauseCredits < 0 || !Number.isInteger(pauseCredits)) {
        errors.push({
          row: rowNum,
          field: "pause_credits",
          message: "Non-negative integer required for CUSTOM.",
        });
      }
    }

    const mealCode = row.meal_category_code?.trim().toUpperCase();
    if (!mealCode || !MEAL_CODES.has(mealCode)) {
      errors.push({
        row: rowNum,
        field: "meal_category_code",
        message: "Use VEG, EGG, CHICKEN, or MIXED.",
      });
    }

    const deliveryAddress = row.delivery_address?.trim().toUpperCase();
    if (!deliveryAddress || !/^(1|2|PRIMARY)$/.test(deliveryAddress)) {
      errors.push({
        row: rowNum,
        field: "delivery_address",
        message: "Use 1, 2, or PRIMARY.",
      });
    }

    const paymentStatus = row.payment_status?.trim();
    if (!paymentStatus || !PAYMENT_STATUSES.has(paymentStatus)) {
      errors.push({
        row: rowNum,
        field: "payment_status",
        message: 'Use "Payment Collected" or "Payment Pending".',
      });
    }

    if (errors.some((e) => e.row === rowNum)) return;

    valid.push({
      rowIndex: rowNum,
      customerEmail,
      customerMobile,
      mode,
      planCode: planCode || undefined,
      startDate: startDate!,
      endDate: endDate || undefined,
      basePrice: basePrice ?? undefined,
      taxPercent: taxPercent ?? undefined,
      pauseCredits: pauseCredits ?? undefined,
      mealCategoryCode: mealCode!,
      deliveryAddress: deliveryAddress!,
      paymentStatus: paymentStatus as "Payment Collected" | "Payment Pending",
      paymentReference: row.payment_reference?.trim() || undefined,
      paymentNotes: row.payment_notes?.trim() || undefined,
    });
  });

  return { valid, errors };
}
