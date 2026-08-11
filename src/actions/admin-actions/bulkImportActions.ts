"use server";

import * as XLSX from "xlsx";
import { createAdminClient } from "@/lib/supabase/admin";
import { revalidatePath } from "next/cache";
import { logAdminAction } from "@/lib/logger";
import { checkGroupManage } from "@/lib/auth/adminAccess";
import {
  adminCreateCustomerAction,
  type AdminCreateCustomerData,
} from "@/actions/admin-actions/customerActions";
import { addSubscription } from "@/actions/admin-actions/adminSubscriptionActions";
import { parseSpreadsheetBuffer } from "@/lib/bulk-migration/parse";
import {
  validateCustomerRows,
  validateSubscriptionRows,
  type ParsedCustomerRow,
  type ParsedSubscriptionRow,
  type RowValidationError,
} from "@/lib/bulk-migration/validate";
import {
  CUSTOMER_BULK_HEADERS,
  CUSTOMER_BULK_SAMPLE_ROWS,
  SUBSCRIPTION_BULK_HEADERS,
  SUBSCRIPTION_BULK_SAMPLE_ROWS,
  REFERENCE_MEALS_HEADERS,
  REFERENCE_PLANS_HEADERS,
} from "@/lib/bulk-migration/templates";

export type BulkRowResult = {
  row: number;
  success: boolean;
  identifier: string;
  message?: string;
};

export type BulkImportResult = {
  success: boolean;
  processed: number;
  succeeded: number;
  failed: number;
  validationErrors: RowValidationError[];
  results: BulkRowResult[];
};

async function loadReferenceData() {
  const supabase = createAdminClient();

  const [{ data: plans }, { data: meals }] = await Promise.all([
    supabase
      .from("subscription_plans")
      .select("code, name, duration_days, pause_credits, price")
      .eq("is_active", true)
      .order("price"),
    supabase.from("meal_categories").select("id, code, name").order("name"),
  ]);

  return {
    plans: plans ?? [],
    meals: meals ?? [],
    planCodes: new Set((plans ?? []).map((p) => p.code)),
  };
}

/** Reference data for UI + validation (plan codes, meal codes). */
export async function getBulkMigrationReferenceAction() {
  const { plans, meals } = await loadReferenceData();
  return {
    success: true as const,
    plans,
    meals,
  };
}

function rowsToSheet(headers: readonly string[], sampleRows: Record<string, string>[]) {
  const data = [
    [...headers],
    ...sampleRows.map((row) => headers.map((h) => row[h] ?? "")),
  ];
  return XLSX.utils.aoa_to_sheet(data);
}

/** Build a workbook buffer (base64) with templates + live reference sheets. */
export async function downloadBulkMigrationWorkbookAction() {
  const { plans, meals } = await loadReferenceData();

  const wb = XLSX.utils.book_new();

  XLSX.utils.book_append_sheet(
    wb,
    rowsToSheet(CUSTOMER_BULK_HEADERS, CUSTOMER_BULK_SAMPLE_ROWS),
    "01_customers",
  );
  XLSX.utils.book_append_sheet(
    wb,
    rowsToSheet(SUBSCRIPTION_BULK_HEADERS, SUBSCRIPTION_BULK_SAMPLE_ROWS),
    "02_subscriptions",
  );

  const planRows = [
    [...REFERENCE_PLANS_HEADERS],
    ...plans.map((p) => [
      p.code,
      p.name,
      p.duration_days,
      p.pause_credits,
      p.price,
    ]),
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(planRows), "reference_plans");

  const mealRows = [
    [...REFERENCE_MEALS_HEADERS],
    ...meals.map((m) => [m.code, m.name]),
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(mealRows), "reference_meals");

  const buffer = XLSX.write(wb, { type: "base64", bookType: "xlsx" });
  return {
    success: true as const,
    fileName: "arogyadiet_bulk_migration_templates.xlsx",
    base64: buffer,
  };
}

export async function bulkImportCustomersAction(
  fileBase64: string,
): Promise<BulkImportResult> {
  const gate = await checkGroupManage("customers");
  if (!gate.ok) {
    return {
      success: false,
      processed: 0,
      succeeded: 0,
      failed: 0,
      validationErrors: [],
      results: [
        { row: 0, success: false, identifier: "access", message: gate.error },
      ],
    };
  }

  const buffer = Buffer.from(fileBase64, "base64");
  const rawRows = parseSpreadsheetBuffer(buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength,
  ), "upload");

  const { valid, errors: validationErrors } = validateCustomerRows(rawRows);

  if (valid.length === 0 && validationErrors.length > 0) {
    return {
      success: false,
      processed: 0,
      succeeded: 0,
      failed: 0,
      validationErrors,
      results: [],
    };
  }

  const results: BulkRowResult[] = [];
  let succeeded = 0;
  let failed = 0;

  for (const row of valid) {
    const payload: AdminCreateCustomerData = {
      fullName: row.fullName,
      email: row.email,
      mobile: row.mobile,
      password: row.password,
      gender: row.gender,
      dateOfBirth: row.dateOfBirth,
      dietaryPreference: row.dietaryPreference,
      allergies: row.allergies,
      hasMedicalHistory: row.hasMedicalHistory,
      medicalHistoryNotes: row.medicalHistoryNotes,
      addresses: row.addresses.length > 0 ? row.addresses : undefined,
    };

    const res = await adminCreateCustomerAction(payload);
    if (res.success) {
      succeeded++;
      results.push({
        row: row.rowIndex,
        success: true,
        identifier: row.email,
      });
    } else {
      failed++;
      results.push({
        row: row.rowIndex,
        success: false,
        identifier: row.email,
        message: res.error,
      });
    }
  }

  await logAdminAction("CREATE", "bulk_import", "customers", {
    succeeded,
    failed,
    total: valid.length,
  });

  revalidatePath("/admin/customers");

  return {
    success: failed === 0 && validationErrors.length === 0,
    processed: valid.length,
    succeeded,
    failed,
    validationErrors,
    results,
  };
}

async function resolveCustomerProfileId(
  email: string,
  mobile: string,
): Promise<string | null> {
  const supabase = createAdminClient();

  const lookupByUserField = async (
    field: "email" | "mobile",
    value: string,
  ): Promise<string | null> => {
    if (!value) return null;

    const { data: user } = await supabase
      .from("users")
      .select("id")
      .eq(field, value)
      .maybeSingle();

    if (!user?.id) return null;

    const { data: profile } = await supabase
      .from("customer_profiles")
      .select("id")
      .eq("user_id", user.id)
      .maybeSingle();

    return profile?.id ?? null;
  };

  if (email) {
    const id = await lookupByUserField("email", email);
    if (id) return id;
  }

  if (mobile) {
    return lookupByUserField("mobile", mobile);
  }

  return null;
}

async function resolveDeliveryAddressId(
  customerProfileId: string,
  deliveryAddress: string,
): Promise<string | null> {
  const supabase = createAdminClient();

  const { data: addresses, error } = await supabase
    .from("addresses")
    .select("id, is_primary, created_at")
    .eq("customer_profile_id", customerProfileId)
    .order("created_at", { ascending: true });

  if (error || !addresses?.length) return null;

  const normalized = deliveryAddress.toUpperCase();

  if (normalized === "PRIMARY") {
    const primary = addresses.find((a) => a.is_primary);
    return primary?.id ?? addresses[0].id;
  }

  const index = normalized === "2" ? 1 : 0;
  return addresses[index]?.id ?? addresses[0]?.id ?? null;
}

function buildSubscriptionPayload(
  row: ParsedSubscriptionRow,
  customerProfileId: string,
  mealCategoryId: string,
  deliveryAddressId: string,
) {
  const common = {
    customerProfileId,
    mealCategoryId,
    deliveryAddressId,
    paymentStatus: row.paymentStatus,
    paymentReference: row.paymentReference,
    paymentNotes: row.paymentNotes,
    startDate: row.startDate,
    pastDateEnabled: true,
    skipStartDateCheck: true,
    deliveryCharge: 0,
  };

  if (row.mode === "CUSTOM") {
    const taxAmount = Number(
      ((row.basePrice! * row.taxPercent!) / 100).toFixed(2),
    );
    const totalAmount = Number((row.basePrice! + taxAmount).toFixed(2));

    return {
      isCustom: true as const,
      payload: {
        ...common,
        basePrice: row.basePrice!,
        taxPercent: row.taxPercent!,
        taxAmount,
        totalAmount,
        pauseCredits: row.pauseCredits!,
        endDate: row.endDate!,
      },
    };
  }

  return {
    isCustom: false as const,
    payload: {
      ...common,
      planId: "", // filled by caller
    },
  };
}

export async function bulkImportSubscriptionsAction(
  fileBase64: string,
): Promise<BulkImportResult> {
  const gate = await checkGroupManage("customers");
  if (!gate.ok) {
    return {
      success: false,
      processed: 0,
      succeeded: 0,
      failed: 0,
      validationErrors: [],
      results: [
        { row: 0, success: false, identifier: "access", message: gate.error },
      ],
    };
  }

  const { planCodes, meals } = await loadReferenceData();
  const mealByCode = new Map(meals.map((m) => [m.code.toUpperCase(), m.id]));

  const buffer = Buffer.from(fileBase64, "base64");
  const rawRows = parseSpreadsheetBuffer(
    buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
    "upload",
  );

  const { valid, errors: validationErrors } = validateSubscriptionRows(
    rawRows,
    planCodes,
  );

  if (valid.length === 0 && validationErrors.length > 0) {
    return {
      success: false,
      processed: 0,
      succeeded: 0,
      failed: 0,
      validationErrors,
      results: [],
    };
  }

  const supabase = createAdminClient();
  const planIdByCode = new Map<string, string>();

  if (valid.some((r) => r.mode === "EXISTING")) {
    const codes = [...new Set(valid.map((r) => r.planCode).filter(Boolean))];
    const { data: planRows } = await supabase
      .from("subscription_plans")
      .select("id, code")
      .in("code", codes);

    for (const p of planRows ?? []) {
      planIdByCode.set(p.code, p.id);
    }
  }

  const results: BulkRowResult[] = [];
  let succeeded = 0;
  let failed = 0;

  // Sort by start_date ascending so earlier subscriptions get inserted first (ACTIVE)
  // and later ones for the same customer become PENDING naturally.
  const sorted = [...valid].sort((a, b) =>
    a.startDate.localeCompare(b.startDate),
  );

  for (const row of sorted) {
    const identifier = row.customerEmail || row.customerMobile;

    const customerProfileId = await resolveCustomerProfileId(
      row.customerEmail,
      row.customerMobile,
    );

    if (!customerProfileId) {
      failed++;
      results.push({
        row: row.rowIndex,
        success: false,
        identifier,
        message: "Customer not found. Import customer row first.",
      });
      continue;
    }

    const mealCategoryId = mealByCode.get(row.mealCategoryCode);
    if (!mealCategoryId) {
      failed++;
      results.push({
        row: row.rowIndex,
        success: false,
        identifier,
        message: `Unknown meal category ${row.mealCategoryCode}.`,
      });
      continue;
    }

    const deliveryAddressId = await resolveDeliveryAddressId(
      customerProfileId,
      row.deliveryAddress,
    );

    if (!deliveryAddressId) {
      failed++;
      results.push({
        row: row.rowIndex,
        success: false,
        identifier,
        message: "No delivery address on file. Add address in customer import.",
      });
      continue;
    }

    const built = buildSubscriptionPayload(
      row,
      customerProfileId,
      mealCategoryId,
      deliveryAddressId,
    );

    if (!built.isCustom) {
      const planId = row.planCode ? planIdByCode.get(row.planCode) : undefined;
      if (!planId) {
        failed++;
        results.push({
          row: row.rowIndex,
          success: false,
          identifier,
          message: `Plan not found: ${row.planCode}`,
        });
        continue;
      }
      (built.payload as { planId: string }).planId = planId;
    }

    const res = await addSubscription(built.payload, built.isCustom, {
      skipStartDateCheck: true,
      skipOverlapCheck: true,
      // Migration replays historical subscriptions that predate the
      // partial-payment concept, so the outstanding-balance gate would fail an
      // import on data that is not actually in arrears
      // (meal-subscription-partial-payment, Phase 5.5).
      skipOutstandingBalanceCheck: true,
    });

    if (res.success) {
      succeeded++;
      results.push({ row: row.rowIndex, success: true, identifier });
    } else {
      failed++;
      results.push({
        row: row.rowIndex,
        success: false,
        identifier,
        message: res.error,
      });
    }
  }

  await logAdminAction("CREATE", "bulk_import", "subscriptions", {
    succeeded,
    failed,
    total: valid.length,
  });

  revalidatePath("/admin/customers");
  revalidatePath("/admin/subscriptions");

  return {
    success: failed === 0 && validationErrors.length === 0,
    processed: valid.length,
    succeeded,
    failed,
    validationErrors,
    results,
  };
}
