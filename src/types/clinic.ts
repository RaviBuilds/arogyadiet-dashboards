// src/types/clinic.ts
// TypeScript interfaces for the City → Kitchen → Clinic hierarchy (core-clinic-architecture).
// Field names mirror the additive SQL schema (cities, clinics, workload_snapshots tables;
// clinic_id / kitchen_id / city_id columns) and follow the snake_case convention used by
// the existing franchise domain types.

/**
 * A geographic city that owns kitchens.
 * Backed by the `cities` table.
 */
export interface City {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
}

/**
 * An existing meal-preparation / workload-aggregation entity (table `kitchens`,
 * retained — not dropped). After the core-clinic-architecture feature a Kitchen
 * belongs to exactly one City (`city_id`) and serves many Clinics. Only the
 * columns relevant to the clinic hierarchy are modeled here; the underlying
 * table carries additional operational columns.
 */
export interface Kitchen {
  id: string;
  name: string;
  address_text: string | null;
  lat: number | null;
  lng: number | null;
  is_active: boolean;
  city_id: string | null; // null = not yet associated with a City
}

/**
 * A rider pickup origin and geographic routing origin.
 * Backed by the `clinics` table. A clinic belongs to exactly one kitchen
 * (`kitchen_id`) and optionally references a franchise (`franchise_id`).
 * A `franchise_id` of `null` denotes a Core Clinic.
 */
export interface Clinic {
  id: string;
  name: string;
  address: string;
  latitude: number;
  longitude: number;
  kitchen_id: string;
  franchise_id: string | null; // null = Core Clinic
  created_at: string;
  updated_at: string;
}

/**
 * Input shape for creating a clinic (master-portal Core Clinic Management).
 */
export interface ClinicCreateInput {
  name: string;
  address: string;
  latitude: number;
  longitude: number;
  kitchen_id: string;
  franchise_id?: string | null;
}

/**
 * Input shape for editing an existing clinic. All fields optional; only
 * supplied values are updated.
 */
export interface ClinicUpdateInput {
  name?: string;
  address?: string;
  latitude?: number;
  longitude?: number;
  kitchen_id?: string;
  franchise_id?: string | null;
}

/**
 * A persisted, finalized record of a clinic's prep workload for a target date.
 * Backed by the `workload_snapshots` table. Meal counts are non-negative
 * integers; `shop_product_counts` maps a shop product id to its count.
 */
export interface WorkloadSnapshot {
  id: string;
  clinic_id: string;
  kitchen_id: string;
  target_date: string; // ISO date (YYYY-MM-DD)
  veg_count: number;
  non_veg_count: number;
  egg_count: number;
  shop_product_counts: Record<string, number>;
  created_at: string;
}

/**
 * Grouping bucket used when aggregating workload statistics.
 */
export type WorkloadGrouping = "day" | "week" | "month";

/**
 * An aggregated view of workload snapshots grouped day-wise, week-wise, or
 * month-wise, per clinic and per kitchen.
 */
export interface WorkloadAggregate {
  clinic_id: string;
  kitchen_id: string;
  bucket: string; // day/week/month key
  veg_count: number;
  non_veg_count: number;
  egg_count: number;
  shop_product_counts: Record<string, number>;
}

/**
 * Discriminated union returned by clinic-domain Server Actions.
 * On failure, `error` carries a human-readable message and `field` optionally
 * identifies the offending input field.
 */
export type ActionResult<T = void> =
  | { success: true; data: T }
  | { success: false; error: string; field?: string };
