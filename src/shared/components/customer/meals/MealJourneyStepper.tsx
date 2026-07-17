import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { MEAL_JOURNEY_STAGES } from "./meal-journey-status";

/**
 * MealJourneyStepper — the quiet reinforcement line under the story.
 *
 * Deliberately small and unobtrusive: no labels-as-headline, no loud color
 * blocks. Completed stages are a solid green dot, the current stage glows
 * (a soft pulsing ring) so the eye finds "where we are" at a glance, and
 * future stages sit muted. Hidden entirely for the two exception states
 * (under review / failed) — a linear stepper would misrepresent those, so
 * `stageIndex` is expected to be `null` there and the card skips rendering
 * this component rather than showing a broken line.
 */
export function MealJourneyStepper({ stageIndex }: { stageIndex: number }) {
  return (
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
            <div className="flex flex-col items-center gap-1">
              <span className="relative flex h-4 w-4 items-center justify-center">
                {isCurrent ? (
                  <span className="journey-glow-breathe absolute inset-0 rounded-full bg-emerald-400/50 blur-[2px]" />
                ) : null}
                <span
                  className={cn(
                    "relative flex h-2.5 w-2.5 items-center justify-center rounded-full transition-colors",
                    isDone && "bg-emerald-500",
                    isCurrent && "h-3 w-3 bg-emerald-500 ring-2 ring-emerald-200",
                    !isDone && !isCurrent && "bg-slate-200",
                  )}
                >
                  {isDone ? <Check className="h-2 w-2 text-white" strokeWidth={3} /> : null}
                </span>
              </span>
              <span
                className={cn(
                  "hidden text-[0.65rem] font-medium leading-none sm:block",
                  isCurrent
                    ? "text-emerald-700"
                    : isDone
                      ? "text-slate-500"
                      : "text-slate-400",
                )}
              >
                {stage}
              </span>
            </div>
            {!isLast ? (
              <span
                className={cn(
                  "h-px flex-1 rounded-full",
                  i < stageIndex ? "bg-emerald-300" : "bg-slate-200",
                )}
              />
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
