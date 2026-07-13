// src/services/RateConfigService.ts
// Rate configuration resolution and persistence service.
//
// LAYERING: Server-only business logic. Receives an injected Supabase client
// (`db`) mirroring the `BillingService` pattern. This keeps the logic
// deterministic and testable against an in-memory fake client.
//
// Requirements: 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 2.1, 2.2

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  DEFAULT_DELIVERY_RATE_PER_KM,
  DEFAULT_RIDER_PAYOUT_RATE_PER_KM,
  MAX_RATE_PER_KM,
} from "@/lib/delivery/deliveryCharge";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RateScope =
  | { type: "CORE_BUSINESS" }
  | { type: "FRANCHISE"; franchiseId: string };

export type ResolvedRates = {
  deliveryRatePerKm: number;
  riderPayoutRatePerKm: number;
  deliveryRateSource: "franchise" | "core" | "default";
  payoutRateSource: "franchise" | "core" | "default";
};

export type RateField = "delivery_rate_per_km" | "rider_payout_rate_per_km";

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Row shape returned from the rate_configs table. */
interface RateConfigRow {
  id: string;
  scope_type: "CORE_BUSINESS" | "FRANCHISE";
  franchise_id: string | null;
  delivery_rate_per_km: number | null;
  rider_payout_rate_per_km: number | null;
}

/**
 * Fetches the Core Business rate_configs row.
 * Returns null if no row exists (should not happen after seeding).
 */
async function fetchCoreRow(
  db: SupabaseClient,
): Promise<RateConfigRow | null> {
  const { data, error } = await db
    .from("rate_configs")
    .select("id, scope_type, franchise_id, delivery_rate_per_km, rider_payout_rate_per_km")
    .eq("scope_type", "CORE_BUSINESS")
    .maybeSingle();

  if (error) throw error;
  return data as RateConfigRow | null;
}

/**
 * Fetches the franchise-specific rate_configs row.
 * Returns null if no row exists for that franchise.
 */
async function fetchFranchiseRow(
  db: SupabaseClient,
  franchiseId: string,
): Promise<RateConfigRow | null> {
  const { data, error } = await db
    .from("rate_configs")
    .select("id, scope_type, franchise_id, delivery_rate_per_km, rider_payout_rate_per_km")
    .eq("scope_type", "FRANCHISE")
    .eq("franchise_id", franchiseId)
    .maybeSingle();

  if (error) throw error;
  return data as RateConfigRow | null;
}

/**
 * Validates a rate value against Req 1.8 constraints:
 * - Must be >= 0
 * - Must be <= MAX_RATE_PER_KM (999,999.99)
 * - Must have at most 2 decimal places
 */
function validateRate(value: number): string | null {
  if (!Number.isFinite(value)) {
    return "Rate must be a finite number.";
  }
  if (value < 0) {
    return "Rate must not be negative.";
  }
  if (value > MAX_RATE_PER_KM) {
    return `Rate must not exceed ₹${MAX_RATE_PER_KM} per km.`;
  }
  // Check at most 2 decimal places: multiply by 100 and verify it's an integer
  const scaled = Math.round(value * 100);
  if (Math.abs(value * 100 - scaled) > 1e-9) {
    return "Rate must have at most 2 decimal places.";
  }
  return null;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Resolves both the delivery rate and rider payout rate for a clinic,
 * applying the franchise → core → default fallback independently for each
 * rate field.
 *
 * Req 1.3–1.6, 2.1–2.2
 */
export async function resolveRatesForClinic(
  db: SupabaseClient,
  clinic: { id: string; franchise_id: string | null },
): Promise<ResolvedRates> {
  let franchiseRow: RateConfigRow | null = null;

  // If the clinic belongs to a franchise, fetch the franchise rate row
  if (clinic.franchise_id) {
    franchiseRow = await fetchFranchiseRow(db, clinic.franchise_id);
  }

  // Fetch core row (needed for fallback)
  const coreRow = await fetchCoreRow(db);

  // --- Resolve delivery rate ---
  let deliveryRatePerKm: number;
  let deliveryRateSource: "franchise" | "core" | "default";

  if (franchiseRow && franchiseRow.delivery_rate_per_km !== null) {
    deliveryRatePerKm = franchiseRow.delivery_rate_per_km;
    deliveryRateSource = "franchise";
  } else if (coreRow && coreRow.delivery_rate_per_km !== null) {
    deliveryRatePerKm = coreRow.delivery_rate_per_km;
    deliveryRateSource = "core";
  } else {
    deliveryRatePerKm = DEFAULT_DELIVERY_RATE_PER_KM;
    deliveryRateSource = "default";
  }

  // --- Resolve rider payout rate ---
  let riderPayoutRatePerKm: number;
  let payoutRateSource: "franchise" | "core" | "default";

  if (franchiseRow && franchiseRow.rider_payout_rate_per_km !== null) {
    riderPayoutRatePerKm = franchiseRow.rider_payout_rate_per_km;
    payoutRateSource = "franchise";
  } else if (coreRow && coreRow.rider_payout_rate_per_km !== null) {
    riderPayoutRatePerKm = coreRow.rider_payout_rate_per_km;
    payoutRateSource = "core";
  } else {
    riderPayoutRatePerKm = DEFAULT_RIDER_PAYOUT_RATE_PER_KM;
    payoutRateSource = "default";
  }

  return {
    deliveryRatePerKm,
    riderPayoutRatePerKm,
    deliveryRateSource,
    payoutRateSource,
  };
}

/**
 * Resolves only the delivery rate for a clinic (used by the delivery-charge
 * pipeline). Applies the same franchise → core → default fallback.
 *
 * Req 1.3, 1.5, 2.1, 2.2
 */
export async function resolveDeliveryRateForClinic(
  db: SupabaseClient,
  clinic: { id: string; franchise_id: string | null },
): Promise<{ ratePerKm: number; source: "franchise" | "core" | "default" }> {
  // If the clinic belongs to a franchise, check franchise-level rate first
  if (clinic.franchise_id) {
    const franchiseRow = await fetchFranchiseRow(db, clinic.franchise_id);
    if (franchiseRow && franchiseRow.delivery_rate_per_km !== null) {
      return { ratePerKm: franchiseRow.delivery_rate_per_km, source: "franchise" };
    }
  }

  // Fallback to core row
  const coreRow = await fetchCoreRow(db);
  if (coreRow && coreRow.delivery_rate_per_km !== null) {
    return { ratePerKm: coreRow.delivery_rate_per_km, source: "core" };
  }

  // Terminal default (Req 1.3)
  return { ratePerKm: DEFAULT_DELIVERY_RATE_PER_KM, source: "default" };
}

/**
 * Lists all rate configurations for the master card view.
 * Returns the Core row rates plus one entry per franchise (with name).
 *
 * Req 10
 */
export async function listRateConfigs(db: SupabaseClient): Promise<{
  core: { deliveryRatePerKm: number | null; riderPayoutRatePerKm: number | null };
  franchises: Array<{
    franchiseId: string;
    franchiseName: string;
    deliveryRatePerKm: number | null;
    riderPayoutRatePerKm: number | null;
  }>;
}> {
  // Fetch core row
  const coreRow = await fetchCoreRow(db);

  // Fetch all franchises (we need names for all, regardless of whether they
  // have a rate_configs row)
  const { data: franchises, error: franchiseError } = await db
    .from("franchises")
    .select("id, name")
    .order("name");

  if (franchiseError) throw franchiseError;

  // Fetch all franchise rate_configs rows
  const { data: franchiseRates, error: ratesError } = await db
    .from("rate_configs")
    .select("franchise_id, delivery_rate_per_km, rider_payout_rate_per_km")
    .eq("scope_type", "FRANCHISE");

  if (ratesError) throw ratesError;

  // Build a lookup map: franchise_id → rate row
  const rateMap = new Map<string, { delivery_rate_per_km: number | null; rider_payout_rate_per_km: number | null }>();
  for (const row of franchiseRates ?? []) {
    if (row.franchise_id) {
      rateMap.set(row.franchise_id, {
        delivery_rate_per_km: row.delivery_rate_per_km,
        rider_payout_rate_per_km: row.rider_payout_rate_per_km,
      });
    }
  }

  // Map franchises to the output format, merging rate data where it exists
  const franchiseList = (franchises ?? []).map((f: { id: string; name: string }) => {
    const rates = rateMap.get(f.id);
    return {
      franchiseId: f.id,
      franchiseName: f.name,
      deliveryRatePerKm: rates?.delivery_rate_per_km ?? null,
      riderPayoutRatePerKm: rates?.rider_payout_rate_per_km ?? null,
    };
  });

  return {
    core: {
      deliveryRatePerKm: coreRow?.delivery_rate_per_km ?? null,
      riderPayoutRatePerKm: coreRow?.rider_payout_rate_per_km ?? null,
    },
    franchises: franchiseList,
  };
}

/**
 * Upserts a single rate field for a given scope after validating the value.
 *
 * Validation (Req 1.8):
 * - Rejects negative values
 * - Rejects values > MAX_RATE_PER_KM (999,999.99)
 * - Rejects values with more than 2 decimal places
 *
 * On rejection the stored row is untouched and an error string is returned.
 * On success, returns the previous value for the field.
 */
export async function upsertRate(
  db: SupabaseClient,
  scope: RateScope,
  field: RateField,
  value: number,
): Promise<{ ok: true; previous: number | null } | { ok: false; error: string }> {
  // --- Validate ---
  const validationError = validateRate(value);
  if (validationError) {
    return { ok: false, error: validationError };
  }

  // --- Determine scope filters ---
  const scopeType = scope.type === "CORE_BUSINESS" ? "CORE_BUSINESS" : "FRANCHISE";
  const franchiseId = scope.type === "FRANCHISE" ? scope.franchiseId : null;

  // --- Read existing row to get previous value ---
  let existingRow: RateConfigRow | null;
  if (scope.type === "CORE_BUSINESS") {
    existingRow = await fetchCoreRow(db);
  } else {
    existingRow = await fetchFranchiseRow(db, scope.franchiseId);
  }

  const previous = existingRow ? (existingRow[field] ?? null) : null;

  // --- Upsert ---
  if (existingRow) {
    // UPDATE existing row — only the specified field
    const { error } = await db
      .from("rate_configs")
      .update({ [field]: value, updated_at: new Date().toISOString() })
      .eq("id", existingRow.id);

    if (error) {
      return { ok: false, error: `Failed to update rate: ${error.message}` };
    }
  } else {
    // INSERT new row for this scope
    const insertData: Record<string, unknown> = {
      scope_type: scopeType,
      franchise_id: franchiseId,
      [field]: value,
    };

    const { error } = await db.from("rate_configs").insert(insertData);

    if (error) {
      return { ok: false, error: `Failed to insert rate: ${error.message}` };
    }
  }

  return { ok: true, previous };
}
