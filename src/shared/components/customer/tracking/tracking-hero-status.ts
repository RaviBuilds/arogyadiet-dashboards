import type { LucideIcon } from "lucide-react";
import { Bike, ChefHat, DoorOpen, PartyPopper, UserCheck } from "lucide-react";

/**
 * tracking-hero-status — the emotional narrative layer for the Live
 * Tracking hero, deliberately separate from meals' meal-journey-status.ts
 * (that module is frozen for the My Meals card; this one owns the tracking
 * page's own hero copy). Same real `delivery_orders.status` values, mapped
 * to a moment-appropriate headline + reassurance line + icon + tone — never
 * inventing a status that doesn't exist, never showing the raw backend
 * value as the hero.
 */
export type TrackingHeroTone = "amber" | "green" | "slate";

export type TrackingHeroContent = {
  icon: LucideIcon;
  eyebrow: string;
  headline: string;
  body: string;
  tone: TrackingHeroTone;
  /** Whether this moment should show the "Live" pulse + freshness text. */
  isLive: boolean;
};

export function getTrackingHeroContent(
  status: string | null | undefined,
  opts: { hasRiderAssigned: boolean },
): TrackingHeroContent {
  switch (status) {
    case "OUT_FOR_DELIVERY":
    case "PICKED":
    case "ON_THE_WAY":
      return {
        icon: Bike,
        eyebrow: "On its way to you",
        headline: "Your breakfast is almost here",
        body: "Your delivery partner is bringing today's healthy breakfast. Sit back — we'll notify you as soon as they arrive.",
        tone: "green",
        isLive: true,
      };
    case "REACHING_TO_LOCATION":
      return {
        icon: DoorOpen,
        eyebrow: "Almost at your door",
        headline: "We're at your doorstep!",
        body: "Your delivery partner has arrived. Please collect your healthy breakfast.",
        tone: "green",
        isLive: true,
      };
    case "DELIVERED":
      return {
        icon: PartyPopper,
        eyebrow: "Delivered with care",
        headline: "Enjoy your healthy breakfast",
        body: "Today's meal has been successfully delivered. Another small, consistent step toward your transformation.",
        tone: "green",
        isLive: false,
      };
    case "ASSIGNED":
      return {
        icon: UserCheck,
        eyebrow: "Delivery partner assigned",
        headline: "Your delivery partner is getting ready",
        body: "Your meal is packed and a trusted delivery partner has taken charge — they'll be on the road shortly.",
        tone: "amber",
        isLive: false,
      };
    default:
      return {
        icon: ChefHat,
        eyebrow: opts.hasRiderAssigned ? "Getting ready" : "Your kitchen at work",
        headline: "Your breakfast is being prepared",
        body: "Our chefs are getting today's healthy breakfast ready. We'll start live tracking the moment your rider heads out.",
        tone: "slate",
        isLive: false,
      };
  }
}
