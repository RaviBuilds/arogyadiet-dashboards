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

/**
 * A CTA is one of three shapes, never a dead link:
 *  - "link"     → in-app navigation (existing routes only).
 *  - "external" → opens outside the app (WhatsApp support).
 *  - "expand"   → no destination page exists yet ("Meal Details" isn't a
 *    real route anywhere in the app), so this reveals more of the story
 *    inline instead of navigating somewhere that can't resolve.
 */
export type JourneyCta =
  | { kind: "link"; label: string; href: string }
  | { kind: "external"; label: string; href: string }
  | { kind: "expand"; label: string };

export type MealJourneyVisual = {
  /** Small line above the headline, e.g. "Delivery partner assigned". */
  eyebrow: string;
  /** The one big reassuring line — the actual hero of the card. */
  headline: string;
  /** One or two calm, human sentences. Never backend terminology. */
  body: string;
  illustration: JourneyIllustrationId;
  tone: "orange" | "green" | "amber" | "slate";
  /** Tiny secondary pill label + tone — a supporting detail, not the story. */
  pillLabel: string;
  pillTone: StatusPillTone;
  /** Whether a CTA is worth showing for this beat. */
  cta: ((ctx: { orderId: string | null }) => JourneyCta) | null;
};

const trackCta =
  (label: string) =>
  ({ orderId }: { orderId: string | null }): JourneyCta =>
    orderId
      ? { kind: "link", label, href: `/tracking/${orderId}` }
      : { kind: "link", label: "View Meal Plan", href: "/meals" };

const contactSupportCta = (): JourneyCta => ({
  kind: "external",
  label: "Contact Support",
  href: `https://wa.me/${SUPPORT_WHATSAPP_NUMBER}?text=${encodeURIComponent(
    "Hi Support, today's meal delivery could not be completed. Could you please help?",
  )}`,
});

export const MEAL_JOURNEY_VISUALS: Record<MealJourneyStatus, MealJourneyVisual> = {
  ORDER_CREATED: {
    eyebrow: "Your kitchen at work",
    headline: "Tomorrow's meal is already being planned",
    body: "Our chefs are handpicking fresh ingredients and mapping out tomorrow's meal — the first quiet step in getting a wholesome meal to your door.",
    illustration: "planned",
    tone: "orange",
    pillLabel: "Planned",
    pillTone: "orange",
    cta: null,
  },
  // Folded into ORDER_CREATED's emotional beat — no code path writes this
  // status anymore (see module doc comment).
  MEAL_PREPARED: {
    eyebrow: "Your kitchen at work",
    headline: "Tomorrow's meal is already being planned",
    body: "Our chefs are handpicking fresh ingredients and mapping out tomorrow's meal — the first quiet step in getting a wholesome meal to your door.",
    illustration: "planned",
    tone: "orange",
    pillLabel: "Planned",
    pillTone: "orange",
    cta: null,
  },
  ASSIGNED: {
    eyebrow: "Delivery partner assigned",
    headline: "We've found the perfect delivery partner for today's meal",
    body: "Your meal is packed and ready. A trusted delivery partner has taken charge of getting it to you, right on schedule.",
    illustration: "assigned",
    tone: "amber",
    pillLabel: "Assigned",
    pillTone: "amber",
    cta: () => ({ kind: "expand", label: "View Meal Details" }),
  },
  // Folded into OUT_FOR_DELIVERY's emotional beat — no code path writes
  // PICKED or ON_THE_WAY anymore (see module doc comment).
  PICKED: {
    eyebrow: "On its way to you",
    headline: "Your healthy meal is on the way",
    body: "Your rider has picked up today's meal and is making their way through the morning streets, straight to your door.",
    illustration: "out_for_delivery",
    tone: "green",
    pillLabel: "Out for delivery",
    pillTone: "green",
    cta: trackCta("Track My Rider"),
  },
  OUT_FOR_DELIVERY: {
    eyebrow: "On its way to you",
    headline: "Your healthy meal is on the way",
    body: "Your rider has picked up today's meal and is making their way through the morning streets, straight to your door.",
    illustration: "out_for_delivery",
    tone: "green",
    pillLabel: "Out for delivery",
    pillTone: "green",
    cta: trackCta("Track My Rider"),
  },
  ON_THE_WAY: {
    eyebrow: "On its way to you",
    headline: "Your healthy meal is on the way",
    body: "Your rider has picked up today's meal and is making their way through the morning streets, straight to your door.",
    illustration: "out_for_delivery",
    tone: "green",
    pillLabel: "Out for delivery",
    pillTone: "green",
    cta: trackCta("Track My Rider"),
  },
  REACHING_TO_LOCATION: {
    eyebrow: "Almost at your door",
    headline: "Almost there — your meal is minutes away",
    // No ETA here on purpose — a real ETA is only ever computed on the
    // tracking page (client-side, from live GPS + Directions). Showing a
    // fabricated time here would violate "never invent ETA".
    body: "Your rider has reached your neighbourhood and is closing in on your door.",
    illustration: "reaching",
    tone: "green",
    pillLabel: "Arriving",
    pillTone: "green",
    cta: trackCta("Track Live Location"),
  },
  PENDING_FAILURE_APPROVAL: {
    eyebrow: "Under review",
    headline: "We're double-checking today's delivery",
    body: "Our support team is quietly looking into today's update. If anything needs your attention, we'll reach out shortly.",
    illustration: "reviewing",
    tone: "slate",
    pillLabel: "Reviewing",
    pillTone: "slate",
    cta: null,
  },
  DELIVERED: {
    eyebrow: "Delivered with care",
    headline: "Your healthy meal has arrived",
    body: "Enjoy every nourishing bite. Another small, consistent step toward the transformation you're building.",
    illustration: "delivered",
    tone: "green",
    pillLabel: "Delivered",
    pillTone: "green",
    cta: () => ({ kind: "link", label: "View Meal Plan", href: "/meals" }),
  },
  FAILED: {
    eyebrow: "We hit a snag",
    headline: "Today's delivery didn't go as planned",
    body: "Don't worry — our support team already knows and is on it. Reach out anytime, we're here to help.",
    illustration: "failed",
    tone: "slate",
    pillLabel: "Needs attention",
    pillTone: "slate",
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

/**
 * The quiet 5-stage stepper shown beneath the story. Deliberately NOT a
 * literal list of every backend status — "Packed" isn't a status any code
 * path actually writes (see module doc comment), so it's replaced with
 * "Arriving" which mirrors the real, distinct REACHING_TO_LOCATION status.
 */
export const MEAL_JOURNEY_STAGES = [
  "Kitchen",
  "Assigned",
  "Out for delivery",
  "Arriving",
  "Delivered",
] as const;

/**
 * Maps a status to its stage index in MEAL_JOURNEY_STAGES, or null for the
 * two exception states (under review / failed) that don't belong on a
 * linear progress line.
 */
export function getMealJourneyStageIndex(
  status: string | null | undefined,
): number | null {
  switch (status as MealJourneyStatus | null | undefined) {
    case "ORDER_CREATED":
    case "MEAL_PREPARED":
      return 0;
    case "ASSIGNED":
      return 1;
    case "PICKED":
    case "OUT_FOR_DELIVERY":
    case "ON_THE_WAY":
      return 2;
    case "REACHING_TO_LOCATION":
      return 3;
    case "DELIVERED":
      return 4;
    case "PENDING_FAILURE_APPROVAL":
    case "FAILED":
    default:
      return null;
  }
}
