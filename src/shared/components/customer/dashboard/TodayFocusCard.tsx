import Link from "next/link";
import {
  ArrowRight,
  MapPin,
  Sunrise,
  PauseCircle,
  CalendarClock,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { RotatingFoodImage } from "./RotatingFoodImage";

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
 */
export type TodayFocusState = "active" | "paused" | "empty";

type TodayFocusCardProps = {
  state: TodayFocusState;
  /** Human date label, e.g. "Wednesday, 15 Jul". */
  dateLabel: string;
  /** Primary label for the active state, e.g. "Veg meal". */
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
  /** Where the CTA leads. */
  ctaHref?: string;
  ctaLabel?: string;
  /** Copy shown in the empty state. */
  emptyText?: string;
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
}: TodayFocusCardProps) {
  const showImage = state === "active" && !!images && images.length > 0;

  return (
    // A deliberate 150ms delay so this card arrives as the next beat after the
    // hero settles — the same moment the journey ring/bar begin drawing —
    // rather than popping in simultaneously with it.
    <section className="relative overflow-hidden rounded-3xl border border-orange-100 bg-white shadow-sm animate-in fade-in slide-in-from-bottom-2 duration-500 delay-150 fill-mode-both">
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
              <Sunrise className="h-3.5 w-3.5" />
              Today
            </span>
          </div>

          <div className="flex flex-1 flex-col justify-center gap-4 p-6 sm:p-7">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-slate-500">
                Freshly prepared for you
              </p>
              <span className="text-xs font-medium text-slate-400">
                {dateLabel}
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <h3 className="text-2xl font-semibold tracking-tight text-slate-900">
                {title}
              </h3>
              {tagLabel ? (
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

            {(addressTag || addressLine) && (
              <div className="flex items-start gap-2 text-sm">
                <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                <div className="min-w-0">
                  <p className="font-semibold text-slate-700">
                    On its way to {addressTag || "your address"}
                  </p>
                  {addressLine ? (
                    <p className="truncate text-slate-500">{addressLine}</p>
                  ) : null}
                </div>
              </div>
            )}

            <Link
              href={ctaHref}
              className="group mt-1 inline-flex w-fit items-center justify-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground shadow-sm transition-all duration-200 hover:shadow-md hover:brightness-105 active:scale-[0.98]"
            >
              {ctaLabel}
              <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5" />
            </Link>
          </div>
        </div>
      ) : (
        <div className="relative p-6 sm:p-7">
          <div className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-orange-100/40 blur-2xl" />
          <div className="relative">
            <div className="mb-5 flex items-center justify-between">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-primary">
                <Sunrise className="h-3.5 w-3.5" />
                Today
              </span>
              <span className="text-xs font-medium text-slate-500">
                {dateLabel}
              </span>
            </div>

            {state === "active" && (
              <div className="flex flex-col gap-4">
                <div className="flex flex-wrap items-center gap-3">
                  <h3 className="text-2xl font-semibold tracking-tight text-slate-900">
                    {title}
                  </h3>
                  {tagLabel ? (
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
                {(addressTag || addressLine) && (
                  <div className="flex items-start gap-2 text-sm">
                    <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                    <div className="min-w-0">
                      <p className="font-semibold text-slate-700">
                        On its way to {addressTag || "your address"}
                      </p>
                      {addressLine ? (
                        <p className="truncate text-slate-500">{addressLine}</p>
                      ) : null}
                    </div>
                  </div>
                )}
                <Link
                  href={ctaHref}
                  className="group inline-flex w-fit items-center justify-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground shadow-sm transition-all duration-200 hover:shadow-md hover:brightness-105 active:scale-[0.98]"
                >
                  {ctaLabel}
                  <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5" />
                </Link>
              </div>
            )}

            {state === "paused" && (
              <div className="flex items-center gap-4">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-400">
                  <PauseCircle className="h-6 w-6" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-slate-800">
                    Rest day — delivery paused
                  </h3>
                  <p className="text-sm text-slate-500">
                    No meal today. Your subscription end date has been extended.
                  </p>
                </div>
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
