"use client";

import { useMemo, useState } from "react";
import { AlertCircle, Salad, UtensilsCrossed } from "lucide-react";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/shared/components/ui/alert";
import { IconChip } from "@/shared/components/customer/profile-ui/IconChip";
import { OnboardingPlanCard } from "./onboarding/OnboardingPlanCard";
import { FoodPreferenceCard } from "./onboarding/FoodPreferenceCard";
import { OnboardingSummaryBar } from "./onboarding/OnboardingSummaryBar";

const CATEGORY_LABELS: Record<string, string> = {
  VEG: "Vegetarian",
  EGG: "Egg",
  CHICKEN: "Non-Vegetarian",
};

export function PlanSelection({
  plans,
  data,
  setData,
  profilePreference,
  onNext,
  mealCategories,
}: any) {
  const [warning, setWarning] = useState<string | null>(null);

  const handleFoodTypeChange = (code: string) => {
    if (profilePreference === "Veg" && code !== "VEG") {
      setWarning(
        "Are you sure? You have updated 'Veg' in your profile details.",
      );
    } else {
      setWarning(null);
    }
    setData({ ...data, foodType: code });
  };

  // Live summary derived purely from existing selections/plan data — never
  // invented or separately fetched, so it can never drift from the actual
  // checkout state.
  const selectedPlan = useMemo(
    () => plans.find((p: any) => p.id === data.planId) ?? null,
    [plans, data.planId],
  );
  const foodLabel = data.foodType
    ? CATEGORY_LABELS[data.foodType] ??
      mealCategories.find((c: any) => c.code === data.foodType)?.name ??
      null
    : null;

  return (
    <div className="space-y-14">
      <section className="space-y-7">
        <div>
          <div className="flex items-center gap-2.5">
            <IconChip icon={Salad} tone="green" />
            <span className="text-[0.7rem] font-semibold uppercase tracking-[0.2em] text-emerald-700/90">
              Your Meal Plan
            </span>
          </div>
          <h2 className="mt-3 text-xl font-semibold tracking-tight text-slate-900 sm:text-2xl">
            Choose Your Plan
          </h2>
          <p className="mt-1.5 max-w-lg text-sm leading-relaxed text-slate-500">
            Select the meal plan that best fits your lifestyle.
          </p>
        </div>

        <div
          className="grid justify-center gap-5"
          style={{ gridTemplateColumns: "repeat(auto-fit, minmax(220px, 280px))" }}
        >
          {plans.map((plan: any, index: number) => (
            <div
              key={plan.id}
              className="reveal-rise"
              style={{ ["--reveal-delay" as string]: `${index * 60}ms` }}
            >
              <OnboardingPlanCard
                plan={plan}
                isSelected={data.planId === plan.id}
                onSelect={() => setData({ ...data, planId: plan.id })}
              />
            </div>
          ))}
        </div>
      </section>

      {/* Soft organic divider between sections instead of plain whitespace —
          echoes the faint separators used elsewhere in the wellness design
          language rather than a hard rule. */}
      <div
        aria-hidden="true"
        className="h-px w-full bg-gradient-to-r from-transparent via-slate-200 to-transparent"
      />

      <section className="space-y-7">
        <div>
          <div className="flex items-center gap-2.5">
            <IconChip icon={UtensilsCrossed} tone="coral" />
            <span className="text-[0.7rem] font-semibold uppercase tracking-[0.2em] text-primary/80">
              Your Meal Style
            </span>
          </div>
          <h2 className="mt-3 text-xl font-semibold tracking-tight text-slate-900 sm:text-2xl">
            Choose Your Food Preference
          </h2>
          <p className="mt-1.5 max-w-lg text-sm leading-relaxed text-slate-500">
            Tell us how you&apos;d like your meals prepared to start.
          </p>
        </div>

        <div className="flex flex-col gap-4 sm:flex-row">
          {mealCategories.map((category: any) => (
            <FoodPreferenceCard
              key={category.code}
              code={category.code}
              name={category.name}
              isSelected={data.foodType === category.code}
              onSelect={() => handleFoodTypeChange(category.code)}
            />
          ))}
        </div>

        {warning && (
          <Alert className="border-amber-200 bg-amber-50 text-amber-900 animate-in fade-in slide-in-from-top-2">
            <AlertCircle className="h-4 w-4 stroke-amber-600" />
            <AlertTitle className="font-semibold">Dietary Note</AlertTitle>
            <AlertDescription>{warning}</AlertDescription>
          </Alert>
        )}
      </section>

      <OnboardingSummaryBar
        items={[
          selectedPlan
            ? { label: "Selected Plan", value: `${selectedPlan.duration_days} Days` }
            : null,
          foodLabel ? { label: "Meal Preference", value: foodLabel } : null,
          selectedPlan
            ? {
                label: "Estimated Total",
                value: `₹${selectedPlan.price.toLocaleString("en-IN")}`,
                emphasize: true,
              }
            : null,
        ].filter((item): item is NonNullable<typeof item> => item !== null)}
        emptyLabel="Select a plan to see your summary"
        continueLabel="Continue to Delivery Details"
        disabled={!data.planId}
        onContinue={onNext}
      />
    </div>
  );
}
