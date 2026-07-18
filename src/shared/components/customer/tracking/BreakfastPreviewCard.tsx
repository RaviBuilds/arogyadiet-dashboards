import Image from "next/image";
import { Leaf } from "lucide-react";

export type AddonProductLine = { name: string; quantity: number };

/**
 * BreakfastPreviewCard — "here's what you're waiting for".
 *
 * Meal name comes from the real `meal_categories.name` already joined on
 * the order. Calories / protein macros are NOT rendered — there is no such
 * column anywhere in the schema (meal_categories only has code/name;
 * kit_daily_logs' nutrition fields are self-reported intake logs, not meal
 * nutrition facts) — per "never invent fake data" they're simply omitted.
 * The photo reuses the same real meal photography already used on the
 * Dashboard's Today's Focus card, purely as appetising texture.
 */
export function BreakfastPreviewCard({
  mealName,
  addons,
  image = "/food%20image1.jpg",
}: {
  mealName: string | null;
  addons: AddonProductLine[];
  image?: string;
}) {
  if (!mealName && addons.length === 0) return null;

  return (
    <div className="reveal-rise flex items-center gap-4 rounded-3xl border border-slate-100 bg-white p-4 sm:p-5">
      <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-2xl bg-emerald-50">
        <Image src={image} alt={mealName || "Today's breakfast"} fill sizes="64px" className="object-cover" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <Leaf className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
          <span className="text-[0.65rem] font-semibold uppercase tracking-wider text-emerald-600">
            Healthy Breakfast
          </span>
        </div>
        <p className="mt-0.5 truncate text-sm font-bold text-slate-900">
          {mealName || "Today's meal"}
        </p>
        {addons.length > 0 ? (
          <p className="mt-0.5 truncate text-xs text-slate-500">
            + {addons.map((a) => `${a.name} (x${a.quantity})`).join(", ")}
          </p>
        ) : null}
      </div>
    </div>
  );
}
