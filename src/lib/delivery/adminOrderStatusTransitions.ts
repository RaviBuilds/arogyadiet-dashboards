export const ADMIN_ORDER_STATUS_TRANSITIONS = {
  OUT_FOR_DELIVERY: {
    next: "REACHING_TO_LOCATION",
    label: "Mark Reaching Location",
    note: "Rider is reaching to location",
  },
  REACHING_TO_LOCATION: {
    next: "DELIVERED",
    label: "Mark Delivered",
    note: "Meal delivered",
  },
} as const;

export const PRE_PICKUP_ORDER_STATUSES = [
  "ASSIGNED",
  "MEAL_PREPARED",
  "ORDER_CREATED",
] as const;

export type AdminOrderStatusKey = keyof typeof ADMIN_ORDER_STATUS_TRANSITIONS;

export function getAdminNextStatusTransition(currentStatus: string) {
  const normalized = currentStatus?.toUpperCase();
  if (!normalized || !(normalized in ADMIN_ORDER_STATUS_TRANSITIONS)) {
    return null;
  }
  return ADMIN_ORDER_STATUS_TRANSITIONS[normalized as AdminOrderStatusKey];
}
