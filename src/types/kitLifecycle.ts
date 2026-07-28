/**
 * KIT Lifecycle Type Definitions
 *
 * Types for the full KIT subscription lifecycle: automated expiration,
 * admin-initiated renewals, customer-facing arrival/start flows,
 * KIT history, and PDF report generation.
 *
 * Requirements: 11.1, 11.6, 11.7
 */

/**
 * Lifecycle states of a KIT subscription
 * - PENDING: KIT ordered/shipped but not yet started by customer
 * - ACTIVE: KIT in use with active daily tracking
 * - EXPIRED: All tracking days consumed
 */
export type KitSubscriptionStatus = "ACTIVE" | "EXPIRED" | "PENDING";

/**
 * Summary of a KIT subscription record
 * Used across services, actions, and components for display and logic
 */
export interface KitSubscriptionSummary {
  id: string;
  customer_profile_id: string;
  status: KitSubscriptionStatus;
  kit_product_id: string;
  kit_product_name: string;
  kit_duration_days: number;
  kit_received_date: string | null;
  kit_tracker_end_date: string | null;
  kit_total_skipped_days: number;
  created_at: string;
}

/**
 * Entry in the KIT History page table
 * Derived from subscription + shipping + daily log data
 */
export interface KitHistoryEntry {
  id: string;
  orderDate: string;
  kitProductName: string;
  kitDays: number;
  daysTakenMeal: number;
  daysSkipped: number;
  status: KitSubscriptionStatus;
  shippingStatus: "Not Shipped" | "Shipped" | "Delivered";
  canDownloadReport: boolean;
}

/**
 * Input for the admin Send New KIT workflow
 * Validated by sendNewKitSchema (Zod) before processing
 */
export interface SendNewKitInput {
  customerProfileId: string;
  kitProductId: string;
  kitDurationDays: number;
  mealPreference: "Veg" | "Egg" | "Chicken";
  addressId: string;
  newAddress?: {
    addressLine: string;
    city: string;
    state: string;
    pinCode: string;
  };
  courierPartner: "OTHER" | "APSRTC" | "TGSRTC" | "DTDC";
  trackingNumber: string;
  trackingUrl?: string;
}

/**
 * Result of checking whether a customer is eligible
 * for a new KIT to be sent by admin
 */
export interface KitEligibility {
  eligible: boolean;
  reason?: "expired" | "expiring_soon" | "not_eligible";
  daysRemaining?: number;
}

/**
 * Result returned by the expiration cron job
 */
export interface ExpireCronsResult {
  success: boolean;
  expired: number;
  error?: string;
}

// ---------------------------------------------------------------------------
// Admin Customer 360 — multi-KIT overview
// ---------------------------------------------------------------------------
//
// A customer can hold several KIT subscriptions over their lifetime, and more
// than one at a time (an ACTIVE kit still being tracked plus a freshly
// dispatched PENDING kit). The admin KIT tab therefore renders a *set* of KIT
// records grouped by lifecycle role rather than a single "current" kit.

/**
 * A single day's tracker entry, as displayed in the admin read-only table.
 *
 * Mirrors every field the customer can submit from the KIT day-log dialog
 * (`dailyLogSchema`) — body metrics, activity, hydration and food intake — so
 * the admin view shows exactly what was entered rather than a subset. The
 * detail fields are optional so callers that only load the core columns still
 * satisfy the type.
 */
export interface AdminKitDailyLog {
  log_date: string;
  status: "FOOD_TAKEN" | "FOOD_SKIPPED";
  physical_activity_minutes: number | null;
  physical_activity_name: string | null;
  weight_kg: number | null;
  step_count?: number | null;
  water_intake_liters?: number | null;
  buttermilk_intake?: string | null;
  fat_consumption?: string | null;
  main_dish?: string | null;
  protein_curry?: string | null;
  veg_curry?: string | null;
  soup_name_qty?: string | null;
  eggs_count?: number | null;
  salads_qty?: string | null;
}

/** Courier/dispatch details attached to one KIT subscription. */
export interface AdminKitShipping {
  courierPartner: string;
  trackingNumber: string;
  trackingUrl: string | null;
  shippedAt: string | null;
  deliveredAt: string | null;
}

/** One KIT subscription with everything the admin KIT tab needs to render it. */
export interface AdminKitRecord {
  subscriptionId: string;
  subscriptionCode: string | null;
  kitProductName: string;
  kitDurationDays: number;
  /** PENDING | ACTIVE | EXPIRED | CANCELLED | STOPPED */
  status: string;
  startsOn: string | null;
  endsOn: string | null;
  basePrice: number | null;
  taxRate: number | null;
  kitReceivedDate: string | null;
  kitTrackerEndDate: string | null;
  kitTotalSkippedDays: number;
  createdAt: string | null;
  shipping: AdminKitShipping | null;
  dailyLogs: AdminKitDailyLog[];
  /** Count of logs with status FOOD_TAKEN. */
  daysTaken: number;
  /** Count of logs with status FOOD_SKIPPED. */
  daysSkipped: number;
}

/**
 * KIT records grouped by lifecycle role.
 *
 * - `current`  — the ACTIVE kit being tracked right now (at most one).
 * - `incoming` — a newly dispatched kit the customer has not started yet
 *                (PENDING). Coexists with `current` when admin sends a new kit
 *                before the running one expires.
 * - `history`  — every closed kit (EXPIRED/CANCELLED/STOPPED), newest first.
 */
export interface AdminKitOverview {
  current: AdminKitRecord | null;
  incoming: AdminKitRecord | null;
  history: AdminKitRecord[];
}
