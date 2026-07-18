import {
  ChefHat,
  UserCheck,
  Truck,
  Navigation,
  CheckCircle2,
  AlertTriangle,
  PauseCircle,
  CalendarClock,
  Clock,
  Drumstick,
  Egg,
  Wheat,
  Salad,
  Soup,
  type LucideIcon,
} from "lucide-react";
import type { StatusPillTone } from "@/shared/components/customer/profile-ui/StatusPill";

/**
 * Meal-history status → visual mapping for the Subscription Timeline.
 *
 * Kept separate from `dashboard/delivery-status.ts` (which drives the
 * Today's Meal card and must stay frozen). This maps the same real
 * `delivery_orders.status` values, plus `is_paused` and future/past
 * `PENDING` rows, onto the brief's fixed 7-colour system:
 * Preparing=blue, Assigned=purple, Out for delivery=orange, Reaching=amber,
 * Delivered=green, Failed=red, Paused=gray. Upcoming (a future day with no
 * order yet) gets its own neutral "slate" so it's visually distinct from
 * every executed state.
 */
export type HistoryStatusVisual = {
  label: string;
  tone: StatusPillTone;
  icon: LucideIcon;
};

export function getHistoryStatusVisual(
  status: string,
  isPaused: boolean,
  date: string,
): HistoryStatusVisual {
  if (isPaused) {
    return { label: "Paused", tone: "slate", icon: PauseCircle };
  }

  if (status === "PENDING" && new Date(date) > new Date()) {
    return { label: "Upcoming", tone: "slate", icon: CalendarClock };
  }

  switch (status) {
    case "ORDER_CREATED":
    case "MEAL_PREPARED":
    case "PENDING":
      return { label: "Preparing", tone: "blue", icon: ChefHat };
    case "ASSIGNED":
      return { label: "Assigned", tone: "purple", icon: UserCheck };
    case "PICKED":
    case "OUT_FOR_DELIVERY":
    case "ON_THE_WAY":
      return { label: "Out for delivery", tone: "orange", icon: Truck };
    case "REACHING_TO_LOCATION":
      return { label: "Reaching", tone: "amber", icon: Navigation };
    case "PENDING_FAILURE_APPROVAL":
      return { label: "Reviewing", tone: "slate", icon: Clock };
    case "DELIVERED":
      return { label: "Delivered", tone: "green", icon: CheckCircle2 };
    case "FAILED":
      return { label: "Failed", tone: "red", icon: AlertTriangle };
    default:
      return { label: "Preparing", tone: "blue", icon: ChefHat };
  }
}

/**
 * Meal-name → Lucide icon, for the Meal History journal rows.
 *
 * Mirrors the same substring matching the admin operations tables already
 * use for `meal_categories.name` (see `getMealLabel` in
 * admin/operations/PlannedDeliveries.tsx) — no new categorisation invented,
 * just a calm icon paired with the same real label already shown.
 */
export function getMealIcon(mealName: string | null | undefined): LucideIcon {
  if (!mealName) return Soup;
  const upper = mealName.toUpperCase();
  if (upper.includes("CHICKEN") || upper.includes("NON-VEGETARIAN")) return Drumstick;
  if (upper.includes("EGG")) return Egg;
  if (upper.includes("MILLET")) return Wheat;
  if (upper.includes("MIXED")) return Soup;
  if (upper.includes("VEGETARIAN") || upper === "VEG") return Salad;
  return Soup;
}
