import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * OnboardingStepper — the redesigned wizard stepper for the checkout flow.
 *
 * Same step semantics as before (1-based `currentStep`, four fixed stages —
 * this component only changes presentation, never the step progression
 * logic owned by CheckoutWizard). Large circular milestones connected by a
 * smooth line that fills as the customer progresses: completed steps turn
 * emerald with a checkmark, the current step gently glows, future steps
 * stay muted. Titles sit underneath each milestone.
 */
export type OnboardingStep = { label: string };

export function OnboardingStepper({
  steps,
  currentStep,
}: {
  steps: readonly OnboardingStep[];
  currentStep: number;
}) {
  return (
    <div
      className="mx-auto flex w-full max-w-lg items-start justify-between"
      role="list"
      aria-label="Checkout progress"
    >
      {steps.map((step, index) => {
        const stepNumber = index + 1;
        const isCompleted = currentStep > stepNumber;
        const isCurrent = currentStep === stepNumber;
        const isLast = index === steps.length - 1;

        return (
          <div
            key={step.label}
            role="listitem"
            aria-current={isCurrent ? "step" : undefined}
            className={cn("flex items-center", !isLast && "flex-1")}
          >
            <div className="flex flex-col items-center gap-2">
              <div
                className={cn(
                  "relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-sm font-semibold transition-all duration-300 sm:h-12 sm:w-12",
                  isCompleted
                    ? "bg-emerald-600 text-white"
                    : isCurrent
                      ? "journey-glow-breathe bg-emerald-600 text-white ring-4 ring-emerald-100"
                      : "bg-slate-100 text-slate-400",
                )}
              >
                {isCompleted ? (
                  <Check className="h-5 w-5" strokeWidth={2.5} />
                ) : (
                  stepNumber
                )}
              </div>
              <span
                className={cn(
                  "text-xs font-medium transition-colors duration-300 sm:text-sm",
                  isCompleted || isCurrent ? "text-slate-900" : "text-slate-400",
                )}
              >
                {step.label}
              </span>
            </div>

            {!isLast ? (
              <div className="relative -mt-6 mx-2 h-0.5 flex-1 overflow-hidden rounded-full bg-slate-100 sm:mx-3">
                <div
                  className="h-full rounded-full bg-emerald-600 transition-all duration-500 ease-out"
                  style={{ width: isCompleted ? "100%" : "0%" }}
                />
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
