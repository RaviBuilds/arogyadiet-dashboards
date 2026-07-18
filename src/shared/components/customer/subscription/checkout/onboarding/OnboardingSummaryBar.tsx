import { ArrowLeft, ArrowRight } from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import { cn } from "@/lib/utils";

export type OnboardingSummaryItem = {
  label: string;
  value: string;
  emphasize?: boolean;
};

/**
 * OnboardingSummaryBar — the live selection summary + primary CTA shared by
 * every step of the checkout wizard. Replaces each step's disconnected
 * "Next" button with a sticky action bar: summary on the left (desktop) /
 * above the button (mobile), Continue (and optional Back) on the right.
 *
 * Every value shown here is passed in by the caller from data already
 * loaded/selected in the wizard's own state — nothing is computed or
 * invented in this component. Generic `items` list so each step can show
 * whatever fields are relevant to it (plan/food on Step 1, date/address on
 * Step 2, etc.) without this component knowing about checkout semantics.
 */
export function OnboardingSummaryBar({
  items,
  emptyLabel = "Complete this step to see your summary",
  continueLabel,
  disabled,
  onContinue,
  backLabel,
  onBack,
}: {
  items: OnboardingSummaryItem[];
  emptyLabel?: string;
  continueLabel: string;
  disabled: boolean;
  onContinue: () => void;
  backLabel?: string;
  onBack?: () => void;
}) {
  const hasSummary = items.length > 0;

  return (
    <div
      className={cn(
        // -mx-5 cancels the wizard card's own p-5 mobile padding exactly, so
        // this bar breaks out to true full-bleed edges on small screens
        // instead of leaving a slim gap. sm:+ it resets back to a normal
        // inset card since the bar stops being sticky there.
        "sticky bottom-0 z-30 -mx-5 mt-2 border-t border-slate-100 bg-white/95 px-5 py-4 backdrop-blur-md sm:static sm:z-auto sm:mx-0 sm:mt-6 sm:rounded-3xl sm:border sm:border-slate-100 sm:px-6 sm:py-5 sm:shadow-sm",
      )}
    >
      <div className="mx-auto flex max-w-5xl flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        {hasSummary ? (
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
            {items.map((item) => (
              <SummaryItem
                key={item.label}
                label={item.label}
                value={item.value}
                emphasize={item.emphasize}
              />
            ))}
          </div>
        ) : (
          <p className="text-sm text-slate-400">{emptyLabel}</p>
        )}

        <div className="flex items-center gap-3 sm:shrink-0">
          {onBack ? (
            <Button
              type="button"
              variant="ghost"
              onClick={onBack}
              className="gap-1.5 text-slate-600 transition-all duration-200 hover:text-slate-900"
            >
              <ArrowLeft className="h-4 w-4" />
              {backLabel ?? "Back"}
            </Button>
          ) : null}

          <Button
            size="lg"
            disabled={disabled}
            onClick={onContinue}
            className="group h-12 flex-1 rounded-full bg-emerald-600 text-base font-semibold text-white shadow-sm transition-all duration-200 hover:bg-emerald-700 hover:shadow-md active:scale-[0.98] sm:flex-none sm:px-8"
          >
            {continueLabel}
            <ArrowRight className="ml-1.5 h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5" />
          </Button>
        </div>
      </div>
    </div>
  );
}

function SummaryItem({
  label,
  value,
  emphasize,
}: {
  label: string;
  value: string;
  emphasize?: boolean;
}) {
  return (
    <div>
      <p className="text-[0.65rem] font-semibold uppercase tracking-wider text-slate-400">
        {label}
      </p>
      <p
        className={cn(
          "mt-0.5 text-sm font-semibold text-slate-900",
          emphasize && "text-base text-emerald-700",
        )}
      >
        {value}
      </p>
    </div>
  );
}
