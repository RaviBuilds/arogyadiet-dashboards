"use client";

import { useEffect, useState } from "react";
import { PlanSelection } from "./step-1-plan";
import { DeliveryDetails } from "./step-2-delivery";
import { useSearchParams } from "next/navigation";
import { MealCustomization } from "./step-4-customization";
import { OrderPreview } from "./step-5-preview";
import { OnboardingHero } from "./onboarding/OnboardingHero";
import { OnboardingStepper } from "./onboarding/OnboardingStepper";
import { cn } from "@/lib/utils";
// import { MealPlannerConfig } from "./step-3-planner";
// import { OrderPreview } from "./step-4-preview";

const WIZARD_STEPS = [
  { label: "Plan" },
  { label: "Delivery" },
  { label: "Meals" },
  { label: "Review" },
] as const;

function resolveInitialFoodType(
  profilePreference: string | undefined,
  categories: { code: string }[],
): string {
  if (profilePreference === "Veg") return "VEG";
  if (profilePreference === "Non-Veg") return "CHICKEN";
  return categories.length > 0 ? categories[0].code : "";
}

export function CheckoutWizard({
  plans,
  profile,
  latestSubscription,
  mealCategories,
  holidaysByDate = {},
}: {
  plans: any[];
  profile: any;
  latestSubscription: any;
  mealCategories: any[];
  holidaysByDate?: Record<string, string>;
}) {
  const searchParams = useSearchParams();
  const preSelectedPlan = searchParams.get("plan");
  const [step, setStep] = useState(1);

  const [checkoutData, setCheckoutData] = useState({
    planId: preSelectedPlan || "",
    foodType: resolveInitialFoodType(
      profile?.dietary_preference,
      mealCategories,
    ),
    startDate: undefined as Date | undefined,
    addressId: "",
    mealOverrides: {} as Record<string, string>,
    pausedDates: [] as string[],
    couponCode: "",
  });

  useEffect(() => {
    if (preSelectedPlan) {
      setCheckoutData((prev) => ({ ...prev, planId: preSelectedPlan }));
    }
  }, [preSelectedPlan]);
  const nextStep = () => setStep((s) => s + 1);
  const prevStep = () => setStep((s) => s - 1);

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-8 sm:space-y-8 sm:py-10">
      {/* Onboarding hero — only shown on Step 1 (Plan), where the customer
          is just beginning; later steps stay focused on their own task
          rather than re-showing the same welcome message every time. */}
      {step === 1 ? <OnboardingHero /> : null}

      <div className="reveal-rise" style={{ ["--reveal-delay" as string]: "150ms" }}>
        <OnboardingStepper steps={WIZARD_STEPS} currentStep={step} />
      </div>

      <div
        className={cn(
          "rounded-3xl border border-slate-100 bg-white p-5 shadow-sm sm:p-8 md:p-10",
          step !== 1 && "border-slate-200",
        )}
      >
        {step === 1 && (
          <PlanSelection
            plans={plans}
            data={checkoutData}
            setData={setCheckoutData}
            profilePreference={profile?.dietary_preference}
            onNext={nextStep}
            mealCategories={mealCategories}
          />
        )}

        {step === 2 && (
          <DeliveryDetails
            data={checkoutData}
            setData={setCheckoutData}
            onNext={nextStep}
            onBack={prevStep}
            latestSubscription={latestSubscription}
          />
        )}

        {step === 3 && (
          <MealCustomization
            data={checkoutData}
            plans={plans}
            setData={setCheckoutData}
            onNext={nextStep}
            onBack={prevStep}
            mealCategories={mealCategories}
            holidaysByDate={holidaysByDate}
          />
        )}
        {step === 4 && (
          <OrderPreview data={checkoutData} plans={plans} onBack={prevStep} />
        )}
      </div>
    </div>
  );
}
