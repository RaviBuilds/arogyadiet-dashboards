import type { LucideIcon } from "lucide-react";
import { Check, Drumstick, Egg, Leaf } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * FoodPreferenceCard — redesigned "lifestyle choice" card replacing the
 * plain outline buttons in step-1-plan.tsx. Each meal category becomes a
 * large segmented card with an icon, title and short supporting sentence,
 * matching the premium language used across Meals/Subscription.
 *
 * Each category also carries its own accent colour — the same green/amber/
 * red tokens already used for meal categories on the Dashboard
 * (src/shared/components/customer/dashboard/meal-theme.ts) — so the choice
 * is legible at a glance even before reading the icon shape, instead of
 * relying on icon silhouette alone at small sizes.
 *
 * Category → icon/description mapping is presentation-only. If the admin
 * introduces a code this map doesn't recognise, it falls back to a generic
 * leaf icon, a neutral slate accent and the category's own name — so this
 * never breaks for new categories, it just looks a little less bespoke
 * until a designer adds one.
 */
const CATEGORY_PRESENTATION: Record<
  string,
  {
    label: string;
    description: string;
    icon: LucideIcon;
    iconBg: string;
    iconText: string;
    selectedIconBg: string;
  }
> = {
  VEG: {
    label: "Vegetarian",
    description: "Fresh plant-powered meals.",
    icon: Leaf,
    iconBg: "bg-emerald-50",
    iconText: "text-emerald-600",
    selectedIconBg: "bg-emerald-100",
  },
  EGG: {
    label: "Egg",
    description: "Protein-rich balanced nutrition.",
    icon: Egg,
    iconBg: "bg-amber-50",
    iconText: "text-amber-600",
    selectedIconBg: "bg-amber-100",
  },
  CHICKEN: {
    label: "Non-Veg",
    description: "High-protein complete meals.",
    icon: Drumstick,
    iconBg: "bg-red-50",
    iconText: "text-red-600",
    selectedIconBg: "bg-red-100",
  },
};

function getPresentation(code: string, fallbackName?: string) {
  return (
    CATEGORY_PRESENTATION[code] ?? {
      label: fallbackName || code,
      description: "A wholesome meal option.",
      icon: Leaf,
      iconBg: "bg-slate-100",
      iconText: "text-slate-500",
      selectedIconBg: "bg-slate-200",
    }
  );
}

export function FoodPreferenceCard({
  code,
  name,
  isSelected,
  onSelect,
}: {
  code: string;
  name?: string;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const { label, description, icon: Icon, iconBg, iconText, selectedIconBg } =
    getPresentation(code, name);

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={isSelected}
      className={cn(
        "group relative flex flex-1 flex-col items-center gap-2.5 rounded-3xl border bg-white px-5 py-6 text-center shadow-sm transition-all duration-300 sm:min-w-[180px]",
        "hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60",
        isSelected
          ? "-translate-y-0.5 border-emerald-400 bg-emerald-50/60 shadow-md ring-2 ring-emerald-200"
          : "border-slate-200 hover:border-emerald-200",
      )}
    >
      {isSelected ? (
        <span className="absolute right-3 top-3 flex h-5 w-5 items-center justify-center rounded-full bg-emerald-600 text-white animate-in zoom-in-50 duration-200">
          <Check className="h-3 w-3" strokeWidth={3} />
        </span>
      ) : null}

      <span
        className={cn(
          "flex h-12 w-12 items-center justify-center rounded-full transition-colors duration-300",
          isSelected ? selectedIconBg : iconBg,
          iconText,
        )}
      >
        <Icon className="h-6 w-6" strokeWidth={1.75} />
      </span>

      <div>
        <p className="text-sm font-semibold text-slate-900">{label}</p>
        <p className="mt-0.5 text-xs leading-relaxed text-slate-500">
          {description}
        </p>
      </div>
    </button>
  );
}
