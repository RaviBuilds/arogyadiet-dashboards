import { PauseCircle, ShieldCheck, Sprout, Truck } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  SubscriptionPlanCard,
  type SubscriptionPlanCardData,
} from "./SubscriptionPlanCard";

/**
 * SubscriptionPlansGrid — the dynamic grid that MUST adapt to any number of
 * active plans the admin has configured (2, 3, 5, 8, or more), without ever
 * hardcoding a column count.
 *
 * Technique: CSS Grid with `repeat(auto-fit, minmax(300px, 340px))` +
 * `justify-content: center`. Because each track has a capped max width
 * (340px) rather than `1fr`, leftover space is real — which is what lets
 * `justify-content: center` visually center 2 or 3 cards on a wide screen
 * instead of stretching them edge-to-edge, while 5, 8 or more cards simply
 * wrap onto additional centered rows. No column count is ever specified.
 */
export function SubscriptionPlansGrid({
  plans,
  currentPlanId,
  isProfileComplete,
  hasOutstandingBalance = false,
}: {
  plans: SubscriptionPlanCardData[];
  currentPlanId: string | null;
  isProfileComplete: boolean;
  /** Blocks every Subscribe CTA while a balance is owed (Phase 5.1). */
  hasOutstandingBalance?: boolean;
}) {
  if (plans.length === 0) {
    return <EmptyPlansState />;
  }

  return (
    <div className="space-y-8">
      <div
        className="grid justify-center gap-6"
        style={{ gridTemplateColumns: "repeat(auto-fit, minmax(300px, 340px))" }}
      >
        {plans.map((plan) => (
          <SubscriptionPlanCard
            key={plan.id}
            plan={plan}
            isCurrentPlan={plan.id === currentPlanId}
            isProfileComplete={isProfileComplete}
            hasOutstandingBalance={hasOutstandingBalance}
          />
        ))}
      </div>

      {plans.length > 1 ? <DurationComparisonStrip plans={plans} /> : null}

      <ConfidenceStrip />
    </div>
  );
}

/**
 * DurationComparisonStrip — a lightweight "at a glance" comparison instead
 * of a complicated table. Just the durations, laid out as small pills, so
 * the customer can see the range of commitment options in one glance.
 *
 * Only the plan actually flagged `recommended` by the admin is annotated —
 * never inferred from duration/price, so this can never contradict the
 * "Most Popular" badge shown on the card itself above.
 */
function DurationComparisonStrip({
  plans,
}: {
  plans: SubscriptionPlanCardData[];
}) {
  const sorted = [...plans].sort((a, b) => a.duration_days - b.duration_days);

  return (
    <div className="flex flex-wrap items-center justify-center gap-2 rounded-2xl border border-slate-100 bg-slate-50/60 px-5 py-4 sm:gap-3">
      <span className="mr-1 text-xs font-semibold uppercase tracking-wider text-slate-400">
        Compare durations
      </span>
      {sorted.map((plan) => (
        <span
          key={plan.id}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold",
            plan.recommended
              ? "border-emerald-200 bg-emerald-50 text-emerald-700"
              : "border-slate-200 bg-white text-slate-600",
          )}
        >
          {plan.duration_days} Days
          {plan.recommended ? (
            <span className="text-emerald-500">· Popular</span>
          ) : null}
        </span>
      ))}
    </div>
  );
}

/**
 * ConfidenceStrip — a quiet trust-building footer beneath the plans, built
 * only from things that are always true about every plan (no fabricated
 * ratings or stats).
 */
function ConfidenceStrip() {
  const items = [
    { icon: PauseCircle, label: "Flexible pauses" },
    { icon: Sprout, label: "Fresh meals" },
    { icon: Truck, label: "Dedicated delivery" },
    { icon: ShieldCheck, label: "Nutrition-focused plans" },
  ];

  return (
    <div className="flex flex-wrap items-center justify-center gap-x-8 gap-y-3 pt-2">
      {items.map(({ icon: Icon, label }) => (
        <div
          key={label}
          className="flex items-center gap-2 text-sm font-medium text-slate-500"
        >
          <Icon className="h-4 w-4 text-emerald-600" />
          {label}
        </div>
      ))}
    </div>
  );
}

/**
 * EmptyPlansState — premium empty state for when the admin hasn't
 * configured any active plans yet.
 */
function EmptyPlansState() {
  return (
    <div className="reveal-rise flex flex-col items-center gap-4 rounded-3xl border border-dashed border-slate-200 bg-gradient-to-br from-emerald-50/50 via-white to-white px-6 py-14 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-50">
        <Sprout className="h-6 w-6 text-emerald-600" />
      </div>
      <h3 className="text-lg font-semibold text-slate-900">
        No subscription plans are available yet
      </h3>
      <p className="max-w-sm text-sm leading-relaxed text-slate-500">
        Please check back soon — we&apos;re preparing wholesome plans for
        your wellness journey.
      </p>
    </div>
  );
}
