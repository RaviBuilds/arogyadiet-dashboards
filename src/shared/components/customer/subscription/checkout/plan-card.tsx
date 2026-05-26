"use client";
import { Check } from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/shared/components/ui/card";
import { cn } from "@/lib/utils";
import Link from "next/link";

interface PlanCardProps {
  plan: {
    id: string;
    name: string;
    duration_days: number;
    pause_credits: number;
    price: number;
  };
  isPopular?: boolean;
}

export function PlanCard({ plan, isPopular }: PlanCardProps) {
  return (
    <Card
      className={cn(
        "flex flex-col relative overflow-hidden transition-all hover:shadow-md",
        isPopular && "border-secondary border-2 shadow-lg scale-105 z-10",
      )}
    >
      {isPopular && (
        <div className="bg-secondary text-secondary-foreground text-[10px] font-bold uppercase tracking-widest py-1 px-12 absolute top-4 -right-8 rotate-45 shadow-sm">
          Best Value
        </div>
      )}
      <CardHeader>
        <CardTitle className="text-xl font-bold">{plan.name}</CardTitle>
        <CardDescription>
          Perfect for {plan.duration_days} days of healthy meals
        </CardDescription>
      </CardHeader>
      <CardContent className="flex-1 space-y-6">
        <div className="flex items-baseline gap-1">
          <span className="text-4xl font-bold">
            ₹{plan.price.toLocaleString("en-IN")}
          </span>
          <span className="text-muted-foreground text-sm">
            /{plan.duration_days} days
          </span>
        </div>

        <ul className="space-y-3 text-sm">
          <li className="flex items-center gap-2">
            <Check className="h-4 w-4 text-secondary shrink-0" />
            <span>{plan.duration_days} Premium Meals</span>
          </li>
          <li className="flex items-center gap-2">
            <Check className="h-4 w-4 text-secondary shrink-0" />
            <span>{plan.pause_credits} Pause Credits included</span>
          </li>
          <li className="flex items-center gap-2">
            <Check className="h-4 w-4 text-secondary shrink-0" />
            <span>Free Delivery across Hyderabad</span>
          </li>
          <li className="flex items-center gap-2">
            <Check className="h-4 w-4 text-secondary shrink-0" />
            <span>Customizable Meal Planner</span>
          </li>
        </ul>
      </CardContent>
      <CardFooter>
        <Button
          className="w-full font-bold h-11 text-base"
          variant={isPopular ? "default" : "outline"}
          asChild
        >
          <Link href={`/subscription/checkout?plan=${plan.id}`}>
            Subscribe Now
          </Link>
        </Button>
      </CardFooter>
    </Card>
  );
}
