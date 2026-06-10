"use client";

import { useEffect, useState } from "react";
import { PlanSelection } from "./step-1-plan";
import { DeliveryDetails } from "./step-2-delivery";
import { useSearchParams } from "next/navigation";
import { MealCustomization } from "./step-4-customization";
import { OrderPreview } from "./step-5-preview";
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
    <div className="max-w-5xl mx-auto py-10 px-4">
      <div className="mb-10 text-center">
        <h1 className="text-2xl sm:text-3xl font-semibold text-slate-900 tracking-tight">
          New Subscription
        </h1>
        <p className="text-sm text-slate-500 mt-1">
          Complete these steps to activate your meal plan
        </p>

        <div className="flex items-center justify-center mt-8 max-w-md mx-auto">
          {WIZARD_STEPS.map((wizardStep, index) => {
            const stepNumber = index + 1;
            const isActive = step >= stepNumber;

            return (
              <div key={wizardStep.label} className="flex items-center">
                <div className="flex flex-col items-center gap-2">
                  <div
                    className={cn(
                      "flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold transition-all duration-200",
                      isActive
                        ? "bg-primary text-white"
                        : "bg-slate-100 text-slate-500",
                    )}
                  >
                    {stepNumber}
                  </div>
                  <span
                    className={cn(
                      "text-xs transition-all duration-200",
                      isActive
                        ? "font-medium text-slate-900"
                        : "text-slate-500",
                    )}
                  >
                    {wizardStep.label}
                  </span>
                </div>
                {index < WIZARD_STEPS.length - 1 && (
                  <div
                    className={cn(
                      "h-0.5 w-8 sm:w-12 mx-1 sm:mx-2 mb-6 transition-all duration-200",
                      step > stepNumber ? "bg-primary" : "bg-slate-200",
                    )}
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-6 md:p-8">
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
