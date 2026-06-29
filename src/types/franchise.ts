// src/types/franchise.ts
// TypeScript interfaces for the multi-tenant franchise hierarchy
// (multi-tenant-franchise spec — Task 2.1).
//
// Hierarchy: Business (type 'Franchise') → City → Group → Kitchen → Franchise →
// Clinic. This file is the franchise-side companion to the core-clinic
// `src/types/clinic.ts` types and reuses them rather than duplicating shared
// shapes (Clinic, City, the shared `ActionResult<T>` Server Action result).
//
// Field names mirror the additive SQL schema (snake_case), matching the
// convention established by `src/types/clinic.ts` and the rest of `src/types/`.
//
// Resolution rules (encoded by the schema, not by these types):
//   - A Group owns EXACTLY ONE Kitchen (`groups.kitchen_id` UNIQUE NOT NULL).
//   - A Franchise belongs to exactly one Group (`group_id`); its Kitchen,
//     City, and Business are resolved THROUGH the Group
//     (Franchise → Group → Kitchen / City / Business). The legacy
//     `franchises.kitchen_id` anchor is deprecated and is NOT modeled here.
//   - Geo (address / latitude / longitude) lives ONLY on the Clinic.

import type { Clinic, City, ActionResult } from "@/types/clinic";

/**
 * Reuse the shared discriminated Server Action result shape defined once in
 * `src/types/clinic.ts` (re-exported here so franchise-domain modules can import
 * it from `@/types/franchise` without redefining it).
 * (Req 18.1)
 */
export type { ActionResult };

/**
 * Lifecycle status of a Franchise. A franchise is persisted as `onboarding` and
 * transitions onboarding → active → suspended → active. (Req 3.3, 4.x)
 */
export type FranchiseStatus = "onboarding" | "active" | "suspended";

/**
 * A Group sits between City and Kitchen and owns EXACTLY ONE Kitchen
 * (1:1 via `kitchen_id`, UNIQUE NOT NULL at the DB level). A Group belongs to
 * exactly one City (`city_id`). (Req 2.x)
 */
export interface Group {
  id: string;
  name: string;
  city_id: string; // the City this Group belongs to
  kitchen_id: string; // the single Kitchen this Group owns (1:1, UNIQUE)
  created_at: string;
  updated_at: string;
}

/**
 * A Franchise registry entry. A Franchise belongs to exactly one Group
 * (`group_id`); its Kitchen is resolved via the Group, so there is NO
 * `kitchen_id` here (the legacy `franchises.kitchen_id` column is deprecated).
 * Exactly one FRANCHISE_ADMIN owner (`owner_user_id`). (Req 3.1, 3.3)
 */
export interface Franchise {
  id: string;
  name: string;
  group_id: string; // the Group this Franchise belongs to (Kitchen resolved via Group)
  owner_user_id: string; // the single FRANCHISE_ADMIN owner
  status: FranchiseStatus;
  created_at: string;
  updated_at: string;
  // NOTE: no kitchen_id — deprecated; Kitchen resolved via Franchise → Group → Kitchen.
}

/**
 * A franchise City, scoped to a Franchise Business via `business_id`. Reuses the
 * core-clinic `City` shape and adds the owning Business reference. (Req 1.1)
 */
export interface FranchiseCity extends City {
  business_id: string; // the Franchise Business that owns this City
}

/**
 * A franchise Clinic. Reuses the core-clinic `Clinic` shape (geo lives on the
 * Clinic) but narrows `franchise_id` to non-null, since a franchise Clinic always
 * carries its owning Franchise. Its Kitchen is the Franchise's Group's Kitchen
 * (Clinic → Franchise → Group → Kitchen). (Req 6.1)
 */
export interface FranchiseClinic extends Omit<Clinic, "franchise_id"> {
  franchise_id: string; // non-null for franchise clinics
}

/**
 * Metadata for a stored franchise agreement document. The file lives in a private
 * bucket; only this metadata is modeled here. (Req 7.2)
 */
export interface AgreementDocMeta {
  id: string;
  franchise_id: string;
  file_name: string;
  content_type: string; // application/pdf | image/jpeg | image/png
  size_bytes: number; // <= 10 MB (10,485,760 bytes)
  uploaded_at: string;
}

/**
 * A Franchise's single warehouse (one warehouse per Franchise). (Req 19.1)
 */
export interface FranchiseWarehouse {
  id: string;
  franchise_id: string;
  name: string;
}

/**
 * On-hand stock of a product within a franchise warehouse. `franchise_id` is
 * denormalized for tenant isolation (RLS). Quantity is non-negative. (Req 19.1)
 */
export interface FranchiseWarehouseStock {
  id: string;
  warehouse_id: string;
  franchise_id: string; // denormalized for RLS
  product_id: string;
  quantity: number; // >= 0
}

/**
 * A ledger record of a stock transfer into a franchise warehouse. The source may
 * be Core or another Franchise. `source_franchise_id` is null when the source is
 * Core. (Req 19.5)
 */
export interface StockTransfer {
  id: string;
  source_kind: "CORE" | "FRANCHISE";
  source_franchise_id: string | null; // null when source_kind === 'CORE'
  dest_warehouse_id: string;
  dest_franchise_id: string;
  product_id: string;
  quantity: number; // > 0
  created_by: string;
  created_at: string;
}

/**
 * The resolved access scope of an authenticated caller. Mirrors the RLS predicate
 * exactly so neither layer permits what the other denies:
 *   - `full_network` → MASTER_ADMIN / ADMIN (all rows)
 *   - `franchise`    → FRANCHISE_ADMIN (own franchise rows only)
 *   - `core`         → core users (rows with null franchise_id)
 * (Req 18.x)
 */
export type Scope =
  | { kind: "full_network" }
  | { kind: "franchise"; franchise_id: string }
  | { kind: "core" };

// ───────────────────────────────────────────────────────────────────────────
// Legacy flat-spec types (DEPRECATED)
//
// Retained for additive safety while the legacy flat-franchise code is migrated
// to the hierarchy above. These types describe the deprecated
// `franchise_pincodes` model and the franchise RBAC/context helpers that are
// still referenced by existing modules. Do not use them in new hierarchy code.
// ───────────────────────────────────────────────────────────────────────────

/** @deprecated Superseded by `rider_service_areas` (one-pincode-one-clinic). */
export interface FranchisePincode {
  id: string;
  franchise_id: string;
  pincode: string;
  created_at: string;
}

/** @deprecated Use the new {@link Franchise} hierarchy shape. */
export interface FranchiseWithPincodes extends Franchise {
  pincodes: FranchisePincode[];
}

/** @deprecated Legacy create input anchored to a Kitchen. */
export interface FranchiseCreateInput {
  name: string;
  kitchen_id?: string | null;
  owner_user_id?: string | null;
  pincodes?: string[];
}

/** @deprecated Legacy update input anchored to a Kitchen. */
export interface FranchiseUpdateInput {
  name?: string;
  kitchen_id?: string | null;
  owner_user_id?: string | null;
}

/**
 * @deprecated Legacy status-transition record.
 * Valid status transitions: onboarding → active, active → suspended,
 * suspended → active.
 */
export interface FranchiseStatusTransition {
  franchise_id: string;
  from_status: FranchiseStatus;
  to_status: FranchiseStatus;
}

/** @deprecated Superseded by the core-clinic service-area overlap detection. */
export interface FranchisePincodeConflict {
  pincode: string;
  conflicting_entity: "core" | "franchise";
  conflicting_franchise_id?: string;
  conflicting_franchise_name?: string;
}

/** @deprecated Part of the legacy `franchise_pincodes` request flow. */
export type FranchisePincodeRequestStatus = "pending" | "approved" | "rejected";

/** @deprecated Part of the legacy `franchise_pincodes` request flow. */
export interface FranchisePincodeRequest {
  id: string;
  franchise_id: string;
  pincode: string;
  status: FranchisePincodeRequestStatus;
  requested_by: string | null;
  reviewed_by: string | null;
  review_notes: string | null;
  created_at: string;
  reviewed_at: string | null;
}

/**
 * @deprecated Pincode request joined with franchise + requester display info,
 * used in the legacy admin approval queue.
 */
export interface FranchisePincodeRequestWithMeta extends FranchisePincodeRequest {
  franchise_name: string;
  requested_by_name: string | null;
}

/** @deprecated Legacy list filters for the flat franchise registry. */
export interface FranchiseListFilters {
  status?: FranchiseStatus;
  search?: string;
  page?: number;
  per_page?: number;
}

/**
 * User roles relevant to the franchise system. Retained (not deprecated) — these
 * roles are still the canonical RBAC roles used across portals.
 */
export type FranchiseRole =
  | "MASTER_ADMIN"
  | "ADMIN"
  | "FRANCHISE_ADMIN"
  | "RIDER"
  | "CUSTOMER";

/**
 * Franchise context resolved from a user session. Retained (not deprecated) —
 * still the canonical session-scope shape consumed by RBAC components and the
 * franchise stamping helpers.
 */
export interface FranchiseContext {
  role: FranchiseRole;
  franchise_id: string | null; // null = core operation or global access
  franchise_name?: string | null;
  is_franchise_scoped: boolean; // true only for FRANCHISE_ADMIN
}
