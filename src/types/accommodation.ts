/**
 * Accommodation Domain Type Definitions
 *
 * Types for the complete ACCOMMODATION customer category lifecycle:
 * stay management, health tracking, add-on services, and billing.
 *
 * Requirements: 1.1, 4.1, 9.1, 11.1
 */

/**
 * Lifecycle states of a Stay Entry
 * - PENDING: Stay booked but start date is in the future
 * - ACTIVE: Guest is currently staying (start date <= today <= end date)
 * - FINISHED: Stay completed (end date has passed)
 * - EXPIRED: Admin marked as no-show (guest never arrived)
 */
export type StayStatus = "PENDING" | "ACTIVE" | "FINISHED" | "EXPIRED";

/**
 * Accommodation type options
 * - AC Villa: Air-conditioned villa accommodation
 * - Village Style Hut: Traditional village-style hut accommodation
 */
export type StayType = "AC Villa" | "Village Style Hut";

/**
 * Room occupancy configuration
 * - Single: Single occupancy
 * - Double: Double occupancy
 */
export type OccupancyType = "Single" | "Double";

/**
 * Meal preference for accommodation guests
 */
export type MealPreference = "VEG" | "EGG" | "CHICKEN";

/**
 * Status of an add-on wellness service request
 * - PENDING: Request submitted, awaiting confirmation
 * - CONFIRMED: Request confirmed by admin
 * - COMPLETED: Service has been delivered
 */
export type AddonServiceStatus = "PENDING" | "CONFIRMED" | "COMPLETED";

/**
 * A single accommodation booking record representing one continuous stay period.
 * Central domain entity decoupled from meal subscriptions.
 */
export interface StayEntry {
  id: string;
  customerProfileId: string;
  startDate: string; // ISO date (YYYY-MM-DD)
  totalNights: number;
  stayType: StayType;
  occupancyType: OccupancyType;
  status: StayStatus;
  paymentAmount: number | null;
  baseAmount: number | null;
  taxAmount: number | null;
  taxPercentage: number;
  paymentHostProfileId: string | null;
  mealPreference: MealPreference;
  endDate: string; // computed: startDate + totalNights - 1
  createdAt: string;
  updatedAt: string;
}

/**
 * Daily health data entered by the customer.
 * Tracks water intake and physical activity during the stay.
 * Upserted on conflict (stay_entry_id + log_date) — one entry per day per stay.
 */
export interface CustomerHealthLog {
  id: string;
  stayEntryId: string;
  logDate: string;
  waterIntakeLiters: number;
  activityName: string | null;
  activityDurationMinutes: number | null;
  createdAt: string;
}

/**
 * Daily health monitoring data entered by the admin.
 * Tracks weight, blood pressure, sugar level, and notes during checkups.
 */
export interface AdminHealthLog {
  id: string;
  stayEntryId: string;
  logDate: string;
  weightKg: number | null;
  bpSystolic: number | null;
  bpDiastolic: number | null;
  sugarLevelMgdl: number | null;
  notes: string | null;
  createdAt: string;
}

/**
 * A request for an additional wellness service (therapy, massage, etc.)
 * submitted by an accommodation customer during their stay.
 */
export interface AddonServiceRequest {
  id: string;
  customerProfileId: string;
  stayEntryId: string;
  serviceType: string;
  status: AddonServiceStatus;
  requestedAt: string;
}
