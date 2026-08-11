import Link from "next/link";
import { Check, Sparkles } from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * SubscriptionPlanCard — the redesigned premium plan card for
 * "Choose Your Plan". Renders exactly one card; the grid it lives in
 * (SubscriptionPlansGrid) decides layout, so this component makes no
 * assumption about how many other plans exist.
 *
 * Design language: large rounded corners (rounded-3xl, matching every other
 * premium card on /meals and /profile), soft shadow, comfortable spacing,
 * hover elevation + a subtle glow on the featured plan — no new tokens,
 * everything pulled from the existing emerald/amber wellness palette.
 */
export type SubscriptionPlanCardData = {
  id: string;
  name: string;
  duration_days: number;
  pause_credits: number;
  price: number;
  /** Only rendered when the backend already provides it — never computed. */
  per_day_price?: number | null;
  recommended?: boolean | null;
};

export function SubscriptionPlanCard({
  plan,
  isCurrentPlan,
  isProfileComplete,
  hasOutstandingBalance = false,
}: {
  plan: SubscriptionPlanCardData;
  isCurrentPlan: boolean;
  isProfileComplete: boolean;
  /**
   * An unsettled balance on an existing/previous subscription blocks a new
   * purchase (meal-subscription-partial-payment, Phase 5.1). Defaults to false
   * so any other caller of this card is unaffected.
   */
  hasOutstandingBalance?: boolean;
}) {
  const isFeatured = Boolean(plan.recommended);

  return (
    <div
      className={cn(
        "group relative flex h-full flex-col rounded-3xl border bg-white shadow-sm transition-all duration-300",
        "hover:-translate-y-1 hover:shadow-xl",
        isFeatured
          ? "border-emerald-300 shadow-md ring-2 ring-emerald-100"
          : "border-slate-200 hover:border-emerald-200",
      )}
    >
      {/* Subtle glow behind featured cards — decorative, aria-hidden. Sits
          inside an overflow-hidden layer so it never affects card layout
          height (unlike a full-width top ribbon, which would make the
          featured card's header taller than its siblings and throw off
          grid row-stretch, pushing content into the CTA). */}
      {isFeatured ? (
        <div
          aria-hidden="true"
          className="journey-glow-breathe pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-emerald-200/40 blur-3xl"
        />
      ) : null}

      <div className="relative z-10 flex flex-1 flex-col p-6 sm:p-7">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold tracking-tight text-slate-900">
              {plan.name}
            </h3>
            <p className="mt-1 text-sm text-slate-500">
              {plan.duration_days} days of healthy meals
            </p>
          </div>
          {isFeatured ? (
            <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-600 px-2.5 py-1 text-[0.65rem] font-semibold uppercase tracking-wider text-white">
              <Sparkles className="h-3 w-3" />
              Popular
            </span>
          ) : null}
        </div>

        {/* Price presentation — clear hierarchy: large price, muted duration,
            optional per-day equivalent ONLY if the backend already supplies
            it (never calculated here). */}
        <div className="mt-5">
          <div className="flex items-baseline gap-1.5">
            <span className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
              ₹{plan.price.toLocaleString("en-IN")}
            </span>
            <span className="text-sm font-medium text-slate-400">
              /{plan.duration_days} days
            </span>
          </div>
          {typeof plan.per_day_price === "number" && plan.per_day_price > 0 ? (
            <p className="mt-1 text-xs font-medium text-emerald-700">
              ≈ ₹{plan.per_day_price.toLocaleString("en-IN")} per day
            </p>
          ) : null}
        </div>

        {/* Features — grouped, icon-led, no long vertical text blocks. */}
        <ul className="mt-6 flex-1 space-y-3 text-sm text-slate-600">
          <li className="flex items-center gap-2.5">
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-50">
              <Check className="h-3.5 w-3.5 text-emerald-600" />
            </span>
            <span>{plan.duration_days} Premium Meals</span>
          </li>
          <li className="flex items-center gap-2.5">
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-50">
              <Check className="h-3.5 w-3.5 text-emerald-600" />
            </span>
            <span>{plan.pause_credits} Pause Credits</span>
          </li>
          <li className="flex items-center gap-2.5">
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-50">
              <Check className="h-3.5 w-3.5 text-emerald-600" />
            </span>
            <span>Dedicated Delivery Team</span>
          </li>
          <li className="flex items-center gap-2.5">
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-50">
              <Check className="h-3.5 w-3.5 text-emerald-600" />
            </span>
            <span>Customizable Meal Planner</span>
          </li>
        </ul>

        {/* CTA */}
        <div className="mt-6">
          {isCurrentPlan ? (
            <Button
              className="h-12 w-full rounded-full text-base font-semibold"
              variant="outline"
              disabled
            >
              Current Plan
            </Button>
          ) : hasOutstandingBalance ? (
            /* Checked BEFORE the profile gate: a balance due is the blocker the
               customer must resolve first, and completing their profile would
               not unlock anything. The banner above the grid explains why. */
            <Button
              className="h-12 w-full rounded-full text-base font-semibold"
              variant="outline"
              disabled
              title="Clear the outstanding balance on your existing subscription first"
            >
              Balance Due
            </Button>
          ) : isProfileComplete ? (
            <Button
              asChild
              className={cn(
                "h-12 w-full rounded-full text-base font-semibold transition-all duration-200 active:scale-[0.98]",
                isFeatured
                  ? "bg-emerald-600 text-white hover:bg-emerald-700 hover:shadow-md"
                  : "",
              )}
              variant={isFeatured ? "default" : "outline"}
            >
              <Link href={`/subscription/checkout?plan=${plan.id}`}>
                Subscribe Now
              </Link>
            </Button>
          ) : (
            <Button
              className="h-12 w-full rounded-full text-base font-semibold"
              variant="outline"
              disabled
            >
              Subscribe Now
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
