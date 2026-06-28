// src/types/clinic.ts
// TypeScript interfaces for the Business → Kitchen → Clinic hierarchy
// (core-clinic-architecture).
//
// Hierarchy: a Business (typed Core | Franchise) owns one or more Kitchens; a
// Kitchen belongs to exactly one Business (`business_id`) and exactly one City
// (`city_id`) and carries NO address / latitude / longitude. A Clinic belongs to
// exactly one Kitchen (`kitchen_id`) and is the sole rider pickup origin and
// geographic routing origin, so the full address + coordinates live only on the
// Clinic. A Clinic resolves its Business through its Kitchen (Clinic → Kitchen →
// Business) and therefore stores NO `business_id`.
//
// Field names mirror the additive SQL schema (snake_case) and follow the
// convention used by the existing franchise domain types.

/**
 * Discriminator for a Business: a Core operation or a Franchise operation.
 * (Req 20.1, 20.10)
 */
export type BusinessType = "Core" | "Franchise";

/**
 * Top-level grouping entity. A Business owns one or more Kitchens.
 * Backed by the `businesses` table. (Req 20.1)
 */
export interface Business {
  id: string;
  name: string;
  type: BusinessType;
}

/**
 * A geographic city that owns kitchens.
 * Backed by the `cities` table.
 */
export interface City {
  id: string;
  name: string;
}

/**
 * A meal-preparation / workload-aggregation entity (table `kitchens`, retained —
 * not dropped). A Kitchen belongs to exactly one Business (`business_id`, Req 2.2,
 * 20.8) and exactly one City (`city_id`, Req 2.4) and serves many Clinics. It
 * carries NO street address, latitude, or longitude — the geographic routing
 * origin is always the Clinic (Req 2.5).
 */
export interface Kitchen {
  id: string;
  name: string;
  business_id: string; // exactly one Business (Req 2.2, 20.8)
  city_id: string; // exactly one City (Req 2.4)
  // NOTE: no address / latitude / longitude (Req 2.5)
}

/**
 * A rider pickup origin and geographic routing origin.
 * Backed by the `clinics` table. A clinic belongs to exactly one Kitchen
 * (`kitchen_id`) — its Business is resolved through that Kitchen (Req 3.10, 20.9),
 * so a Clinic stores NO `business_id`. A `franchise_id` of `null` denotes a Core
 * Clinic.
 */
export interface Clinic {
  id: string;
  name: string;
  address: string;
  latitude: number;
  longitude: number;
  kitchen_id: string; // Business resolved via Kitchen (Req 3.10, 20.9)
  franchise_id: string | null; // null = Core Clinic
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
}

/**
 * Input shape for finalizing (persisting) a single workload snapshot for one
 * (clinic, kitchen, target_date) combination. `id` is assigned by the database.
 */
export interface WorkloadSnapshotInput {
  clinic_id: string;
  kitchen_id: string;
  target_date: string; // ISO date (YYYY-MM-DD)
  veg_count: number;
  non_veg_count: number;
  egg_count: number;
  shop_product_counts: Record<string, number>;
}

/**
 * The veg / non-veg / egg meal counts derived for a single (clinic, date),
 * computed from the immutable order clinic stamp (Req 19.6).
 */
export interface WorkloadMealCounts {
  veg_count: number;
  non_veg_count: number;
  egg_count: number;
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
 * Order-level clinic stamp (Req 19). Set once at creation, immutable thereafter;
 * `clinic_id` is `null` when the delivery address / rider did not resolve to a
 * clinic (Req 19.8, 19.9).
 */
export interface OrderClinicStamp {
  clinic_id: string | null;
  delivery_date: string; // ISO date
}

/**
 * Discriminated union returned by clinic-domain Server Actions.
 * On failure, `error` carries a human-readable message and `field` optionally
 * identifies the offending input field.
 */
export type ActionResult<T = void> =
  | { success: true; data: T }
  | { success: false; error: string; field?: string };
