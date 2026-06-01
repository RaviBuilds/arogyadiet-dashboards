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
      <section>
        <h2 className="text-xl font-bold mb-6 flex items-center gap-2">
          <span className="bg-primary text-white w-6 h-6 rounded-full flex items-center justify-center text-xs">
            1
          </span>
          Selected subscription plan
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {plans.map((plan: any) => (
            <Card
              key={plan.id}
              className={cn(
                "cursor-pointer border-2 transition-all relative",
                data.planId === plan.id
                  ? "border-primary shadow-md"
                  : "hover:border-zinc-300",
              )}
              onClick={() => setData({ ...data, planId: plan.id })}
            >
              {data.planId === plan.id && (
                <div className="absolute top-2 right-2 text-primary">
                  <CheckCircle2 className="h-5 w-5 fill-primary text-white" />
                </div>
              )}
              <CardContent className="p-6 text-center">
                <p className="font-bold text-zinc-500 uppercase text-xs tracking-widest">
                  {plan.duration_days} Days
                </p>
                <p className="text-3xl font-black my-2">
                  ₹{plan.price.toLocaleString("en-IN")}
                </p>
                <div className="text-[10px] text-muted-foreground border-t pt-2 mt-2">
                  ₹{plan.base_price} Base + ₹{plan.tax_amount} GST
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>
      <section>
        <h2 className="text-xl font-bold mb-6 flex items-center gap-2">
          <span className="bg-primary text-white w-6 h-6 rounded-full flex items-center justify-center text-xs">
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
                  "px-10 h-12 font-semibold transition-all",
                  data.foodType === category.code &&
                    "ring-2 ring-primary ring-offset-2",
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
            <AlertTitle className="font-bold">Dietary Note</AlertTitle>
            <AlertDescription>{warning}</AlertDescription>
          </Alert>
        )}
      </section>
      <div className="pt-8 border-t flex justify-end">
        <Button
          size="lg"
          disabled={!data.planId}
          onClick={onNext}
          className="bg-secondary hover:bg-secondary/90 px-10 text-white font-bold"
        >
          Next: Delivery Details
        </Button>
      </div>
    </div>
  );
}
