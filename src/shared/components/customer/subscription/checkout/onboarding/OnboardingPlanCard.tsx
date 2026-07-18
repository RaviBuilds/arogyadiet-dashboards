import { Check, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The exact same four feature lines shown on the /subscription plan cards
 * (SubscriptionPlanCard) — kept identical so a plan looks like the same
 * object whether the customer is browsing or checking out. Nothing here is
 * fetched separately: duration_days and pause_credits are the same fields
 * already selected for this card.
 */
function buildFeatureLines(plan: OnboardingPlanCardData): string[] {
  const lines = [`${plan.duration_days} Premium Meals`];
  if (typeof plan.pause_credits === "number") {
    lines.push(`${plan.pause_credits} Pause Credits`);
  }
  lines.push("Dedicated Delivery Team", "Customizable Meal Planner");
  return lines;
}

/**
 * OnboardingPlanCard — the redesigned selectable plan card for Step 1 of
 * checkout. Visually related to the /subscription page's plan card (same
 * rounded-3xl, emerald wellness palette, featured glow) but built for
 * *selection* rather than a direct "Subscribe Now" link — clicking the
 * whole card selects it, exactly like the original step-1-plan.tsx did.
 *
 * Renders exactly one card; the grid deciding column count lives in the
 * parent, so this makes no assumption about how many sibling plans exist.
 */
export type OnboardingPlanCardData = {
  id: string;
  duration_days: number;
  price: number;
  base_price?: number | null;
  tax_amount?: number | null;
  pause_credits?: number | null;
  recommended?: boolean | null;
};

export function OnboardingPlanCard({
  plan,
  isSelected,
  onSelect,
}: {
  plan: OnboardingPlanCardData;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const isFeatured = Boolean(plan.recommended);
  const featureLines = buildFeatureLines(plan);

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={isSelected}
      className={cn(
        "group relative flex h-full flex-col rounded-3xl border bg-white p-6 text-left shadow-sm transition-all duration-300 sm:p-7",
        "hover:-translate-y-1 hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60",
        isSelected
          ? "-translate-y-1 border-emerald-400 shadow-lg ring-2 ring-emerald-200"
          : isFeatured
            ? "border-emerald-200"
            : "border-slate-200 hover:border-emerald-200",
      )}
    >
      {/* Soft highlight wash when selected — the "elegant selection" instead
          of a thick red border. */}
      {isSelected ? (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 rounded-3xl bg-gradient-to-br from-emerald-50/80 via-transparent to-transparent"
        />
      ) : null}
      {isFeatured ? (
        <div
          aria-hidden="true"
          className="journey-glow-breathe pointer-events-none absolute -right-10 -top-10 h-36 w-36 rounded-full bg-emerald-200/40 blur-3xl"
        />
      ) : null}

      <div className="relative z-10 flex flex-1 flex-col">
        <div className="flex items-start justify-between gap-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
            {plan.duration_days} Days
          </p>

          {/* Animated checkmark on selection, or a tasteful featured badge
              when unselected — never both at once. */}
          {isSelected ? (
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-white animate-in zoom-in-50 duration-200">
              <Check className="h-3.5 w-3.5" strokeWidth={3} />
            </span>
          ) : isFeatured ? (
            <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-600 px-2.5 py-1 text-[0.65rem] font-semibold uppercase tracking-wider text-white">
              <Sparkles className="h-3 w-3" />
              Popular
            </span>
          ) : null}
        </div>

        <p className="mt-3 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
          ₹{plan.price.toLocaleString("en-IN")}
        </p>

        <ul className="mt-4 flex-1 space-y-2 text-xs text-slate-600">
          {featureLines.map((line) => (
            <li key={line} className="flex items-center gap-2">
              <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-emerald-50">
                <Check className="h-2.5 w-2.5 text-emerald-600" />
              </span>
              <span>{line}</span>
            </li>
          ))}
        </ul>

        {typeof plan.base_price === "number" &&
        typeof plan.tax_amount === "number" ? (
          <div className="mt-4 border-t border-slate-100 pt-3 text-xs text-slate-400">
            ₹{plan.base_price.toLocaleString("en-IN")} Base + ₹
            {plan.tax_amount.toLocaleString("en-IN")} GST
          </div>
        ) : null}
      </div>
    </button>
  );
}
