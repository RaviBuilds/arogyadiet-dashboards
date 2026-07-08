// Feature: onboarding-past-date-flexibility — shared types for past-date
// onboarding flow (Past Day Status Popup, server action, service layer).

/**
 * Represents the delivery status for a single past day during onboarding.
 * Captured via the Past Day Status Popup when an admin selects a past start date.
 *
 * - Delivered days require mealType and deliveryAddress.
 * - Skipped days have mealType and deliveryAddress set to null.
 */
export interface PastDayStatus {
  /** Calendar date in YYYY-MM-DD format. */
  date: string;
  /** Whether the meal was delivered or skipped on this day. */
  mealStatus: "Delivered" | "Skipped";
  /** Meal category for delivered days; null for skipped days. */
  mealType: "VEG" | "EGG" | "CHICKEN" | null;
  /** Delivery address used for delivered days; null for skipped days. */
  deliveryAddress: "Primary" | "Secondary" | null;
}
