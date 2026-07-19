import { ShoppingBag, Sparkles } from "lucide-react";
import { IconChip } from "@/shared/components/customer/profile-ui/IconChip";

/**
 * ShopHero — the Shop's landing hero, built to sit as a sibling of the
 * Dashboard's JourneyHeader and the Meals page's MealsHero rather than a
 * generic page title.
 *
 * Reuses the exact dashboard visual vocabulary instead of inventing a new
 * one: the same forest-green → mint → warm-cream gradient wash, soft blurred
 * light wells, the `reveal-rise` / `hero-sheen` motion system, the shared
 * `IconChip` primitive, and the `ring-inset` pill badge style used for plan
 * chips throughout the customer portal. This is what makes Shop feel like
 * part of ArogyaDiet rather than a bolted-on storefront template.
 */
export function ShopHero({ productCount }: { productCount: number }) {
  return (
    <section
      className="reveal-rise relative isolate overflow-hidden rounded-3xl border border-emerald-900/10 bg-gradient-to-br from-emerald-50 via-white to-amber-50/40 shadow-sm"
      style={{ ["--reveal-delay" as string]: "150ms" }}
    >
      {/* Depth layer: soft light wells, same technique as MealsHero/JourneyHeader */}
      <div className="pointer-events-none absolute -right-20 -top-24 h-64 w-64 rounded-full bg-emerald-200/40 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-24 left-1/4 h-56 w-56 rounded-full bg-amber-100/40 blur-3xl" />

      {/* One-time morning-light sweep on app open (shared dashboard motion). */}
      <div className="hero-sheen pointer-events-none absolute inset-y-0 -left-1/3 z-10 w-1/3 bg-gradient-to-r from-transparent via-white/50 to-transparent" />

      <div className="relative z-20 flex flex-col gap-6 p-7 sm:flex-row sm:items-center sm:justify-between sm:p-9">
        <div>
          <div className="flex items-center gap-2.5">
            <IconChip icon={ShoppingBag} tone="green" />
            <span className="text-[0.7rem] font-semibold uppercase tracking-[0.2em] text-emerald-700/90">
              Wellness Essentials
            </span>
          </div>

          <h1 className="mt-4 text-3xl font-semibold leading-[1.1] tracking-tight text-slate-900 sm:text-[2.25rem]">
            ArogyaDiet Shop
          </h1>

          <p className="mt-3 max-w-md text-[0.95rem] leading-relaxed text-slate-600">
            Discover clean, nourishing essentials curated for your wellness
            journey.
          </p>
        </div>

        {productCount > 0 ? (
          <div className="inline-flex w-fit items-center gap-2 self-start rounded-full bg-white/70 px-4 py-2 text-sm font-medium text-emerald-800 ring-1 ring-emerald-900/10 backdrop-blur-sm sm:self-auto">
            <Sparkles className="h-4 w-4 text-emerald-600" />
            {productCount} {productCount === 1 ? "product" : "products"}{" "}
            curated for you
          </div>
        ) : null}
      </div>
    </section>
  );
}
