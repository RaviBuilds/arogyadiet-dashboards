/**
 * Shared meal-category visual themes for the customer dashboard.
 *
 * Single source of truth so the Today's Focus card, the delivery roster and
 * any future customer-type view render category colours consistently.
 */
export type MealTheme = {
  bg: string;
  border: string;
  text: string;
  /** Solid accent (used for schedule rails / dots). */
  accent: string;
  label: string;
};

export const MEAL_THEMES: Record<string, MealTheme> = {
  VEG: {
    bg: "bg-green-50",
    border: "border-green-200",
    text: "text-green-700",
    accent: "bg-green-500",
    label: "Veg",
  },
  CHICKEN: {
    bg: "bg-red-50",
    border: "border-red-200",
    text: "text-red-700",
    accent: "bg-red-500",
    label: "Chicken",
  },
  EGG: {
    bg: "bg-amber-50",
    border: "border-amber-200",
    text: "text-amber-700",
    accent: "bg-amber-500",
    label: "Egg",
  },
  MIXED: {
    bg: "bg-purple-50",
    border: "border-purple-200",
    text: "text-purple-700",
    accent: "bg-purple-500",
    label: "Mixed",
  },
};
