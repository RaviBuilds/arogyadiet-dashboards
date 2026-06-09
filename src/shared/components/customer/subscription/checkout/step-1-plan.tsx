"use client";

import { useState } from "react";
import { AlertCircle, CheckCircle2 } from "lucide-react";
import { Card, CardContent } from "@/shared/components/ui/card";
import { Button } from "@/shared/components/ui/button";
import { cn } from "@/lib/utils";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/shared/components/ui/alert";

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

  return (
    <div className="space-y-10">
      <section className="space-y-6">
        <h2 className="text-lg font-semibold text-slate-900 tracking-tight flex items-center gap-3">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-white">
            1
          </span>
          Selected subscription plan
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {plans.map((plan: any) => (
            <Card
              key={plan.id}
              className={cn(
                "cursor-pointer rounded-xl border bg-white shadow-sm transition-all duration-200 relative",
                data.planId === plan.id
                  ? "border-primary ring-2 ring-primary/20 shadow-md"
                  : "border-slate-200 hover:border-slate-300 hover:shadow-md",
              )}
              onClick={() => setData({ ...data, planId: plan.id })}
            >
              {data.planId === plan.id && (
                <div className="absolute top-2 right-2 text-primary">
                  <CheckCircle2 className="h-5 w-5 fill-primary text-white" />
                </div>
              )}
              <CardContent className="p-6 text-center">
                <p className="text-xs font-medium uppercase tracking-wider text-slate-500">
                  {plan.duration_days} Days
                </p>
                <p className="text-3xl font-semibold text-slate-900 my-2">
                  ₹{plan.price.toLocaleString("en-IN")}
                </p>
                <div className="text-xs text-slate-500 border-t border-slate-100 pt-3 mt-3">
                  ₹{plan.base_price} Base + ₹{plan.tax_amount} GST
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>
      <section className="space-y-6">
        <h2 className="text-lg font-semibold text-slate-900 tracking-tight flex items-center gap-3">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-white">
            2
          </span>
          Initial Food Preference
        </h2>
        <div className="flex flex-wrap gap-4">
          {mealCategories.map((category: any) => {
            const label =
              category.code === "CHICKEN"
                ? "Non-Veg"
                : category.code === "VEG"
                  ? "Veg"
                  : category.code === "EGG"
                    ? "Egg"
                    : category.name;

            return (
              <Button
                key={category.code}
                variant={
                  data.foodType === category.code ? "default" : "outline"
                }
                className={cn(
                  "px-10 h-12 rounded-lg font-semibold transition-all duration-200",
                  data.foodType === category.code &&
                    "ring-2 ring-primary ring-offset-2",
                  data.foodType !== category.code && "hover:bg-slate-50",
                )}
                onClick={() => handleFoodTypeChange(category.code)}
              >
                {label}
              </Button>
            );
          })}
        </div>

        {warning && (
          <Alert className="mt-6 border-amber-200 bg-amber-50 text-amber-900">
            <AlertCircle className="h-4 w-4 stroke-amber-600" />
            <AlertTitle className="font-semibold">Dietary Note</AlertTitle>
            <AlertDescription>{warning}</AlertDescription>
          </Alert>
        )}
      </section>
      <div className="pt-8 border-t border-slate-100 flex justify-end">
        <Button
          size="lg"
          variant="secondary"
          disabled={!data.planId}
          onClick={onNext}
          className="px-10 font-semibold transition-all duration-200"
        >
          Next: Delivery Details
        </Button>
      </div>
    </div>
  );
}
