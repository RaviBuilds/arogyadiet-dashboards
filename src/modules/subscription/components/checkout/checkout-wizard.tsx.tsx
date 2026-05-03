"use client";

import { useEffect, useState } from "react";
import { PlanSelection } from "./step-1-plan";
import { DeliveryDetails } from "./step-2-delivery";
import { useSearchParams } from "next/navigation";
import { PauseSelection } from "@/modules/subscription/components/checkout/step-3-pause";
import { MealCustomization } from "@/modules/subscription/components/checkout/step-4-customization";
// import { MealPlannerConfig } from "./step-3-planner";
// import { OrderPreview } from "./step-4-preview";

export function CheckoutWizard({
  plans,
  profile,
}: {
  plans: any[];
  profile: any;
}) {
  const searchParams = useSearchParams();
  const preSelectedPlan = searchParams.get("plan");
  const [step, setStep] = useState(1);

  const [checkoutData, setCheckoutData] = useState({
    planId:preSelectedPlan || "",
    foodType: profile?.dietary_preference || "Veg",
    startDate: undefined as Date | undefined,
    addressId: "",
    mealOverrides: {} as Record<string, string>,
    pausedDates: [] as string[],
    couponCode: "",
  });

  useEffect(()=>{
    if(preSelectedPlan)
    {
        setCheckoutData(prev=>({...prev, planId:preSelectedPlan}))
    }
  },[preSelectedPlan])
  const nextStep = () => setStep((s) => s + 1);
  const prevStep = () => setStep((s) => s - 1);

  return (
    <div className="max-w-5xl mx-auto py-10 px-4">
      <div className="mb-10 text-center">
        <h1 className="text-3xl font-bold text-zinc-900">New Subscription</h1>
        <p className="text-muted-foreground mt-2">
          Complete these steps to activate your meal plan
        </p>

        {/* Step Progress Bar */}
        <div className="flex items-center justify-center gap-4 mt-6">
          {[1, 2, 3, 4, 5].map((i) => (
            <div
              key={i}
              className={`h-2 w-16 rounded-full transition-all ${step >= i ? "bg-primary" : "bg-zinc-200"}`}
            />
          ))}
        </div>
      </div>

      <div className="bg-white border rounded-2xl shadow-sm p-6 md:p-10">
        {step === 1 && (
          <PlanSelection
            plans={plans}
            data={checkoutData}
            setData={setCheckoutData}
            profilePreference={profile?.dietary_preference}
            onNext={nextStep}
          />
        )}

        {step === 2 && (
          <DeliveryDetails
            data={checkoutData}
            setData={setCheckoutData}
            onNext={nextStep}
            onBack={prevStep}
          />
        )}

       
        {step === 3 && (
          <PauseSelection
            data={checkoutData}
            setData={setCheckoutData}
            plans={plans}
            onNext={nextStep}
            onBack={prevStep}
          />
        )}

        {step === 4 && (
          <MealCustomization
            data={checkoutData}
            plans={plans}
            setData={setCheckoutData}
            onNext={() => setStep(4)} // Goes to Payment next!
            onBack={() => setStep(2)}
          />
        )}
        {/*  step 4 will follow */}
      </div>
    </div>
  );
}
