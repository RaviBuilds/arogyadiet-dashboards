import {
  ChefHat,
  Utensils,
  UserCheck,
  Truck,
  Navigation,
  CheckCircle2,
  AlertTriangle,
  type LucideIcon,
} from "lucide-react";

/**
 * Delivery order lifecycle — mirrors the real `delivery_orders.status` CHECK
 * constraint (see scripts/*.sql). Kept here (rather than invented) so the
 * dashboard never drifts from what the database actually allows.
 */
export type DeliveryOrderStatus =
  | "ORDER_CREATED"
  | "MEAL_PREPARED"
  | "ASSIGNED"
  | "PICKED"
  | "OUT_FOR_DELIVERY"
  | "ON_THE_WAY"
  | "REACHING_TO_LOCATION"
  | "DELIVERED"
  | "FAILED";

/** Same WhatsApp support surface already used app-wide (FloatingSupportMenu). */
const SUPPORT_WHATSAPP_NUMBER = "918639659020";

type CtaTarget = { label: string; href: string };

export type DeliveryStatusVisual = {
  /** Short line above the title, e.g. "On its way to you". */
  eyebrow: string;
  /** The card's headline for this status. */
  headline: string;
  /** One reassuring sentence — what's happening / what to expect. */
  description: string;
  icon: LucideIcon;
  iconClassName: string;
  iconBgClassName: string;
  /** Whether the delivery address block is still useful at this stage. */
  showAddress: boolean;
  /** Label placed before the address tag, e.g. "On its way to". */
  addressLabel?: string;
  /** Whether the Veg/Chicken meal-type chip is still worth showing. */
  showMealTag: boolean;
  getCta: (ctx: { orderId: string | null }) => CtaTarget;
};

const trackCta = (orderId: string | null): CtaTarget =>
  orderId
    ? { label: "Track Live Delivery", href: `/tracking/${orderId}` }
    : // Order not yet created for tracking — fall back to the plan rather
      // than linking to a page that can't resolve an order.
      { label: "View Meal Plan", href: "/meals" };

const mealPlanCta: CtaTarget = { label: "View Meal Plan", href: "/meals" };
const managePlanCta: CtaTarget = { label: "Manage Plan", href: "/subscription" };
const contactSupportCta: CtaTarget = {
  label: "Contact Support",
  href: `https://wa.me/${SUPPORT_WHATSAPP_NUMBER}?text=${encodeURIComponent(
    "Hi Support, today's meal delivery could not be completed. Could you please help?",
  )}`,
};

/**
 * DELIVERY_STATUS_VISUALS — the single source of truth mapping a delivery
 * status to what the Today's Meal card shows. Adding a future status is a
 * one-line addition here; no JSX conditionals need to change.
 */
export const DELIVERY_STATUS_VISUALS: Record<
  DeliveryOrderStatus,
  DeliveryStatusVisual
> = {
  ORDER_CREATED: {
    eyebrow: "Being prepared for you",
    headline: "Today's meal is being prepared",
    description:
      "Our kitchen has received today's meal request. Fresh preparation will begin before delivery.",
    icon: ChefHat,
    iconClassName: "text-orange-600",
    iconBgClassName: "bg-orange-50",
    showAddress: false,
    showMealTag: true,
    getCta: () => mealPlanCta,
  },
  MEAL_PREPARED: {
    eyebrow: "Freshly prepared for you",
    headline: "Your meal is freshly prepared",
    description:
      "Your meal has been freshly prepared and will be handed to a delivery partner shortly.",
    icon: Utensils,
    iconClassName: "text-orange-600",
    iconBgClassName: "bg-orange-50",
    showAddress: false,
    showMealTag: true,
    getCta: () => mealPlanCta,
  },
  ASSIGNED: {
    eyebrow: "Delivery partner assigned",
    headline: "Your delivery partner is assigned",
    description:
      "Your meal is being prepared and a delivery partner has been assigned.",
    icon: UserCheck,
    iconClassName: "text-blue-600",
    iconBgClassName: "bg-blue-50",
    showAddress: true,
    addressLabel: "Assigned to deliver at",
    showMealTag: true,
    getCta: () => mealPlanCta,
  },
  // PICKED and ON_THE_WAY are operationally the same moment as
  // OUT_FOR_DELIVERY (the rider has the meal and is moving) — grouped rather
  // than inventing near-duplicate screens for transitional statuses.
  PICKED: {
    eyebrow: "On its way to you",
    headline: "Today's meal",
    description: "🚚 On its way to your home",
    icon: Truck,
    iconClassName: "text-emerald-600",
    iconBgClassName: "bg-emerald-50",
    showAddress: true,
    addressLabel: "On its way to",
    showMealTag: true,
    getCta: ({ orderId }) => trackCta(orderId),
  },
  OUT_FOR_DELIVERY: {
    eyebrow: "On its way to you",
    headline: "Today's meal",
    description: "🚚 On its way to your home",
    icon: Truck,
    iconClassName: "text-emerald-600",
    iconBgClassName: "bg-emerald-50",
    showAddress: true,
    addressLabel: "On its way to",
    showMealTag: true,
    getCta: ({ orderId }) => trackCta(orderId),
  },
  ON_THE_WAY: {
    eyebrow: "On its way to you",
    headline: "Today's meal",
    description: "🚚 On its way to your home",
    icon: Truck,
    iconClassName: "text-emerald-600",
    iconBgClassName: "bg-emerald-50",
    showAddress: true,
    addressLabel: "On its way to",
    showMealTag: true,
    getCta: ({ orderId }) => trackCta(orderId),
  },
  REACHING_TO_LOCATION: {
    eyebrow: "Almost at your door",
    headline: "Almost there!",
    // No server-side ETA is currently available on the dashboard (live ETA is
    // computed client-side inside the tracking map from rider GPS + Google
    // Directions) — showing the honest fallback rather than a fabricated time.
    description: "Your delivery partner has reached your area.",
    icon: Navigation,
    iconClassName: "text-emerald-600",
    iconBgClassName: "bg-emerald-50",
    showAddress: true,
    addressLabel: "Arriving at",
    showMealTag: true,
    getCta: ({ orderId }) => trackCta(orderId),
  },
  DELIVERED: {
    eyebrow: "Delivered with care",
    headline: "Today's meal delivered!",
    description:
      "Enjoy your freshly prepared nutritious meal. Every healthy meal brings you one step closer to your transformation.",
    icon: CheckCircle2,
    iconClassName: "text-emerald-600",
    iconBgClassName: "bg-emerald-50",
    // Address no longer provides value once delivered — intentionally hidden.
    showAddress: false,
    showMealTag: true,
    // "View Meal Details" doesn't exist yet as a distinct page — reuse the
    // meal plan route rather than link to something that can't resolve.
    getCta: () => mealPlanCta,
  },
  FAILED: {
    eyebrow: "We hit a snag",
    headline: "Delivery couldn't be completed",
    description:
      "Unfortunately today's meal could not be delivered. Please contact support or view delivery details.",
    icon: AlertTriangle,
    iconClassName: "text-amber-600",
    iconBgClassName: "bg-amber-50",
    showAddress: false,
    showMealTag: false,
    getCta: () => contactSupportCta,
  },
};

/** Manage Plan CTA reused by the paused state (kept here for one source of truth). */
export const MANAGE_PLAN_CTA = managePlanCta;

/**
 * Resolves the visual for a status string coming from the database, safely
 * falling back to the "being prepared" visual for any unrecognised or missing
 * status (e.g. no delivery_orders row yet) rather than guessing or crashing.
 */
export function getDeliveryStatusVisual(
  status: string | null | undefined,
): DeliveryStatusVisual {
  if (status && status in DELIVERY_STATUS_VISUALS) {
    return DELIVERY_STATUS_VISUALS[status as DeliveryOrderStatus];
  }
  return DELIVERY_STATUS_VISUALS.ORDER_CREATED;
}
