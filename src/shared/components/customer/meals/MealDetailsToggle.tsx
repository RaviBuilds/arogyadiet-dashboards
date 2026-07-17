"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * MealDetailsToggle — the "View Meal Details" CTA, as an inline expand
 * rather than a link.
 *
 * There is no dedicated order/meal-details page anywhere in the app today
 * (confirmed against delivery-status.ts's own comment on the Dashboard's
 * equivalent card), and inventing one is out of scope here ("reuse existing
 * routes, do not invent new pages"). The card already shows today's add-ons
 * and reassurance copy inline, so expanding in place keeps the customer
 * inside the emotional moment instead of bouncing them to a new screen for
 * one extra line of detail.
 */
export function MealDetailsToggle() {
  const [open, setOpen] = useState(false);

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="group mt-2 inline-flex w-fit items-center justify-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground shadow-sm transition-all duration-200 hover:shadow-md hover:brightness-105 active:scale-[0.98]"
      >
        View Meal Details
        <ChevronDown
          className={cn(
            "h-4 w-4 transition-transform duration-200",
            open && "rotate-180",
          )}
        />
      </button>

      {open ? (
        <div className="mt-3 rounded-2xl bg-amber-50/70 p-4 text-sm text-slate-600 ring-1 ring-amber-100">
          <p>
            Today&apos;s meal is packed and handed off to your delivery
            partner, ready to head your way on schedule.
          </p>
        </div>
      ) : null}
    </div>
  );
}
