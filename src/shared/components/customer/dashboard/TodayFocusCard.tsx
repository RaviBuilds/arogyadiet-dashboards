import Link from "next/link";
import Image from "next/image";
import {
  ArrowRight,
  MapPin,
  Sunrise,
  PauseCircle,
  CalendarClock,
  Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * TodayFocusCard — the daily reassurance moment ("what is happening for me
 * right now"). This is the single most important card on the dashboard for a
 * daily-use wellness app, and now leads with appetizing food imagery.
 *
 * Reusable across customer types: Meal shows today's delivery, KIT shows the
 * day's consumption step, Accommodation shows today's schedule. The card
 * renders one of three states: active focus, a calm rest/paused state, or an
 * empty state.
 */
export type TodayFocusState = "active" | "paused" | "empty";

type TodayFocusCardProps = {
  state: TodayFocusState;
  /** Human date label, e.g. "Wednesday, 15 Jul". */
  dateLabel: string;
  /** Appetizing food photo shown in the active state. */
  imageSrc?: string;
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
  /** Where the CTA leads. */
  ctaHref?: string;
  ctaLabel?: string;
  /** Copy shown in the empty state. */
  emptyText?: string;
};

export function TodayFocusCard({
  state,
  dateLabel,
  imageSrc,
  title,
  tagLabel,
  tagClassName,
  addressTag,
  addressLine,
  ctaHref = "/meals",
  ctaLabel = "View meal plan",
  emptyText = "No delivery scheduled for today. Enjoy your day!",
}: TodayFocusCardProps) {
  return (
    <section className="relative overflow-hidden rounded-3xl border border-orange-100/80 bg-gradient-to-br from-orange-50/70 via-white to-white shadow-sm">
      <div className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-orange-100/40 blur-2xl" />

      <div className="relative p-5 sm:p-6">
        {/* Header row: TODAY eyebrow + date */}
        <div className="mb-4 flex items-center justify-between">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-primary">
            <Sunrise className="h-3.5 w-3.5" />
            Today
          </span>
          <span className="text-xs font-medium text-slate-500">{dateLabel}</span>
        </div>

        {state === "active" && (
          <div className="flex flex-col gap-5 sm:flex-row sm:items-stretch">
            {imageSrc ? (
              <div className="relative h-40 w-full shrink-0 overflow-hidden rounded-2xl sm:h-auto sm:w-48">
                <Image
                  src={imageSrc}
                  alt="Your freshly prepared meal"
                  fill
                  sizes="(max-width: 640px) 100vw, 220px"
                  className="object-cover object-center"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/25 via-transparent to-transparent" />
                <span className="absolute bottom-2.5 left-2.5 inline-flex items-center gap-1 rounded-full bg-white/90 px-2.5 py-1 text-[11px] font-semibold text-emerald-700 shadow-sm backdrop-blur-sm">
                  <Sparkles className="h-3 w-3" />
                  Freshly made
                </span>
              </div>
            ) : null}

            <div className="flex min-w-0 flex-1 flex-col">
              <p className="text-sm font-medium text-slate-500">
                Prepared fresh this morning and on its way
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-3">
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
                <div className="mt-4 flex items-start gap-2 text-sm">
                  <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                  <div className="min-w-0">
                    <p className="font-semibold text-slate-700">
                      {addressTag || "Delivery address"}
                    </p>
                    {addressLine ? (
                      <p className="truncate text-slate-500">{addressLine}</p>
                    ) : null}
                  </div>
                </div>
              )}

              <div className="mt-5 sm:mt-auto sm:pt-5">
                <Link
                  href={ctaHref}
                  className="group inline-flex w-full items-center justify-center gap-2 rounded-full bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground shadow-sm transition-all duration-200 hover:shadow-md hover:brightness-105 active:scale-[0.98] sm:w-auto"
                >
                  {ctaLabel}
                  <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5" />
                </Link>
              </div>
            </div>
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
    </section>
  );
}
