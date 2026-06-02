export const FAILED_DELIVERY_REASONS = [
  "Gate not open",
  "Customer not available",
  "Denied meals",
  "Other",
] as const;

export type FailedDeliveryReason = (typeof FAILED_DELIVERY_REASONS)[number];
