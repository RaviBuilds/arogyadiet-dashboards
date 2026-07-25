import Link from "next/link";
import {
  ArrowRight,
  MapPin,
  Sunrise,
  PauseCircle,
  CalendarClock,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { RotatingFoodImage } from "./RotatingFoodImage";
import { getDeliveryStatusVisual } from "./delivery-status";

/**
 * TodayFocusCard — the daily reassurance moment ("what is happening for me
 * right now"). This is the single most important card on the dashboard for a
 * daily-use wellness app.
 *
 * Reusable across customer types: Meal shows today's delivery, KIT shows the
 * day's consumption step, Accommodation shows today's schedule. The card
 * renders one of three states: active focus, a calm rest/paused state, or an
 * empty state. When `imageSrc` is provided the active state shows appetising
 * food photography to make the moment feel warm and inviting.
 *
 * Status-driven content: when `deliveryStatus` is supplied (the Meal
 * dashboard's real `delivery_orders.status`), the headline, description,
 * address visibility/label and CTA are all resolved from
 * `getDeliveryStatusVisual` (see ./delivery-status.ts) instead of the raw
 * `title`/`ctaLabel` props — so the card always reflects what is actually
 * happening with today's meal right now, never stale "on its way" text after
 * delivery. Other consumers (KIT/Accommodation) that don't pass
 * `deliveryStatus` keep the original generic behaviour unchanged.
 */
export type TodayFocusState = "active" | "paused" | "empty";

type TodayFocusCardProps = {
  state: TodayFocusState;
  /** Human date label, e.g. "Wednesday, 15 Jul". */
  dateLabel: string;
  /** Primary label for the active state, e.g. "Veg meal". Ignored when
   *  `deliveryStatus` is provided (the status headline takes over). */
  title?: string;
  /** Meal/category chip label. */
  tagLabel?: string | null;
  /** Tailwind classes for the tag chip (bg/text/border). */
  tagClassName?: string;
  /** Address tag, e.g. "Home". */
  addressTag?: string | null;
  /** Address street line. */
  addressLine?: string | null;
  /** Appetising food images for the active state (auto-crossfade rotation). */
  images?: string[];
  /** Where the CTA leads. Ignored when `deliveryStatus` is provided. */
  ctaHref?: string;
  ctaLabel?: string;
  /** Copy shown in the empty state. */
  emptyText?: string;
  /**
   * Real delivery order status (e.g. "OUT_FOR_DELIVERY", "DELIVERED"). When
   * present, drives headline/description/address/CTA via the shared status
   * config instead of the generic props above.
   */
  deliveryStatus?: string | null;
  /** The today delivery_order id, used to link straight into live tracking. */
  orderId?: string | null;
  /** Copy + CTA override for the paused state (defaults match the standard
   *  "delivery paused" messaging). */
  pausedHeadline?: string;
  pausedDescription?: string;
  pausedCtaHref?: string;
  pausedCtaLabel?: string;
  /**
   * Small caption above the headline in the active state. Only used when
   * `deliveryStatus` is absent (KIT/Accommodation), since a real delivery
   * status supplies its own eyebrow.
   */
  eyebrow?: string;
  /** Supporting sentence under the headline (generic, status-free consumers). */
  description?: string | null;
  /** Label for the info row (defaults to the delivery-oriented "On its way to"). */
  addressLabel?: string;
  /** Icon for the info row (defaults to a map pin). */
  infoIcon?: LucideIcon;
  /** Copy inside the corner chip (defaults to "Today"). */
  badgeLabel?: string;
  /** Icon inside the corner chip (defaults to a sunrise). */
  badgeIcon?: LucideIcon;
  /** Extra content rendered directly above the CTA in the active state. */
  children?: React.ReactNode;
};

export function TodayFocusCard({
  state,
  dateLabel,
  title,
  tagLabel,
  tagClassName,
  addressTag,
  addressLine,
  images,
  ctaHref = "/meals",
  ctaLabel = "View meal plan",
  emptyText = "No delivery scheduled for today. Enjoy your day!",
  deliveryStatus,
  orderId = null,
  pausedHeadline = "Meal delivery is paused",
  pausedDescription = "Your subscription is currently paused. Delivery will automatically resume on your scheduled date.",
  pausedCtaHref = "/subscription",
  pausedCtaLabel = "Manage Plan",
  eyebrow,
  description,
  addressLabel: addressLabelProp,
  infoIcon,
  badgeLabel = "Today",
  badgeIcon: BadgeIcon = Sunrise,
  children,
}: TodayFocusCardProps) {
  const showImage = state === "active" && !!images && images.length > 0;

  // Resolve status-driven content only when a real status was supplied;
  // otherwise fall back to the generic title/CTA props (KIT/Accommodation).
  const visual = deliveryStatus !== undefined ? getDeliveryStatusVisual(deliveryStatus) : null;
  const resolvedTitle = visual ? visual.headline : title;
  const resolvedDescription = visual?.description ?? description ?? null;
  const resolvedCta = visual ? visual.getCta({ orderId }) : { label: ctaLabel, href: ctaHref };
  const showAddressBlock = visual ? visual.showAddress : Boolean(addressTag || addressLine);
  const addressLabel = visual?.addressLabel ?? addressLabelProp ?? "On its way to";
  const showTagChip = visual ? visual.showMealTag : true;
  const StatusIcon = visual?.icon ?? infoIcon ?? MapPin;
  const isExternalCta = resolvedCta.href.startsWith("http");
  const isDelivered = deliveryStatus === "DELIVERED";
  const isFailed = deliveryStatus === "FAILED";

  const ctaButton = isExternalCta ? (
    <a
      href={resolvedCta.href}
      target="_blank"
      rel="noopener noreferrer"
      className="group mt-1 inline-flex w-fit items-center justify-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground shadow-sm transition-all duration-200 hover:shadow-md hover:brightness-105 active:scale-[0.98]"
    >
      {resolvedCta.label}
      <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5" />
    </a>
  ) : (
    <Link
      href={resolvedCta.href}
      className="group mt-1 inline-flex w-fit items-center justify-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground shadow-sm transition-all duration-200 hover:shadow-md hover:brightness-105 active:scale-[0.98]"
    >
      {resolvedCta.label}
      <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5" />
    </Link>
  );

  return (
    // Arrives as the next beat after the hero settles during the reveal
    // cascade (see the reveal system in globals.css).
    <section
      className={cn(
        "reveal-rise relative overflow-hidden rounded-3xl border bg-white shadow-sm",
        isFailed ? "border-amber-200" : "border-orange-100",
      )}
      style={{ ["--reveal-delay" as string]: "1100ms" }}
    >
      {showImage ? (
        // Appetising two-panel layout: food photo + details.
        <div className="flex flex-col sm:flex-row">
          <div className="relative h-44 w-full shrink-0 overflow-hidden sm:h-auto sm:min-h-[13rem] sm:w-2/5">
            <RotatingFoodImage
              images={images as string[]}
              alt="Today's freshly prepared meal"
            />
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/30 to-transparent sm:bg-gradient-to-r sm:from-transparent sm:to-white/5" />
            <span className="absolute left-4 top-4 inline-flex items-center gap-1.5 rounded-full bg-white/90 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-primary shadow-sm backdrop-blur-sm">
              <BadgeIcon className="h-3.5 w-3.5" />
              {badgeLabel}
            </span>
          </div>

          <div className="flex flex-1 flex-col justify-center gap-4 p-6 sm:p-7">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-slate-500">
                {visual ? visual.eyebrow : (eyebrow ?? "Freshly prepared for you")}
              </p>
              <span className="text-xs font-medium text-slate-400">
                {dateLabel}
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <h3 className="text-2xl font-semibold tracking-tight text-slate-900">
                {resolvedTitle}
              </h3>
              {tagLabel && showTagChip ? (
                <span
                  className={cn(
                    "rounded-full border px-3 py-1 text-sm font-semibold tracking-wide",
                    tagClassName,
                  )}
                >
                  {tagLabel}
                </span>
              ) : null}
            </div>

            {resolvedDescription ? (
              <p className="text-sm leading-relaxed text-slate-500">
                {resolvedDescription}
              </p>
            ) : null}

            {isDelivered ? (
              <div className="flex items-start gap-2 text-sm">
                <StatusIcon className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                <p className="font-semibold text-slate-700">
                  Delivered successfully
                </p>
              </div>
            ) : showAddressBlock && (addressTag || addressLine) ? (
              <div className="flex items-start gap-2 text-sm">
                <StatusIcon
                  className={cn(
                    "mt-0.5 h-4 w-4 shrink-0",
                    visual?.iconClassName ?? "text-emerald-600",
                  )}
                />
                <div className="min-w-0">
                  <p className="font-semibold text-slate-700">
                    {addressLabel} {addressTag || "your address"}
                  </p>
                  {addressLine ? (
                    <p className="truncate text-slate-500">{addressLine}</p>
                  ) : null}
                </div>
              </div>
            ) : null}

            {children}

            {ctaButton}
          </div>
        </div>
      ) : (
        <div className="relative p-6 sm:p-7">
          <div
            className={cn(
              "pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full blur-2xl",
              isFailed ? "bg-amber-100/50" : "bg-orange-100/40",
            )}
          />
          <div className="relative">
            <div className="mb-5 flex items-center justify-between">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-primary">
                <BadgeIcon className="h-3.5 w-3.5" />
                {badgeLabel}
              </span>
              <span className="text-xs font-medium text-slate-500">
                {dateLabel}
              </span>
            </div>

            {state === "active" && (
              <div className="flex flex-col gap-4">
                <div className="flex flex-wrap items-center gap-3">
                  <h3 className="text-2xl font-semibold tracking-tight text-slate-900">
                    {resolvedTitle}
                  </h3>
                  {tagLabel && showTagChip ? (
                    <span
                      className={cn(
                        "rounded-full border px-3 py-1 text-sm font-semibold tracking-wide",
                        tagClassName,
                      )}
                    >
                      {tagLabel}
                    </span>
                  ) : null}
                </div>

                {resolvedDescription ? (
                  <p className="text-sm leading-relaxed text-slate-500">
                    {resolvedDescription}
                  </p>
                ) : null}

                {showAddressBlock && (addressTag || addressLine) && (
                  <div className="flex items-start gap-2 text-sm">
                    <StatusIcon
                      className={cn(
                        "mt-0.5 h-4 w-4 shrink-0",
                        visual?.iconClassName ?? "text-emerald-600",
                      )}
                    />
                    <div className="min-w-0">
                      <p className="font-semibold text-slate-700">
                        {addressLabel} {addressTag || "your address"}
                      </p>
                      {addressLine ? (
                        <p className="truncate text-slate-500">{addressLine}</p>
                      ) : null}
                    </div>
                  </div>
                )}

                {children}

                {ctaButton}
              </div>
            )}

            {state === "paused" && (
              <div className="flex flex-col gap-4">
                <div className="flex items-center gap-4">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-400">
                    <PauseCircle className="h-6 w-6" />
                  </div>
                  <div>
                    <h3 className="text-lg font-semibold text-slate-800">
                      {pausedHeadline}
                    </h3>
                    <p className="text-sm text-slate-500">
                      {pausedDescription}
                    </p>
                  </div>
                </div>
                <Link
                  href={pausedCtaHref}
                  className="group inline-flex w-fit items-center justify-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground shadow-sm transition-all duration-200 hover:shadow-md hover:brightness-105 active:scale-[0.98]"
                >
                  {pausedCtaLabel}
                  <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5" />
                </Link>
              </div>
            )}

            {state === "empty" && (
              <div className="flex items-center gap-4">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-500">
                  <CalendarClock className="h-6 w-6" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-slate-800">
                    Nothing scheduled today
                  </h3>
                  <p className="text-sm text-slate-500">{emptyText}</p>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
