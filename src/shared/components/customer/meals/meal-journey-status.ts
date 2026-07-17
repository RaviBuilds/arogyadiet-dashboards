import type { JourneyIllustrationId } from "./journey-illustrations";
import type { StatusPillTone } from "@/shared/components/customer/profile-ui/StatusPill";

/**
 * meal-journey-status — the emotional narrative layer for My Meals' "Today's
 * Meal Journey" card.
 *
 * Design intent (per product direction): the backend `delivery_orders.status`
 * value must never be the hero of this page. A customer doesn't care that a
 * row reads `ASSIGNED` — they care that "your delivery partner is ready".
 * So every real, verified status (reconfirmed twice now via Supabase MCP —
 * see the CHECK constraint and actual row counts on delivery_orders) maps to
 * a human hero + reassuring body copy + a calm SVG illustration. The raw
 * status is kept only as a tiny secondary pill — supporting the story,
 * never telling it.
 *
 * Only statuses actually written by the app today are modeled as distinct
 * emotional beats (ORDER_CREATED, ASSIGNED, OUT_FOR_DELIVERY,
 * REACHING_TO_LOCATION, PENDING_FAILURE_APPROVAL, DELIVERED, FAILED).
 * MEAL_PREPARED / PICKED / ON_THE_WAY are in the historical CHECK constraint
 * but no code path writes them anymore (verified: 0 production rows except
 * one legacy ON_THE_WAY row) — they fold into the nearest real neighbour
 * exactly like the dashboard's own delivery-status.ts already does, rather
 * than inventing a screen for a status that doesn't occur.
 */
export type MealJourneyStatus =
  | "ORDER_CREATED"
  | "MEAL_PREPARED"
  | "ASSIGNED"
  | "PICKED"
  | "OUT_FOR_DELIVERY"
  | "ON_THE_WAY"
  | "REACHING_TO_LOCATION"
  | "PENDING_FAILURE_APPROVAL"
  | "DELIVERED"
  | "FAILED";

/** Same WhatsApp support surface already used app-wide (FloatingSupportMenu / dashboard delivery-status). */
const SUPPORT_WHATSAPP_NUMBER = "918639659020";

export type JourneyCta = { label: string; href: string; external?: boolean };

export type MealJourneyVisual = {
  /** Small line above the headline, e.g. "Delivery partner assigned". */
  eyebrow: string;
  /** The one big reassuring line — the actual hero of the card. */
  headline: string;
  /** One or two calm, human sentences. Never backend terminology. */
  body: string;
  illustration: JourneyIllustrationId;
  tone: "orange" | "blue" | "green" | "amber" | "slate";
  /** Tiny secondary pill label + tone — a supporting detail, not the story. */
  pillLabel: string;
  pillTone: StatusPillTone;
  /** Whether a CTA button is worth showing for this beat. */
  cta: ((ctx: { orderId: string | null }) => JourneyCta) | null;
};

const trackCta = (orderId: string | null): JourneyCta =>
  orderId
    ? { label: "Track Live Delivery", href: `/tracking/${orderId}` }
    : { label: "View Meal Plan", href: "/meals" };

const contactSupportCta = (): JourneyCta => ({
  label: "Contact Support",
  href: `https://wa.me/${SUPPORT_WHATSAPP_NUMBER}?text=${encodeURIComponent(
    "Hi Support, today's meal delivery could not be completed. Could you please help?",
  )}`,
  external: true,
});

export const MEAL_JOURNEY_VISUALS: Record<MealJourneyStatus, MealJourneyVisual> = {
  ORDER_CREATED: {
    eyebrow: "Planned for tomorrow",
    headline: "Tomorrow's breakfast is already planned",
    body: "Our kitchen team is preparing everything needed so your healthy meal reaches you fresh tomorrow morning.",
    illustration: "planned",
    tone: "orange",
    pillLabel: "Planned",
    pillTone: "orange",
    cta: null,
  },
  // Folded into ORDER_CREATED's emotional beat — no code path writes this
  // status anymore (see module doc comment).
  MEAL_PREPARED: {
    eyebrow: "Planned for tomorrow",
    headline: "Tomorrow's breakfast is already planned",
    body: "Our kitchen team is preparing everything needed so your healthy meal reaches you fresh tomorrow morning.",
    illustration: "planned",
    tone: "orange",
    pillLabel: "Planned",
    pillTone: "orange",
    cta: null,
  },
  ASSIGNED: {
    eyebrow: "Delivery partner assigned",
    headline: "Your delivery partner is ready",
    body: "We've assigned your meal to one of our trusted delivery partners. Everything is on schedule for tomorrow morning.",
    illustration: "assigned",
    tone: "blue",
    pillLabel: "Assigned",
    pillTone: "blue",
    cta: null,
  },
  // Folded into OUT_FOR_DELIVERY's emotional beat — no code path writes
  // PICKED or ON_THE_WAY anymore (see module doc comment).
  PICKED: {
    eyebrow: "On its way to you",
    headline: "Your healthy breakfast is on the way",
    body: "Your rider has picked up today's meal and is heading towards you.",
    illustration: "out_for_delivery",
    tone: "green",
    pillLabel: "Out for delivery",
    pillTone: "orange",
    cta: ({ orderId }) => trackCta(orderId),
  },
  OUT_FOR_DELIVERY: {
    eyebrow: "On its way to you",
    headline: "Your healthy breakfast is on the way",
    body: "Your rider has picked up today's meal and is heading towards you.",
    illustration: "out_for_delivery",
    tone: "green",
    pillLabel: "Out for delivery",
    pillTone: "orange",
    cta: ({ orderId }) => trackCta(orderId),
  },
  ON_THE_WAY: {
    eyebrow: "On its way to you",
    headline: "Your healthy breakfast is on the way",
    body: "Your rider has picked up today's meal and is heading towards you.",
    illustration: "out_for_delivery",
    tone: "green",
    pillLabel: "Out for delivery",
    pillTone: "orange",
    cta: ({ orderId }) => trackCta(orderId),
  },
  REACHING_TO_LOCATION: {
    eyebrow: "Almost at your door",
    headline: "Your wait is almost over",
    // No ETA here on purpose — a real ETA is only ever computed on the
    // tracking page (client-side, from live GPS + Directions). Showing a
    // fabricated time here would violate "never invent ETA".
    body: "Your rider has reached your area and will arrive shortly.",
    illustration: "reaching",
    tone: "green",
    pillLabel: "Reaching",
    pillTone: "amber",
    cta: ({ orderId }) => trackCta(orderId),
  },
  PENDING_FAILURE_APPROVAL: {
    eyebrow: "Under review",
    headline: "We're reviewing today's delivery",
    body: "Our support team is verifying today's delivery update. If any action is needed, we'll notify you shortly.",
    illustration: "reviewing",
    tone: "slate",
    pillLabel: "Reviewing",
    pillTone: "slate",
    cta: null,
  },
  DELIVERED: {
    eyebrow: "Delivered with care",
    headline: "Enjoy your healthy breakfast",
    body: "Another healthy choice completed. Small consistent habits create lasting transformations.",
    illustration: "delivered",
    tone: "green",
    pillLabel: "Delivered",
    pillTone: "green",
    cta: () => ({ label: "View Meal Plan", href: "/meals" }),
  },
  FAILED: {
    eyebrow: "We hit a snag",
    headline: "We couldn't complete today's delivery",
    body: "Our support team has already been notified. Reach out anytime if you need assistance.",
    illustration: "failed",
    tone: "amber",
    pillLabel: "Failed",
    pillTone: "red",
    cta: () => contactSupportCta(),
  },
};

/**
 * Resolves the visual for a status string coming from the database, safely
 * falling back to the "planned" visual for any unrecognised/missing status
 * (e.g. no delivery_orders row yet for today) rather than guessing or
 * crashing.
 */
export function getMealJourneyVisual(
  status: string | null | undefined,
): MealJourneyVisual {
  if (status && status in MEAL_JOURNEY_VISUALS) {
    return MEAL_JOURNEY_VISUALS[status as MealJourneyStatus];
  }
  return MEAL_JOURNEY_VISUALS.ORDER_CREATED;
}
