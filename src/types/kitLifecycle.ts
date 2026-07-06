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
