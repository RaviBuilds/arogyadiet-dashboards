import { calculateHaversineDistanceKm } from "@/lib/distance";

// ─── Constants ───────────────────────────────────────────────────────────────

export const DEFAULT_DELIVERY_RATE_PER_KM = 13.0;
export const DEFAULT_RIDER_PAYOUT_RATE_PER_KM = 16.0;
export const MAX_RATE_PER_KM = 999_999.99;
export const MASTER_CARD_MAX_RATE_PER_KM = 9_999.99;
export const MAX_DELIVERY_CHARGE = 999_999.99;
export const MIN_PLAN_DAYS = 1;
export const MAX_PLAN_DAYS = 365;

// ─── Rounding ────────────────────────────────────────────────────────────────

/**
 * Rounds a number using round-half-up (commercial rounding) to the specified
 * number of decimal places. Uses integer scaling to avoid binary-float bias
 * (e.g. 2.675 correctly rounds to 2.68, not 2.67).
 */
export function roundHalfUp(value: number, decimals: number = 2): number {
  if (!Number.isFinite(value)) return value;
  if (decimals < 0) decimals = 0;

  const factor = Math.pow(10, decimals);
  // Shift to integer domain using string-based correction for float issues
  // e.g. 2.675 * 100 = 267.49999... in float, but we need 267.5
  // Using Number(value + 'e' + decimals) avoids intermediate float rounding
  const shifted = Number(value + "e" + decimals);
  const rounded = Math.round(shifted);
  return Number(rounded + "e-" + decimals);
}

// ─── Coordinate validation ───────────────────────────────────────────────────

export type Coordinate = { lat: number; lng: number };

/** Returns true if lat is in [-90, 90] inclusive and is a finite number. */
export function isValidLat(lat: number): boolean {
  return Number.isFinite(lat) && lat >= -90 && lat <= 90;
}

/** Returns true if lng is in [-180, 180] inclusive and is a finite number. */
export function isValidLng(lng: number): boolean {
  return Number.isFinite(lng) && lng >= -180 && lng <= 180;
}

// ─── Distance computation ────────────────────────────────────────────────────

export type DistanceResult =
  | { ok: true; distanceKm: number }
  | { ok: false; reason: "missing_coordinates" }
  | { ok: false; reason: "invalid_coordinates" };

/**
 * Computes the delivery distance (straight-line Haversine, NO 1.3 road
 * multiplier) between a customer's address and the serving clinic.
 *
 * Returns a discriminated union:
 * - `missing_coordinates` if any coordinate is null
 * - `invalid_coordinates` if any non-null coordinate is out of valid range
 * - `{ ok: true, distanceKm }` with the distance rounded half-up to 2 decimals
 */
export function computeDeliveryDistanceKm(
  address: { lat: number | null; lng: number | null },
  clinic: { latitude: number | null; longitude: number | null },
): DistanceResult {
  // Check for null coordinates → missing_coordinates
  if (
    address.lat === null ||
    address.lng === null ||
    clinic.latitude === null ||
    clinic.longitude === null
  ) {
    return { ok: false, reason: "missing_coordinates" };
  }

  // Check for out-of-range coordinates → invalid_coordinates
  if (
    !isValidLat(address.lat) ||
    !isValidLng(address.lng) ||
    !isValidLat(clinic.latitude) ||
    !isValidLng(clinic.longitude)
  ) {
    return { ok: false, reason: "invalid_coordinates" };
  }

  // Compute straight-line Haversine distance (no 1.3 multiplier — design D1)
  const rawDistance = calculateHaversineDistanceKm(
    address.lat,
    address.lng,
    clinic.latitude,
    clinic.longitude,
  );

  return { ok: true, distanceKm: roundHalfUp(rawDistance, 2) };
}

// ─── Charge calculation ──────────────────────────────────────────────────────

export type ChargeInput = {
  ratePerKm: number;
  distanceKm: number;
  planDays: number;
};

export type ChargeResult =
  | {
      ok: true;
      distanceKm: number;
      ratePerKm: number;
      perDayCharge: number;
      totalDeliveryCharge: number;
    }
  | {
      ok: false;
      reason: "invalid_input";
      field: "ratePerKm" | "distanceKm" | "planDays";
    };

/**
 * Helper to check if a value is a valid finite number (not null, NaN, or
 * Infinity).
 */
function isFiniteNumber(val: unknown): val is number {
  return typeof val === "number" && Number.isFinite(val);
}

/**
 * Calculates the delivery charge given rate, distance, and plan days.
 *
 * Validates:
 * - ratePerKm must be a finite number >= 0
 * - distanceKm must be a finite number >= 0
 * - planDays must be a finite integer in [1, 365]
 *
 * Computes:
 * - perDay = roundHalfUp(rate × distance, 2)
 * - total = roundHalfUp(perDay × planDays, 2)
 *
 * No tax is applied (Req 4.4).
 */
export function calculateDeliveryCharge(input: ChargeInput): ChargeResult {
  const { ratePerKm, distanceKm, planDays } = input;

  // Validate ratePerKm
  if (!isFiniteNumber(ratePerKm) || ratePerKm < 0) {
    return { ok: false, reason: "invalid_input", field: "ratePerKm" };
  }

  // Validate distanceKm
  if (!isFiniteNumber(distanceKm) || distanceKm < 0) {
    return { ok: false, reason: "invalid_input", field: "distanceKm" };
  }

  // Validate planDays: must be a finite integer in [MIN_PLAN_DAYS, MAX_PLAN_DAYS]
  if (
    !isFiniteNumber(planDays) ||
    !Number.isInteger(planDays) ||
    planDays < MIN_PLAN_DAYS ||
    planDays > MAX_PLAN_DAYS
  ) {
    return { ok: false, reason: "invalid_input", field: "planDays" };
  }

  // Compute charges with round-half-up to 2 decimals
  const perDayCharge = roundHalfUp(ratePerKm * roundHalfUp(distanceKm, 2), 2);
  const totalDeliveryCharge = roundHalfUp(perDayCharge * planDays, 2);

  return {
    ok: true,
    distanceKm: roundHalfUp(distanceKm, 2),
    ratePerKm,
    perDayCharge,
    totalDeliveryCharge,
  };
}

// ─── Total payable ───────────────────────────────────────────────────────────

/**
 * Computes Total_Payable = roundHalfUp(planPrice + totalDeliveryCharge + miscCharge, 2).
 *
 * `miscCharge` is the optional admin-entered miscellaneous charge (additional
 * products, one-off services). It defaults to 0 so existing two-argument
 * callers keep their previous behaviour exactly.
 */
export function calculateTotalPayable(
  planPrice: number,
  totalDeliveryCharge: number,
  miscCharge: number = 0,
): number {
  return roundHalfUp(planPrice + totalDeliveryCharge + miscCharge, 2);
}
