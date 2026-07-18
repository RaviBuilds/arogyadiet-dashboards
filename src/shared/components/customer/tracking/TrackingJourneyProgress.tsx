"use client";

import { useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  MEAL_JOURNEY_STAGES,
  getMealJourneyStageIndex,
} from "@/shared/components/customer/meals/meal-journey-status";

/**
 * TrackingJourneyProgress — the beautiful progress timeline.
 *
 * Reuses the SAME real stage derivation as My Meals' MealJourneyStepper
 * (getMealJourneyStageIndex / MEAL_JOURNEY_STAGES) rather than inventing a
 * parallel "Packed" stage the backend doesn't actually track — consistency
 * over decoration. "Arriving" is presented as "Near you" here to match the
 * tracking page's voice.
 *
 * Collapsible on mobile (starts expanded when a delivery is genuinely in
 * progress, since that's the moment this card matters most).
 */
const DISPLAY_LABELS: Record<(typeof MEAL_JOURNEY_STAGES)[number], string> = {
  Kitchen: "Kitchen",
  Assigned: "Assigned",
  "Out for delivery": "Out for delivery",
  Arriving: "Near you",
  Delivered: "Delivered",
};

export function TrackingJourneyProgress({
  status,
}: {
  status: string | null;
}) {
  const stageIndex = getMealJourneyStageIndex(status);
  const [collapsed, setCollapsed] = useState(false);

  if (stageIndex === null) return null;

  return (
    <div className="reveal-rise rounded-3xl border border-slate-100 bg-white p-5 sm:p-6">
      <button
        type="button"
        onClick={() => setCollapsed((v) => !v)}
        className="flex w-full items-center justify-between gap-2 sm:pointer-events-none"
      >
        <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
          Delivery Journey
        </p>
        <ChevronDown
          className={cn(
            "h-4 w-4 text-slate-400 transition-transform sm:hidden",
            collapsed && "-rotate-90",
          )}
        />
      </button>

      <div className={cn("mt-4", collapsed && "hidden sm:mt-4 sm:block")}>
        <div
          className="flex items-center gap-1.5 sm:gap-2"
          role="group"
          aria-label={`Delivery progress: ${MEAL_JOURNEY_STAGES[stageIndex]}, step ${
            stageIndex + 1
          } of ${MEAL_JOURNEY_STAGES.length}`}
        >
          {MEAL_JOURNEY_STAGES.map((stage, i) => {
            const isDone = i < stageIndex;
            const isCurrent = i === stageIndex;
            const isLast = i === MEAL_JOURNEY_STAGES.length - 1;

            return (
              <div key={stage} className="flex flex-1 items-center gap-1.5 sm:gap-2">
                <div className="flex flex-col items-center gap-1.5">
                  <span className="relative flex h-5 w-5 items-center justify-center">
                    {isCurrent ? (
                      <span className="journey-glow-breathe absolute inset-0 rounded-full bg-emerald-400/50 blur-[2px]" />
                    ) : null}
                    <span
                      className={cn(
                        "relative flex h-3 w-3 items-center justify-center rounded-full transition-colors",
                        isDone && "bg-emerald-500",
                        isCurrent && "h-3.5 w-3.5 bg-emerald-500 ring-2 ring-emerald-200",
                        !isDone && !isCurrent && "bg-slate-200",
                      )}
                    >
                      {isDone ? (
                        <Check className="h-2 w-2 text-white" strokeWidth={3} />
                      ) : null}
                    </span>
                  </span>
                  <span
                    className={cn(
                      "text-center text-[0.65rem] font-medium leading-tight",
                      isCurrent
                        ? "text-emerald-700"
                        : isDone
                          ? "text-slate-500"
                          : "text-slate-400",
                    )}
                  >
                    {DISPLAY_LABELS[stage]}
                  </span>
                </div>
                {!isLast ? (
                  <span
                    className={cn(
                      "mb-4 h-px flex-1 rounded-full",
                      i < stageIndex ? "bg-emerald-300" : "bg-slate-200",
                    )}
                  />
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
